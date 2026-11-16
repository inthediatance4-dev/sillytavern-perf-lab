import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createAffinityState, applyAffinityEvaluation, reconcileAffinity, candidateKey, affinityScores,
} from '../public/scripts/extensions/affinity/affinity-state.js';

const owners = [{ id: 'a.png' }, { id: 'b.png' }];
const ref = (index, text, owner = 'player') => ({ slot: `slot-${index}`, index, text, owner, swipe: 0, fingerprint: `fp-${index}` });
const proposal = (source, quote = source.text, fields = {}) => ({
    owner: 'a.png', kind: 'fact', fact: '玩家说明了搬运旧纸张时的注意事项。', actor: 'user', recipient: 'character',
    status: 'observed', valence: 'none', impact: 'minor', confidence: 'high', attitudeExplicit: false,
    outcomeKnown: null, knownToCharacter: 'yes', relationshipChanged: false, thread: '档案整理',
    source: { slot: source.slot, quote }, ...fields,
});
const fresh = () => createAffinityState('quote-scope');
const apply = (items, refs, state = fresh()) => applyAffinityEvaluation(state, items, refs, owners);

test('real omitted introduction/prefix quotes bind to exact source spans and survive reload', () => {
    for (const [text, quote, matched] of [
        ['我叫阿澈，是新来的档案馆助理，我对旧纸张过敏，所以搬纸箱时得戴口罩。',
            '我是新来的档案馆助理，我对旧纸张过敏，所以搬纸箱时得戴口罩。',
            '是新来的档案馆助理，我对旧纸张过敏，所以搬纸箱时得戴口罩'],
        ['现在，我对旧纸张过敏，所以搬纸箱时得戴口罩。',
            '我对旧纸张过敏，所以搬纸箱时得戴口罩。', '我对旧纸张过敏，所以搬纸箱时得戴口罩。'],
        ['现在，我对旧纸张过敏，所以搬纸箱时得戴口罩。',
            '“我对旧纸张过敏,所以搬纸箱时得戴口罩!”', '我对旧纸张过敏，所以搬纸箱时得戴口罩'],
        ['📜记录：“Ａｒｃｈｉｖｅ助理：我对旧纸张过敏，搬纸箱时得戴口罩。”',
            'Archive助理: 我对旧纸张过敏, 搬纸箱时得戴口罩!', 'Ａｒｃｈｉｖｅ助理：我对旧纸张过敏，搬纸箱时得戴口罩'],
    ]) {
        const source = ref(0, text);
        const item = proposal(source, quote);
        const state = apply([item], [source]);
        assert.equal(state.events.length, 1, quote);
        const bound = state.events[0].source;
        assert.equal(bound.quote, matched);
        assert.equal(bound.offset, text.indexOf(matched));
        assert.equal(text.slice(bound.offset, bound.offset + bound.quote.length), bound.quote);
        assert.equal(state.events[0].key, candidateKey(item, [source]));
        assert.equal(affinityScores(state)['a.png'], 0);
        assert.deepEqual(reconcileAffinity(JSON.parse(JSON.stringify(state)), [source], owners), state);
    }
});

test('partial tolerance needs 12 contiguous characters covering at least 80 percent', () => {
    const source = ref(0, '甲乙丙丁戊己庚辛壬癸子丑');
    assert.equal(apply([proposal(source, `${source.text}寅卯辰`)], [source]).events[0].source.quote, source.text);
    for (const quote of [
        `${source.text}寅卯辰巳`, // 12/16 is below 80%.
        '甲乙丙丁戊己庚辛壬癸子寅', // 11 contiguous characters are too few.
        '甲乙丙丁戊己寅庚辛壬癸子丑', // Cannot stitch two separate matching pieces.
        '我已经偷拍所有私人信件并把照片交给了陌生人。',
    ]) assert.equal(apply([proposal(source, quote)], [source]).events.length, 0, quote);
});

test('tolerance never borrows another slot, speaker or relationship owner', () => {
    const text = '我对旧纸张过敏，所以搬纸箱时得戴口罩。';
    const player = ref(0, text);
    const otherSlot = ref(1, '今天的档案已经全部整理完毕。');
    const character = ref(2, text, 'a.png');
    const refs = [player, otherSlot, character];
    const quote = '“我对旧纸张过敏,所以搬纸箱时得戴口罩!”';
    for (const item of [
        proposal(otherSlot, quote), proposal(otherSlot, text),
        proposal(player, quote, { actor: 'character' }),
        proposal(character, quote, { actor: 'user' }),
        proposal(character, quote, { actor: 'character', owner: 'b.png' }),
        proposal(player, quote, { owner: 'invented.png' }),
    ]) assert.equal(apply([item], refs).events.length, 0);
});

