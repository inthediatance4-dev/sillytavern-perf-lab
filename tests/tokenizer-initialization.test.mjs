import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

// Execute the actual private classes without importing the HTTP module or loading
// WASM/model dependencies. Only I/O and expensive factories are replaced here.
const source = fs.readFileSync(new URL('../src/endpoints/tokenizers.js', import.meta.url), 'utf8');
const start = source.indexOf('class SentencePieceTokenizer {');
const end = source.indexOf('const spp_llama =', start);
assert.ok(start >= 0 && end > start, 'Tokenizer class boundaries must exist in the real source');
const classSource = source.slice(start, end);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

const turn = () => new Promise(resolve => setImmediate(resolve));

function harness(kind, hooks = {}) {
    const calls = { paths: [], reads: [], constructions: [], loads: [], builds: [], errors: [] };
    class Processor {
        constructor() {
            calls.constructions.push(this);
            hooks.construct?.(this);
            this.ready = false;
        }
        async load(model) {
            calls.loads.push({ model, instance: this });
            await hooks.load?.(model, this);
            this.ready = true;
        }
    }
    const context = vm.createContext({
        path,
        console: { info() {}, error(...args) { calls.errors.push(args); } },
        SentencePieceProcessor: Processor,
        Tokenizer: {
            fromJSON(buffer) {
                calls.builds.push(buffer);
                return hooks.build ? hooks.build(buffer) : Promise.resolve({ ready: true, buffer });
            },
        },
        fs: {
            promises: {
                readFile(model) {
                    calls.reads.push(model);
                    return hooks.read ? hooks.read(model) : Promise.resolve(Buffer.from(model));
                },
            },
        },
        getPathToTokenizer(model, fallback) {
            calls.paths.push({ model, fallback });
            return hooks.path ? hooks.path(model, fallback) : Promise.resolve(model);
        },
    });
    new vm.Script(`${classSource}\nglobalThis.Classes = { SentencePieceTokenizer, WebTokenizer };`, { filename: 'src/endpoints/tokenizers.js' }).runInContext(context);
    const Class = context.Classes[kind];
    return { calls, create: (model = 'synthetic.model', fallback = 'synthetic-fallback.model') => new Class(model, fallback) };
}

