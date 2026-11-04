import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from '../public/lib/eventemitter.js';
import { createFateController } from '../public/scripts/extensions/director/fate.js';
import { messageFingerprint } from '../public/scripts/extensions/director/instruct.js';

globalThis.localStorage = { getItem: () => null };

const eventTypes = Object.fromEntries([
    'CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED',
    'GENERATE_AFTER_DATA', 'GENERATION_COMPLETED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_DELETED',
].map(name => [name, name]));
const privateEvent = 'LOG_PRIVATE_EVENT: a messenger brings a sealed invitation.';
const anchor = () => ({ is_user: true, name: 'User', mes: 'What happens next?' });
const reply = generationId => ({ is_user: false, name: 'Bot', mes: 'A completed reply.', extra: { gen_id: generationId } });
const entry = (id = 'saved-card', overrides = {}) => ({
    id, category: 'echo', title: '尘封的低语', strength: 'medium', rarity: 'rare', event: privateEvent,
    slotIndex: 1, prevFingerprint: messageFingerprint(anchor()), generationId: 1,
    at: '2026-01-01T00:00:00.000Z', replays: 0, ...overrides,
});

function lab({ group = false, metadata = {} } = {}) {
    const eventSource = new EventEmitter();
    let context = {
        eventSource, eventTypes, chatId: 'chat-one', chatMetadata: metadata,
        groupId: group ? 'group-one' : null, characterId: group ? undefined : 0,
        chat: [anchor()], extensionPrompts: {},
        generateQuietPrompt: async () => JSON.stringify({ event: privateEvent }),
        saveMetadataDebounced() {},
    };
    let serial = 0;
    let generate = async () => {};
    let save = async () => true;
    const saves = [];
    const persisted = [];
    const errors = [];
    const controller = createFateController(() => context, {
        uuid: () => `log-${++serial}`, random: () => 0,
        generate: () => generate(), onError: value => errors.push(value),
        save: async (owner, shouldSave) => {
            saves.push(structuredClone(owner.chatMetadata.director.fate));
            if (await save() === false || !shouldSave()) return false;
            persisted.push(structuredClone(owner.chatMetadata.director.fate));
            return true;
        },
    });
    const emit = (name, ...args) => eventSource.emit(eventTypes[name], ...args);
    const api = {
        controller, metadata, emit, saves, persisted, errors,
        get context() { return context; },
        setGenerate(value) { generate = value; },
        setSave(value) { save = value; },
        switchChat() { context = { ...context, chatId: 'chat-two', chatMetadata: {}, chat: [anchor()] }; },
        async request(type = 'normal') {
            await emit('GENERATION_STARTED', type, {}, false);
            const requestChat = context.chat.map(message => ({ ...message }));
            assert.equal(controller.prepare(type, requestChat), true);
            const data = { prompt: requestChat.find(message => message.extra?.directorFatePrompt).mes };
            await emit('GENERATE_AFTER_DATA', data, false);
            return { data, type, chatId: context.chatId, chatMetadata: context.chatMetadata };
        },
        async complete(request, { append = true, generationId = 1 } = {}) {
            if (append) context.chat.push(reply(generationId));
            else context.chat[context.chat.length - 1] = reply(generationId);
            await emit('MESSAGE_RECEIVED', context.chat.length - 1);
            await emit('GENERATION_ENDED');
            await emit('GENERATION_COMPLETED', request);
        },
        async adopt(generationId = 1) {
            await controller.draw();
            let request;
            generate = async () => { request = await api.request(); await api.complete(request, { generationId }); };
            assert.equal(await controller.apply(), true);
            return request;
        },
        async completeSwipe(request, { generationId = 1, swipeId = 0, append = false } = {}) {
            const message = reply(generationId);
            if (swipeId !== null) message.swipe_id = swipeId;
            if (append) context.chat.push(message);
            else context.chat[context.chat.length - 1] = message;
            await emit('MESSAGE_RECEIVED', context.chat.length - 1);
            await emit('GENERATION_ENDED');
            await emit('GENERATION_COMPLETED', request);
        },
        async adoptSwipe(swipeId = 0, generationId = 1) {
            await controller.draw();
            generate = async () => {
                const request = await api.request();
                await api.completeSwipe(request, { generationId, swipeId, append: true });
            };
            assert.equal(await controller.apply(), true);
        },
    };
    return api;
}

