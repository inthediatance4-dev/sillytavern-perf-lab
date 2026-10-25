import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathLockKey, withPathLocks, ChatLifecycleError } from '../src/chat-io.js';
import { readProcessIdentity } from '../src/process-identity.js';
import {
    configureCrossProcessPathLocks,
    exclusiveLockPathFor,
    PATH_LOCK_DIRECTORY,
} from '../src/path-fs-lock.js';

const chatIoUrl = new URL('../src/chat-io.js', import.meta.url).href;
const pathLockUrl = new URL('../src/path-fs-lock.js', import.meta.url).href;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'st-path-lock-'));
const helper = path.join(temp, 'hold-path.mjs');
await fs.writeFile(helper, `
import fs from 'node:fs';
import { configureCrossProcessPathLocks } from ${JSON.stringify(pathLockUrl)};
import { withPathLocks } from ${JSON.stringify(chatIoUrl)};
const root = process.argv[2];
const enabled = process.argv[3] === 'on';
const target = process.argv[4];
const marker = process.argv[5];
const timeoutMs = Number(process.argv[6]);
const releaseFile = process.argv[7] || '';
if (enabled) configureCrossProcessPathLocks({ enabled: true, root, timeoutMs });
try {
    await withPathLocks([target], async () => {
        fs.writeFileSync(marker, 'entered:' + Date.now());
        const started = Date.now();
        while (releaseFile && !fs.existsSync(releaseFile)) {
            if (Date.now() - started > 8000) throw new Error('release wait expired');
            await new Promise(resolve => setTimeout(resolve, 15));
        }
        fs.writeFileSync(marker, 'done:' + Date.now());
    });
} catch (error) {
    const reason = error && error.reason ? error.reason : (error && error.message ? error.message : String(error));
    fs.writeFileSync(marker, 'err:' + reason);
    process.exitCode = 1;
}
`);

function deferred() {
    /** @type {(value?: unknown) => void} */
    let resolve;
    const promise = new Promise(done => {
        resolve = done;
    });
    return { promise, resolve };
}

/** @type {Promise<void>} */
let serial = Promise.resolve();

function exclusiveTest(name, fn) {
    test(name, async () => {
        const previous = serial;
        let release;
        serial = new Promise(done => {
            release = done;
        });
        await previous;
        configureCrossProcessPathLocks({ enabled: false });
        try {
            await fn();
        } finally {
            configureCrossProcessPathLocks({ enabled: false });
            release();
        }
    });
}

function exitedPid() {
    const result = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    assert.equal(result.status, 0);
    return result.pid;
}

async function freshDir(name) {
    const directory = path.join(temp, name);
    await fs.mkdir(directory);
    return directory;
}

/**
 * @param {string[]} args
 */
function startHelper(args) {
    const child = spawn(process.execPath, [helper, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => {
        stderr += chunk;
    });
    child.stderrText = () => stderr;
    return child;
}

/**
 * @param {string} file
 * @param {(text: string) => boolean} predicate
 * @param {number} [timeout]
 */
async function waitForMarker(file, predicate, timeout = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        try {
            const text = await fs.readFile(file, 'utf8');
            if (predicate(text)) return text;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 15));
    }
    throw new Error(`Timed out waiting for ${file}`);
}

async function stopChild(child) {
    if (child.exitCode !== null || child.signalCode) return;
    const finished = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), 3000);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve(true);
        });
    });
    if (finished || child.exitCode !== null || child.signalCode) return;
    child.kill('SIGKILL');
    await new Promise(resolve => child.once('exit', resolve));
}

exclusiveTest('cross-process locks are absent until the flag is enabled', async () => {
    const root = await freshDir('flag-off');
    const target = path.join(root, 'same.jsonl');
    const firstMarker = path.join(root, 'first.txt');
    const secondMarker = path.join(root, 'second.txt');
    const releaseFile = path.join(root, 'release');
    const first = startHelper([root, 'off', target, firstMarker, '200', releaseFile]);
    const second = startHelper([root, 'off', target, secondMarker, '200', releaseFile]);
    try {
        const markers = await Promise.all([
            waitForMarker(firstMarker, text => text.startsWith('entered:')),
            waitForMarker(secondMarker, text => text.startsWith('entered:')),
        ]);
        assert.equal(markers.length, 2);
        assert.equal(await fs.access(path.join(root, PATH_LOCK_DIRECTORY)).then(() => true, () => false), false);
    } finally {
        await fs.writeFile(releaseFile, 'go');
        await Promise.all([stopChild(first), stopChild(second)]);
    }
});

