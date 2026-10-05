import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test, { after } from 'node:test';
import express from 'express';

// Every run creates fresh artificial data. Fixtures and recovery copies are retained.
const root = path.resolve('.fixtures', `lifecycle-${crypto.randomUUID()}`);
fs.mkdirSync(root, { recursive: true });
globalThis.DATA_ROOT = root;
const config = path.join(root, 'config.yaml');
fs.writeFileSync(config, 'backups:\n  chat:\n    enabled: false\n    checkIntegrity: true\nlogging:\n  minLogLevel: 3\nperformance:\n  useDiskCache: false\n');
const util = await import('../src/util.js');
util.setConfigFilePath(config);
const chats = await import('../src/endpoints/chats.js');
const groups = await import('../src/endpoints/groups.js');
const characters = await import('../src/endpoints/characters.js');
const cardParser = await import('../src/character-card-parser.js');
const io = await import('../src/chat-io.js');
const dirs = Object.fromEntries(['chats', 'groupChats', 'groups', 'backups', 'characters', 'thumbnailsAvatar', 'uploads'].map(key => [key, path.join(root, key)]));
for (const directory of Object.values(dirs)) fs.mkdirSync(directory, { recursive: true });
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
    req.user = { profile: { handle: 'lifecycle-artificial' }, directories: dirs };
    if (req.body?._upload) req.file = { destination: dirs.uploads, filename: req.body._upload };
    next();
});
app.use('/api/chats', chats.router);
app.use('/api/groups', groups.router);
app.use('/api/characters', characters.router);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));

const rows = text => [{ chat_metadata: { integrity: 'artificial-integrity' }, user_name: 'unused' }, { name: 'Synthetic', mes: text }];
const jsonl = text => rows(text).map(row => JSON.stringify(row)).join('\n');
function file(name, text = 'original', card = 'Synthetic') {
    const directory = path.join(dirs.chats, card);
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, `${name}.jsonl`);
    fs.writeFileSync(target, jsonl(text));
    return target;
}
async function post(endpoint, body) {
    const response = await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
}
const save = (name, text, extra = {}) => post('/api/chats/save', { avatar_url: 'Synthetic.png', file_name: name, chat: rows(text), ...extra });
const rename = (source, target, extra = {}) => post('/api/chats/rename', { avatar_url: 'Synthetic.png', original_file: `${source}.jsonl`, renamed_file: `${target}.jsonl`, ...extra });
const remove = name => post('/api/chats/delete', { avatar_url: 'Synthetic.png', chatfile: `${name}.jsonl` });
function pauseAtomicSave(target) {
    const original = fs.rename;
    let unblock; let entered;
    const gate = new Promise(resolve => { unblock = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    fs.rename = (source, destination, ...rest) => {
        if (path.resolve(destination) === target) {
            entered();
            gate.then(() => original(source, destination, ...rest));
            return;
        }
        return original(source, destination, ...rest);
    };
    return { started, unblock, restore: () => { fs.rename = original; } };
}
async function retained(directory, needle) {
    const found = [];
    if (!fs.existsSync(directory)) return found;
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) found.push(...await retained(target, needle));
        else if (entry.isFile() && (await fs.promises.readFile(target, 'utf8')).includes(needle)) found.push(target);
    }
    return found;
}

test('rename waits for an in-flight save, then rejects late saves at the retired name', async () => {
    const source = file('ordered-source');
    const paused = pauseAtomicSave(source);
    const pending = save('ordered-source', 'newer-before-rename');
    await paused.started;
    const request = rename('ordered-source', 'ordered-target');
    await new Promise(resolve => setTimeout(resolve, 60));
    const waited = fs.existsSync(source);
    paused.unblock();
    try { assert.equal((await pending).status, 200); } finally { paused.restore(); }
    assert.equal(waited, true, 'Rename must wait for the existing writer');
    assert.equal((await request).status, 200);
    assert.match(await fs.promises.readFile(path.join(path.dirname(source), 'ordered-target.jsonl'), 'utf8'), /newer-before-rename/);
    const late = await save('ordered-source', 'late');
    assert.equal(late.status, 409);
    assert.equal(late.data.error, 'chat_lifecycle');
    assert.equal(late.data.action, 'reload_or_save_as');
    assert.equal(fs.existsSync(source), false);
});

