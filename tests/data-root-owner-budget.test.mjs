import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Exercise the Windows acquisition path on Linux without launching PowerShell.
const source = (await fs.readFile(new URL('../src/data-root-owner.js', import.meta.url), 'utf8'))
    .replace("'./process-identity.js'", JSON.stringify(new URL('../src/process-identity.js', import.meta.url).href))
    .replaceAll('process.platform', "'win32'");
const owner = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owner-budget-'));
    t.after(() => { owner.releaseDataRootOwnership(); return fs.rm(root, { recursive: true, force: true }); });
    return root;
}

test('Windows simulation: live peer refuses with one peer probe and no self probe', async t => {
    const root = await fixture(t);
    const text = JSON.stringify({ v: 2, pid: process.ppid, hostname: os.hostname(), startedAt: 'test', processStartMs: 123 });
    await fs.writeFile(path.join(root, owner.DATA_ROOT_OWNER_LOCK), text);
    const calls = [];
    const start = performance.now();
    assert.throws(() => owner.acquireDataRootOwnership(root, { identityProvider: (pid, options) => {
        calls.push({ pid, strict: options.strict });
        return { processStartMs: 123 };
    } }), { code: 'ELOCKED' });
    assert.deepEqual(calls, [{ pid: process.ppid, strict: undefined }]);
    assert.ok(performance.now() - start < 1000);
    assert.equal(await fs.readFile(path.join(root, owner.DATA_ROOT_OWNER_LOCK), 'utf8'), text);
});

test('Windows simulation: absent peer probes self before writing', async t => {
    const root = await fixture(t);
    const calls = [];
    owner.acquireDataRootOwnership(root, { identityProvider: (pid, options) => {
        calls.push({ pid, strict: options.strict });
        return { processStartMs: 123 };
    } });
    assert.deepEqual(calls, [{ pid: process.pid, strict: true }]);
});

for (const peer of [false, true]) {
    test(`Windows simulation: failing ${peer ? 'peer' : 'self'} consumes at most its ${peer ? '6s' : '10s'} budget and reports progress`, async t => {
        const root = await fixture(t);
        if (peer) await fs.writeFile(path.join(root, owner.DATA_ROOT_OWNER_LOCK), JSON.stringify({ v: 2, pid: process.ppid, hostname: os.hostname(), startedAt: 'test', processStartMs: 123 }));
        const now = Date.now;
        const error = console.error;
        let clock = now();
        let calls = 0;
        const logs = [];
        Date.now = () => clock;
        console.error = text => logs.push(text);
        const start = clock;
        try {
            assert.throws(() => owner.acquireDataRootOwnership(root, { identityProvider: (pid, { timeout, strict }) => {
                assert.equal(pid, peer ? process.ppid : process.pid);
                assert.equal(Boolean(strict), !peer);
                assert.equal(timeout, peer ? 3000 : 5000);
                calls++;
                clock += timeout;
                throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
            } }), error => {
                assert.ok(error instanceof owner.DataRootOwnershipUnverifiedError);
                assert.match(error.cause.message, /timed out after (3000|5000) ms \(attempt 2\/2\)/);
                return true;
            });
        } finally { Date.now = now; console.error = error; }
        assert.equal(calls, 2);
        assert.equal(clock - start, peer ? owner.PEER_PROBE_BUDGET_MS : owner.SELF_PROBE_BUDGET_MS);
        assert.equal(logs.filter(text => /Verifying data-root/.test(text)).length, 1);
        if (!peer) assert.deepEqual(await fs.readdir(root), []);
    });
}

test('Windows simulation: self receives a full budget after a slow stale peer', async t => {
    const root = await fixture(t);
    await fs.writeFile(path.join(root, owner.DATA_ROOT_OWNER_LOCK), JSON.stringify({ v: 2, pid: process.ppid, hostname: os.hostname(), startedAt: 'test', processStartMs: 1 }));
    const now = Date.now;
    let clock = now();
    const start = clock;
    const selfTimeouts = [];
    let peerCalls = 0;
    Date.now = () => clock;
    try {
        assert.throws(() => owner.acquireDataRootOwnership(root, { identityProvider: (_pid, { timeout, strict }) => {
            if (!strict) {
                assert.ok(timeout <= owner.PEER_PROBE_TIMEOUT_MS);
                if (++peerCalls === 1) {
                    clock += timeout;
                    throw Object.assign(new Error('cold peer timeout'), { code: 'ETIMEDOUT' });
                }
                clock += 2900;
                return { processStartMs: 123 };
            }
            selfTimeouts.push(timeout);
            clock += timeout;
            throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
        } }), owner.DataRootOwnershipUnverifiedError);
    } finally { Date.now = now; }
    assert.deepEqual(selfTimeouts, [5000, 5000]);
    assert.equal(clock - start, 15900);
    assert.ok(clock - start <= owner.PEER_PROBE_BUDGET_MS + owner.SELF_PROBE_BUDGET_MS);
});

test('Windows simulation: swallowed provider timeouts retain attempt timing and failures are retryable', async t => {
    const root = await fixture(t);
    const now = Date.now;
    let clock = now();
    Date.now = () => clock;
    try {
        assert.throws(() => owner.acquireDataRootOwnership(root, { identityProvider: (_pid, { timeout }) => {
            clock += timeout;
            return {}; // The real PowerShell provider omits identity after a timeout.
        } }), error => {
            assert.ok(error instanceof owner.DataRootOwnershipUnverifiedError);
            assert.match(error.cause.message, /timed out after 5000 ms \(attempt 2\/2\)/);
            return true;
        });
        let calls = 0;
        owner.acquireDataRootOwnership(root, { identityProvider: (_pid, { timeout }) => {
            assert.equal(timeout, 5000);
            calls++;
            return { processStartMs: 123 };
        } });
        assert.equal(calls, 1);
    } finally { Date.now = now; }
});