exclusiveTest('a second process waits for the same path and times out with a conflict', async () => {
    const root = await freshDir('conflict');
    const target = path.join(root, 'same.jsonl');
    const heldMarker = path.join(root, 'held.txt');
    const busyMarker = path.join(root, 'busy.txt');
    const releaseFile = path.join(root, 'release');
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 200 });
    const holder = startHelper([root, 'on', target, heldMarker, '5000', releaseFile]);
    try {
        await waitForMarker(heldMarker, text => text.startsWith('entered:'));
        const lockPath = exclusiveLockPathFor(pathLockKey(target));
        const payload = JSON.parse(await fs.readFile(lockPath, 'utf8'));
        assert.equal(payload.pid, holder.pid);
        assert.equal(payload.key, pathLockKey(target));
        const waiter = startHelper([root, 'on', target, busyMarker, '200', '']);
        try {
            const text = await waitForMarker(busyMarker, value => value.startsWith('err:'));
            assert.equal(text, 'err:path_lock_busy');
            assert.equal(JSON.parse(await fs.readFile(lockPath, 'utf8')).pid, holder.pid);
        } finally {
            await stopChild(waiter);
        }
    } finally {
        await fs.writeFile(releaseFile, 'go');
        await stopChild(holder);
    }
    assert.equal(await fs.access(exclusiveLockPathFor(pathLockKey(target))).then(() => true, () => false), false);
});

exclusiveTest('a waiter proceeds after the holder releases the path', async () => {
    const root = await freshDir('wait');
    const target = path.join(root, 'same.jsonl');
    const heldMarker = path.join(root, 'held.txt');
    const nextMarker = path.join(root, 'next.txt');
    const releaseFile = path.join(root, 'release');
    const holder = startHelper([root, 'on', target, heldMarker, '5000', releaseFile]);
    try {
        await waitForMarker(heldMarker, text => text.startsWith('entered:'));
        const waiter = startHelper([root, 'on', target, nextMarker, '4000', '']);
        try {
            await new Promise(resolve => setTimeout(resolve, 200));
            assert.equal(await fs.access(nextMarker).then(() => true, () => false), false);
            const releasedAt = Date.now();
            await fs.writeFile(releaseFile, 'go');
            const done = await waitForMarker(nextMarker, text => text.startsWith('done:'));
            const enteredAt = Number(done.slice('done:'.length));
            assert.ok(enteredAt >= releasedAt);
        } finally {
            await stopChild(waiter);
        }
    } finally {
        await fs.writeFile(releaseFile, 'go').catch(() => {});
        await stopChild(holder);
    }
});

exclusiveTest('different paths proceed while each holder keeps its own file', async () => {
    const root = await freshDir('distinct');
    const alpha = path.join(root, 'alpha.jsonl');
    const beta = path.join(root, 'beta.jsonl');
    const alphaMarker = path.join(root, 'alpha.txt');
    const betaMarker = path.join(root, 'beta.txt');
    const releaseFile = path.join(root, 'release');
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 1000 });
    const first = startHelper([root, 'on', alpha, alphaMarker, '5000', releaseFile]);
    const second = startHelper([root, 'on', beta, betaMarker, '5000', releaseFile]);
    try {
        await Promise.all([
            waitForMarker(alphaMarker, text => text.startsWith('entered:')),
            waitForMarker(betaMarker, text => text.startsWith('entered:')),
        ]);
        const alphaLock = exclusiveLockPathFor(pathLockKey(alpha));
        const betaLock = exclusiveLockPathFor(pathLockKey(beta));
        assert.notEqual(alphaLock, betaLock);
        assert.equal(JSON.parse(await fs.readFile(alphaLock, 'utf8')).pid, first.pid);
        assert.equal(JSON.parse(await fs.readFile(betaLock, 'utf8')).pid, second.pid);
    } finally {
        await fs.writeFile(releaseFile, 'go');
        await Promise.all([stopChild(first), stopChild(second)]);
    }
});

exclusiveTest('shared holders stay in-process and do not create a lock file', async () => {
    const root = await freshDir('shared');
    const file = path.join(root, 'shared.jsonl');
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 500 });
    const release = deferred();
    const entered = deferred();
    let firstRunning = false;
    const first = withPathLocks([{ path: file, mode: 'shared' }], async () => {
        firstRunning = true;
        entered.resolve();
        await release.promise;
        firstRunning = false;
    });
    await entered.promise;
    const second = await withPathLocks([{ path: file, mode: 'shared' }], async () => {
        assert.equal(firstRunning, true);
        return 'second';
    });
    assert.equal(second, 'second');
    assert.equal(await fs.access(path.join(root, PATH_LOCK_DIRECTORY)).then(() => true, () => false), false);
    release.resolve();
    await first;
});

exclusiveTest('an exclusive holder keeps one lock file and the next waiter stays queued', async () => {
    const root = await freshDir('queued');
    const file = path.join(root, 'queued.jsonl');
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 1000 });
    const order = [];
    const release = deferred();
    const entered = deferred();
    const first = withPathLocks([file], async () => {
        order.push('first');
        const names = await fs.readdir(path.join(root, PATH_LOCK_DIRECTORY));
        assert.deepEqual(names.filter(name => name.endsWith('.lock')), [path.basename(exclusiveLockPathFor(pathLockKey(file)))]);
        entered.resolve();
        await release.promise;
    });
    await entered.promise;
    const second = withPathLocks([file], async () => {
        order.push('second');
    });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.deepEqual(order, ['first']);
    release.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['first', 'second']);
    assert.equal(await fs.access(exclusiveLockPathFor(pathLockKey(file))).then(() => true, () => false), false);
});

