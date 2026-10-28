import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import encode from '../src/png/encode.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-recreate-'));
globalThis.DATA_ROOT = root;
const config = path.join(root, 'config.yaml');
fs.writeFileSync(config, 'backups:\n  chat:\n    enabled: false\n    checkIntegrity: false\nlogging:\n  minLogLevel: 3\nperformance:\n  useDiskCache: false\ncacheBuster:\n  enabled: false\n');
const util = await import('../src/util.js');
util.setConfigFilePath(config);
const io = await import('../src/chat-io.js');
const chats = await import('../src/endpoints/chats.js');
const characters = await import('../src/endpoints/characters.js');
const parser = await import('../src/character-card-parser.js');
const dirs = Object.fromEntries(['characters', 'chats', 'uploads', 'thumbnailsAvatar', 'backups'].map(key => [key, path.join(root, key)]));
for (const directory of Object.values(dirs)) fs.mkdirSync(directory);

function invoke(router, route, body, extra = {}) {
    const handler = router.stack.find(layer => layer.route?.path === route).route.stack.at(-1).handle;
    return new Promise((resolve, reject) => {
        const response = {
            code: 200,
            status(code) { this.code = code; return this; },
            send(data) { resolve({ status: this.code, data }); return this; },
            sendStatus(code) { this.code = code; return this.send(); },
        };
        const pending = handler({
            body, query: {}, headers: {},
            file: extra.file,
            user: { directories: dirs, profile: { handle: 'synthetic' } },
        }, response, reject);
        if (pending && typeof pending.then === 'function') pending.catch(reject);
    });
}

function pngCard(name) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    header[9] = 6;
    const png = Buffer.from(encode([
        { name: 'IHDR', data: header },
        { name: 'IDAT', data: deflateSync(Buffer.from([0, 255, 0, 255, 255])) },
        { name: 'IEND', data: Buffer.alloc(0) },
    ]));
    const metadata = {
        spec: 'chara_card_v2', spec_version: '2.0', name, chat: 'kept-chat',
        data: { name, description: 'synthetic', extensions: {} },
    };
    return parser.write(png, JSON.stringify(metadata));
}

test('an absent retired chat can be a rename target, while an ordinary save still conflicts', async () => {
    const directory = path.join(dirs.chats, 'SyntheticReuse');
    fs.mkdirSync(directory, { recursive: true });
    const source = path.join(directory, 'reuse-source.jsonl');
    const other = path.join(directory, 'reuse-other.jsonl');
    const kept = path.join(directory, 'still-retired.jsonl');
    fs.writeFileSync(source, 'reuse-body');
    fs.writeFileSync(other, 'other-body');
    fs.writeFileSync(kept, 'kept-body');
    assert.equal((await invoke(chats.router, '/delete', { avatar_url: 'SyntheticReuse.png', chatfile: 'reuse-source.jsonl' })).status, 200);
    assert.equal((await invoke(chats.router, '/delete', { avatar_url: 'SyntheticReuse.png', chatfile: 'still-retired.jsonl' })).status, 200);
    await assert.rejects(
        chats.trySaveChat([{ mes: 'stale' }], source, true, 'synthetic', 'SyntheticReuse', dirs.backups, dirs.chats),
        error => error instanceof io.ChatLifecycleError && error.reason === 'retired_path',
    );
    const renamed = await invoke(chats.router, '/rename', {
        avatar_url: 'SyntheticReuse.png', original_file: 'reuse-other.jsonl', renamed_file: 'reuse-source.jsonl',
    });
    assert.equal(renamed.status, 200);
    assert.equal(fs.readFileSync(source, 'utf8'), 'other-body');
    await assert.rejects(
        chats.trySaveChat([{ mes: 'stale-kept' }], kept, true, 'synthetic', 'SyntheticReuse', dirs.backups, dirs.chats),
        error => error instanceof io.ChatLifecycleError && error.reason === 'retired_path',
    );
});

