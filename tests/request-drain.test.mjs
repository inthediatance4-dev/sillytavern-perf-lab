import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createRequestDrain, createShutdownDeadline } from '../src/request-drain.js';
import { withPathLock, waitForChatIO } from '../src/chat-io.js';
import { createChatBackupScheduler } from '../src/chat-backup-scheduler.js';

test('shutdown rejects new requests and drains admitted writes and trailing backups', async () => {
    const drain = createRequestDrain();
    const response = new EventEmitter();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const persisted = [];
    const backups = createChatBackupScheduler(async (_directory, _name, data) => { persisted.push(data); }, { interval: 60_000 });
    let handler;
    drain.middleware({}, response, () => {
        handler = withPathLock('/tmp/request-drain-test', async () => {
            backups.schedule('history', 'unused', 'history', 'leading');
            await gate;
            backups.schedule('history', 'unused', 'history', 'latest');
        }).then(() => response.emit('finish'));
    });
    let stopped = false;
    const shutdown = (async () => {
        await drain.stop(AbortSignal.timeout(5_000));
        await waitForChatIO(AbortSignal.timeout(5_000));
        await backups.flush();
        stopped = true;
    })();
    let rejected;
    drain.middleware({}, { sendStatus(status) { rejected = status; } }, () => assert.fail('late request admitted'));
    assert.equal(rejected, 503);
    await Promise.resolve();
    assert.equal(stopped, false);
    release();
    await handler;
    await shutdown;
    assert.deepEqual(persisted, ['leading', 'latest']);
});

test('closed responses release the drain and completion is idempotent', async () => {
    const drain = createRequestDrain();
    const response = new EventEmitter();
    drain.middleware({}, response, () => {});
    const stopping = drain.stop(AbortSignal.timeout(5_000));
    response.emit('close');
    response.emit('finish');
    await stopping;
    assert.equal(response.listenerCount('finish'), 0);
});

test('disconnect does not release an async persistence handler before it completes', async () => {
    const { createPersistenceTracker } = await import('../src/request-drain.js');
    const tracker = createPersistenceTracker();
    const drain = createRequestDrain(tracker);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let completed = false;
    const entry = { handle: async () => { await gate; completed = true; } };
    tracker.trackRouter({ stack: [{ route: { stack: [entry] } }] });
    const response = new EventEmitter();
    drain.middleware({}, response, () => entry.handle({}, response, assert.ifError));
    response.emit('close');
    let stopped = false;
    const stopping = drain.stop(AbortSignal.timeout(5_000)).then(() => { stopped = true; });
    await Promise.resolve();
    assert.equal(stopped, false);
    release();
    await stopping;
    assert.equal(completed, true);
});

test('shutdown rejects handlers delayed by earlier middleware', async () => {
    const { createPersistenceTracker } = await import('../src/request-drain.js');
    const tracker = createPersistenceTracker();
    let invoked = false;
    const entry = { handle: async () => { invoked = true; } };
    tracker.trackRouter({ stack: [{ route: { stack: [entry] } }] });
    await tracker.stop();
    let status;
    entry.handle({}, { sendStatus(code) { status = code; } }, assert.ifError);
    assert.equal(status, 503);
    assert.equal(invoked, false);
});

test('rejected handlers reach Express and do not prevent draining', async () => {
    const { createPersistenceTracker } = await import('../src/request-drain.js');
    const tracker = createPersistenceTracker();
    const failure = new Error('write failed');
    const entry = { handle: async () => { throw failure; } };
    tracker.trackRouter({ stack: [{ route: { stack: [entry] } }] });
    let forwarded;
    entry.handle({}, {}, error => { forwarded = error; });
    await tracker.stop();
    assert.equal(forwarded, failure);
    await tracker.stop();
});

test('sync handlers that return a promise are tracked and rejected after stop', async () => {
    const { createPersistenceTracker, createRequestDrain } = await import('../src/request-drain.js');
    const tracker = createPersistenceTracker();
    const drain = createRequestDrain(tracker);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let completed = false;
    const entry = { handle: () => gate.then(() => { completed = true; }) };
    tracker.trackRouter({ stack: [{ route: { stack: [entry] } }] });
    const response = new EventEmitter();
    drain.middleware({}, response, () => entry.handle({}, response, assert.ifError));
    response.emit('close');
    let stopped = false;
    const stopping = drain.stop(AbortSignal.timeout(5_000)).then(() => { stopped = true; });
    await Promise.resolve();
    assert.equal(stopped, false);
    assert.equal(completed, false);
    release();
    await stopping;
    assert.equal(completed, true);
    let status;
    let invoked = false;
    const late = { handle() { invoked = true; return Promise.resolve('late'); } };
    tracker.trackRouter({ stack: [{ route: { stack: [late] } }] });
    late.handle({}, { sendStatus(code) { status = code; } }, assert.ifError);
    assert.equal(status, 503);
    assert.equal(invoked, false);
});

