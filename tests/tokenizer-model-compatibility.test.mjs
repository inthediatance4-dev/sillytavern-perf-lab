import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import test, { after } from 'node:test';
import express from 'express';
import { SentencePieceProcessor } from '@agnai/sentencepiece-js';
import { Tokenizer } from '@agnai/web-tokenizers';

const BASELINE_COMMIT = '46bf802fde8077086c14a7be44c7103abefd6a57';
const baselineSource = execFileSync('git', ['show', `${BASELINE_COMMIT}:src/endpoints/tokenizers.js`], { encoding: 'utf8' });
const start = baselineSource.indexOf('class SentencePieceTokenizer {');
const end = baselineSource.indexOf('const spp_llama =', start);
assert.ok(start >= 0 && end > start, 'The fixed baseline must contain the actual tokenizer classes');

const root = path.resolve('.fixtures', `tokenizer-real-${crypto.randomUUID()}`);
fs.mkdirSync(root, { recursive: true });
globalThis.DATA_ROOT = root;
const config = path.join(root, 'config.yaml');
fs.writeFileSync(config, 'enableDownloadableTokenizers: false\nlogging:\n  minLogLevel: 3\n');
const previousDownloadSetting = process.env.SILLYTAVERN_ENABLEDOWNLOADABLETOKENIZERS;
process.env.SILLYTAVERN_ENABLEDOWNLOADABLETOKENIZERS = 'false';
const util = await import('../src/util.js');
util.setConfigFilePath(config);
const current = await import('../src/endpoints/tokenizers.js');

// Only the baseline's local path adapter is substituted. Its original class
// control flow, fs reads, SentencePiece WASM, and WebTokenizer WASM are real.
const context = vm.createContext({
    fs,
    path,
    SentencePieceProcessor,
    Tokenizer,
    console,
    async getPathToTokenizer(model) {
        assert.equal(util.isValidUrl(model), false, 'The baseline may only load local bundled models');
        return model;
    },
});
new vm.Script(`${baselineSource.slice(start, end)}\nglobalThis.Classes = { SentencePieceTokenizer, WebTokenizer };`, { filename: 'baseline/tokenizers.js' }).runInContext(context);

const app = express();
app.use(express.json());
app.use('/api/tokenizers', current.router);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/api/tokenizers`;
after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (previousDownloadSetting === undefined) delete process.env.SILLYTAVERN_ENABLEDOWNLOADABLETOKENIZERS;
    else process.env.SILLYTAVERN_ENABLEDOWNLOADABLETOKENIZERS = previousDownloadSetting;
});

const sentences = [
    'Synthetic tokenizer check: Hello, world!',
    '这是一条人工生成的测试消息，不包含用户聊天。',
    'Line one\nLine two with café and 🚗.',
    '',
    '  repeated spaces   and\ttabs  ',
];

async function post(model, operation, body) {
    const response = await fetch(`${base}/${model}/${operation}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200);
    return response.json();
}

// Use the baseline's real HTTP handler factories as the serial oracle, rather
// than duplicating chunk/decoding logic in this test.
function baselineHandlers(model) {
    const factoriesStart = baselineSource.indexOf('function createSentencepieceEncodingHandler(');
    const factoriesEnd = baselineSource.indexOf('export const router =', factoriesStart);
    const countStart = baselineSource.indexOf('async function countSentencepieceTokens(');
    const countEnd = baselineSource.indexOf('async function getTiktokenChunks(', countStart);
    const chunksStart = baselineSource.indexOf('function getWebTokenizersChunks(');
    const chunksEnd = baselineSource.indexOf('/**', chunksStart);
    assert.ok(factoriesStart >= 0 && factoriesEnd > factoriesStart);
    assert.ok(countStart >= 0 && countEnd > countStart);
    assert.ok(chunksStart >= 0 && chunksEnd > chunksStart);
    const helpers = baselineSource.slice(countStart, countEnd) + baselineSource.slice(chunksStart, chunksEnd);
    new vm.Script(`${helpers}\n${baselineSource.slice(factoriesStart, factoriesEnd)}\nglobalThis.Factories = {
        createSentencepieceEncodingHandler, createSentencepieceDecodingHandler,
        createWebTokenizerEncodingHandler, createWebTokenizerDecodingHandler,
    };`, { filename: 'baseline/tokenizer-handlers.js' }).runInContext(context);
    const isSentencePiece = model === 'llama';
    const wrapper = isSentencePiece
        ? new context.Classes.SentencePieceTokenizer('src/tokenizers/llama.model')
        : new context.Classes.WebTokenizer('src/tokenizers/llama3.json');
    const encode = isSentencePiece ? context.Factories.createSentencepieceEncodingHandler(wrapper) : context.Factories.createWebTokenizerEncodingHandler(wrapper);
    const decode = isSentencePiece ? context.Factories.createSentencepieceDecodingHandler(wrapper) : context.Factories.createWebTokenizerDecodingHandler(wrapper);
    async function invoke(handler, body) {
        let result;
        await handler({ body }, { send(value) { result = JSON.parse(JSON.stringify(value)); return value; } });
        assert.ok(result, 'The baseline handler must return a body');
        return result;
    }
    return { encode: body => invoke(encode, body), decode: body => invoke(decode, body) };
}

