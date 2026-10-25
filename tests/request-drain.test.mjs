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
