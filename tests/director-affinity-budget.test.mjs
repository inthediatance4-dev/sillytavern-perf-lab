import assert from 'node:assert/strict';
import test from 'node:test';
import { get_encoding } from 'tiktoken';
import { affinityOutputTokenLimit, fitAffinityPrompt, fitAffinityVerificationPrompts } from '../public/scripts/extensions/director/affinity-prompt-budget.js';

const state = { version: 1, id: 'scope', issued: 5, cursor: 0, events: [], archives: [] };
const refs = Array.from({ length: 5 }, (_, index) => ({
    slot: `source-${index}`, owner: 'a.png', index, receipt: index + 1,
    text: `第${index}段：` + '这是一段很长的中文角色对白，保持原文与 {{char}} 字面宏。'.repeat(300),
}));
const render = (evidence, memory) => 'Return JSON evidence.\n' + JSON.stringify({ memory: memory.events, messages: evidence });

test('sidecar output has an independent upper bound and scales down on small contexts', () => {
    assert.equal(affinityOutputTokenLimit(2048), 512);
    assert.equal(affinityOutputTokenLimit(4096), 1024);
    assert.equal(affinityOutputTokenLimit(65536), 2048);
    assert.equal(affinityOutputTokenLimit(512), 128);
    for (const value of [0, -1, NaN, Infinity]) assert.throws(() => affinityOutputTokenLimit(value), RangeError);
});

test('uses actual model tokens to fit long Chinese evidence without editing sources', async () => {
    const encoder = get_encoding('o200k_base');
    try {
        const input = structuredClone({ refs, state });
        const before = structuredClone(input);
        const countTokens = async text => encoder.encode(text).length;
        assert.ok(await countTokens(render(refs, state)) > 1792);
        const fitted = await fitAffinityPrompt(render, input, { maxTokens: 1792, countTokens });
        assert.ok(await countTokens(fitted.prompt) <= 1792);
        assert.deepEqual(fitted.refs.map(ref => ref.slot), refs.map(ref => ref.slot));
        assert.deepEqual(input, before);
        assert.ok(JSON.parse(fitted.prompt.split('\n')[1]).messages.every(ref => ref.text.length > 0));
    } finally { encoder.free(); }
});

test('a fitting prompt keeps all text and prior memory byte for byte', async () => {
    const input = { refs: [{ slot: 'one', receipt: 1, text: '{{incvar::counter}}\r\n<user>' }], state };
    const prompt = render(input.refs, state);
    const fitted = await fitAffinityPrompt(render, input, { maxTokens: 99999, countTokens: async text => text.length });
    assert.equal(fitted.prompt, prompt);
    assert.equal(fitted.refs[0], input.refs[0]);
});

test('temporarily trims oversized prior memory without deleting stored open promises', async () => {
    const input = { refs: [{ slot: 'new', receipt: 5, text: 'new evidence' }], state: {
        ...state, events: Array.from({ length: 64 }, (_, id) => ({ id, kind: 'promise', fact: '尚待兑现。'.repeat(60) })),
    } };
    const before = structuredClone(input);
    const fitted = await fitAffinityPrompt(render, input, { maxTokens: 600, countTokens: async text => text.length });
    assert.ok(fitted.prompt.length <= 600);
    assert.deepEqual(input, before);
    assert.equal(fitted.refs.length, 1);
});

test('omits optional old labels before new receipts when headers exhaust context', async () => {
    const input = { refs: [
        ...Array.from({ length: 60 }, (_, id) => ({ slot: `old-${id}`, receipt: 0, text: 'old text' })),
        { slot: 'new-first', receipt: 1, text: 'new evidence' },
        { slot: 'new-second', receipt: 2, text: 'more new evidence' },
    ], state };
    const fitted = await fitAffinityPrompt(render, input, { maxTokens: 300, countTokens: async text => text.length });
    assert.ok(fitted.prompt.length <= 300);
    assert.ok(fitted.refs.some(ref => ref.slot === 'new-first'));
    assert.ok(fitted.refs.some(ref => ref.slot === 'new-second'));
    assert.ok(fitted.refs.length < input.refs.length);
});

test('an impossible budget or invalid tokenizer never produces an oversized prompt', async () => {
    for (const maxTokens of [0, -1, NaN, Infinity, 1]) {
        await assert.rejects(fitAffinityPrompt(render, { refs, state }, { maxTokens, countTokens: async text => text.length }), RangeError);
    }
    for (const tokens of [0, -1, NaN, Infinity]) {
        await assert.rejects(fitAffinityPrompt(render, { refs, state }, { maxTokens: 2000, countTokens: async () => tokens }), RangeError);
    }
});

test('cancellation during tokenization stops before any fitted prompt is returned', async () => {
    const controller = new AbortController();
    await assert.rejects(fitAffinityPrompt(render, { refs, state }, {
        maxTokens: 2000, signal: controller.signal,
        countTokens: async text => { controller.abort(new Error('new foreground generation')); return text.length; },
    }), /new foreground generation/);
});

test('a budget changed during tokenization is checked again before accepting the result', async () => {
    let budget = 999999;
    const fitted = await fitAffinityPrompt(render, { refs, state }, {
        maxTokens: () => budget,
        countTokens: async text => { budget = 800; return text.length; },
    });
    assert.ok(fitted.prompt.length <= 800);
});

