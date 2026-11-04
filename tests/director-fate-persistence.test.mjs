import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from '../public/lib/eventemitter.js';
import { createFateController } from '../public/scripts/extensions/director/fate.js';

globalThis.localStorage = { getItem: () => null };

const eventTypes = Object.fromEntries([
    'CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATE_AFTER_DATA',
    'GENERATION_COMPLETED', 'MESSAGE_RECEIVED',
].map(name => [name, name]));
const privateEvent = 'A messenger arrives carrying a sealed letter.';

function deferred() {
    let resolve;
    const promise = new Promise(yes => { resolve = yes; });
    return { promise, resolve };
}

function lab({ group = false } = {}) {
    const eventSource = new EventEmitter();
    const metadata = {};
    let context = {
        eventSource, eventTypes, chatId: 'chat-one', chatMetadata: metadata,
        groupId: group ? 'group-one' : null, characterId: group ? undefined : 0,
        chat: [{ is_user: true, name: 'User', mes: 'What happens next?' }],
        extensionPrompts: {}, generateQuietPrompt: async () => JSON.stringify({ event: privateEvent }),
        saveMetadataDebounced: () => {},
    };
    let serial = 0;
    let generations = 0;
    let save = async () => true;
    const saves = [];
    const persisted = [];
    const errors = [];
    const emit = (name, ...args) => eventSource.emit(eventTypes[name], ...args);
    const controller = createFateController(() => context, {
        uuid: () => `persistence-${++serial}`, random: () => 0,
        onError: message => errors.push(message),
        save: async (owner, shouldSave) => {
            const call = { owner, shouldSave, fate: structuredClone(owner.chatMetadata.director.fate) };
            saves.push(call);
            if (await save(call) === false || !shouldSave()) return false;
            persisted.push({ chatId: context.chatId, fate: structuredClone(context.chatMetadata.director.fate) });
            return true;
        },
        generate: async () => {
            generations++;
            await emit('GENERATION_STARTED', 'normal', {}, false);
            const requestChat = context.chat.map(message => ({ ...message }));
            assert.equal(controller.prepare('normal', requestChat), true);
            const data = { prompt: requestChat.find(message => message.extra?.directorFatePrompt)?.mes };
            await emit('GENERATE_AFTER_DATA', data, false);
            assert.ok(data.prompt.includes(privateEvent));
            context.chat.push({ is_user: false, name: 'Bot', mes: 'The messenger arrives.', extra: { gen_id: 100 } });
            await emit('MESSAGE_RECEIVED', context.chat.length - 1);
            await emit('GENERATION_ENDED');
            await emit('GENERATION_COMPLETED', { data, type: 'normal', chatId: context.chatId, chatMetadata: context.chatMetadata });
        },
    });
    return {
        controller, metadata, saves, persisted, errors, emit,
        get context() { return context; }, get generations() { return generations; },
        setSave(value) { save = value; },
        switchChat() {
            context = { ...context, chatId: 'chat-two', chatMetadata: {}, chat: [] };
        },
    };
}

for (const failure of ['false', 'throw']) {
    test(`completion save ${failure} keeps the card consumed, warns distinctly and retries persistence`, async () => {
        const fixture = lab();
        await fixture.controller.draw();
        const cardId = fixture.controller.view().held.id;
        let attempts = 0;
        fixture.setSave(async () => {
            if (++attempts > 1) return true;
            if (failure === 'throw') throw new Error(privateEvent);
            return false;
        });

        assert.equal(await fixture.controller.apply(), true);
        assert.equal(fixture.controller.view().held, null);
        assert.equal(fixture.controller.view().bound.id, cardId);
        assert.equal(fixture.metadata.director.fate.bound.event, privateEvent);
        assert.equal(fixture.metadata.director.fate.bound.slotIndex, 1);
        assert.equal(fixture.metadata.director.fate.bound.generationId, 100);
        assert.equal(attempts, 2);
        assert.equal(fixture.persisted.at(-1).fate.held, null);
        assert.deepEqual(fixture.persisted.at(-1).fate.bound, fixture.metadata.director.fate.bound);
        assert.equal(fixture.errors.length, 1);
        assert.ok(fixture.errors[0].includes('剧情已经写下，但这张命运牌没能记下来'));
        assert.equal(fixture.errors[0].includes('牌仍保留'), false);
        assert.equal(fixture.errors[0].includes(privateEvent), false);
        assert.equal(await fixture.controller.apply(), false);
        assert.equal(fixture.generations, 1);
    });
}

