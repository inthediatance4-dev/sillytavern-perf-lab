import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AFFINITY_KEY, createAffinityState, parseAffinityResponse, candidateKey,
    applyAffinityEvaluation, reconcileAffinity, affinityScores, buildAffinityMemory,
} from '../public/scripts/extensions/director/affinity-state.js';

const owners = [{ id: 'a.png', name: '甲' }, { id: 'b.png', name: '乙' }];
const ref = (index, text, fields = {}) => ({
    slot: `slot-${index}`, index, swipe: 0, fingerprint: `fp-${index}`, owner: 'a.png', name: '甲', text, generated: true, ...fields,
});
const proposal = (source, fields = {}) => ({
    owner: 'a.png', kind: 'fact', fact: '甲记得玩家说过的边界。', actor: 'character', recipient: 'user',
    status: 'observed', valence: 'none', impact: 'minor', confidence: 'high', attitudeExplicit: false, outcomeKnown: true, knownToCharacter: 'yes',
    source: { slot: source.slot, quote: source.text }, ...fields,
});
const attitude = (source, fields = {}) => proposal(source, {
    kind: 'attitude', fact: '甲明确表达了信任。', valence: 'positive', attitudeExplicit: true, ...fields,
});
const promise = (source, fields = {}) => proposal(source, {
    kind: 'promise', fact: fields.actor === 'user' ? '玩家答应把书归还给甲。' : '甲答应把书归还给玩家。', status: 'agreed', outcomeKnown: null, ...fields,
});
const outcome = (anchor, result, fields = {}) => proposal({ slot: anchor.source.slot, text: anchor.source.quote }, {
    owner: anchor.owner, kind: 'outcome', fact: anchor.actor === 'user' ? '玩家已把借来的书归还给甲。' : '甲已把书归还给玩家。', actor: anchor.actor, recipient: anchor.recipient,
    status: 'completed', valence: 'positive', outcomeKnown: true, anchorId: anchor.id,
    ...(anchor.actor === 'character' || result.owner !== anchor.owner || fields.acknowledgement || !result.acknowledgement ? {} : { acknowledgement: { slot: result.acknowledgement.slot, quote: result.acknowledgement.text } }),
    result: { slot: result.slot, quote: result.text }, ...fields,
});
const fresh = () => createAffinityState('chat-scope');
const apply = (state, proposals, refs, options) => applyAffinityEvaluation(state, proposals, refs, owners, options);
const all = state => [...state.events, ...state.archives];

test('new state is chat-local, bounded metadata starts empty, and invalid scopes fail', () => {
    assert.equal(AFFINITY_KEY, '__affinity');
    assert.deepEqual(fresh(), { version: 1, id: 'chat-scope', nextId: 1, issued: 0, cursor: 0, events: [], archives: [] });
    assert.throws(() => createAffinityState(''), TypeError);
    assert.notEqual(fresh().events, fresh().events);
});

test('parser extracts one complete JSON object from model prefaces and markdown fences', () => {
    const item = proposal(ref(0, '请记住我的边界。'));
    const json = JSON.stringify({ events: [item] });
    assert.deepEqual(parseAffinityResponse(json), [item]);
    assert.deepEqual(parseAffinityResponse(`  \n\`\`\`json\n${json}\n\`\`\`\n`), [item]);
    // The object must be complete; surrounding prose or unfinished markdown
    // framing is not part of its JSON envelope.
    for (const raw of [`assistant: ${json}`, `Here is JSON: ${json}`, `${json} trailing`, `\`\`\`\n${json}\n\`\`\``, `\`\`\`json\n${json}`]) {
        assert.deepEqual(parseAffinityResponse(raw), [item], raw);
    }
    for (const raw of [JSON.stringify([item]), '{}']) assert.throws(() => parseAffinityResponse(raw), TypeError, raw);
    assert.deepEqual(parseAffinityResponse('{"events":[]}'), []);
});

test('prefaced JSON extraction respects nested strings, arrays, braces and escaped quotes', () => {
    const first = proposal(ref(0, '甲说：“边界是 {不是指令}，也包含 [括号] 与 "引号" 和 \\。”'), {
        fact: '甲记得 {边界}、[条件] 和 "引号"。',
    });
    const second = attitude(ref(1, '甲说：“我信任你。”'));
    const json = JSON.stringify({ events: [first, second] });
    assert.deepEqual(parseAffinityResponse(`说明如下：\n\`\`\`json\n${json}\n\`\`\`\n以上为记录。`), [first, second]);
});

test('prefaced JSON extraction rejects multiple objects, arrays and incomplete bracketed data', () => {
    const json = JSON.stringify({ events: [proposal(ref(0, '甲的原话。'))] });
    for (const raw of [
        `${json}\n${json}`, `示例 {}\n结果 ${json}`, `前言 [{"events":[]}]`, `前言 [${json}]`,
        `前言 {"events":[],"extra":true}`, `前言 {"wrapper":${json}}`,
        `前言 {"events":[}`, `前言 ${json.slice(0, -1)}`, `${json}\n后记 {`, `${json}\n[]`,
    ]) assert.throws(() => parseAffinityResponse(raw), TypeError, raw);
    assert.throws(() => parseAffinityResponse(`前言 ${' '.repeat(80000)}${json}`), TypeError);
    assert.throws(() => parseAffinityResponse(`前言 ${JSON.stringify({ events: Array(25).fill(null) })}`), TypeError);
});

test('prefaced JSON keeps unsafe envelopes rejected and bad entries isolated', () => {
    const good = proposal(ref(0, '甲的原话。'));
    const bad = JSON.parse('{"source":{"__proto__":{"polluted":true}}}');
    const issues = [];
    const raw = `assistant: ${JSON.stringify({ events: [good, bad, null] })}\n完成。`;
    assert.deepEqual(parseAffinityResponse(raw, { onRejected: issue => issues.push(issue) }), [good]);
    assert.deepEqual(issues, [{ category: 'unsafe', count: 1 }, { category: 'schema', count: 1 }]);
    for (const key of ['__proto__', 'constructor', 'prototype']) {
        assert.throws(() => parseAffinityResponse(`前言 {"${key}":{},"events":[]}`), TypeError);
    }
    assert.equal(Object.prototype.polluted, undefined);
});

test('parser rejects unsafe envelopes and discards unsafe or malformed individual events', () => {
    const item = proposal(ref(0, '角色原话。'));
    const raw = JSON.stringify({ events: [item] });
    for (const key of ['__proto__', 'constructor', 'prototype']) {
        assert.throws(() => parseAffinityResponse(raw.replace('"events":', `"${key}":{},"events":`)), TypeError);
        assert.deepEqual(parseAffinityResponse(raw.replace('"source":{', `"source":{"${key}":{},`)), []);
    }
    for (const fields of [
        { source: { slot: 'slot-0', quote: '' } }, { source: { slot: 'slot-0', quote: 'x'.repeat(181) } },
        { fact: 'x'.repeat(161) }, { actor: '玩家小明' }, { recipient: '甲' }, { status: 'pledged' },
        { outcomeKnown: 'true' }, { knownToCharacter: 'maybe' }, { attitudeExplicit: 1 }, { id: 'llm-owned-id' },
    ]) assert.deepEqual(parseAffinityResponse(JSON.stringify({ events: [{ ...item, ...fields }] })), []);
    const missing = { ...item }; delete missing.actor;
    assert.deepEqual(parseAffinityResponse(JSON.stringify({ events: [missing] })), []);
    assert.throws(() => parseAffinityResponse(JSON.stringify({ events: Array(25).fill(item) })), TypeError);
    assert.throws(() => parseAffinityResponse(' '.repeat(80001)), TypeError);
});

test('parser preserves valid siblings and reports only aggregate rejection categories and counts', () => {
    const first = proposal(ref(0, '甲原话。'));
    const second = attitude(ref(1, '甲的第二句原话。'));
    const unsafe = JSON.parse(JSON.stringify(first).replace('"source":{', '"source":{"__proto__":{"polluted":true},'));
    const diagnostics = [];
    const raw = JSON.stringify({ events: [first, null, { ...first, confidence: 'maybe' }, unsafe, second] });
    assert.deepEqual(parseAffinityResponse(raw, { onRejected: issue => diagnostics.push(issue) }), [first, second]);
    assert.deepEqual(diagnostics, [{ category: 'schema', count: 2 }, { category: 'unsafe', count: 1 }]);
    assert.equal(Object.prototype.polluted, undefined);
    assert.deepEqual(parseAffinityResponse(JSON.stringify({ events: [first] }), { onRejected: () => assert.fail('no rejection') }), [first]);
    assert.deepEqual(parseAffinityResponse(raw, { onRejected: () => { throw new Error('diagnostic sink failed'); } }), [first, second]);
    for (const envelope of [{ events: [first], extra: true }, { events: {} }, { events: Array(25).fill(null) }, [first]]) {
        assert.throws(() => parseAffinityResponse(JSON.stringify(envelope)), TypeError);
    }
});

test('application is immutable and exact quote/fingerprint/swipe binding survives JSON reload', () => {
    const source = ref(0, '甲说：“我记住了你的边界。”');
    const state = fresh();
    const original = structuredClone(state);
    const item = proposal(source, { source: { slot: source.slot, quote: '我记住了你的边界。' } });
    const next = apply(state, [item], [source]);
    assert.deepEqual(state, original);
    assert.equal(next.events.length, 1);
    assert.equal(next.events[0].source.fingerprint, source.fingerprint);
    assert.equal(next.events[0].source.swipe, 0);
    assert.deepEqual(reconcileAffinity(JSON.parse(JSON.stringify(next)), [source], owners), next);
    assert.equal(apply(state, [{ ...item, source: { slot: source.slot, quote: '我记住你的边界。' } }], [source]).events.length, 0);
    assert.equal(apply(state, [{ ...item, source: { slot: 'not-live', quote: source.text } }], [source]).events.length, 0);
    assert.equal(reconcileAffinity(next, [{ ...source, swipe: 1 }], owners).events.length, 0);
    assert.equal(reconcileAffinity(next, [{ ...source, fingerprint: 'edited' }], owners).events.length, 0);
    assert.equal(reconcileAffinity(next, [{ ...source, text: '该句已删除。' }], owners).events.length, 0);
});

test('quote references accept only safe optional UTF-16 offsets', () => {
    const source = ref(0, '🙂甲说：“我相信你。”');
    const quote = '我相信你。';
    const item = attitude(source, { source: { slot: source.slot, quote, offset: source.text.indexOf(quote) } });
    assert.deepEqual(parseAffinityResponse(JSON.stringify({ events: [item] })), [item]);
    for (const offset of [-1, 1.5, '0', null, Number.MAX_SAFE_INTEGER + 1]) {
        assert.deepEqual(parseAffinityResponse(JSON.stringify({ events: [{ ...item, source: { ...item.source, offset } }] })), []);
    }
    const state = apply(fresh(), [item], [source]);
    assert.equal(state.events[0].source.offset, 6, 'offset counts the emoji as two UTF-16 code units');
    assert.equal(apply(fresh(), [{ ...item, source: { ...item.source, offset: item.source.offset - 1 } }], [source]).events.length, 0);
    assert.equal(candidateKey(item, [source]), candidateKey(attitude(source, { source: { slot: source.slot, quote } }), [source]));
});

