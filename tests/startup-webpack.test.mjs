import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import webpack from 'webpack';

const configSource = fs.readFileSync(new URL('../webpack.config.js', import.meta.url), 'utf8');
const middlewareSource = fs.readFileSync(new URL('../src/middleware/webpack-serve.js', import.meta.url), 'utf8');
const fixtureRoot = fileURLToPath(new URL(`../.fixtures/startup-webpack-${crypto.randomUUID()}/`, import.meta.url));
fs.mkdirSync(fixtureRoot, { recursive: true });
const originalInputs = [];

function rememberOriginal(file) {
    originalInputs.push({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
}

after(() => {
    const verification = originalInputs.map(original => {
        const candidates = [original.file, `${original.file}.before-change.bak`, `${original.file}.before-error.bak`, original.retiredAt].filter(Boolean);
        const retained = candidates.find(file => fs.existsSync(file)
            && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === original.sha256);
        return { ...original, retainedAt: retained ?? null };
    });
    fs.writeFileSync(path.join(fixtureRoot, 'synthetic-source-integrity.json'), JSON.stringify(verification, null, 2));
    assert.ok(verification.every(file => file.retainedAt !== null), 'Every synthetic input must retain its original bytes, either in place or in its backup');
});

// The complete configuration is imported from a disposable, synthetic project.
// Only the version provider is substituted; filesystem I/O and Webpack are real.
// All fixtures and retired files remain on disk for review.
function fixture(name) {
    const root = path.join(fixtureRoot, name);
    const data = path.join(root, 'synthetic-data');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'public'), { recursive: true });
    fs.mkdirSync(data, { recursive: true });
    // The unfixed implementation permanently removes old caches. Redirect that
    // legacy syscall into this fixture's recycle directory during RED runs too.
    fs.writeFileSync(path.join(root, 'webpack.config.js'), configSource.replace("import fs from 'node:fs';", "import fs from './src/startup-safe-fs.js';"));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'startup-fixture', type: 'module', version: '1.0.0' }));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ name: 'startup-fixture', lockfileVersion: 3, packages: {} }));
    fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ pkgVersion: '1.0.0', gitRevision: 'synthetic-head-a' }));
    fs.writeFileSync(path.join(root, 'src/server-directory.js'), `export const serverDirectory = ${JSON.stringify(root)};\n`);
    fs.writeFileSync(path.join(root, 'src/util.js'), `import fs from 'node:fs';
export const color = { yellow: value => value, red: value => value };
export async function getVersion() { return JSON.parse(fs.readFileSync(new URL('../version.json', import.meta.url), 'utf8')); }
`);
    fs.writeFileSync(path.join(root, 'src/startup-safe-fs.js'), `import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = ${JSON.stringify(root)};
export default { ...fs, rmSync(target) {
    const relative = path.relative(root, path.resolve(target));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe legacy deletion target');
    const recycle = path.join(root, '.recycle', 'legacy-red');
    fs.mkdirSync(recycle, { recursive: true });
    fs.renameSync(target, path.join(recycle, crypto.randomUUID() + '-' + path.basename(target)));
} };
`);
    for (const file of ['webpack.config.js', 'package.json', 'package-lock.json', 'version.json', 'src/server-directory.js', 'src/util.js', 'src/startup-safe-fs.js']) {
        rememberOriginal(path.join(root, file));
    }
    return {
        root,
        data,
        async config(options = {}) {
            globalThis.DATA_ROOT = data;
            const module = await import(`${pathToFileURL(path.join(root, 'webpack.config.js')).href}?instance=${crypto.randomUUID()}`);
            return module.default(options);
        },
    };
}

function retire(file, label) {
    const recycle = path.join(path.dirname(file), '.recycle');
    fs.mkdirSync(recycle, { recursive: true });
    const target = path.join(recycle, `${label}-${crypto.randomUUID()}-${path.basename(file)}`);
    const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    fs.renameSync(file, target);
    for (const original of originalInputs.filter(original => original.file === file && original.sha256 === sourceHash)) {
        original.retiredAt = target;
    }
    return target;
}