test('short/generic fragments and ambiguous exact, normalized or fuzzy spans are rejected', () => {
    for (const text of ['谢谢', '好的', '谢谢你。', '……', '我会处理好。']) {
        const source = ref(0, text);
        const quote = text === '我会处理好。' ? '我将处理好。' : text;
        assert.equal(apply([proposal(source, quote)], [source]).events.length, 0, quote);
    }
    const phrase = '我对旧纸张过敏，所以搬纸箱时得戴口罩。';
    const source = ref(0, `${phrase}稍后再次说道：${phrase}`);
    for (const quote of [phrase, phrase.replaceAll('，', ','), `啊${phrase}`]) {
        assert.equal(candidateKey(proposal(source, quote), [source]), '');
    }
    const item = proposal(source, phrase, { source: { slot: source.slot, quote: phrase, offset: source.text.lastIndexOf(phrase) } });
    assert.equal(apply([item], [source]).events[0].source.offset, source.text.lastIndexOf(phrase));
    const wrongOffset = { ...item, source: { ...item.source, offset: 1 } };
    assert.equal(apply([wrongOffset], [source]).events.length, 0, 'explicit offsets never relocate');
});

test('tolerant source and stored span sizes are bounded while long exact sources still bind', () => {
    const quote = '我对旧纸张过敏所以搬纸箱时得戴口罩';
    for (const text of [`${'前'.repeat(20001)}${quote}。`, [...quote].join('，'.repeat(15))]) {
        const source = ref(0, text);
        assert.equal(apply([proposal(source, `“${quote}!”`)], [source]).events.length, 0);
    }
    const source = ref(0, `${'前'.repeat(20001)}${quote}。`);
    assert.equal(apply([proposal(source, quote)], [source]).events.length, 1);
});

test('result and acknowledgement tolerance retains causal order and speaker checks', () => {
    const source = ref(0, '我答应明天把借来的档案资料完整归还给你。');
    const result = ref(1, '我已经把借来的档案资料完整地放回了你的书架。');
    const ack = ref(2, '我确认看到了归还的档案资料，现在对你更信任了。', 'a.png');
    const refs = [source, result, ack];
    const base = apply([proposal(source, source.text, { kind: 'promise', status: 'agreed' })], refs);
    const item = proposal(source, source.text, { kind: 'outcome', status: 'completed', outcomeKnown: true,
        valence: 'positive', relationshipChanged: true, anchorId: base.events[0].id,
        result: { slot: result.slot, quote: `“${result.text}”` },
        acknowledgement: { slot: ack.slot, quote: `“${ack.text}”` } });
    const state = apply([item], refs, base);
    const event = state.events.find(event => event.kind === 'outcome');
    assert.equal(affinityScores(state)['a.png'], 2);
    for (const key of ['result', 'acknowledgement']) {
        const text = refs.find(ref => ref.slot === event[key].slot).text;
        assert.equal(text.slice(event[key].offset, event[key].offset + event[key].quote.length), event[key].quote);
    }
    assert.equal(apply([item], [source, result, { ...ack, owner: 'b.png' }], base).events.length, 1);
    assert.equal(apply([item], [source, result, { ...ack, index: 0 }], base).events.length, 1);
});

test('stored exact spans cannot survive edits through fuzzy relocation', () => {
    const source = ref(0, '我叫阿澈，是新来的档案馆助理，我对旧纸张过敏，所以搬纸箱时得戴口罩。');
    const state = apply([proposal(source, '我是新来的档案馆助理，我对旧纸张过敏，所以搬纸箱时得戴口罩。')], [source]);
    assert.equal(state.events.length, 1);
    for (const changed of [
        { ...source, text: `移位${source.text}` },
        { ...source, text: source.text.replace('过敏', '严重过敏') },
        { ...source, fingerprint: 'changed' }, { ...source, swipe: 1 },
    ]) assert.equal(reconcileAffinity(state, [changed], owners).events.length, 0);
});
