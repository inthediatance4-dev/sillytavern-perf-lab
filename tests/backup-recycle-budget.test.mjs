import { symlinkOrSkip } from './helpers/symlink-capability.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { recycleOldChatBackups } from '../src/chat-io.js';

async function treeSize(directory) {
    let total = 0;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
    for (const entry of entries) {
        const target = path.join(directory, entry.name);
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink()) total += stat.size;
        else if (stat.isDirectory()) total += await treeSize(target);
        else if (stat.isFile()) total += stat.size;
    }
    return total;
}

async function makeDir() {
    return fs.mkdtemp(path.join(os.tmpdir(), 'recycle-budget-'));
}

test('recycle byte budget removes only the oldest recycled artifacts', async () => {
    const dir = await makeDir();
    const recycle = path.join(dir, '.recycle');
    await fs.mkdir(path.join(recycle, 'old'), { recursive: true });
    await fs.mkdir(path.join(recycle, 'new'), { recursive: true });
    const older = path.join(recycle, 'old', 'a.jsonl');
    const newer = path.join(recycle, 'new', 'b.jsonl');
    await fs.writeFile(older, '12345');
    await fs.writeFile(newer, '67890');
    await fs.utimes(older, 10, 10);
    await fs.utimes(newer, 50, 50);
    await fs.writeFile(path.join(dir, 'chat_visible.jsonl'), 'visible-backup');
    await fs.writeFile(path.join(dir, 'primary-like.txt'), 'do-not-unlink');
    await recycleOldChatBackups(dir, 'chat_visible', 5, { maxRecycleBytes: 5 });
    assert.equal(await fs.readFile(path.join(dir, 'chat_visible.jsonl'), 'utf8'), 'visible-backup');
    assert.equal(await fs.readFile(path.join(dir, 'primary-like.txt'), 'utf8'), 'do-not-unlink');
    assert.equal(await fs.access(older).then(() => true, () => false), false);
    assert.equal(await fs.readFile(newer, 'utf8'), '67890');
    assert.ok(await treeSize(recycle) <= 5);
    assert.equal(await fs.access(path.join(recycle, 'old')).then(() => true, () => false), false);
});

test('a zero recycle budget purges recycle storage and leaves visible backups', async t => {
    const dir = await makeDir();
    const recycle = path.join(dir, '.recycle');
    await fs.mkdir(recycle);
    const outside = path.join(dir, 'primary.jsonl');
    await fs.writeFile(outside, 'keep-primary');
    if (!await symlinkOrSkip(t, outside, path.join(recycle, 'link.jsonl'))) return;
    await fs.writeFile(path.join(recycle, 'old.jsonl'), 'recycled');
    await fs.writeFile(path.join(dir, 'chat_keep.jsonl'), 'x'.repeat(40));
    await recycleOldChatBackups(dir, 'chat_', 5, { maxRecycleBytes: 0 });
    assert.equal(await fs.readFile(outside, 'utf8'), 'keep-primary');
    assert.equal(await fs.readFile(path.join(dir, 'chat_keep.jsonl'), 'utf8'), 'x'.repeat(40));
    assert.equal(await treeSize(recycle), 0);
});

test('count retention still recycles expired backups and the default budget keeps them', async () => {
    const dir = await makeDir();
    for (let i = 0; i < 4; i++) {
        const file = path.join(dir, `chat_q_${i}.jsonl`);
        await fs.writeFile(file, `snap-${i}!`);
        await fs.utimes(file, 100 + i, 100 + i);
    }
    await fs.writeFile(path.join(dir, 'settings_keep.json'), 'keep');
    const unlimited = await recycleOldChatBackups(dir, 'chat_q_', 1);
    assert.equal(unlimited.recycled.length, 3);
    assert.equal(await fs.readFile(path.join(dir, 'chat_q_3.jsonl'), 'utf8'), 'snap-3!');
    assert.equal(await fs.readFile(path.join(dir, 'settings_keep.json'), 'utf8'), 'keep');
    const recycled = [];
    async function collect(directory) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) await collect(file);
            else recycled.push(await fs.readFile(file, 'utf8'));
        }
    }
    await collect(path.join(dir, '.recycle'));
    assert.deepEqual(recycled.sort(), ['snap-0!', 'snap-1!', 'snap-2!']);
});

test('a positive recycle budget prunes oldest expired backups after count retention', async () => {
    const dir = await makeDir();
    for (let i = 0; i < 4; i++) {
        const file = path.join(dir, `chat_q_${i}.jsonl`);
        await fs.writeFile(file, `snap-${i}!`);
        await fs.utimes(file, 100 + i, 100 + i);
    }
    await recycleOldChatBackups(dir, 'chat_q_', 1, { maxRecycleBytes: 8 });
    assert.equal(await fs.readFile(path.join(dir, 'chat_q_3.jsonl'), 'utf8'), 'snap-3!');
    assert.deepEqual((await fs.readdir(dir)).filter(name => name.endsWith('.jsonl')), ['chat_q_3.jsonl']);
    const recycled = [];
    async function collect(directory) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) await collect(file);
            else recycled.push(await fs.readFile(file, 'utf8'));
        }
    }
    await collect(path.join(dir, '.recycle'));
    assert.deepEqual(recycled, ['snap-2!']);
    assert.ok(await treeSize(path.join(dir, '.recycle')) <= 8);
});

test('an invalid visible retention limit still refuses to move files', async () => {
    const dir = await makeDir();
    await fs.writeFile(path.join(dir, 'chat_keep.jsonl'), 'preserve');
    await assert.rejects(recycleOldChatBackups(dir, 'chat_', -1, { maxRecycleBytes: 0 }), RangeError);
    assert.deepEqual(await fs.readdir(dir), ['chat_keep.jsonl']);
});

test('configured maxRecycleBytes prunes throttled backups without removing the chat', async () => {
    const root = await makeDir();
    const config = path.join(root, 'config.yaml');
    await fs.writeFile(config, [
        'backups:',
        '  common:',
        '    numberOfBackups: 1',
        '  chat:',
        '    enabled: true',
        '    checkIntegrity: true',
        '    throttleInterval: 10000',
        '    maxRecycleBytes: 1',
        'logging:',
        '  minLogLevel: 3',
    ].join('\n'));
    globalThis.DATA_ROOT = root;
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(config);
    const { trySaveChat, flushChatBackups } = await import('../src/endpoints/chats.js');
    const file = path.join(root, 'chat.jsonl');
    const backups = path.join(root, 'backups');
    await fs.mkdir(backups);
    const snapshots = [];
    for (let i = 0; i < 3; i++) {
        const rows = [{ chat_metadata: { integrity: 'synthetic' } }, { name: 'Synthetic', mes: `version-${i}` }];
        snapshots.push(rows.map(row => JSON.stringify(row)).join('\n'));
        await trySaveChat(rows, file, false, 'synthetic-backup-user', 'Synthetic', backups);
        await flushChatBackups();
    }
    const names = (await fs.readdir(backups)).filter(name => name.endsWith('.jsonl'));
    assert.equal(names.length, 1);
    assert.equal(await fs.readFile(path.join(backups, names[0]), 'utf8'), snapshots[2]);
    assert.equal(await fs.readFile(file, 'utf8'), snapshots[2]);
    assert.ok(await treeSize(path.join(backups, '.recycle')) <= 1);
});
