import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkIntegrity } from '../src/integrity-check.js';
import { markerPath } from '../src/chat-io.js';
import { symlinkOrSkip } from './helpers/symlink-capability.mjs';

const command = fileURLToPath(new URL('../scripts/check-integrity.mjs', import.meta.url));
function run(root, ...args) {
    return spawnSync(process.execPath, [command, '--data-root', root, ...args], { encoding: 'utf8' });
}
async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'integrity-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}
async function put(root, relative, text) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
    return file;
}
async function snapshot(root) {
    const result = [];
    async function visit(file) {
        const stat = await fs.lstat(file);
        result.push({ path: path.relative(root, file), size: stat.size, mtime: stat.mtimeMs,
            hash: stat.isFile() ? createHash('sha256').update(await fs.readFile(file)).digest('hex') : null });
        if (stat.isDirectory()) for (const name of (await fs.readdir(file)).sort()) await visit(path.join(file, name));
    }
    await visit(root);
    return result;
}

test('all finding types, user roots and complete before/after read-only snapshot', async t => {
    const root = await fixture(t);
    for (const handle of ['alice', 'disabled-user']) await put(root, `_storage/${handle}`, JSON.stringify({ key: `user:${handle}`, value: { enabled: false } }));
    await put(root, '_storage/unrelated', JSON.stringify({ key: 'other', value: {} }));
    const chats = path.join(root, 'alice/chats');
    const bad = await put(root, 'alice/chats/avatar/bad.jsonl', '\uFEFF{}\r\n\r\nbroken\n[]\nnull\n{"mes":"ok"}\n');
    await put(root, 'disabled-user/group chats/bad.jsonl', 'bad\n');
    await put(root, 'alice/characters/hold-old.json', 'unreadable legacy evidence');
    await put(root, 'alice/chats/.chat-staging/a0000000-0000-4000-8000-000000000000', 'staged');
    await put(root, `alice/chats/.chat-lifecycle/${'a'.repeat(64)}.json.123`, 'temp');
    await put(root, 'alice/chats/chat.jsonl.123', 'ambiguous');
    await put(root, 'alice/chats/.recycle/old/bad.jsonl', 'bad recycled content');
    for (const [name, intent] of [['publish', 'publish'], ['delete', undefined]]) {
        const visible = await put(root, `alice/chats/${name}.jsonl`, '{}\n');
        await put(root, path.relative(root, markerPath(visible, chats)), JSON.stringify({ relative_path: `${name}.jsonl`, intent }));
    }
    const before = await snapshot(root);
    const result = run(root, '--json');
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.roots.length, 6);
    assert.deepEqual(report.findings.filter(f => f.source === bad).map(f => f.line), [3, 4, 5]);
    assert.equal(report.findings.filter(f => f.kind === 'corrupt-jsonl').length, 4);
    assert.equal(report.findings.filter(f => f.kind === 'leftover-hold').length, 1);
    assert.equal(report.findings.filter(f => f.kind === 'orphan').length, 2);
    assert.equal(report.findings.filter(f => f.kind === 'manual-temp').length, 1);
    assert.deepEqual(report.findings.filter(f => f.kind === 'marker-visible-conflict').map(f => f.intent).sort(), ['publish', null].sort());
    assert.deepEqual(report.recycle.find(f => f.root === chats), { root: chats, bytes: 20, count: 1 });
    const text = run(root);
    assert.equal(text.status, 1);
    assert.match(text.stdout, /corrupt-jsonl/);
    assert.match(text.stdout, /20 bytes, 1 files/);
    assert.deepEqual(await snapshot(root), before);
});

test('clean default user, missing lifecycle roots and absent storage stay absent', async t => {
    const root = await fixture(t);
    const before = await snapshot(root);
    const result = run(root, '--json');
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.roots.length, 3);
    assert.deepEqual(report.findings, []);
    assert.deepEqual(await snapshot(root), before);
});

test('valid JSONL in each lifecycle root is clean', async t => {
    const root = await fixture(t);
    for (const dir of ['chats', 'characters', 'group chats']) await put(root, `default-user/${dir}/chat.jsonl`, '{}\n{"mes":"valid"}\n');
    assert.equal(run(root).status, 0);
});

test('usage, missing data directory and corrupt storage return 2', async t => {
    const root = await fixture(t);
    assert.equal(spawnSync(process.execPath, [command], { encoding: 'utf8' }).status, 2);
    assert.equal(run(path.join(root, 'missing'), '--json').status, 2);
    await put(root, '_storage/bad', 'bad');
    const result = run(root, '--json');
    assert.equal(result.status, 2);
    assert.ok(JSON.parse(result.stdout).error);
});

for (const handle of ['../escape', '..\\escape', 'C:\\escape']) {
    test(`rejects unsafe user handle ${handle} on all platforms`, async t => {
        const root = await fixture(t);
        await put(root, '_storage/user', JSON.stringify({ key: `user:${handle}` }));
        assert.equal(run(root, '--json').status, 2);
    });
}

test('invalid marker identity fails without changing evidence', async t => {
    const root = await fixture(t);
    await put(root, `default-user/chats/.chat-lifecycle/${'a'.repeat(64)}.json`, JSON.stringify({ relative_path: 'different.jsonl' }));
    const before = await snapshot(root);
    assert.equal(run(root).status, 2);
    assert.deepEqual(await snapshot(root), before);
});

test('symlink roots are refused rather than followed', async t => {
    const root = await fixture(t);
    const outside = await fixture(t);
    await fs.mkdir(path.join(root, 'default-user'));
    if (!await symlinkOrSkip(t, outside, path.join(root, 'default-user/chats'), 'dir')) return;
    await assert.rejects(checkIntegrity(root), { reason: 'path_alias' });
});

test('stream read errors produce exit 2 rather than a clean or partial report', async t => {
    const root = await fixture(t);
    const preloadRoot = await fixture(t);
    await put(root, 'default-user/chats/read-error.jsonl', '{}\n');
    const preload = await put(preloadRoot, 'fault.mjs', `
        import fs from 'node:fs';
        import { Readable } from 'node:stream';
        const original = fs.createReadStream;
        fs.createReadStream = (file, ...args) => String(file).endsWith('read-error.jsonl')
            ? new Readable({ read() { this.destroy(Object.assign(new Error('Synthetic EIO'), { code: 'EIO' })); } })
            : original(file, ...args);
    `);
    const before = await snapshot(root);
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, command, '--data-root', root, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
    assert.match(JSON.parse(result.stdout).error, /Synthetic EIO/);
    assert.deepEqual(await snapshot(root), before);
});

test('native Windows case alias data root reports conflicts read-only', {
    skip: process.platform !== 'win32' ? 'Requires native Windows case-insensitive filesystem; unsafe Windows path inputs are tested on all platforms' : false,
}, async t => {
    const root = await fixture(t);
    const chats = path.join(root, 'default-user/chats');
    const visible = await put(root, 'default-user/chats/chat.jsonl', '{}\n');
    await put(root, path.relative(root, markerPath(visible, chats)), JSON.stringify({ relative_path: 'chat.jsonl', intent: 'publish' }));
    const before = await snapshot(root);
    const result = run(root.toUpperCase(), '--json');
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).findings[0].intent, 'publish');
    assert.deepEqual(await snapshot(root), before);
});
