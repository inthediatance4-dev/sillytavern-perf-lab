import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { acquireDataRootOwnership, DATA_ROOT_OWNER_LOCK, releaseDataRootOwnership } from '../src/data-root-owner.js';

const moduleUrl = new URL('../src/data-root-owner.js', import.meta.url).href;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'st-owner-'));
const helper = path.join(temp, 'acquire-once.mjs');
await fs.writeFile(helper, `
import fs from 'node:fs';
import { acquireDataRootOwnership } from ${JSON.stringify(moduleUrl)};
const root = process.argv[2];
const mode = process.argv[3] || 'exit';
const marker = process.argv[4];
try {
    acquireDataRootOwnership(root);
} catch (error) {
    if (marker) fs.writeFileSync(marker, 'err');
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

function runAcquire(dataRoot, mode = 'exit') {
    return spawnSync(process.execPath, [helper, dataRoot, mode], { encoding: 'utf8', timeout: 10000 });
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

async function freshRoot(name) {
    const dataRoot = path.join(temp, name);
    await fs.mkdir(dataRoot);
    return dataRoot;
}

test('a live owner blocks another process and leaves the lock unchanged', async () => {
    const dataRoot = await freshRoot('live');
    const owned = acquireDataRootOwnership(dataRoot);
    const before = await fs.readFile(owned.lockPath, 'utf8');
    try {
        const child = runAcquire(dataRoot);
        assert.notEqual(child.status, 0);
        assert.match(child.stderr, new RegExp(`pid ${process.pid}`));
        assert.match(child.stderr, new RegExp(os.hostname().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.equal(await fs.readFile(owned.lockPath, 'utf8'), before);
    } finally {
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

test('a symlink owner file is not followed or rewritten', async () => {
    const dataRoot = await freshRoot('symlink');
    const lockPath = path.join(dataRoot, DATA_ROOT_OWNER_LOCK);
    const victim = path.join(dataRoot, 'victim');
    await fs.writeFile(victim, 'keep');
    await fs.symlink(victim, lockPath);
    assert.throws(() => acquireDataRootOwnership(dataRoot), /left in place/);
    assert.equal(await fs.readFile(victim, 'utf8'), 'keep');
    const stat = await fs.lstat(lockPath);
    assert.equal(stat.isSymbolicLink(), true);
});

test('two processes cannot both reclaim one stale owner', async () => {
    const dataRoot = await freshRoot('race');
    const lockPath = path.join(dataRoot, DATA_ROOT_OWNER_LOCK);
    const stale = { pid: exitedPid(), hostname: os.hostname(), startedAt: '2000-01-01T00:00:00.000Z' };
    await fs.writeFile(lockPath, `${JSON.stringify(stale)}\n`);
    const firstMarker = path.join(dataRoot, 'first.txt');
    const secondMarker = path.join(dataRoot, 'second.txt');
    const first = spawn(process.execPath, [helper, dataRoot, 'hold', firstMarker], { stdio: 'ignore' });
    const second = spawn(process.execPath, [helper, dataRoot, 'hold', secondMarker], { stdio: 'ignore' });
    try {
        const markers = await Promise.all([waitForMarker(firstMarker), waitForMarker(secondMarker)]);
        assert.deepEqual(markers.slice().sort(), ['err', 'ok']);
        const current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
        const winner = markers[0] === 'ok' ? first : second;
        assert.equal(current.pid, winner.pid);
        assert.equal(current.hostname, os.hostname());
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
});
