import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url));
const fixtures = path.join(repository, '.fixtures', `startup-lazy-${crypto.randomUUID()}`);
fs.mkdirSync(fixtures, { recursive: true });

// Run the real source module graph in a fresh process. Only Transformers' model
// factory/image decoder is substituted, so no model downloads are necessary.
// Vectra, Express, filesystem operations, and all application imports are real.
// Fixtures are retained; no cleanup deletes files or touches an existing cache.
const loaderSource = `
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const targetNames = new Set(['sillytavern-transformers', 'vectra']);
const knownUrls = new Map();
let failed = false;
function record(value) {
    fs.appendFileSync(process.env.ST_LAZY_IMPORT_LOG, JSON.stringify(value) + '\\n');
}
export async function resolve(specifier, context, nextResolve) {
    if (!targetNames.has(specifier)) return nextResolve(specifier, context);
    record({ event: 'resolve', package: specifier });
    if (specifier === process.env.ST_LAZY_FAIL_ONCE && !failed) {
        failed = true;
        throw new Error('Synthetic dependency import failure: ' + specifier);
    }
    const result = specifier === 'sillytavern-transformers'
        ? { url: pathToFileURL(process.env.ST_LAZY_TRANSFORMERS_MOCK).href, shortCircuit: true }
        : await nextResolve(specifier, context);
    knownUrls.set(result.url, specifier);
    return result;
}
export async function load(url, context, nextLoad) {
    if (knownUrls.has(url)) record({ event: 'load', package: knownUrls.get(url) });
    return nextLoad(url, context);
}
`;

const transformersMockSource = `
import assert from 'node:assert/strict';
import path from 'node:path';
const state = globalThis.__startupTransformers = { writes: [], calls: [] };
const wasm = {};
for (const key of ['numThreads', 'wasmPaths']) {
    let value;
    Object.defineProperty(wasm, key, {
        get() { return value; },
        set(next) { state.writes.push({ key, value: next }); value = next; },
        enumerable: true,
    });
}
export const env = { backends: { onnx: { wasm } } };
// Keep the cold import pending while simultaneous callers enter the real APIs.
await new Promise(resolve => setTimeout(resolve, 40));
function requireConfiguration() {
    assert.equal(wasm.numThreads, 1, 'Configure threads before using Transformers');
    assert.equal(wasm.wasmPaths,
        path.join(process.env.ST_LAZY_REPOSITORY, 'node_modules', 'sillytavern-transformers', 'dist') + path.sep,
        'Use the existing local WASM directory before calling the dependency');
}
export async function pipeline(task, model, options) {
    requireConfiguration();
    state.calls.push({ task, model, options });
    return { task, model, options, async dispose() {} };
}
export const RawImage = {
    async fromBlob(blob) {
        requireConfiguration();
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        if (bytes[0] === 0) throw new Error('Synthetic invalid image');
        return { syntheticImage: true, bytes };
    },
};
`;

