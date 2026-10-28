import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { LockOrderError, chatLockPaths, runAfterPathLocks, waitForChatIO, withPathLocks } from '../src/chat-io.js';

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

test('a completed save starts deferred backup while an unrelated lock stays held', async () => {
    const root = path.join(directory, 'independent-backup');
    const entered = deferred();
    const release = deferred();
    const unrelated = withPathLocks([path.join(root, 'unrelated')], async () => {
        entered.resolve();
        await release.promise;
    });
    await entered.promise;
    let backup;
    let timer;
    try {
        await withPathLocks([path.join(root, 'save')], async () => {
            backup = runAfterPathLocks(() => withPathLocks([path.join(root, 'backups')], async () => 'written'));
        });
        assert.equal(await Promise.race([backup, new Promise(resolve => {
            timer = setTimeout(() => resolve('blocked by unrelated lock'), 500);
        })]), 'written');
    } finally {
        clearTimeout(timer);
        release.resolve();
        await unrelated;
        await backup;
    }
});

test('nested reservations reuse held keys and reject new keys and upgrades', async () => {
    const outer = path.join(directory, 'nested-outer');
    const inner = path.join(directory, 'nested-inner');
    await withPathLocks([outer], async () => {
        assert.equal(await withPathLocks([outer], async () => 'reentered'), 'reentered');
        await assert.rejects(withPathLocks([inner], async () => {}), LockOrderError);
    });
    await withPathLocks([{ path: outer, mode: 'shared' }], async () => {
        await assert.rejects(withPathLocks([outer], async () => {}), LockOrderError);
    });
});

test('nested new file rejects even with a queued directory writer', { timeout: 150 }, async () => {
    const entered = deferred();
    const resume = deferred();
    const outer = withPathLocks(chatLockPaths([path.join(directory, 'a')]), async () => {
        entered.resolve();
        await resume.promise;
        await assert.rejects(withPathLocks(chatLockPaths([path.join(directory, 'b')]), async () => {}), LockOrderError);
    });
    await entered.promise;
    const writer = withPathLocks([directory], async () => {});
    resume.resolve();
    await Promise.all([outer, writer]);
});

test('deferred work waits for originating and enclosing reservations to release', async () => {
    const outer = path.join(directory, 'deferred-outer');
    const inner = path.join(directory, 'deferred-inner');
    const order = [];
    let follow;
    await withPathLocks([outer, inner], async () => {
        await withPathLocks([inner], async () => {
            follow = runAfterPathLocks(() => withPathLocks([outer, inner], async () => {
                order.push('follow');
            }));
            order.push('inner');
        });
        await flush();
        assert.deepEqual(order, ['inner']);
        order.push('outer');
    });
    await follow;
    assert.deepEqual(order, ['inner', 'outer', 'follow']);
});
