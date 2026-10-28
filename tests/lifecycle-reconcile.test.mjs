import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import * as io from '../src/chat-io.js';
import { reconcileLifecycle, scanLifecycle } from '../src/lifecycle-reconcile.js';
import { symlinkOrSkip } from './helpers/symlink-capability.mjs';

const ioUrl = new URL('../src/chat-io.js', import.meta.url).href;
const ownerUrl = new URL('../src/data-root-owner.js', import.meta.url).href;
const reconcileUrl = new URL('../src/lifecycle-reconcile.js', import.meta.url).href;
function run(root, operation, stage) {
    return spawnSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import fs from 'node:fs/promises';
        import path from 'node:path';
        import * as io from ${JSON.stringify(ioUrl)};
        import { reconcileLifecycle } from ${JSON.stringify(reconcileUrl)};
        import { acquireDataRootOwnership } from ${JSON.stringify(ownerUrl)};
        const root = ${JSON.stringify(root)};
        await acquireDataRootOwnership(root);
        const operation = ${JSON.stringify(operation)};
        const stage = ${JSON.stringify(stage)};
        const target = path.join(root, 'chat.jsonl');
        if (operation === 'restart') {
            await reconcileLifecycle(root);
            if (stage === 'published') {
                await io.assertChatWritable(target, root);
                await io.writeChatFile(target, 'ordinary-save');
            } else {
                await assert.rejects(io.assertChatWritable(target, root), { reason: 'retired_path' });
                if (stage === 'retry') {
                    await io.renameChatFile(path.join(root, 'source.jsonl'), target, root);
                    await io.assertChatWritable(target, root);
                }
            }
            process.exit(0);
        }
        const rename = fs.rename;
        fs.rename = async (from, to) => {
            if (operation === 'atomic' && stage === 'temporary' && to === target) process.exit(73);
            if (stage === 'before-marker-recycle' && from === io.markerPath(target, root)) process.exit(73);
            const result = await rename(from, to);
            if (operation === 'atomic' && stage === 'published' && to === target) process.exit(73);
            if (operation === 'delete') {
                if (stage === 'marker' && to === io.markerPath(target, root)) process.exit(73);
                if (stage === 'moved' && from === target) process.exit(73);
            } else {
                if (stage === 'intent' && to === io.markerPath(target, root)) process.exit(73);
            }
            return result;
        };
        if (operation === 'delete') {
            const mkdtemp = fs.mkdtemp;
            fs.mkdtemp = async (...args) => {
                const result = await mkdtemp(...args);
                if (stage === 'container') process.exit(73);
                return result;
            };
            await io.withPathLocks(io.chatLockPaths([target]), () => io.recycleRetiredChat(target, root));
        } else {
            const link = fs.link;
            fs.link = async (...args) => {
                if (stage === 'temporary') process.exit(73);
                const result = await link(...args);
                if (stage === 'published') process.exit(73);
                return result;
            };
            await io.withPathLocks(io.chatLockPaths([target]), () => io.usingRetiredPathReuse(target, root, () => operation === 'atomic' ? io.writeChatFile(target, 'new-publication') : io.createChatFileExclusive(target, 'new-publication')));
        }
        throw new Error('crash stage was not reached');
    `], { encoding: 'utf8', timeout: 15000 });
}

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(path.join(root, 'chat.jsonl'), 'original');
    return root;
}
async function allContents(directory) {
    const result = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...await allContents(file));
        else result.push(await fs.readFile(file, 'utf8'));
    }
    return result;
}

for (const [operation, stage] of ['publish', 'atomic'].flatMap(operation => ['intent', 'temporary', 'published', 'before-marker-recycle'].map(stage => [operation, stage]))) {
    test(`real ${operation} publication crash: ${stage}, startup reconciles without resurrection or stuck save`, async t => {
        const root = await fixture(t);
        const target = path.join(root, 'chat.jsonl');
        await io.recycleRetiredChat(target, root);
        await fs.writeFile(path.join(root, 'source.jsonl'), 'retry-source');
        const crash = run(root, operation, stage);
        assert.equal(crash.status, 73, crash.stderr);
        const findings = await scanLifecycle(root);
        const published = ['published', 'before-marker-recycle'].includes(stage);
        assert.ok(findings.some(item => item.kind === (published ? 'published' : 'unpublished')));
        const restart = run(root, 'restart', published ? 'published' : 'retry');
        assert.equal(restart.status, 0, restart.stderr);
        assert.equal(await fs.readFile(target, 'utf8'), published ? 'ordinary-save' : 'retry-source');
        assert.ok((await allContents(path.join(root, '.recycle'))).includes('original'));
        assert.equal((await scanLifecycle(root)).filter(item => item.kind === 'orphan').length, 0);
        await reconcileLifecycle(root); // A second startup is harmless.
    });
}

for (const stage of ['marker', 'container', 'moved']) {
    test(`real deletion crash: ${stage}, startup keeps retirement and all original data`, async t => {
        const root = await fixture(t);
        const crash = run(root, 'delete', stage);
        assert.equal(crash.status, 73, crash.stderr);
        const restart = run(root, 'restart', 'retired');
        assert.equal(restart.status, 0, restart.stderr);
        const contents = await allContents(root);
        assert.ok(contents.includes('original'));
        await assert.rejects(io.assertChatWritable(path.join(root, 'chat.jsonl'), root), { reason: 'retired_path' });
        if (stage !== 'moved') {
            assert.equal(await fs.readFile(path.join(root, 'chat.jsonl'), 'utf8'), 'original');
            assert.match(restart.stderr, /requires manual handling/);
        }
    });
}

test('scan is read-only, cleanup recognizes only reserved UUID staging names', async t => {
    const root = await fixture(t);
    const staging = path.join(root, '.chat-staging');
    await fs.mkdir(staging);
    const uuid = 'a0000000-0000-4000-8000-000000000000';
    for (const name of [uuid, `${uuid}.4294967295`, 'user-notes', 'other.tmp']) await fs.writeFile(path.join(staging, name), name);
    await fs.writeFile(path.join(root, 'chat.jsonl.123'), 'ambiguous-user-file');
    const lifecycle = path.join(root, '.chat-lifecycle');
    await fs.mkdir(lifecycle);
    await fs.writeFile(path.join(lifecycle, `${'a'.repeat(64)}.json.123`), 'legacy-marker-temp');
    const before = await fs.readdir(staging);
    const findings = await scanLifecycle(root);
    assert.deepEqual(await fs.readdir(staging), before);
    assert.equal(findings.filter(item => item.kind === 'orphan').length, 3);
    const logs = [];
    await reconcileLifecycle(root, { log: (...args) => logs.push(args) });
    assert.deepEqual((await fs.readdir(staging)).sort(), ['other.tmp', 'user-notes']);
    assert.equal(await fs.readFile(path.join(root, 'chat.jsonl.123'), 'utf8'), 'ambiguous-user-file');
    assert.equal(logs.filter(args => args[0].includes('recycled')).length, 3);
    assert.ok((await allContents(path.join(root, '.recycle'))).includes(uuid));
});

test('startup reverts absent publish intent while preserving all original record fields', async t => {
    const root = await fixture(t);
    const target = path.join(root, 'chat.jsonl');
    await io.recycleRetiredChat(target, root);
    const marker = io.markerPath(target, root);
    const original = JSON.parse(await fs.readFile(marker, 'utf8'));
    await fs.writeFile(marker, JSON.stringify({ ...original, intent: 'publish', publish_visible_before: false }));
    await reconcileLifecycle(root);
    assert.deepEqual(JSON.parse(await fs.readFile(marker, 'utf8')), original);
    await assert.rejects(io.assertChatWritable(target, root), { reason: 'retired_path' });
});

test('startup refuses symlink staging instead of touching its contents', async t => {
    const root = await fixture(t);
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-other-'));
    t.after(() => fs.rm(other, { recursive: true, force: true }));
    if (!await symlinkOrSkip(t, other, path.join(root, '.chat-staging'), 'dir')) return;
    await assert.rejects(reconcileLifecycle(root), { reason: 'path_alias' });
});


test('native Windows case aliases reconcile the same root-relative marker', {
    skip: process.platform !== 'win32' ? 'Requires native Windows case-insensitive filesystem paths; path-key simulations run on Linux' : false,
}, async t => {
    const root = await fixture(t);
    const target = path.join(root, 'chat.jsonl');
    await io.recycleRetiredChat(target, root);
    const marker = io.markerPath(target, root);
    const record = JSON.parse(await fs.readFile(marker, 'utf8'));
    await fs.writeFile(marker, JSON.stringify({ ...record, intent: 'publish' }));
    await fs.writeFile(target, 'published');
    await reconcileLifecycle(root.toUpperCase());
    await io.assertChatWritable(target, root);
    assert.equal(await fs.readFile(target, 'utf8'), 'published');
});