test('ambiguous repeated quotes need explicit offsets and distinct occurrences stay independent', () => {
    const source = ref(0, '甲说：“我相信你。”稍后又说：“我相信你。”');
    const quote = '我相信你。';
    const ambiguous = attitude(source, { source: { slot: source.slot, quote } });
    assert.equal(candidateKey(ambiguous, [source]), '');
    assert.equal(apply(fresh(), [ambiguous], [source]).events.length, 0);
    const first = { ...ambiguous, source: { ...ambiguous.source, offset: source.text.indexOf(quote) } };
    const second = { ...ambiguous, source: { ...ambiguous.source, offset: source.text.lastIndexOf(quote) } };
    assert.notEqual(candidateKey(first, [source]), candidateKey(second, [source]));
    const state = apply(fresh(), [first, second], [source]);
    assert.equal(state.events.length, 2);
    assert.equal(affinityScores(state)['a.png'], 4);
    assert.deepEqual(reconcileAffinity(JSON.parse(JSON.stringify(state)), [source], owners), state);
    assert.equal(reconcileAffinity(state, [{ ...source, text: `移位${source.text}` }], owners).events.length, 0, 'stored offsets cannot silently relocate to another occurrence');
});

test('legacy version-one records gain offsets only from an unambiguous live quote', () => {
    const source = ref(0, '甲说：“我相信你。”');
    const state = apply(fresh(), [attitude(source)], [source]);
    const legacy = JSON.parse(JSON.stringify(state));
    delete legacy.events[0].source.offset;
    assert.deepEqual(reconcileAffinity(legacy, [source], owners), state);
    const ambiguous = { ...source, text: `${source.text}${source.text}` };
    assert.equal(reconcileAffinity(legacy, [ambiguous], owners).events.length, 0);
    assert.equal(reconcileAffinity(legacy, [], []).events.length, 1, 'unavailable owner evidence remains dormant without inventing an offset');
});

test('a repeated acknowledgement binds to its chosen position after the result', () => {
    const source = ref(0, '我答应还书。', { owner: 'player' });
    const ackQuote = '我更信任你。';
    const resultQuote = '玩家已经还书。';
    const combined = ref(1, `甲说：“${ackQuote}”${resultQuote}甲又说：“${ackQuote}”`);
    const refs = [source, combined];
    const base = apply(fresh(), [promise(source, { actor: 'user', recipient: 'character' })], refs);
    const item = outcome(base.events[0], { ...combined, text: resultQuote }, {
        acknowledgement: { slot: combined.slot, quote: ackQuote, offset: combined.text.lastIndexOf(ackQuote) },
    });
    const accepted = apply(base, [item], refs);
    assert.equal(affinityScores(accepted)['a.png'], 2);
    assert.equal(all(accepted).find(event => event.kind === 'outcome').acknowledgement.offset, combined.text.lastIndexOf(ackQuote));
    assert.deepEqual(reconcileAffinity(JSON.parse(JSON.stringify(accepted)), refs, owners), accepted);
    const early = { ...item, acknowledgement: { ...item.acknowledgement, offset: combined.text.indexOf(ackQuote) } };
    assert.equal(all(apply(base, [early], refs)).length, 1, 'an earlier repeated phrase is not a causal acknowledgement');
    const missing = { ...item, acknowledgement: { slot: combined.slot, quote: ackQuote } };
    assert.equal(all(apply(base, [missing], refs)).length, 1, 'ambiguous missing offset is not guessed');
});

test('a repeated result binds to its chosen position after the promise', () => {
    const resultQuote = '玩家已经还书。';
    const sourceQuote = '我答应还书。';
    const combined = ref(0, `${resultQuote}${sourceQuote}${resultQuote}`, { owner: 'player' });
    const refs = [combined];
    const base = apply(fresh(), [promise(combined, { actor: 'user', recipient: 'character', source: { slot: combined.slot, quote: sourceQuote } })], refs);
    const item = outcome(base.events[0], { ...combined, text: resultQuote }, { result: { slot: combined.slot, quote: resultQuote, offset: combined.text.lastIndexOf(resultQuote) } });
    assert.equal(all(apply(base, [item], refs)).length, 2);
    assert.equal(all(apply(base, [{ ...item, result: { ...item.result, offset: 0 } }], refs)).length, 1);
    assert.equal(all(apply(base, [{ ...item, result: { slot: combined.slot, quote: resultQuote } }], refs)).length, 1);
});

test('source owner, allowed actors and group relationship ownership are enforced', () => {
    const source = ref(0, '甲说：“我开始信任你了。”');
    assert.equal(apply(fresh(), [attitude(source, { owner: 'b.png' })], [source]).events.length, 0);
    assert.equal(apply(fresh(), [attitude(source, { owner: 'invented.png' })], [source]).events.length, 0);
    assert.equal(apply(fresh(), [attitude(source, { actor: 'user' })], [source]).events.length, 0);
    const player = ref(1, '我信任你。', { owner: 'player', name: '玩家', generated: false });
    const state = apply(fresh(), [attitude(player, { actor: 'user', recipient: 'character' })], [source, player]);
    assert.equal(state.events.length, 1);
    assert.equal(affinityScores(state)['a.png'], 0, 'player attitude must not become character disposition');
    const shared = apply(fresh(), [proposal(player, { actor: 'user' }), proposal(player, { actor: 'user', owner: 'b.png' })], [source, player]);
    assert.deepEqual(Object.keys(affinityScores(shared)).sort(), ['a.png', 'b.png']);
    assert.equal(apply(fresh(), [attitude(source, { actor: 'other' })], [source]).events.length, 0);
    assert.equal(apply(fresh(), [proposal(source, { actor: 'other', recipient: 'other' })], [source]).events.length, 1);
    const duplicateSlots = [source, { ...source }];
    assert.equal(apply(fresh(), [attitude(source)], duplicateSlots).events.length, 0);
});

test('facts and ambiguous, future, implicit or character-unknown attitudes never score', () => {
    const source = ref(0, '甲递来一杯水，说：“我开始信任你了。”');
    for (const item of [
        proposal(source, { valence: 'positive', attitudeExplicit: true }),
        attitude(source, { attitudeExplicit: false }), attitude(source, { confidence: 'low' }),
        attitude(source, { status: 'agreed' }), attitude(source, { valence: 'none' }),
        attitude(source, { knownToCharacter: 'unknown' }), attitude(source, { knownToCharacter: 'no' }),
    ]) {
        const state = apply(fresh(), [item], [source]);
        assert.equal(state.events.length, 1);
        assert.equal(affinityScores(state)['a.png'], 0);
    }
    assert.equal(affinityScores(apply(fresh(), [attitude(source)], [source]))['a.png'], 2);
    assert.equal(affinityScores(apply(fresh(), [attitude(source, { valence: 'negative' })], [source]))['a.png'], -3);
});

test('an observed explicit attitude does not require an outcome to score or enter memory', () => {
    const source = ref(0, '甲明确说：“我现在更愿意相信你。”');
    for (const outcomeKnown of [null, false, true]) {
        const item = attitude(source, { outcomeKnown });
        const state = apply(fresh(), [item], [source]);
        assert.equal(affinityScores(state)['a.png'], 2, `outcomeKnown=${outcomeKnown}`);
        assert.equal(state.events[0].delta, 2);
        assert.match(buildAffinityMemory(state, [source], 'a.png'), /甲明确表达了信任/);
        assert.deepEqual(reconcileAffinity(JSON.parse(JSON.stringify(state)), [source], owners), state);
    }
});

test('an observed fact with no outcome is remembered without granting points', () => {
    const source = ref(0, '甲说：“我记住你不喜欢被突然触碰。”');
    for (const outcomeKnown of [null, false, true]) {
        const item = proposal(source, { outcomeKnown, valence: 'positive', attitudeExplicit: true });
        const state = apply(fresh(), [item], [source]);
        assert.equal(affinityScores(state)['a.png'], 0);
        assert.match(buildAffinityMemory(state, [source], 'a.png'), /甲记得玩家说过的边界/);
    }
    for (const fields of [{ confidence: 'low' }, { knownToCharacter: 'unknown' }, { knownToCharacter: 'no' }]) {
        const state = apply(fresh(), [proposal(source, { outcomeKnown: null, ...fields })], [source]);
        assert.equal(buildAffinityMemory(state, [source], 'a.png'), '');
    }
});

test('major changes require one-time host-key verification and never downgrade to minor points', () => {
    const source = ref(0, '甲明确表示再也无法信任玩家。');
    const item = attitude(source, { impact: 'major', valence: 'negative' });
    const key = candidateKey(item, [source]);
    assert.match(key, /^aff:[a-f0-9]{16}$/);
    assert.equal(affinityScores(apply(fresh(), [item], [source]))['a.png'], 0);
    assert.equal(affinityScores(apply(fresh(), [item], [source], { verified: new Set(['model-invented-id']) }))['a.png'], 0);
    const verified = apply(fresh(), [item], [source], { verified: new Set([key]) });
    assert.equal(affinityScores(verified)['a.png'], -8);
    assert.equal(affinityScores(reconcileAffinity(JSON.parse(JSON.stringify(verified)), [source], owners))['a.png'], -8);
    const otherMeaning = { ...item, valence: 'positive' };
    const otherKey = candidateKey(otherMeaning, [source]);
    assert.notEqual(otherKey, key);
    assert.equal(affinityScores(apply(fresh(), [otherMeaning], [source], { verified: new Set([key]) }))['a.png'], 0, 'invalidated verdict never blesses a different direction');
    assert.equal(affinityScores(apply(fresh(), [otherMeaning], [source], { verified: new Set([otherKey]) }))['a.png'], 5);
    assert.equal(candidateKey(item, [{ ...source, fingerprint: 'new' }]) === key, false);
    assert.equal(candidateKey(item, []), '');
});

test('evidence identity ignores paraphrasing, valence, impact and batch repetition', () => {
    const source = ref(0, '甲说：“我信任你。”');
    const item = attitude(source);
    let state = apply(fresh(), [item, item, { ...item, fact: '同一句换个说法。' }], [source]);
    const id = state.events[0].id;
    state = apply(state, [{ ...item, fact: '另一个摘要。', valence: 'negative', impact: 'major' }], [source]);
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].id, id);
    assert.equal(state.nextId, 2);
    assert.equal(affinityScores(state)['a.png'], 2);
    assert.notEqual(candidateKey(item, [source]), candidateKey({ ...item, fact: '新摘要。', valence: 'negative' }, [source]), 'verification keys preserve direction and intensity');
    state = apply(state, [proposal(source)], [source]);
    assert.equal(state.events.length, 1, 'same quote cannot be restated in a new kind');
    const inherited = Object.create(item);
    assert.equal(apply(fresh(), [inherited], [source]).events.length, 0);
});

test('overlapping quote aliases of one attitude cannot earn another score or major verification key', () => {
    const source = ref(0, '甲说：“我开始信任你了。”');
    const first = attitude(source, { source: { slot: source.slot, quote: '我开始信任你了。' } });
    const wider = attitude(source, { impact: 'major' });
    const narrower = attitude(source, { source: { slot: source.slot, quote: '开始信任你了' } });
    const original = apply(fresh(), [first], [source]);
    const key = candidateKey(wider, [source]);
    const next = apply(JSON.parse(JSON.stringify(original)), [wider, narrower], [source], { verified: new Set([key]) });
    assert.equal(all(next).length, 1);
    assert.equal(next.events[0].id, original.events[0].id);
    assert.equal(next.events[0].key, original.events[0].key, 'an alias cannot become a fresh major verification candidate');
    assert.equal(next.nextId, original.nextId);
    assert.equal(affinityScores(next)['a.png'], 2);
    for (const batch of [[first, narrower], [narrower, first]]) {
        const sameBatch = apply(fresh(), batch, [source]);
        assert.equal(all(sameBatch).length, 1);
        assert.equal(affinityScores(sameBatch)['a.png'], 2);
    }
});

