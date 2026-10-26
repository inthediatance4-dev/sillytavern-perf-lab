import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { pathLockKey, chatLockPaths, runAfterExclusiveFsLocks, withPathLocks, ChatLifecycleError } from '../src/chat-io.js';
import { readProcessIdentity } from '../src/process-identity.js';
import {
    activePathLockLocation,
    configureCrossProcessPathLocks,
    exclusiveLockPathFor,
    fallbackPathLockDirectory,
    LOCK_QUARANTINE_MIN_AGE_MS,
    MAX_LOCK_BYTES,
    PATH_LOCK_DIRECTORY,
    PATH_LOCK_QUARANTINE_DIRECTORY,
    setPathLockPathLimitForTest,
    sharedLockPathFor,
} from '../src/path-fs-lock.js';

const chatIoUrl = new URL('../src/chat-io.js', import.meta.url).href;
const pathLockUrl = new URL('../src/path-fs-lock.js', import.meta.url).href;
const SHARED_LOCK_NAME = /\.shared\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
const nested = process.argv[8] || '';
if (enabled) configureCrossProcessPathLocks({ enabled: true, root, timeoutMs });
try {
    await withPathLocks([target], async () => {
        fs.writeFileSync(marker, 'entered:' + Date.now());
        const started = Date.now();
        while (releaseFile && !fs.existsSync(releaseFile)) {
            if (Date.now() - started > 8000) throw new Error('release wait expired');
            await new Promise(resolve => setTimeout(resolve, 15));
        }
        if (nested) {
            await withPathLocks([nested], async () => {
                fs.writeFileSync(marker, 'nested:' + Date.now());
            });
        }
        fs.writeFileSync(marker, 'done:' + Date.now());
    });
} catch (error) {
    const reason = error && error.reason ? error.reason : (error && error.message ? error.message : String(error));
    fs.writeFileSync(marker, 'err:' + reason);
    process.exitCode = 1;
}
`);
const fenceHelper = path.join(temp, 'hold-fence.mjs');
await fs.writeFile(fenceHelper, `
import fs from 'node:fs';
import { configureCrossProcessPathLocks } from ${JSON.stringify(pathLockUrl)};
import { chatLockPaths, withPathLocks } from ${JSON.stringify(chatIoUrl)};
const root = process.argv[2];
const mode = process.argv[3];
const target = process.argv[4];
const marker = process.argv[5];
const timeoutMs = Number(process.argv[6]);
const releaseFile = process.argv[7] || '';
configureCrossProcessPathLocks({ enabled: true, root, timeoutMs });
const entries = mode === 'file' ? chatLockPaths([target]) : [target];
try {
    await withPathLocks(entries, async () => {
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
        setPathLockPathLimitForTest(0);
        try {
            await fn();
        } finally {
            configureCrossProcessPathLocks({ enabled: false });
            setPathLockPathLimitForTest(0);
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
function startHelper(args, script = helper) {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
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
        const names = await fs.readdir(fallbackPathLockDirectory(root));
        assert.deepEqual(names.filter(name => name.endsWith('.exclusive')), [path.basename(exclusiveLockPathFor(pathLockKey(file)))]);
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

exclusiveTest('a nested lock cannot take another path while an exclusive filesystem lock is held', async () => {
    const root = await freshDir('nested');
    const outer = path.join(root, 'outer.jsonl');
    const inner = path.join(root, 'inner.jsonl');
    const shared = path.join(root, 'shared.jsonl');
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 500 });
    await assert.rejects(withPathLocks([outer], async () => {
        await Promise.resolve();
        const names = await fs.readdir(fallbackPathLockDirectory(root));
        assert.deepEqual(names.filter(name => name.endsWith('.exclusive')), [path.basename(exclusiveLockPathFor(pathLockKey(outer)))]);
        await withPathLocks([inner], async () => 'inner');
    }), error => error instanceof ChatLifecycleError && error.reason === 'lock_reentered');
    assert.equal(await fs.access(exclusiveLockPathFor(pathLockKey(outer))).then(() => true, () => false), false);
    assert.equal(await fs.access(exclusiveLockPathFor(pathLockKey(inner))).then(() => true, () => false), false);
    await assert.rejects(withPathLocks([outer], async () => {
        await withPathLocks([outer], async () => 'again');
    }), error => error instanceof ChatLifecycleError && error.reason === 'lock_reentered');
    await assert.rejects(withPathLocks([{ path: shared, mode: 'shared' }], async () => {
        await withPathLocks([shared], async () => 'upgrade');
    }), error => error instanceof ChatLifecycleError && error.reason === 'lock_reentered');
    assert.equal(await withPathLocks([outer], async () => 'after'), 'after');
    assert.equal(await fs.access(exclusiveLockPathFor(pathLockKey(outer))).then(() => true, () => false), false);
});

exclusiveTest('in-process nesting of a different path still runs when filesystem locks are off', async () => {
    const root = await freshDir('nested-off');
    const outer = path.join(root, 'outer.jsonl');
    const inner = path.join(root, 'inner.jsonl');
    let ran = false;
    assert.equal(await withPathLocks([outer], async () => {
        return withPathLocks([inner], async () => {
            ran = true;
            return 'inner';
        });
    }), 'inner');
    assert.equal(ran, true);
});

exclusiveTest('opposite nested filesystem locks reject instead of waiting on each other', async () => {
    const root = await freshDir('opposite');
    const alpha = path.join(root, 'alpha.jsonl');
    const beta = path.join(root, 'beta.jsonl');
    const alphaMarker = path.join(root, 'alpha.txt');
    const betaMarker = path.join(root, 'beta.txt');
    const releaseFile = path.join(root, 'release');
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 500 });
    const first = startHelper([root, 'on', alpha, alphaMarker, '8000', releaseFile, beta]);
    const second = startHelper([root, 'on', beta, betaMarker, '8000', releaseFile, alpha]);
    try {
        await Promise.all([
            waitForMarker(alphaMarker, text => text.startsWith('entered:')),
            waitForMarker(betaMarker, text => text.startsWith('entered:')),
        ]);
        assert.equal(JSON.parse(await fs.readFile(exclusiveLockPathFor(pathLockKey(alpha)), 'utf8')).pid, first.pid);
        assert.equal(JSON.parse(await fs.readFile(exclusiveLockPathFor(pathLockKey(beta)), 'utf8')).pid, second.pid);
        await fs.writeFile(releaseFile, 'go');
        const results = await Promise.all([
            waitForMarker(alphaMarker, text => text.startsWith('err:'), 2000),
            waitForMarker(betaMarker, text => text.startsWith('err:'), 2000),
        ]);
        assert.deepEqual(results, ['err:lock_reentered', 'err:lock_reentered']);
    } finally {
        await fs.writeFile(releaseFile, 'go').catch(() => {});
        await Promise.all([stopChild(first), stopChild(second)]);
    }
    assert.equal(await fs.access(exclusiveLockPathFor(pathLockKey(alpha))).then(() => true, () => false), false);
    assert.equal(await fs.access(exclusiveLockPathFor(pathLockKey(beta))).then(() => true, () => false), false);
});

exclusiveTest('a deferred second lock does not overlap the outer filesystem lock', async () => {
    const root = await freshDir('deferred');
    const outer = path.join(root, 'outer.jsonl');
    const inner = path.join(root, 'inner.jsonl');
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 500 });
    let overlapped = false;
    let sawOuter = true;
    /** @type {Promise<string>} */
    let follow;
    await withPathLocks([outer], async () => {
        follow = runAfterExclusiveFsLocks(async () => {
            sawOuter = await fs.access(exclusiveLockPathFor(pathLockKey(outer))).then(() => true, () => false);
            await withPathLocks([inner], async () => {
                const outerHeld = await fs.access(exclusiveLockPathFor(pathLockKey(outer))).then(() => true, () => false);
                const innerHeld = await fs.access(exclusiveLockPathFor(pathLockKey(inner))).then(() => true, () => false);
                overlapped = outerHeld && innerHeld;
            });
            return 'inner';
        });
        await Promise.resolve();
        assert.equal(await fs.access(exclusiveLockPathFor(pathLockKey(outer))).then(() => true, () => false), true);
    });
    assert.equal(await follow, 'inner');
    assert.equal(sawOuter, false);
    assert.equal(overlapped, false);
    assert.equal(await fs.access(exclusiveLockPathFor(pathLockKey(outer))).then(() => true, () => false), false);
    assert.equal(await fs.access(exclusiveLockPathFor(pathLockKey(inner))).then(() => true, () => false), false);
});