test('completion consumes and binds the card before its metadata save settles', async () => {
    const fixture = lab();
    await fixture.controller.draw();
    const entered = deferred();
    const pending = deferred();
    let attempts = 0;
    fixture.setSave(async () => {
        if (++attempts > 1) return true;
        entered.resolve();
        return pending.promise;
    });
    const applying = fixture.controller.apply();
    await entered.promise;
    assert.equal(fixture.controller.view().held, null);
    assert.ok(fixture.controller.view().bound);
    pending.resolve(false);
    assert.equal(await applying, true);
    assert.equal(fixture.controller.view().held, null);
    assert.ok(fixture.controller.view().bound);
});

test('a later generation retries dirty metadata using the latest group binding', async () => {
    const fixture = lab({ group: true });
    await fixture.controller.draw();
    fixture.setSave(async () => false);
    assert.equal(await fixture.controller.apply(), true);
    assert.equal(fixture.saves.length, 3);
    assert.equal(fixture.persisted.length, 1);

    fixture.context.chat.push({ is_user: false, name: 'Another bot', mes: 'The story continues.', extra: { gen_id: 100 } });
    await fixture.emit('MESSAGE_RECEIVED', 2);
    assert.equal(fixture.metadata.director.fate.bound.batchEndIndex, 2);
    fixture.setSave(async () => true);
    await fixture.emit('GENERATION_STARTED', 'quiet', {}, true);
    assert.equal(fixture.saves.length, 3, 'dry runs do not retry saves');
    await fixture.emit('GENERATION_STARTED', 'quiet', {}, false);
    assert.equal(fixture.saves.length, 4);
    assert.equal(fixture.persisted.at(-1).fate.held, null);
    assert.equal(fixture.persisted.at(-1).fate.bound.batchEndIndex, 2);
    assert.deepEqual(fixture.persisted.at(-1).fate, fixture.metadata.director.fate);
    await fixture.emit('GENERATION_STARTED', 'quiet', {}, false);
    assert.equal(fixture.saves.length, 4, 'successful retry clears the dirty state');
});

test('a successful draw persists dirty completion state without leaving a redundant retry', async () => {
    const fixture = lab();
    await fixture.controller.draw();
    fixture.setSave(async () => false);
    assert.equal(await fixture.controller.apply(), true);
    const bound = fixture.metadata.director.fate.bound;
    fixture.setSave(async () => true);
    assert.equal(await fixture.controller.draw(), true);
    assert.equal(fixture.persisted.at(-1).fate.bound.id, bound.id);
    assert.ok(fixture.persisted.at(-1).fate.held);
    const count = fixture.saves.length;
    await fixture.emit('GENERATION_STARTED', 'quiet', {}, false);
    assert.equal(fixture.saves.length, count);
});

test('a pending completion retry cannot save into another chat', async () => {
    const fixture = lab();
    await fixture.controller.draw();
    const entered = deferred();
    const pending = deferred();
    let attempts = 0;
    fixture.setSave(async () => {
        if (++attempts === 1) return false;
        entered.resolve();
        return pending.promise;
    });
    const applying = fixture.controller.apply();
    await entered.promise;
    const retry = fixture.saves.at(-1);
    assert.equal(retry.shouldSave(), true);
    fixture.switchChat();
    await fixture.emit('CHAT_CHANGED');
    assert.equal(retry.shouldSave(), false);
    pending.resolve(true);
    assert.equal(await applying, true);
    assert.equal(fixture.metadata.director.fate.held, null);
    assert.ok(fixture.metadata.director.fate.bound);
    assert.equal(fixture.context.chatMetadata.director, undefined);
    assert.equal(fixture.persisted.some(saved => saved.chatId === 'chat-two'), false);
    const count = fixture.saves.length;
    await fixture.emit('GENERATION_STARTED', 'quiet', {}, false);
    assert.equal(fixture.saves.length, count);
});

for (const failure of ['false', 'throw']) {
    test(`draw and discard still roll back after a ${failure} save failure`, async () => {
        const fixture = lab();
        await fixture.controller.draw();
        const before = structuredClone(fixture.metadata.director.fate);
        fixture.setSave(async () => {
            if (failure === 'throw') throw new Error(privateEvent);
            return false;
        });
        await assert.rejects(fixture.controller.draw(), /抽取失败/);
        assert.deepEqual(fixture.metadata.director.fate, before);
        await assert.rejects(fixture.controller.discard(), /保存失败/);
        assert.deepEqual(fixture.metadata.director.fate, before);
        assert.equal(fixture.errors.length, 0);
    });
}