test('non-overlapping attitudes in the same logical message remain separate evidence', () => {
    const source = ref(0, '甲先说：“我开始信任你了。”后来又说：“你这一次的坦诚让我更愿意相信你。”');
    const items = ['我开始信任你了。', '你这一次的坦诚让我更愿意相信你。']
        .map(quote => attitude(source, { source: { slot: source.slot, quote } }));
    const state = apply(fresh(), items, [source]);
    assert.equal(all(state).length, 2);
    assert.equal(affinityScores(state)['a.png'], 4);
});

test('a wider or narrower promise quote does not create another open anchor', () => {
    const source = ref(0, '玩家说：“我会把借走的书归还给甲。”', { owner: 'player' });
    const result = ref(1, '玩家把借来的书交还给甲。', { owner: 'player' });
    const ack = ref(2, '甲看见归还的书，说：“你说到做到了，我更信任你了。”');
    const refs = [source, result, ack];
    let state = apply(fresh(), [promise(source, { actor: 'user', recipient: 'character',
        source: { slot: source.slot, quote: '我会把借走的书归还给甲。' } })], refs);
    const id = state.events[0].id;
    state = apply(state, [promise(source, { actor: 'user', recipient: 'character' })], refs);
    assert.equal(all(state).filter(event => event.kind === 'promise').length, 1);
    assert.equal(state.events[0].id, id);
    state = apply(state, [outcome(state.events[0], result, { acknowledgement: { slot: ack.slot, quote: ack.text } })], refs);
    assert.equal(affinityScores(state)['a.png'], 2);
    assert.doesNotMatch(buildAffinityMemory(state, refs, 'a.png'), /尚待兑现的约定/);
});

test('reconcile collapses stored overlapping attitude aliases without amplifying their first score', () => {
    const source = ref(0, '甲说：“我开始信任你了。”');
    const first = apply(fresh(), [attitude(source, { source: { slot: source.slot, quote: '我开始信任你了。' } })], [source]);
    const major = attitude(source, { impact: 'major' });
    const alias = apply(fresh(), [major], [source], { verified: new Set([candidateKey(major, [source])]) });
    alias.events[0].id = 'chat-scope:e:2';
    const stored = { ...first, nextId: 3, events: [first.events[0]], archives: [alias.events[0]] };
    const next = reconcileAffinity(JSON.parse(JSON.stringify(stored)), [source], owners);
    assert.equal(all(next).length, 1);
    assert.equal(next.events[0].id, first.events[0].id, 'canonical ownership follows the first host ID, not archive array order');
    assert.equal(next.nextId, 3);
    assert.equal(affinityScores(next)['a.png'], 2);
});

test('reconcile remaps a stored promise alias to its first host ID while preserving its valid outcome', () => {
    const source = ref(0, '玩家说：“我会把借走的书归还给甲。”', { owner: 'player' });
    const result = ref(1, '玩家归还了借来的书。', { owner: 'player' });
    const ack = ref(2, '甲亲眼确认，说：“履约让我愿意再相信你。”');
    const refs = [source, result, ack];
    const first = apply(fresh(), [promise(source, { actor: 'user', recipient: 'character',
        source: { slot: source.slot, quote: '我会把借走的书归还给甲。' } })], refs);
    const wider = apply(fresh(), [promise(source, { actor: 'user', recipient: 'character' })], refs);
    wider.events[0].id = 'chat-scope:p:2';
    wider.nextId = 3;
    const completedAlias = apply(wider, [outcome(wider.events[0], result, { acknowledgement: { slot: ack.slot, quote: ack.text } })], refs);
    const stored = { ...completedAlias, events: [first.events[0]], archives: completedAlias.events };
    const next = reconcileAffinity(JSON.parse(JSON.stringify(stored)), refs, owners);
    const promises = all(next).filter(event => event.kind === 'promise');
    const outcomes = all(next).filter(event => event.kind === 'outcome');
    assert.equal(promises.length, 1);
    assert.equal(promises[0].id, first.events[0].id);
    assert.equal(outcomes.length, 1, 'an alias migration must not revoke a genuinely grounded completion');
    assert.equal(outcomes[0].id, completedAlias.events.find(event => event.kind === 'outcome').id);
    assert.equal(outcomes[0].anchorId, first.events[0].id);
    assert.equal(next.nextId, 4);
    assert.equal(affinityScores(next)['a.png'], 2);
    assert.doesNotMatch(buildAffinityMemory(next, refs, 'a.png'), /尚待兑现的约定/);
    assert.deepEqual(reconcileAffinity(next, refs, owners), next, 'migration is idempotent');
});

test('stored promise aliases with separate completions still resolve their canonical promise only once', () => {
    const source = ref(0, '玩家说：“我会把借走的书归还给甲。”', { owner: 'player' });
    const result = ref(1, '玩家归还了那本书。', { owner: 'player' });
    const ack = ref(2, '甲说：“我看见了，你确实做到了，我更信任你了。”');
    const repeated = ref(3, '玩家重述自己把借书还给了甲。', { owner: 'player' });
    const laterAck = ref(4, '甲再次说自己知道书已经归还。');
    const refs = [source, result, ack, repeated, laterAck];
    const first = apply(fresh(), [promise(source, { actor: 'user', recipient: 'character',
        source: { slot: source.slot, quote: '我会把借走的书归还给甲。' } })], refs);
    const completed = apply(first, [outcome(first.events[0], result, { acknowledgement: { slot: ack.slot, quote: ack.text } })], refs);
    const alias = apply(fresh(), [promise(source, { actor: 'user', recipient: 'character' })], refs);
    alias.events[0].id = 'chat-scope:p:3';
    alias.nextId = 4;
    const completedAlias = apply(alias, [outcome(alias.events[0], repeated, { acknowledgement: { slot: laterAck.slot, quote: laterAck.text } })], refs);
    const stored = { ...completedAlias, events: completed.events, archives: completedAlias.events };
    const next = reconcileAffinity(JSON.parse(JSON.stringify(stored)), refs, owners);
    assert.equal(all(next).filter(event => event.kind === 'promise').length, 1);
    const outcomes = all(next).filter(event => event.kind === 'outcome');
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].id, completed.events.find(event => event.kind === 'outcome').id);
    assert.equal(affinityScores(next)['a.png'], 2);
    assert.equal(next.nextId, 5);
});

test('host promises award no points; completed result binds original promise and later literal evidence', () => {
    const promised = ref(0, '我答应把这本书还给你。');
    const delivered = ref(2, '甲把那本书还给了玩家。');
    let state = apply(fresh(), [promise(promised)], [promised, delivered]);
    const anchor = state.events[0];
    assert.match(anchor.id, /^chat-scope:p:1$/);
    assert.equal(affinityScores(state)['a.png'], 0);
    const completed = outcome(anchor, delivered);
    state = apply(state, [completed, completed], [promised, delivered]);
    assert.equal(state.events.length, 2);
    assert.equal(affinityScores(state)['a.png'], 0, 'character fulfilling its own promise records a fact only');
    assert.doesNotMatch(buildAffinityMemory(state, [promised, delivered], 'a.png'), /尚待兑现的约定/,
        'completion and earning relationship points are separate decisions');
    const old = structuredClone(state);
    const edited = reconcileAffinity(state, [promised, { ...delivered, fingerprint: 'result-edited' }], owners);
    assert.equal(edited.events.length, 1);
    assert.equal(edited.events[0].id, anchor.id);
    assert.equal(affinityScores(edited)['a.png'], 0);
    assert.match(buildAffinityMemory(edited, [promised], 'a.png'), /尚待兑现的约定/);
    assert.deepEqual(state, old);
    const removed = reconcileAffinity(state, [delivered], owners);
    assert.equal(removed.events.length, 0, 'removing original promise removes dependent outcome');
});

test('a new promise or future/unknown/observed result cannot be mistaken for fulfillment', () => {
    const promised = ref(2, '我答应把书还给你。');
    const before = ref(1, '甲把书还给了玩家。');
    const after = ref(3, '甲说以后会把书还给玩家。');
    const base = apply(fresh(), [promise(promised)], [before, promised, after]);
    const anchor = base.events[0];
    for (const fields of [
        { anchorId: 'llm-invented-promise' }, { source: { slot: after.slot, quote: after.text } },
        { actor: 'user' }, { recipient: 'other' }, { owner: 'b.png' },
        { result: { slot: before.slot, quote: before.text } },
        { result: { slot: promised.slot, quote: promised.text } },
        { result: { slot: after.slot, quote: '并不存在的结果。' } },
    ]) assert.equal(apply(base, [outcome(anchor, after, fields)], [before, promised, after]).events.length, 1);
    for (const fields of [{ status: 'observed' }, { outcomeKnown: false }, { outcomeKnown: null }, { confidence: 'low' }]) {
        const state = apply(base, [outcome(anchor, after, fields)], [before, promised, after]);
        assert.equal(affinityScores(state)['a.png'], 0);
        assert.match(buildAffinityMemory(state, [before, promised, after], 'a.png'), /尚待兑现的约定/);
    }
    const secondPromise = ref(4, '我明天再带一本书给你。');
    const state = apply(base, [promise(secondPromise)], [promised, secondPromise]);
    assert.equal(state.events.filter(event => event.kind === 'promise').length, 2);
    assert.equal(affinityScores(state)['a.png'], 0);
});

test('one message may contain a promise and a later separate result, but reverse/overlapping quotes fail', () => {
    const source = ref(0, '我答应还书。随后，甲把书交给玩家。');
    const state = apply(fresh(), [promise(source, { source: { slot: source.slot, quote: '我答应还书。' } })], [source]);
    const anchor = state.events[0];
    const result = { ...source, text: '甲把书交给玩家。' };
    assert.equal(affinityScores(apply(state, [outcome(anchor, result)], [source]))['a.png'], 0);
    const reversed = { ...source, text: '甲把书交给玩家。然后我答应还书。', fingerprint: 'reversed' };
    const reversedState = apply(fresh(), [promise(reversed, { source: { slot: source.slot, quote: '我答应还书。' } })], [reversed]);
    assert.equal(apply(reversedState, [outcome(reversedState.events[0], result)], [reversed]).events.length, 1);
});