exclusiveTest('a long path stores a key hash and does not leave a lock file', async () => {
    const root = await freshDir('long-path');
    const file = path.join(root, `${'p'.repeat(5000)}.jsonl`);
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 500 });
    const key = pathLockKey(file);
    assert.ok(Buffer.byteLength(JSON.stringify({ key })) > 4096);
    await withPathLocks([file], async () => {
        const payload = JSON.parse(await fs.readFile(exclusiveLockPathFor(key), 'utf8'));
        assert.equal(Object.hasOwn(payload, 'key'), false);
        assert.equal(payload.keyHash, exclusiveLockPathFor(key).split(path.sep).pop().replace(/\.exclusive$/, ''));
        assert.equal(payload.pid, process.pid);
    });
    assert.equal(await fs.access(exclusiveLockPathFor(key)).then(() => true, () => false), false);
    const dead = {
        pid: exitedPid(),
        hostname: os.hostname(),
        startedAt: '2000-01-01T00:00:00.000Z',
        token: 'dead-hash',
        keyHash: exclusiveLockPathFor(key).split(path.sep).pop().replace(/\.exclusive$/, ''),
    };
    await fs.mkdir(path.dirname(exclusiveLockPathFor(key)), { recursive: true });
    await fs.writeFile(exclusiveLockPathFor(key), `${JSON.stringify(dead)}\n`);
    assert.equal(await withPathLocks([file], async () => 'reclaimed'), 'reclaimed');
    assert.equal(await fs.access(exclusiveLockPathFor(key)).then(() => true, () => false), false);
});