test('force does not revive a renamed or deleted chat', async () => {
    file('force-source');
    assert.equal((await rename('force-source', 'force-target')).status, 200);
    assert.equal((await save('force-source', 'late-force', { force: true })).status, 409);
    file('force-delete');
    assert.equal((await remove('force-delete')).status, 200);
    assert.equal((await save('force-delete', 'late-force', { force: true })).status, 409);
});

test('delete waits for a queued save and retains the completed contents in recovery storage', async () => {
    const source = file('delete-order');
    const paused = pauseAtomicSave(source);
    const pending = save('delete-order', 'delete-retained-final');
    await paused.started;
    const request = remove('delete-order');
    await new Promise(resolve => setTimeout(resolve, 60));
    const waited = fs.existsSync(source);
    paused.unblock(); try { assert.equal((await pending).status, 200); } finally { paused.restore(); }
    assert.equal(waited, true);
    assert.equal((await request).status, 200);
    assert.equal(fs.existsSync(source), false);
    assert.ok((await retained(path.join(dirs.chats, '.recycle'), 'delete-retained-final')).length > 0);
    assert.equal((await save('delete-order', 'late')).status, 409);
});

test('new untombstoned names still save and saved-as data does not alter the renamed target', async () => {
    file('save-as-source', 'rename-original');
    assert.equal((await rename('save-as-source', 'save-as-target')).status, 200);
    assert.equal((await save('fresh-distinct-name', 'late-save-as')).status, 200);
    assert.match(await fs.promises.readFile(path.join(dirs.chats, 'Synthetic', 'save-as-target.jsonl'), 'utf8'), /rename-original/);
});

test('rename never overwrites an existing target and source remains writable', async () => {
    const source = file('occupied-source', 'source-intact');
    const target = file('occupied-target', 'target-intact');
    assert.equal((await rename('occupied-source', 'occupied-target')).status, 409);
    assert.match(await fs.promises.readFile(source, 'utf8'), /source-intact/);
    assert.match(await fs.promises.readFile(target, 'utf8'), /target-intact/);
    assert.equal((await save('occupied-source', 'still-active')).status, 200);
});

test('two concurrent sources competing for one target publish only one complete chat', async () => {
    const a = file('competing-a', 'A-complete');
    const b = file('competing-b', 'B-complete');
    const results = await Promise.all([rename('competing-a', 'competing-target'), rename('competing-b', 'competing-target')]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const contents = await fs.promises.readFile(path.join(path.dirname(a), 'competing-target.jsonl'), 'utf8');
    assert.ok(contents === jsonl('A-complete') || contents === jsonl('B-complete'));
    assert.equal(Number(fs.existsSync(a)) + Number(fs.existsSync(b)), 1);
});

test('reverse multi-path requests settle without deadlock and preserve both occupied files', async () => {
    file('reverse-a', 'reverse A'); file('reverse-b', 'reverse B');
    const results = await Promise.race([Promise.all([rename('reverse-a', 'reverse-b'), rename('reverse-b', 'reverse-a')]), new Promise(resolve => setTimeout(() => resolve('timeout'), 1500))]);
    assert.notEqual(results, 'timeout');
    assert.deepEqual(results.map(r => r.status), [409, 409]);
});

test('retirement is enforced by a fresh process after module state is lost', async () => {
    const source = file('restart-source');
    assert.equal((await rename('restart-source', 'restart-target')).status, 200);
    const script = `globalThis.DATA_ROOT=${JSON.stringify(root)}; const util=await import('./src/util.js'); util.setConfigFilePath(${JSON.stringify(config)}); const {router}=await import('./src/endpoints/chats.js'); const {default:express}=await import('express'); const app=express(); app.use(express.json()); app.use((q,s,n)=>{q.user={profile:{handle:'cold-artificial'},directories:${JSON.stringify(dirs)}};n();}); app.use('/api/chats',router); const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r)); const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/chats/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({avatar_url:'Synthetic.png',file_name:'restart-source',chat:${JSON.stringify(rows('late-after-restart'))},force:true})}); console.log('COLD_RESULT '+response.status+' '+await response.text()); server.closeAllConnections(); await new Promise(r=>server.close(r));`;
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { cwd: path.resolve('.'), timeout: 10000 });
    assert.match(result.stdout, /COLD_RESULT 409/);
    assert.equal(fs.existsSync(source), false);
});