test('narrowing an outcome source cannot turn words inside the canonical promise into a later result', () => {
    const source = ref(0, '我答应还书，之后会说“书已经还了”，这仍是打算。', { owner: 'player' });
    const ack = ref(1, '甲说：“我看到了履约，这使我更信任你。”');
    const refs = [source, ack];
    const state = apply(fresh(), [promise(source, { actor: 'user', recipient: 'character' })], refs);
    const anchor = state.events[0];
    const item = outcome(anchor, { slot: source.slot, text: '书已经还了' }, {
        source: { slot: source.slot, quote: '我答应还书' },
        acknowledgement: { slot: ack.slot, quote: ack.text }, impact: 'major',
    });
    const next = apply(state, [item], refs, { verified: new Set([candidateKey(item, refs)]) });
    assert.equal(all(next).length, 1, 'even a verified proposal cannot bypass canonical promise causality');
    assert.equal(affinityScores(next)['a.png'], 0);
    const bind = quote => {
        const original = refs.find(ref => ref.slot === quote.slot);
        return { ...quote, index: original.index, swipe: original.swipe, fingerprint: original.fingerprint, offset: original.text.indexOf(quote.quote) };
    };
    const stored = { ...state, nextId: 3, events: [anchor, { ...item, id: 'chat-scope:e:2',
        key: candidateKey(item, refs), verified: true, delta: 5,
        source: bind(item.source), result: bind(item.result), acknowledgement: bind(item.acknowledgement) }] };
    assert.equal(all(reconcileAffinity(stored, refs, owners)).length, 1, 'old narrowed sources must fail the same causal check on reload');
});

test('widening an outcome source does not hide a real result after the canonical promise', () => {
    const source = ref(0, '我答应还书。随后，我把书交还给甲。', { owner: 'player' });
    const ack = ref(1, '甲说：“我亲眼看到了你履约，现在更愿意信任你。”');
    const refs = [source, ack];
    const state = apply(fresh(), [promise(source, { actor: 'user', recipient: 'character',
        source: { slot: source.slot, quote: '我答应还书。' } })], refs);
    const anchor = state.events[0];
    const item = outcome(anchor, { slot: source.slot, text: '我把书交还给甲。' }, {
        source: { slot: source.slot, quote: source.text }, acknowledgement: { slot: ack.slot, quote: ack.text },
    });
    const next = apply(state, [item], refs);
    assert.equal(all(next).length, 2);
    assert.equal(affinityScores(next)['a.png'], 2);
    const completion = next.events.find(event => event.kind === 'outcome');
    assert.deepEqual(completion.source, anchor.source, 'the stored source is always the canonical promise quote');
    assert.equal(completion.key, candidateKey(item, refs), 'the verdict key still identifies the actual proposed evidence');
    assert.deepEqual(reconcileAffinity(JSON.parse(JSON.stringify(next)), refs, owners), next);
});

for (const [label, text, canonicalQuote, aliasQuote, acknowledgement, expected] of [
    ['narrow', '我看到你还书了。“你说到做到，我更信任你”，但这只是我在练习的台词。',
        '我看到你还书了。“你说到做到，我更信任你”，但这只是我在练习的台词。',
        '我看到你还书了。', '你说到做到，我更信任你', 0],
    ['wide', '甲亲眼看见玩家归还的书。随后，甲说：“这次履约让我更信任你。”',
        '甲亲眼看见玩家归还的书。', '甲亲眼看见玩家归还的书。随后，甲说：“这次履约让我更信任你。”',
        '这次履约让我更信任你。', 2],
]) {
    for (const mode of ['apply', 'reload']) {
        test(`${mode}: a ${label} result alias uses the original physical result boundary for later acknowledgement`, () => {
            const source = ref(0, '我答应把借来的书归还给甲。', { owner: 'player' });
            const result = ref(1, text);
            const refs = [source, result];
            const promised = apply(fresh(), [promise(source, { actor: 'user', recipient: 'character' })], refs);
            const anchor = promised.events[0];
            const completed = apply(promised, [outcome(anchor, { slot: result.slot, text: canonicalQuote })], refs);
            assert.equal(affinityScores(completed)['a.png'], 0);
            const proposal = outcome(anchor, { slot: result.slot, text: aliasQuote }, {
                acknowledgement: { slot: result.slot, quote: acknowledgement },
            });
            let next;
            if (mode === 'apply') next = apply(completed, [proposal], refs);
            else {
                const bind = quote => {
                    const original = refs.find(ref => ref.slot === quote.slot);
                    return { ...quote, index: original.index, swipe: original.swipe, fingerprint: original.fingerprint,
                        offset: original.text.indexOf(quote.quote) };
                };
                next = reconcileAffinity({ ...completed, nextId: 4, events: [...completed.events, {
                    ...proposal, id: 'chat-scope:e:3', key: candidateKey(proposal, refs), verified: false, delta: 2,
                    source: bind(proposal.source), result: bind(proposal.result), acknowledgement: bind(proposal.acknowledgement),
                }] }, refs, owners);
            }
            const outcomes = all(next).filter(event => event.kind === 'outcome');
            assert.equal(outcomes.length, 1);
            assert.equal(outcomes[0].id, completed.events.find(event => event.kind === 'outcome').id);
            assert.equal(outcomes[0].result.quote, canonicalQuote);
            assert.equal(affinityScores(next)['a.png'], expected);
            assert.deepEqual(reconcileAffinity(JSON.parse(JSON.stringify(next)), refs, owners), next);
        });
    }
}

test('a character completing its own promise frees open-anchor capacity without gaining points', () => {
    const sources = Array.from({ length: 65 }, (_, index) => ref(index, `甲答应归还第 ${index} 本书。`));
    const result = ref(100, '甲把第 0 本书还给了玩家。');
    const refs = [...sources, result];
    let state = fresh();
    for (let start = 0; start < 64; start += 20) state = apply(state, sources.slice(start, Math.min(64, start + 20)).map(source => promise(source)), refs);
    const anchor = all(state).find(event => event.source.slot === sources[0].slot);
    state = apply(state, [outcome(anchor, result)], refs);
    state = apply(state, [promise(sources[64])], refs);
    assert.equal(all(state).filter(event => event.kind === 'promise').length, 64);
    assert.ok(all(state).some(event => event.source.slot === sources[64].slot), 'completed character anchors cannot occupy the unresolved cap forever');
    assert.equal(all(state).some(event => event.id === anchor.id || event.anchorId === anchor.id), false,
        'normal capacity recycling forgets a completed character dependency as one family');
    assert.equal(affinityScores(state)['a.png'], 0);
});

test('completed user promises may support the target owner while another character cannot narrate the result', () => {
    const promised = ref(0, '我会把书还给甲。', { owner: 'player', generated: false });
    const delivered = ref(1, '玩家把书还给甲。');
    const base = apply(fresh(), [promise(promised, { actor: 'user', recipient: 'character' })], [promised, delivered]);
    assert.equal(affinityScores(apply(base, [outcome(base.events[0], delivered)], [promised, delivered]))['a.png'], 0, 'the promised book was not a relationship change by itself');
    const other = { ...delivered, owner: 'b.png' };
    assert.equal(apply(base, [outcome(base.events[0], other)], [promised, other]).events.length, 1);
});


test('a player outcome scores only after the target character has a later literal acknowledgement', () => {
    const promised = ref(0, '我答应把损坏的零件修好。', { owner: 'player', generated: false });
    const result = ref(1, '我修好了。', { owner: 'player', generated: false });
    const aware = ref(2, '甲亲眼看见修好的零件，说：“你真的做到了，我又能相信你了。”');
    const before = ref(-1, '甲以前说谢谢。');
    const base = apply(fresh(), [promise(promised, { actor: 'user', recipient: 'character' })], [promised, result, aware, before]);
    const anchor = base.events[0];
    const candidate = acknowledgement => outcome(anchor, result, {
        fact: '玩家修好零件，角色明确恢复了信任。', actor: 'user', recipient: 'character',
        acknowledgement: { slot: aware.slot, quote: acknowledgement },
    });
    const silent = outcome(anchor, result, { actor: 'user', recipient: 'character' });
    assert.equal(affinityScores(apply(base, [silent], [promised, result, aware]))['a.png'], 0, 'physical completion alone is a fact, not affection');
    const unknown = apply(base, [outcome(anchor, result, { actor: 'user', knownToCharacter: 'unknown', acknowledgement: { slot: aware.slot, quote: '你真的做到了，我又能相信你了。' } })], [promised, result, aware]);
    assert.equal(affinityScores(unknown)['a.png'], 0, 'model-stated acknowledgement without known character knowledge cannot score');
    const accepted = apply(base, [candidate('你真的做到了，我又能相信你了。')], [promised, result, aware]);
    assert.equal(affinityScores(accepted)['a.png'], 2);
    const later = apply(apply(base, [silent], [promised, result, aware]), [candidate('你真的做到了，我又能相信你了。')], [promised, result, aware]);
    assert.equal(affinityScores(later)['a.png'], 2);
    assert.equal(later.events.filter(event => event.kind === 'outcome').length, 1);
    assert.equal(affinityScores(reconcileAffinity(JSON.parse(JSON.stringify(accepted)), [promised, result], owners))['a.png'], 0, 'deleting acknowledgement revokes dependent score');
    assert.equal(apply(base, [silent, silent], [promised, result, aware]).events.length, 2, 'one physical outcome does not become two records');
    assert.equal(apply(base, [outcome(anchor, result, { actor: 'user', acknowledgement: { slot: before.slot, quote: before.text } })], [before, promised, result]).events.length, 1, 'an invalid acknowledgement rejects the outcome instead of silently stripping the acknowledgement');
    const silentState = apply(base, [silent], [promised, result, aware, before]);
    const replacementRefs = [before, promised, result, aware, { ...aware, slot: 'slot-b', index: 3, owner: 'b.png' }];
    for (const [label, ack] of [['earlier', before], ['other owner', replacementRefs.at(-1)]]) {
        const replaced = apply(silentState, [outcome(anchor, result, { actor: 'user', recipient: 'character', acknowledgement: { slot: ack.slot, quote: ack.text } })], replacementRefs);
        assert.equal(affinityScores(replaced)['a.png'], 0, `${label} acknowledgement cannot replace a silent outcome`);
        assert.equal(all(replaced).some(event => event.acknowledgement), false);
    }
    const replacedOnce = apply(silentState, [candidate('你真的做到了，我又能相信你了。')], replacementRefs);
    assert.equal(affinityScores(apply(replacedOnce, [candidate('我又能相信你了。')], replacementRefs))['a.png'], 2, 'an acknowledged outcome is not replaced again');
    const thirdPerson = { ...aware, owner: 'b.png' };
    assert.equal(apply(base, [outcome(anchor, result, { actor: 'user', acknowledgement: { slot: thirdPerson.slot, quote: thirdPerson.text } })], [promised, result, thirdPerson]).events.length, 1);
    const repeatedResult = ref(3, result.text);
    assert.equal(apply(base, [outcome(anchor, result, { acknowledgement: { slot: repeatedResult.slot, quote: repeatedResult.text } })], [promised, result, repeatedResult]).events.length, 1, 'a later copy of the result is not a distinct acknowledgement');
});