exclusiveTest('path lock acquisition does not invoke a compiler', async () => {
    const source = await fs.readFile(new URL('../src/path-fs-lock.js', import.meta.url), 'utf8');
    const server = await fs.readFile(new URL('../src/server-main.js', import.meta.url), 'utf8');
    assert.equal(source.includes('gcc'), false);
    assert.equal(source.includes('node_api'), false);
    assert.equal(source.includes('child_process'), false);
    assert.match(server, /cliArgs\.exclusiveDataRoot \|\| cliArgs\.crossProcessPathLocks/);
    assert.match(server, /configureCrossProcessPathLocks/);
    const chats = await fs.readFile(new URL('../src/endpoints/chats.js', import.meta.url), 'utf8');
    assert.match(chats, /runAfterExclusiveFsLocks\(\(\) => withPathLock\(directory/);
});

/**
 * @param {string} root
 * @param {'file'|'dir'} mode
 * @param {string} target
 * @param {string} marker
 * @param {number} timeoutMs
 * @param {string} [releaseFile]
 */
function startFence(root, mode, target, marker, timeoutMs, releaseFile = '') {
    return startHelper([root, mode, target, marker, String(timeoutMs), releaseFile], fenceHelper);
}

async function lockNames(directory) {
    try {
        return await fs.readdir(directory);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

exclusiveTest('shared parent fences let two files in one process run together', async () => {
    const root = await freshDir('shared-overlap');
    const directory = path.join(root, 'chats');
    await fs.mkdir(directory);
    const alpha = path.join(directory, 'a.jsonl');
    const beta = path.join(directory, 'b.jsonl');
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 1000 });
    const release = deferred();
    const entered = deferred();
    const first = withPathLocks(chatLockPaths([alpha]), async () => {
        entered.resolve();
        await release.promise;
    });
    await entered.promise;
    const second = await withPathLocks(chatLockPaths([beta]), async () => {
        const names = await lockNames(fallbackPathLockDirectory(root));
        assert.equal(names.filter(name => SHARED_LOCK_NAME.test(name)).length, 2);
        assert.equal(names.filter(name => name.endsWith('.exclusive')).length, 2);
        return 'second';
    });
    assert.equal(second, 'second');
    release.resolve();
    await first;
    const left = await lockNames(fallbackPathLockDirectory(root));
    assert.deepEqual(left.filter(name => SHARED_LOCK_NAME.test(name) || name.endsWith('.exclusive')), []);
});

exclusiveTest('a directory exclusive blocks a child file writer until timeout', async () => {
    const root = await freshDir('dir-vs-file');
    const directory = path.join(root, 'chats');
    await fs.mkdir(directory);
    const file = path.join(directory, 'child.jsonl');
    const heldMarker = path.join(root, 'held.txt');
    const busyMarker = path.join(root, 'busy.txt');
    const releaseFile = path.join(root, 'release');
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 2000 });
    const holder = startFence(root, 'dir', directory, heldMarker, 5000, releaseFile);
    try {
        await waitForMarker(heldMarker, text => text.startsWith('entered:'));
        const dirLock = exclusiveLockPathFor(pathLockKey(directory));
        assert.equal(JSON.parse(await fs.readFile(dirLock, 'utf8')).pid, holder.pid);
        const waiter = startFence(root, 'file', file, busyMarker, 250, '');
        try {
            const text = await waitForMarker(busyMarker, value => value.startsWith('err:'));
            assert.equal(text, 'err:path_lock_busy');
            assert.equal(JSON.parse(await fs.readFile(dirLock, 'utf8')).pid, holder.pid);
            assert.equal(await fs.access(exclusiveLockPathFor(pathLockKey(file))).then(() => true, () => false), false);
        } finally {
            await stopChild(waiter);
        }
    } finally {
        await fs.writeFile(releaseFile, 'go');
        await stopChild(holder);
    }
});