// Executes the real middleware control flow. Callback failures that are not
// reproducible with ordinary writes are injected at the compiler I/O boundary.
function middleware(compilerFactory, getConfig) {
    const source = middlewareSource
        .replace(/^import .*;\r?\n/gm, '')
        .replace('export default function', 'function');
    const context = vm.createContext({ path, webpack: compilerFactory, getPublicLibConfig: getConfig, console: { log() {} } });
    new vm.Script(`${source}\nglobalThis.makeMiddleware = getWebpackServeMiddleware;`, { filename: 'src/middleware/webpack-serve.js' }).runInContext(context);
    return context.makeMiddleware();
}

const successfulStats = { hasErrors: () => false, toString: () => '' };

test('frontend cache survives a backend-only Git revision change', async () => {
    const f = fixture('backend-head');
    const before = await f.config();
    fs.copyFileSync(path.join(f.root, 'version.json'), path.join(f.root, 'version.json.before-change.bak'));
    fs.writeFileSync(path.join(f.root, 'version.json'), JSON.stringify({ pkgVersion: '1.0.0', gitRevision: 'synthetic-head-b' }));
    const after = await f.config();
    assert.equal(after.cache.cacheDirectory, before.cache.cacheDirectory, 'Unchanged frontend inputs must reuse the existing filesystem cache');
});

for (const input of ['webpack.config.js', 'package.json', 'package-lock.json']) {
    test(`frontend cache identity includes uncommitted ${input} bytes`, async () => {
        const f = fixture(`identity-${input}`);
        const before = await f.config();
        fs.copyFileSync(path.join(f.root, input), path.join(f.root, `${input}.before-change.bak`));
        fs.appendFileSync(path.join(f.root, input), '\n');
        const after = await f.config();
        assert.notEqual(after.cache.cacheDirectory, before.cache.cacheDirectory, 'A changed build input must select a new cache identity without a Git commit');
    });
}

test('Webpack explicitly snapshots application config, package and lockfile', async () => {
    const f = fixture('build-dependencies');
    const config = await f.config();
    const dependencies = Object.values(config.cache.buildDependencies ?? {}).flat();
    for (const input of ['webpack.config.js', 'package.json', 'package-lock.json']) {
        assert.ok(dependencies.includes(path.join(f.root, input)), `${input} must be an explicit build dependency`);
    }
});

test('a distribution without lockfiles still configures and builds real frontend output', { timeout: 60000 }, async () => {
    const f = fixture('optional-no-lock');
    const retiredLock = retire(path.join(f.root, 'package-lock.json'), 'optional-lock-absent');
    const entry = path.join(f.root, 'public/lib.js');
    fs.writeFileSync(entry, 'export const startupMarker = "synthetic-lockless-distribution";\n');
    rememberOriginal(entry);
    const config = await f.config();
    const dependencies = Object.values(config.cache.buildDependencies).flat();
    assert.ok(!dependencies.includes(path.join(f.root, 'package-lock.json')));
    assert.ok(!dependencies.includes(path.join(f.root, 'npm-shrinkwrap.json')));
    await middleware(webpack, () => config).runWebpackCompiler();
    const output = path.join(config.output.path, config.output.filename);
    assert.equal((await import(pathToFileURL(output).href)).startupMarker, 'synthetic-lockless-distribution');
    assert.ok(fs.existsSync(retiredLock), 'The absent-lock fixture must retain its original lock bytes in recycle');
});

for (const lockName of ['package-lock.json', 'npm-shrinkwrap.json']) {
    test(`optional ${lockName} presence, edits and absence change cache identity`, async () => {
        const f = fixture(`optional-identity-${lockName}`);
        const lock = path.join(f.root, lockName);
        if (fs.existsSync(lock)) retire(lock, 'initial-lock-absent');
        const absent = await f.config();
        assert.ok(!Object.values(absent.cache.buildDependencies).flat().includes(lock));

        fs.writeFileSync(lock, JSON.stringify({ name: 'synthetic-lock-input', lockfileVersion: 3, packages: {} }));
        rememberOriginal(lock);
        const appeared = await f.config();
        assert.notEqual(appeared.cache.cacheDirectory, absent.cache.cacheDirectory, 'Adding a previously absent optional input must invalidate its identity');
        assert.ok(Object.values(appeared.cache.buildDependencies).flat().includes(lock), 'An existing optional lock must be validated by Webpack');

        fs.copyFileSync(lock, `${lock}.before-change.bak`);
        fs.writeFileSync(lock, JSON.stringify({ name: 'synthetic-changed-lock-input', lockfileVersion: 3, packages: {} }));
        const changed = await f.config();
        assert.notEqual(changed.cache.cacheDirectory, appeared.cache.cacheDirectory, 'Lock bytes must affect the cache identity without a Git commit');

        const retired = retire(lock, 'changed-lock-absent');
        const absentAgain = await f.config();
        assert.equal(absentAgain.cache.cacheDirectory, absent.cache.cacheDirectory, 'The explicit absent input identity must be stable');
        assert.ok(!Object.values(absentAgain.cache.buildDependencies).flat().includes(lock));
        assert.ok(fs.existsSync(retired));
    });
}