exclusiveTest('a dead or reused lock file is reclaimed and a foreign host is not', async () => {
    const root = await freshDir('reclaim');
    const file = path.join(root, 'reclaim.jsonl');
    const key = pathLockKey(file);
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 200 });
    const lockPath = exclusiveLockPathFor(key);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    const identity = readProcessIdentity(process.pid);
    const reused = {
        pid: process.pid,
        hostname: os.hostname(),
        startedAt: '2000-01-01T00:00:00.000Z',
        token: 'reused',
        key,
        bootId: identity.bootId ? `${identity.bootId}-reused` : 'forged-boot-id',
        processStartMs: Number.isSafeInteger(identity.processStartMs) ? identity.processStartMs + 60000 : 1,
    };
    await fs.writeFile(lockPath, `${JSON.stringify(reused)}\n`);
    if (identity.bootId || Number.isSafeInteger(identity.processStartMs)) {
        await withPathLocks([file], async () => {
            const current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
            assert.equal(current.pid, process.pid);
            assert.notEqual(current.token, 'reused');
        });
    } else {
        await assert.rejects(withPathLocks([file], async () => 'kept'), error => error instanceof ChatLifecycleError && error.reason === 'path_lock_busy');
    }

    const dead = {
        pid: exitedPid(),
        hostname: os.hostname(),
        startedAt: '2000-01-01T00:00:00.000Z',
        token: 'dead',
        key,
    };
    await fs.writeFile(lockPath, `${JSON.stringify(dead)}\n`);
    assert.equal(await withPathLocks([file], async () => 'reclaimed'), 'reclaimed');

    const foreign = `${JSON.stringify({ ...dead, hostname: `other-${os.hostname()}`, token: 'foreign' })}\n`;
    await fs.writeFile(lockPath, foreign);
    await assert.rejects(
        withPathLocks([file], async () => 'stolen'),
        error => error instanceof ChatLifecycleError && error.reason === 'path_lock_busy',
    );
    assert.equal(await fs.readFile(lockPath, 'utf8'), foreign);
});

exclusiveTest('a timed-out later path releases the earlier filesystem lock', async () => {
    const root = await freshDir('rollback');
    const alpha = path.join(root, 'a-file');
    const beta = path.join(root, 'b-file');
    const heldMarker = path.join(root, 'held.txt');
    const releaseFile = path.join(root, 'release');
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 200 });
    const holder = startHelper([root, 'on', beta, heldMarker, '5000', releaseFile]);
    try {
        await waitForMarker(heldMarker, text => text.startsWith('entered:'));
        await assert.rejects(
            withPathLocks([alpha, beta], async () => 'both'),
            error => error instanceof ChatLifecycleError && error.reason === 'path_lock_busy',
        );
        assert.equal(await fs.access(exclusiveLockPathFor(pathLockKey(alpha))).then(() => true, () => false), false);
        assert.equal(JSON.parse(await fs.readFile(exclusiveLockPathFor(pathLockKey(beta)), 'utf8')).pid, holder.pid);
        assert.equal(await withPathLocks([alpha], async () => 'alpha'), 'alpha');
    } finally {
        await fs.writeFile(releaseFile, 'go');
        await stopChild(holder);
    }
});

exclusiveTest('a nested lock may take another path but cannot re-enter a held key', async () => {
    const root = await freshDir('nested');
    const outer = path.join(root, 'outer.jsonl');
    const inner = path.join(root, 'inner.jsonl');
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 500 });
    let sawBoth = false;
    await withPathLocks([outer], async () => {
        await Promise.resolve();
        await withPathLocks([inner], async () => {
            const names = await fs.readdir(path.join(root, PATH_LOCK_DIRECTORY));
            const locks = names.filter(name => name.endsWith('.lock')).sort();
            assert.deepEqual(locks, [
                path.basename(exclusiveLockPathFor(pathLockKey(inner))),
                path.basename(exclusiveLockPathFor(pathLockKey(outer))),
            ].sort());
            sawBoth = true;
        });
    });
    assert.equal(sawBoth, true);
    assert.equal(await fs.access(exclusiveLockPathFor(pathLockKey(outer))).then(() => true, () => false), false);
    await assert.rejects(withPathLocks([outer], async () => {
        await withPathLocks([outer], async () => 'again');
    }), error => error instanceof ChatLifecycleError && error.reason === 'lock_reentered');
    assert.equal(await withPathLocks([outer], async () => 'after'), 'after');
});

exclusiveTest('path lock acquisition does not invoke a compiler', async () => {
    const source = await fs.readFile(new URL('../src/path-fs-lock.js', import.meta.url), 'utf8');
    const server = await fs.readFile(new URL('../src/server-main.js', import.meta.url), 'utf8');
    assert.equal(source.includes('gcc'), false);
    assert.equal(source.includes('node_api'), false);
    assert.equal(source.includes('child_process'), false);
    assert.match(server, /cliArgs\.exclusiveDataRoot \|\| cliArgs\.crossProcessPathLocks/);
    assert.match(server, /configureCrossProcessPathLocks/);
});