test('CAI multi-history import retains every distinct history with noncolliding names', async () => {
    const name = `cai-${crypto.randomUUID()}.json`;
    fs.writeFileSync(path.join(dirs.uploads, name), JSON.stringify({ histories: { histories: [{ msgs: [{ src: { is_human: true }, text: 'CAI first' }] }, { msgs: [{ src: { is_human: false }, text: 'CAI second' }] }] } }));
    const result = await post('/api/chats/import', { _upload: name, avatar_url: 'Synthetic.png', file_type: 'json', character_name: 'Synthetic', user_name: 'User' });
    assert.equal(result.status, 200); assert.equal(result.data.res, true);
    assert.equal(result.data.fileNames.length, 2); assert.equal(new Set(result.data.fileNames).size, 2);
    const contents = await Promise.all(result.data.fileNames.map(name => fs.promises.readFile(path.join(dirs.chats, 'Synthetic', name), 'utf8')));
    assert.match(contents[0], /CAI first/); assert.match(contents[1], /CAI second/);
    assert.ok((await retained(path.join(dirs.uploads, '.recycle'), 'CAI first')).length > 0);
});

test('invalid JSON import fails without destroying the original upload', async () => {
    const name = `invalid-${crypto.randomUUID()}.json`; const upload = path.join(dirs.uploads, name);
    fs.writeFileSync(upload, '{this is deliberately not JSON');
    const result = await post('/api/chats/import', { _upload: name, avatar_url: 'Synthetic.png', file_type: 'json', character_name: 'Synthetic', user_name: 'User' });
    assert.ok(result.status >= 400);
    assert.equal(await fs.promises.readFile(upload, 'utf8'), '{this is deliberately not JSON');
});

test('unsupported import format settles with an error and retains the upload', async () => {
    const name = `unsupported-${crypto.randomUUID()}.txt`; const upload = path.join(dirs.uploads, name);
    fs.writeFileSync(upload, 'unsupported artificial data');
    const result = await Promise.race([post('/api/chats/import', { _upload: name, avatar_url: 'Synthetic.png', file_type: 'txt', character_name: 'Synthetic', user_name: 'User' }), new Promise(resolve => setTimeout(() => resolve('timeout'), 1000))]);
    assert.notEqual(result, 'timeout'); assert.equal(result.status, 400);
    assert.equal(fs.existsSync(upload), true);
});

test('concurrent group imports do not replace each other and retain uploads recoverably', async () => {
    const names = [0, 1].map(i => `group-${i}-${crypto.randomUUID()}.jsonl`);
    names.forEach((name, i) => fs.writeFileSync(path.join(dirs.uploads, name), jsonl(`group import ${i}`)));
    const result = await Promise.all(names.map(_upload => post('/api/chats/group/import', { _upload })));
    assert.deepEqual(result.map(r => r.status), [200, 200]);
    assert.equal(new Set(result.map(r => r.data.res)).size, 2);
    for (let i = 0; i < result.length; i++) assert.match(await fs.promises.readFile(path.join(dirs.groupChats, `${result[i].data.res}.jsonl`), 'utf8'), new RegExp(`group import ${i}`));
    assert.ok((await retained(path.join(dirs.uploads, '.recycle'), 'group import 0')).length > 0);
});

