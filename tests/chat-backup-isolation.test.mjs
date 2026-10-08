import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test, { after } from 'node:test';
import express from 'express';

// Every fixture is artificial and retained, including failed writes and recycled bytes.
const root = path.resolve('.fixtures', `backup-isolation-${randomUUID()}`);
fs.mkdirSync(root, { recursive: true });
globalThis.DATA_ROOT = root;
const config = path.join(root, 'config.yaml');
fs.writeFileSync(config, 'backups:\n  common:\n    numberOfBackups: 2\n  chat:\n    enabled: true\n    checkIntegrity: true\n    throttleInterval: 10000\nlogging:\n  minLogLevel: 3\nperformance:\n  useDiskCache: false\n');
const { setConfigFilePath } = await import('../src/util.js');
setConfigFilePath(config);
const chats = await import('../src/endpoints/chats.js');
const backups = await import('../src/endpoints/backups.js');
const { withPathLocks, chatLockPaths, recycleChatPath, waitForChatIO } = await import('../src/chat-io.js');
const schedulerPath = new URL('../src/chat-backup-scheduler.js', import.meta.url);
const schedulerModule = fs.existsSync(schedulerPath) ? await import(schedulerPath) : {};

const users = Object.fromEntries(['alice', 'bob'].map(handle => {
    const directories = Object.fromEntries(['chats', 'groupChats', 'backups'].map(key => [key, path.join(root, handle, key)]));
    for (const directory of Object.values(directories)) fs.mkdirSync(directory, { recursive: true });
    return [handle, { profile: { handle }, directories }];
}));
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = users[req.headers['x-fixture-user'] || 'alice']; next(); });
app.use('/api/chats', chats.router);
app.use('/api/backups', backups.router);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
    await chats.flushChatBackups();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    console.log(`Artificial fixtures retained at ${root}`);
});