test('sync thenable rejections are forwarded and do not block a later drain', async () => {
    const { createPersistenceTracker } = await import('../src/request-drain.js');
    const tracker = createPersistenceTracker();
    const failure = new Error('sync thenable failed');
    const entry = { handle: () => Promise.reject(failure) };
    tracker.trackRouter({ stack: [{ route: { stack: [entry] } }] });
    let forwarded;
    entry.handle({}, {}, error => { forwarded = error; });
    await tracker.stop();
    assert.equal(forwarded, failure);
    await tracker.stop();
});

test('drain deadline rejects while a response stays open', async () => {
    const { createRequestDrain, resolveDrainTimeoutMs, DEFAULT_DRAIN_TIMEOUT_MS } = await import('../src/request-drain.js');
    assert.equal(resolveDrainTimeoutMs(undefined), DEFAULT_DRAIN_TIMEOUT_MS);
    assert.equal(resolveDrainTimeoutMs(''), DEFAULT_DRAIN_TIMEOUT_MS);
    assert.equal(resolveDrainTimeoutMs('15'), 15);
    assert.equal(resolveDrainTimeoutMs('0'), 0);
    assert.equal(resolveDrainTimeoutMs('nope'), DEFAULT_DRAIN_TIMEOUT_MS);
    assert.equal(resolveDrainTimeoutMs('-1'), DEFAULT_DRAIN_TIMEOUT_MS);
    const logs = [];
    const original = console.error;
    console.error = (...args) => { logs.push(args.map(String).join(' ')); };
    const drain = createRequestDrain();
    const response = new EventEmitter();
    let nextCalls = 0;
    drain.middleware({}, response, () => { nextCalls += 1; });
    const started = Date.now();
    const deadline = createShutdownDeadline(30);
    try {
        await assert.rejects(drain.stop(deadline.signal), /Shutdown deadline expired/);
    } finally {
        deadline.dispose();
        console.error = original;
    }
    assert.equal(nextCalls, 1);
    assert.ok(Date.now() - started < 2_000, 'drain timeout must not wait for the open response');
    assert.deepEqual(logs, []);
    let rejected;
    drain.middleware({}, { sendStatus(status) { rejected = status; } }, () => assert.fail('late request admitted'));
    assert.equal(rejected, 503);
});

test('one 200ms shutdown budget reports a hung atomic write and preserves the original', async () => {
    const { spawn } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shutdown-deadline-'));
    const target = path.join(root, 'hanging.jsonl');
    fs.writeFileSync(target, 'original');
    const script = `
        import fs from 'node:fs';
        import { withPathLock, writeChatFile, pendingChatIOPaths, waitForChatIO } from './src/chat-io.js';
        import { createRequestDrain, createPersistenceTracker, runShutdown } from './src/request-drain.js';
        const target = ${JSON.stringify(target)};
        const originalWrite = fs.write;
        let entered;
        const ready = new Promise(resolve => { entered = resolve; });
        fs.write = (...args) => { entered(); };
        const tracker = createPersistenceTracker();
        const drain = createRequestDrain(tracker);
        const entry = { handle: () => withPathLock(target, () => writeChatFile(target, 'replacement')) };
        tracker.trackRouter({ stack: [{ route: { stack: [entry] } }] });
        entry.handle({}, {}, console.error);
        await ready;
        const started = Date.now();
        const code = await runShutdown([
            ['requests', signal => drain.stop(signal)],
            ['chat', signal => waitForChatIO(signal)],
        ], pendingChatIOPaths, 200);
        fs.write = originalWrite;
        console.log(JSON.stringify({ code, elapsed: Date.now() - started }));
        process.exitCode = code;
    `;
    try {
        const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd() });
        let stdout = '', stderr = '';
        child.stdout.on('data', data => { stdout += data; });
        child.stderr.on('data', data => { stderr += data; });
        const code = await new Promise(resolve => child.on('exit', resolve));
        const result = JSON.parse(stdout.trim());
        assert.equal(code, 1);
        assert.equal(result.code, 1);
        assert.ok(result.elapsed <= 300, stdout);
        assert.match(stderr, /Shutdown incomplete/);
        assert.ok(stderr.includes(target), stderr);
        assert.equal(fs.readFileSync(target, 'utf8'), 'original');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('chat and backup waits consume the same shutdown signal and report pending keys', async () => {
    const { runShutdown } = await import('../src/request-drain.js');
    const { pendingChatIOPaths } = await import('../src/chat-io.js');
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const backups = createChatBackupScheduler(() => blocked);
    backups.schedule('/backup/hanging.jsonl');
    const logs = [];
    const original = console.error;
    console.error = (...args) => logs.push(args);
    try {
        const code = await runShutdown([
            ['chat', signal => waitForChatIO(signal)],
            ['backups', signal => backups.flush(signal)],
        ], () => [...pendingChatIOPaths(), ...backups.pendingPaths()], 20);
        assert.equal(code, 1);
        assert.ok(JSON.stringify(logs).includes('/backup/hanging.jsonl'));
    } finally {
        console.error = original;
        release();
        await backups.flush();
    }
});

test('shutdown drain APIs reject missing signals and legacy numeric timeouts', async () => {
    await assert.rejects(waitForChatIO(), TypeError);
    await assert.rejects(createRequestDrain().stop(), TypeError);
    await assert.rejects(createRequestDrain().stop(20), TypeError);
});
