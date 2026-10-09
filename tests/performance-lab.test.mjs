import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import test, { after } from 'node:test';
import express from 'express';

const root = path.resolve('.fixtures', `tests-${crypto.randomUUID()}`);
fs.mkdirSync(root, { recursive: true });
globalThis.DATA_ROOT = root;
const config = path.join(root, 'config.yaml');
fs.writeFileSync(config, 'backups:\n  chat:\n    enabled: false\n    checkIntegrity: true\n    throttleInterval: 0\nlogging:\n  minLogLevel: 3\n');
const util = await import('../src/util.js');
util.setConfigFilePath(config);
const chats = await import('../src/endpoints/chats.js');
const dirs = Object.fromEntries(['chats', 'groupChats', 'groups', 'backups'].map(key => [key, path.join(root, key)]));
for (const directory of Object.values(dirs)) fs.mkdirSync(directory, { recursive: true });
fs.mkdirSync(path.join(dirs.chats, 'Synthetic'), { recursive: true });
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
    req.user = { profile: { handle: 'synthetic-user' }, directories: dirs };
    next();
});
app.use('/api/chats', chats.router);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));

function fixture(name, messages, suffix = '') {
    const file = path.join(dirs.chats, 'Synthetic', `${name}.jsonl`);
    const rows = [{ chat_metadata: { integrity: 'synthetic-integrity' } }, ...messages.map(mes => ({ name: 'Synthetic', mes, send_date: '2026-01-01' }))];
    fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + suffix);
    return file;
}
async function search(query) {
    const response = await fetch(base + '/api/chats/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar_url: 'Synthetic.png', query }) });
    assert.equal(response.status, 200);
    return response.json();
}

test('search matches words across different messages and uses filename fallback', async () => {
    fixture('cross-message', ['ALPHA', 'Beta']);
    fixture('filename-only-needle', ['ordinary']);
    const matched = await search('alpha beta');
    assert.deepEqual(matched.map(item => item.file_name), ['cross-message']);
    const fallback = await search('filename-only-needle');
    assert.deepEqual(fallback.map(item => item.file_name), ['filename-only-needle']);
});

test('search does at most linear lowercase work for an absent word', async () => {
    fixture('long-search', Array.from({ length: 600 }, (_, i) => `ordinary-${i}`));
    let count = 0;
    const original = String.prototype.toLowerCase;
    String.prototype.toLowerCase = function () { count++; return original.call(this); };
    try { assert.deepEqual(await search('missing-unique-needle'), []); }
    finally { String.prototype.toLowerCase = original; }
    assert.ok(count < 1000, `Expected linear work, observed ${count} lowercase calls`);
});

test('chat info ignores blank tail lines and retains metadata and message count', async () => {
    const file = fixture('blank-tail', ['first', 'last'], '\n\n');
    const result = await Promise.race([chats.getChatInfo(file, {}, true), new Promise(resolve => setTimeout(() => resolve('timeout'), 200))]);
    assert.notEqual(result, 'timeout', 'Reader must settle after end of input');
    assert.equal(result.chat_items, 2);
    assert.equal(result.mes, 'last');
    assert.equal(result.chat_metadata.integrity, 'synthetic-integrity');
});

test('chat info settles for a file containing only blank lines', async () => {
    const file = path.join(root, 'only-blank.jsonl');
    fs.writeFileSync(file, '\n\n');
    const result = await Promise.race([chats.getChatInfo(file), new Promise(resolve => setTimeout(() => resolve('timeout'), 200))]);
    assert.notEqual(result, 'timeout');
    assert.equal(result.chat_items, 0);
});

test('chat save uses asynchronous writes and keeps serialized contents', async () => {
    const file = path.join(root, 'async-save.jsonl');
    const rows = [{ chat_metadata: {} }, { name: 'Synthetic', mes: 'saved' }];
    const original = fs.writeSync;
    let count = 0;
    fs.writeSync = (...args) => { count++; return original(...args); };
    try { await chats.trySaveChat(rows, file, true, 'synthetic-user', 'Synthetic', dirs.backups); }
    finally { fs.writeSync = original; }
    assert.equal(count, 0, 'No synchronous writes on the save path');
    assert.equal(await fs.promises.readFile(file, 'utf8'), rows.map(row => JSON.stringify(row)).join('\n'));
});

test('chat reads are asynchronous and keep JSONL parsing behavior', async () => {
    const file = fixture('read-async', ['read-back']);
    const pending = chats.getChatData(file);
    assert.ok(pending instanceof Promise, 'Reading chat files must not synchronously read the whole file');
    const rows = await pending;
    assert.equal(rows[1].mes, 'read-back');
});

async function ioModule() {
    const module = await import('../src/chat-io.js').catch(() => ({}));
    assert.equal(typeof module.withPathLock, 'function', 'Ordered async chat I/O must exist');
    return module;
}

test('same path operations stay ordered while distinct paths can proceed', async () => {
    const { withPathLock } = await ioModule();
    const sequence = [];
    let unblock;
    const gate = new Promise(resolve => { unblock = resolve; });
    const first = withPathLock(path.join(root, 'lock-a'), async () => { sequence.push('first-start'); await gate; sequence.push('first-end'); });
    const second = withPathLock(path.join(root, 'lock-a'), async () => { sequence.push('second'); });
    await withPathLock(path.join(root, 'lock-b'), async () => { sequence.push('other'); });
    assert.deepEqual(sequence, ['first-start', 'other']);
    unblock();
    await Promise.all([first, second]);
    assert.deepEqual(sequence, ['first-start', 'other', 'first-end', 'second']);
});

test('queue recovers after a failed operation', async () => {
    const { withPathLock } = await ioModule();
    const key = path.join(root, 'failure-lock');
    await assert.rejects(withPathLock(key, async () => { throw new Error('synthetic failure'); }), /synthetic failure/);
    assert.equal(await withPathLock(key, async () => 'recovered'), 'recovered');
});

test('failed atomic replacement retains the previous chat', async () => {
    const { writeChatFile } = await ioModule();
    const file = path.join(root, 'failed-write.jsonl');
    await fs.promises.writeFile(file, 'original');
    const originalRename = fs.rename;
    fs.rename = (_source, _destination, callback) => callback(Object.assign(new Error('synthetic rename failure'), { code: 'EIO' }));
    try { await assert.rejects(writeChatFile(file, 'candidate'), /synthetic rename failure/); }
    finally { fs.rename = originalRename; }
    assert.equal(await fs.promises.readFile(file, 'utf8'), 'original');
});

test('expired backups are moved to recoverable storage with one stat per candidate', async () => {
    const { recycleOldChatBackups } = await ioModule();
    const dir = path.join(root, 'backup-cleanup');
    await fs.promises.mkdir(dir);
    for (let i = 0; i < 6; i++) {
        const file = path.join(dir, `chat_synthetic_${i}.jsonl`);
        await fs.promises.writeFile(file, `synthetic-${i}`);
        await fs.promises.utimes(file, 100 + i, 100 + i);
    }
    await fs.promises.writeFile(path.join(dir, 'settings_keep.json'), 'keep');
    let count = 0;
    const originalStat = fs.promises.stat;
    fs.promises.stat = async (...args) => { count++; return originalStat(...args); };
    try { await recycleOldChatBackups(dir, 'chat_synthetic_', 2); }
    finally { fs.promises.stat = originalStat; }
    assert.equal(count, 6);
    assert.deepEqual((await fs.promises.readdir(dir)).filter(name => name.startsWith('chat_')).sort(), ['chat_synthetic_4.jsonl', 'chat_synthetic_5.jsonl']);
    assert.equal(await fs.promises.readFile(path.join(dir, 'settings_keep.json'), 'utf8'), 'keep');
    const recycled = [];
    async function collect(directory) {
        for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) await collect(file);
            else recycled.push(await fs.promises.readFile(file, 'utf8'));
        }
    }
    await collect(path.join(dir, '.recycle'));
    assert.deepEqual(recycled.sort(), ['synthetic-0', 'synthetic-1', 'synthetic-2', 'synthetic-3']);
});