test('only COMPLETED appends the fully populated event in the single consumption save', async () => {
    const fixture = lab();
    const { controller } = fixture;
    assert.deepEqual(controller.log(), []);
    assert.equal(controller.view().logCount, 0);
    await controller.deal();
    assert.deepEqual(controller.log(), []);
    assert.equal(JSON.stringify(controller.view()).includes(privateEvent), false);
    await controller.pick(0, 'strong');
    const card = structuredClone(fixture.metadata.director.fate.held);
    assert.deepEqual(controller.log(), []);
    fixture.setGenerate(async () => {
        const request = await fixture.request();
        assert.deepEqual(controller.log(), []);
        fixture.context.chat.push(reply(123));
        await fixture.emit('MESSAGE_RECEIVED', 1);
        await fixture.emit('GENERATION_ENDED');
        assert.deepEqual(controller.log(), []);
        const before = fixture.saves.length;
        await fixture.emit('GENERATION_COMPLETED', request);
        assert.equal(fixture.saves.length, before + 1);
        // A duplicate completion has lost its request provenance.
        await fixture.emit('GENERATION_COMPLETED', request);
        assert.equal(fixture.saves.length, before + 1);
    });
    assert.equal(await controller.apply(), true);
    const stored = fixture.metadata.director.fate.log;
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0], { ...card, slotIndex: 1, prevFingerprint: messageFingerprint(anchor()),
        generationId: 123, at: stored[0].at, replays: 0 });
    assert.equal(new Date(stored[0].at).toISOString(), stored[0].at);
    assert.deepEqual(controller.log(), [{ ...stored[0], status: 'ok' }]);
    assert.equal(controller.view().logCount, 1);
    assert.equal(Object.hasOwn(controller.view(), 'log'), false);
    assert.deepEqual(fixture.persisted.at(-1).log, stored);
    const publicLog = controller.log();
    publicLog[0].event = 'Mutated by consumer';
    publicLog.push(entry('extra'));
    assert.equal(controller.log().length, 1);
    assert.equal(controller.log()[0].event, privateEvent);
});

for (const failure of ['stop', 'request failure', 'chat switch', 'metadata switch']) {
    test(`${failure} cannot append a log entry, even with a late completion`, async () => {
        const fixture = lab();
        await fixture.controller.draw();
        fixture.setGenerate(async () => {
            const request = await fixture.request();
            if (failure === 'request failure') throw new Error('Provider failed');
            if (failure === 'stop') await fixture.emit('GENERATION_STOPPED');
            if (failure === 'chat switch') { fixture.switchChat(); await fixture.emit('CHAT_CHANGED'); }
            if (failure === 'metadata switch') fixture.context.chatMetadata = {};
            await fixture.complete(request);
        });
        if (failure === 'request failure') await assert.rejects(fixture.controller.apply(), /采用失败/);
        else assert.equal(await fixture.controller.apply(), false);
        assert.deepEqual(fixture.controller.log(), []);
        assert.deepEqual(fixture.metadata.director.fate.log, []);
        assert.ok(fixture.metadata.director.fate.held);
    });
}

test('a provider completion arriving after a failed apply cannot consume or log its card', async () => {
    const fixture = lab();
    await fixture.controller.draw();
    const held = structuredClone(fixture.metadata.director.fate.held);
    let request;
    fixture.setGenerate(async () => {
        request = await fixture.request();
        throw new Error('Provider failed after request assembly');
    });
    await assert.rejects(fixture.controller.apply(), /采用失败/);
    const saves = fixture.saves.length;
    await fixture.complete(request);
    assert.equal(fixture.saves.length, saves);
    assert.deepEqual(fixture.metadata.director.fate.held, held);
    assert.deepEqual(fixture.controller.log(), []);
});

test('failed completion saves retain the consumed log in memory and retry it on the next generation', async () => {
    const fixture = lab();
    await fixture.controller.draw();
    fixture.setGenerate(async () => {
        const request = await fixture.request();
        fixture.setSave(async () => false);
        await fixture.complete(request);
    });
    assert.equal(await fixture.controller.apply(), true);
    assert.equal(fixture.controller.view().held, null);
    const completed = fixture.controller.log();
    assert.equal(completed.length, 1);
    assert.equal(completed[0].event, privateEvent);
    assert.equal(fixture.persisted.at(-1).log.length, 0);
    assert.equal(fixture.errors.length, 1);
    fixture.setSave(async () => true);
    const before = fixture.saves.length;
    await fixture.emit('GENERATION_STARTED', 'quiet', {}, false);
    assert.equal(fixture.saves.length, before + 1);
    assert.deepEqual(fixture.persisted.at(-1).log, fixture.metadata.director.fate.log);
    assert.deepEqual(fixture.controller.log(), completed);
    await fixture.emit('GENERATION_STARTED', 'quiet', {}, false);
    assert.equal(fixture.saves.length, before + 1);
});

test('swipe and regenerate update the same entry only when the binding changes', async () => {
    const fixture = lab();
    await fixture.adopt(1);
    const initial = fixture.controller.log()[0];
    for (const [type, generationId] of [['swipe', 2], ['regenerate', 3]]) {
        if (type === 'regenerate') fixture.context.chat.pop();
        const request = await fixture.request(type);
        const before = fixture.saves.length;
        await fixture.complete(request, { append: type === 'regenerate', generationId });
        assert.equal(fixture.saves.length, before + 1);
        const log = fixture.controller.log();
        assert.equal(log.length, 1);
        assert.deepEqual(log[0], { ...initial, generationId, replays: generationId - 1 });
    }
    const before = fixture.saves.length;
    const log = fixture.controller.log();
    await fixture.complete(await fixture.request('swipe'), { append: false, generationId: 3 });
    assert.equal(fixture.saves.length, before);
    assert.deepEqual(fixture.controller.log(), log);
    fixture.metadata.director.fate.log[0].replays = 999;
    await fixture.complete(await fixture.request('swipe'), { append: false, generationId: 4 });
    assert.equal(fixture.controller.log()[0].replays, 999);
});

