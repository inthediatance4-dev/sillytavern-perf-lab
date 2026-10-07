import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test, { after } from 'node:test';
import express from 'express';

// Keep artificial fixtures for inspection; never remove existing user data.
const root = path.resolve('.fixtures', `recent-cache-${randomUUID()}`);
fs.mkdirSync(root, { recursive: true });
globalThis.DATA_ROOT = root;
const config = path.join(root, 'config.yaml');
fs.writeFileSync(config, 'backups:\n  chat:\n    enabled: false\nlogging:\n  minLogLevel: 3\n');
const util = await import('../src/util.js');
util.setConfigFilePath(config);
const chats = await import('../src/endpoints/chats.js');
const dirs = Object.fromEntries(['characters', 'chats', 'groups', 'groupChats'].map(key => [key, path.join(root, key)]));
for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(path.join(dirs.chats, 'Synthetic'));
fs.writeFileSync(path.join(dirs.characters, 'Synthetic.png'), 'discovery only');

function fixture(file, message, mtime = 100) {
    const rows = [{ chat_metadata: { nested: { tag: 'synthetic' } } }, { name: 'Synthetic', mes: message, send_date: '2026-01-01' }];
    fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n'));
    fs.utimesSync(file, mtime, mtime);
    return file;
}
const characterOld = fixture(path.join(dirs.chats, 'Synthetic', 'old.jsonl'), 'old', 101);
const characterNew = fixture(path.join(dirs.chats, 'Synthetic', 'new.jsonl'), 'new', 104);
const groupFile = fixture(path.join(dirs.groupChats, 'group-chat.jsonl'), 'group', 103);
const rootFile = fixture(path.join(dirs.chats, 'solo.jsonl'), 'solo', 102);
fs.writeFileSync(path.join(dirs.groups, 'synthetic.json'), JSON.stringify({ id: 'synthetic-group', chats: ['group-chat'] }));
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { directories: dirs }; next(); });
app.use('/api/chats', chats.router);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
async function recent(body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chats/recent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return response.json();
}

test('real /recent keeps response semantics and avoids unchanged JSONL streams on repeat', async () => {
    const expected = await Promise.all([
        chats.getChatInfo(characterNew, { avatar: 'Synthetic.png' }, true),
        chats.getChatInfo(groupFile, { group: 'synthetic-group' }, true),
        chats.getChatInfo(rootFile, {}, true),
        chats.getChatInfo(characterOld, { avatar: 'Synthetic.png' }, true),
    ]);
    // JSON transport drops the original undefined avatar field for root chats.
    const jsonExpected = JSON.parse(JSON.stringify(expected));
    let streams = 0;
    const original = fs.createReadStream;
    fs.createReadStream = (file, ...args) => {
        if (path.resolve(String(file)).startsWith(root + path.sep)) streams++;
        return original(file, ...args);
    };
    try {
        const body = { max: 15, pinned: [], metadata: true };
        assert.deepEqual(await recent(body), jsonExpected);
        const first = streams;
        assert.equal(first, 4);
        assert.deepEqual(await recent(body), jsonExpected);
        assert.equal(streams, first, 'Unchanged second /recent must open zero additional JSONL streams');
        const pinned = [{ file_name: 'old.jsonl', avatar: 'Synthetic.png' }];
        assert.deepEqual(await recent({ max: 1, pinned, metadata: true }), [jsonExpected[3], jsonExpected[0]]);
        const noMetadata = await recent({ max: 2, pinned: [], metadata: false });
        assert.deepEqual(noMetadata.map(info => info.file_name), ['new.jsonl', 'group-chat.jsonl']);
        assert.ok(noMetadata.every(info => !('chat_metadata' in info)));
        assert.equal(noMetadata[1].group, 'synthetic-group');
        assert.equal(streams, first + 2, 'Metadata modes must use distinct entries');
    } finally { fs.createReadStream = original; }
});

