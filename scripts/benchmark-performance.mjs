import assert from 'node:assert/strict';
import { summarize, medianDifference, referenceCriteria, bootstrapSeed, resamples } from './benchmark-statistics.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const root = path.resolve('.fixtures', `benchmark-${randomUUID()}`);
fs.mkdirSync(root, { recursive: true });
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
globalThis.DATA_ROOT = root;
const config = path.join(root, 'config.yaml');
fs.writeFileSync(config, 'backups:\n  chat:\n    enabled: false\n');
const util = await import('../src/util.js');
util.setConfigFilePath(config);
const { getChatInfo, trySaveChat } = await import('../src/endpoints/chats.js');
const { createTextMatcher } = await import('../src/chat-search.js');
const { writeChatFile, recycleOldChatBackups } = await import('../src/chat-io.js');
const baselineCommit = execFileSync('git', ['rev-parse', '--verify', `${process.env.BENCH_BASELINE || '48a153e'}^{commit}`], { encoding: 'utf8' }).trim();
const runs = Number(process.env.BENCH_RUNS || 30);
assert.ok(Number.isSafeInteger(runs) && runs >= 30, 'BENCH_RUNS must be an integer >= 30');
const warmup = Number(process.env.BENCH_WARMUP || 5);
assert.ok(Number.isSafeInteger(warmup) && warmup >= 1, 'BENCH_WARMUP must be an integer >= 1');
// Archive the actual modules under the fixture so both variants resolve the same
// installed dependencies. No worktree, branch, tag or baseline source is modified.
const baselineRoot = path.join(root, 'baseline');
fs.mkdirSync(baselineRoot);
const archive = execFileSync('git', ['archive', baselineCommit, 'src', 'package.json'], { maxBuffer: 32 * 1024 * 1024 });
execFileSync('tar', ['-xf', '-'], { input: archive, cwd: baselineRoot });
const loadBaseline = file => import(pathToFileURL(path.join(baselineRoot, 'src', file)).href);
const baselineUtil = await loadBaseline('util.js');
baselineUtil.setConfigFilePath(config);
const baselineChats = await loadBaseline('endpoints/chats.js');
const baselineIO = await loadBaseline('chat-io.js');
const baselineSearch = await loadBaseline('chat-search.js');
const baselineInfo = baselineChats.getChatInfo;
const baselineMatcher = baselineSearch.createTextMatcher;
const output = { node: process.version, platform: process.platform, baselineCommit, currentCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), runs, warmup, bootstrap: { resamples, seed: bootstrapSeed, method: 'percentile; paired iterations for median differences', confidence: 0.95 }, variantLabels: { baseline: 'baseline', improved: 'current' }, syntheticOnly: true, backupsEnabled: false, search: [], backup: {}, io: {}, saveChat: {} };

for (const count of [1000, 2000, 4000]) {
    const file = path.join(root, `chat-${count}.jsonl`);
    const content = [{ chat_metadata: {} }, ...Array.from({ length: count }, (_, i) => ({ name: 'Synthetic', mes: 'ordinary synthetic text '.repeat(22) + i, send_date: '2026-01-01' }))].map(row => JSON.stringify(row)).join('\n');
    fs.writeFileSync(file, content);
    const timings = { baseline: [], improved: [] };
    for (let run = 0; run < runs; run++) {
        const names = run % 2 ? ['improved', 'baseline'] : ['baseline', 'improved'];
        for (const name of names) {
            const start = performance.now();
            const result = await (name === 'baseline' ? baselineInfo(file, {}, false, baselineMatcher(['absent-needle'])) : getChatInfo(file, {}, false, createTextMatcher(['absent-needle'])));
            timings[name].push(performance.now() - start);
            assert.equal(result.chat_items, count);
            assert.equal(result.match, false);
        }
    }
    const checks = {};
    for (const name of ['baseline', 'improved']) {
        let calls = 0;
        const originalLower = String.prototype.toLowerCase;
        String.prototype.toLowerCase = function () { calls++; return originalLower.call(this); };
        try {
            await (name === 'baseline' ? baselineInfo(file, {}, false, baselineMatcher(['absent-needle'])) : getChatInfo(file, {}, false, createTextMatcher(['absent-needle'])));
        } finally { String.prototype.toLowerCase = originalLower; }
        checks[name] = calls;
    }
    // Multi-fragment equivalence, including fragments from different messages.
    for (const fragments of [['text', String(count - 1)], ['absent'], []]) {
        assert.deepEqual(await getChatInfo(file, {}, true, createTextMatcher(fragments)), await baselineInfo(file, {}, true, baselineMatcher(fragments)));
    }
    output.search.push({ messages: count, bytes: Buffer.byteLength(content), baseline_ms: summarize(timings.baseline), improved_ms: summarize(timings.improved), baseline_text_checks: checks.baseline, improved_text_checks: checks.improved });
}