test('chat rename can return to an absent previous name', async () => {
    const directory = path.join(dirs.chats, 'SyntheticCycle');
    fs.mkdirSync(directory, { recursive: true });
    const original = path.join(directory, 'cycle-a.jsonl');
    fs.writeFileSync(original, 'cycle-body');
    assert.equal((await invoke(chats.router, '/rename', {
        avatar_url: 'SyntheticCycle.png', original_file: 'cycle-a.jsonl', renamed_file: 'cycle-b.jsonl',
    })).status, 200);
    await assert.rejects(
        chats.trySaveChat([{ mes: 'stale' }], original, true, 'synthetic', 'SyntheticCycle', dirs.backups, dirs.chats),
        error => error instanceof io.ChatLifecycleError && error.reason === 'retired_path',
    );
    assert.equal((await invoke(chats.router, '/rename', {
        avatar_url: 'SyntheticCycle.png', original_file: 'cycle-b.jsonl', renamed_file: 'cycle-a.jsonl',
    })).status, 200);
    assert.equal(fs.readFileSync(original, 'utf8'), 'cycle-body');
    await assert.rejects(
        chats.trySaveChat([{ mes: 'stale-b' }], path.join(directory, 'cycle-b.jsonl'), true, 'synthetic', 'SyntheticCycle', dirs.backups, dirs.chats),
        error => error instanceof io.ChatLifecycleError && error.reason === 'retired_path',
    );
});

test('a visible path keeps its retirement marker and an occupied rename target is unchanged', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'retired-visible-'));
    const visible = path.join(directory, 'visible.jsonl');
    const source = path.join(directory, 'source.jsonl');
    await fs.promises.writeFile(visible, 'still-here');
    await fs.promises.writeFile(source, 'source-body');
    await io.retireChatPath(visible, directory, 'synthetic');
    const marker = path.join(directory, '.chat-lifecycle', (await fs.promises.readdir(path.join(directory, '.chat-lifecycle')))[0]);
    assert.equal(await io.clearRetiredPathIfAbsent(visible, directory), null);
    assert.equal(fs.existsSync(marker), true);
    await assert.rejects(io.renameChatFile(source, visible, directory), error => error instanceof io.ChatLifecycleError && error.reason === 'retired_path');
    assert.equal(await fs.promises.readFile(visible, 'utf8'), 'still-here');
    assert.equal(await fs.promises.readFile(source, 'utf8'), 'source-body');
    const occupied = path.join(directory, 'occupied.jsonl');
    await fs.promises.writeFile(occupied, 'occupied-body');
    await assert.rejects(io.renameChatFile(source, occupied, directory), error => error instanceof io.ChatLifecycleError && error.reason === 'target_exists');
    assert.equal(await fs.promises.readFile(occupied, 'utf8'), 'occupied-body');
});

test('clearing an absent child does not drop a retired parent marker or follow a marker symlink', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'retired-parent-'));
    const chats = path.join(directory, 'Card');
    await fs.promises.mkdir(chats);
    await fs.promises.writeFile(path.join(chats, 'old.jsonl'), 'parent-history');
    await io.recycleRetiredChat(chats, directory);
    const child = path.join(chats, 'fresh.jsonl');
    assert.equal(await io.clearRetiredPathIfAbsent(child, directory), null);
    await assert.rejects(io.assertChatWritable(child, directory), error => error instanceof io.ChatLifecycleError && error.reason === 'retired_path');
    const markerName = (await fs.promises.readdir(path.join(directory, '.chat-lifecycle')))[0];
    const marker = path.join(directory, '.chat-lifecycle', markerName);
    const outside = path.join(directory, 'outside-bytes');
    await fs.promises.writeFile(outside, 'do-not-follow');
    const held = `${marker}.held`;
    await fs.promises.rename(marker, held);
    await fs.promises.symlink(outside, marker);
    await assert.rejects(io.clearRetiredPathIfAbsent(chats, directory), error => error instanceof io.ChatLifecycleError && error.reason === 'path_alias');
    assert.equal(await fs.promises.readFile(outside, 'utf8'), 'do-not-follow');
    assert.equal(await fs.promises.readFile(held, 'utf8') !== '', true);
    await assert.rejects(
        io.clearRetiredPathIfAbsent(path.resolve(directory, '..', 'outside.jsonl'), directory),
        error => error instanceof io.ChatLifecycleError && error.reason === 'outside_chat_root',
    );
});