async function factory() {
    return (await import('../src/chat-info-cache.js')).createChatInfoCache;
}
function info(message = 'value') {
    return { file_id: 'synthetic', file_name: 'synthetic.jsonl', chat_items: 1, mes: message, chat_metadata: { nested: { value: message } } };
}
function version(value = 1n) {
    return { dev: 1n, ino: value, size: 10n, mtimeNs: value, ctimeNs: value };
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
async function turns() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

test('real filesystem changes invalidate same-size/restored-mtime writes and replacements', async () => {
    const create = await factory();
    const file = fixture(path.join(root, 'rewrite.jsonl'), 'old');
    let reads = 0;
    const get = create(async (file, metadata) => { reads++; return chats.getChatInfo(file, {}, metadata); });
    assert.equal((await get(file)).mes, 'old');
    assert.equal((await get(path.join(root, '.', 'rewrite.jsonl'))).mes, 'old');
    assert.equal(reads, 1);
    const before = await fs.promises.stat(file, { bigint: true });
    fixture(file, 'new');
    const changed = await fs.promises.stat(file, { bigint: true });
    assert.equal(before.size, changed.size);
    assert.equal(before.mtimeNs, changed.mtimeNs);
    assert.notEqual(before.ctimeNs, changed.ctimeNs);
    assert.equal((await get(file)).mes, 'new');
    const replacement = fixture(path.join(root, 'replacement.jsonl'), 'rep');
    // Keep the retired fixture recoverable instead of unlinking it.
    const recycle = path.join(root, '.recycle');
    await fs.promises.mkdir(recycle);
    await fs.promises.copyFile(file, path.join(recycle, 'rewrite.jsonl'));
    // Atomic replacement keeps a recoverable copy of the previous fixture.
    await fs.promises.rename(replacement, file);
    assert.notEqual((await fs.promises.stat(file, { bigint: true })).ino, changed.ino);
    assert.equal((await get(file)).mes, 'rep');
    assert.equal(reads, 3);
    await fs.promises.rename(file, path.join(recycle, 'replacement.jsonl'));
    await assert.rejects(get(file), { code: 'ENOENT' });
    fixture(file, 'back');
    assert.equal((await get(file)).mes, 'back');
});

test('cache owns cloned snapshots; annotations, roots and metadata modes stay isolated', async () => {
    const create = await factory();
    let reads = 0, stats = 0;
    const original = info();
    const get = create(async (_file, metadata) => { reads++; return { ...original, mode: metadata }; }, {
        stat: async (_file, options) => { assert.equal(options.bigint, true); stats++; return version(); },
    });
    const one = await get(path.join(root, 'user-a', 'chat'), { avatar: 'one', nested: { own: true } }, true);
    original.chat_metadata.nested.value = 'reader mutation';
    one.chat_metadata.nested.value = 'caller mutation';
    const two = await get(path.join(root, 'user-a', 'chat'), { group: 'two' }, true);
    assert.equal(two.chat_metadata.nested.value, 'value');
    assert.equal(two.group, 'two');
    assert.ok(!('avatar' in two) && !('nested' in two));
    await get(path.join(root, 'user-a', 'chat'), {}, false);
    await get(path.join(root, 'user-b', 'chat'), {}, true);
    assert.equal(reads, 3);
    assert.equal(stats, 7, 'Every hit re-stats; misses also stat after reading');
});

test('stable concurrent reads coalesce and return independent objects', async () => {
    const create = await factory();
    const gate = deferred();
    let reads = 0;
    const get = create(async () => { reads++; return gate.promise; }, { stat: async () => version() });
    const a = get('coalesce', { avatar: 'a' });
    const b = get('coalesce', { group: 'b' });
    await turns();
    assert.equal(reads, 1);
    gate.resolve(info());
    const [one, two] = await Promise.all([a, b]);
    one.chat_metadata.nested.value = 'changed';
    assert.equal(two.chat_metadata.nested.value, 'value');
    assert.ok(!('avatar' in two));
    assert.equal(two.group, 'b');
    assert.equal((await get('coalesce')).chat_metadata.nested.value, 'value');
    assert.equal(reads, 1);
});

test('a write during a pending read prevents storing that unstable snapshot', async () => {
    const create = await factory();
    const file = fixture(path.join(root, 'pending-write.jsonl'), 'old');
    const gate = deferred();
    let reads = 0;
    const get = create(async file => {
        reads++;
        const result = await chats.getChatInfo(file);
        if (reads === 1) await gate.promise;
        return result;
    });
    const pending = get(file);
    while (reads === 0) await new Promise(resolve => setImmediate(resolve));
    fixture(file, 'new');
    gate.resolve();
    await pending;
    assert.equal((await get(file)).mes, 'new');
    assert.equal(reads, 2);
});

test('older read completion cannot replace or clear a newer version cache or pending read', async () => {
    const create = await factory();
    for (const finishNewFirst of [false, true]) {
        let current = 1n, reads = 0;
        const gates = [deferred(), deferred()];
        const get = create(async () => { const index = reads++; return gates[index].promise; }, { stat: async () => version(current) });
        const older = get(`version-race-${finishNewFirst}`);
        await turns();
        current = 2n;
        const newer = get(`version-race-${finishNewFirst}`);
        await turns();
        assert.equal(reads, 2);
        if (finishNewFirst) { gates[1].resolve(info('new')); await newer; }
        gates[0].resolve(info('old'));
        assert.equal((await older).mes, 'old');
        const joined = get(`version-race-${finishNewFirst}`);
        await turns();
        assert.equal(reads, 2, 'Old cleanup must preserve the newer pending or cached record');
        if (!finishNewFirst) gates[1].resolve(info('new'));
        assert.equal((await newer).mes, 'new');
        assert.equal((await joined).mes, 'new');
        assert.equal((await get(`version-race-${finishNewFirst}`)).mes, 'new');
    }
});

test('stat/read failures release records and retries do not reuse failed or invalid results', async () => {
    const create = await factory();
    let statFailure = false, readFailure = true, reads = 0;
    const get = create(async () => { reads++; if (readFailure) throw new Error('read failure'); return info(); }, {
        stat: async () => { if (statFailure) throw new Error('stat failure'); return version(); },
    });
    await assert.rejects(get('failure'), /read failure/);
    readFailure = false;
    await get('failure');
    statFailure = true;
    await assert.rejects(get('failure'), /stat failure/);
    statFailure = false;
    await get('failure');
    assert.equal(reads, 3);
    for (const invalid of [{}, null, undefined, [], { mes: 'malformed' }]) {
        let attempts = 0;
        const getter = create(async () => { attempts++; return invalid; }, { stat: async () => version() });
        assert.deepEqual(await getter('invalid'), invalid);
        assert.deepEqual(await getter('invalid'), invalid);
        assert.equal(attempts, 2);
    }
    let postStats = 0, successfulReads = 0;
    const postFailure = create(async () => { successfulReads++; return info(); }, {
        stat: async () => { if (++postStats === 2) throw new Error('post stat failure'); return version(); },
    });
    await assert.rejects(postFailure('post-failure'), /post stat failure/);
    await postFailure('post-failure');
    assert.equal(successfulReads, 2);
});

test('older rejected operations cannot erase newer pending entries', async () => {
    const create = await factory();
    let current = 1n, reads = 0;
    const old = deferred(), fresh = deferred();
    const get = create(async () => (++reads === 1 ? old.promise : fresh.promise), { stat: async () => version(current) });
    const first = get('reject-race');
    const rejected = assert.rejects(first, /old failure/);
    await turns();
    current = 2n;
    const second = get('reject-race');
    await turns();
    old.reject(new Error('old failure'));
    await rejected;
    const third = get('reject-race');
    await turns();
    assert.equal(reads, 2);
    fresh.resolve(info('new'));
    assert.equal((await second).mes, 'new');
    assert.equal((await third).mes, 'new');
});

test('entry limit uses LRU and TTL is absolute rather than sliding', async () => {
    const create = await factory();
    let clock = 0;
    const counts = new Map();
    const get = create(async file => { counts.set(file, (counts.get(file) || 0) + 1); return info(); }, {
        stat: async () => version(), now: () => clock, maxEntries: 2, ttlMs: 10,
    });
    await get('a'); await get('b'); await get('a'); await get('c'); await get('a'); await get('b');
    assert.equal(counts.get(path.resolve('a')), 1);
    assert.equal(counts.get(path.resolve('b')), 2);
    clock = 9;
    await get('b');
    clock = 10;
    await get('b');
    assert.equal(counts.get(path.resolve('b')), 3);
});

test('estimated byte budget evicts entries and oversized results return fully without retention', async () => {
    const create = await factory();
    let reads = 0;
    const large = info('x'.repeat(1200));
    const get = create(async () => { reads++; return large; }, {
        stat: async () => version(), maxBytes: 10000, maxEntryBytes: 10000,
    });
    await get('weight-a'); await get('weight-a');
    assert.equal(reads, 1, 'One entry fits and must be retained');
    await get('weight-b'); await get('weight-b');
    assert.equal(reads, 2, 'The new entry fits and must be retained');
    await get('weight-a');
    assert.equal(reads, 3, 'Conservative UTF-16 and JSON estimates cannot retain both entries');
    let oversizedReads = 0;
    const oversized = create(async () => { oversizedReads++; return large; }, { stat: async () => version(), maxEntryBytes: 100 });
    assert.deepEqual(await oversized('oversized'), large);
    assert.deepEqual(await oversized('oversized'), large);
    assert.equal(oversizedReads, 2);
});

test('pending entry capacity falls back to uncached reads without breaking existing coalescing', async () => {
    const create = await factory();
    const gate = deferred();
    let aReads = 0, bReads = 0;
    const get = create(async file => {
        if (file === path.resolve('bounded-a')) { aReads++; await gate.promise; }
        else bReads++;
        return info();
    }, { stat: async () => version(), maxPending: 1 });
    const a = get('bounded-a');
    await turns();
    await Promise.all([get('bounded-b'), get('bounded-b')]);
    assert.equal(bReads, 2, 'Capacity fallback must remain uncached');
    const joined = get('bounded-a');
    await turns();
    assert.equal(aReads, 1);
    gate.resolve();
    await Promise.all([a, joined]);
    await get('bounded-b'); await get('bounded-b');
    assert.equal(bReads, 3, 'Pending capacity is released when readers settle');
});

test('empty file info retains the existing reader semantics and is cacheable', async () => {
    const create = await factory();
    const file = path.join(root, 'empty.jsonl');
    fs.writeFileSync(file, '');
    let reads = 0;
    const get = create(async file => { reads++; return chats.getChatInfo(file); });
    const expected = await chats.getChatInfo(file);
    assert.deepEqual(await get(file), expected);
    assert.deepEqual(await get(file), expected);
    assert.equal(reads, 1);
});

test('estimated entry weight includes nested object overhead beyond serialized characters', async () => {
    const create = await factory();
    const result = info('small');
    result.chat_metadata = { objects: Array.from({ length: 20 }, () => ({})) };
    let reads = 0;
    const get = create(async () => { reads++; return result; }, { stat: async () => version(), maxEntryBytes: 1500 });
    assert.deepEqual(await get('nested-weight'), result);
    assert.deepEqual(await get('nested-weight'), result);
    assert.equal(reads, 2, 'Many tiny nested objects must count toward the retained byte estimate');
});

test('a delayed older initial stat cannot displace a newer version pending read', async () => {
    const create = await factory();
    const oldStat = deferred(), readGate = deferred();
    let stats = 0, reads = 0;
    const get = create(async () => { reads++; return readGate.promise; }, {
        stat: async () => (++stats === 1 ? oldStat.promise : version(2n)),
    });
    const older = get('stat-race');
    const newer = get('stat-race');
    await turns();
    assert.equal(reads, 1);
    oldStat.resolve(version(1n));
    await turns();
    assert.equal(reads, 1);
    readGate.resolve(info('new'));
    assert.equal((await older).mes, 'new');
    assert.equal((await newer).mes, 'new');
    assert.equal((await get('stat-race')).mes, 'new');
    assert.equal(reads, 1);
});

test('a delayed older stat failure cannot clear a newer successful cache entry', async () => {
    const create = await factory();
    const oldStat = deferred();
    let stats = 0, reads = 0;
    const get = create(async () => { reads++; return info('new'); }, {
        stat: async () => (++stats === 1 ? oldStat.promise : version(2n)),
    });
    const older = assert.rejects(get('failed-stat-race'), /old stat failure/);
    await get('failed-stat-race');
    oldStat.reject(new Error('old stat failure'));
    await older;
    assert.equal((await get('failed-stat-race')).mes, 'new');
    assert.equal(reads, 1);
});

test('every identity component including single nanosecond changes invalidates cached info', async () => {
    const create = await factory();
    let current = version(), reads = 0;
    const get = create(async () => { reads++; return info(); }, { stat: async () => current });
    await get('stat-fields');
    for (const field of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) {
        current = { ...current, [field]: current[field] + 1n };
        await get('stat-fields');
        await get('stat-fields');
    }
    assert.equal(reads, 6);
});

test('invalid empty responses ignore annotations and oversized snapshots remain independent', async () => {
    const create = await factory();
    const invalid = create(async () => ({}), { stat: async () => version() });
    assert.deepEqual(await invalid('invalid-annotations', { avatar: 'ignored' }), {});
    const original = info('full');
    const oversized = create(async () => original, { stat: async () => version(), maxEntryBytes: 0 });
    const first = await oversized('clone-oversized', { group: 'one' });
    first.chat_metadata.nested.value = 'mutated';
    const second = await oversized('clone-oversized', { avatar: 'two' });
    assert.equal(second.chat_metadata.nested.value, 'full');
    assert.ok(!('group' in second));
    assert.equal(original.chat_metadata.nested.value, 'full');
});