test('replaying a legacy binding or a cleared log does not invent a past application', async () => {
    const fixture = lab();
    await fixture.adopt();
    await fixture.controller.clearLog();
    await fixture.complete(await fixture.request('swipe'), { append: false, generationId: 2 });
    assert.deepEqual(fixture.controller.log(), []);
});

test('the log keeps the newest 50 applications in descending application order', async () => {
    const fixture = lab();
    for (let index = 0; index < 52; index++) await fixture.adopt(index);
    const log = fixture.controller.log();
    assert.equal(log.length, 50);
    assert.equal(fixture.metadata.director.fate.log.length, 50);
    assert.deepEqual(log.map(value => value.generationId), Array.from({ length: 50 }, (_, index) => 51 - index));
    assert.equal(new Set(log.map(value => value.id)).size, 50);
});

test('readLog drops malformed entries individually and deduplicates valid ids keeping the first', () => {
    const first = entry('first');
    const second = entry('second', { strength: 'light', rarity: 'legendary' });
    const invalid = [
        null, false, 'bad', [], {},
        ...[
            { id: '' }, { id: 'x'.repeat(201) }, { title: 'unknown' }, { category: 'unknown', title: 'unknown' },
            { strength: 'invalid' }, { event: '' }, { event: 'x'.repeat(401) }, { event: 'bad\u0000event' },
            { slotIndex: -1 }, { slotIndex: 1.5 }, { slotIndex: '1' }, { prevFingerprint: 1 },
            { replays: -1 }, { replays: 1000 }, { replays: 0.5 }, { replays: '0' },
            { at: 'invalid' }, { at: null }, { generationId: {} }, { generationId: undefined },
        ].map((value, index) => entry(`invalid-${index}`, value)),
    ];
    const fixture = lab({ metadata: { director: { fate: { version: 1, log: [
        ...invalid, first, entry('first', { event: 'Later duplicate must be ignored' }), second,
    ] } } } });
    assert.deepEqual(fixture.controller.log(), [{ ...first, status: 'missing' }, { ...second, status: 'missing' }]);
    assert.equal(fixture.controller.view().logCount, 2);
    fixture.metadata.director.fate.log = { first };
    assert.deepEqual(fixture.controller.log(), []);
    fixture.metadata.director.fate = { version: 2, log: [first] };
    assert.deepEqual(fixture.controller.log(), []);
});

test('reading oversized stored logs retains at most the first 50 valid unique entries', () => {
    const fixture = lab({ metadata: { director: { fate: { version: 1,
        log: Array.from({ length: 60 }, (_, index) => entry(`card-${index}`)) } } } });
    assert.equal(fixture.controller.log().length, 50);
    assert.equal(fixture.controller.log().at(-1).id, 'card-49');
});

test('the entry stays ok after a next message clears the active binding', async () => {
    for (const name of ['MESSAGE_SENT', 'MESSAGE_RECEIVED']) {
        const fixture = lab();
        await fixture.adopt();
        fixture.context.chat.push({ is_user: name === 'MESSAGE_SENT', name: 'Next', mes: 'The story continues.' });
        await fixture.emit(name, 2);
        assert.equal(fixture.controller.view().bound, null);
        assert.equal(fixture.controller.log()[0].status, 'ok');
        assert.equal(fixture.controller.view().logCount, 1);
    }
});

test('a reloaded completed log survives with no active binding and causes no save', async () => {
    const fixture = lab();
    await fixture.adopt(42);
    fixture.context.chat.push({ is_user: true, name: 'User', mes: 'Continue.' });
    await fixture.emit('MESSAGE_SENT', 2);
    const expected = fixture.controller.log();
    const restored = lab({ metadata: structuredClone(fixture.metadata) });
    restored.context.chat = structuredClone(fixture.context.chat);
    assert.equal(restored.controller.view().bound, null);
    assert.deepEqual(restored.controller.log(), expected);
    assert.equal(restored.controller.log()[0].status, 'ok');
    assert.equal(restored.controller.view().logCount, 1);
    assert.equal(restored.saves.length, 0);
});

test('status uses only the target AI row and its preceding fingerprint', async () => {
    const fixture = lab();
    await fixture.adopt();
    const chat = fixture.context.chat;
    chat[0].mes = 'Edited anchor';
    assert.equal(fixture.controller.log()[0].status, 'changed');
    chat[0] = anchor();
    chat[1].mes = 'Edited AI content retains the mark';
    assert.equal(fixture.controller.log()[0].status, 'ok');
    chat[1].is_system = true;
    assert.equal(fixture.controller.log()[0].status, 'changed');
    chat[1] = { ...reply(1), is_user: true };
    assert.equal(fixture.controller.log()[0].status, 'changed');
    chat[1] = reply(1);
    chat.push(reply(2));
    chat.splice(0, 1);
    await fixture.emit('MESSAGE_DELETED');
    assert.equal(fixture.controller.log()[0].status, 'changed');
    chat.pop();
    await fixture.emit('MESSAGE_DELETED');
    assert.equal(fixture.controller.log()[0].status, 'missing');
});