test('character rename can return to an absent name and delete then create reuses it', async () => {
    const card = 'RenameCycleA';
    fs.writeFileSync(path.join(dirs.characters, `${card}.png`), pngCard(card));
    fs.mkdirSync(path.join(dirs.chats, card));
    fs.writeFileSync(path.join(dirs.chats, card, 'kept-chat.jsonl'), 'cycle-history');
    assert.equal((await invoke(characters.router, '/rename', { avatar_url: `${card}.png`, new_name: 'RenameCycleB' })).status, 200);
    await assert.rejects(
        chats.trySaveChat([{ mes: 'stale' }], path.join(dirs.chats, card, 'kept-chat.jsonl'), true, 'synthetic', card, dirs.backups, dirs.chats),
        error => error instanceof io.ChatLifecycleError && error.reason === 'retired_path',
    );
    const back = await invoke(characters.router, '/rename', { avatar_url: 'RenameCycleB.png', new_name: card });
    assert.equal(back.status, 200);
    assert.equal(back.data.avatar, `${card}.png`);
    assert.equal(fs.readFileSync(path.join(dirs.chats, card, 'kept-chat.jsonl'), 'utf8'), 'cycle-history');
    await assert.rejects(
        chats.trySaveChat([{ mes: 'stale-b' }], path.join(dirs.chats, 'RenameCycleB', 'kept-chat.jsonl'), true, 'synthetic', 'RenameCycleB', dirs.backups, dirs.chats),
        error => error instanceof io.ChatLifecycleError && error.reason === 'retired_path',
    );

    const deleted = 'RecreateCard';
    fs.writeFileSync(path.join(dirs.characters, `${deleted}.png`), 'retired-create avatar');
    fs.mkdirSync(path.join(dirs.chats, deleted));
    fs.writeFileSync(path.join(dirs.chats, deleted, 'old-chat.jsonl'), 'retired create history');
    assert.equal((await invoke(characters.router, '/delete', { avatar_url: `${deleted}.png`, delete_chats: true })).status, 200);
    await assert.rejects(
        chats.trySaveChat([{ mes: 'late' }], path.join(dirs.chats, deleted, 'old-chat.jsonl'), true, 'synthetic', deleted, dirs.backups, dirs.chats),
        error => error instanceof io.ChatLifecycleError && error.reason === 'retired_path',
    );
    const created = await invoke(characters.router, '/create', { ch_name: deleted, file_name: deleted });
    assert.equal(created.status, 200);
    assert.equal(created.data, `${deleted}.png`);
    assert.equal(fs.existsSync(path.join(dirs.characters, `${deleted}.png`)), true);
    assert.equal(fs.existsSync(path.join(dirs.chats, deleted, 'old-chat.jsonl')), false);
    assert.equal((await invoke(chats.router, '/save', {
        avatar_url: `${deleted}.png`, file_name: 'fresh-after-recreate', chat: [{ mes: 'fresh' }],
    })).status, 200);
});

test('a failed character create restores the retirement marker', async () => {
    const deleted = 'FailedRecreate';
    fs.writeFileSync(path.join(dirs.characters, `${deleted}.png`), 'retired-create avatar');
    fs.mkdirSync(path.join(dirs.chats, deleted));
    fs.writeFileSync(path.join(dirs.chats, deleted, 'old-chat.jsonl'), 'failed recreate history');
    assert.equal((await invoke(characters.router, '/delete', { avatar_url: `${deleted}.png`, delete_chats: true })).status, 200);
    const uploadName = 'not-a-png.png';
    const upload = path.join(dirs.uploads, uploadName);
    fs.writeFileSync(upload, 'not a png');
    const created = await invoke(characters.router, '/create', { ch_name: deleted, file_name: deleted }, {
        file: { destination: dirs.uploads, filename: uploadName },
    });
    assert.equal(created.status, 500);
    assert.equal(fs.existsSync(path.join(dirs.chats, deleted)), false);
    assert.equal(fs.existsSync(path.join(dirs.characters, `${deleted}.png`)), false);
    assert.equal(fs.existsSync(upload), true);
    await assert.rejects(
        chats.trySaveChat([{ mes: 'late' }], path.join(dirs.chats, deleted, 'old-chat.jsonl'), true, 'synthetic', deleted, dirs.backups, dirs.chats),
        error => error instanceof io.ChatLifecycleError && error.reason === 'retired_path',
    );
    const retry = await invoke(characters.router, '/create', { ch_name: deleted, file_name: deleted });
    assert.equal(retry.status, 200);
    assert.equal(retry.data, `${deleted}.png`);
    assert.equal((await invoke(chats.router, '/save', {
        avatar_url: `${deleted}.png`, file_name: 'fresh-after-failed-create', chat: [{ mes: 'fresh' }],
    })).status, 200);
});

