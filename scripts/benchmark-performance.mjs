import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

const root = path.resolve('.fixtures', `benchmark-${randomUUID()}`);
fs.mkdirSync(root, { recursive: true });
globalThis.DATA_ROOT = root;
const config = path.join(root, 'config.yaml');
fs.writeFileSync(config, 'backups:\n  chat:\n    enabled: false\n');
const util = await import('../src/util.js');
util.setConfigFilePath(config);
const { getChatInfo } = await import('../src/endpoints/chats.js');
const { createTextMatcher } = await import('../src/chat-search.js');
const { writeChatFile, recycleOldChatBackups } = await import('../src/chat-io.js');
const baselineCommit = 'db53872d3e2256e0214fbf0576f9e125eb50592d';
const original = execFileSync('git', ['show', `${baselineCommit}:src/endpoints/chats.js`], { encoding: 'utf8' });
const originalUtil = execFileSync('git', ['show', `${baselineCommit}:src/util.js`], { encoding: 'utf8' });
const infoSource = original.slice(original.indexOf('export async function getChatInfo('), original.indexOf('export const router = express.Router();')).replace('export async', 'async');
const baselineInfo = new Function('fs', 'path', 'readline', '_', 'formatBytes', 'tryParse', infoSource + '\nreturn getChatInfo;')(fs, path, readline, { isObjectLike: value => value !== null && typeof value === 'object' }, util.formatBytes, util.tryParse);
const matcherSource = original.slice(original.indexOf('const hasTextMatch = (textArray) => {'), original.indexOf('for (const chatFile of chatFiles) {'));
const baselineMatcher = new Function('fragments', matcherSource + '\nreturn hasTextMatch;');
const output = { node: process.version, platform: process.platform, baselineCommit, syntheticOnly: true, search: [], backup: {}, io: {} };
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

for (const count of [1000, 2000, 4000]) {
    const file = path.join(root, `chat-${count}.jsonl`);
    const content = [{ chat_metadata: {} }, ...Array.from({ length: count }, (_, i) => ({ name: 'Synthetic', mes: 'ordinary synthetic text '.repeat(22) + i, send_date: '2026-01-01' }))].map(row => JSON.stringify(row)).join('\n');
    fs.writeFileSync(file, content);
    const timings = { baseline: [], improved: [] };
    for (let run = 0; run < 3; run++) {
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
    output.search.push({ messages: count, bytes: Buffer.byteLength(content), baseline_ms: Number(median(timings.baseline).toFixed(2)), improved_ms: Number(median(timings.improved).toFixed(2)), baseline_text_checks: checks.baseline, improved_text_checks: checks.improved });
}

const cleanupStart = originalUtil.indexOf('export function removeOldBackups(');
const cleanupSource = originalUtil.slice(cleanupStart, originalUtil.indexOf('\n/**', cleanupStart)).replace('export function', 'function');
let baselineStats = 0;
const count = 5000;
const names = Array.from({ length: count }, (_, i) => `chat_synthetic_${i}.jsonl`);
const fakeFs = { readdirSync: () => names.slice(), statSync: file => { baselineStats++; return { mtimeMs: (Number(path.parse(file).name.split('_').at(-1)) * 7919) % 104729 }; }, unlinkSync: () => {} };
new Function('fs', 'path', 'getConfigValue', cleanupSource + '\nreturn removeOldBackups;')(fakeFs, path, () => 50)('synthetic', 'chat_', 50);
let improvedStats = 0;
const real = { readdir: fs.promises.readdir, stat: fs.promises.stat, mkdir: fs.promises.mkdir, rename: fs.promises.rename };
fs.promises.readdir = async () => names.map(name => ({ name, isFile: () => true }));
fs.promises.stat = async file => { improvedStats++; return { mtimeMs: (Number(path.parse(file).name.split('_').at(-1)) * 7919) % 104729 }; };
fs.promises.mkdir = async () => undefined;
fs.promises.rename = async () => undefined;
try { await recycleOldChatBackups('synthetic', 'chat_', 50); }
finally { Object.assign(fs.promises, real); }
output.backup = { candidates: count, baseline_stat_calls: baselineStats, improved_stat_calls: improvedStats, filesystem: 'mocked; nothing deleted or moved' };

const payload = JSON.stringify({ synthetic: 'x'.repeat(10 * 1024 * 1024) });
for (const variant of ['baseline', 'improved']) {
    const file = path.join(root, `write-${variant}.jsonl`);
    const start = performance.now();
    const timer = new Promise(resolve => setTimeout(() => resolve(performance.now() - start), 0));
    if (variant === 'baseline') writeFileAtomicSync(file, payload, 'utf8');
    else await writeChatFile(file, payload);
    const total = performance.now() - start;
    const timerDelay = await timer;
    assert.equal(await fs.promises.readFile(file, 'utf8'), payload);
    output.io[variant] = { bytes: Buffer.byteLength(payload), operation_ms: Number(total.toFixed(2)), timer_response_ms: Number(timerDelay.toFixed(2)) };
}
fs.mkdirSync('.evidence', { recursive: true });
fs.writeFileSync('.evidence/performance-results.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