test('reconcile retains unavailable owners without scoring them, and restores them only through a live owner', () => {
    const a = ref(4, '甲说我信任你。');
    const b = ref(5, '乙说我不信任你。', { owner: 'b.png' });
    const state = apply(fresh(), [attitude(a), attitude(b, { owner: 'b.png', valence: 'negative', fact: '乙明确远离玩家的社群。' })], [a, b]);
    const shifted = reconcileAffinity(state, [{ ...a, index: 1 }, { ...b, index: 2 }], owners);
    assert.deepEqual(affinityScores(shifted), { 'a.png': 2, 'b.png': -3 });
    assert.equal(shifted.events[0].source.index, 1);
    assert.equal(all(reconcileAffinity(state, [b], owners)).some(event => event.owner === 'a.png'), false, 'unprojected old quote cannot be revived from a new message of the same owner');
    for (const refs of [[a], [a, b]]) {
        const offline = reconcileAffinity(state, refs, [owners[0]]);
        assert.equal(all(offline).length, 2, 'owner outside the current roster survives a no-evidence refresh');
        for (const event of all(offline)) assert.notEqual(event.delta, undefined, 'retained offline data is never allowed to contaminate another owner\'s score map');
        assert.deepEqual(affinityScores(offline), { 'a.png': 2, 'b.png': 0 });
        assert.equal(buildAffinityMemory(offline, refs, 'a.png').includes(offline.events.find(event => event.owner === 'b.png').fact), false, 'offline owner has no memory injection for the live owner');
        assert.equal(buildAffinityMemory(offline, refs, 'b.png'), '', 'asking for a memory cannot revive an offline owner');
    }
    const missingLiveSource = reconcileAffinity(state, [b], [owners[0]]);
    assert.deepEqual(affinityScores(missingLiveSource), { 'b.png': 0 }, 'offline retention must not resurrect a different, live owner whose source is missing');
    assert.deepEqual(affinityScores(reconcileAffinity(state, [b], owners)), { 'b.png': -3 }, 'the live owner keeps only its own individually grounded evidence');
    assert.deepEqual(affinityScores(reconcileAffinity(state, [a, { ...b, swipe: 1 }], owners)), { 'a.png': 2 }, 'changed current swipe withdraws only its own evidence');
});

test('scores clamp at both bounds and causally replay in message order, independent of evaluation order', () => {
    const refs = Array.from({ length: 100 }, (_, index) => ref(index, `甲的明确态度原话 ${index}。`));
    let state = fresh();
    for (let start = 0; start < refs.length; start += 20) state = apply(state, refs.slice(start, start + 20).map(source => attitude(source)), refs);
    assert.equal(affinityScores(state)['a.png'], 80);
    let negative = fresh();
    for (let start = 0; start < refs.length; start += 20) negative = apply(negative, refs.slice(start, start + 20).map(source => attitude(source, { valence: 'negative' })), refs);
    assert.equal(affinityScores(negative)['a.png'], -100);
    const last = ref(101, '甲后来明确表达了失望。');
    const withLast = apply(state, [attitude(last, { valence: 'negative' })], [...refs, last]);
    assert.equal(affinityScores(withLast)['a.png'], 77);
    const shuffled = { ...withLast, events: [...withLast.events].reverse() };
    assert.equal(affinityScores(shuffled)['a.png'], 77);
});

test('storage caps active/archive evidence and pins unresolved promises without silently discarding them', () => {
    const promises = Array.from({ length: 70 }, (_, index) => ref(index, `约定原文 ${index}：我会归还。`));
    const facts = Array.from({ length: 300 }, (_, index) => ref(index + 100, `已知经历原文 ${index}。`));
    const refs = [...promises, ...facts];
    let state = fresh();
    for (let start = 0; start < promises.length; start += 20) state = apply(state, promises.slice(start, start + 20).map(source => promise(source)), refs);
    const pinned = state.events.map(event => event.id);
    assert.equal(pinned.length, 64);
    for (let start = 0; start < facts.length; start += 20) state = apply(state, facts.slice(start, start + 20).map(source => proposal(source)), refs);
    assert.equal(state.events.length, 160);
    assert.equal(state.archives.length, 80);
    assert.equal(pinned.every(id => state.events.some(event => event.id === id)), true);
    assert.equal(state.events.filter(event => event.kind === 'promise').length, 64);
    const firstArchived = state.archives[0];
    const reconciled = reconcileAffinity(state, refs.filter(source => source.slot !== firstArchived.source.slot), owners);
    assert.equal(all(reconciled).some(event => event.id === firstArchived.id), false);
    assert.equal(reconciled.events.length <= 160, true);
    assert.equal(reconciled.archives.length <= 80, true);
    const newRef = ref(1000, '新的证据。');
    const next = apply(state, [proposal(newRef)], [...refs, newRef]);
    assert.equal(next.nextId, state.nextId + 1, 'compaction must not recycle host ids');
});

test('capacity forgets resolved dependencies together; deleting an archived result really reopens the original promise', () => {
    const promised = ref(0, '我会把借来的书还给甲。', { owner: 'player', generated: false });
    const delivered = ref(1, '玩家归还那本书。');
    const acknowledgement = ref(2, '甲亲眼看见归还的书，明确说愿意再相信他。');
    const facts = Array.from({ length: 240 }, (_, index) => ref(index + 3, `历史原文 ${index}。`));
    const refs = [promised, delivered, acknowledgement, ...facts];
    let state = apply(fresh(), [promise(promised, { source: { slot: promised.slot, quote: promised.text }, actor: 'user', recipient: 'character' })], refs);
    const anchor = state.events[0];
    state = apply(state, [outcome(anchor, delivered, { acknowledgement: { slot: acknowledgement.slot, quote: acknowledgement.text } })], refs);
    for (let start = 0; start < 180; start += 20) state = apply(state, facts.slice(start, start + 20).map(source => proposal(source)), refs);
    assert.equal(state.events.some(event => event.id === anchor.id), false, 'a resolved promise is not pinned in active memory');
    assert.equal(state.archives.some(event => event.id === anchor.id), true, 'bounded archive still retains the resolved promise');
    assert.equal(state.archives.some(event => event.anchorId === anchor.id), true, 'and its outcome as one family');
    const reopened = reconcileAffinity(state, refs.filter(source => source.slot !== delivered.slot), owners);
    assert.equal(reopened.events.some(event => event.id === anchor.id), true);
    assert.equal(all(reopened).some(event => event.kind === 'outcome'), false);
    assert.match(buildAffinityMemory(reopened, refs.filter(source => source.slot !== delivered.slot), 'a.png'), /尚待兑现的约定/);
    for (let start = 180; start < 240; start += 20) state = apply(state, facts.slice(start, start + 20).map(source => proposal(source)), refs);
    assert.equal(all(state).some(event => event.id === anchor.id || event.anchorId === anchor.id), false, 'resolved promise and outcome are forgotten as a dependency group');
    assert.equal(all(state).filter(event => event.kind === 'promise').length, 0, 'capacity does not reopen a forgotten resolved promise');
    assert.equal(state.events.length <= 160, true);
    assert.equal(state.archives.length <= 80, true);
});

test('all retained anchors share a hard cap, replacing only the oldest completed dependency family', () => {
    const sources = Array.from({ length: 65 }, (_, index) => ref(index, `我会归还这本书，约定 ${index}。`, { owner: 'player', generated: false }));
    const delivered = ref(100, '甲兑现了最早的归还约定。');
    const acknowledgement = ref(101, '玩家兑现了约定，甲明确表示又愿意相信他。');
    const refs = [...sources, delivered, acknowledgement];
    let state = fresh();
    for (let start = 0; start < 64; start += 20) state = apply(state, sources.slice(start, Math.min(64, start + 20)).map(source => promise(source, { actor: 'user', recipient: 'character' })), refs);
    const original = state.events.find(event => event.source.slot === sources[59].slot);
    const protectedIds = state.events.filter(event => event.id !== original.id).map(event => event.id);
    state = apply(state, [outcome(original, delivered, { actor: 'user', recipient: 'character', acknowledgement: { slot: acknowledgement.slot, quote: acknowledgement.text } })], refs);
    assert.equal(all(state).filter(event => event.kind === 'promise').length, 64);
    state = apply(state, [promise(sources[64], { actor: 'user', recipient: 'character' })], refs);
    assert.equal(all(state).filter(event => event.kind === 'promise').length, 64);
    assert.equal(all(state).some(event => event.id === original.id || event.anchorId === original.id), false, 'resolved dependency is evicted as a family');
    assert.ok(protectedIds.every(id => all(state).some(event => event.id === id)));
    const removedResult = reconcileAffinity(state, refs.filter(source => source.slot !== delivered.slot), owners);
    assert.equal(all(removedResult).filter(event => event.kind === 'promise').length, 64);
});

test('the same physical outcome has one owner, regardless of acknowledgement order within a batch', () => {
    const promised = ref(70, '我答应修好零件。', { owner: 'player', generated: false });
    const result = ref(71, '我修好了。', { owner: 'player', generated: false });
    const aware = ref(72, '甲看见修复结果，明确恢复了信任。');
    const refs = [promised, result, aware];
    const base = apply(fresh(), [promise(promised, { actor: 'user', recipient: 'character' })], refs);
    const anchor = base.events[0];
    const silent = outcome(anchor, result, { valence: 'none' });
    const changed = outcome(anchor, result, { acknowledgement: { slot: aware.slot, quote: aware.text } });
    const a = apply(base, [silent, changed], refs);
    const b = apply(base, [changed, silent], refs);
    assert.equal(all(a).filter(event => event.kind === 'outcome').length, 1);
    assert.equal(all(b).filter(event => event.kind === 'outcome').length, 1);
    assert.equal(affinityScores(a)['a.png'], 2);
    assert.equal(affinityScores(b)['a.png'], 2, 'restating a physical completion without acknowledgement cannot replace its later corroboration');
});

test('metadata character budgets reject new oversized open anchors and preserve every accepted unresolved promise', () => {
    const owner = { id: 'a'.repeat(240), name: '甲' };
    const source = index => ({ slot: `${'s'.repeat(190)}${index}`, index, swipe: 0, fingerprint: 'f'.repeat(160), owner: owner.id,
        text: `${index}${'文'.repeat(175)}`, generated: true });
    const promiseRefs = Array.from({ length: 80 }, (_, index) => source(index));
    const factRefs = Array.from({ length: 200 }, (_, index) => source(index + 100));
    const refs = [...promiseRefs, ...factRefs];
    let state = createAffinityState('c'.repeat(160));
    for (let start = 0; start < 80; start += 20) state = applyAffinityEvaluation(state,
        promiseRefs.slice(start, start + 20).map(item => promise(item, { owner: owner.id, fact: '承'.repeat(160) })), refs, [owner]);
    const pinned = all(state).filter(event => event.kind === 'promise').map(event => event.id);
    assert.equal(pinned.length > 0 && pinned.length < 64, true, 'character budget may limit anchors before count cap');
    const nextId = state.nextId;
    const blocked = applyAffinityEvaluation(state, [promise(promiseRefs.at(-1), { owner: owner.id, fact: '承'.repeat(160) })], refs, [owner]);
    assert.equal(blocked.nextId, nextId);
    for (let start = 0; start < 200; start += 20) state = applyAffinityEvaluation(state,
        factRefs.slice(start, start + 20).map(item => proposal(item, { owner: owner.id, fact: '事'.repeat(160) })), refs, [owner]);
    assert.equal(JSON.stringify(state.events).length <= 80000, true);
    assert.equal(JSON.stringify(state.archives).length <= 50000, true);
    assert.equal(state.events.length <= 160 && state.archives.length <= 80, true);
    assert.equal(pinned.every(id => state.events.some(event => event.id === id)), true);
    const reloaded = reconcileAffinity(JSON.parse(JSON.stringify(state)), refs, [owner]);
    assert.equal(pinned.every(id => reloaded.events.some(event => event.id === id)), true);
    const offline = reconcileAffinity(reloaded, [], []);
    assert.equal(JSON.stringify(offline.events).length <= 80000, true, 'freezing retained anchors also respects the metadata budget');
    assert.equal(JSON.stringify(offline.archives).length <= 50000, true);
});

