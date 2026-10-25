import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { chatLockPaths, waitForChatIO, withPathLocks } from '../src/chat-io.js';

function deferred() {
    /** @type {(value?: unknown) => void} */
    let resolve;
    const promise = new Promise(done => {
        resolve = done;
    });
    return { promise, resolve };
}

async function flush() {
    for (let i = 0; i < 6; i++) await Promise.resolve();
}

const directory = path.join('/tmp', 'path-lock-fairness');

test('two group chats in one directory proceed without waiting for each other', async () => {
    const alpha = path.join(directory, 'group-a.jsonl');
    const beta = path.join(directory, 'group-b.jsonl');
    const order = [];
    const release = deferred();
    const entered = deferred();
    const first = withPathLocks(chatLockPaths([alpha]), async () => {
        order.push('a-start');
        entered.resolve();
        await release.promise;
        order.push('a-end');
    });
    await entered.promise;
    const second = withPathLocks(chatLockPaths([beta]), async () => {
        order.push('b');
    });
    await second;
    assert.deepEqual(order, ['a-start', 'b']);
    release.resolve();
    await first;
    assert.deepEqual(order, ['a-start', 'b', 'a-end']);
});

test('same file stays exclusive while its parent is only shared', async () => {
    const file = path.join(directory, 'same.jsonl');
    const order = [];
    const release = deferred();
    const entered = deferred();
    const first = withPathLocks(chatLockPaths([file]), async () => {
        order.push('first');
        entered.resolve();
        await release.promise;
    });
    await entered.promise;
    const second = withPathLocks(chatLockPaths([file]), async () => {
        order.push('second');
    });
    await flush();
    assert.deepEqual(order, ['first']);
    release.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['first', 'second']);
});

test('directory exclusive waits for shared holders and blocks later file ops', async () => {
    const alpha = path.join(directory, 'hold-a.jsonl');
    const beta = path.join(directory, 'hold-b.jsonl');
    const gamma = path.join(directory, 'hold-c.jsonl');
    const order = [];
    const releaseAlpha = deferred();
    const releaseBeta = deferred();
    const enteredAlpha = deferred();
    const enteredBeta = deferred();
    const alphaOp = withPathLocks(chatLockPaths([alpha]), async () => {
        order.push('a');
        enteredAlpha.resolve();
        await releaseAlpha.promise;
    });
    await enteredAlpha.promise;
    const betaOp = withPathLocks(chatLockPaths([beta]), async () => {
        order.push('b');
        enteredBeta.resolve();
        await releaseBeta.promise;
    });
    await enteredBeta.promise;
    let drained = false;
    const exclusive = withPathLocks([directory], async () => {
        order.push('exclusive');
    });
    const later = withPathLocks(chatLockPaths([gamma]), async () => {
        order.push('later');
    });
    const draining = waitForChatIO().then(() => {
        drained = true;
    });
    await flush();
    assert.deepEqual(order, ['a', 'b']);
    assert.equal(drained, false);
    releaseAlpha.resolve();
    await flush();
    assert.deepEqual(order, ['a', 'b']);
    releaseBeta.resolve();
    await Promise.all([alphaOp, betaOp, exclusive, later, draining]);
    assert.deepEqual(order, ['a', 'b', 'exclusive', 'later']);
    assert.equal(drained, true);
    await waitForChatIO();
});

test('explicit directory exclusive wins over a shared parent in the same reservation', async () => {
    const file = path.join(directory, 'mixed.jsonl');
    const other = path.join(directory, 'mixed-other.jsonl');
    const order = [];
    const release = deferred();
    const entered = deferred();
    const retiring = withPathLocks([...chatLockPaths([file]), directory], async () => {
        order.push('retire');
        entered.resolve();
        await release.promise;
    });
    await entered.promise;
    const reader = withPathLocks(chatLockPaths([other]), async () => {
        order.push('read');
    });
    await flush();
    assert.deepEqual(order, ['retire']);
    release.resolve();
    await Promise.all([retiring, reader]);
    assert.deepEqual(order, ['retire', 'read']);
});

test('crossed shared and exclusive reservations finish', async () => {
    const left = path.join(directory, 'left');
    const right = path.join(directory, 'right');
    const release = deferred();
    const entered = deferred();
    const first = withPathLocks([{ path: left, mode: 'shared' }, right], async () => {
        entered.resolve();
        await release.promise;
    });
    await entered.promise;
    const second = withPathLocks([{ path: right, mode: 'shared' }, left], async () => 'second');
    release.resolve();
    const result = await Promise.race([
        Promise.all([first, second]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('crossed locks did not finish')), 1000)),
    ]);
    assert.equal(result[1], 'second');
});

test('a failed reservation releases every path it held', async () => {
    const file = path.join(directory, 'failed.jsonl');
    await assert.rejects(withPathLocks(chatLockPaths([file]), async () => {
        throw new Error('synthetic failure');
    }), /synthetic failure/);
    assert.equal(await withPathLocks(chatLockPaths([file]), async () => 'recovered'), 'recovered');
    await waitForChatIO();
});
