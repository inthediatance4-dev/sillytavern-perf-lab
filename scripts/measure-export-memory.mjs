import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(import.meta.url);

if (process.argv[2] === '--worker') {
    const [moduleRoot, fixture] = process.argv.slice(3);
    globalThis.DATA_ROOT = fixture;
    const util = await import(pathToFileURL(path.join(moduleRoot, 'src/util.js')).href);
    util.setConfigFilePath(path.join(fixture, 'config.yaml'));
    const { router } = await import(pathToFileURL(path.join(moduleRoot, 'src/endpoints/chats.js')).href);
    const route = router.stack.find(layer => layer.route?.path === '/export').route;
    const handler = route.stack.at(-1).handle;
    console.info = () => {};
    globalThis.gc();
    const initial = process.memoryUsage();
    let peakRss = initial.rss;
    let peakHeapUsed = initial.heapUsed;
    let samples = 0;
    function sample() {
        const memory = process.memoryUsage();
        peakRss = Math.max(peakRss, memory.rss);
        peakHeapUsed = Math.max(peakHeapUsed, memory.heapUsed);
        samples++;
    }
    const timer = setInterval(sample, 2);
    const start = performance.now();
    const rowsForOutput = Math.ceil(fs.statSync(path.join(fixture, 'chat.jsonl')).size / Buffer.byteLength(JSON.stringify({ name: 'Synthetic', is_user: true, mes: 'synthetic message '.repeat(240) }) + '\n'));
    let outputBytes;
    let responseBytes;
    const responseHash = createHash('sha256');
    try {
        await new Promise((resolve, reject) => {
            outputBytes = 0;
            responseBytes = 0;
            const response = new Writable({
                write(chunk, _encoding, callback) {
                    responseBytes += chunk.length;
                    responseHash.update(chunk);
                    sample();
                    callback();
                },
            });
            response.status = code => { assert.equal(code, 200); return response; };
            response.set = () => response;
            response.sendStatus = code => reject(new Error(`Export failed: ${code}`));
            response.json = body => {
                sample();
                outputBytes = Buffer.byteLength(body.result);
                const serialized = JSON.stringify(body);
                responseBytes = Buffer.byteLength(serialized);
                responseHash.update(serialized);
                sample();
                resolve();
            };
            response.on('finish', () => {
                // The synthetic text has no JSON escapes other than its two newlines per row.
                outputBytes = rowsForOutput * Buffer.byteLength('Synthetic: ' + 'synthetic message '.repeat(240) + '\n\n');
                resolve();
            });
            response.on('error', reject);
            Promise.resolve(handler({ body: { is_group: true, file: 'chat.jsonl', format: 'txt', exportfilename: 'synthetic.txt' }, user: { directories: { groupChats: fixture } } }, response)).catch(reject);
        });
    } finally {
        clearInterval(timer);
    }
    sample();
    console.log(JSON.stringify({ initial, peakRss, peakHeapUsed, rssIncrease: peakRss - initial.rss, heapUsedIncrease: peakHeapUsed - initial.heapUsed,
        processLifetimeMaxRssBytes: process.resourceUsage().maxRSS * 1024, samples, elapsedMs: performance.now() - start, outputBytes, responseBytes, responseSha256: responseHash.digest('hex') }));
} else {
    assert.equal(process.argv.length, 2, 'Usage: node scripts/measure-export-memory.mjs');
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'export-memory-'));
    // Baseline modules must live under the repository to resolve the installed dependencies.
    const baseline = fs.mkdtempSync(path.join(repository, '.export-memory-baseline-'));
    try {
        fs.writeFileSync(path.join(fixture, 'config.yaml'), 'backups:\n  chat:\n    enabled: false\n');
        const row = JSON.stringify({ name: 'Synthetic', is_user: true, mes: 'synthetic message '.repeat(240) }) + '\n';
        const rows = Math.ceil(100 * 1024 * 1024 / Buffer.byteLength(row));
        const fd = fs.openSync(path.join(fixture, 'chat.jsonl'), 'wx');
        try { for (let i = 0; i < rows; i++) fs.writeSync(fd, row); }
        finally { fs.closeSync(fd); }
        const baselineCommit = execFileSync('git', ['rev-parse', '48a153e^{commit}'], { cwd: repository, encoding: 'utf8' }).trim();
        let baselineError;
        try {
            const archive = execFileSync('git', ['archive', baselineCommit, 'src', 'package.json'], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
            execFileSync('tar', ['-xf', '-'], { input: archive, cwd: baseline });
        } catch (error) { baselineError = error.message; }
        function measure(moduleRoot) {
            const stdout = execFileSync(process.execPath, ['--expose-gc', script, '--worker', moduleRoot, fixture], { cwd: repository, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
            return JSON.parse(stdout.trim().split('\n').at(-1));
        }
        const current = measure(repository);
        let old;
        if (!baselineError) {
            try { old = measure(baseline); }
            catch (error) { baselineError = error.message; }
        }
        if (old) {
            assert.equal(current.outputBytes, old.outputBytes);
            assert.equal(current.responseBytes, old.responseBytes);
            assert.equal(current.responseSha256, old.responseSha256);
        }
        console.log(JSON.stringify({ node: process.version, platform: process.platform, baselineCommit,
            currentCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(), workingTreeChangesIncluded: true,
            syntheticOnly: true, inputBytes: fs.statSync(path.join(fixture, 'chat.jsonl')).size, rows,
            method: 'Separate --expose-gc workers; actual /export route handler in-process; 2ms memoryUsage sampling plus response-boundary samples; Current streams JSON into a counting Writable with backpressure; baseline Express JSON serialization simulated without HTTP transport. Sampled peaks can miss transient allocations; processLifetimeMaxRssBytes includes module loading.',
            baselineBufferedWholeOutput: true, baselineBufferingEvidence: '48a153e src/endpoints/chats.js /export accumulates buffer += on each readline line and responds only on close.',
            current, baseline: old ?? { unavailable: baselineError } }, null, 2));
    } finally {
        // Only this script's synthetic fixtures and extracted baseline modules are removed.
        fs.rmSync(fixture, { recursive: true, force: true });
        fs.rmSync(baseline, { recursive: true, force: true });
    }
}