test('a slot-zero entry uses the empty predecessor fingerprint and remains reviewable', () => {
    const first = entry('first-message', { slotIndex: 0, prevFingerprint: messageFingerprint(undefined) });
    const fixture = lab({ metadata: { director: { fate: { version: 1, log: [first] } } } });
    fixture.context.chat = [reply(1)];
    assert.deepEqual(fixture.controller.log(), [{ ...first, status: 'ok' }]);
    fixture.context.chat[0].is_user = true;
    assert.equal(fixture.controller.log()[0].status, 'changed');
    fixture.context.chat.pop();
    assert.equal(fixture.controller.log()[0].status, 'missing');
});

test('later members of the same group batch do not change or append log records', async () => {
    const fixture = lab({ group: true });
    await fixture.adopt(100);
    const before = structuredClone(fixture.metadata.director.fate.log);
    const saves = fixture.saves.length;
    fixture.context.chat.push(reply(100));
    await fixture.emit('MESSAGE_RECEIVED', 2);
    assert.deepEqual(fixture.metadata.director.fate.log, before);
    assert.equal(fixture.saves.length, saves);
    assert.equal(fixture.metadata.director.fate.bound.batchEndIndex, 2);
    assert.equal(fixture.controller.log()[0].slotIndex, 1);
});

test('discard, deal and pick preserve all completed entries', async () => {
    const fixture = lab();
    await fixture.adopt();
    const log = fixture.controller.log();
    await fixture.controller.deal();
    assert.deepEqual(fixture.controller.log(), log);
    await fixture.controller.pick(0, 'light');
    assert.deepEqual(fixture.controller.log(), log);
    await fixture.controller.discard();
    assert.deepEqual(fixture.controller.log(), log);
});

test('clearLog uses one save and preserves held, bound, offer, pity and recent', async () => {
    const fixture = lab();
    await fixture.adopt();
    await fixture.controller.draw();
    await fixture.controller.deal();
    const before = structuredClone(fixture.metadata.director.fate);
    const saves = fixture.saves.length;
    assert.equal(await fixture.controller.clearLog(), true);
    assert.equal(fixture.saves.length, saves + 1);
    assert.deepEqual(fixture.metadata.director.fate, { ...before, log: [] });
    assert.equal(fixture.controller.view().logCount, 0);
    assert.deepEqual(fixture.controller.log(), []);
});

for (const thrown of [false, true]) {
    test(`clearLog rolls back only its fate state when persistence ${thrown ? 'throws' : 'returns false'}`, async () => {
        const fixture = lab();
        await fixture.adopt();
        const before = fixture.metadata.director.fate;
        fixture.setSave(async () => {
            fixture.metadata.director.boundInstruct = { text: 'Concurrent instruction' };
            if (thrown) throw new Error('Save failed');
            return false;
        });
        await assert.rejects(fixture.controller.clearLog(), /保存失败/);
        assert.equal(fixture.metadata.director.fate, before);
        assert.equal(fixture.controller.log().length, 1);
        assert.equal(fixture.metadata.director.boundInstruct.text, 'Concurrent instruction');
    });
}

test('a swipe generated after the binding clears is changed until a recorded swipe is shown', async () => {
    const fixture = lab();
    await fixture.adoptSwipe(0, 1);
    const stored = fixture.metadata.director.fate.log[0];
    assert.deepEqual(stored.swipeIds, [0]);
    assert.equal(fixture.controller.log()[0].status, 'ok');
    const published = fixture.controller.log();
    published[0].swipeIds.push(9);
    assert.deepEqual(fixture.controller.log()[0].swipeIds, [0]);

    fixture.context.chat.push({ is_user: true, name: 'User', mes: 'Continue.' });
    await fixture.emit('MESSAGE_SENT', 2);
    assert.equal(fixture.controller.view().bound, null);
    assert.equal(fixture.controller.log()[0].status, 'ok');
    fixture.context.chat.pop();
    await fixture.emit('MESSAGE_DELETED', 1);
    assert.equal(fixture.context.chat.length, 2);
    assert.equal(fixture.controller.log()[0].status, 'ok');

    const requestChat = fixture.context.chat.map(message => ({ ...message }));
    assert.equal(fixture.controller.prepare('swipe', requestChat), false);
    assert.equal(requestChat.some(message => message.extra?.directorFatePrompt), false);
    fixture.context.chat[1].swipe_id = 1;
    assert.equal(fixture.controller.log()[0].status, 'changed');
    assert.deepEqual(fixture.metadata.director.fate.log[0].swipeIds, [0]);
    fixture.context.chat[1].swipe_id = 0;
    assert.equal(fixture.controller.log()[0].status, 'ok');
});

