import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import encode from '../src/png/encode.js';
import { Jimp } from '../src/jimp.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'character-routes-'));
globalThis.DATA_ROOT = root;
const config = path.join(root, 'config.yaml');
fs.writeFileSync(config, 'performance:\n  useDiskCache: false\ncacheBuster:\n  enabled: false\n');
const util = await import('../src/util.js');
util.setConfigFilePath(config);
const { router } = await import('../src/endpoints/characters.js');
const parser = await import('../src/character-card-parser.js');
const dirs = Object.fromEntries(['characters', 'chats', 'uploads', 'thumbnailsAvatar'].map(key => [key, path.join(root, key)]));
for (const directory of Object.values(dirs)) fs.mkdirSync(directory);
function invoke(route, body, file) {
    const handler = router.stack.find(layer => layer.route?.path === route).route.stack.at(-1).handle;
    return new Promise((resolve, reject) => {
        const response = { code: 200, status(code) { this.code = code; return this; }, send(data) { resolve({ status: this.code, data }); return this; }, sendStatus(code) { this.code = code; return this.send(); } };
        handler({ body, file, query: {}, headers: {}, user: { directories: dirs, profile: { handle: 'synthetic' } } }, response, reject);
    });
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

for (const route of ['/edit', '/edit-avatar', '/edit-attribute', '/merge-attributes']) {
    for (const mutation of ['/delete', '/rename']) {
        test(`${route} holds lifecycle locks through image preparation against ${mutation}`, async () => {
            const name = `${route.slice(1)}-${mutation.slice(1)}`;
            const avatar = `${name}.png`;
            const target = path.join(dirs.characters, avatar);
            const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
            const png = Buffer.from(encode([{ name: 'IHDR', data: header }, { name: 'IDAT', data: deflateSync(Buffer.from([0, 255, 0, 255, 255])) }, { name: 'IEND', data: Buffer.alloc(0) }]));
            const metadata = { spec: 'chara_card_v2', spec_version: '2.0', name, description: 'old', data: { name, description: 'old', personality: '', scenario: '', first_mes: '', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '', character_version: '', extensions: {} } };
            fs.writeFileSync(target, parser.write(png, JSON.stringify(metadata)));
            fs.mkdirSync(path.join(dirs.chats, name));
            const upload = `${name}-upload.png`;
            fs.writeFileSync(path.join(dirs.uploads, upload), png);
            const body = { avatar_url: avatar, avatar, ch_name: name, field: 'description', value: 'edited', description: 'edited', data: { description: 'edited' } };
            const file = ['/edit', '/edit-avatar'].includes(route) ? { destination: dirs.uploads, filename: upload } : undefined;
            const original = Jimp.read;
            const entered = deferred(); const release = deferred();
            Jimp.read = async () => { entered.resolve(); await release.promise; const image = new Jimp({ width: 1, height: 1, color: 0xff00ffff }); image.getBuffer = async () => png; return image; };
            try {
                const editing = invoke(route, body, file);
                await entered.promise;
                let finished = false;
                const moving = invoke(mutation, { avatar_url: avatar, new_name: `${name}-renamed`, delete_chats: true }).then(result => { finished = true; return result; });
                await new Promise(resolve => setImmediate(resolve));
                assert.equal(finished, false);
                release.resolve();
                assert.equal((await editing).status, 200);
                assert.equal((await moving).status, 200);
                assert.equal(fs.existsSync(target), false);
                assert.equal((await invoke(route, body, file)).status, 409);
                if (mutation === '/rename') {
                    const card = JSON.parse(parser.read(fs.readFileSync(path.join(dirs.characters, `${name}-renamed.png`))));
                    if (route !== '/edit-avatar') assert.equal(card.data.description, 'edited');
                }
            } finally { release.resolve(); Jimp.read = original; }
        });
    }
}
