import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import inspector from 'node:inspector';
import { performance } from 'node:perf_hooks';

const runs = Number(process.env.PROFILE_RUNS || 1000);
assert.ok(Number.isSafeInteger(runs) && runs > 0, 'PROFILE_RUNS must be a positive integer');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-save-chat-'));
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
globalThis.DATA_ROOT = root;
const config = path.join(root, 'config.yaml');
fs.writeFileSync(config, 'backups:\n  chat:\n    enabled: false\n');
const { setConfigFilePath } = await import('../src/util.js');
setConfigFilePath(config);
const { trySaveChat } = await import('../src/endpoints/chats.js');
const chat = [{ chat_metadata: {} }, ...Array.from({ length: 1000 }, (_, i) => ({ name: 'Synthetic', mes: 'synthetic text '.repeat(22) + i }))];
const file = path.join(root, 'chat.jsonl');
const save = () => trySaveChat(chat, file, false, 'synthetic', 'Synthetic', root, root);
for (let i = 0; i < 5; i++) await save();
// Optional scoped profile excludes imports and warmup; plain --cpu-prof also works.
const session = new inspector.Session();
const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
if (process.env.PROFILE_OUTPUT) {
    session.connect();
    await post('Profiler.enable');
    await post('Profiler.start');
}
const start = performance.now();
for (let i = 0; i < runs; i++) await save();
const elapsed = performance.now() - start;
if (process.env.PROFILE_OUTPUT) {
    const { profile } = await post('Profiler.stop');
    fs.writeFileSync(process.env.PROFILE_OUTPUT, JSON.stringify(profile));
    session.disconnect();
}
assert.equal(fs.readFileSync(file, 'utf8'), chat.map(row => JSON.stringify(row)).join('\n'));
console.log(JSON.stringify({ runs, elapsed_ms: elapsed, ms_per_save: elapsed / runs, backupsEnabled: false, scopedProfile: Boolean(process.env.PROFILE_OUTPUT) }));
