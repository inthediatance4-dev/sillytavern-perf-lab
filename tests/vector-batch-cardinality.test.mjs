import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/endpoints/vectors.js', import.meta.url), 'utf8');
const functionStart = source.indexOf('async function getBatchVector(');
const functionEnd = source.indexOf('\n}\n\n/**', functionStart) + 2;
assert.notEqual(functionStart, -1, 'getBatchVector exists in vectors.js');
assert.ok(functionEnd > functionStart, 'getBatchVector function body can be extracted');
const getBatchVectorSource = source.slice(functionStart, functionEnd);

function loadGetBatchVector(providerStubs = {}) {
    const context = vm.createContext({ ...providerStubs });
    return vm.runInContext(`(${getBatchVectorSource})`, context);
}

function toHostValue(value) {
    return Array.isArray(value) ? Array.from(value, toHostValue) : value;
}

const localSources = ['webllm', 'koboldcpp'];
const batchLengths = [0, 1, 10, 11, 21, 137];

for (const sourceName of localSources) {
    test(`${sourceName} returns one ordered vector per text across batch boundaries`, async () => {
        const getBatchVector = loadGetBatchVector();
        const observations = [];

        for (const count of batchLengths) {
            const texts = Array.from({ length: count }, (_, index) => `text-${index}`);
            const embeddings = Object.fromEntries(texts.map((text, index) => [text, [index, `vector-${index}`]]));
            const vectors = toHostValue(await getBatchVector(sourceName, { embeddings }, texts, true, { marker: 'dirs' }));

            observations.push({ inputCount: count, outputCount: vectors.length, vectors, expected: texts.map(text => embeddings[text]) });
        }

        assert.deepEqual(observations.map(({ outputCount }) => outputCount), batchLengths,
            'every input size produces one vector per text (including 21 inputs producing 21 vectors)');
        for (const { inputCount, vectors, expected } of observations) {
            assert.deepEqual(vectors, expected, `${inputCount} input vectors preserve order`);
        }
    });

    test(`${sourceName} preserves duplicate input order and missing embeddings`, async () => {
        const getBatchVector = loadGetBatchVector();
        const embeddings = { repeated: [1, 2], other: [3, 4] };
        const texts = ['repeated', 'other', 'repeated', 'missing'];

        const vectors = toHostValue(await getBatchVector(sourceName, { embeddings }, texts, false, {}));

        assert.deepEqual(vectors, [[1, 2], [3, 4], [1, 2], undefined]);
    });
}

test('an unknown source throws for nonempty input while empty input returns an empty list', async () => {
    const getBatchVector = loadGetBatchVector();

    await assert.rejects(getBatchVector('unknown', {}, ['text'], false, {}), /Unknown vector source unknown/);
    assert.deepEqual(toHostValue(await getBatchVector('unknown', {}, [], false, {})), []);
});

const remoteSourceCases = [
    ['nomicai', 'getNomicAIBatchVector', batch => [batch, 'nomicai', directories]],
    ['togetherai', 'getOpenAIBatchVector', batch => [batch, 'togetherai', directories, model]],
    ['mistral', 'getOpenAIBatchVector', batch => [batch, 'mistral', directories, model]],
    ['openai', 'getOpenAIBatchVector', batch => [batch, 'openai', directories, model]],
    ['electronhub', 'getOpenAIBatchVector', batch => [batch, 'electronhub', directories, model]],
    ['openrouter', 'getOpenAIBatchVector', batch => [batch, 'openrouter', directories, model]],
    ['transformers', 'getTransformersBatchVector', batch => [batch]],
    ['extras', 'getExtrasBatchVector', batch => [batch, extrasUrl, extrasKey]],
    ['palm', 'getMakerSuiteBatchVector', batch => [batch, model, request]],
    ['vertexai', 'getVertexBatchVector', batch => [batch, model, request]],
    ['cohere', 'getCohereBatchVector', batch => [batch, true, directories, model]],
    ['llamacpp', 'getLlamaCppBatchVector', batch => [batch, apiUrl, directories]],
    ['vllm', 'getVllmBatchVector', batch => [batch, apiUrl, model, directories]],
    ['ollama', 'getOllamaBatchVector', batch => [batch, apiUrl, model, keep, directories]],
    ['chutes', 'getOpenAIBatchVector', batch => [batch, 'chutes', directories, model]],
    ['nanogpt', 'getOpenAIBatchVector', batch => [batch, 'nanogpt', directories, model]],
    ['siliconflow', 'getOpenAIBatchVector', batch => [batch, 'siliconflow', directories, model, urlOverride]],
    ['workers_ai', 'getOpenAIBatchVector', batch => [batch, 'workers_ai', directories, model, urlOverride]],
];

const directories = { marker: 'directories' };
const model = 'synthetic-model';
const extrasUrl = 'http://synthetic.invalid';
const extrasKey = 'synthetic-key';
const request = { marker: 'request' };
const apiUrl = 'http://synthetic.invalid/api';
const keep = 'forever';
const urlOverride = 'http://override.invalid';

for (const [sourceName, providerName, expectedArgs] of remoteSourceCases) {
    test(`${sourceName} keeps remote provider batches at ten and forwards source arguments`, async () => {
        const calls = [];
        const provider = async (...args) => {
            calls.push(args);
            return args[0].map(text => [text]);
        };
        const getBatchVector = loadGetBatchVector({ [providerName]: provider });
        const texts = Array.from({ length: 21 }, (_, index) => `remote-${index}`);
        const sourceSettings = { model, extrasUrl, extrasKey, request, apiUrl, keep, urlOverride };

        const vectors = toHostValue(await getBatchVector(sourceName, sourceSettings, texts, true, directories));

        assert.deepEqual(vectors, texts.map(text => [text]));
        assert.equal(calls.length, 3);
        assert.deepEqual(calls.map(args => args[0]), [texts.slice(0, 10), texts.slice(10, 20), texts.slice(20)]);
        assert.deepEqual(calls.map(args => args.slice(1)), calls.map(args => expectedArgs(args[0]).slice(1)));
    });
}
