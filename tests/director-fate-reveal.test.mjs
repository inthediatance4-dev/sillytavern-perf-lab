import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from '../public/lib/eventemitter.js';
import { createFateController } from '../public/scripts/extensions/director/fate.js';

globalThis.localStorage = { getItem: () => null };

const eventTypes = Object.fromEntries([
    'CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED',
    'GENERATE_AFTER_DATA', 'GENERATION_COMPLETED', 'MESSAGE_RECEIVED',
].map(name => [name, name]));
const privateEvent = 'A hidden message arrives beneath the ancient clock.';

function deferred() {
    let resolve;
    const promise = new Promise(yes => { resolve = yes; });
    return { promise, resolve };
}

function lab({ onReveal = () => {} } = {}) {
    const eventSource = new EventEmitter();
    const metadata = {};
    let context = {
        eventSource, eventTypes, chatId: 'chat-one', chatMetadata: metadata,
        groupId: null, characterId: 0,
        chat: [{ is_user: true, name: 'User', mes: 'What happens next?' }],
        extensionPrompts: {}, generateQuietPrompt: async () => JSON.stringify({ event: privateEvent }),
        saveMetadataDebounced: () => {},
    };
    let serial = 0;
    let generate = async () => {};
    let save = async () => true;
    const reveals = [];
    const errors = [];
    const emit = (name, ...args) => eventSource.emit(eventTypes[name], ...args);
    const controller = createFateController(() => context, {
        uuid: () => `reveal-${++serial}`, random: () => 0,
        generate: () => generate(), save: (...args) => save(...args),
        onError: message => errors.push(message),
        onReveal: value => { reveals.push(value); onReveal(value); },
    });
    const api = {
        controller, metadata, reveals, errors, emit,
        get context() { return context; },
        setGenerate(value) { generate = value; },
        setSave(value) { save = value; },
        switchChat() {
            context = { ...context, chatId: 'chat-two', chatMetadata: {},
                chat: [{ is_user: true, name: 'User', mes: 'Another story.' }] };
        },
        async request(type = 'normal', beforePrepare = () => {}) {
            await emit('GENERATION_STARTED', type, {}, false);
            beforePrepare();
            const requestChat = context.chat.map(message => ({ ...message }));
            assert.equal(controller.prepare(type, requestChat), true);
            const data = { prompt: requestChat.find(message => message.extra?.directorFatePrompt)?.mes };
            await emit('GENERATE_AFTER_DATA', data, false);
            assert.ok(data.prompt.includes(privateEvent));
            return { data, type, chatId: context.chatId, chatMetadata: context.chatMetadata };
        },
        async complete(request, { append = true, message = {} } = {}) {
            const target = { is_user: false, name: 'Bot', mes: 'The reply has been generated.', ...message };
            if (append) context.chat.push(target);
            else context.chat[context.chat.length - 1] = target;
            await emit('MESSAGE_RECEIVED', context.chat.length - 1);
            await emit('GENERATION_ENDED');
            await emit('GENERATION_COMPLETED', request);
        },
        async adopt() {
            await controller.draw();
            let request;
            generate = async () => { request = await api.request(); await api.complete(request); };
            assert.equal(await controller.apply(), true);
            return request;
        },
    };
    return api;
}

test('a held card remains sealed and every busy phase stays drawing, applying or idle', async () => {
    const fixture = lab();
    assert.equal(fixture.controller.view().reveal, null);
    const pending = deferred();
    fixture.context.generateQuietPrompt = () => pending.promise;
    const drawing = fixture.controller.draw();
    assert.equal(fixture.controller.view().phase, 'drawing');
    assert.equal(fixture.controller.view().reveal, null);
    pending.resolve(JSON.stringify({ event: privateEvent }));
    assert.equal(await drawing, true);
    const held = fixture.controller.view();
    assert.equal(held.phase, 'idle');
    assert.equal(held.reveal, null);
    assert.equal(Object.hasOwn(held.held, 'event'), false);
    assert.equal(JSON.stringify(held).includes(privateEvent), false);

    fixture.setGenerate(async () => {
        const request = await fixture.request();
        const applying = fixture.controller.view();
        assert.equal(applying.phase, 'applying');
        assert.equal(applying.reveal, null);
        assert.equal(JSON.stringify(applying).includes(privateEvent), false);
        await fixture.complete(request);
    });
    assert.equal(await fixture.controller.apply(), true);
    assert.equal(fixture.controller.view().phase, 'idle');
});

