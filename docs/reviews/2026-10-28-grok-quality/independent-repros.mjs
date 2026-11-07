import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { review, source } from './review-context.mjs';
import './preserve-deletions.mjs';
const load = name => import(pathToFileURL(path.join(source, name)).href);
const mode = process.argv[2];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
if (!mode) {
    const results = [];
    for (const scenario of (process.env.REVIEW_SCENARIOS || 'owner-fail-open,shutdown-bound,nested-shared,export-malformed,character-reimport,import-delete-race').split(',')) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), scenario], { cwd: source, env: process.env, encoding: 'utf8', timeout: 12_000 });
        const lines = child.stdout.trim().split('\n');
        let result;
        try { result = JSON.parse(lines.at(-1)); } catch { result = { scenario, unexpectedOutput: child.stdout.slice(-1200), stderr: child.stderr.slice(-1200) }; }
        results.push({ ...result, exit: child.status, signal: child.signal, error: child.error?.message });
    }
    fs.writeFileSync(path.join(review, process.env.REVIEW_LABEL === 'baseline' ? 'baseline-independent-repros.json' : 'independent-repros.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
    console.log('Evidence directory: ' + review);
} else {
    const root = fs.mkdtempSync(path.join(review, 'temp', mode + '-'));
    if (mode === 'owner-fail-open') {
        const { acquireDataRootOwnership, DATA_ROOT_OWNER_LOCK } = await load('src/data-root-owner.js');
        const lock = path.join(root, DATA_ROOT_OWNER_LOCK);
        const payload = JSON.stringify({ pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), token: 'existing-live-owner' });
        fs.writeFileSync(lock, payload);
        const open = fs.openSync;
        fs.openSync = function(target, flags, ...args) {
            if (path.resolve(String(target)) === lock) { const error = new Error('synthetic lock ACL denies access while data files remain writable'); error.code = 'EACCES'; throw error; }
            return open(target, flags, ...args);
        };
        let outcome;
        try { outcome = acquireDataRootOwnership(root); } finally { fs.openSync = open; }
        assert.equal(fs.readFileSync(lock, 'utf8'), payload);
        console.log(JSON.stringify({ scenario: mode, reproduced: outcome.unverified === true, result: outcome, existingLiveOwnerPreserved: true }));
    } else if (mode === 'shutdown-bound') {
        const { createRequestDrain, createPersistenceTracker } = await load('src/request-drain.js');
        const { withPathLock, waitForChatIO } = await load('src/chat-io.js');
        const tracker = createPersistenceTracker();
        const drain = createRequestDrain(tracker);
        let release, entered;
        const started = new Promise(resolve => { entered = resolve; });
        const blocked = new Promise(resolve => { release = resolve; });
        let write;
        const entry = { handle: () => { write = withPathLock(path.join(root, 'synthetic-chat'), async () => { entered(); await blocked; }); return write; } };
        tracker.trackRouter({ stack: [{ route: { stack: [entry] } }] });
        entry.handle({}, {}, error => { throw error; });
        await started;
        const at = Date.now();
        await drain.stop(20);
        const drainElapsedMs = Date.now() - at;
        const outcome = await Promise.race([waitForChatIO().then(() => 'finished'), delay(150).then(() => 'still-blocked')]);
        release(); await write;
        console.log(JSON.stringify({ scenario: mode, reproduced: outcome === 'still-blocked', configuredDrainMs: 20, drainElapsedMs, elapsedMs: Date.now() - at, outcome }));
    } else if (mode === 'nested-shared') {
        const { withPathLocks, chatLockPaths } = await load('src/chat-io.js');
        let entered, resume;
        const inside = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { resume = resolve; });
        const outer = withPathLocks(chatLockPaths([path.join(root, 'a.jsonl')]), async () => {
            entered(); await gate;
            return withPathLocks(chatLockPaths([path.join(root, 'b.jsonl')]), async () => 'inner');
        });
        await inside;
        const writer = withPathLocks([root], async () => 'writer');
        resume();
        const outcome = await Promise.race([Promise.all([outer, writer]).then(() => 'finished'), delay(150).then(() => 'deadlocked')]);
        console.log(JSON.stringify({ scenario: mode, reproduced: outcome === 'deadlocked', outcome, filesystemWrites: 0 }));
    } else {
        globalThis.DATA_ROOT = root;
        fs.writeFileSync(path.join(root, 'config.yaml'), 'backups:\n  chat:\n    enabled: false\nperformance:\n  useDiskCache: false\ncacheBuster:\n  enabled: false\n');
        const util = await load('src/util.js');
        util.setConfigFilePath(path.join(root, 'config.yaml'));
        const dirs = Object.fromEntries(['characters', 'chats', 'groupChats', 'uploads', 'thumbnailsAvatar'].map(key => [key, path.join(root, key)]));
        Object.values(dirs).forEach(dir => fs.mkdirSync(dir));
        function invoke(router, route, body, file) {
            const handler = router.stack.find(layer => layer.route?.path === route).route.stack.at(-1).handle;
            return new Promise((resolve, reject) => {
                const response = { code: 200, status(code) { this.code = code; return this; }, send(data) { resolve({ status: this.code, data }); return this; }, json(data) { return this.send(data); }, sendStatus(code) { this.code = code; return this.send(); } };
                Promise.resolve(handler({ body, file, query: {}, headers: {}, user: { directories: dirs, profile: { handle: 'synthetic-review' } } }, response, reject)).catch(reject);
            });
        }
        if (mode === 'export-malformed') {
            const { router } = await load('src/endpoints/chats.js');
            const chat = path.join(dirs.groupChats, 'broken.jsonl');
            fs.writeFileSync(chat, '{"chat_metadata":{}}\n{malformed-json}\n');
            process.once('uncaughtException', error => { console.log(JSON.stringify({ scenario: mode, reproduced: true, uncaughtException: error.name, responseHandled: false })); process.exit(70); });
            const response = await invoke(router, '/export', { is_group: true, file: 'broken.jsonl', format: 'txt', exportfilename: 'synthetic.txt' });
            console.log(JSON.stringify({ scenario: mode, reproduced: false, response }));
        } else {
            const { router } = await load('src/endpoints/characters.js');
            const parser = await load('src/character-card-parser.js');
            const { default: encode } = await load('src/png/encode.js');
            const { Jimp } = await load('src/jimp.js');
            const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
            const image = Buffer.from(encode([{ name: 'IHDR', data: header }, { name: 'IDAT', data: deflateSync(Buffer.from([0, 255, 0, 255, 255])) }, { name: 'IEND', data: Buffer.alloc(0) }]));
            const card = { spec: 'chara_card_v2', spec_version: '2.0', name: 'ReviewCard', description: '', data: { name: 'ReviewCard', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '', character_version: '', extensions: {} } };
            const bytes = parser.write(image, JSON.stringify(card));
            const avatar = path.join(dirs.characters, 'ReviewCard.png');
            fs.writeFileSync(avatar, bytes);
            fs.mkdirSync(path.join(dirs.chats, 'ReviewCard'));
            fs.writeFileSync(path.join(dirs.chats, 'ReviewCard', 'history.jsonl'), '{"chat_metadata":{}}\n');
            const upload = path.join(dirs.uploads, 'import.png'); fs.writeFileSync(upload, bytes);
            if (mode === 'character-reimport') {
                assert.equal((await invoke(router, '/delete', { avatar_url: 'ReviewCard.png', delete_chats: true })).status, 200);
                const result = await invoke(router, '/import', { file_type: 'png' }, { destination: dirs.uploads, filename: 'import.png' });
                const edit = await invoke(router, '/edit-attribute', { avatar_url: 'ReviewCard.png', ch_name: 'ReviewCard', field: 'description', value: 'test' });
                const { assertChatWritable } = await load('src/chat-io.js');
                let writable = true, reason;
                try { await assertChatWritable(path.join(dirs.chats, 'ReviewCard', 'new.jsonl'), dirs.chats); } catch (error) { writable = false; reason = error.reason; }
                console.log(JSON.stringify({ scenario: mode, reproduced: result.status === 200 && !!result.data?.file_name && !writable, import: result, edit, chatWritable: writable, reason, visibleAvatar: fs.existsSync(avatar) }));
            } else {
                let entered, resume;
                const inside = new Promise(resolve => { entered = resolve; });
                const gate = new Promise(resolve => { resume = resolve; });
                const original = Jimp.read;
                Jimp.read = async () => { entered(); await gate; const result = new Jimp({ width: 1, height: 1 }); result.getBuffer = async () => image; return result; };
                const importing = invoke(router, '/import', { file_type: 'png', preserved_name: 'ReviewCard.png' }, { destination: dirs.uploads, filename: 'import.png' });
                await inside;
                const deletion = await invoke(router, '/delete', { avatar_url: 'ReviewCard.png', delete_chats: true });
                const afterDelete = fs.existsSync(avatar);
                resume(); const imported = await importing; Jimp.read = original;
                console.log(JSON.stringify({ scenario: mode, reproduced: deletion.status === 200 && !afterDelete && fs.existsSync(avatar), deletion, avatarAfterDelete: afterDelete, importing: imported, avatarResurrected: fs.existsSync(avatar) }));
            }
        }
    }
}
