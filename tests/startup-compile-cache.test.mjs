import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enableStartupCompileCache } from '../src/compile-cache.js';

test('missing compile cache API does not touch the filesystem (Node 20)', () => {
    assert.equal(enableStartupCompileCache('\0invalid-directory', {}), null);
});

test('compile cache creates its directory before invoking the optional API', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-cache-'));
    const directory = path.join(root, 'nested', 'cache');
    const status = { status: 1 };
    assert.equal(enableStartupCompileCache(directory, { enableCompileCache(actual) {
        assert.equal(actual, directory);
        assert.ok(fs.statSync(actual).isDirectory());
        return status;
    } }), status);
});

test('unwritable compile cache directory is safe, including for privileged test users', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-cache-blocked-'));
    const blocker = path.join(root, 'file');
    fs.writeFileSync(blocker, 'retained directory blocker');
    let called = false;
    assert.equal(enableStartupCompileCache(path.join(blocker, 'cache'), { enableCompileCache() { called = true; } }), null);
    assert.equal(called, false);
    assert.equal(fs.readFileSync(blocker, 'utf8'), 'retained directory blocker');
});

test('compile cache API failures do not prevent startup', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-cache-error-'));
    assert.equal(enableStartupCompileCache(root, { enableCompileCache() { throw new Error('cache unavailable'); } }), null);
    const failure = { status: 0, message: 'permission denied' };
    assert.equal(enableStartupCompileCache(root, { enableCompileCache() { return failure; } }), failure);
});