test('completion reveals the bound event and announces it exactly once with public fields', async () => {
    const fixture = lab();
    const request = await fixture.adopt();
    const bound = fixture.metadata.director.fate.bound;
    const expectedPublic = { id: bound.id, title: bound.title, strength: bound.strength, rarity: 'common', slotIndex: 1 };
    assert.deepEqual(fixture.controller.view().reveal, { ...expectedPublic, event: privateEvent });
    assert.equal(fixture.controller.view().held, null);
    assert.deepEqual(fixture.reveals, [expectedPublic]);
    assert.equal(Object.hasOwn(fixture.reveals[0], 'event'), false);
    assert.equal(JSON.stringify(fixture.reveals).includes(privateEvent), false);
    await fixture.emit('GENERATION_COMPLETED', request);
    assert.equal(fixture.reveals.length, 1);
    const visible = fixture.controller.view().reveal;
    visible.event = 'Changed by a UI consumer.';
    assert.equal(fixture.controller.view().reveal.event, privateEvent);
});

test('reveal preserves optional rarity and defaults a legacy bound card to common', async () => {
    const fixture = lab();
    await fixture.adopt();
    assert.equal(fixture.controller.view().reveal.rarity, 'common');
    fixture.metadata.director.fate.bound.rarity = 'legendary';
    assert.equal(fixture.controller.view().reveal.rarity, 'legendary');
});

test('a failing reveal hook cannot undo consumption or prevent persistence', async () => {
    let saves = 0;
    const fixture = lab({ onReveal: () => { throw new Error(privateEvent); } });
    fixture.setSave(async () => { saves++; return true; });
    await fixture.adopt();
    assert.equal(saves, 2);
    assert.equal(fixture.controller.view().held, null);
    assert.equal(fixture.controller.view().reveal.event, privateEvent);
    assert.equal(fixture.errors.length, 0);
});

test('a stopped request retains the sealed card and cannot announce or reveal a late completion', async () => {
    const fixture = lab();
    await fixture.controller.draw();
    fixture.setGenerate(async () => {
        const request = await fixture.request();
        await fixture.emit('GENERATION_STOPPED');
        await fixture.complete(request);
    });
    assert.equal(await fixture.controller.apply(), false);
    assert.ok(fixture.controller.view().held);
    assert.equal(fixture.controller.view().reveal, null);
    assert.equal(fixture.reveals.length, 0);
});

for (const chatChangedEvent of [false, true]) {
    test(`an owner change${chatChangedEvent ? ' with CHAT_CHANGED' : ' before CHAT_CHANGED'} cannot reveal or announce the old request`, async () => {
        const fixture = lab();
        await fixture.controller.draw();
        fixture.setGenerate(async () => {
            const request = await fixture.request();
            fixture.switchChat();
            if (chatChangedEvent) await fixture.emit('CHAT_CHANGED');
            await fixture.complete(request);
        });
        assert.equal(await fixture.controller.apply(), false);
        assert.ok(fixture.metadata.director.fate.held);
        assert.equal(fixture.controller.view().reveal, null);
        assert.equal(fixture.reveals.length, 0);
    });
}

