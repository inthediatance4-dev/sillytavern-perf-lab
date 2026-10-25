import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createRequestDrain } from '../src/request-drain.js';
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
        await drain.stop();
        await waitForChatIO();
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
    const stopping = drain.stop();
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
    const stopping = drain.stop().then(() => { stopped = true; });
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
    const stopping = drain.stop(5_000).then(() => { stopped = true; });
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

test('drain timeout continues shutdown while a response stays open', async () => {
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
    try {
        await drain.stop(30);
    } finally {
        console.error = original;
    }
    assert.equal(nextCalls, 1);
    assert.ok(Date.now() - started < 2_000, 'drain timeout must not wait for the open response');
    assert.match(logs.join('\n'), /timed out after 30ms/);
    let rejected;
    drain.middleware({}, { sendStatus(status) { rejected = status; } }, () => assert.fail('late request admitted'));
    assert.equal(rejected, 503);
});
