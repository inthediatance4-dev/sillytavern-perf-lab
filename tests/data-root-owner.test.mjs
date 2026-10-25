import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { acquireDataRootOwnership, DATA_ROOT_OWNER_LOCK, releaseDataRootOwnership } from '../src/data-root-owner.js';

const moduleUrl = new URL('../src/data-root-owner.js', import.meta.url).href;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'st-owner-'));
const helper = path.join(temp, 'acquire-once.mjs');
await fs.writeFile(helper, `import { acquireDataRootOwnership } from ${JSON.stringify(moduleUrl)};\nacquireDataRootOwnership(process.argv[2]);\n`);

function runAcquire(dataRoot) {
    return spawnSync(process.execPath, [helper, dataRoot], { encoding: 'utf8', timeout: 10000 });
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