test('a replay adds the new swipe id, and an unchanged binding records it without counting a replay', async () => {
    const fixture = lab();
    await fixture.adoptSwipe(0, 1);
    const request = await fixture.request('swipe');
    const before = fixture.saves.length;
    await fixture.completeSwipe(request, { generationId: 2, swipeId: 1 });
    assert.equal(fixture.saves.length, before + 1);
    assert.equal(fixture.controller.log()[0].replays, 1);
    assert.deepEqual(fixture.controller.log()[0].swipeIds, [1, 0]);
    assert.equal(fixture.controller.log()[0].status, 'ok');
    fixture.context.chat[1].swipe_id = 0;
    assert.equal(fixture.controller.log()[0].status, 'ok');
    fixture.context.chat[1].swipe_id = 1;

    const repeat = await fixture.request('swipe');
    const saved = fixture.saves.length;
    await fixture.completeSwipe(repeat, { generationId: 2, swipeId: 1 });
    assert.equal(fixture.saves.length, saved);
    assert.equal(fixture.controller.log()[0].replays, 1);
    assert.deepEqual(fixture.controller.log()[0].swipeIds, [1, 0]);

    const extra = await fixture.request('swipe');
    await fixture.completeSwipe(extra, { generationId: 2, swipeId: 4 });
    assert.equal(fixture.controller.log()[0].replays, 1);
    assert.deepEqual(fixture.controller.log()[0].swipeIds, [4, 1, 0]);
    assert.equal(fixture.controller.log()[0].status, 'ok');
    fixture.context.chat[1].swipe_id = 2;
    assert.equal(fixture.controller.log()[0].status, 'changed');
});

test('recorded swipe ids keep the newest 32', async () => {
    const fixture = lab();
    await fixture.adoptSwipe(0, 1);
    for (let swipeId = 1; swipeId <= 33; swipeId++) {
        const request = await fixture.request('swipe');
        await fixture.completeSwipe(request, { generationId: swipeId + 1, swipeId });
    }
    const ids = fixture.controller.log()[0].swipeIds;
    assert.equal(ids.length, 32);
    assert.deepEqual(ids, Array.from({ length: 32 }, (_, index) => 33 - index));
    assert.equal(fixture.controller.log()[0].replays, 33);
    fixture.context.chat[1].swipe_id = 0;
    assert.equal(fixture.controller.log()[0].status, 'changed');
    fixture.context.chat[1].swipe_id = 2;
    assert.equal(fixture.controller.log()[0].status, 'ok');
});

test('legacy entries without swipe ids ignore the displayed swipe until a replay updates them', async () => {
    const fixture = lab();
    await fixture.adopt(1);
    assert.equal(Object.hasOwn(fixture.metadata.director.fate.log[0], 'swipeIds'), false);
    fixture.context.chat[1] = { ...reply(1), swipe_id: 3 };
    assert.equal(fixture.controller.log()[0].status, 'ok');
    const before = fixture.saves.length;
    await fixture.completeSwipe(await fixture.request('swipe'), { generationId: 1, swipeId: 4 });
    assert.equal(fixture.saves.length, before);
    assert.equal(fixture.controller.log()[0].replays, 0);
    assert.equal(Object.hasOwn(fixture.controller.log()[0], 'swipeIds'), false);
    assert.equal(fixture.controller.log()[0].status, 'ok');

    await fixture.completeSwipe(await fixture.request('swipe'), { generationId: 2, swipeId: 4 });
    assert.deepEqual(fixture.controller.log()[0].swipeIds, [4]);
    assert.equal(fixture.controller.log()[0].replays, 1);
    assert.equal(fixture.controller.log()[0].status, 'ok');
    fixture.context.chat[1].swipe_id = 0;
    assert.equal(fixture.controller.log()[0].status, 'changed');
    fixture.context.chat[1].swipe_id = 4;
    assert.equal(fixture.controller.log()[0].status, 'ok');
});

test('readLog drops an invalid swipeIds field and keeps the newest 32 ids', () => {
    const longIds = Array.from({ length: 40 }, (_, index) => index);
    const fixture = lab({ metadata: { director: { fate: { version: 1, log: [
        entry('bad-type', { swipeIds: 'nope' }),
        entry('bad-negative', { swipeIds: [1, -1] }),
        entry('bad-float', { swipeIds: [0, 1.5] }),
        entry('bad-text', { swipeIds: [0, '1'] }),
        entry('empty', { swipeIds: [] }),
        entry('dupes', { swipeIds: [2, 2, 0] }),
        entry('long', { swipeIds: longIds }),
        entry('tailed', { swipeIds: [...longIds.slice(0, 32), -1, 'bad'] }),
    ] } } } });
    fixture.context.chat = [anchor(), { ...reply(1), swipe_id: 39 }];
    const log = fixture.controller.log();
    assert.deepEqual(log.map(item => item.id), ['bad-type', 'bad-negative', 'bad-float', 'bad-text', 'empty', 'dupes', 'long', 'tailed']);
    for (const id of ['bad-type', 'bad-negative', 'bad-float', 'bad-text']) {
        const item = log.find(value => value.id === id);
        assert.equal(Object.hasOwn(item, 'swipeIds'), false);
        assert.equal(item.status, 'ok');
    }
    assert.equal(fixture.metadata.director.fate.log[0].swipeIds, 'nope');
    assert.deepEqual(log.find(value => value.id === 'empty').swipeIds, []);
    assert.equal(log.find(value => value.id === 'empty').status, 'changed');
    assert.deepEqual(log.find(value => value.id === 'dupes').swipeIds, [2, 0]);
    assert.equal(log.find(value => value.id === 'dupes').status, 'changed');
    assert.deepEqual(log.find(value => value.id === 'long').swipeIds, longIds.slice(0, 32));
    assert.equal(log.find(value => value.id === 'long').status, 'changed');
    assert.deepEqual(log.find(value => value.id === 'tailed').swipeIds, longIds.slice(0, 32));
    assert.equal(log.find(value => value.id === 'tailed').status, 'changed');
    fixture.context.chat[1].swipe_id = 0;
    assert.equal(fixture.controller.log().find(value => value.id === 'dupes').status, 'ok');
    assert.equal(fixture.controller.log().find(value => value.id === 'long').status, 'ok');
    assert.equal(fixture.controller.log().find(value => value.id === 'tailed').status, 'ok');
    fixture.context.chat[1].swipe_id = 39;
    assert.equal(fixture.controller.log().find(value => value.id === 'long').status, 'changed');
    fixture.context.chat.pop();
    assert.equal(fixture.controller.log().find(value => value.id === 'dupes').status, 'missing');
});