const evidence = {
    baseline_commit: BASELINE_COMMIT,
    node: process.version,
    fixture_root: root,
    models: ['llama.model', 'llama3.json'].map(name => {
        const bytes = fs.readFileSync(path.resolve('src/tokenizers', name));
        return { name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    }),
    synthetic_only: true,
    downloadable_tokenizers: false,
    results: [],
};

for (const model of ['llama', 'llama3']) {
    test(`${model}: real bundled model handles 50 cold HTTP encodes and preserves baseline output`, async t => {
        let loads = 0;
        let builds = 0;
        const originalLoad = SentencePieceProcessor.prototype.load;
        const originalBuild = Tokenizer.fromJSON;
        SentencePieceProcessor.prototype.load = function (...args) { loads++; return originalLoad.apply(this, args); };
        Tokenizer.fromJSON = function (...args) { builds++; return originalBuild.apply(this, args); };
        t.after(() => {
            SentencePieceProcessor.prototype.load = originalLoad;
            Tokenizer.fromJSON = originalBuild;
        });

        // The router's wrapper and underlying dependency factory are cold here;
        // the serial baseline is deliberately loaded only after this burst.
        const inputs = Array.from({ length: 50 }, (_, i) => sentences[i % sentences.length]);
        const actual = await Promise.all(inputs.map(text => post(model, 'encode', { text })));
        const coldLoads = loads;
        const coldBuilds = builds;
        assert.equal(model === 'llama' ? coldLoads : coldBuilds, 1, 'One real initialization must serve the cold HTTP burst');
        assert.equal(model === 'llama' ? coldBuilds : coldLoads, 0);

        const baseline = baselineHandlers(model);
        const expected = [];
        for (const text of sentences) expected.push(await baseline.encode({ text }));
        for (let i = 0; i < actual.length; i++) {
            assert.deepEqual(actual[i], expected[i % sentences.length]);
            assert.equal(actual[i].count, actual[i].ids.length);
        }
        assert.ok(actual[0].ids.length > 0, 'A nonempty sentence must not silently return the HTTP error fallback');

        const beforeWarm = { loads, builds };
        for (let i = 0; i < sentences.length; i++) {
            assert.deepEqual(await post(model, 'encode', { text: sentences[i] }), expected[i]);
            const ids = expected[i].ids;
            assert.deepEqual(await post(model, 'decode', { ids }), await baseline.decode({ ids }));
        }
        assert.deepEqual({ loads, builds }, beforeWarm, 'Warm encode/decode must reuse their ready instances');
        evidence.results.push({ model, cold_http_encodes: 50, warm_http_encodes: 5, warm_http_decodes: 5, cold_loads: coldLoads, cold_builds: coldBuilds, baseline_equal: true });
        fs.writeFileSync(path.join(root, 'tokenizer-model-evidence.json'), JSON.stringify(evidence, null, 2));
        console.info(`Real local tokenizer compatibility: ${model}; 50 cold + 5 warm encodes + 5 decodes; baseline equal; initialization=1`);
    });
}
