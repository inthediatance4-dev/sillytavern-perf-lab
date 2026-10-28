import { symlinkOrSkip } from './helpers/symlink-capability.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import * as io from '../src/chat-io.js';

const moduleUrl = new URL('../src/chat-io.js', import.meta.url).href;
function child(root, stage, retry = false) {
    return spawnSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import fs from 'node:fs/promises';
        import path from 'node:path';
        import * as io from ${JSON.stringify(moduleUrl)};
        const root = ${JSON.stringify(root)};
        const target = path.join(root, 'deleted.jsonl');
        const stage = ${JSON.stringify(stage)};
        const retry = ${retry};
        await assert.rejects(io.assertChatWritable(target, root), { reason: 'retired_path' });
        if (stage === 'before-recycle') {
            const rename = fs.rename;
            fs.rename = async (from, to) => {
                if (from.endsWith('.json') && from.includes('.chat-lifecycle')) process.exit(73);
                return rename(from, to);
            };
        }
        await io.withPathLocks(io.chatLockPaths([target]), () => io.usingRetiredPathReuses([
            { filePath: target, lifecycleRoot: root, allowVisible: retry },
        ], async () => {
            await io.assertChatWritable(target, root);
            if (stage === 'authorized') process.exit(73);
            const temporary = path.join(root, 'publication.tmp');
            const file = await fs.open(temporary, 'w');
            await file.writeFile('explicit-create');
            await file.sync();
            await file.close();
            if (stage === 'temporary') process.exit(73);
            await fs.rename(temporary, target);
            if (stage === 'published') process.exit(73);
        }));
        await io.assertChatWritable(target, root);
        assert.equal(await fs.readFile(target, 'utf8'), 'explicit-create');
    `], { encoding: 'utf8', timeout: 10000 });
}

for (const stage of ['authorized', 'temporary', 'published', 'before-recycle']) {
    test(`publication crash at ${stage} keeps retirement across restart and allows explicit retry`, async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-crash-'));
        const target = path.join(root, 'deleted.jsonl');
        await fs.writeFile(target, 'original');
        await io.recycleRetiredChat(target, root);
        const crashed = child(root, stage);
        assert.equal(crashed.status, 73, crashed.stderr);
        const restarted = child(root, 'retry', true);
        assert.equal(restarted.status, 0, restarted.stderr);
    });
}

test('legacy holds restore absent retirements and preserve visible-path evidence', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-holds-'));
    const directory = path.join(root, '.chat-lifecycle');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'hold-absent.json'), JSON.stringify({ relative_path: 'absent.jsonl' }));
    await fs.writeFile(path.join(directory, 'hold-visible.json'), JSON.stringify({ relative_path: 'visible.jsonl' }));
    await fs.writeFile(path.join(root, 'visible.jsonl'), 'keep');
    await io.restoreLegacyRetiredHolds(root);
    await assert.rejects(io.assertChatWritable(path.join(root, 'absent.jsonl'), root), { reason: 'retired_path' });
    assert.equal(await fs.readFile(path.join(root, 'visible.jsonl'), 'utf8'), 'keep');
    assert.ok((await fs.readdir(directory)).includes('hold-visible.json'));
});

test('a marker cannot be cleared before publication or authorized without a lock', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-admission-'));
    const target = path.join(root, 'deleted.jsonl');
    await fs.writeFile(target, 'old');
    await io.recycleRetiredChat(target, root);
    await assert.rejects(io.clearRetiredPathIfAbsent(target, root), { reason: 'publication_required' });
    await assert.rejects(io.usingRetiredPathReuse(target, root, async () => {}), { reason: 'publication_lock_required' });
    await assert.rejects(io.assertChatWritable(target, root), { reason: 'retired_path' });
});

test('publication authorization is path-bound and revoked for inherited timers after failure', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-token-'));
    const target = path.join(root, 'target.jsonl');
    const other = path.join(root, 'other.jsonl');
    for (const file of [target, other]) {
        await fs.writeFile(file, 'old');
        await io.recycleRetiredChat(file, root);
    }
    let delayed;
    let release;
    const finished = new Promise(resolve => { release = resolve; });
    await assert.rejects(io.withPathLocks(io.chatLockPaths([target]), () => io.usingRetiredPathReuse(target, root, async () => {
        await io.assertChatWritable(target, root);
        await assert.rejects(io.assertChatWritable(other, root), { reason: 'retired_path' });
        delayed = new Promise((resolve, reject) => {
            setTimeout(async () => {
                await finished;
                try {
                    await io.assertChatWritable(target, root);
                    await fs.writeFile(target, 'stale timer');
                    resolve();
                } catch (error) { reject(error); }
            }, 0);
        });
        throw new Error('publication failed');
    })), /publication failed/);
    const rejected = assert.rejects(delayed, { reason: 'retired_path' });
    release();
    await rejected;
    await assert.rejects(fs.access(target), { code: 'ENOENT' });
});

for (const [label, record, reason] of [
    ['corrupt', '{', /JSON/],
    ['missing', '{}', /invalid_retirement/],
    ['invalid', '{"relative_path":42}', /invalid_retirement/],
    ['traversal', '{"relative_path":"../escape"}', /outside_chat_root/],
    ['absolute', JSON.stringify({ relative_path: path.resolve('/escape') }), /invalid_retirement/],
    ['reserved', '{"relative_path":".recycle/escape"}', /reserved_path/],
]) {
    test(`legacy hold ${label} fails with actionable diagnostics`, async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-invalid-'));
        const hold = path.join(root, '.chat-lifecycle', 'hold-invalid.json');
        await fs.mkdir(path.dirname(hold));
        await fs.writeFile(hold, record);
        await assert.rejects(io.restoreLegacyRetiredHolds(root), error => {
            assert.ok(error.message.includes(hold));
            assert.match(error.message, reason);
            assert.match(error.message, /ISOLATION.md, Legacy hold-\*\.json recovery/);
            return true;
        });
        assert.equal(await fs.readFile(hold, 'utf8'), record);
    });
}

for (const alias of ['hold', 'target']) {
    test(`legacy ${alias} symlink fails with actionable diagnostics`, async t => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-alias-'));
        const directory = path.join(root, '.chat-lifecycle');
        await fs.mkdir(directory);
        const hold = path.join(directory, 'hold-alias.json');
        const source = path.join(root, 'source');
        await fs.writeFile(source, JSON.stringify({ relative_path: 'target' }));
        if (alias === 'hold') {
            if (!await symlinkOrSkip(t, source, hold)) return;
        } else {
            await fs.writeFile(hold, JSON.stringify({ relative_path: 'target' }));
            if (!await symlinkOrSkip(t, source, path.join(root, 'target'))) return;
        }
        await assert.rejects(io.restoreLegacyRetiredHolds(root), error => {
            assert.ok(error.message.includes(hold));
            assert.match(error.message, /path_alias/);
            assert.match(error.message, /ISOLATION.md/);
            return true;
        });
    });
}