test('log() reads at most two indexes per entry in a 2000-message chat and never iterates it', () => {
    const chat = Array.from({ length: 2000 }, (_, index) => index % 2 ? reply(index) : anchor());
    const log = Array.from({ length: 50 }, (_, index) => entry(`perf-${index}`, { slotIndex: index * 2 + 1 }));
    const fixture = lab({ metadata: { director: { fate: { version: 1, log } } } });
    let reads = 0;
    fixture.context.chat = new Proxy(chat, {
        get(target, key, receiver) {
            if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
            else if (key !== 'length') throw new Error(`Unexpected chat traversal: ${String(key)}`);
            return Reflect.get(target, key, receiver);
        },
    });
    const entries = fixture.controller.log();
    assert.equal(entries.length, 50);
    assert.ok(entries.every(value => value.status === 'ok'));
    assert.equal(reads, 2 * entries.length);
});

test('log(slotIndex) reads at most two chat indexes for a cold mark lookup, including repeated slots', () => {
    const chat = Array.from({ length: 2000 }, (_, index) => index % 2 ? reply(index) : anchor());
    const log = Array.from({ length: 49 }, (_, index) => entry(`perf-${index}`, { slotIndex: index * 2 + 1 }));
    log.splice(1, 0, entry('older-at-same-slot', { prevFingerprint: 'different-anchor' }));
    const fixture = lab({ metadata: { director: { fate: { version: 1, log } } } });
    let reads = 0;
    fixture.context.chat = new Proxy(chat, {
        get(target, key, receiver) {
            if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
            else if (key !== 'length') throw new Error(`Unexpected chat traversal: ${String(key)}`);
            return Reflect.get(target, key, receiver);
        },
    });
    assert.deepEqual(fixture.controller.log(1), [
        { ...log[0], status: 'ok' }, { ...log[1], status: 'changed' },
    ]);
    assert.equal(reads, 2);
    reads = 0;
    assert.deepEqual(fixture.controller.log(1999), []);
    assert.equal(reads, 0);
    assert.deepEqual(fixture.controller.log(-1), []);
    assert.equal(reads, 0);
    assert.equal(fixture.controller.log(97)[0].id, 'perf-48');
    assert.equal(reads, 2);
});

const userLine = mes => ({ is_user: true, name: 'User', mes });
const aiLine = (generationId, swipeId) => {
    const message = reply(generationId);
    if (swipeId !== undefined) message.swipe_id = swipeId;
    return message;
};
const countedChat = (chat, stats) => new Proxy(chat, {
    get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) stats.reads++;
        else if (key !== 'length') throw new Error(`Unexpected chat traversal: ${String(key)}`);
        return Reflect.get(target, key, receiver);
    },
});