for (const kind of ['SentencePieceTokenizer', 'WebTokenizer']) {
    const isSentencePiece = kind === 'SentencePieceTokenizer';
    const initCalls = calls => isSentencePiece ? calls.loads.length : calls.builds.length;
    const initHook = gate => isSentencePiece ? { load: () => gate.promise } : { build: () => gate.promise };

    test(`${kind}: 50 cold callers share path resolution and construction`, async () => {
        const gate = deferred();
        const h = harness(kind, { path: () => gate.promise });
        const wrapper = h.create();
        const requests = Array.from({ length: 50 }, () => wrapper.get());
        await turn();
        const pathsBeforeRelease = h.calls.paths.length;
        gate.resolve('synthetic-resolved.model');
        const instances = await Promise.all(requests);
        assert.equal(pathsBeforeRelease, 1, 'Path resolution/download must be shared while cold');
        assert.equal(initCalls(h.calls), 1, 'The expensive model factory must run once');
        if (!isSentencePiece) assert.equal(h.calls.reads.length, 1, 'Web JSON bytes must be read once');
        assert.ok(instances.every(instance => instance === instances[0]));
        assert.equal(instances[0].ready, true);
    });

    test(`${kind}: late caller cannot observe an instance before initialization completes`, async () => {
        const gate = deferred();
        const h = harness(kind, initHook(gate));
        const wrapper = h.create();
        const first = wrapper.get();
        await turn();
        let secondSettled = false;
        const second = wrapper.get().then(value => { secondSettled = true; return value; });
        await turn();
        const settledBeforeRelease = secondSettled;
        const workBeforeRelease = initCalls(h.calls);
        gate.resolve({ ready: true });
        const [a, b] = await Promise.all([first, second]);
        assert.equal(settledBeforeRelease, false, 'A loading instance must not be published');
        assert.equal(workBeforeRelease, 1, 'A late caller must join the existing initialization');
        assert.equal(a, b);
        assert.equal(a.ready, true);
    });

    test(`${kind}: initialization rejection returns null to all callers and permits retry`, async () => {
        const gate = deferred();
        let failing = true;
        const hook = () => failing ? gate.promise : Promise.resolve({ ready: true });
        const h = harness(kind, isSentencePiece ? { load: hook } : { build: hook });
        const wrapper = h.create();
        const first = wrapper.get();
        await turn();
        const others = Array.from({ length: 49 }, () => wrapper.get());
        gate.reject(new Error('synthetic initialization failure'));
        const failed = await Promise.all([first, ...others]);
        assert.ok(failed.every(instance => instance === null), 'Failure must not leave a cached partial instance');
        assert.equal(h.calls.errors.length, 1, 'A shared failed attempt should be logged once');
        assert.equal(initCalls(h.calls), 1);
        failing = false;
        const recovered = await wrapper.get();
        assert.equal(recovered.ready, true);
        assert.equal(initCalls(h.calls), 2);
        assert.equal(await wrapper.get(), recovered);
    });

    test(`${kind}: path rejection is shared and fallback arguments survive retry`, async () => {
        const gate = deferred();
        let failing = true;
        const h = harness(kind, { path: (_model, fallback) => failing ? gate.promise : Promise.resolve(fallback) });
        const wrapper = h.create('synthetic-requested.model', 'synthetic-fallback.model');
        const requests = Array.from({ length: 50 }, () => wrapper.get());
        await turn();
        gate.reject(new Error('synthetic path failure'));
        const results = await Promise.all(requests);
        assert.ok(results.every(instance => instance === null));
        assert.equal(h.calls.paths.length, 1);
        assert.equal(h.calls.errors.length, 1);
        assert.equal(initCalls(h.calls), 0);
        failing = false;
        const instance = await wrapper.get();
        assert.equal(instance.ready, true);
        assert.deepEqual(h.calls.paths, [
            { model: 'synthetic-requested.model', fallback: 'synthetic-fallback.model' },
            { model: 'synthetic-requested.model', fallback: 'synthetic-fallback.model' },
        ]);
        const modelUsed = isSentencePiece ? h.calls.loads[0].model : h.calls.reads[0];
        assert.equal(modelUsed, 'synthetic-fallback.model');
    });

    test(`${kind}: synchronous path failure does not latch a failed Promise`, async () => {
        let attempts = 0;
        const h = harness(kind, { path: model => {
            if (++attempts === 1) throw new Error('synthetic synchronous path failure');
            return model;
        } });
        const wrapper = h.create();
        assert.equal(await wrapper.get(), null);
        const instance = await wrapper.get();
        assert.equal(instance.ready, true);
        assert.equal(attempts, 2);
        assert.equal(initCalls(h.calls), 1);
    });

    test(`${kind}: synchronous factory failure leaves no partial cache`, async () => {
        let attempts = 0;
        const throwingFactory = () => {
            if (++attempts === 1) throw new Error('synthetic synchronous factory failure');
            return Promise.resolve({ ready: true });
        };
        const h = harness(kind, isSentencePiece ? { construct: throwingFactory } : { build: throwingFactory });
        const wrapper = h.create();
        assert.equal(await wrapper.get(), null);
        const instance = await wrapper.get();
        assert.equal(instance.ready, true);
        assert.equal(attempts, 2);
        assert.equal(await wrapper.get(), instance);
    });

    test(`${kind}: warm cache returns the same ready instance without new I/O`, async () => {
        const h = harness(kind);
        const wrapper = h.create();
        const instance = await wrapper.get();
        const results = await Promise.all(Array.from({ length: 50 }, () => wrapper.get()));
        assert.ok(results.every(value => value === instance));
        assert.equal(instance.ready, true);
        assert.equal(h.calls.paths.length, 1);
        assert.equal(initCalls(h.calls), 1);
        if (!isSentencePiece) assert.equal(h.calls.reads.length, 1);
    });

    test(`${kind}: distinct wrapper instances initialize independently`, async () => {
        const gate = deferred();
        const h = harness(kind, { path: model => model === 'synthetic-a.model' ? gate.promise : Promise.resolve(model) });
        const a = h.create('synthetic-a.model');
        const b = h.create('synthetic-b.model');
        const first = a.get();
        const second = await b.get();
        assert.equal(second.ready, true);
        gate.resolve('synthetic-a.model');
        const initial = await first;
        assert.notEqual(initial, second);
        assert.equal(h.calls.paths.length, 2);
        assert.equal(initCalls(h.calls), 2);
    });
}

test('WebTokenizer: file read failure is shared and a subsequent request retries', async () => {
    const gate = deferred();
    let failing = true;
    const h = harness('WebTokenizer', { read: model => failing ? gate.promise : Promise.resolve(Buffer.from(model)) });
    const wrapper = h.create();
    const requests = Array.from({ length: 50 }, () => wrapper.get());
    await turn();
    gate.reject(new Error('synthetic file read failure'));
    const failed = await Promise.all(requests);
    assert.ok(failed.every(instance => instance === null));
    assert.equal(h.calls.reads.length, 1);
    assert.equal(h.calls.builds.length, 0);
    assert.equal(h.calls.errors.length, 1);
    failing = false;
    const instance = await wrapper.get();
    assert.equal(instance.ready, true);
    assert.equal(h.calls.reads.length, 2);
    assert.equal(h.calls.builds.length, 1);
});