for (const [kind, message] of [
    ['user', { is_user: true }], ['system', { is_system: true }],
]) {
    test(`a ${kind} target cannot reveal or announce a card`, async () => {
        const fixture = lab();
        await fixture.controller.draw();
        fixture.setGenerate(async () => { await fixture.complete(await fixture.request(), { message }); });
        assert.equal(await fixture.controller.apply(), false);
        assert.equal(fixture.controller.view().reveal, null);
        assert.equal(fixture.reveals.length, 0);
    });
}

test('an anchor fingerprint mismatch before completion prevents reveal and announcement', async () => {
    const fixture = lab();
    await fixture.controller.draw();
    fixture.setGenerate(async () => {
        const request = await fixture.request();
        fixture.context.chat[0].mes = 'The preceding story was edited.';
        await fixture.complete(request);
    });
    assert.equal(await fixture.controller.apply(), false);
    assert.equal(fixture.controller.view().reveal, null);
    assert.equal(fixture.reveals.length, 0);
});

test('view hides a previously bound reveal when its target or anchor no longer matches', async () => {
    const fixture = lab();
    await fixture.adopt();
    const target = fixture.context.chat[1];
    for (const replacement of [undefined, { is_user: true }, { is_user: false, is_system: true }]) {
        fixture.context.chat[1] = replacement;
        assert.equal(fixture.controller.view().reveal, null);
    }
    fixture.context.chat[1] = target;
    const anchor = fixture.context.chat[0].mes;
    fixture.context.chat[0].mes = 'An edited anchor.';
    assert.equal(fixture.controller.view().reveal, null);
    fixture.context.chat[0].mes = anchor;
    assert.equal(fixture.controller.view().reveal.event, privateEvent);
    assert.equal(fixture.reveals.length, 1);
});

for (const failure of ['false', 'throw']) {
    test(`completion save ${failure} announces before persistence settles and keeps the reveal`, async () => {
        const fixture = lab();
        await fixture.controller.draw();
        const entered = deferred();
        const pending = deferred();
        let saves = 0;
        fixture.setSave(async () => {
            if (++saves === 1) { entered.resolve(); await pending.promise; }
            if (failure === 'throw') throw new Error(privateEvent);
            return false;
        });
        fixture.setGenerate(async () => { await fixture.complete(await fixture.request()); });
        const applying = fixture.controller.apply();
        await entered.promise;
        assert.equal(fixture.reveals.length, 1);
        assert.equal(fixture.controller.view().reveal.event, privateEvent);
        pending.resolve();
        assert.equal(await applying, true);
        assert.equal(saves, 2, 'the failed metadata save is retried');
        assert.equal(fixture.reveals.length, 1);
        assert.equal(fixture.errors.length, 1);
        assert.equal(fixture.controller.view().held, null);
        assert.equal(fixture.controller.view().reveal.event, privateEvent);
    });
}

for (const type of ['swipe', 'regenerate']) {
    test(`${type} replay preserves the reveal without another announcement`, async () => {
        const fixture = lab();
        await fixture.adopt();
        const original = fixture.controller.view().reveal;
        const request = await fixture.request(type, () => { if (type === 'regenerate') fixture.context.chat.pop(); });
        await fixture.complete(request, { append: type === 'regenerate', message: { extra: { gen_id: 200 } } });
        assert.deepEqual(fixture.controller.view().reveal, original);
        assert.equal(fixture.reveals.length, 1);
    });
}

test('view checks only the bound target and its predecessor in a long chat', async () => {
    const fixture = lab();
    fixture.context.chat = Array.from({ length: 2000 }, (_, index) => ({ is_user: true, mes: `Story ${index}.` }));
    await fixture.adopt();
    const reads = [];
    fixture.context.chat = new Proxy(fixture.context.chat, {
        get(target, key, receiver) {
            reads.push(String(key));
            return Reflect.get(target, key, receiver);
        },
    });
    assert.equal(fixture.controller.view().reveal.event, privateEvent);
    assert.deepEqual(reads, ['1999', '2000']);
});
