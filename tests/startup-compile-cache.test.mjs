import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { enableStartupCompileCache } from '../src/compile-cache.js';

test('real server bootstrap enables the cache before command-line and main graph evaluation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-cache-bootstrap-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    for (const file of ['server.js', 'src/compile-cache.js', 'src/server-directory.js']) {
        fs.copyFileSync(new URL(`../${file}`, import.meta.url), path.join(root, file));
    }
    // Check during module evaluation: a static command-line import would fail
    // before the bootstrap can enable caching on supported Node versions.
    fs.writeFileSync(path.join(root, 'src/assert-active.js'), `import assert from 'node:assert/strict';
import module from 'node:module';
export const supported = typeof module.enableCompileCache === 'function';
if (supported) assert.ok(module.getCompileCacheDir(), 'cache must be active during graph evaluation');
`);
    fs.writeFileSync(path.join(root, 'src/command-line.js'), `import './assert-active.js';
export class CommandLineParser { parse() { return { dataRoot: 'synthetic' }; } }
`);
    fs.writeFileSync(path.join(root, 'src/server-main.js'), `import { supported } from './assert-active.js';
console.log('CACHE_BOOTSTRAP=' + JSON.stringify({ supported }));
`);
    const env = Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !['NODE_COMPILE_CACHE', 'NODE_DISABLE_COMPILE_CACHE', 'NODE_OPTIONS', 'ST_STARTUP_TRACE'].includes(key)));
    const child = spawnSync(process.execPath, [path.join(root, 'server.js')], { env, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.split('\n').find(line => line.startsWith('CACHE_BOOTSTRAP=')).slice('CACHE_BOOTSTRAP='.length));
    const directory = path.join(root, 'node_modules/.cache/st-compile-cache');
    if (result.supported) {
        const entries = fs.readdirSync(directory, { recursive: true }).filter(file => fs.statSync(path.join(directory, file)).isFile());
        assert.ok(entries.length > 0, 'First run must flush real compiled modules to disk');
    } else {
        assert.equal(fs.existsSync(directory), false);
    }
});

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