test('deleting an entire group retires its chats and metadata against late writers', async () => {
    const id = 'whole-group-artificial'; const chatId = 'whole-group-chat';
    fs.writeFileSync(path.join(dirs.groupChats, `${chatId}.jsonl`), jsonl('whole group retained'));
    fs.writeFileSync(path.join(dirs.groups, `${id}.json`), JSON.stringify({ id, chats: [chatId] }));
    assert.equal((await post('/api/groups/delete', { id })).status, 200);
    assert.equal((await post('/api/chats/group/save', { id: chatId, chat: rows('late'), force: true })).status, 409);
    assert.equal((await post('/api/groups/edit', { id, chats: [chatId] })).status, 409);
    assert.ok((await retained(path.join(dirs.groupChats, '.recycle'), 'whole group retained')).length > 0);
    assert.ok((await retained(path.join(dirs.groups, '.recycle'), id)).length > 0);
});

test('Windows case aliases refer to the same retired path', { skip: process.platform !== 'win32' }, async () => {
    file('CASE-source');
    assert.equal((await rename('CASE-source', 'CASE-target')).status, 200);
    assert.equal((await save('case-SOURCE', 'case-late')).status, 409);
});

test('marker creation failure leaves the rename source active and removes the published candidate recoverably', async () => {
    const source = file('marker-failure', 'marker-original');
    const original = fs.rename;
    fs.rename = (a, b, ...rest) => {
        if (String(b).includes('.chat-lifecycle')) return rest.at(-1)(Object.assign(new Error('artificial marker failure'), { code: 'EIO' }));
        return original(a, b, ...rest);
    };
    try { assert.equal((await rename('marker-failure', 'marker-failed-target')).status, 500); }
    finally { fs.rename = original; }
    assert.match(await fs.promises.readFile(source, 'utf8'), /marker-original/);
    assert.equal(fs.existsSync(path.join(path.dirname(source), 'marker-failed-target.jsonl')), false);
    assert.equal((await save('marker-failure', 'still-active-after-marker-failure')).status, 200);
});

test('a failed source recycle rolls back this rename marker and candidate without sealing the original path', async () => {
    const source = file('recycle-failure', 'recycle-original');
    const original = fs.promises.rename;
    fs.promises.rename = async (a, b) => {
        if (path.resolve(a) === source) throw Object.assign(new Error('artificial source move failure'), { code: 'EIO' });
        return original(a, b);
    };
    try { assert.equal((await rename('recycle-failure', 'recycle-failed-target')).status, 500); }
    finally { fs.promises.rename = original; }
    assert.match(await fs.promises.readFile(source, 'utf8'), /recycle-original/);
    assert.equal(fs.existsSync(path.join(path.dirname(source), 'recycle-failed-target.jsonl')), false);
    assert.equal((await save('recycle-failure', 'active-after-recycle-failure')).status, 200);
});

test('a failed deletion move rolls back only its own marker and allows a subsequent save', async () => {
    const source = file('delete-failure', 'delete-original');
    const original = fs.promises.rename;
    fs.promises.rename = async (a, b) => {
        if (path.resolve(a) === source) throw Object.assign(new Error('artificial deletion failure'), { code: 'EIO' });
        return original(a, b);
    };
    try { assert.equal((await remove('delete-failure')).status, 500); }
    finally { fs.promises.rename = original; }
    assert.match(await fs.promises.readFile(source, 'utf8'), /delete-original/);
    assert.equal((await save('delete-failure', 'active-after-delete-failure')).status, 200);
});

