import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { checkDeploy, parseDeployArgs } from '../src/deploy-check.js';

const MiB = 1024 * 1024;
async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deploy-check-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const configPath = path.join(root, 'config.yaml');
    const dataRoot = path.join(root, 'data');
    await fs.mkdir(dataRoot);
    await fs.writeFile(configPath, `exclusiveDataRoot: true\ndataRoot: ${JSON.stringify(dataRoot)}\n`);
    const dependencies = { env: {}, cgroupPaths: [], totalmem: () => 1024 * MiB, memoryEvidence: path.join(root, 'absent-evidence') };
    return { root, configPath, dataRoot, dependencies };
}
async function snapshot(root) {
    const result = [];
    for (const name of (await fs.readdir(root, { recursive: true })).sort()) {
        const target = path.join(root, name);
        const stat = await fs.lstat(target);
        result.push([name, stat.size, stat.mtimeMs, stat.isFile() ? (await fs.readFile(target)).toString('base64') : null]);
    }
    return result;
}

test('deployment scan is read-only, finds largest visible chat, and keeps recycle off by default', async t => {
    const f = await fixture(t);
    await fs.mkdir(path.join(f.dataRoot, 'chats'));
    await fs.writeFile(path.join(f.dataRoot, 'chats', 'large.jsonl'), 'x'.repeat(4096));
    await fs.mkdir(path.join(f.dataRoot, '.recycle'));
    await fs.writeFile(path.join(f.dataRoot, '.recycle', 'larger.jsonl'), 'x'.repeat(8192));
    const before = await snapshot(f.root);
    const report = await checkDeploy(f, f.dependencies);
    assert.equal(report.exitCode, 0);
    assert.equal(report.maxRecycleBytes, -1);
    assert.equal(report.largestChat.bytes, 4096);
    assert.match(report.exportEstimate.source, /Fallback/);
    assert.deepEqual(await snapshot(f.root), before);
});

test('CLI > environment > YAML precedence matches standalone server settings', async t => {
    const f = await fixture(t);
    const deps = { ...f.dependencies, env: { SILLYTAVERN_EXCLUSIVEDATAROOT: 'false', SILLYTAVERN_DATAROOT: f.dataRoot, SILLYTAVERN_BACKUPS_CHAT_MAXRECYCLEBYTES: '123' } };
    const report = await checkDeploy({ configPath: f.configPath }, deps);
    assert.equal(report.exclusiveDataRoot, false);
    assert.equal(report.exitCode, 1);
    assert.equal(report.maxRecycleBytes, 123);
    assert.ok(report.checks.some(c => c.level === 'FAIL'));
    assert.equal((await checkDeploy({ ...f, exclusiveDataRoot: true }, deps)).exitCode, 0);
});

for (const [name, value, warning] of [['v2', String(256 * MiB), true], ['v1', String(768 * MiB), false], ['unlimited-v2', 'max', false], ['unlimited-v1', '9223372036854771712', false]]) {
    test(`injected cgroup ${name} memory limit`, async t => {
        const f = await fixture(t);
        const file = path.join(f.root, 'memory-limit');
        await fs.writeFile(file, value);
        const report = await checkDeploy(f, { ...f.dependencies, cgroupPaths: [path.join(f.root, 'missing'), file] });
        assert.equal(report.exitCode, warning ? 1 : 0);
        assert.equal(report.memoryLimit.bytes, warning ? 256 * MiB : name === 'v1' ? 768 * MiB : 1024 * MiB);
        assert.equal(report.checks.some(c => c.level === 'FAIL'), false);
    });
}

test('measured figures and estimated need can warn above the 512 MiB floor', async t => {
    const f = await fixture(t);
    const evidence = path.join(f.root, 'evidence.json');
    await fs.writeFile(evidence, JSON.stringify({ inputBytes: 100 * MiB, current: { peakRss: 900 * MiB } }));
    const report = await checkDeploy(f, { ...f.dependencies, memoryEvidence: evidence });
    assert.equal(report.exportEstimate.measuredPeakRssBytes, 900 * MiB);
    assert.equal(report.exportEstimate.bytes, 1125 * MiB);
    assert.equal(report.exitCode, 1);
});

test('missing and unwritable roots fail without creating a root or probe file', async t => {
    const f = await fixture(t);
    const missing = path.join(f.root, 'missing-data');
    assert.equal((await checkDeploy({ ...f, dataRoot: missing }, f.dependencies)).exitCode, 1);
    await assert.rejects(fs.stat(missing), { code: 'ENOENT' });
    const before = await snapshot(f.root);
    const report = await checkDeploy(f, { ...f.dependencies, access: async () => { throw new Error('simulated EACCES (also covers Windows access failure)'); } });
    assert.ok(report.checks.some(c => c.check === 'dataRoot' && c.level === 'FAIL'));
    assert.deepEqual(await snapshot(f.root), before);
});

test('strict arguments accept server aliases and reject usage errors', () => {
    assert.deepEqual(parseDeployArgs(['--configPath', 'a', '--dataRoot', 'b', '--exclusiveDataRoot', 'false', '--json']), { configPath: 'a', dataRoot: 'b', exclusiveDataRoot: false, json: true });
    assert.equal(parseDeployArgs(['--exclusiveDataRoot']).exclusiveDataRoot, true);
    assert.equal(parseDeployArgs(['--exclusiveDataRoot=false']).exclusiveDataRoot, false);
    assert.equal(parseDeployArgs(['--no-exclusiveDataRoot']).exclusiveDataRoot, false);
    for (const args of [['--config'], ['--what'], ['--json', '--json'], ['--exclusiveDataRoot', 'bad']]) assert.throws(() => parseDeployArgs(args), /Usage/);
});

test('CLI JSON and exit codes 0, 1, 2', async t => {
    const f = await fixture(t);
    const run = args => {
        try { return { status: 0, text: execFileSync(process.execPath, ['scripts/check-deploy.mjs', ...args], { encoding: 'utf8', env: { ...process.env, SILLYTAVERN_EXCLUSIVEDATAROOT: 'true' } }) }; }
        catch (error) { return { status: error.status, text: error.stdout }; }
    };
    const good = run(['--config', f.configPath, '--json']);
    // Actual CI containers may have a memory limit below the advisory floor.
    assert.equal(good.status, JSON.parse(good.text).exitCode);
    assert.ok([0, 1].includes(good.status));
    const fail = run(['--config', f.configPath, '--exclusiveDataRoot', 'false', '--json']);
    assert.equal(fail.status, 1);
    assert.ok(JSON.parse(fail.text).checks.some(c => c.level === 'FAIL'));
    const bad = run(['--bad', '--json']);
    assert.equal(bad.status, 2);
    assert.match(JSON.parse(bad.text).error, /Usage/);
});