async function runScenario(name, scenario, failOnce = '') {
    const fixture = path.join(fixtures, name);
    fs.mkdirSync(fixture, { recursive: true });
    const loader = path.join(fixture, 'loader.mjs');
    const mock = path.join(fixture, 'transformers-mock.mjs');
    const entry = path.join(fixture, 'scenario.mjs');
    const log = path.join(fixture, 'imports.jsonl');
    fs.writeFileSync(loader, loaderSource);
    fs.writeFileSync(mock, transformersMockSource);
    fs.writeFileSync(log, '');
    fs.writeFileSync(path.join(fixture, 'config.yaml'),
        'enableDownloadableTokenizers: false\nextensions:\n  enabled: false\n  autoUpdate: false\n  models:\n    autoDownload: false\n    classification: synthetic-config-model\n');

    const preamble = `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const repository = ${JSON.stringify(repository)};
const fixture = ${JSON.stringify(fixture)};
const source = relative => pathToFileURL(path.join(repository, relative)).href;
globalThis.DATA_ROOT = path.join(fixture, 'data');
fs.mkdirSync(globalThis.DATA_ROOT, { recursive: true });
const util = await import(source('src/util.js'));
util.setConfigFilePath(path.join(fixture, 'config.yaml'));
function imports(packageName, event = 'load') {
    return fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').filter(Boolean)
        .map(line => JSON.parse(line)).filter(item => item.package === packageName && item.event === event);
}
async function importTransformers() {
    let module;
    await assert.doesNotReject(async () => { module = await import(source('src/transformers.js')); },
        'Loading application APIs must defer optional dependency failures until first use');
    return module;
}
async function vectorApp(run) {
    let vectors;
    await assert.doesNotReject(async () => { vectors = await import(source('src/endpoints/vectors.js')); },
        'Loading vector routes must not load the optional vector database');
    const { default: express } = await import(source('node_modules/express/index.js'));
    const directories = { vectors: path.join(globalThis.DATA_ROOT, 'vectors') };
    fs.mkdirSync(directories.vectors, { recursive: true });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { directories }; next(); });
    app.use('/api/vector', vectors.router);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const post = async (endpoint, body) => {
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/vector/' + endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000),
        });
        return { status: response.status, text: await response.text() };
    };
    try { await run({ post, directories }); }
    finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}
await (${scenario.toString()})();
console.log('SCENARIO_OK');
`;
    fs.writeFileSync(entry, preamble);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SILLYTAVERN_')));
    Object.assign(env, {
        ST_LAZY_IMPORT_LOG: log,
        ST_LAZY_TRANSFORMERS_MOCK: mock,
        ST_LAZY_REPOSITORY: repository,
        ST_LAZY_FAIL_ONCE: failOnce,
    });
    const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--experimental-loader', pathToFileURL(loader).href, entry], {
            cwd: fixture, env, windowsHide: true, timeout: 45000,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
        child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    fs.writeFileSync(path.join(fixture, 'stdout.log'), result.stdout);
    fs.writeFileSync(path.join(fixture, 'stderr.log'), result.stderr);
    assert.equal(result.code, 0, `${name}: ${result.signal ?? ''}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /SCENARIO_OK/);
}

test('registering the real startup route graph does not load Transformers or Vectra', async () => {
    await runScenario('routes-lazy', async function () {
        const { setupPrivateEndpoints } = await import(source('src/server-startup.js'));
        const { default: express } = await import(source('node_modules/express/index.js'));
        setupPrivateEndpoints(express());
        assert.equal(imports('sillytavern-transformers', 'resolve').length, 0, 'Startup must not import inference dependencies');
        assert.equal(imports('vectra', 'resolve').length, 0, 'Startup must not import the vector database');
    });
});

test('first pipeline use configures local runtime and preserves model options and warm reuse', async () => {
    await runScenario('pipeline-options', async function () {
        const api = await importTransformers();
        assert.equal(imports('sillytavern-transformers').length, 0);
        const pipe = await api.getPipeline('text-classification');
        assert.equal(pipe.model, 'synthetic-config-model');
        assert.deepEqual(pipe.options, { cache_dir: path.join(globalThis.DATA_ROOT, '_cache'), quantized: true, local_files_only: true });
        assert.strictEqual(await api.getPipeline('text-classification'), pipe);
        assert.equal(globalThis.__startupTransformers.calls.length, 1, 'A warmed pipeline must be reused');
        const forced = await api.getPipeline('text-to-speech', 'synthetic-forced-model');
        assert.equal(forced.model, 'synthetic-forced-model');
        assert.equal(forced.options.quantized, false);
        assert.equal(imports('sillytavern-transformers').length, 1);
    });
});

test('simultaneous image and pipeline requests configure the cold dependency exactly once', async () => {
    await runScenario('concurrent-transformers', async function () {
        const api = await importTransformers();
        assert.equal(imports('sillytavern-transformers').length, 0);
        const requests = [api.getPipeline('text-classification'), api.getPipeline('feature-extraction'),
            ...Array.from({ length: 12 }, () => api.getRawImage('AQID'))];
        const [classification, embedding, ...images] = await Promise.all(requests);
        assert.equal(classification.task, 'text-classification');
        assert.equal(embedding.task, 'feature-extraction');
        for (const image of images) assert.deepEqual(image, { syntheticImage: true, bytes: [1, 2, 3] });
        assert.equal(imports('sillytavern-transformers', 'resolve').length, 1, 'Cold callers must share the dependency import attempt');
        assert.deepEqual(globalThis.__startupTransformers.writes.map(write => write.key).sort(), ['numThreads', 'wasmPaths']);
    });
});

test('a failed dependency import rejects pipeline use and a later request can retry', async () => {
    await runScenario('pipeline-import-failure', async function () {
        const api = await importTransformers();
        await assert.rejects(api.getPipeline('text-classification'), /Synthetic dependency import failure/);
        const pipe = await api.getPipeline('text-classification');
        assert.equal(pipe.model, 'synthetic-config-model');
        assert.equal(imports('sillytavern-transformers', 'resolve').length, 2);
        assert.equal(imports('sillytavern-transformers').length, 1);
    }, 'sillytavern-transformers');
});

test('invalid image decoding keeps the existing null response', async () => {
    await runScenario('invalid-image', async function () {
        const api = await importTransformers();
        assert.equal(await api.getRawImage('AA=='), null);
        assert.deepEqual(await api.getRawImage('AQID'), { syntheticImage: true, bytes: [1, 2, 3] });
    });
});

test('a failed dependency import keeps image null behavior and a later image can retry', async () => {
    await runScenario('image-import-failure', async function () {
        const api = await importTransformers();
        assert.equal(await api.getRawImage('AQID'), null);
        assert.deepEqual(await api.getRawImage('AQID'), { syntheticImage: true, bytes: [1, 2, 3] });
        assert.equal(imports('sillytavern-transformers', 'resolve').length, 2);
    }, 'sillytavern-transformers');
});

test('first vector list requests use real LocalIndex and preserve stored hashes without inference', async () => {
    await runScenario('real-vectra-list', async function () {
        await vectorApp(async ({ post, directories }) => {
            assert.equal(imports('vectra').length, 0);
            const bodies = Array.from({ length: 8 }, (_, i) => ({ source: 'webllm', collectionId: 'Synthetic-' + i, model: 'synthetic-model' }));
            for (const result of await Promise.all(bodies.map(body => post('list', body)))) {
                assert.equal(result.status, 200);
                assert.deepEqual(JSON.parse(result.text), []);
            }
            assert.equal(imports('vectra', 'resolve').length, 1, 'Cold vector requests must share the dependency import attempt');
            assert.equal(imports('vectra').length, 1);
            // Public API seeds a real index after the application has loaded it.
            const { LocalIndex } = createRequire(source('src/endpoints/vectors.js'))('vectra');
            const index = new LocalIndex(path.join(directories.vectors, 'webllm', 'Synthetic-0', 'synthetic-model'));
            await index.beginUpdate();
            await index.upsertItem({ vector: [1, 0], metadata: { hash: 101, text: 'Synthetic indexed text', index: 0 } });
            await index.endUpdate();
            const result = await post('list', bodies[0]);
            assert.equal(result.status, 200);
            assert.deepEqual(JSON.parse(result.text), [101]);
            assert.equal(imports('sillytavern-transformers', 'resolve').length, 0, 'Listing local vectors must not initialize inference');
        });
    });
});

test('vector import failure is an HTTP error on first use and later requests retry', async () => {
    await runScenario('vectra-import-failure', async function () {
        await vectorApp(async ({ post }) => {
            const body = { source: 'webllm', collectionId: 'Synthetic', model: 'synthetic-model' };
            assert.equal((await post('list', body)).status, 500);
            const result = await post('list', body);
            assert.equal(result.status, 200);
            assert.deepEqual(JSON.parse(result.text), []);
            assert.equal(imports('vectra', 'resolve').length, 2);
        });
    }, 'vectra');
});