exclusiveTest('two child processes hold the same parent shared fence together', async () => {
    const root = await freshDir('two-shared');
    const directory = path.join(root, 'chats');
    await fs.mkdir(directory);
    const alpha = path.join(directory, 'a.jsonl');
    const beta = path.join(directory, 'b.jsonl');
    const alphaMarker = path.join(root, 'alpha.txt');
    const betaMarker = path.join(root, 'beta.txt');
    const releaseFile = path.join(root, 'release');
    const first = startFence(root, 'file', alpha, alphaMarker, 5000, releaseFile);
    const second = startFence(root, 'file', beta, betaMarker, 5000, releaseFile);
    try {
        await Promise.all([
            waitForMarker(alphaMarker, text => text.startsWith('entered:')),
            waitForMarker(betaMarker, text => text.startsWith('entered:')),
        ]);
        const names = await lockNames(fallbackPathLockDirectory(root));
        assert.equal(names.filter(name => SHARED_LOCK_NAME.test(name)).length, 2);
        assert.equal(names.filter(name => name.endsWith('.exclusive')).length, 2);
    } finally {
        await fs.writeFile(releaseFile, 'go');
        await Promise.all([stopChild(first), stopChild(second)]);
    }
});

exclusiveTest('a directory exclusive waits until the child file writer releases', async () => {
    const root = await freshDir('exclusive-waits');
    const directory = path.join(root, 'chats');
    await fs.mkdir(directory);
    const file = path.join(directory, 'child.jsonl');
    const heldMarker = path.join(root, 'held.txt');
    const nextMarker = path.join(root, 'next.txt');
    const releaseFile = path.join(root, 'release');
    const holder = startFence(root, 'file', file, heldMarker, 8000, releaseFile);
    try {
        await waitForMarker(heldMarker, text => text.startsWith('entered:'));
        const waiter = startFence(root, 'dir', directory, nextMarker, 4000, '');
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

exclusiveTest('a dead shared holder is reclaimed by a directory exclusive', async () => {
    const root = await freshDir('dead-shared');
    const directory = path.join(root, 'chats');
    await fs.mkdir(directory);
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 500 });
    const key = pathLockKey(directory);
    const token = '00000000-0000-4000-8000-0000000000aa';
    const sharedPath = sharedLockPathFor(key, token);
    await fs.mkdir(path.dirname(sharedPath), { recursive: true });
    const dead = {
        pid: exitedPid(),
        hostname: os.hostname(),
        startedAt: '2000-01-01T00:00:00.000Z',
        token,
        key,
    };
    await fs.writeFile(sharedPath, `${JSON.stringify(dead)}\n`);
    assert.equal(await withPathLocks([directory], async () => 'reclaimed'), 'reclaimed');
    assert.equal(await fs.access(sharedPath).then(() => true, () => false), false);
});

exclusiveTest('an old symlink or oversized lock is quarantined and a live file is kept', async () => {
    const root = await freshDir('quarantine');
    const directory = path.join(root, 'chats');
    await fs.mkdir(directory);
    const file = path.join(directory, 'child.jsonl');
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 300 });
    const key = pathLockKey(file);
    const lockPath = exclusiveLockPathFor(key);
    const quarantineDir = path.join(path.dirname(lockPath), PATH_LOCK_QUARANTINE_DIRECTORY);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    const old = new Date(Date.now() - LOCK_QUARANTINE_MIN_AGE_MS - 5000);
    await fs.symlink('nowhere', lockPath);
    await fs.lutimes(lockPath, old, old);
    /** @type {string[]} */
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
        warnings.push(args.join(' '));
    };
    try {
        await withPathLocks(chatLockPaths([file]), async () => {
            const payload = JSON.parse(await fs.readFile(lockPath, 'utf8'));
            assert.equal(payload.pid, process.pid);
            const quarantined = await fs.readdir(quarantineDir);
            assert.equal(quarantined.length, 1);
        });
    } finally {
        console.warn = originalWarn;
    }
    assert.equal(warnings.some(line => line.includes('quarantined')), true);

    await fs.writeFile(lockPath, 'x'.repeat(MAX_LOCK_BYTES + 64));
    await fs.utimes(lockPath, old, old);
    await withPathLocks([file], async () => {
        const stat = await fs.stat(lockPath);
        assert.ok(stat.size <= MAX_LOCK_BYTES);
    });
    const quarantined = await fs.readdir(quarantineDir);
    assert.ok(quarantined.length >= 2);

    await fs.rm(lockPath, { force: true });
    await fs.symlink('nowhere', lockPath);
    await assert.rejects(
        withPathLocks([file], async () => 'stolen'),
        error => error instanceof ChatLifecycleError && error.reason === 'path_lock_unavailable',
    );
    assert.equal((await fs.lstat(lockPath)).isSymbolicLink(), true);

    await fs.rm(lockPath);
    const identity = readProcessIdentity(process.pid);
    const live = {
        pid: process.pid,
        hostname: os.hostname(),
        startedAt: new Date().toISOString(),
        token: randomUUID(),
        key,
    };
    if (identity.bootId) live.bootId = identity.bootId;
    if (Number.isSafeInteger(identity.processStartMs)) live.processStartMs = identity.processStartMs;
    const liveText = `${JSON.stringify(live)}\n`;
    await fs.writeFile(lockPath, liveText);
    await fs.utimes(lockPath, old, old);
    await assert.rejects(
        withPathLocks([file], async () => 'stolen'),
        error => error instanceof ChatLifecycleError && error.reason === 'path_lock_busy',
    );
    assert.equal(await fs.readFile(lockPath, 'utf8'), liveText);
});

