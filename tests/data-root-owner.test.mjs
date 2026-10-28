import { symlinkOrSkip } from './helpers/symlink-capability.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    acquireDataRootOwnership,
    DATA_ROOT_OWNER_LOCK,
    DATA_ROOT_OWNER_RECLAIM,
    DATA_ROOT_RECLAIM_TIMEOUT_MS,
    releaseDataRootOwnership,
} from '../src/data-root-owner.js';
import { readProcessIdentity } from '../src/process-identity.js';

function assertWindowsCiIdentity(identity) {
    if (process.platform === 'win32' && process.env.CI) {
        assert.ok(Number.isSafeInteger(identity.processStartMs), 'Windows CI requires a reliable process start identity');
    }
}

const moduleUrl = new URL('../src/data-root-owner.js', import.meta.url).href;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'st-owner-'));
const helper = path.join(temp, 'acquire-once.mjs');
await fs.writeFile(helper, `
import fs from 'node:fs';
import { acquireDataRootOwnership } from ${JSON.stringify(moduleUrl)};
const root = process.argv[2];
const mode = process.argv[3] || 'exit';
const marker = process.argv[4];
if (mode === 'slow-peer-probe' && process.platform === 'linux') {
    const read = fs.readFileSync;
    const wait = new Int32Array(new SharedArrayBuffer(4));
    fs.readFileSync = (file, ...args) => {
        // Exercise the real identity comparison with Windows-like probe latency.
        if (file === '/proc/' + process.ppid + '/stat') Atomics.wait(wait, 0, 0, 300);
        return read(file, ...args);
    };
}
if (mode === 'clock-shift') {
    const read = fs.readFileSync;
    fs.readFileSync = (file, ...args) => {
        const value = read(file, ...args);
        return file === '/proc/stat' ? value.replace(/^btime (\\d+)$/m, (_, seconds) => 'btime ' + (Number(seconds) + 60)) : value;
    };
}
try {
    acquireDataRootOwnership(root);
} catch (error) {
    if (marker) fs.writeFileSync(marker, 'err\\n' + (error && error.message ? error.message : error));
    console.error(error.message);
    process.exit(1);
}
if (mode === 'exit-code') process.exit(1);
if (mode === 'throw') setTimeout(() => { throw new Error('boom'); }, 30);
if (mode === 'hold') {
    if (marker) fs.writeFileSync(marker, 'ok');
    setInterval(() => {}, 1000);
}
`);

function runAcquire(dataRoot, mode = 'exit', timeout = 10000) {
    return spawnSync(process.execPath, [helper, dataRoot, mode], { encoding: 'utf8', timeout });
}