let baselineStats = 0;
const count = 5000;
const names = Array.from({ length: count }, (_, i) => `chat_synthetic_${i}.jsonl`);
const fakeFs = { readdirSync: () => names.slice(), statSync: file => { baselineStats++; return { mtimeMs: (Number(path.parse(file).name.split('_').at(-1)) * 7919) % 104729 }; }, unlinkSync: () => {} };
const originalSync = { readdirSync: fs.readdirSync, statSync: fs.statSync, unlinkSync: fs.unlinkSync };
Object.assign(fs, fakeFs);
try { baselineUtil.removeOldBackups('synthetic', 'chat_', 50); }
finally { Object.assign(fs, originalSync); }
let improvedStats = 0;
const real = { readdir: fs.promises.readdir, stat: fs.promises.stat, mkdir: fs.promises.mkdir, rename: fs.promises.rename };
fs.promises.readdir = async () => names.map(name => ({ name, isFile: () => true }));
fs.promises.stat = async file => { improvedStats++; return { mtimeMs: (Number(path.parse(file).name.split('_').at(-1)) * 7919) % 104729 }; };
fs.promises.mkdir = async () => undefined;
fs.promises.rename = async () => undefined;
try { await recycleOldChatBackups('synthetic', 'chat_', 50); }
finally { Object.assign(fs.promises, real); }
output.backup = { candidates: count, baseline_stat_calls: baselineStats, improved_stat_calls: improvedStats, filesystem: 'mocked; nothing deleted or moved' };

const payload = 'x'.repeat(10 * 1024 * 1024);
const chat = [{ chat_metadata: {} }, ...Array.from({ length: 1000 }, (_, i) => ({ name: 'Synthetic', mes: 'synthetic text '.repeat(22) + i }))];
const serializedChat = chat.map(row => JSON.stringify(row)).join('\n');
const variants = {
    baseline: { save: baselineChats.trySaveChat, write: baselineIO.writeChatFile },
    improved: { save: trySaveChat, write: writeChatFile },
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const [measurement, data, expected] of [['saveChat', chat, serializedChat], ['io', payload, payload]]) {
    const samples = Object.fromEntries(Object.keys(variants).map(name => [name, { operation: [], eventLoop: [] }]));
    for (let run = 0; run < warmup; run++) {
        for (const name of run % 2 ? ['improved', 'baseline'] : ['baseline', 'improved']) {
            const file = path.join(root, `${measurement}-${name}.jsonl`);
            if (measurement === 'saveChat') await variants[name].save(data, file, false, 'synthetic', 'Synthetic', root, root);
            else await variants[name].write(file, data);
        }
    }
    for (let run = 0; run < runs; run++) {
        for (const name of run % 2 ? ['improved', 'baseline'] : ['baseline', 'improved']) {
            const file = path.join(root, `${measurement}-${name}.jsonl`);
            const histogram = monitorEventLoopDelay({ resolution: 1 });
            histogram.enable();
            await sleep(10); // Arm the monitor before any synchronous work starts.
            histogram.reset();
            const start = performance.now();
            if (measurement === 'saveChat') await variants[name].save(data, file, false, 'synthetic', 'Synthetic', root, root);
            else await variants[name].write(file, data);
            samples[name].operation.push(performance.now() - start);
            await sleep(10); // Allow the delayed monitor callback to run.
            histogram.disable();
            samples[name].eventLoop.push(histogram.percentile(95) / 1e6);
            assert.equal(await fs.promises.readFile(file, 'utf8'), expected);
        }
    }
    output[measurement].median_difference_ms = medianDifference(samples.baseline.operation, samples.improved.operation);
    output[measurement].event_loop_median_difference_ms = medianDifference(samples.baseline.eventLoop, samples.improved.eventLoop);
    for (const name of Object.keys(variants)) {
        output[measurement][name] = {
            bytes: Buffer.byteLength(expected),
            operation_ms: summarize(samples[name].operation),
            event_loop_delay_p95_ms: summarize(samples[name].eventLoop),
        };
    }
}
output.reference_criteria = {};
for (const measurement of ['saveChat', 'io']) {
    const { baseline, improved } = output[measurement];
    output.reference_criteria[measurement] = referenceCriteria(baseline.operation_ms, improved.operation_ms);
}
console.log(JSON.stringify(output, null, 2));
