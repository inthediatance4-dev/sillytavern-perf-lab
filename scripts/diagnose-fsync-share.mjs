// Diagnostic only: durability is disabled solely within the stubbed samples of this process.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { summarize, medianDifference } from './benchmark-statistics.mjs';

const runs = Number(process.env.DIAGNOSTIC_RUNS || 30);
assert.ok(Number.isSafeInteger(runs) && runs >= 30, 'DIAGNOSTIC_RUNS must be at least 30');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnose-fsync-'));
globalThis.DATA_ROOT = root;
const config = path.join(root, 'config.yaml');
fs.writeFileSync(config, 'backups:\n  chat:\n    enabled: false\n');
const { setConfigFilePath } = await import('../src/util.js');
setConfigFilePath(config);
const { trySaveChat } = await import('../src/endpoints/chats.js');
const chat = [{ chat_metadata: {} }, ...Array.from({ length: 1000 }, (_, i) => ({ name: 'Synthetic', mes: 'synthetic text '.repeat(22) + i }))];
const file = path.join(root, 'chat.jsonl');
const save = () => trySaveChat(chat, file, false, 'synthetic', 'Synthetic', root, root);
const handle = await fs.promises.open(path.join(root, 'probe'), 'w');
const handlePrototype = Object.getPrototypeOf(handle);
await handle.close();
const patches = [
    ...['fsync', 'fdatasync'].map(name => [fs, name, (_fd, callback) => queueMicrotask(() => callback(null))]),
    ...['fsync', 'fdatasync'].filter(name => typeof fs.promises[name] === 'function').map(name => [fs.promises, name, async () => {}]),
    ...['sync', 'datasync'].map(name => [handlePrototype, name, async () => {}]),
].map(([object, name, stub]) => ({ object, name, stub, original: object[name] }));
const samples = { normal: [], stubbed: [] };
let stubCalls = 0;
async function sample(variant, record) {
    if (variant === 'stubbed') {
        for (const patch of patches) patch.object[patch.name] = (...args) => { stubCalls++; return patch.stub(...args); };
    }
    try {
        const started = performance.now();
        await save();
        if (record) samples[variant].push(performance.now() - started);
    } finally {
        for (const patch of patches) patch.object[patch.name] = patch.original;
    }
}
try {
    for (let i = 0; i < runs + 5; i++) {
        for (const variant of i % 2 ? ['stubbed', 'normal'] : ['normal', 'stubbed']) await sample(variant, i >= 5);
    }
    assert.equal(fs.readFileSync(file, 'utf8'), chat.map(row => JSON.stringify(row)).join('\n'));
    assert.ok(stubCalls > 0, 'The diagnostic must intercept durability calls');
    const normal = summarize(samples.normal);
    const stubbed = summarize(samples.stubbed);
    console.log(JSON.stringify({
        diagnostic_only: true,
        caveat: 'Local interleaved estimate; stubbing changes scheduling and does not measure production durability cost precisely. Negative estimates indicate noise.',
        node: process.version, platform: process.platform, runs_per_variant: runs, warmups_per_variant: 5,
        backups_enabled: false, stub_calls: stubCalls,
        patched_methods: patches.map(patch => patch.name), normal_ms: normal, stubbed_ms: stubbed,
        stubbed_minus_normal_ms: medianDifference(samples.normal, samples.stubbed),
        estimated_fsync_share_percent: { median: 100 * (normal.median - stubbed.median) / normal.median, p95: 100 * (normal.p95 - stubbed.p95) / normal.p95 },
    }, null, 2));
} finally {
    // Only this diagnostic's synthetic temporary data is removed.
    fs.rmSync(root, { recursive: true, force: true });
}
