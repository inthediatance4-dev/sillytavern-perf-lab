import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const root = path.resolve('.fixtures', `enabled-backups-${randomUUID()}`);
await fs.mkdir(root, { recursive: true });
globalThis.DATA_ROOT = root;
const config = path.join(root, 'config.yaml');
await fs.writeFile(config, 'backups:\n  common:\n    numberOfBackups: 2\n  chat:\n    enabled: true\n    checkIntegrity: true\n    throttleInterval: 10000\nlogging:\n  minLogLevel: 3\n');
const { setConfigFilePath } = await import('../src/util.js');
setConfigFilePath(config);
const { trySaveChat, flushChatBackups } = await import('../src/endpoints/chats.js');

test('enabled backups flush the latest throttled snapshot and recycle expired versions', async () => {
    const file = path.join(root, 'chat.jsonl');
    const backups = path.join(root, 'backups');
    await fs.mkdir(backups);
    const snapshots = [];
    for (let i = 0; i < 6; i++) {
        const rows = [{ chat_metadata: { integrity: 'synthetic' } }, { name: 'Synthetic', mes: `version-${i}` }];
        snapshots.push(rows.map(row => JSON.stringify(row)).join('\n'));
        await trySaveChat(rows, file, false, 'synthetic-backup-user', 'Synthetic', backups);
    }
    await flushChatBackups();
    let names = (await fs.readdir(backups)).filter(name => name.endsWith('.jsonl'));
    assert.equal(names.length, 2, 'Leading and latest trailing backups must both complete');
    assert.equal(new Set(names).size, 2);
    const contents = await Promise.all(names.map(name => fs.readFile(path.join(backups, name), 'utf8')));
    assert.deepEqual(new Set(contents), new Set([snapshots[0], snapshots[5]]));
    for (let i = 6; i < 9; i++) {
        const rows = [{ chat_metadata: { integrity: 'synthetic' } }, { name: 'Synthetic', mes: `version-${i}` }];
        snapshots.push(rows.map(row => JSON.stringify(row)).join('\n'));
        await trySaveChat(rows, file, false, 'synthetic-backup-user', 'Synthetic', backups);
        await flushChatBackups();
    }
    names = (await fs.readdir(backups)).filter(name => name.endsWith('.jsonl'));
    assert.equal(names.length, 2);
    const bins = await fs.readdir(path.join(backups, '.recycle'));
    const recycled = [];
    for (const bin of bins) {
        for (const name of await fs.readdir(path.join(backups, '.recycle', bin))) {
            recycled.push(await fs.readFile(path.join(backups, '.recycle', bin, name), 'utf8'));
        }
    }
    assert.equal(recycled.length, 3);
    const all = [...recycled, ...await Promise.all(names.map(name => fs.readFile(path.join(backups, name), 'utf8')))];
    assert.deepEqual(new Set(all), new Set([snapshots[0], ...snapshots.slice(5)]));
    assert.equal(await fs.readFile(file, 'utf8'), snapshots[8]);
});