test('malformed metadata fields are skipped without resetting valid state or reading inherited ledgers', () => {
    const source = ref(0, '甲明确说出了信任。');
    const base = apply(fresh(), [attitude(source)], [source]);
    const malformed = { ...base, cursor: {}, issued: -2, events: [null, [], {}, ...base.events], archives: { events: [] } };
    const restored = reconcileAffinity(malformed, [source], [null, {}, ...owners]);
    assert.equal(restored.id, base.id);
    assert.equal(restored.nextId, base.nextId);
    assert.deepEqual(affinityScores(restored), { 'a.png': 2 });
    assert.deepEqual(affinityScores({ ...base, events: {}, archives: false }), {});
    assert.deepEqual(affinityScores({ ...base, events: [null, {}, []], archives: [] }), {});
    const invalidRoster = applyAffinityEvaluation(base, [attitude(source)], [source], {});
    assert.equal(invalidRoster.events.length, 1, 'an unavailable roster freezes history and cannot authorize a new evaluation');
    assert.deepEqual(affinityScores(invalidRoster), { 'a.png': 0 });
    const inherited = Object.create({ id: base.id, events: base.events, archives: [] });
    assert.throws(() => reconcileAffinity(inherited, [source], owners), TypeError);
    assert.deepEqual(affinityScores(inherited), {});
    assert.equal(reconcileAffinity({ ...base, events: [], archives: null }, [source], owners).events.length, 0);
});

test('an unresolved player promise stays injectable when its owner has not spoken in the live chat', () => {
    const player = ref(0, '我答应把借走的书还给甲。', { owner: 'player', generated: false });
    const state = apply(fresh(), [promise(player, { actor: 'user', recipient: 'character' })], [player]);
    assert.match(buildAffinityMemory(state, [player], 'a.png'), /尚待兑现的约定/);
});

for (const knownToCharacter of ['no', 'unknown']) {
    for (const kind of ['fact', 'promise', 'attitude']) {
        test(`${kind} evidence marked ${knownToCharacter} stays stored without leaking into character memory`, () => {
            const source = ref(0, '玩家秘密把钥匙藏在树下，尚未告知甲。', { owner: kind === 'attitude' ? 'a.png' : 'player' });
            const item = kind === 'promise'
                ? promise(source, { actor: 'user', recipient: 'character', knownToCharacter })
                : proposal(source, { kind, actor: kind === 'attitude' ? 'character' : 'user', recipient: 'character', knownToCharacter });
            const state = apply(fresh(), [item], [source]);
            assert.equal(all(state).length, 1, 'unknown facts are retained for possible later grounded knowledge');
            assert.equal(affinityScores(state)['a.png'], 0);
            assert.equal(buildAffinityMemory(state, [source], 'a.png'), '');
        });
    }
}

test('unknown evidence cannot crowd a known fact out of the five injected memories', () => {
    const refs = Array.from({ length: 7 }, (_, index) => ref(index, `消息原文 ${index}。`, { owner: 'player' }));
    const known = proposal(refs[0], { actor: 'user', recipient: 'character', fact: '甲已知的老约定之外的一项事实。' });
    const hidden = refs.slice(1).map(source => proposal(source, { actor: 'user', recipient: 'character',
        knownToCharacter: 'no', fact: `甲未知的秘密 ${source.index}。` }));
    const state = apply(fresh(), [known, ...hidden], refs);
    const memory = buildAffinityMemory(state, refs, 'a.png');
    assert.match(memory, /甲已知的老约定之外的一项事实/);
    assert.doesNotMatch(memory, /甲未知的秘密/);
    assert.equal(all(state).length, 7);
});

test('memory stays owner-local, prioritizes open promises, hides score mechanics, and requires corroboration for a weak tendency', () => {
    const promised = ref(0, '甲说：“我会还书。”');
    const first = ref(1, '甲说：“我信任你。”');
    const second = ref(2, '甲说：“我愿意继续相信你。”');
    const other = ref(3, '乙说：“这件事我记住了。”', { owner: 'b.png' });
    const refs = [promised, first, second, other];
    let state = apply(fresh(), [promise(promised), attitude(first), proposal(other, { owner: 'b.png', fact: '乙独有的经历。' })], refs);
    let memory = buildAffinityMemory(state, refs, 'a.png');
    assert.match(memory, /尚待兑现的约定/);
    assert.equal(memory.includes('乙独有'), false);
    assert.equal(memory.includes('可略显信任'), false);
    state = apply(state, [attitude(second, { fact: '甲再次明确表达信任。' })], refs);
    memory = buildAffinityMemory(state, refs, 'a.png');
    assert.match(memory, /可略显信任/);
    assert.match(memory, /个人边界/);
    assert.doesNotMatch(memory, /[-+]?\d|分数|好感值|minor|major|a\.png|aff:/);
    assert.equal(buildAffinityMemory(fresh(), refs, 'a.png'), '');
    assert.equal(buildAffinityMemory(state, refs, 'not-current.png'), '');
    const many = Array.from({ length: 10 }, (_, index) => ref(index + 10, `雨夜的不同经历 ${index}。`));
    state = apply(state, many.map((source, index) => proposal(source, { fact: `雨夜已知经历${String.fromCharCode(0x7532 + index)}。` })), [...refs, ...many]);
    memory = buildAffinityMemory(state, [...refs, ...many], 'a.png');
    assert.equal(memory.split('\n').filter(line => line.startsWith('· ')).length, 5);
    assert.match(memory.split('\n')[1], /尚待兑现的约定/);
});


test('positive gains diminish at high scores without diminishing negative consequences', () => {
    const refs = Array.from({ length: 26 }, (_, index) => ref(index, `明确态度 ${index}`));
    let state = fresh();
    state = apply(state, refs.slice(0, 24).map(source => attitude(source)), refs);
    assert.equal(affinityScores(state)['a.png'], 48);
    state = apply(state, [attitude(refs[24])], refs);
    assert.equal(affinityScores(state)['a.png'], 50);
    state = apply(state, [attitude(refs[25])], refs);
    assert.equal(affinityScores(state)['a.png'], 51);
    assert.equal(affinityScores(apply(state, [attitude(ref(50, '另有不知情的态度'), { knownToCharacter: 'no' })], [...refs, ref(50, '另有不知情的态度')]))['a.png'], 51);
    const majors = Array.from({ length: 20 }, (_, index) => ref(index + 30, `明确重大态度 ${index}`));
    for (const source of majors) state = apply(state, [attitude(source, { impact: 'major' })], [...refs, ...majors], { verified: new Set([candidateKey(attitude(source, { impact: 'major' }), [...refs, ...majors])]) });
    assert.equal(affinityScores(state)['a.png'], 81, 'major gains are +2 in 50..79 and stop at 80');
    const negative = ref(100, '我不能再相信你了。');
    state = apply(state, [attitude(negative, { valence: 'negative' })], [...refs, ...majors, negative]);
    assert.equal(affinityScores(state)['a.png'], 78);
    // Negative gains are never diminished: 81 - 3 = 78, then a verified major -8 gives 70.
    const bigNegative = ref(101, '我永远无法原谅这次伤害。');
    assert.equal(affinityScores(apply(state, [attitude(bigNegative, { valence: 'negative', impact: 'major' })], [...refs, ...majors, negative, bigNegative], { verified: new Set([candidateKey(attitude(bigNegative, { valence: 'negative', impact: 'major' }), [...refs, ...majors, negative, bigNegative])]) }))['a.png'], 70);
});


test('offline dependency graphs are frozen, validated and restored only with live owner evidence', () => {
    const promised = ref(0, '我答应周五之前还书。', { owner: 'player' });
    const result = ref(1, '书已经还了。', { owner: 'player' });
    const ack = ref(2, '甲说我看到了，你又值得信任了。');
    const refs = [promised, result, ack];
    const base = apply(fresh(), [promise(promised, { actor: 'user', recipient: 'character' })], refs);
    const completed = apply(base, [outcome(base.events[0], result, { acknowledgement: { slot: ack.slot, quote: ack.text } })], refs);
    assert.equal(affinityScores(completed)['a.png'], 2);
    const offline = reconcileAffinity(JSON.parse(JSON.stringify(completed)), [], []);
    assert.equal(all(offline).length, 2);
    assert.ok(all(offline).every(event => event.offline === true && event.delta === 0));
    assert.equal(affinityScores(offline)['a.png'], 0);
    assert.equal(buildAffinityMemory(offline, refs, 'a.png'), '');
    const waiting = reconcileAffinity(offline, [promised, result], owners);
    assert.equal(all(waiting).length, 2, 'returning roster alone cannot activate stored character speech');
    assert.equal(affinityScores(waiting)['a.png'], 0);
    const blocked = apply(waiting, [proposal(result, { actor: 'user' })], [promised, result]);
    assert.equal(all(blocked).length, 2, 'frozen owners cannot receive new evaluation records');
    const restored = reconcileAffinity(waiting, refs, owners);
    assert.equal(affinityScores(restored)['a.png'], 2);
    assert.ok(all(restored).every(event => !event.offline));
    assert.deepEqual(all(restored).map(event => event.id), all(completed).map(event => event.id));
    const unrelated = ref(3, '甲现在只说另一件事。');
    const missingAck = reconcileAffinity(waiting, [promised, result, unrelated], owners);
    assert.equal(all(missingAck).filter(event => event.kind === 'outcome').length, 0);
    assert.match(buildAffinityMemory(missingAck, [promised, result, unrelated], 'a.png'), /尚待兑现的约定/);
    for (const field of ['source', 'result', 'acknowledgement']) {
        const edited = refs.map(item => item.slot === completed.events[1][field].slot ? { ...item, fingerprint: 'edited' } : item);
        const revoked = reconcileAffinity(offline, edited, []);
        assert.equal(all(revoked).some(event => event.kind === 'outcome'), false, `${field} edit still revokes an offline outcome`);
        const deleted = reconcileAffinity(offline, refs.filter(item => item.slot !== completed.events[1][field].slot), [], { retainOffline: false });
        assert.equal(all(deleted).some(event => event.kind === 'outcome'), false, `${field} physical deletion revokes an offline outcome`);
    }
    for (const field of ['source', 'result', 'acknowledgement']) {
        const corrupt = structuredClone(completed);
        delete corrupt.events[1][field].fingerprint;
        assert.equal(all(reconcileAffinity(corrupt, [], [])).some(event => event.kind === 'outcome'), false, `incomplete stored ${field} cannot bypass graph validation`);
    }
    const orphan = { ...completed, events: completed.events.filter(event => event.kind === 'outcome') };
    assert.equal(all(reconcileAffinity(orphan, [], [])).length, 0, 'an unavailable anchor cannot validate a completion');
});