test('missing package metadata remains fatal while its fixture bytes are recoverable', async () => {
    const f = fixture('required-package');
    const retiredPackage = retire(path.join(f.root, 'package.json'), 'required-package-absent');
    await assert.rejects(f.config(), error => error.code === 'ENOENT' && /package\.json/.test(error.path));
    assert.ok(fs.existsSync(retiredPackage));
});

test('outdated caches are recoverable and the existing recycle directory is preserved', async () => {
    const f = fixture('recycle');
    const before = await f.config();
    const webpackRoot = path.dirname(path.dirname(before.cache.cacheDirectory));
    const outdated = path.join(webpackRoot, 'synthetic-old-cache');
    const recycle = path.join(webpackRoot, '.recycle');
    fs.mkdirSync(outdated, { recursive: true });
    fs.mkdirSync(recycle, { recursive: true });
    fs.writeFileSync(path.join(outdated, 'original.pack'), 'synthetic original cache bytes');
    fs.writeFileSync(path.join(recycle, 'already-retired.pack'), 'synthetic previous recovery bytes');
    await f.config({ pruneCache: true });
    assert.ok(fs.existsSync(path.join(recycle, 'already-retired.pack')), 'An existing recycle directory must not be pruned');
    assert.equal(fs.readFileSync(path.join(recycle, 'already-retired.pack'), 'utf8'), 'synthetic previous recovery bytes');
    const recoverableFiles = fs.readdirSync(recycle, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(recycle, entry.name, 'original.pack'));
    assert.ok(recoverableFiles.some(file => fs.existsSync(file) && fs.readFileSync(file, 'utf8') === 'synthetic original cache bytes'), 'Outdated cache bytes must survive in the recycle directory');
    assert.equal(fs.existsSync(outdated), false);
    await f.config({ pruneCache: true });
    assert.equal(fs.readFileSync(path.join(recycle, 'already-retired.pack'), 'utf8'), 'synthetic previous recovery bytes');
});

test('dist output remains separate from the configured data root', async () => {
    const f = fixture('dist-root');
    const previous = process.cwd();
    try {
        process.chdir(f.root);
        const regular = await f.config();
        const dist = await f.config({ forceDist: true });
        assert.ok(regular.output.path.startsWith(path.join(f.data, '_webpack') + path.sep));
        assert.ok(dist.output.path.startsWith(path.join(f.root, 'dist', '_webpack') + path.sep));
    } finally {
        process.chdir(previous);
    }
});

for (const mode of ['run-error', 'missing-stats', 'stats-errors', 'close-error', 'run-throw', 'close-throw']) {
    test(`startup rejects ${mode} and closes its compiler`, async () => {
        let closeCalls = 0;
        const expected = new Error(`synthetic ${mode}`);
        const compiler = {
            run(callback) {
                if (mode === 'run-throw') throw expected;
                if (mode === 'run-error') callback(expected);
                else if (mode === 'missing-stats') callback(null, undefined);
                else if (mode === 'stats-errors') callback(null, { hasErrors: () => true, toString: () => 'synthetic compiler diagnostic' });
                else callback(null, successfulStats);
            },
            close(callback) {
                closeCalls++;
                if (mode === 'close-throw') throw expected;
                callback(mode === 'close-error' ? expected : undefined);
            },
        };
        const app = middleware(() => compiler, () => ({ stats: {} }));
        let ready = false;
        const start = app.runWebpackCompiler().then(() => { ready = true; });
        await assert.rejects(start, mode === 'run-error' || mode === 'close-error' || mode === 'run-throw' || mode === 'close-throw'
            ? error => error === expected
            : /Webpack|stats|compil/i);
        assert.equal(ready, false, 'A failed frontend build must not advance startup to ready');
        assert.equal(closeCalls, 1, 'The compiler must be closed even after failure');
    });
}