test('deleting or inserting an earlier message recovers on recoverLog and persists the new slot', async () => {
    const anchorA = anchor();
    const anchorB = userLine('And after that?');
    const held = entry('held-card');
    const bound = entry('bound-card', { slotIndex: 2, prevFingerprint: 'bound-anchor', generationId: 4, batchEndIndex: 2 });
    const corrupt = { id: 'not-a-card' };
    const laterA = entry('later-a', {
        slotIndex: 2, generationId: 4, prevFingerprint: messageFingerprint(anchorA), swipeIds: [1],
    });
    const laterB = entry('later-b', {
        slotIndex: 4, generationId: 8, prevFingerprint: messageFingerprint(anchorB), swipeIds: [0],
    });
    // An earlier row was removed, so both replies now sit one index lower.
    const fixture = lab({ metadata: { director: { fate: {
        version: 1, pity: 2, recent: ['echo'], held, bound, log: [laterA, corrupt, laterB],
    } } } });
    fixture.context.chat = [anchorA, aiLine(4, 1), anchorB, aiLine(8, 0)];
    const saves = fixture.saves.length;
    assert.equal(fixture.controller.log()[0].status, 'changed');
    assert.equal(fixture.controller.log()[1].status, 'missing');
    assert.equal(fixture.saves.length, saves);
    assert.equal(JSON.stringify(fixture.controller.view()).includes(privateEvent), false);
    const [first, second] = await Promise.all([fixture.controller.recoverLog(), fixture.controller.recoverLog()]);
    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(fixture.saves.length, saves + 1);
    assert.equal(fixture.metadata.director.fate.log[1], corrupt);
    assert.equal(fixture.metadata.director.fate.held, held);
    assert.equal(fixture.metadata.director.fate.bound, bound);
    assert.equal(fixture.metadata.director.fate.bound.slotIndex, 2);
    assert.equal(fixture.metadata.director.fate.pity, 2);
    assert.deepEqual(fixture.metadata.director.fate.recent, ['echo']);
    assert.deepEqual(fixture.metadata.director.fate.log[0], { ...laterA, slotIndex: 1 });
    assert.deepEqual(fixture.metadata.director.fate.log[2], { ...laterB, slotIndex: 3 });
    assert.deepEqual(fixture.persisted.at(-1).log.map(row => row.slotIndex), [1, undefined, 3]);
    const recovered = fixture.controller.log();
    assert.deepEqual(recovered.map(row => row.status), ['ok', 'ok']);
    assert.equal(recovered[0].event, privateEvent);
    assert.equal(JSON.stringify(fixture.controller.view()).includes(privateEvent), false);
    await fixture.controller.recoverLog();
    assert.equal(fixture.saves.length, saves + 1);

    const inserted = userLine('A line inserted above.');
    const raised = entry('raised', {
        slotIndex: 1, generationId: 3, prevFingerprint: messageFingerprint(anchorA), swipeIds: [2],
    });
    const upward = lab({ metadata: { director: { fate: { version: 1, log: [raised] } } } });
    upward.context.chat = [inserted, anchorA, aiLine(3, 2)];
    assert.equal(upward.controller.log()[0].status, 'changed');
    assert.equal(await upward.controller.recoverLog(), true);
    assert.equal(upward.metadata.director.fate.log[0].slotIndex, 2);
    assert.equal(upward.controller.log()[0].status, 'ok');
    assert.deepEqual(upward.persisted.at(-1).log[0], { ...raised, slotIndex: 2 });
});

test('an ambiguous or unmatched anchor stays changed and is not saved', async () => {
    const line = anchor();
    const tied = entry('tied', {
        slotIndex: 2, generationId: 5, prevFingerprint: messageFingerprint(line), swipeIds: [0],
    });
    const missingGen = entry('wrong-gen', {
        slotIndex: 0, generationId: 9, prevFingerprint: messageFingerprint(line), swipeIds: [0],
    });
    const openGen = entry('open-gen', {
        slotIndex: 5, generationId: null, prevFingerprint: messageFingerprint(line), swipeIds: [0],
    });
    const farther = entry('farther-gen', {
        slotIndex: 2, generationId: 9, prevFingerprint: messageFingerprint(line), swipeIds: [0],
    });
    const fixture = lab({ metadata: { director: { fate: { version: 1, log: [tied] } } } });
    fixture.context.chat = [line, aiLine(5, 0), line, aiLine(5, 0)];
    const saves = fixture.saves.length;
    assert.equal(await fixture.controller.recoverLog(), false);
    assert.equal(fixture.saves.length, saves);
    assert.equal(fixture.metadata.director.fate.log[0].slotIndex, 2);
    assert.equal(fixture.controller.log()[0].status, 'changed');

    const unmatched = lab({ metadata: { director: { fate: { version: 1, log: [missingGen, openGen] } } } });
    unmatched.context.chat = [userLine('Not the anchor.'), line, aiLine(1, 0)];
    assert.equal(await unmatched.controller.recoverLog(), true);
    assert.equal(unmatched.metadata.director.fate.log[0], missingGen);
    assert.equal(unmatched.controller.log()[0].status, 'changed');
    assert.deepEqual(unmatched.metadata.director.fate.log[1], { ...openGen, slotIndex: 2 });
    assert.equal(unmatched.controller.log()[1].status, 'ok');
    assert.equal(unmatched.saves.length, 1);

    const picked = lab({ metadata: { director: { fate: { version: 1, log: [farther] } } } });
    picked.context.chat = [line, aiLine(1, 0), userLine('Between.'), line, aiLine(9, 0)];
    assert.equal(await picked.controller.recoverLog(), true);
    assert.equal(picked.metadata.director.fate.log[0].slotIndex, 4);
    assert.equal(picked.controller.log()[0].status, 'ok');
});