async function waitForMarker(file) {
    const started = Date.now();
    while (Date.now() - started < 8000) {
        try {
            return await fs.readFile(file, 'utf8');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${file}`);
}

function exitedPid() {
    const result = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    assert.equal(result.status, 0);
    assert.throws(() => process.kill(result.pid, 0), error => error.code === 'ESRCH');
    return result.pid;
}

// Impossible historical identity makes PID reuse irrelevant to marker/race tests.
function staleRecord() {
    return { v: 2, pid: process.pid, hostname: os.hostname(), startedAt: '2000-01-01',
        bootId: 'win-boot:1', startTicks: '0', processStartMs: 0 };
}

async function freshRoot(name) {
    const dataRoot = path.join(temp, name);
    await fs.mkdir(dataRoot);
    return dataRoot;
}

test('a live owner blocks another process and leaves the lock unchanged', async () => {
    const dataRoot = await freshRoot('live');
    const owned = acquireDataRootOwnership(dataRoot);
    const before = await fs.readFile(owned.lockPath, 'utf8');
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(String(message));
    try {
        const child = runAcquire(dataRoot);
        assert.notEqual(child.status, 0);
        assert.ok(child.stderr.includes(owned.lockPath));
        assert.ok(child.stderr.includes(`Verify the owner process is really gone, then delete ${owned.lockPath}`));
        assert.match(child.stderr, new RegExp(`pid ${process.pid}`));
        assert.match(child.stderr, new RegExp(os.hostname().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.equal(await fs.readFile(owned.lockPath, 'utf8'), before);
        assert.deepEqual(warnings, []);
    } finally {
        console.warn = originalWarn;
        releaseDataRootOwnership();
    }
    assert.equal(await fs.access(owned.lockPath).then(() => true, () => false), false);
});

test('the same process cannot take a second root while it still owns one', async () => {
    const dataRoot = await freshRoot('second');
    const owned = acquireDataRootOwnership(dataRoot);
    const before = await fs.readFile(owned.lockPath, 'utf8');
    try {
        assert.throws(() => acquireDataRootOwnership(dataRoot), /already owns/);
        assert.equal(await fs.readFile(owned.lockPath, 'utf8'), before);
    } finally {
        releaseDataRootOwnership();
    }
    const again = acquireDataRootOwnership(dataRoot);
    assert.equal(again.pid, process.pid);
    releaseDataRootOwnership();
    assert.equal(await fs.access(again.lockPath).then(() => true, () => false), false);
});

test('a dead pid on this host is reclaimed', async () => {
    const dataRoot = await freshRoot('stale');
    const lockPath = path.join(dataRoot, DATA_ROOT_OWNER_LOCK);
    const stale = { pid: exitedPid(), hostname: os.hostname(), startedAt: '2000-01-01T00:00:00.000Z' };
    await fs.writeFile(lockPath, `${JSON.stringify(stale)}\n`);
    // Legacy dead-PID coverage: pre-check immediately before acquisition.
    // Windows can still reuse a PID between this check and the acquisition.
    try { process.kill(stale.pid, 0); stale.pid = exitedPid(); }
    catch (error) { assert.equal(error.code, 'ESRCH'); }
    fsSync.writeFileSync(lockPath, `${JSON.stringify(stale)}\n`);
    const owned = acquireDataRootOwnership(dataRoot);
    try {
        const current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
        assert.equal(current.pid, process.pid);
        assert.equal(current.hostname, os.hostname());
        assert.equal(owned.lockPath, lockPath);
    } finally {
        releaseDataRootOwnership();
    }
});

test('a dead pid on another host is not reclaimed', async () => {
    const dataRoot = await freshRoot('other-host');
    const lockPath = path.join(dataRoot, DATA_ROOT_OWNER_LOCK);
    const stale = { pid: exitedPid(), hostname: `other-${os.hostname()}`, startedAt: '2000-01-01T00:00:00.000Z' };
    const payload = `${JSON.stringify(stale)}\n`;
    await fs.writeFile(lockPath, payload);
    assert.throws(() => acquireDataRootOwnership(dataRoot), /Another process must not share this data root/);
    assert.equal(await fs.readFile(lockPath, 'utf8'), payload);
});

test('an unreadable owner file is left in place', async () => {
    const dataRoot = await freshRoot('corrupt');
    const lockPath = path.join(dataRoot, DATA_ROOT_OWNER_LOCK);
    await fs.writeFile(lockPath, '{');
    assert.throws(() => acquireDataRootOwnership(dataRoot), /unreadable/);
    assert.equal(await fs.readFile(lockPath, 'utf8'), '{');
});

test('a missing data root is created and a child exit removes the lock', async () => {
    const dataRoot = path.join(temp, 'missing', 'nested');
    const child = runAcquire(dataRoot);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(await fs.access(path.join(dataRoot, DATA_ROOT_OWNER_LOCK)).then(() => true, () => false), false);
    const stat = await fs.stat(dataRoot);
    assert.equal(stat.isDirectory(), true);
});

test('process.exit and an uncaught exception remove the lock', async () => {
    for (const mode of ['exit-code', 'throw']) {
        const dataRoot = await freshRoot(mode);
        const child = runAcquire(dataRoot, mode);
        assert.notEqual(child.status, 0, child.stderr);
        assert.equal(await fs.access(path.join(dataRoot, DATA_ROOT_OWNER_LOCK)).then(() => true, () => false), false, mode);
    }
});

test('a symlink owner file is not followed or rewritten', async t => {
    const dataRoot = await freshRoot('symlink');
    const lockPath = path.join(dataRoot, DATA_ROOT_OWNER_LOCK);
    const victim = path.join(dataRoot, 'victim');
    await fs.writeFile(victim, 'keep');
    if (!await symlinkOrSkip(t, victim, lockPath)) return;
    assert.throws(() => acquireDataRootOwnership(dataRoot), /left in place/);
    assert.equal(await fs.readFile(victim, 'utf8'), 'keep');
    const stat = await fs.lstat(lockPath);
    assert.equal(stat.isSymbolicLink(), true);
});

function normalizeOutcome(text) {
    return text.startsWith('err') ? 'err' : text;
}

async function assertSingleReclaimWinner(dataRoot) {
    const lockPath = path.join(dataRoot, DATA_ROOT_OWNER_LOCK);
    const firstMarker = path.join(dataRoot, 'first.txt');
    const secondMarker = path.join(dataRoot, 'second.txt');
    const first = spawn(process.execPath, [helper, dataRoot, 'hold', firstMarker], { stdio: 'ignore' });
    const second = spawn(process.execPath, [helper, dataRoot, 'hold', secondMarker], { stdio: 'ignore' });
    try {
        const markers = await Promise.all([waitForMarker(firstMarker), waitForMarker(secondMarker)]);
        assert.deepEqual(markers.map(normalizeOutcome).sort(), ['err', 'ok'], markers.join(' | '));
        const current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
        const winner = normalizeOutcome(markers[0]) === 'ok' ? first : second;
        assert.equal(current.pid, winner.pid);
        assert.equal(current.hostname, os.hostname());
        assert.equal(await fs.access(path.join(dataRoot, DATA_ROOT_OWNER_RECLAIM)).then(() => true, () => false), false);
        winner.kill('SIGKILL');
        await new Promise(resolve => winner.once('exit', resolve));
        const reclaimed = acquireDataRootOwnership(dataRoot);
        try {
            const after = JSON.parse(await fs.readFile(lockPath, 'utf8'));
            assert.equal(after.pid, process.pid);
            assert.equal(reclaimed.pid, process.pid);
        } finally {
            releaseDataRootOwnership();
        }
    } finally {
        first.kill('SIGKILL');
        second.kill('SIGKILL');
    }
}

test('two processes cannot both reclaim one stale owner', async () => {
    const dataRoot = await freshRoot('race');
    const lockPath = path.join(dataRoot, DATA_ROOT_OWNER_LOCK);
    const stale = staleRecord();
    await fs.writeFile(lockPath, `${JSON.stringify(stale)}\n`);
    await assertSingleReclaimWinner(dataRoot);
});

test('a stale reclaim marker is taken over once and a fresh one is not', async () => {
    assert.equal(DATA_ROOT_OWNER_RECLAIM, '.st-lab-owner.lock.reclaim');
    assert.ok(DATA_ROOT_RECLAIM_TIMEOUT_MS >= 1000);
    const dataRoot = await freshRoot('reclaim-timeout');
    const lockPath = path.join(dataRoot, DATA_ROOT_OWNER_LOCK);
    const reclaimPath = path.join(dataRoot, DATA_ROOT_OWNER_RECLAIM);
    const staleOwner = `${JSON.stringify(staleRecord())}\n`;
    const freshMarker = `${JSON.stringify({ ...staleRecord(), claimedAt: new Date().toISOString() })}\n`;
    await fs.writeFile(lockPath, staleOwner);
    await fs.writeFile(reclaimPath, freshMarker);
    assert.throws(() => acquireDataRootOwnership(dataRoot), /Could not acquire/);
    assert.equal(await fs.readFile(lockPath, 'utf8'), staleOwner);
    assert.equal(await fs.readFile(reclaimPath, 'utf8'), freshMarker);

    const expired = new Date(Date.now() - DATA_ROOT_RECLAIM_TIMEOUT_MS - 5000);
    await fs.utimes(reclaimPath, expired, expired);
    const owned = acquireDataRootOwnership(dataRoot);
    try {
        const current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
        assert.equal(current.pid, process.pid);
        assert.equal(owned.lockPath, lockPath);
        assert.equal(await fs.access(reclaimPath).then(() => true, () => false), false);
    } finally {
        releaseDataRootOwnership();
    }
});

test('acquiring a data root never spawns a compiler', async t => {
    const source = await fs.readFile(new URL('../src/data-root-owner.js', import.meta.url), 'utf8');
    assert.equal(source.includes('gcc'), false);
    assert.equal(source.includes('node_api'), false);
    assert.equal(source.includes('child_process'), false);
    assert.equal(source.includes('execFile'), false);
    assert.equal(source.includes('data-root-flock'), false);
    const identitySource = await fs.readFile(new URL('../src/process-identity.js', import.meta.url), 'utf8');
    assert.equal(identitySource.includes('gcc'), false);
    assert.equal(identitySource.includes('node_api'), false);
    assert.equal(identitySource.includes('data-root-flock'), false);
    assert.match(identitySource, /process\.platform !== 'win32'/);
    assert.equal(await fs.access(new URL('../src/data-root-flock.c', import.meta.url)).then(() => true, () => false), false);

    const dataRoot = await freshRoot('no-compiler');
    if (process.platform === 'win32') {
        const owned = acquireDataRootOwnership(dataRoot);
        assert.equal(owned.pid, process.pid);
        releaseDataRootOwnership();
        return t.skip('Compiler executable probes require POSIX shell scripts');
    }
    const bin = path.join(temp, 'fake-bin');
    await fs.mkdir(bin, { recursive: true });
    const log = path.join(temp, 'compiler-log');
    const script = `#!/bin/sh\nprintf '%s\\n' "$0" >> ${JSON.stringify(log)}\nexit 1\n`;
    for (const name of ['gcc', 'cc', 'clang']) {
        const file = path.join(bin, name);
        await fs.writeFile(file, script, { mode: 0o755 });
    }
    const child = spawnSync(process.execPath, [helper, dataRoot, 'exit'], {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, PATH: bin },
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(await fs.access(log).then(() => true, () => false), false);
});

test('EPERM from process.kill means the same-host owner is alive', async () => {
    const dataRoot = await freshRoot('eperm');
    const lockPath = path.join(dataRoot, DATA_ROOT_OWNER_LOCK);
    const payload = `${JSON.stringify({ pid: 424242, hostname: os.hostname(), startedAt: '2000-01-01T00:00:00.000Z' })}\n`;
    await fs.writeFile(lockPath, payload);
    const original = process.kill;
    process.kill = function patchedKill(pid, signal) {
        if (pid === 424242 && signal === 0) {
            const error = new Error('operation not permitted');
            error.code = 'EPERM';
            throw error;
        }
        return original.call(this, pid, signal);
    };
    try {
        assert.throws(() => acquireDataRootOwnership(dataRoot), /pid 424242/);
        assert.equal(await fs.readFile(lockPath, 'utf8'), payload);
    } finally {
        process.kill = original;
    }
});

test('an unexpected environment error refuses ownership with diagnostics', async () => {
    const dataRoot = await freshRoot('environment');
    const cause = Object.assign(new Error('simulated EIO'), { code: 'EIO' });
    const injected = { ...fsSync, openSync() { throw cause; } };
    assert.throws(() => acquireDataRootOwnership(dataRoot, { fs: injected }), error => {
        assert.equal(error.name, 'DataRootOwnershipUnverifiedError');
        assert.equal(error.cause, cause);
        assert.equal(error.op, 'open');
        assert.equal(error.lockPath, path.join(dataRoot, DATA_ROOT_OWNER_LOCK));
        return true;
    });
});

function ownerRecord(overrides = {}) {
    return {
        v: 2,
        pid: process.pid,
        hostname: os.hostname(),
        startedAt: '2000-01-01T00:00:00.000Z',
        token: 'forged-token',
        ...overrides,
    };
}

test('a new owner record stores a token and the host identity', async () => {
    const dataRoot = await freshRoot('identity-fields');
    const owned = acquireDataRootOwnership(dataRoot);
    try {
        const current = JSON.parse(await fs.readFile(owned.lockPath, 'utf8'));
        const identity = readProcessIdentity(process.pid);
        assertWindowsCiIdentity(identity);
        assert.equal(current.pid, process.pid);
        assert.equal(current.hostname, os.hostname());
        assert.match(current.token, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        assert.equal(owned.token, current.token);
        if (identity.bootId) assert.equal(current.bootId, identity.bootId);
        if (Number.isSafeInteger(identity.processStartMs)) assert.equal(current.processStartMs, identity.processStartMs);
        if (process.platform === 'linux') {
            assert.equal(typeof current.bootId, 'string');
            assert.equal(current.v, 2);
            assert.equal(current.startTicks, identity.startTicks);
        }
    } finally {
        releaseDataRootOwnership();
    }
});

test('a live pid with a different boot or start identity is reclaimed', async t => {
    const dataRoot = await freshRoot('pid-reuse');
    const lockPath = path.join(dataRoot, DATA_ROOT_OWNER_LOCK);
    const identity = readProcessIdentity(process.pid);
    assertWindowsCiIdentity(identity);
    const forged = ownerRecord({
        startTicks: identity.startTicks,
        bootId: identity.bootId ? `${identity.bootId}-reused` : 'forged-boot-id',
        processStartMs: Number.isSafeInteger(identity.processStartMs) ? identity.processStartMs + 60000 : 1,
    });
    await fs.writeFile(lockPath, `${JSON.stringify(forged)}\n`);
    const comparable = Boolean(identity.startTicks && identity.bootId) || Number.isSafeInteger(identity.processStartMs);
    if (!comparable) {
        assert.throws(() => acquireDataRootOwnership(dataRoot), /must not share this data root/);
        assert.equal(await fs.readFile(lockPath, 'utf8'), `${JSON.stringify(forged)}\n`);
        return t.skip('Reliable process start identity unavailable (PowerShell may be unavailable on local Windows); conservative refusal verified');
    }
    const owned = acquireDataRootOwnership(dataRoot);
    try {
        const current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
        assert.equal(current.pid, process.pid);
        assert.notEqual(current.token, forged.token);
        assert.equal(owned.token, current.token);
        if (identity.bootId) assert.equal(current.bootId, identity.bootId);
        if (Number.isSafeInteger(identity.processStartMs)) assert.equal(current.processStartMs, identity.processStartMs);
    } finally {
        releaseDataRootOwnership();
    }
});

test('a matching boot and start identity is refused even when the token differs', async () => {
    const dataRoot = await freshRoot('pid-match');
    const lockPath = path.join(dataRoot, DATA_ROOT_OWNER_LOCK);
    const identity = readProcessIdentity(process.pid);
    const forged = ownerRecord();
    if (identity.bootId) forged.bootId = identity.bootId;
    if (identity.startTicks) forged.startTicks = identity.startTicks;
    if (Number.isSafeInteger(identity.processStartMs)) forged.processStartMs = identity.processStartMs;
    const payload = `${JSON.stringify(forged)}\n`;
    await fs.writeFile(lockPath, payload);
    assert.throws(() => acquireDataRootOwnership(dataRoot), /must not share this data root/);
    assert.equal(await fs.readFile(lockPath, 'utf8'), payload);
});

test('a live pid without identity fields is kept', async () => {
    const dataRoot = await freshRoot('pid-no-identity');
    const lockPath = path.join(dataRoot, DATA_ROOT_OWNER_LOCK);
    const payload = `${JSON.stringify(ownerRecord())}\n`;
    await fs.writeFile(lockPath, payload);
    assert.throws(() => acquireDataRootOwnership(dataRoot), /must not share this data root/);
    assert.equal(await fs.readFile(lockPath, 'utf8'), payload);
});

test('EPERM with a matching identity refuses and a mismatch is reclaimed', async t => {
    const original = process.kill;
    process.kill = function patchedKill(pid, signal) {
        if (pid === process.pid && signal === 0) {
            const error = new Error('operation not permitted');
            error.code = 'EPERM';
            throw error;
        }
        return original.call(this, pid, signal);
    };
    try {
        const matchedRoot = await freshRoot('eperm-match');
        const matchedPath = path.join(matchedRoot, DATA_ROOT_OWNER_LOCK);
        const identity = readProcessIdentity(process.pid);
        assertWindowsCiIdentity(identity);
        const matched = ownerRecord({ token: 'eperm-match' });
        if (identity.bootId) matched.bootId = identity.bootId;
        if (identity.startTicks) matched.startTicks = identity.startTicks;
        if (Number.isSafeInteger(identity.processStartMs)) matched.processStartMs = identity.processStartMs;
        const matchedPayload = `${JSON.stringify(matched)}\n`;
        await fs.writeFile(matchedPath, matchedPayload);
        assert.throws(() => acquireDataRootOwnership(matchedRoot), /must not share this data root/);
        assert.equal(await fs.readFile(matchedPath, 'utf8'), matchedPayload);

        const reusedRoot = await freshRoot('eperm-reused');
        const reusedPath = path.join(reusedRoot, DATA_ROOT_OWNER_LOCK);
        const comparable = Boolean(identity.startTicks && identity.bootId) || Number.isSafeInteger(identity.processStartMs);
        const reused = ownerRecord({
            token: 'eperm-reused',
            startTicks: identity.startTicks,
            bootId: identity.bootId ? `${identity.bootId}-reused` : 'forged-boot-id',
            processStartMs: Number.isSafeInteger(identity.processStartMs) ? identity.processStartMs + 60000 : 1,
        });
        await fs.writeFile(reusedPath, `${JSON.stringify(reused)}\n`);
        if (!comparable) {
            assert.throws(() => acquireDataRootOwnership(reusedRoot), /must not share this data root/);
            return t.skip('Reliable process start identity unavailable (PowerShell may be unavailable on local Windows); conservative refusal verified');
        }
        const owned = acquireDataRootOwnership(reusedRoot);
        try {
            const current = JSON.parse(await fs.readFile(reusedPath, 'utf8'));
            assert.equal(current.pid, process.pid);
            assert.notEqual(current.token, reused.token);
        } finally {
            releaseDataRootOwnership();
        }
    } finally {
        process.kill = original;
    }
});

test('two processes cannot both reclaim one reused pid', async t => {
    const dataRoot = await freshRoot('pid-reuse-race');
    const lockPath = path.join(dataRoot, DATA_ROOT_OWNER_LOCK);
    const identity = readProcessIdentity(process.pid);
    assertWindowsCiIdentity(identity);
    const forged = ownerRecord({
        startTicks: identity.startTicks,
        bootId: identity.bootId ? `${identity.bootId}-reused` : 'forged-boot-id',
        processStartMs: Number.isSafeInteger(identity.processStartMs) ? identity.processStartMs + 60000 : 1,
    });
    await fs.writeFile(lockPath, `${JSON.stringify(forged)}\n`);
    if (!(identity.startTicks && identity.bootId) && !Number.isSafeInteger(identity.processStartMs)) {
        assert.throws(() => acquireDataRootOwnership(dataRoot), /must not share this data root/);
        releaseDataRootOwnership();
        return t.skip('Reliable process start identity unavailable (PowerShell may be unavailable on local Windows); conservative refusal verified');
    }
    await assertSingleReclaimWinner(dataRoot);
});

test('owner cleanup uses bounded sibling names and failed release can be retried', () => {
    const root = fsSync.mkdtempSync(path.join(temp, 'bounded-owner-'));
    acquireDataRootOwnership(root);
    const rename = fsSync.renameSync;
    fsSync.renameSync = () => { throw Object.assign(new Error('blocked'), { code: 'EACCES' }); };
    try { assert.throws(() => releaseDataRootOwnership(), /blocked/); }
    finally { fsSync.renameSync = rename; }
    fsSync.renameSync = (from, to) => {
        assert(to.length <= from.length, 'cleanup must fit the canonical path budget');
        return rename(from, to);
    };
    try { releaseDataRootOwnership(); }
    finally { fsSync.renameSync = rename; }
    assert.equal(fsSync.existsSync(path.join(root, DATA_ROOT_OWNER_LOCK)), false);
});

test('an expired marker cannot revoke a paused live reclaimer', async () => {
    const root = await freshRoot('paused-reclaim');
    const lockPath = path.join(root, DATA_ROOT_OWNER_LOCK);
    const reclaimPath = path.join(root, DATA_ROOT_OWNER_RECLAIM);
    fsSync.writeFileSync(lockPath, JSON.stringify(staleRecord()));
    const rename = fsSync.renameSync;
    let paused = false;
    fsSync.renameSync = (from, to) => {
        if (from === lockPath && !paused) {
            paused = true;
            // Pause after stale-owner validation, immediately before its rename.
            const expired = new Date(Date.now() - DATA_ROOT_RECLAIM_TIMEOUT_MS - 1000);
            fsSync.utimesSync(reclaimPath, expired, expired);
            const before = fsSync.readFileSync(lockPath, 'utf8');
            const markerBefore = fsSync.readFileSync(reclaimPath, 'utf8');
            for (let contender = 0; contender < 2; contender++) {
                // Fifty retries each probe the live marker owner. On Windows,
                // PowerShell latency alone can exceed the helper's usual 10s.
                // Slow one Linux contender too, without replacing its identity.
                const mode = contender === 0 ? 'slow-peer-probe' : 'exit';
                const child = runAcquire(root, mode, 55000);
                assert.ifError(child.error);
                assert.equal(child.signal, null);
                assert.equal(child.status, 1, child.stderr);
                assert.match(child.stderr, /Could not acquire/);
                assert.equal(fsSync.readFileSync(lockPath, 'utf8'), before);
                assert.equal(fsSync.readFileSync(reclaimPath, 'utf8'), markerBefore);
            }
        }
        return rename(from, to);
    };
    try {
        const owned = acquireDataRootOwnership(root);
        assert.equal(paused, true);
        assert.equal(JSON.parse(fsSync.readFileSync(lockPath, 'utf8')).token, owned.token);
    } finally {
        fsSync.renameSync = rename;
        releaseDataRootOwnership();
    }
});

test('release retains bookkeeping after reading the renamed owner fails', async () => {
    const root = await freshRoot('release-read-failure');
    const owned = acquireDataRootOwnership(root);
    const read = fsSync.readSync;
    fsSync.readSync = () => { throw Object.assign(new Error('transient read failure'), { code: 'EIO' }); };
    try {
        assert.throws(() => releaseDataRootOwnership(), /transient read failure/);
    } finally {
        fsSync.readSync = read;
    }
    assert.equal(fsSync.existsSync(owned.lockPath), true);
    assert.throws(() => acquireDataRootOwnership(root), /already owns/);
    releaseDataRootOwnership();
    assert.equal(fsSync.existsSync(owned.lockPath), false);
});

test('legacy Linux identity with a live pid refuses with a clear diagnostic', async t => {
    if (process.platform !== 'linux') return t.skip('Linux legacy format');
    const root = await freshRoot('legacy-live');
    const record = { ...ownerRecord(), ...readProcessIdentity(process.pid), processStartMs: 1 };
    delete record.v;
    const text = JSON.stringify(record);
    await fs.writeFile(path.join(root, DATA_ROOT_OWNER_LOCK), text);
    assert.throws(() => acquireDataRootOwnership(root), /Legacy owner record/);
    assert.equal(await fs.readFile(path.join(root, DATA_ROOT_OWNER_LOCK), 'utf8'), text);
});

test('Linux acquisition p95 is recorded', async t => {
    if (process.platform !== 'linux') return t.skip('Linux timing requirement');
    const samples = [];
    for (let i = 0; i < 30; i++) {
        const root = await freshRoot(`timing-${i}`);
        const start = performance.now();
        acquireDataRootOwnership(root);
        samples.push(performance.now() - start);
        releaseDataRootOwnership();
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    t.diagnostic(`Linux acquisition p95=${p95.toFixed(3)}ms (n=${samples.length})`);
});

test('two real Linux processes compare ticks and boot ids independently', async t => {
    if (process.platform !== 'linux') return t.skip('requires Linux /proc');
    for (const field of ['startTicks', 'bootId']) {
        const root = await freshRoot(`real-reuse-${field}`);
        const lock = path.join(root, DATA_ROOT_OWNER_LOCK);
        const owner = acquireDataRootOwnership(root);
        try {
            const record = JSON.parse(await fs.readFile(lock, 'utf8'));
            record[field] = field === 'startTicks' ? String(BigInt(record[field]) + 1n) : `${record[field]}-old`;
            await fs.writeFile(lock, JSON.stringify(record));
            const child = runAcquire(root);
            assert.equal(child.status, 0, child.stderr);
            assert.equal(fsSync.existsSync(lock), false);
        } finally {
            releaseDataRootOwnership();
        }
        assert.equal(owner.pid, process.pid);
    }
});

test('a second real process after a btime shift cannot reclaim the live Linux owner', async t => {
    if (process.platform !== 'linux') return t.skip('requires Linux /proc');
    const root = await freshRoot('clock-shift');
    const owner = acquireDataRootOwnership(root);
    try {
        const before = await fs.readFile(owner.lockPath, 'utf8');
        const child = runAcquire(root, 'clock-shift');
        assert.notEqual(child.status, 0);
        assert.match(child.stderr, /must not share this data root/);
        assert.equal(await fs.readFile(owner.lockPath, 'utf8'), before);
    } finally {
        releaseDataRootOwnership();
    }
});

test('Windows warm live-child owner refusal takes less than one second', async t => {
    if (process.platform !== 'win32') return t.skip('requires real Windows PowerShell and process CreationTime');
    const root = await freshRoot('windows-warm-refusal');
    const marker = path.join(root, 'ready');
    const child = spawn(process.execPath, [helper, root, 'hold', marker], { stdio: 'ignore' });
    try {
        assert.equal(await waitForMarker(marker), 'ok');
        const lockPath = path.join(root, DATA_ROOT_OWNER_LOCK);
        const before = await fs.readFile(lockPath, 'utf8');
        // Exclude the cold first PowerShell launch; this is the warm-probe target.
        const warm = readProcessIdentity(child.pid);
        assert.ok(Number.isSafeInteger(warm.processStartMs), 'Windows timing test requires a successful warmup probe');
        const start = performance.now();
        assert.throws(() => acquireDataRootOwnership(root), { code: 'ELOCKED' });
        const elapsed = performance.now() - start;
        t.diagnostic(`Windows warm live-owner refusal: ${elapsed.toFixed(1)}ms`);
        assert.ok(elapsed < 1000, `warm refusal took ${elapsed.toFixed(1)}ms`);
        assert.equal(await fs.readFile(lockPath, 'utf8'), before);
    } finally {
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.kill('SIGKILL');
        await exited;
    }
});
