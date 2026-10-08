import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test, { after } from 'node:test';
import express from 'express';

// Retain fresh artificial fixtures for inspection; never clean up user data.
const root = path.resolve('.fixtures', `file-safety-${randomUUID()}`);
fs.mkdirSync(root, { recursive: true });
globalThis.DATA_ROOT = root;
const config = path.join(root, 'config.yaml');
fs.writeFileSync(config, 'backups:\n  chat:\n    enabled: false\n    checkIntegrity: true\nlogging:\n  minLogLevel: 3\nperformance:\n  useDiskCache: false\n');
const util = await import('../src/util.js');
util.setConfigFilePath(config);
const chats = await import('../src/endpoints/chats.js');
const { createTextMatcher } = await import('../src/chat-search.js');
const dirs = Object.fromEntries(['chats', 'groupChats', 'groups', 'backups', 'characters'].map(key => [key, path.join(root, key)]));
for (const directory of Object.values(dirs)) fs.mkdirSync(directory, { recursive: true });
fs.mkdirSync(path.join(dirs.chats, 'Synthetic'));
fs.writeFileSync(path.join(dirs.characters, 'Synthetic.png'), 'artificial discovery marker');
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
    req.user = { profile: { handle: 'file-safety-artificial' }, directories: dirs };
    next();
});
app.use('/api/chats', chats.router);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/api/chats`;
after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));

async function post(endpoint, body) {
    const response = await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
}
const header = integrity => ({ user_name: 'unused', chat_metadata: { ...(integrity ? { integrity } : {}), nested: { tag: 'artificial' } } });
const message = mes => ({ name: 'Synthetic', mes, send_date: '2026-01-01' });
const rows = (integrity = 'expected') => [header(integrity), message('replacement artificial message')];
const jsonl = data => data.map(row => JSON.stringify(row)).join('\n');
function fixture(name, contents, group = false) {
    const file = path.join(group ? dirs.groupChats : path.join(dirs.chats, 'Synthetic'), `${name}.jsonl`);
    if (contents !== undefined) fs.writeFileSync(file, contents);
    return file;
}
const save = (name, group, extra = {}) => post(group ? '/group/save' : '/save', {
    ...(group ? { id: name } : { avatar_url: 'Synthetic.png', file_name: name }), chat: rows(), ...extra,
});

const headerCases = [
    ['missing file', undefined, true],
    ['empty file', '', true],
    ['legacy object', '{"user_name":"old"}\noriginal preserved message', true],
    ['matching slug', jsonl(rows()), true],
    ['BOM matching slug', '\uFEFF' + jsonl(rows()), true],
    ['mismatched slug', jsonl(rows('different')), false],
    ['BOM mismatched slug', '\uFEFF' + jsonl(rows('different')), false],
    ['invalid JSON', '{"chat_metadata":\noriginal preserved message', false],
    ['null header', 'null\noriginal preserved message', false],
    ['array header', '[]\noriginal preserved message', false],
    ['string header', '"legacy"\noriginal preserved message', false],
    ['number header', '42\noriginal preserved message', false],
    ['boolean header', 'true\noriginal preserved message', false],
    ['blank first line of nonempty file', '\noriginal preserved message', false],
    ['whitespace-only nonempty file', ' \t\r\n', false],
];
for (const group of [false, true]) {
    for (const [label, contents, writable] of headerCases) {
        test(`${group ? 'group' : 'character'} save ${writable ? 'allows' : 'rejects'} ${label} without losing rejected bytes`, async () => {
            const name = `${group ? 'group' : 'character'}-${label.replaceAll(' ', '-')}`;
            const file = fixture(name, contents, group);
            const before = contents === undefined ? undefined : await fs.promises.readFile(file);
            const result = await save(name, group);
            assert.equal(result.status, writable ? 200 : 400);
            if (writable) {
                assert.deepEqual(result.data, { ok: true });
                assert.equal(await fs.promises.readFile(file, 'utf8'), jsonl(rows()));
            } else {
                assert.deepEqual(result.data, { error: 'integrity' });
                assert.deepEqual(await fs.promises.readFile(file), before);
            }
        });
    }
    for (const mode of ['force', 'no-slug']) {
        for (const [label, contents] of [['malformed', '{not json\noriginal'], ['mismatch', jsonl(rows('different'))]]) {
            test(`${group ? 'group' : 'character'} ${mode} save retains explicit overwrite semantics for ${label}`, async () => {
                const name = `${group ? 'group' : 'character'}-${mode}-${label}`;
                const file = fixture(name, contents, group);
                const incoming = mode === 'no-slug' ? rows(null) : rows();
                const result = await save(name, group, { chat: incoming, ...(mode === 'force' ? { force: true } : {}) });
                assert.equal(result.status, 200);
                assert.equal(await fs.promises.readFile(file, 'utf8'), jsonl(incoming));
            });
        }
    }
}

for (const tail of ['{"name":', 'null', '[]', '42', '{"unexpected":"field"}']) {
    test(`degraded preview retains identity/stat/metadata and excludes unreadable nonblank tail ${tail}`, async () => {
        const name = `preview-${randomUUID()}`;
        const contents = jsonl([header('expected'), message('alpha'), message('beta')]) + `\n\n${tail}\n \t\n`;
        const file = fixture(name, contents);
        const stats = await fs.promises.stat(file);
        const info = await chats.getChatInfo(file, { avatar: 'Synthetic.png' }, true, createTextMatcher(['alpha', 'beta']));
        assert.equal(info.file_id, name);
        assert.equal(info.file_name, `${name}.jsonl`);
        assert.equal(info.file_size, util.formatBytes(stats.size));
        assert.equal(info.last_mes, stats.mtimeMs);
        assert.equal(info.chat_items, 2, 'Blank rows are ignored; metadata and unreadable tail are excluded');
        assert.equal(info.mes, '[The message is empty]');
        assert.equal(info.match, true);
        assert.deepEqual(info.chat_metadata, header('expected').chat_metadata);
        assert.equal(info.avatar, 'Synthetic.png');
        assert.equal(await fs.promises.readFile(file, 'utf8'), contents, 'Preview does not repair or rewrite history');
        const unmatched = await chats.getChatInfo(file, {}, false, createTextMatcher(['missing']));
        assert.equal(unmatched.match, false);
        assert.ok(!('chat_metadata' in unmatched));
        const arrayMatch = await chats.getChatInfo(file, {}, false, texts => texts.includes('alpha') && texts.includes('beta'));
        assert.equal(arrayMatch.match, true, 'Array callbacks remain compatible');
    });
}

test('unreadable single-row history produces a safe zero-count degraded preview', async () => {
    const file = fixture('single-truncated', '{"name":');
    const info = await chats.getChatInfo(file);
    assert.equal(info.file_name, 'single-truncated.jsonl');
    assert.equal(info.chat_items, 0);
    assert.equal(info.match, true);
    assert.equal(info.mes, '[The message is empty]');
});

test('real search includes degraded character and group histories only when complete rows or filename match', async () => {
    const name = 'search-truncated-unique';
    const groupName = 'group-search-truncated-unique';
    const contents = jsonl([header('expected'), message('firstneedle'), message('secondneedle')]) + '\n{"mes":"tailneedle';
    const file = fixture(name, contents);
    const groupFile = fixture(groupName, contents, true);
    fs.writeFileSync(path.join(dirs.groups, 'search-group.json'), JSON.stringify({ id: 'search-group', chats: [groupName] }));
    for (const body of [{ avatar_url: 'Synthetic.png' }, { group_id: 'search-group' }]) {
        const expectedName = body.group_id ? groupName : name;
        const hit = await post('/search', { ...body, query: 'firstneedle secondneedle' });
        assert.equal(hit.status, 200);
        assert.deepEqual(hit.data.map(item => item.file_name), [expectedName]);
        assert.equal(hit.data[0].message_count, 2);
        assert.equal(hit.data[0].preview_message, '[The message is empty]');
        const missed = await post('/search', { ...body, query: 'tailneedle' });
        assert.deepEqual(missed.data, [], 'An unreadable tail cannot provide a text match');
        const byName = await post('/search', { ...body, query: expectedName });
        assert.deepEqual(byName.data.map(item => item.file_name), [expectedName]);
        const all = await post('/search', { ...body, query: '' });
        assert.ok(all.data.some(item => item.file_name === expectedName));
    }
    assert.equal(await fs.promises.readFile(file, 'utf8'), contents);
    assert.equal(await fs.promises.readFile(groupFile, 'utf8'), contents);
});

test('real recent caches degraded metadata previews and invalidates changed bad-tail versions', async () => {
    const name = 'recent-version-truncated';
    const contents = jsonl([header('expected'), message('alpha'), message('beta')]) + '\n{"name":';
    const file = fixture(name, contents);
    fs.utimesSync(file, 100, 100);
    const pinned = [{ avatar: 'Synthetic.png', file_name: `${name}.jsonl` }];
    const body = { max: 0, pinned, metadata: true };
    const stats = await fs.promises.stat(file);
    const expected = {
        match: true, file_id: name, file_name: `${name}.jsonl`, file_size: util.formatBytes(stats.size),
        chat_items: 2, mes: '[The message is empty]', last_mes: stats.mtimeMs,
        avatar: 'Synthetic.png', chat_metadata: header('expected').chat_metadata,
    };
    let streams = 0;
    const original = fs.createReadStream;
    fs.createReadStream = (target, ...args) => {
        if (path.resolve(String(target)) === file) streams++;
        return original(target, ...args);
    };
    try {
        const first = await post('/recent', body);
        assert.equal(first.status, 200);
        assert.deepEqual(first.data, [expected]);
        assert.equal(streams, 1);
        assert.deepEqual((await post('/recent', body)).data, [expected]);
        assert.equal(streams, 1, 'Unchanged degraded info is cacheable');
        const plain = await post('/recent', { ...body, metadata: false });
        assert.equal(plain.data[0].file_name, `${name}.jsonl`);
        assert.ok(!('chat_metadata' in plain.data[0]));
        assert.equal(streams, 2, 'Metadata modes remain isolated');
        const before = await fs.promises.stat(file, { bigint: true });
        const originalTimes = await fs.promises.stat(file);
        const revised = contents.replace('artificial', 'revisionxx');
        fs.writeFileSync(file, revised);
        fs.utimesSync(file, originalTimes.atime, originalTimes.mtime);
        const changed = await fs.promises.stat(file, { bigint: true });
        assert.equal(changed.size, before.size);
        assert.equal(changed.mtimeNs, before.mtimeNs);
        assert.notEqual(changed.ctimeNs, before.ctimeNs);
        const second = await post('/recent', body);
        assert.equal(second.data[0].chat_items, 2);
        assert.equal(second.data[0].chat_metadata.nested.tag, 'revisionxx');
        assert.equal(second.data[0].mes, '[The message is empty]');
        assert.equal(streams, 3);
        assert.deepEqual((await post('/recent', body)).data, second.data);
        assert.equal(streams, 3);
        fs.writeFileSync(file, revised + '\n{"name":');
        const third = await post('/recent', body);
        assert.equal(third.data[0].chat_items, 3, 'Current nonblank counting still excludes only the metadata and final unreadable row');
        assert.equal(streams, 4);
    } finally { fs.createReadStream = original; }
});