test('a partially published import is recycled and its original upload remains available', async () => {
    const name = `partial-${crypto.randomUUID()}.json`; const upload = path.join(dirs.uploads, name);
    fs.writeFileSync(upload, JSON.stringify({ histories: { histories: [{ msgs: [{ src: { is_human: true }, text: 'partial first' }] }, { msgs: [{ src: { is_human: false }, text: 'partial second' }] }] } }));
    const original = fs.promises.link;
    let count = 0;
    fs.promises.link = async (a, b) => {
        if (path.basename(b).startsWith('PartialFailure') && ++count === 2) throw Object.assign(new Error('artificial second publication failure'), { code: 'EIO' });
        return original(a, b);
    };
    try {
        const result = await post('/api/chats/import', { _upload: name, avatar_url: 'Synthetic.png', file_type: 'json', character_name: 'PartialFailure', user_name: 'User' });
        assert.equal(result.status, 400);
    } finally { fs.promises.link = original; }
    assert.equal(fs.existsSync(upload), true);
    assert.equal((await fs.promises.readdir(path.join(dirs.chats, 'Synthetic'))).filter(name => name.startsWith('PartialFailure')).length, 0);
    assert.ok((await retained(path.join(dirs.chats, '.recycle'), 'partial first')).length > 0);
});

test('rename publishes a complete target in one exclusive link, without exposing a partially copied file', async () => {
    const source = file('complete-publish', 'complete artificial message');
    const destination = path.join(path.dirname(source), 'complete-target.jsonl');
    const original = fs.promises.link;
    let verified = false;
    fs.promises.link = async (a, b) => {
        if (path.resolve(b) === destination) {
            assert.equal(fs.existsSync(destination), false);
            assert.equal(await fs.promises.readFile(a, 'utf8'), jsonl('complete artificial message'));
            verified = true;
        }
        return original(a, b);
    };
    try { assert.equal((await rename('complete-publish', 'complete-target')).status, 200); }
    finally { fs.promises.link = original; }
    assert.equal(verified, true);
});

test('deleting a character directory waits for a chat save and prevents late get/save/import recreation', async () => {
    const card = 'DirectoryDelete'; const source = file('directory-chat', 'directory original', card);
    fs.writeFileSync(path.join(dirs.characters, `${card}.png`), 'artificial avatar bytes');
    const paused = pauseAtomicSave(source);
    const pending = post('/api/chats/save', { avatar_url: `${card}.png`, file_name: 'directory-chat', chat: rows('directory final retained') });
    await paused.started;
    const request = post('/api/characters/delete', { avatar_url: `${card}.png`, delete_chats: true });
    await new Promise(resolve => setTimeout(resolve, 60));
    const waited = fs.existsSync(source); paused.unblock(); try { assert.equal((await pending).status, 200); } finally { paused.restore(); }
    assert.equal(waited, true); assert.equal((await request).status, 200);
    const late = { avatar_url: `${card}.png`, file_name: 'directory-chat', chat: rows('late'), force: true };
    assert.equal((await post('/api/chats/save', late)).status, 409);
    assert.equal((await post('/api/chats/get', late)).status, 409);
    assert.equal(fs.existsSync(path.dirname(source)), false);
    assert.ok((await retained(path.join(dirs.chats, '.recycle'), 'directory final retained')).length > 0);
    assert.ok((await retained(path.join(dirs.characters, '.recycle'), 'artificial avatar bytes')).length > 0);
    const name = `retired-upload-${crypto.randomUUID()}.jsonl`; const upload = path.join(dirs.uploads, name); fs.writeFileSync(upload, jsonl('retired import'));
    assert.equal((await post('/api/chats/import', { _upload: name, avatar_url: `${card}.png`, file_type: 'jsonl', character_name: card, user_name: 'User' })).status, 409);
    assert.equal(fs.existsSync(upload), true);
});

test('failed character-directory recycling leaves the avatar and chats active', async () => {
    const card = 'DirectoryFailure'; const source = file('directory-failure', 'directory failure original', card);
    const directory = path.dirname(source); const avatar = path.join(dirs.characters, `${card}.png`);
    fs.writeFileSync(avatar, 'directory failure avatar');
    const original = fs.promises.rename;
    fs.promises.rename = async (a, b) => {
        if (path.resolve(a) === directory) throw Object.assign(new Error('artificial directory move failure'), { code: 'EIO' });
        return original(a, b);
    };
    try { assert.equal((await post('/api/characters/delete', { avatar_url: `${card}.png`, delete_chats: true })).status, 500); }
    finally { fs.promises.rename = original; }
    assert.equal(fs.existsSync(avatar), true); assert.equal(fs.existsSync(source), true);
    assert.equal((await post('/api/chats/save', { avatar_url: `${card}.png`, file_name: 'directory-failure', chat: rows('still active') })).status, 200);
});