test('a swipe id outside the recorded list is not recovered', async () => {
    const line = anchor();
    const mismatched = entry('swipe-mismatch', {
        slotIndex: 0, generationId: 9, prevFingerprint: messageFingerprint(line), swipeIds: [0],
    });
    const legacy = entry('legacy-swipe', {
        slotIndex: 0, generationId: 9, prevFingerprint: messageFingerprint(line),
    });
    const recorded = entry('recorded-swipe', {
        slotIndex: 2, generationId: 9, prevFingerprint: messageFingerprint(line), swipeIds: [0, 4],
    });
    const fixture = lab({ metadata: { director: { fate: { version: 1, log: [mismatched] } } } });
    fixture.context.chat = [userLine('Shifted.'), line, aiLine(9, 5)];
    assert.equal(await fixture.controller.recoverLog(), false);
    assert.equal(fixture.saves.length, 0);
    assert.equal(fixture.metadata.director.fate.log[0].slotIndex, 0);
    assert.equal(fixture.controller.log()[0].status, 'changed');

    const legacyFixture = lab({ metadata: { director: { fate: { version: 1, log: [legacy] } } } });
    legacyFixture.context.chat = [userLine('Shifted.'), line, aiLine(9, 5)];
    assert.equal(await legacyFixture.controller.recoverLog(), true);
    assert.equal(legacyFixture.metadata.director.fate.log[0].slotIndex, 2);
    assert.equal(Object.hasOwn(legacyFixture.metadata.director.fate.log[0], 'swipeIds'), false);
    assert.equal(legacyFixture.controller.log()[0].status, 'ok');

    const recordedFixture = lab({ metadata: { director: { fate: { version: 1, log: [recorded] } } } });
    recordedFixture.context.chat = [line, aiLine(9, 5), userLine('Between.'), line, aiLine(9, 4)];
    assert.equal(await recordedFixture.controller.recoverLog(), true);
    assert.equal(recordedFixture.metadata.director.fate.log[0].slotIndex, 4);
    assert.deepEqual(recordedFixture.metadata.director.fate.log[0].swipeIds, [0, 4]);
    assert.equal(recordedFixture.controller.log()[0].status, 'ok');
});

test('a row rewritten in place by an unrecorded swipe is not moved to an identical earlier reply', async () => {
    const line = anchor();
    const held = entry('in-place', {
        slotIndex: 3, generationId: null, prevFingerprint: messageFingerprint(line), swipeIds: [0],
    });
    const fixture = lab({ metadata: { director: { fate: { version: 1, log: [held] } } } });
    fixture.context.chat = [line, aiLine(1, 0), line, aiLine(2, 1)];
    assert.equal(fixture.controller.log()[0].status, 'changed');
    assert.equal(await fixture.controller.recoverLog(), false);
    assert.equal(fixture.saves.length, 0);
    assert.equal(fixture.metadata.director.fate.log[0].slotIndex, 3);
    fixture.context.chat[3].swipe_id = 0;
    assert.equal(fixture.controller.log()[0].status, 'ok');
});

test('recoverLog can scan a long chat, and log() still reads at most two indexes', async () => {
    const chat = Array.from({ length: 2000 }, (_, index) => index % 2 ? reply(index) : anchor());
    const aligned = entry('aligned', { slotIndex: 1, generationId: 1, prevFingerprint: messageFingerprint(anchor()) });
    const shifted = entry('shifted', { slotIndex: 1998, generationId: 1999, prevFingerprint: messageFingerprint(anchor()) });
    const fixture = lab({ metadata: { director: { fate: { version: 1, log: [aligned, shifted] } } } });
    const stats = { reads: 0 };
    fixture.context.chat = countedChat(chat, stats);
    const listed = fixture.controller.log();
    assert.equal(listed[0].status, 'ok');
    assert.equal(listed[1].status, 'changed');
    assert.equal(stats.reads, 3);
    stats.reads = 0;
    assert.equal(await fixture.controller.recoverLog(), true);
    assert.ok(stats.reads > 3);
    assert.equal(fixture.metadata.director.fate.log[0], aligned);
    assert.equal(fixture.metadata.director.fate.log[1].slotIndex, 1999);
    stats.reads = 0;
    const after = fixture.controller.log();
    assert.deepEqual(after.map(row => [row.id, row.slotIndex, row.status]), [
        ['aligned', 1, 'ok'], ['shifted', 1999, 'ok'],
    ]);
    assert.equal(stats.reads, 4);
});

test('a chat switch or a failed save does not keep a recovered slot', async () => {
    const line = anchor();
    const row = entry('switch', {
        slotIndex: 3, generationId: 4, prevFingerprint: messageFingerprint(line), swipeIds: [1],
    });
    const make = () => {
        const fixture = lab({ metadata: { director: { fate: { version: 1, log: [structuredClone(row)] } } } });
        fixture.context.chat = [line, aiLine(4, 1)];
        return fixture;
    };
    const switched = make();
    const before = structuredClone(switched.metadata.director.fate);
    switched.switchChat();
    await switched.emit('CHAT_CHANGED');
    assert.equal(await switched.controller.recoverLog(), false);
    assert.deepEqual(switched.metadata.director.fate, before);
    assert.equal(switched.context.chatMetadata.director, undefined);
    assert.equal(switched.saves.length, 0);

    const during = make();
    const duringBefore = structuredClone(during.metadata.director.fate);
    during.setSave(async () => {
        during.switchChat();
        await during.emit('CHAT_CHANGED');
        return true;
    });
    await assert.rejects(during.controller.recoverLog(), /保存失败/);
    assert.deepEqual(during.metadata.director.fate, duringBefore);
    assert.equal(during.context.chatMetadata.director, undefined);
    assert.equal(during.persisted.length, 0);

    for (const thrown of [false, true]) {
        const failed = make();
        const failedBefore = failed.metadata.director.fate;
        failed.setSave(async () => {
            if (thrown) throw new Error('Save failed');
            return false;
        });
        await assert.rejects(failed.controller.recoverLog(), /保存失败/);
        assert.equal(failed.metadata.director.fate, failedBefore);
        assert.equal(failed.metadata.director.fate.log[0].slotIndex, 3);
        assert.equal(failed.controller.log()[0].status, 'missing');
    }
});
