import assert from 'node:assert/strict';
import test from 'node:test';
const api = await import('../public/scripts/plugin-runtime/literal-start.js').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
});
test('official empty chat receives one nonprompt anchor before a Director narrative', () => {
    const context = { chat: [], chatMetadata: {} };
    assert.equal(api.ensureLiteralStart(context, { inserting: true }), true);
    assert.equal(context.chat.length, 1);
    assert.equal(context.chat[0].mes, '');
    assert.equal(context.chat[0].is_system, true);
    context.chat.push({ mes: '{{roll 1d6}} {{char}}', extra: { director: { id: 'one' } } });
    assert.equal(api.ensureLiteralStart(context), false);
    assert.equal(context.chat[1].mes, '{{roll 1d6}} {{char}}');
});
test('normal greetings remain unchanged; only a first Director message is migrated', () => {
    const greeting = { mes: '{{char}}', extra: {} };
    const context = { chat: [greeting], chatMetadata: {} };
    assert.equal(api.ensureLiteralStart(context), false);
    assert.equal(context.chat[0], greeting);
});
test('legacy position references shift together without changing quote identity or raw body', () => {
    const first = { mes: '{{char}} literal', extra: { director: { id: 'one' } } };
    const evidence = { source: { index: 0, slot: 'stable', quote: '{{char}}' }, result: { index: 1 }, acknowledgement: { index: 2 } };
    const context = { chat: [first, { mes: 'reply' }], chatMetadata: {
        director: { boundInstruct: { slotIndex: 1, prevFingerprint: 'same' }, fate: {
            bound: { slotIndex: 1, batchEndIndex: 2 }, log: [{ slotIndex: 1 }] } },
        affinity: { __affinity: { events: [evidence], archives: [] } },
    } };
    assert.equal(api.ensureLiteralStart(context), true);
    assert.equal(context.chat[1], first);
    assert.equal(context.chatMetadata.director.boundInstruct.slotIndex, 2);
    assert.equal(context.chatMetadata.director.boundInstruct.prevFingerprint, 'same');
    assert.equal(context.chatMetadata.director.fate.bound.batchEndIndex, 3);
    assert.equal(evidence.source.index, 1);
    assert.equal(evidence.source.slot, 'stable');
    assert.equal(evidence.acknowledgement.index, 3);
    assert.equal(JSON.parse(JSON.stringify(context.chat))[1].mes, '{{char}} literal');
});