test('missing chat info rejects instead of hanging', async () => {
    await assert.rejects(chats.getChatInfo(path.join(root, 'missing.jsonl')), { code: 'ENOENT' });
});

test('stream errors reject and release the reader', async () => {
    const file = fixture('stream-failure', ['ordinary']);
    const original = fs.createReadStream;
    fs.createReadStream = () => new Readable({ read() { this.destroy(new Error('synthetic read failure')); } });
    try { await assert.rejects(chats.getChatInfo(file), /synthetic read failure/); }
    finally { fs.createReadStream = original; }
});

test('legacy matcher callbacks and their errors remain supported', async () => {
    const file = fixture('legacy', ['first', 'second']);
    const result = await chats.getChatInfo(file, {}, false, texts => texts.includes('second'));
    assert.equal(result.match, true);
    await assert.rejects(chats.getChatInfo(file, {}, false, () => { throw new Error('synthetic matcher failure'); }), /synthetic matcher failure/);
});

test('metadata is not searched as message content', async () => {
    assert.deepEqual(await search('synthetic-integrity'), []);
});

test('integrity failure leaves the stored chat untouched', async () => {
    const file = fixture('integrity-failure', ['original']);
    const before = await fs.promises.readFile(file);
    await assert.rejects(chats.trySaveChat([{ chat_metadata: { integrity: 'different' } }, { name: 'Synthetic', mes: 'candidate' }], file, false, 'synthetic-user', 'Synthetic', dirs.backups), /integrity check failed/);
    assert.deepEqual(await fs.promises.readFile(file), before);
});