test('cancellation releases a stalled tokenizer without waiting for its response', async () => {
    const controller = new AbortController();
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const fitted = fitAffinityPrompt(render, { refs, state }, {
        maxTokens: 2000, signal: controller.signal,
        countTokens: () => { entered(); return new Promise(() => {}); },
    });
    await started;
    controller.abort(new Error('chat changed during tokenization'));
    await assert.rejects(fitted, /chat changed during tokenization/);
});

test('same-turn cancellation and tokenizer rejection are both consumed', async () => {
    const controller = new AbortController();
    const unhandled = [];
    const listener = error => unhandled.push(error);
    process.on('unhandledRejection', listener);
    try {
        await assert.rejects(fitAffinityPrompt(render, { refs, state }, {
            maxTokens: 2000, signal: controller.signal,
            countTokens: async () => {
                controller.abort(new Error('foreground cancel'));
                throw new Error('tokenizer rejection in the same turn');
            },
        }), /foreground cancel/);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(unhandled, []);
    } finally { process.off('unhandledRejection', listener); }
});

test('Unicode excerpts do not introduce unpaired surrogate characters', async () => {
    const input = { refs: [{ slot: 'emoji', receipt: 1, text: '🧭'.repeat(1000) }], state };
    const fitted = await fitAffinityPrompt(render, input, { maxTokens: 180, countTokens: async text => text.length });
    const shown = JSON.parse(fitted.prompt.split('\n')[1]).messages[0].text;
    assert.equal(shown.isWellFormed(), true);
});

test('major checks split within the token budget without truncating source evidence', async () => {
    const candidates = Array.from({ length: 7 }, (_, id) => ({ key: `candidate-${id}`, quote: '原始重大证据。'.repeat(12) }));
    const before = structuredClone(candidates);
    const batches = await fitAffinityVerificationPrompts(JSON.stringify, candidates, {
        maxTokens: 280, countTokens: async text => text.length,
    });
    assert.ok(batches.length > 1);
    assert.deepEqual(batches.flatMap(batch => batch.candidates), candidates);
    for (const batch of batches) {
        assert.ok(batch.prompt.length <= 280);
        assert.deepEqual(JSON.parse(batch.prompt), batch.candidates);
    }
    assert.deepEqual(candidates, before);
});

test('a major candidate too large to fit alone does not displace smaller valid checks', async () => {
    const candidates = [{ key: 'too-big', quote: 'x'.repeat(2000) }, { key: 'valid', quote: 'original quote' }];
    const batches = await fitAffinityVerificationPrompts(JSON.stringify, candidates, { maxTokens: 100, countTokens: async text => text.length });
    assert.deepEqual(batches.flatMap(batch => batch.candidates).map(candidate => candidate.key), ['valid']);
});

test('a shrinking context budget never returns a previously fitted oversized verification batch', async () => {
    let budget = 500;
    let calls = 0;
    const candidates = ['A'.repeat(300), 'B'.repeat(50)];
    const batches = await fitAffinityVerificationPrompts(values => values.join(''), candidates, {
        maxTokens: () => budget,
        countTokens: async text => {
            if (++calls === 2) budget = 100;
            return text.length;
        },
    });
    assert.ok(batches.every(batch => batch.prompt.length <= budget));
    assert.deepEqual(batches.flatMap(batch => batch.candidates), [candidates[1]]);
});

test('verification batches can recheck the current tokenizer and budget immediately before dispatch', async () => {
    let multiplier = 1;
    let budget = 100;
    const batches = await fitAffinityVerificationPrompts(values => values.join(''), ['evidence'.repeat(8)], {
        maxTokens: () => budget, countTokens: async text => text.length * multiplier,
    });
    assert.equal(batches.length, 1);
    assert.equal(await batches[0].validate(), true);
    multiplier = 2;
    assert.equal(await batches[0].validate(), false);
    multiplier = 1;
    budget = 50;
    assert.equal(await batches[0].validate(), false);
});

test('cancellation releases a verification dispatch recheck waiting on its tokenizer', async () => {
    const controller = new AbortController();
    let stalled = false;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const batches = await fitAffinityVerificationPrompts(JSON.stringify, ['evidence'], {
        maxTokens: 100, signal: controller.signal,
        countTokens: text => stalled ? (entered(), new Promise(() => {})) : Promise.resolve(text.length),
    });
    stalled = true;
    const checked = batches[0].validate();
    await started;
    controller.abort(new Error('verification configuration cancelled'));
    await assert.rejects(checked, /verification configuration cancelled/);
});

test('a tokenizer response for a previous model cannot fit an extraction prompt', async () => {
    let identity = 'model-a';
    await assert.rejects(fitAffinityPrompt(render, { refs: [refs[0]], state }, {
        maxTokens: 99999, getIdentity: () => identity,
        countTokens: async text => { identity = 'model-b'; return text.length; },
    }), /configuration changed/);
});

test('a model switch while a verification dispatch count awaits cannot approve a stale count', async () => {
    let identity = 'model-a';
    let switchOnCount = false;
    const batches = await fitAffinityVerificationPrompts(JSON.stringify, ['evidence'], {
        maxTokens: 100, getIdentity: () => identity,
        countTokens: async text => { if (switchOnCount) identity = 'model-b'; return text.length; },
    });
    switchOnCount = true;
    await assert.rejects(batches[0].validate(), /configuration changed/);
});