test('a failed chat rename restores the destination retirement marker', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'retired-rename-fail-'));
    const source = path.join(directory, 'source.jsonl');
    const destination = path.join(directory, 'dest.jsonl');
    await fs.promises.writeFile(source, 'source-body');
    await fs.promises.writeFile(destination, 'dest-body');
    await io.recycleRetiredChat(destination, directory);
    const originalRename = fs.promises.rename;
    fs.promises.rename = async (from, to) => {
        if (path.resolve(from) === source) throw Object.assign(new Error('artificial source recycle failure'), { code: 'EIO' });
        return originalRename(from, to);
    };
    try {
        await assert.rejects(io.renameChatFile(source, destination, directory));
    } finally {
        fs.promises.rename = originalRename;
    }
    assert.equal(await fs.promises.readFile(source, 'utf8'), 'source-body');
    assert.equal(fs.existsSync(destination), false);
    await assert.rejects(
        io.assertChatWritable(destination, directory),
        error => error instanceof io.ChatLifecycleError && error.reason === 'retired_path',
    );
    await io.assertChatWritable(source, directory);
});

test('delete then re-import publishes a character with writable chats', async () => {
    const name = 'ReimportWritable';
    const bytes = pngCard(name);
    fs.writeFileSync(path.join(dirs.characters, `${name}.png`), bytes);
    fs.mkdirSync(path.join(dirs.chats, name));
    fs.writeFileSync(path.join(dirs.chats, name, 'old.jsonl'), 'old');
    assert.equal((await invoke(characters.router, '/delete', { avatar_url: `${name}.png`, delete_chats: true })).status, 200);
    fs.writeFileSync(path.join(dirs.uploads, 'reimport.png'), bytes);
    const imported = await invoke(characters.router, '/import', { file_type: 'png' }, {
        file: { destination: dirs.uploads, filename: 'reimport.png' },
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.data.file_name, name);
    assert.equal((await invoke(chats.router, '/save', {
        avatar_url: `${name}.png`, file_name: 'new', chat: [{ mes: 'fresh' }],
    })).status, 200);
});

test('deletion cancels an import paused in image processing without resurrection', async () => {
    const { Jimp } = await import('../src/jimp.js');
    const name = 'ImportDeleteRace';
    const bytes = pngCard(name);
    const target = path.join(dirs.characters, `${name}.png`);
    fs.writeFileSync(target, bytes);
    fs.mkdirSync(path.join(dirs.chats, name));
    fs.writeFileSync(path.join(dirs.uploads, 'race.png'), bytes);
    let entered;
    let resume;
    const inside = new Promise(resolve => { entered = resolve; });
    const paused = new Promise(resolve => { resume = resolve; });
    const original = Jimp.read;
    Jimp.read = async () => {
        entered();
        await paused;
        const image = new Jimp({ width: 1, height: 1 });
        image.getBuffer = async () => bytes;
        return image;
    };
    try {
        const importing = invoke(characters.router, '/import', { file_type: 'png', preserved_name: `${name}.png` }, {
            file: { destination: dirs.uploads, filename: 'race.png' },
        });
        await inside;
        assert.equal((await invoke(characters.router, '/delete', { avatar_url: `${name}.png`, delete_chats: true })).status, 200);
        assert.equal((await importing).status, 409);
        resume();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(fs.existsSync(target), false);
    } finally { resume(); Jimp.read = original; }
});
