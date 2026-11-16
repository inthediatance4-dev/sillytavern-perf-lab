import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { probeWindowsProcessStartMs, readProcessIdentity } from '../src/process-identity.js';
import { acquireDataRootOwnership, DATA_ROOT_OWNER_LOCK, DataRootOwnershipUnverifiedError } from '../src/data-root-owner.js';
import { reportLifecycleScan } from '../src/lifecycle-reconcile.js';
import { checkIntegrity } from '../src/integrity-check.js';
import { isLifecycleInternalName, markerPath, retireChatPath } from '../src/chat-io.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'round2-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}
for (const pid of ['1; Start-Process calc', '1e3', 1.5, -1, 0, '123']) {
    test(`invalid pid ${JSON.stringify(pid)} never probes`, async t => {
        let calls = 0;
        assert.equal(probeWindowsProcessStartMs(pid, () => { calls++; }), undefined);
        assert.deepEqual(readProcessIdentity(pid), {});
        const root = await fixture(t);
        await fs.writeFile(path.join(root, DATA_ROOT_OWNER_LOCK), JSON.stringify({ pid, hostname: os.hostname(), startedAt: 'test' }));
        assert.throws(() => acquireDataRootOwnership(root, { identityProvider: () => { calls++; return { startTicks: '1' }; } }), DataRootOwnershipUnverifiedError);
        assert.equal(calls, 0);
    });
}
test('PowerShell pid is a separate argument', () => {
    let args;
    probeWindowsProcessStartMs(987654, (_command, argv) => { args = argv; return '133000000000000000'; });
    assert.equal(args.at(-1), '987654');
    assert.ok(!args[args.indexOf('-Command') + 1].includes('987654'));
});
test('consistent live peer refuses after exactly one identity probe', async t => {
    const root = await fixture(t);
    await fs.writeFile(path.join(root, DATA_ROOT_OWNER_LOCK), JSON.stringify({ v: 2, pid: process.pid, hostname: os.hostname(), startedAt: 'test', bootId: 'boot', startTicks: '1' }));
    let calls = 0;
    assert.throws(() => acquireDataRootOwnership(root, { identityProvider: () => { calls++; return { bootId: 'boot', startTicks: '1' }; } }), { code: 'ELOCKED' });
    assert.equal(calls, 1); // Only the peer; self identity is never requested.
});
test('default scan reports counts and hint without writes', async t => {
    const root = await fixture(t);
    const staging = path.join(root, '.chat-staging');
    await fs.mkdir(staging);
    const name = 'a0000000-0000-4000-8000-000000000000';
    await fs.writeFile(path.join(staging, name), '{}');
    const before = await fs.stat(path.join(staging, name));
    const logs = [];
    await reportLifecycleScan(root, { log: text => logs.push(text) });
    assert.match(logs[0], /1 findings.*orphan.*check:integrity.*exclusiveDataRoot: true/);
    assert.deepEqual(await fs.readdir(root), ['.chat-staging']);
    assert.equal((await fs.stat(path.join(staging, name))).mtimeMs, before.mtimeMs);
});
test('integrity warns about a live owner without taking a lock', async t => {
    const root = await fixture(t);
    await fs.writeFile(path.join(root, DATA_ROOT_OWNER_LOCK), JSON.stringify({ v: 2, pid: process.pid, hostname: os.hostname(), ...readProcessIdentity(process.pid) }));
    const report = await checkIntegrity(root);
    assert.match(report.warnings[0], /in-flight writes/);
});
test('delete reasons record explicit intent; rename stays ambiguous', async t => {
    const root = await fixture(t);
    for (const reason of ['deleted', 'character_deleted', 'group_deleted', 'renamed']) {
        const file = path.join(root, reason);
        await retireChatPath(file, root, reason);
        const record = JSON.parse(await fs.readFile(markerPath(file, root), 'utf8'));
        assert.equal(record.intent, reason === 'renamed' ? undefined : 'delete');
    }
    for (const name of ['.chat-staging', '.chat-lifecycle', '.recycle', 'hold-a.json', 'chat.jsonl.123']) assert.ok(isLifecycleInternalName(name));
});

test('failed provider retries once and emits progress once', async t => {
    const root = await fixture(t);
    let calls = 0;
    const logs = [];
    const original = console.error;
    console.error = text => logs.push(text);
    const start = Date.now();
    try {
        assert.throws(() => acquireDataRootOwnership(root, { identityProvider: () => {
            calls++;
            throw Object.assign(new Error('probe timeout'), { code: 'ETIMEDOUT' });
        } }), DataRootOwnershipUnverifiedError);
    } finally { console.error = original; }
    assert.equal(calls, 2);
    assert.ok(Date.now() - start < 6000);
    assert.equal(logs.filter(text => /Verifying data-root/.test(text)).length, 1);
});

test('slow failing peer is probed twice within the acquisition deadline', async t => {
    const root = await fixture(t);
    await fs.writeFile(path.join(root, DATA_ROOT_OWNER_LOCK), JSON.stringify({ v: 2, pid: process.pid, hostname: os.hostname(), startedAt: 'test', bootId: 'boot', startTicks: '1' }));
    let calls = 0;
    const logs = [];
    const original = console.error;
    console.error = text => logs.push(text);
    const start = Date.now();
    try {
        assert.throws(() => acquireDataRootOwnership(root, { identityProvider: (_pid, { timeout }) => {
            assert.ok(timeout > 0 && timeout <= 3000);
            calls++;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 550);
            throw Object.assign(new Error('failed peer probe'), { code: 'ETIMEDOUT' });
        } }), DataRootOwnershipUnverifiedError);
    } finally { console.error = original; }
    assert.equal(calls, 2);
    assert.ok(Date.now() - start < 6000);
    assert.equal(logs.filter(text => /Verifying data-root/.test(text)).length, 1);
});