test('offline retention never trusts changed slots, unrelated owner speech or invented metadata as live evidence', () => {
    const source = ref(0, '甲明确说我信任你。');
    const state = apply(fresh(), [attitude(source)], [source]);
    const frozen = reconcileAffinity(state, [], []);
    const unrelated = ref(1, '甲说另一件事情。');
    assert.equal(all(reconcileAffinity(frozen, [unrelated], owners)).length, 0);
    for (const refs of [[{ ...source, swipe: 1 }], [{ ...source, text: '已编辑' }], [source, { ...source }], [source, { ...source, index: -1 }], [{ ...source, index: -1 }]]) {
        assert.equal(all(reconcileAffinity(frozen, refs, [])).length, 0);
    }
    const invented = structuredClone(state);
    invented.events[0].owner = 'never-existed.png';
    const retained = reconcileAffinity(invented, [], []);
    assert.equal(affinityScores(retained)['never-existed.png'], 0);
    assert.equal(buildAffinityMemory(retained, [], 'never-existed.png'), '');
    assert.equal(buildAffinityMemory(retained, [source], 'never-existed.png'), '');
    assert.equal(all(reconcileAffinity(retained, [unrelated], [{ id: 'never-existed.png' }])).every(event => event.delta === 0), true);
});

test('a scored outcome cannot be amplified, cleared or duplicated by later descriptions', () => {
    const source = ref(0, '我答应归还。', { owner: 'player' });
    const result = ref(1, '已经归还。', { owner: 'player' });
    const ack = ref(2, '甲说我看见了，又能信任你了。');
    const refs = [source, result, ack];
    const base = apply(fresh(), [promise(source, { actor: 'user', recipient: 'character' })], refs);
    const item = outcome(base.events[0], result, { acknowledgement: { slot: ack.slot, quote: ack.text } });
    const scored = apply(base, [item], refs);
    for (const fields of [{ impact: 'major' }, { valence: 'negative' }, { fact: '重述同一结果。' }]) {
        const changed = { ...item, ...fields };
        const after = apply(scored, [changed], refs, { verified: new Set([candidateKey(changed, refs)]) });
        assert.deepEqual(after, scored);
    }
    const withoutAck = { ...item, valence: 'none' }; delete withoutAck.acknowledgement;
    assert.deepEqual(apply(scored, [withoutAck], refs), scored, 'redescription cannot erase acknowledgement or overwrite its positive score');
    const silent = apply(base, [{ ...withoutAck, impact: 'major' }], refs);
    const major = { ...item, impact: 'major' };
    const unverified = apply(silent, [major], refs);
    assert.equal(affinityScores(unverified)['a.png'], 0);
    assert.ok(unverified.events.find(event => event.kind === 'outcome').acknowledgement);
    assert.equal(affinityScores(apply(unverified, [item], refs))['a.png'], 0, 'an unverified major cannot be restated as minor points');
    const upgraded = apply(silent, [major], refs, { verified: new Set([candidateKey(major, refs)]) });
    assert.equal(affinityScores(upgraded)['a.png'], 5);
    assert.equal(all(upgraded).filter(event => event.kind === 'outcome').length, 1);
    assert.equal(upgraded.events.find(event => event.kind === 'outcome').id, silent.events.find(event => event.kind === 'outcome').id);
});

test('neutral and positive descriptions of one attitude score once in either order', () => {
    const source = ref(0, '甲明确表示信任玩家。');
    const positive = attitude(source);
    const neutral = { ...positive, valence: 'none' };
    for (const items of [[neutral, positive], [positive, neutral]]) {
        const batch = apply(fresh(), items, [source]);
        assert.equal(affinityScores(batch)['a.png'], 2);
        assert.equal(all(batch).length, 1);
        let sequential = apply(fresh(), [items[0]], [source]);
        const id = sequential.events[0].id;
        sequential = apply(sequential, [items[1]], [source]);
        assert.equal(affinityScores(sequential)['a.png'], 2);
        assert.equal(sequential.events[0].id, id);
        assert.equal(sequential.nextId, 2);
    }
});

test('verification keys bind every semantic field and canonicalize JSON property order', () => {
    const source = ref(0, '甲明确表示重大信任。');
    const item = attitude(source, { impact: 'major' });
    const key = candidateKey(item, [source]);
    for (const fields of [{ valence: 'negative' }, { impact: 'minor' }, { actor: 'user' }, { recipient: 'other' }, { fact: '另一个提议。' }]) {
        assert.notEqual(candidateKey({ ...item, ...fields }, [source]), key);
    }
    const reordered = Object.fromEntries(Object.entries(item).reverse());
    reordered.source = { quote: source.text, slot: source.slot };
    assert.equal(candidateKey(reordered, [source]), key);
    assert.equal(candidateKey({ ...item, source: { slot: 'unknown', quote: source.text } }, [source]), '');
});

test('positive minor crosses from 49 to 51 before subsequent gains diminish', () => {
    const refs = Array.from({ length: 29 }, (_, index) => ref(index, `独立明确态度${index}。`));
    let state = fresh();
    for (const source of refs.slice(0, 24)) state = apply(state, [attitude(source)], refs);
    assert.equal(affinityScores(state)['a.png'], 48);
    state = apply(state, [attitude(refs[24], { valence: 'negative' })], refs);
    assert.equal(affinityScores(state)['a.png'], 45);
    state = apply(state, [attitude(refs[25])], refs);
    assert.equal(affinityScores(state)['a.png'], 47);
    state = apply(state, [attitude(refs[26])], refs);
    assert.equal(affinityScores(state)['a.png'], 49);
    state = apply(state, [attitude(refs[27])], refs);
    assert.equal(affinityScores(state)['a.png'], 51);
    state = apply(state, [attitude(refs[28])], refs);
    assert.equal(affinityScores(state)['a.png'], 52);
});

test('stored deltas are the actual rolling contributions at 50 and 80 after JSON reload', () => {
    const refs = Array.from({ length: 60 }, (_, index) => ref(index, `甲明确表达独立信任${index}。`));
    let state = fresh();
    for (const source of refs) state = apply(state, [attitude(source)], refs);
    assert.equal(affinityScores(state)['a.png'], 80);
    const deltas = all(state).sort((a, b) => a.source.index - b.source.index).map(event => event.delta);
    assert.deepEqual(deltas, [...Array(25).fill(2), ...Array(30).fill(1), ...Array(5).fill(0)]);
    assert.equal(deltas.reduce((sum, delta) => sum + delta, 0), affinityScores(state)['a.png']);
    const reloaded = reconcileAffinity(JSON.parse(JSON.stringify(state)), refs, owners);
    assert.deepEqual(reloaded, state);
    assert.deepEqual(affinityScores(reloaded), affinityScores(state));
});

test('stored negative deltas include only the remaining score before the lower bound', () => {
    const refs = Array.from({ length: 15 }, (_, index) => ref(index, `甲明确表达重大不信任${index}。`));
    const items = refs.map(source => attitude(source, { impact: 'major', valence: 'negative' }));
    const state = apply(fresh(), items, refs, { verified: new Set(items.map(item => candidateKey(item, refs))) });
    assert.equal(affinityScores(state)['a.png'], -100);
    assert.deepEqual(all(state).map(event => event.delta), [...Array(12).fill(-8), -4, 0, 0]);
    assert.equal(all(state).reduce((sum, event) => sum + event.delta, 0), -100);
});

test('malformed records fail closed and a character-named owner still records player promises with a user actor', () => {
    const source = ref(0, '甲说我信任你。');
    const base = apply(fresh(), [attitude(source)], [source]);
    for (const fields of [{ owner: '__proto__' }, { owner: 'constructor' }, { owner: ' a.png' }, { owner: 'player' }, { extra: true }, { source: { ...base.events[0].source, extra: true } }]) {
        assert.equal(all(reconcileAffinity({ ...base, events: [{ ...base.events[0], ...fields }] }, [], [])).length, 0);
    }
    const cyclic = {}; cyclic.self = cyclic;
    assert.doesNotThrow(() => apply(base, [cyclic, null], [null, {}, source]));
    assert.doesNotThrow(() => buildAffinityMemory(base, [null, {}, source], 'a.png'));
    assert.doesNotThrow(() => buildAffinityMemory({ ...base, events: [null, {}, [], ...base.events] }, [source], 'a.png'));
    assert.equal(Object.prototype.polluted, undefined);
    const user = ref(1, '我答应把书归还给你。', { owner: 'player' });
    const state = applyAffinityEvaluation(fresh(), [promise(user, { owner: 'character', actor: 'user', recipient: 'character' })], [user], [{ id: 'character' }]);
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].owner, 'character');
    assert.equal(state.events[0].actor, 'user');
    assert.equal(affinityScores(state).character, 0);
});

const sharedAcknowledgement = (fields = {}) => {
    const source = ref(0, '玩家答应归还借来的书。', { owner: 'player' });
    const result = ref(1, '玩家已经归还借来的书。', { owner: 'player' });
    const ack = ref(2, '甲说：“这次履约使我改变了对你的信任。”');
    const refs = [source, result, ack];
    const base = apply(fresh(), [promise(source, { actor: 'user', recipient: 'character' })], refs);
    const completed = outcome(base.events[0], result, { ...fields, acknowledgement: { slot: ack.slot, quote: ack.text } });
    const stated = attitude(ack, fields);
    return { base, completed, stated, refs, result, ack };
};

for (const [valence, impact, expected] of [
    ['positive', 'minor', 2], ['negative', 'minor', -3], ['positive', 'major', 5], ['negative', 'major', -8],
]) {
    for (const firstKind of ['outcome', 'attitude']) {
        for (const mode of ['batch', 'sequential', 'stored migration']) {
            test(`${mode}: ${firstKind} and ${valence} ${impact} evidence share one physical scoring quote`, () => {
                const { base, completed, stated, refs } = sharedAcknowledgement({ valence, impact });
                const items = firstKind === 'outcome' ? [completed, stated] : [stated, completed];
                const options = { verified: new Set(items.map(item => candidateKey(item, refs))) };
                let state;
                if (mode === 'batch') state = apply(base, items, refs, options);
                else if (mode === 'sequential') state = apply(apply(base, [items[0]], refs, options), [items[1]], refs, options);
                else {
                    const independent = items.map((item, index) => {
                        const record = all(apply(base, [item], refs, options)).find(event => event.kind !== 'promise');
                        return { ...record, id: `chat-scope:e:${index + 2}` };
                    });
                    state = reconcileAffinity({ ...base, nextId: 4, events: [independent[1]], archives: [...base.events, independent[0]] }, refs, owners);
                }
                assert.equal(all(state).length, 3, 'retain both grounded descriptions and the closed promise');
                assert.equal(affinityScores(state)['a.png'], expected, 'one literal attitude must contribute only once');
                assert.equal(all(state).filter(event => event.delta !== 0).length, 1);
                assert.doesNotMatch(buildAffinityMemory(state, refs, 'a.png'), /可略显信任|可略留戒心/, 'aliases are not independent corroboration');
                const reloaded = reconcileAffinity(JSON.parse(JSON.stringify(state)), refs, owners);
                assert.equal(affinityScores(reloaded)['a.png'], expected);
                assert.deepEqual(reloaded, state);
            });
        }
    }
}

test('the first host scoring quote keeps its direction and magnitude across description kinds', () => {
    const { base, completed, stated, refs } = sharedAcknowledgement();
    const negative = { ...stated, valence: 'negative', impact: 'major' };
    const options = { verified: new Set([candidateKey(negative, refs)]) };
    assert.equal(affinityScores(apply(base, [negative, completed], refs, options))['a.png'], -8);
    assert.equal(affinityScores(apply(base, [completed, negative], refs, options))['a.png'], 2);
    const unverifiedFirst = apply(base, [{ ...completed, impact: 'major' }, stated], refs);
    assert.equal(affinityScores(unverifiedFirst)['a.png'], 0, 'an unverified major cannot become minor points through an attitude alias');
    assert.doesNotMatch(buildAffinityMemory(unverifiedFirst, refs, 'a.png'), /可略显信任|可略留戒心/);
});