async function characterFixture(card) {
    const { default: encode } = await import('../src/png/encode.js');
    const { deflateSync } = await import('node:zlib');
    const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
    const png = Buffer.from(encode([{ name: 'IHDR', data: header }, { name: 'IDAT', data: deflateSync(Buffer.from([0, 255, 0, 255, 255])) }, { name: 'IEND', data: Buffer.alloc(0) }]));
    const metadata = { spec: 'chara_card_v2', spec_version: '2.0', name: card, first_mes: 'Synthetic hello', chat: 'renamed-chat', data: { name: card, first_mes: 'Synthetic hello', extensions: {} } };
    fs.writeFileSync(path.join(dirs.characters, `${card}.png`), cardParser.write(png, JSON.stringify(metadata)));
    return file('renamed-chat', `${card} history`, card);
}

test('character rename retires the old directory while the new avatar and chat remain usable', async () => {
    const source = await characterFixture('CharacterBefore');
    const result = await post('/api/characters/rename', { avatar_url: 'CharacterBefore.png', new_name: 'CharacterAfter' });
    assert.equal(result.status, 200); assert.equal(result.data.avatar, 'CharacterAfter.png');
    assert.equal(fs.existsSync(path.dirname(source)), false);
    assert.match(await fs.promises.readFile(path.join(dirs.chats, 'CharacterAfter', 'renamed-chat.jsonl'), 'utf8'), /CharacterBefore history/);
    assert.equal((await post('/api/chats/save', { avatar_url: 'CharacterBefore.png', file_name: 'renamed-chat', chat: rows('late'), force: true })).status, 409);
    assert.equal((await post('/api/chats/get', { avatar_url: 'CharacterBefore.png', file_name: 'renamed-chat' })).status, 409);
    assert.equal((await post('/api/chats/save', { avatar_url: 'CharacterAfter.png', file_name: 'renamed-chat', chat: rows('new active') })).status, 200);
});