test('successful startup remains pending until compiler close finishes', async () => {
    let finishClose;
    const compiler = { run: callback => callback(null, successfulStats), close: callback => { finishClose = callback; } };
    const app = middleware(() => compiler, () => ({ stats: {} }));
    let ready = false;
    const start = app.runWebpackCompiler().then(() => { ready = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ready, false);
    finishClose();
    await start;
    assert.equal(ready, true);
});

test('real Webpack repairs output and invalidates changed entry and installed dependency', { timeout: 120000 }, async t => {
    const f = fixture('real-compilation');
    const dependency = path.join(f.root, 'node_modules', 'startup-synthetic-dependency');
    fs.mkdirSync(dependency, { recursive: true });
    fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: 'startup-synthetic-dependency', version: '1.0.0', type: 'module', main: 'index.js' }));
    fs.writeFileSync(path.join(dependency, 'index.js'), 'export const dependencyMarker = "dependency-one";\n');
    rememberOriginal(path.join(dependency, 'package.json'));
    rememberOriginal(path.join(dependency, 'index.js'));
    const entry = path.join(f.root, 'public/lib.js');
    fs.writeFileSync(entry, 'import { dependencyMarker } from "startup-synthetic-dependency"; export const startupMarker = "entry-one:" + dependencyMarker;\n');
    rememberOriginal(entry);

    async function build() {
        const config = await f.config();
        const app = middleware(webpack, () => config);
        await app.runWebpackCompiler();
        const output = path.join(config.output.path, config.output.filename);
        const module = await import(`${pathToFileURL(output).href}?result=${crypto.randomUUID()}`);
        return { config, output, marker: module.startupMarker, bytes: fs.readFileSync(output) };
    }

    const first = await build();
    assert.equal(first.marker, 'entry-one:dependency-one');
    const warm = await build();
    assert.deepEqual(warm.bytes, first.bytes, 'A validated warm build must produce exactly the same frontend bytes');
    const originalOutput = retire(warm.output, 'missing-output');
    const restored = await build();
    assert.deepEqual(restored.bytes, first.bytes, 'A missing output must be rebuilt even with a warm compiler cache');
    assert.ok(fs.existsSync(originalOutput));
    fs.copyFileSync(restored.output, `${restored.output}.before-corruption.bak`);
    fs.writeFileSync(restored.output, 'synthetic corrupt output');
    fs.copyFileSync(restored.output, `${restored.output}.before-repair.bak`);
    const repaired = await build();
    assert.deepEqual(repaired.bytes, first.bytes, 'Corrupted output must be replaced by the validated build');

    fs.copyFileSync(entry, `${entry}.before-change.bak`);
    fs.writeFileSync(entry, 'import { dependencyMarker } from "startup-synthetic-dependency"; export const startupMarker = "entry-two:" + dependencyMarker;\n');
    const changedEntry = await build();
    assert.equal(changedEntry.config.cache.cacheDirectory, first.config.cache.cacheDirectory, 'Entry edits stay within Webpack\'s own snapshot-validated cache');
    assert.equal(changedEntry.marker, 'entry-two:dependency-one');

    // Installed managed packages are immutable per version in Webpack. A real
    // update changes both their package identity and their shipped source files.
    fs.copyFileSync(path.join(dependency, 'package.json'), path.join(dependency, 'package.json.before-change.bak'));
    fs.copyFileSync(path.join(dependency, 'index.js'), path.join(dependency, 'index.js.before-change.bak'));
    fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: 'startup-synthetic-dependency', version: '2.0.0', type: 'module', main: 'index.js' }));
    fs.writeFileSync(path.join(dependency, 'index.js'), 'export const dependencyMarker = "dependency-two";\n');
    const changedDependency = await build();
    assert.equal(changedDependency.marker, 'entry-two:dependency-two');

    fs.copyFileSync(entry, `${entry}.before-error.bak`);
    fs.writeFileSync(entry, 'import "startup-synthetic-unresolvable-package";\n');
    const badConfig = await f.config();
    let ready = false;
    await assert.rejects(middleware(webpack, () => badConfig).runWebpackCompiler().then(() => { ready = true; }), /Webpack|compil/i);
    assert.equal(ready, false, 'A real unresolved module cannot be reported as a ready server');
    assert.deepEqual(fs.readFileSync(changedDependency.output), changedDependency.bytes, 'A failed build must retain the last complete frontend output');
    t.diagnostic(`Synthetic fixtures retained at ${f.root}`);
});