const rows = mes => [{ user_name: 'unused', chat_metadata: { integrity: 'artificial' } }, { name: 'Artificial', mes, send_date: '2026-01-01' }];
const jsonl = data => data.map(row => JSON.stringify(row)).join('\n');
async function post(endpoint, body, user = 'alice') {
    return fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-fixture-user': user }, body: JSON.stringify(body) });
}
async function save(user, card, history, mes, group = false) {
    const response = await post(group ? '/api/chats/group/save' : '/api/chats/save', {
        ...(group ? { id: history } : { avatar_url: `${card}.png`, file_name: history }), chat: rows(mes),
    }, user);
    assert.equal(response.status, 200, await response.text());
}
async function currentBackups(user = 'alice') {
    const directory = users[user].directories.backups;
    const names = (await fs.promises.readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.jsonl')).map(entry => entry.name);
    return Promise.all(names.map(async name => ({ name, bytes: await fs.promises.readFile(path.join(directory, name), 'utf8') })));
}
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function makeScheduler(write, options) {
    assert.equal(typeof schedulerModule.createChatBackupScheduler, 'function', 'A bounded async backup scheduler must exist');
    return schedulerModule.createChatBackupScheduler(write, options);
}

test('one user keeps leading and latest snapshots for three histories of the same character', async () => {
    for (const history of ['A', 'B', 'C']) {
        await save('alice', 'SameCharacter', history, `${history}-leading`);
        await save('alice', 'SameCharacter', history, `${history}-obsolete`);
        await save('alice', 'SameCharacter', history, `${history}-latest`);
    }
    await chats.flushChatBackups();
    const files = await currentBackups();
    for (const history of ['A', 'B', 'C']) {
        assert(files.some(file => file.bytes === jsonl(rows(`${history}-leading`))), `${history} must have its own leading backup`);
        assert(files.some(file => file.bytes === jsonl(rows(`${history}-latest`))), `${history} must have its own latest backup`);
    }
    assert.equal(files.length, 6);
    assert(files.every(file => file.name.startsWith('chat_')));
    const prefixes = new Set(files.map(file => file.name.match(/^(chat_.*_[a-f0-9]{64})_/)?.[1]));
    assert.equal(prefixes.size, 3, 'Same character histories require distinct stable quota prefixes');
    assert(!prefixes.has(undefined));
});

test('Chinese names, groups and users keep independent latest snapshots and retention quotas', async () => {
    const cases = [
        ['alice', '角色甲', 'history', false], ['alice', '角色乙', 'history', false],
        ['alice', '', 'group-one', true], ['alice', '', 'group-two', true],
        ['bob', '角色甲', 'history', false],
    ];
    for (let version = 0; version < 4; version++) {
        for (const [user, card, history, group] of cases) await save(user, card, history, `${user}/${card}/${history}/${version}`, group);
        await chats.flushChatBackups();
    }
    for (const [user, card, history] of cases) {
        const files = await currentBackups(user);
        assert(files.some(file => file.bytes === jsonl(rows(`${user}/${card}/${history}/3`))));
        const identityFiles = files.filter(file => file.bytes.includes(`${user}/${card}/${history}/`));
        assert.equal(identityFiles.length, 2, `Quota must apply separately to ${user}/${card}/${history}`);
    }
    const recycled = path.join(users.alice.directories.backups, '.recycle');
    assert((await fs.promises.readdir(recycled)).length > 0, 'Expired backups must be retained in recovery storage');
});

test('resolved path aliases share one schedule and one quota on Windows', async () => {
    const directory = path.join(root, 'identity-backups');
    await fs.promises.mkdir(directory);
    const file = path.join(root, 'CanonicalHistory.jsonl');
    const alias = path.join(root, 'unused', '..', process.platform === 'win32' ? 'canonicalhistory.jsonl' : 'CanonicalHistory.jsonl');
    await chats.trySaveChat(rows('identity-leading'), file, false, 'identity-user', 'Identity', directory);
    await chats.trySaveChat(rows('identity-obsolete'), alias, false, 'identity-user', 'Identity', directory);
    await chats.trySaveChat(rows('identity-latest'), file, false, 'identity-user', 'Identity', directory);
    await chats.flushChatBackups();
    const names = (await fs.promises.readdir(directory)).filter(name => name.endsWith('.jsonl'));
    const bytes = await Promise.all(names.map(name => fs.promises.readFile(path.join(directory, name), 'utf8')));
    assert.deepEqual(new Set(bytes), new Set([jsonl(rows('identity-leading')), jsonl(rows('identity-latest'))]));
    assert.equal(new Set(names.map(name => name.match(/_[a-f0-9]{64}_/)?.[0])).size, 1);
    assert(names.every(name => /_[a-f0-9]{64}_/.test(name)));
});

test('user handles separate scheduling and quotas even for the same resolved history and backup directory', async () => {
    const directory = path.join(root, 'shared-path-backups');
    await fs.promises.mkdir(directory);
    const file = path.join(root, 'shared-user-history.jsonl');
    for (const handle of ['first-handle', 'second-handle']) {
        await chats.trySaveChat(rows(`${handle}-leading`), file, false, handle, 'SameCard', directory);
        await chats.trySaveChat(rows(`${handle}-obsolete`), file, false, handle, 'SameCard', directory);
        await chats.trySaveChat(rows(`${handle}-latest`), file, false, handle, 'SameCard', directory);
    }
    await chats.flushChatBackups();
    const names = (await fs.promises.readdir(directory)).filter(name => name.endsWith('.jsonl'));
    const bytes = await Promise.all(names.map(name => fs.promises.readFile(path.join(directory, name), 'utf8')));
    assert.deepEqual(new Set(bytes), new Set(['first-handle-leading', 'first-handle-latest', 'second-handle-leading', 'second-handle-latest'].map(mes => jsonl(rows(mes)))));
    assert.equal(new Set(names.map(name => name.match(/_[a-f0-9]{64}_/)?.[0])).size, 2);
});

test('shutdown flush drains backups admitted by chat saves already queued behind a file lock', async () => {
    const directory = path.join(root, 'queued-save-backups');
    await fs.promises.mkdir(directory);
    const file = path.join(root, 'queued-save-history.jsonl');
    const entered = deferred();
    const release = deferred();
    const lock = withPathLocks(chatLockPaths([file]), async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    const leading = chats.trySaveChat(rows('queued-leading'), file, false, 'queued-user', 'Queued', directory);
    const latest = chats.trySaveChat(rows('queued-latest'), file, false, 'queued-user', 'Queued', directory);
    let flushed = false;
    const flushing = chats.flushChatBackups().then(() => { flushed = true; });
    try { await pause(20); assert.equal(flushed, false); }
    finally { release.resolve(); await lock; }
    await Promise.all([leading, latest, flushing]);
    const names = (await fs.promises.readdir(directory)).filter(name => name.endsWith('.jsonl'));
    const bytes = await Promise.all(names.map(name => fs.promises.readFile(path.join(directory, name), 'utf8')));
    assert.deepEqual(new Set(bytes), new Set([jsonl(rows('queued-leading')), jsonl(rows('queued-latest'))]));
});

test('legacy and new backups remain listed and downloadable with their exact original bytes', async () => {
    const name = 'chat_legacy_chinese___20000101.jsonl';
    const bytes = jsonl(rows('legacy untouched 中文')) + '\n';
    const file = path.join(users.alice.directories.backups, name);
    await fs.promises.writeFile(file, bytes);
    const listing = await post('/api/backups/chat/get', {});
    assert.equal(listing.status, 200);
    const models = await listing.json();
    assert(models.some(model => model.file_name === name));
    assert(models.every(model => model.file_name.startsWith('chat_') && !model.file_name.includes('.recycle')));
    const newName = models.find(model => /_[a-f0-9]{64}_/.test(model.file_name))?.file_name;
    assert(newName, 'New hashed names must remain discoverable through the aggregate chat_ prefix');
    for (const downloadName of [name, newName]) {
        const response = await post('/api/backups/chat/download', { name: downloadName });
        assert.equal(response.status, 200);
        assert.equal(await response.text(), await fs.promises.readFile(path.join(users.alice.directories.backups, downloadName), 'utf8'));
    }
    assert.equal(await fs.promises.readFile(file, 'utf8'), bytes);
});

test('backup browser deletes under file and directory locks into recoverable storage', async () => {
    // RED must stop before invoking the old permanent unlink on any fixture.
    const source = await fs.promises.readFile(new URL('../src/endpoints/backups.js', import.meta.url), 'utf8');
    assert(!/fsPromises\.unlink\s*\(/.test(source), 'Backup browser deletion must recycle rather than unlink');
    const name = `chat_delete_${randomUUID()}.jsonl`;
    const bytes = jsonl(rows('exact deleted bytes 中文'));
    const directory = users.alice.directories.backups;
    const file = path.join(directory, name);
    await fs.promises.writeFile(file, bytes);
    const entered = deferred();
    const release = deferred();
    const lock = withPathLocks(chatLockPaths([file]), async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    let finished = false;
    const request = post('/api/backups/chat/delete', { name }).then(response => { finished = true; return response; });
    try {
        await pause(30);
        assert.equal(finished, false, 'Delete must await the same locks held by backup writes/retention');
        assert.equal(await fs.promises.readFile(file, 'utf8'), bytes);
    } finally { release.resolve(); await lock; }
    assert.equal((await request).status, 200);
    assert.equal(fs.existsSync(file), false);
    const bins = await fs.promises.readdir(path.join(directory, '.recycle'));
    const recovered = [];
    for (const bin of bins) {
        const candidate = path.join(directory, '.recycle', bin, name);
        if (fs.existsSync(candidate)) recovered.push(await fs.promises.readFile(candidate, 'utf8'));
    }
    assert.deepEqual(recovered, [bytes]);
    const listing = await (await post('/api/backups/chat/get', {})).json();
    assert(!listing.some(model => model.file_name === name));
    assert.equal((await post('/api/backups/chat/delete', { name })).status, 404);
});

test('backup browser preserves invalid-prefix and missing-file responses', async () => {
    const file = path.join(users.alice.directories.backups, 'other.jsonl');
    const bytes = 'retained non-chat artifact';
    await fs.promises.writeFile(file, bytes);
    for (const endpoint of ['delete', 'download']) {
        assert.equal((await post(`/api/backups/chat/${endpoint}`, { name: 'other.jsonl' })).status, 400);
        assert.equal((await post(`/api/backups/chat/${endpoint}`, { name: 'chat_missing.jsonl' })).status, 404);
    }
    assert.equal(await fs.promises.readFile(file, 'utf8'), bytes);
});

test('delayed leading writes serialize latest trailing data and flush waits for actual filesystem writes', async () => {
    const leadingEntered = deferred();
    const leadingRelease = deferred();
    const trailingEntered = deferred();
    const trailingRelease = deferred();
    const directory = path.join(root, 'delayed-scheduler');
    await fs.promises.mkdir(directory);
    const writes = [];
    let active = 0;
    let maximum = 0;
    const scheduler = makeScheduler(async data => {
        active++;
        maximum = Math.max(maximum, active);
        if (data === 'leading') { leadingEntered.resolve(); await leadingRelease.promise; }
        if (data === 'latest') { trailingEntered.resolve(); await trailingRelease.promise; }
        await fs.promises.writeFile(path.join(directory, `${writes.length}.jsonl`), data);
        writes.push(data);
        active--;
    }, { interval: 15 });
    scheduler.schedule('same-key', 'leading');
    await leadingEntered.promise;
    scheduler.schedule('same-key', 'obsolete');
    scheduler.schedule('same-key', 'latest');
    await pause(25);
    assert.equal(active, 1);
    let flushed = false;
    const flush = scheduler.flush().then(() => { flushed = true; });
    assert.equal(flushed, false);
    leadingRelease.resolve();
    await trailingEntered.promise;
    assert.equal(flushed, false);
    trailingRelease.resolve();
    await flush;
    assert.deepEqual(writes, ['leading', 'latest']);
    assert.equal(maximum, 1, 'The same key must never execute overlapping asynchronous callbacks');
    assert.equal(await fs.promises.readFile(path.join(directory, '1.jsonl'), 'utf8'), 'latest');
});

test('keys run independently and timed trailing snapshots retain only the latest per key', async () => {
    const release = deferred();
    const entered = deferred();
    const files = path.join(root, 'independent-scheduler');
    await fs.promises.mkdir(files);
    const writes = [];
    const scheduler = makeScheduler(async (key, data) => {
        if (data === 'A-leading') { entered.resolve(); await release.promise; }
        await fs.promises.writeFile(path.join(files, `${key}-${writes.length}.jsonl`), data);
        writes.push(data);
    }, { interval: 15 });
    scheduler.schedule('A', 'A', 'A-leading');
    await entered.promise;
    scheduler.schedule('B', 'B', 'B-leading');
    scheduler.schedule('B', 'B', 'B-obsolete');
    scheduler.schedule('B', 'B', 'B-latest');
    await pause(35);
    assert.deepEqual(writes, ['B-leading', 'B-latest'], 'B must progress while A is blocked');
    release.resolve();
    await scheduler.flush();
    assert.deepEqual(new Set(writes), new Set(['A-leading', 'B-leading', 'B-latest']));
});

test('capacity eviction drains active and pending data while overflow writes remain part of flush', async () => {
    const entered = deferred();
    const release = deferred();
    const overflowEntered = deferred();
    const overflowRelease = deferred();
    const directory = path.join(root, 'capacity-scheduler');
    await fs.promises.mkdir(directory);
    const writes = [];
    const active = new Map();
    const scheduler = makeScheduler(async (key, data) => {
        active.set(key, (active.get(key) || 0) + 1);
        assert.equal(active.get(key), 1);
        if (data === 'A-leading') { entered.resolve(); await release.promise; }
        if (data === 'B-leading') { overflowEntered.resolve(); await overflowRelease.promise; }
        await fs.promises.writeFile(path.join(directory, `${key}-${writes.length}.jsonl`), data);
        writes.push(data);
        active.set(key, active.get(key) - 1);
    }, { interval: 10000, maxKeys: 1 });
    scheduler.schedule('A', 'A', 'A-leading');
    await entered.promise;
    scheduler.schedule('A', 'A', 'A-latest');
    scheduler.schedule('B', 'B', 'B-leading');
    await overflowEntered.promise;
    scheduler.schedule('A', 'A', 'A-final');
    scheduler.schedule('B', 'B', 'B-obsolete');
    scheduler.schedule('B', 'B', 'B-final');
    let finished = false;
    const flush = scheduler.flush().then(() => { finished = true; });
    release.resolve();
    await pause(20);
    assert.equal(finished, false);
    assert.deepEqual(writes, ['A-leading', 'A-final']);
    overflowRelease.resolve();
    await flush;
    assert.deepEqual(new Set(writes), new Set(['A-leading', 'A-final', 'B-leading', 'B-final']));
    scheduler.schedule('A', 'A', 'A-new-leading');
    await scheduler.flush();
    assert(writes.includes('A-new-leading'));
});

test('default capacity retains at most 256 throttles and admission flushes the oldest pending snapshot', async () => {
    const directory = path.join(root, 'default-capacity');
    await fs.promises.mkdir(directory);
    const writes = [];
    const scheduler = makeScheduler(async (key, data) => {
        await fs.promises.writeFile(path.join(directory, `${key}-${data}.jsonl`), data);
        writes.push(`${key}:${data}`);
    }, { interval: 10000 });
    for (let key = 0; key < 256; key++) scheduler.schedule(String(key), String(key), 'leading');
    await scheduler.flush();
    scheduler.schedule('0', '0', 'pending');
    scheduler.schedule('overflow', 'overflow', 'leading');
    await pause(30);
    assert(writes.includes('0:pending'), 'Capacity admission must drain the oldest pending entry before retirement');
    assert(writes.includes('overflow:leading'));
    await scheduler.flush();
    scheduler.schedule('0', '0', 'fresh');
    await pause(30);
    assert(writes.includes('0:fresh'), 'An evicted key must get a fresh leading write instead of retaining a throttle');
    await scheduler.flush();
});

test('access-triggered idle retirement flushes pending data and a reused key starts leading again', async () => {
    const directory = path.join(root, 'idle-scheduler');
    await fs.promises.mkdir(directory);
    const writes = [];
    const scheduler = makeScheduler(async (key, data) => {
        await fs.promises.writeFile(path.join(directory, `${key}-${data}.jsonl`), data);
        writes.push(`${key}:${data}`);
    }, { interval: 10000, idleMs: 15 });
    scheduler.schedule('idle', 'idle', 'leading');
    await scheduler.flush();
    scheduler.schedule('idle', 'idle', 'latest');
    await pause(25);
    scheduler.schedule('new', 'new', 'leading');
    await pause(25);
    assert(writes.includes('idle:latest'), 'Idle cleanup must write pending data before retiring the key');
    scheduler.schedule('idle', 'idle', 'reused');
    await pause(25);
    assert(writes.includes('idle:reused'));
    await scheduler.flush();
});

test('a real filesystem rejection is caught and a later snapshot can retry without poisoned state', async () => {
    const blocked = path.join(root, 'retry-blocked');
    await fs.promises.writeFile(blocked, 'retained failure blocker');
    const errors = [];
    const scheduler = makeScheduler(async data => {
        await fs.promises.mkdir(blocked, { recursive: true });
        await fs.promises.writeFile(path.join(blocked, 'latest.jsonl'), data);
    }, { interval: 10000, onError: error => errors.push(error) });
    scheduler.schedule('retry', 'failed');
    await scheduler.flush();
    assert.equal(errors.length, 1);
    assert(['EEXIST', 'ENOTDIR'].includes(errors[0].code));
    const preserved = await recycleChatPath(blocked, root);
    assert.equal(await fs.promises.readFile(preserved, 'utf8'), 'retained failure blocker');
    scheduler.schedule('retry', 'retried latest');
    await scheduler.flush();
    assert.equal(await fs.promises.readFile(path.join(blocked, 'latest.jsonl'), 'utf8'), 'retried latest');
    assert.equal(errors.length, 1);
    await waitForChatIO();
});
