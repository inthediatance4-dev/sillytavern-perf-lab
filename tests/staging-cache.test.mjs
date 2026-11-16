import { symlinkOrSkip } from './helpers/symlink-capability.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { writeChatFile, writeLifecycleAtomic, retireChatPath, recycleChatPath, rollbackChatRetirement } from '../src/chat-io.js';

async function fixture(t) {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'staging-cache-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    return root;
}

test('cached staging skips mkdir; external removal retries the temp write once', async t => {
    const root = await fixture(t);
    const file = path.join(root, 'chat.jsonl');
    await writeChatFile(file, 'first');
    const mkdir = fs.promises.mkdir;
    let calls = 0;
    fs.promises.mkdir = async (...args) => { calls++; return mkdir(...args); };
    try {
        await writeChatFile(file, 'second');
        assert.equal(calls, 0);
        await fs.promises.rmdir(path.join(root, '.chat-staging'));
        await writeChatFile(file, 'third');
        assert.equal(calls, 1);
        assert.equal(await fs.promises.readFile(file, 'utf8'), 'third');
    } finally { fs.promises.mkdir = mkdir; }
});

test('parent removal also recovers through staging mkdir', async t => {
    const root = await fixture(t);
    const parent = path.join(root, 'character');
    await writeChatFile(path.join(parent, 'chat.jsonl'), 'first');
    await fs.promises.rename(parent, path.join(root, 'externally-moved'));
    await writeChatFile(path.join(parent, 'chat.jsonl'), 'second');
    assert.equal(await fs.promises.readFile(path.join(parent, 'chat.jsonl'), 'utf8'), 'second');
});

test('directory retirement invalidates cached subtree and rename/recycle carries staging', async t => {
    const root = await fixture(t);
    const parent = path.join(root, 'character');
    await writeChatFile(path.join(parent, 'chat.jsonl'), 'first');
    await fs.promises.writeFile(path.join(parent, '.chat-staging', 'retained'), 'staged bytes');
    const retirement = await retireChatPath(parent, root, 'character_renamed');
    const moved = path.join(root, 'renamed');
    await fs.promises.rename(parent, moved);
    assert.equal(await fs.promises.readFile(path.join(moved, '.chat-staging', 'retained'), 'utf8'), 'staged bytes');
    const recycled = await recycleChatPath(moved, root);
    assert.equal(await fs.promises.readFile(path.join(recycled, '.chat-staging', 'retained'), 'utf8'), 'staged bytes');
    await rollbackChatRetirement(retirement);
    await fs.promises.mkdir(parent);
    const mkdir = fs.promises.mkdir;
    let stagingCreates = 0;
    fs.promises.mkdir = async (...args) => { if (String(args[0]) === path.join(parent, '.chat-staging')) stagingCreates++; return mkdir(...args); };
    try {
        await writeChatFile(path.join(parent, 'chat.jsonl'), 'new');
        assert.equal(stagingCreates, 1);
    } finally { fs.promises.mkdir = mkdir; }
});

test('metadata is preserved across cached atomic replacements', async t => {
    const root = await fixture(t);
    const file = path.join(root, 'chat.jsonl');
    await writeLifecycleAtomic(file, 'first');
    await fs.promises.chmod(file, 0o600);
    const before = await fs.promises.stat(file);
    await writeLifecycleAtomic(file, 'second');
    const after = await fs.promises.stat(file);
    assert.equal(after.mode, before.mode);
    assert.equal(after.uid, before.uid);
    assert.equal(after.gid, before.gid);
});

test('Windows case variants share the staging cache', { skip: process.platform !== 'win32' ? 'Requires a real Windows filesystem with case-insensitive path aliases' : false }, async t => {
    const root = await fixture(t);
    await writeChatFile(path.join(root, 'chat.jsonl'), 'first');
    const mkdir = fs.promises.mkdir;
    let calls = 0;
    fs.promises.mkdir = async (...args) => { calls++; return mkdir(...args); };
    try {
        await writeChatFile(path.join(root.toUpperCase(), 'chat.jsonl'), 'second');
        assert.equal(calls, 0);
        assert.equal(await fs.promises.readFile(path.join(root, 'chat.jsonl'), 'utf8'), 'second');
    } finally { fs.promises.mkdir = mkdir; }
});

test('cached staging still rejects a replacement symlink or Windows junction', async t => {
    const root = await fixture(t);
    const file = path.join(root, 'chat.jsonl');
    await writeChatFile(file, 'original');
    const staging = path.join(root, '.chat-staging');
    const moved = path.join(root, 'moved-staging');
    await fs.promises.rename(staging, moved);
    if (!await symlinkOrSkip(t, moved, staging, process.platform === 'win32' ? 'junction' : 'dir')) return;
    await assert.rejects(writeChatFile(file, 'replacement'), error => error.reason === 'path_alias');
    assert.equal(await fs.promises.readFile(file, 'utf8'), 'original');
    assert.deepEqual(await fs.promises.readdir(moved), []);
});