test('queued save checks integrity after the earlier replacement', async () => {
    const file = fixture('queued-integrity', ['original']);
    const firstRows = [{ chat_metadata: { integrity: 'rotated' } }, { name: 'Synthetic', mes: 'first' }];
    const staleRows = [{ chat_metadata: { integrity: 'synthetic-integrity' } }, { name: 'Synthetic', mes: 'stale' }];
    const results = await Promise.allSettled([
        chats.trySaveChat(firstRows, file, true, 'synthetic-user', 'Synthetic', dirs.backups),
        chats.trySaveChat(staleRows, file, false, 'synthetic-user', 'Synthetic', dirs.backups),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.match(results[1].reason.message, /integrity check failed/);
    assert.equal((await chats.getChatData(file))[1].mes, 'first');
});

test('single and group HTTP save/get contracts return arrays and ok', async () => {
    const rows = [{ chat_metadata: {} }, { name: 'Synthetic', mes: 'HTTP round trip' }];
    const post = async (route, body) => {
        const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        assert.equal(response.status, 200);
        return response.json();
    };
    assert.deepEqual(await post('/api/chats/save', { avatar_url: 'Synthetic.png', file_name: 'http-single', chat: rows }), { ok: true });
    assert.deepEqual(await post('/api/chats/get', { avatar_url: 'Synthetic.png', file_name: 'http-single' }), rows);
    assert.deepEqual(await post('/api/chats/group/save', { id: 'http-group', chat: rows }), { ok: true });
    assert.deepEqual(await post('/api/chats/group/get', { id: 'http-group' }), rows);
});

test('invalid backup retention refuses to move any files', async () => {
    const { recycleOldChatBackups } = await ioModule();
    const dir = path.join(root, 'invalid-retention');
    await fs.promises.mkdir(dir);
    await fs.promises.writeFile(path.join(dir, 'chat_keep.jsonl'), 'preserve');
    await assert.rejects(recycleOldChatBackups(dir, 'chat_', -1), RangeError);
    assert.deepEqual(await fs.promises.readdir(dir), ['chat_keep.jsonl']);
});

test('launcher prepares fixed loopback and rejects external/link data paths', async () => {
    const module = await import('../scripts/start-performance-lab.mjs').catch(() => ({}));
    assert.equal(typeof module.prepareLab, 'function', 'An isolated launcher must exist');
    const result = await module.prepareLab();
    assert.equal(result.port, 8780);
    assert.equal(result.listenAddress, '127.0.0.1');
    assert.ok(result.dataRoot.startsWith(path.resolve('.lab-data')));
    await assert.rejects(module.assertLocalPath(path.resolve('..', 'external-data')), /outside/);
    const junction = path.join(root, 'data-link');
    await fs.promises.symlink(root, junction, 'junction');
    await assert.rejects(module.assertLocalPath(junction), /link/);
});