test('removing the first scoring dependency allows the retained independent description to be projected again', () => {
    const { base, completed, stated, refs, result } = sharedAcknowledgement();
    const state = apply(base, [completed, stated], refs);
    assert.equal(affinityScores(state)['a.png'], 2);
    const remainingRefs = refs.filter(item => item.slot !== result.slot);
    const revoked = reconcileAffinity(JSON.parse(JSON.stringify(state)), remainingRefs, owners);
    assert.equal(all(revoked).filter(event => event.kind === 'outcome').length, 0);
    assert.equal(affinityScores(revoked)['a.png'], 2, 'deduplication must not permanently rewrite eligible evidence to neutral');
    assert.equal(all(revoked).find(event => event.kind === 'attitude').delta, 2);
});

test('non-overlapping scoring quotes remain independent across attitude and outcome descriptions', () => {
    const { base, completed, refs, ack } = sharedAcknowledgement();
    const text = '甲说：“这次履约让我更信任你。”随后又说：“你刚才的坦诚也让我更愿意相信你。”';
    const liveAck = { ...ack, text };
    const liveRefs = [...refs.slice(0, -1), liveAck];
    const result = apply(base, [
        { ...completed, acknowledgement: { slot: liveAck.slot, quote: '这次履约让我更信任你。' } },
        attitude(liveAck, { source: { slot: liveAck.slot, quote: '你刚才的坦诚也让我更愿意相信你。' }, fact: '甲对另一次坦诚明确表达信任。' }),
    ], liveRefs);
    assert.equal(affinityScores(result)['a.png'], 4);
    assert.match(buildAffinityMemory(result, liveRefs, 'a.png'), /可略显信任/);
});

for (const mode of ['batch', 'sequential', 'stored migration']) {
    test(`${mode}: two promise anchors sharing one result and acknowledgement both close without duplicate rewards`, () => {
        const sources = [ref(0, '我答应把书还给甲。', { owner: 'player' }), ref(1, '我再次答应把那本书还给甲。', { owner: 'player' })];
        const result = ref(2, '玩家归还了那本书。', { owner: 'player' });
        const ack = ref(3, '甲说：“我看见你还书了，这使我更信任你。”');
        const refs = [...sources, result, ack];
        const base = apply(fresh(), sources.map(source => promise(source, { actor: 'user', recipient: 'character' })), refs);
        const items = base.events.map(anchor => outcome(anchor, result, { acknowledgement: { slot: ack.slot, quote: ack.text } }));
        let state;
        if (mode === 'batch') state = apply(base, items, refs);
        else if (mode === 'sequential') state = apply(apply(base, [items[0]], refs), [items[1]], refs);
        else {
            const independent = items.map((item, index) => ({ ...all(apply(base, [item], refs)).find(event => event.kind === 'outcome'), id: `chat-scope:e:${index + 3}` }));
            state = reconcileAffinity({ ...base, nextId: 5, events: [...base.events, ...independent] }, refs, owners);
        }
        assert.equal(all(state).filter(event => event.kind === 'outcome').length, 2, 'both dependencies must close');
        assert.equal(affinityScores(state)['a.png'], 2);
        assert.doesNotMatch(buildAffinityMemory(state, refs, 'a.png'), /尚待兑现的约定|可略显信任/);
        assert.equal(affinityScores(reconcileAffinity(JSON.parse(JSON.stringify(state)), refs, owners))['a.png'], 2);
    });
}

for (const mode of ['apply', 'stored migration']) {
    test(`${mode}: the first neutral attitude keeps its full canonical source when a narrow alias first gains points`, () => {
        const source = ref(0, '我相信你。你这次的坦诚让我更信任你了。');
        const refs = [source];
        const base = apply(fresh(), [attitude(source, { valence: 'none' })], refs);
        const narrow = attitude(source, { source: { slot: source.slot, quote: '我相信你。' } });
        let enriched;
        if (mode === 'apply') enriched = apply(base, [narrow], refs);
        else {
            const alias = { ...all(apply(fresh(), [narrow], refs))[0], id: 'chat-scope:e:2' };
            enriched = reconcileAffinity({ ...base, nextId: 3, events: [alias], archives: base.events }, refs, owners);
        }
        assert.deepEqual(all(enriched)[0].source, base.events[0].source);
        const repeated = apply(enriched, [attitude(source, { source: { slot: source.slot, quote: '你这次的坦诚让我更信任你了。' } })], refs);
        assert.equal(all(repeated).length, 1);
        assert.equal(affinityScores(repeated)['a.png'], 2);
        assert.deepEqual(reconcileAffinity(JSON.parse(JSON.stringify(repeated)), refs, owners), repeated);
    });
}

const sharedPhysicalResult = (fields = {}) => {
    const sources = [ref(0, '我答应归还这本书。', { owner: 'player' }), ref(1, '我再次答应归还那本书。', { owner: 'player' })];
    const result = ref(2, '玩家已经归还那本书。', { owner: 'player' });
    const acknowledgements = [ref(3, '甲说：“我看见你还书了，我改变了对你的信任。”'), ref(4, '甲又说：“对于这一次还书，我仍是刚才的态度。”')];
    const refs = [...sources, result, ...acknowledgements];
    const base = apply(fresh(), sources.map(source => promise(source, { actor: 'user', recipient: 'character' })), refs);
    const items = base.events.map((anchor, index) => outcome(anchor, result, {
        ...fields, acknowledgement: { slot: acknowledgements[index].slot, quote: acknowledgements[index].text },
    }));
    return { base, items, refs, acknowledgements };
};

for (const [valence, expected] of [['positive', 2], ['negative', -3]]) {
    for (const mode of ['batch', 'sequential', 'stored migration']) {
        test(`${mode}: ${valence} completions sharing one physical result and distinct acknowledgements score once`, () => {
            const { base, items, refs } = sharedPhysicalResult({ valence });
            let state;
            if (mode === 'batch') state = apply(base, items, refs);
            else if (mode === 'sequential') state = apply(apply(base, [items[0]], refs), [items[1]], refs);
            else {
                const independent = items.map((item, index) => ({ ...all(apply(base, [item], refs)).find(event => event.kind === 'outcome'), id: `chat-scope:e:${index + 3}` }));
                state = reconcileAffinity({ ...base, nextId: 5, events: [independent[1]], archives: [...base.events, independent[0]] }, refs, owners);
            }
            assert.equal(all(state).filter(event => event.kind === 'outcome').length, 2);
            assert.equal(affinityScores(state)['a.png'], expected);
            assert.equal(all(state).filter(event => event.delta !== 0).length, 1);
            assert.doesNotMatch(buildAffinityMemory(state, refs, 'a.png'), /尚待兑现的约定|可略显信任|可略留戒心/);
            assert.deepEqual(reconcileAffinity(JSON.parse(JSON.stringify(state)), refs, owners), state);
        });
    }
}

for (const attitudeFirst of [false, true]) {
    test(`shared-result aliases also reserve their distinct acknowledgement against attitude reuse, attitude first=${attitudeFirst}`, () => {
        const { base, items, refs, acknowledgements } = sharedPhysicalResult();
        const stated = attitude(acknowledgements[1], { valence: 'negative' });
        const initial = attitudeFirst ? [stated, items[0]] : [items[0], stated];
        let state = apply(base, initial, refs);
        state = apply(state, [items[1]], refs);
        assert.equal(all(state).filter(event => event.kind === 'outcome').length, 2, 'scoring aliases still close their own anchors');
        assert.equal(affinityScores(state)['a.png'], attitudeFirst ? -3 : 2, 'the earliest retained host ID owns the whole connected physical event');
        assert.equal(all(state).filter(event => event.delta !== 0).length, 1);
        assert.doesNotMatch(buildAffinityMemory(state, refs, 'a.png'), /尚待兑现的约定|可略显信任|可略留戒心/);
        assert.deepEqual(reconcileAffinity(JSON.parse(JSON.stringify(state)), refs, owners), state);
    });
}

test('an unverified major cannot gain minor points through another promise and acknowledgement for the same result', () => {
    const { base, items, refs, acknowledgements } = sharedPhysicalResult();
    let state = apply(base, [{ ...items[0], impact: 'major' }], refs);
    state = apply(state, [items[1], attitude(acknowledgements[1])], refs);
    assert.equal(all(state).filter(event => event.kind === 'outcome').length, 2);
    assert.equal(affinityScores(state)['a.png'], 0);
    assert.doesNotMatch(buildAffinityMemory(state, refs, 'a.png'), /可略显信任|可略留戒心/);
    assert.deepEqual(reconcileAffinity(JSON.parse(JSON.stringify(state)), refs, owners), state);
});

test('different non-overlapping results and acknowledgements in shared messages remain independent completions', () => {
    const sources = [ref(0, '我答应还书。', { owner: 'player' }), ref(1, '我答应修钟。', { owner: 'player' })];
    const result = ref(2, '玩家归还了书。随后玩家修好了钟。', { owner: 'player' });
    const ack = ref(3, '甲说：“还书让我更信任你。”又说：“修钟也让我更愿意相信你。”');
    const refs = [...sources, result, ack];
    const base = apply(fresh(), sources.map(source => promise(source, { actor: 'user', recipient: 'character' })), refs);
    const resultQuotes = ['玩家归还了书。', '玩家修好了钟。'];
    const ackQuotes = ['还书让我更信任你。', '修钟也让我更愿意相信你。'];
    const state = apply(base, base.events.map((anchor, index) => outcome(anchor, { ...result, text: resultQuotes[index] }, {
        fact: `甲确认独立履约${index}并明确增加信任。`, acknowledgement: { slot: ack.slot, quote: ackQuotes[index] },
    })), refs);
    assert.equal(affinityScores(state)['a.png'], 4);
    assert.equal(all(state).filter(event => event.delta !== 0).length, 2);
    assert.match(buildAffinityMemory(state, refs, 'a.png'), /可略显信任/);
    assert.deepEqual(reconcileAffinity(JSON.parse(JSON.stringify(state)), refs, owners), state);
});

test('different owners may each acknowledge one shared physical player action without sharing score ownership', () => {
    const source = ref(0, '我答应把共同借阅的书还给你们。', { owner: 'player' });
    const result = ref(1, '玩家归还了那本共同借阅的书。', { owner: 'player' });
    const acknowledgements = [ref(2, '甲说：“我看见了，更信任你了。”'), ref(3, '乙说：“我也看见了，更信任你了。”', { owner: 'b.png' })];
    const refs = [source, result, ...acknowledgements];
    const base = apply(fresh(), owners.map(owner => promise(source, { owner: owner.id, actor: 'user', recipient: 'character' })), refs);
    const state = apply(base, base.events.map((anchor, index) => outcome(anchor, result, {
        acknowledgement: { slot: acknowledgements[index].slot, quote: acknowledgements[index].text },
    })), refs);
    assert.deepEqual(affinityScores(state), { 'a.png': 2, 'b.png': 2 });
    const absentOwner = reconcileAffinity(state, refs, [owners[0]]);
    assert.deepEqual(affinityScores(absentOwner), { 'a.png': 2, 'b.png': 0 });
    assert.deepEqual(reconcileAffinity(absentOwner, refs, owners), state);
});