test('two character renames toward one new name do not overwrite the first published avatar or history', async () => {
    await characterFixture('CharacterCompetitorA'); await characterFixture('CharacterCompetitorB');
    const results = await Promise.all(['CharacterCompetitorA', 'CharacterCompetitorB'].map(name => post('/api/characters/rename', { avatar_url: `${name}.png`, new_name: 'CharacterSharedTarget' })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const activeSource = ['CharacterCompetitorA', 'CharacterCompetitorB'].find(name => fs.existsSync(path.join(dirs.characters, `${name}.png`)));
    assert.ok(activeSource);
    assert.equal(fs.existsSync(path.join(dirs.chats, activeSource, 'renamed-chat.jsonl')), true);
    assert.equal((await post('/api/chats/save', { avatar_url: `${activeSource}.png`, file_name: 'renamed-chat', chat: rows('loser remains active') })).status, 200);
});

test('creating a character with a retired directory name is rejected before any mkdir or upload mutation', async () => {
    const card = 'RetiredCreate'; const source = file('retired-create-chat', 'retired create history', card);
    fs.writeFileSync(path.join(dirs.characters, `${card}.png`), 'retired-create avatar');
    assert.equal((await post('/api/characters/delete', { avatar_url: `${card}.png`, delete_chats: true })).status, 200);
    const name = `retired-create-${crypto.randomUUID()}.png`; const upload = path.join(dirs.uploads, name); fs.writeFileSync(upload, 'artificial upload retained');
    assert.equal((await post('/api/characters/create', { ch_name: card, file_name: card, _upload: name })).status, 409);
    assert.equal(fs.existsSync(path.dirname(source)), false);
    assert.equal(fs.existsSync(path.join(dirs.characters, `${card}.png`)), false);
    assert.equal(await fs.promises.readFile(upload, 'utf8'), 'artificial upload retained');
});

test('malformed import request bodies settle without disrupting subsequent HTTP requests', async () => {
    for (const body of [{ file_type: 'json', avatar_url: null }, { file_type: 'json', avatar_url: 42 }, { file_type: 'json' }, { file_type: 'json', avatar_url: 'Synthetic.png', user_name: 9 }]) {
        assert.equal((await post('/api/chats/import', body)).status, 400);
    }
    assert.equal((await save('healthy-after-malformed', 'healthy')).status, 200);
});

test('optional import display names can be omitted while valid uploaded JSONL remains compatible', async () => {
    const name = `optional-names-${crypto.randomUUID()}.jsonl`; fs.writeFileSync(path.join(dirs.uploads, name), jsonl('no optional names'));
    const result = await post('/api/chats/import', { _upload: name, avatar_url: 'Synthetic.png', file_type: 'jsonl' });
    assert.equal(result.status, 200); assert.equal(result.data.fileNames.length, 1);
});

test('relative retirement identities survive copying an entirely artificial data root', async () => {
    const source = file('relocated-source');
    assert.equal((await rename('relocated-source', 'relocated-target')).status, 200);
    const relocated = path.join(root, 'relocated-artificial-chats');
    await fs.promises.cp(dirs.chats, relocated, { recursive: true, errorOnExist: true, force: false });
    await assert.rejects(io.assertChatWritable(path.join(relocated, 'Synthetic', path.basename(source)), relocated), error => error instanceof io.ChatLifecycleError && error.reason === 'retired_path');
});

test('internal staging junctions are rejected instead of writing through a directory alias', async () => {
    const card = 'AliasStaging'; const directory = path.join(dirs.chats, card);
    const destination = path.join(root, 'alias-staging-artificial-target');
    await fs.promises.mkdir(directory); await fs.promises.mkdir(destination);
    await fs.promises.symlink(destination, path.join(directory, '.chat-staging'), process.platform === 'win32' ? 'junction' : 'dir');
    const name = `alias-${crypto.randomUUID()}.jsonl`; const upload = path.join(dirs.uploads, name); fs.writeFileSync(upload, jsonl('alias artificial'));
    assert.equal((await post('/api/chats/import', { _upload: name, avatar_url: `${card}.png`, file_type: 'jsonl' })).status, 409);
    assert.deepEqual(await fs.promises.readdir(destination), []); assert.equal(fs.existsSync(upload), true);
});

test('internal recovery junctions are rejected while the original file remains intact', async () => {
    const directory = path.join(root, 'alias-recycle-source'); const destination = path.join(root, 'alias-recycle-artificial-target');
    await fs.promises.mkdir(directory); await fs.promises.mkdir(destination);
    const source = path.join(directory, 'artificial.txt'); await fs.promises.writeFile(source, 'unchanged alias original');
    await fs.promises.symlink(destination, path.join(directory, '.recycle'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(io.recycleChatPath(source), error => error instanceof io.ChatLifecycleError && error.reason === 'path_alias');
    assert.equal(await fs.promises.readFile(source, 'utf8'), 'unchanged alias original'); assert.deepEqual(await fs.promises.readdir(destination), []);
});

test('failed character-directory rename restores the original avatar and writable chat without a candidate', async () => {
    const source = await characterFixture('CharacterMoveFailure'); const directory = path.dirname(source);
    const original = fs.promises.rename;
    fs.promises.rename = async (a, b) => {
        if (path.resolve(a) === directory) throw Object.assign(new Error('artificial character directory rename failure'), { code: 'EIO' });
        return original(a, b);
    };
    try { assert.equal((await post('/api/characters/rename', { avatar_url: 'CharacterMoveFailure.png', new_name: 'CharacterMoveCandidate' })).status, 500); }
    finally { fs.promises.rename = original; }
    assert.equal(fs.existsSync(path.join(dirs.characters, 'CharacterMoveFailure.png')), true);
    assert.equal(fs.existsSync(path.join(dirs.characters, 'CharacterMoveCandidate.png')), false);
    assert.equal((await post('/api/chats/save', { avatar_url: 'CharacterMoveFailure.png', file_name: 'renamed-chat', chat: rows('still active') })).status, 200);
});

test('failed avatar deletion restores an already-recycled chat directory and its marker', async () => {
    const card = 'AvatarMoveFailure'; const source = file('avatar-failure-chat', 'avatar failure original', card);
    const avatar = path.join(dirs.characters, `${card}.png`); fs.writeFileSync(avatar, 'avatar failure bytes');
    const original = fs.promises.rename;
    fs.promises.rename = async (a, b) => {
        if (path.resolve(a) === avatar) throw Object.assign(new Error('artificial avatar move failure'), { code: 'EIO' });
        return original(a, b);
    };
    try { assert.equal((await post('/api/characters/delete', { avatar_url: `${card}.png`, delete_chats: true })).status, 500); }
    finally { fs.promises.rename = original; }
    assert.equal(fs.existsSync(avatar), true); assert.match(await fs.promises.readFile(source, 'utf8'), /avatar failure original/);
    assert.equal((await post('/api/chats/save', { avatar_url: `${card}.png`, file_name: 'avatar-failure-chat', chat: rows('still active') })).status, 200);
});

test('explicit character creation does not overwrite an existing avatar', async () => {
    const avatar = path.join(dirs.characters, 'ExistingCreate.png'); fs.writeFileSync(avatar, 'original existing avatar bytes');
    assert.equal((await post('/api/characters/create', { ch_name: 'ExistingCreate', file_name: 'ExistingCreate' })).status, 409);
    assert.equal(await fs.promises.readFile(avatar, 'utf8'), 'original existing avatar bytes');
});

test('chat routes cannot rename internal retirement markers to revive a retired path', async () => {
    const source = file('internal-marker-source');
    assert.equal((await rename('internal-marker-source', 'internal-marker-target')).status, 200);
    const records = await fs.promises.readdir(path.join(dirs.chats, '.chat-lifecycle'));
    let marker;
    for (const name of records) {
        const record = JSON.parse(await fs.promises.readFile(path.join(dirs.chats, '.chat-lifecycle', name), 'utf8'));
        if (record.relative_path === path.join('Synthetic', path.basename(source))) marker = name;
    }
    assert.ok(marker);
    const result = await post('/api/chats/rename', { avatar_url: '.chat-lifecycle.png', original_file: marker, renamed_file: 'moved-marker.json' });
    assert.equal(result.status, 409); assert.equal(result.data.reason, 'reserved_path');
    assert.equal(fs.existsSync(path.join(dirs.chats, '.chat-lifecycle', marker)), true);
    assert.equal((await save('internal-marker-source', 'must not revive', { force: true })).status, 409);
});

test('character rename inherits retired chat names while retaining writable active histories', async () => {
    const card = 'RetirementBefore'; await characterFixture(card);
    file('previously-deleted', 'deleted history', card);
    file('previous-name', 'renamed history', card);
    assert.equal((await post('/api/chats/delete', { avatar_url: `${card}.png`, chatfile: 'previously-deleted.jsonl' })).status, 200);
    assert.equal((await rename('previous-name', 'still-active', { avatar_url: `${card}.png` })).status, 200);
    const result = await post('/api/characters/rename', { avatar_url: `${card}.png`, new_name: 'RetirementAfter' });
    assert.equal(result.status, 200);
    for (const name of ['previously-deleted', 'previous-name']) {
        assert.equal((await post('/api/chats/save', { avatar_url: result.data.avatar, file_name: name, chat: rows('must stay retired'), force: true })).status, 409);
    }
    for (const name of ['renamed-chat', 'still-active']) {
        assert.equal((await post('/api/chats/save', { avatar_url: result.data.avatar, file_name: name, chat: rows('active histories') })).status, 200);
    }
});