exclusiveTest('all reservations select the short namespace before acquisition', async () => {
    const root = await freshDir('fallback-root');
    const file = path.join(root, 'chat.jsonl');
    const primaryDir = path.join(root, PATH_LOCK_DIRECTORY);
    const expected = fallbackPathLockDirectory(root);
    assert.equal(fallbackPathLockDirectory(root), expected);
    assert.equal(path.basename(expected).length, 64);
    assert.equal(expected.startsWith(path.join(os.tmpdir(), 'st-lab-path-locks')), true);
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 500 });
    assert.equal(activePathLockLocation().directory, expected);
    setPathLockPathLimitForTest(1);
    try {
        await withPathLocks([file], async () => {
            const location = activePathLockLocation();
            assert.equal(location && location.kind, 'fallback');
            assert.equal(location && location.directory, expected);
            const lockPath = exclusiveLockPathFor(pathLockKey(file));
            assert.equal(String(lockPath).startsWith(`${expected}${path.sep}`), true);
            const payload = JSON.parse(await fs.readFile(lockPath, 'utf8'));
            assert.equal(payload.pid, process.pid);
            assert.equal((await fs.stat(expected)).mode & 0o777, 0o700);
        });
        const primaryNames = await lockNames(primaryDir);
        assert.deepEqual(primaryNames.filter(name => name.endsWith('.exclusive') || SHARED_LOCK_NAME.test(name)), []);
    } finally {
        setPathLockPathLimitForTest(0);
        await fs.rm(expected, { recursive: true, force: true });
    }
});

exclusiveTest('waiting reclaimers cannot move a replacement live lock past the acquisition gate', async () => {
    const root = await freshDir('serialized-reclaim');
    const target = path.join(root, 'directory');
    await fs.mkdir(target);
    configureCrossProcessPathLocks({ enabled: true, root, timeoutMs: 150 });
    const lock = exclusiveLockPathFor(pathLockKey(target));
    await fs.mkdir(path.dirname(lock), { recursive: true });
    const gate = lock.replace(/\.exclusive$/, '.gate');
    await fs.mkdir(gate);
    await fs.writeFile(lock, JSON.stringify({ pid: 2147483647, hostname: os.hostname(), key: pathLockKey(target) }));
    const contenders = [1, 2].map(() => withPathLocks([target], async () => assert.fail('live lock stolen')));
    // A serialized publisher replaces the stale bytes before releasing its gate.
    const live = JSON.stringify({ pid: process.pid, hostname: os.hostname(), key: pathLockKey(target) });
    await fs.writeFile(lock, live);
    await fs.rmdir(gate);
    for (const contender of contenders) {
        await assert.rejects(contender, error => error.reason === 'path_lock_busy');
    }
    assert.equal(await fs.readFile(lock, 'utf8'), live);
});
