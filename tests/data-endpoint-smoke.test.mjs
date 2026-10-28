import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { inspect } from 'node:util';
import test, { after } from 'node:test';
import express from 'express';
import { zipSync, strToU8 } from 'fflate';
import { init as initPngDecoder } from '@jsquash/png/decode.js';
import { init as initPngEncoder } from '@jsquash/png/encode.js';

// Node fetch cannot load file: URLs; initialize the real codec from its installed bytes.
const pngWasm = fs.readFileSync(new URL('../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm', import.meta.url));
await initPngDecoder(pngWasm);
await initPngEncoder(pngWasm);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-endpoint-smoke-'));
globalThis.DATA_ROOT = root;
const config = path.join(root, 'config.yaml');
fs.writeFileSync(config, 'backups:\n  chat:\n    enabled: true\n    throttleInterval: 10000\nperformance:\n  useDiskCache: false\ncacheBuster:\n  enabled: false\n');
const util = await import('../src/util.js');
util.setConfigFilePath(config);
const chats = await import('../src/endpoints/chats.js');
const characters = await import('../src/endpoints/characters.js');
const groups = await import('../src/endpoints/groups.js');
const backups = await import('../src/endpoints/backups.js');
const dirs = Object.fromEntries(['chats', 'groupChats', 'groups', 'backups', 'characters', 'thumbnailsAvatar', 'uploads', 'userImages'].map(key => [key, path.join(root, key)]));
for (const directory of Object.values(dirs)) fs.mkdirSync(directory);
dirs.root = root;
const routers = { chats, characters, groups, backups };
const app = express();
app.use(express.json());
// Same synthetic user/upload seam as chat-lifecycle.test.mjs; route middleware still runs.
app.use((req, _res, next) => {
    req.user = { profile: { handle: 'smoke-artificial' }, directories: dirs };
    if (req.body?._upload) req.file = { destination: dirs.uploads, filename: req.body._upload };
    next();
});
for (const [name, module] of Object.entries(routers)) app.use(`/api/${name}`, module.router);
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(inspect(args)); originalError(...args); };
app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).send(String(error));
});
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
    try {
        await chats.flushChatBackups(AbortSignal.timeout(5000));
        assert.doesNotMatch(errors.join('\n'), /LockOrderError|Nested path lock/);
    } finally {
        console.error = originalError;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
});
const covered = new Set();
async function post(route, body) {
    const response = await fetch(base + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const text = await response.text();
    assert.doesNotMatch(text, /LockOrderError|Nested path lock/, route);
    assert.ok(response.status < 500, `${route}: ${response.status} ${text}`);
    assert.equal(response.status, 200, `${route}: ${text}`);
    covered.add(route);
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    assert.ok(!data?.error, `${route}: ${text}`);
    assert.doesNotMatch(errors.join('\n'), /LockOrderError|Nested path lock/, route);
    return data;
}
function upload(name, data) {
    fs.writeFileSync(path.join(dirs.uploads, name), data);
    return name;
}
const rows = [{ chat_metadata: {}, user_name: 'User', character_name: 'Smoke' }, { name: 'Smoke', mes: 'hello', is_user: false }];
const jsonl = rows.map(row => JSON.stringify(row)).join('\n');

test('all data-writing routes publish valid minimal requests without nested new lock keys', async t => {
    await t.test('character create, edits, single/bulk/all merge, duplicate and imports', async () => {
        assert.equal(await post('characters/create', { ch_name: 'Smoke', file_name: 'Smoke' }), 'Smoke.png');
        const avatar = fs.readFileSync(path.join(dirs.characters, 'Smoke.png'));
        const body = { avatar_url: 'Smoke.png', ch_name: 'Smoke', description: 'edited' };
        await post('characters/edit', body);
        await post('characters/edit-avatar', { ...body, _upload: upload('avatar.png', avatar) });
        await post('characters/edit-attribute', { ...body, field: 'description', value: 'attribute' });
        await post('characters/merge-attributes', { avatar: 'Smoke.png', data: { description: 'single' } });
        const duplicate = await post('characters/duplicate', { avatar_url: 'Smoke.png' });
        assert.ok(fs.existsSync(path.join(dirs.characters, duplicate.path)));
        for (const avatars of [['Smoke.png', duplicate.path], []]) {
            const result = await post('characters/merge-attributes', { avatars, data: { data: { description: 'bulk' } } });
            assert.deepEqual(result.failed, []);
            assert.equal(result.updated.length, 2);
        }
        for (const preserved_name of [undefined, 'Reimport.png', 'Reimport.png']) {
            const result = await post('characters/import', { file_type: 'json', preserved_name, _upload: upload('card.json', JSON.stringify({ name: 'Imported', description: 'minimal' })) });
            assert.ok(fs.existsSync(path.join(dirs.characters, `${result.file_name}.png`)));
        }
        const byaf = zipSync({
            'manifest.json': strToU8(JSON.stringify({ characters: ['character.json'], scenarios: ['scenario.json'] })),
            'character.json': strToU8(JSON.stringify({ displayName: 'ByafSmoke' })),
            'scenario.json': strToU8(JSON.stringify({ title: 'Scenario', firstMessages: [{ text: 'Hello' }], messages: [] })),
        });
        const imported = await post('characters/import', { file_type: 'byaf', user_name: 'User', _upload: upload('card.byaf', byaf) });
        assert.equal(fs.readdirSync(path.join(dirs.chats, imported.file_name)).filter(name => name.endsWith('.jsonl')).length, 1);
    });
    await t.test('ordinary chat save/get/rename/delete and single/batch import', async () => {
        await post('chats/save', { avatar_url: 'Smoke.png', file_name: 'original', chat: rows });
        await post('chats/get', { avatar_url: 'Smoke.png', file_name: 'original' });
        await post('chats/rename', { avatar_url: 'Smoke.png', original_file: 'original.jsonl', renamed_file: 'renamed.jsonl' });
        await post('chats/delete', { avatar_url: 'Smoke.png', chatfile: 'renamed.jsonl' });
        const single = await post('chats/import', { avatar_url: 'Smoke.png', file_type: 'jsonl', _upload: upload('chat.jsonl', jsonl) });
        assert.equal(single.fileNames.length, 1);
        const batch = await post('chats/import', { avatar_url: 'Smoke.png', file_type: 'json', _upload: upload('batch.json', JSON.stringify({ histories: { histories: [{ msgs: [] }, { msgs: [] }] } })) });
        assert.equal(batch.fileNames.length, 2);
        for (const name of [...single.fileNames, ...batch.fileNames]) assert.ok(fs.existsSync(path.join(dirs.chats, 'Smoke', name)));
    });
    await t.test('group metadata and histories, including rename and group deletion with histories', async () => {
        fs.rmdirSync(dirs.groups);
        assert.deepEqual(await post('groups/all', {}), []);
        const group = await post('groups/create', { name: 'Group', chat_id: 'group-smoke', chats: ['group-smoke', 'missing-history'] });
        await post('groups/edit', { ...group, name: 'Edited Group' });
        await post('chats/group/save', { id: 'group-smoke', chat: rows });
        await post('chats/group/get', { id: 'group-smoke' });
        await post('chats/group/info', { id: 'group-smoke' });
        await post('chats/rename', { is_group: true, original_file: 'group-smoke.jsonl', renamed_file: 'group-renamed.jsonl' });
        await post('chats/group/delete', { id: 'group-renamed' });
        await post('chats/group/save', { id: 'group-smoke-delete', chat: rows });
        await post('groups/edit', { ...group, chats: ['group-smoke-delete', 'missing-history'] });
        const imported = await post('chats/group/import', { _upload: upload('group.jsonl', jsonl) });
        assert.ok(fs.existsSync(path.join(dirs.groupChats, `${imported.res}.jsonl`)));
        await post('groups/delete', { id: group.id });
        assert.equal(fs.existsSync(path.join(dirs.groupChats, 'group-smoke-delete.jsonl')), false);
    });
    await t.test('scheduled leading/trailing backups and backup delete', async () => {
        for (let i = 0; i < 3; i++) {
            const chat = [rows[0], { ...rows[1], mes: `backup-snapshot-${i}` }];
            await post('chats/save', { avatar_url: 'Smoke.png', file_name: 'backup', chat });
        }
        await chats.flushChatBackups(AbortSignal.timeout(5000));
        const names = fs.readdirSync(dirs.backups).filter(name => name.startsWith(chats.CHAT_BACKUPS_PREFIX) && name.endsWith('.jsonl'));
        const snapshots = names.map(name => fs.readFileSync(path.join(dirs.backups, name), 'utf8'));
        assert.ok(snapshots.some(data => data.includes('backup-snapshot-0')), 'leading backup published');
        assert.ok(snapshots.some(data => data.includes('backup-snapshot-2')), 'latest trailing backup published');
        await post('backups/chat/delete', { name: names[0] });
        assert.equal(fs.existsSync(path.join(dirs.backups, names[0])), false);
    });
    await t.test('character rename with chat histories and delete with histories', async () => {
        const renamed = await post('characters/rename', { avatar_url: 'Smoke.png', new_name: 'Renamed' });
        await post('characters/delete', { avatar_url: renamed.avatar, delete_chats: true });
        assert.equal(fs.existsSync(path.join(dirs.characters, renamed.avatar)), false);
        assert.equal(fs.existsSync(path.join(dirs.chats, 'Renamed')), false);
    });
    // Guard new routes: every POST must be either exercised or explicitly classified read-only.
    const readOnly = { chats: ['/export', '/search', '/recent'], characters: ['/all', '/get', '/chats', '/export'], groups: [], backups: ['/chat/get', '/chat/download'] };
    for (const [name, module] of Object.entries(routers)) {
        for (const layer of module.router.stack.filter(layer => layer.route?.methods.post)) {
            const route = layer.route.path;
            assert.ok(covered.has(name + route) || readOnly[name].includes(route), `Unclassified POST: ${name}${route}`);
        }
    }
});
