import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from '../public/lib/eventemitter.js';
import { RARITIES, findCategoryByTitle, rollOffer } from '../public/scripts/extensions/director/fate-decks.js';
import { createFateController } from '../public/scripts/extensions/director/fate.js';
import { createFatePanel } from '../public/scripts/extensions/director/fate-ui.js';
import { messageFingerprint } from '../public/scripts/extensions/director/instruct.js';

globalThis.localStorage = { getItem: () => null };

const eventTypes = Object.fromEntries([
    'CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED',
    'GENERATE_AFTER_DATA', 'GENERATION_COMPLETED', 'MESSAGE_RECEIVED',
].map(name => [name, name]));
const privateEvent = 'OFFER_PRIVATE_EVENT_MARKER: a sealed turn that must stay off the card back.';
const rareLine = RARITIES.rare.line;
const legendaryLine = RARITIES.legendary.line;

function lcg(seed) {
    let state = seed >>> 0 || 1;
    return () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function deferred() {
    let resolve;
    const promise = new Promise(yes => { resolve = yes; });
    return { promise, resolve };
}

function fixedOffer(rarity = 'common', id = 'offer-fixed') {
    return {
        id,
        cards: [
            { category: 'echo', title: '尘封的低语', rarity },
            { category: 'secret', title: '秘密浮现', rarity: 'rare' },
            { category: 'dilemma', title: '两难之境', rarity: 'legendary' },
        ],
    };
}

function lab({ onReveal = () => {}, metadata = {} } = {}) {
    const eventSource = new EventEmitter();
    let response = JSON.stringify({ event: privateEvent });
    let serial = 0;
    let saves = 0;
    let generations = 0;
    let generate = async () => {};
    let persist = async () => true;
    const quietCalls = [];
    let context = {
        eventSource, eventTypes, chatId: 'chat-one', chatMetadata: metadata,
        groupId: null, characterId: 0,
        chat: [{ is_user: true, name: 'User', mes: 'What happens next?' }],
        extensionPrompts: {},
        generateQuietPrompt: async options => {
            quietCalls.push(options);
            return typeof response === 'function' ? response() : response;
        },
        saveMetadataDebounced() {},
    };
    const reveals = [];
    const emit = (name, ...args) => eventSource.emit(eventTypes[name], ...args);
    const controller = createFateController(() => context, {
        uuid: () => `offer-${++serial}`, random: () => 0,
        generate: () => { generations++; return generate(); },
        save: async () => { saves++; return persist(); },
        onReveal: value => { reveals.push(value); onReveal(value); },
    });
    const api = {
        controller, metadata, quietCalls, reveals, emit,
        get context() { return context; },
        get saves() { return saves; },
        get generations() { return generations; },
        setResponse(value) { response = value; },
        setGenerate(value) { generate = value; },
        setSave(value) { persist = value; },
        switchChat() {
            context = { ...context, chatId: 'chat-two', chatMetadata: {}, chat: [{ is_user: true, name: 'User', mes: 'Elsewhere.' }] };
        },
        async request(type = 'normal', beforePrepare = () => {}) {
            await emit('GENERATION_STARTED', type, {}, false);
            beforePrepare();
            const requestChat = context.chat.map(message => ({ ...message }));
            assert.equal(controller.prepare(type, requestChat), true);
            const data = { prompt: requestChat.find(message => message.extra?.directorFatePrompt)?.mes };
            await emit('GENERATE_AFTER_DATA', data, false);
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
    };
    return api;
}

test('deal stores three backs and does not call a model', async () => {
    const fixture = lab();
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(fixture.quietCalls.length, 0);
    assert.equal(fixture.generations, 0);
    assert.equal(fixture.saves, 1);
    const offer = fixture.metadata.director.fate.offer;
    assert.equal(offer.cards.length, 3);
    assert.equal(new Set(offer.cards.map(card => card.category)).size, 3);
    assert.equal(fixture.metadata.director.fate.version, 1);
    assert.equal(fixture.controller.view().offer.id, offer.id);
    assert.equal(JSON.stringify(fixture.controller.view()).includes('event'), false);
});

test('pick asks once, puts the theme and rarity only in the quiet prompt, and keeps them out of the story request', async () => {
    const fixture = lab();
    fixture.metadata.director = { fate: { version: 1, offer: fixedOffer('common') } };
    assert.equal(await fixture.controller.pick(0, 'medium'), true);
    assert.equal(fixture.quietCalls.length, 1);
    assert.equal(fixture.generations, 0);
    const commonPrompt = fixture.quietCalls[0].quietPrompt;
    assert.match(commonPrompt, new RegExp(findCategoryByTitle('尘封的低语').theme));
    assert.equal(commonPrompt.includes(rareLine), false);
    assert.equal(commonPrompt.includes(legendaryLine), false);
    assert.equal(fixture.metadata.director.fate.offer, null);
    assert.equal(fixture.metadata.director.fate.held.category, 'echo');
    assert.equal(fixture.metadata.director.fate.held.rarity, 'common');
    assert.equal(JSON.stringify(fixture.controller.view()).includes(privateEvent), false);

    fixture.metadata.director.fate.offer = fixedOffer('common', 'offer-rare');
    assert.equal(await fixture.controller.pick(1), true);
    const rarePrompt = fixture.quietCalls.at(-1).quietPrompt;
    assert.match(rarePrompt, new RegExp(findCategoryByTitle('秘密浮现').theme));
    assert.match(rarePrompt, new RegExp(rareLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(rarePrompt.includes(legendaryLine), false);

    fixture.metadata.director.fate.offer = fixedOffer('common', 'offer-legendary');
    assert.equal(await fixture.controller.pick(2), true);
    const legendaryPrompt = fixture.quietCalls.at(-1).quietPrompt;
    const dilemmaTheme = findCategoryByTitle('两难之境').theme;
    const categoryLine = legendaryPrompt.split('\n')[1];
    assert.equal(categoryLine, `Category: ${dilemmaTheme}. Strength: a meaningful but manageable turn.`);
    assert.equal(categoryLine.includes('..'), false);
    assert.equal(legendaryPrompt.includes('..'), false);
    assert.equal(legendaryPrompt.includes(legendaryLine), true);
    assert.equal(legendaryPrompt.includes(rareLine), false);
    assert.equal(fixture.quietCalls.length, 3);

    let story = '';
    fixture.setGenerate(async () => {
        const request = await fixture.request();
        story = request.data.prompt;
        await fixture.complete(request);
    });
    assert.equal(await fixture.controller.apply(), true);
    assert.equal(story.includes(privateEvent), true);
    assert.equal(story.includes(rareLine), false);
    assert.equal(story.includes(legendaryLine), false);
    assert.equal(fixture.controller.view().reveal.event, privateEvent);
    const visible = JSON.parse(JSON.stringify(fixture.controller.view()));
    delete visible.reveal.event;
    assert.equal(JSON.stringify(visible).includes(privateEvent), false);
});

test('a failed, invalid or stopped pick keeps the offer and the previous held card', async () => {
    for (const kind of ['throw', 'invalid', 'stopped', 'switched']) {
        const fixture = lab();
        assert.equal(await fixture.controller.draw(), true);
        const held = fixture.metadata.director.fate.held;
        assert.equal(await fixture.controller.deal(), true);
        const offer = fixture.metadata.director.fate.offer;
        const pending = deferred();
        if (kind === 'throw') fixture.setResponse(() => { throw new Error(privateEvent); });
        if (kind === 'invalid') fixture.setResponse('not-json ' + privateEvent);
        if (kind === 'stopped' || kind === 'switched') fixture.setResponse(() => pending.promise);
        const picking = fixture.controller.pick(1, 'strong');
        if (kind === 'stopped' || kind === 'switched') {
            assert.equal(fixture.controller.view().phase, 'drawing');
            if (kind === 'stopped') await fixture.emit('GENERATION_STOPPED');
            else fixture.switchChat();
            pending.resolve(JSON.stringify({ event: 'A different private event.' }));
            assert.equal(await picking, false, kind);
        } else {
            await assert.rejects(picking, error => error.message === '命运牌抽取失败，请重试。' && !error.message.includes(privateEvent));
        }
        assert.equal(fixture.metadata.director.fate.offer, offer, kind);
        assert.equal(fixture.metadata.director.fate.held, held, kind);
        assert.equal(fixture.controller.view().busy, false, kind);
        assert.equal(JSON.stringify(fixture.controller.view()).includes(privateEvent), false, kind);
    }
});

test('a new controller reads the same saved offer', async () => {
    const fixture = lab();
    assert.equal(await fixture.controller.deal(), true);
    const saved = structuredClone(fixture.metadata.director.fate.offer);
    const reloaded = createFateController(() => fixture.context, { random: () => 0, uuid: () => 'reloaded' });
    assert.deepEqual(reloaded.view().offer, fixture.controller.view().offer);
    assert.deepEqual(fixture.metadata.director.fate.offer, saved);
    fixture.metadata.director.fate.offer.cards[0].event = privateEvent;
    assert.equal(JSON.stringify(fixture.controller.view()).includes(privateEvent), false);
    fixture.metadata.director.fate.offer = { id: 'short', cards: saved.cards.slice(0, 2) };
    assert.equal(fixture.controller.view().offer, null);
});

test('applying a held card keeps an unrelated dealt offer pickable', async () => {
    const fixture = lab();
    assert.equal(await fixture.controller.draw(), true);
    const held = fixture.metadata.director.fate.held;
    assert.equal(await fixture.controller.deal(), true);
    const offer = fixture.metadata.director.fate.offer;
    assert.equal(fixture.metadata.director.fate.held, held);
    assert.notEqual(offer, null);
    fixture.setGenerate(async () => { await fixture.complete(await fixture.request()); });
    assert.equal(await fixture.controller.apply(), true);
    assert.equal(fixture.metadata.director.fate.held, null);
    assert.equal(fixture.metadata.director.fate.bound.id, held.id);
    assert.equal(fixture.metadata.director.fate.offer, offer);
    assert.equal(fixture.controller.view().offer.id, offer.id);
    assert.equal(JSON.stringify(fixture.controller.view().offer).includes(privateEvent), false);
    const quietBeforePick = fixture.quietCalls.length;
    assert.equal(await fixture.controller.pick(0, 'medium'), true);
    assert.equal(fixture.quietCalls.length, quietBeforePick + 1);
    assert.equal(fixture.metadata.director.fate.offer, null);
    assert.equal(fixture.metadata.director.fate.held.title, offer.cards[0].title);
    assert.equal(fixture.metadata.director.fate.held.category, offer.cards[0].category);
    assert.notEqual(fixture.metadata.director.fate.held.id, held.id);
});

test('applying a common card advances pity and a rare card resets it; replay does not', async () => {
    const fixture = lab();
    fixture.metadata.director = { fate: { version: 1, pity: 5, recent: ['deadline'], offer: fixedOffer('common') } };
    assert.equal(await fixture.controller.pick(0), true);
    fixture.setGenerate(async () => { await fixture.complete(await fixture.request()); });
    assert.equal(await fixture.controller.apply(), true);
    assert.equal(fixture.metadata.director.fate.pity, 6);
    assert.deepEqual(fixture.metadata.director.fate.recent, ['echo', 'deadline']);
    assert.equal(fixture.metadata.director.fate.offer, null);
    assert.equal(fixture.reveals.length, 1);
    assert.equal(Object.hasOwn(fixture.reveals[0], 'event'), false);
    const afterCommon = structuredClone(fixture.metadata.director.fate);
    await fixture.complete(await fixture.request('swipe'), { append: false });
    assert.equal(fixture.metadata.director.fate.pity, afterCommon.pity);
    assert.deepEqual(fixture.metadata.director.fate.recent, afterCommon.recent);
    assert.equal(fixture.reveals.length, 1);

    fixture.metadata.director.fate.held = {
        id: 'rare-held', title: '秘密浮现', strength: 'medium', event: privateEvent, category: 'secret', rarity: 'rare',
    };
    fixture.metadata.director.fate.pity = 8;
    assert.equal(await fixture.controller.apply(), true);
    assert.equal(fixture.metadata.director.fate.pity, 0);
    assert.deepEqual(fixture.metadata.director.fate.recent, ['secret', 'echo']);
    const afterRare = { pity: fixture.metadata.director.fate.pity, recent: fixture.metadata.director.fate.recent.slice() };
    await fixture.complete(await fixture.request('regenerate', () => { fixture.context.chat.pop(); }));
    assert.equal(fixture.metadata.director.fate.pity, afterRare.pity);
    assert.deepEqual(fixture.metadata.director.fate.recent, afterRare.recent);
});

test('legacy cards without category or rarity still read, apply and replay', async () => {
    const fixture = lab();
    fixture.metadata.director = { fate: { version: 1, pity: 4, recent: ['deadline'], held: {
        id: 'legacy-held', title: '意外的回声', strength: 'medium', event: privateEvent,
    } } };
    assert.equal(fixture.controller.view().held.rarity, 'common');
    assert.equal(fixture.controller.view().held.title, '意外的回声');
    assert.equal(Object.hasOwn(fixture.metadata.director.fate.held, 'rarity'), false);
    assert.equal(JSON.stringify(fixture.controller.view()).includes(privateEvent), false);
    fixture.setGenerate(async () => { await fixture.complete(await fixture.request()); });
    assert.equal(await fixture.controller.apply(), true);
    assert.equal(fixture.metadata.director.fate.bound.category, 'echo');
    assert.equal(fixture.metadata.director.fate.bound.rarity, 'common');
    assert.equal(fixture.metadata.director.fate.pity, 5);
    assert.deepEqual(fixture.metadata.director.fate.recent, ['echo', 'deadline']);
    const pity = fixture.metadata.director.fate.pity;
    const recent = fixture.metadata.director.fate.recent.slice();
    await fixture.complete(await fixture.request('swipe'), { append: false });
    assert.equal(fixture.metadata.director.fate.pity, pity);
    assert.deepEqual(fixture.metadata.director.fate.recent, recent);

    const anchor = { is_user: true, name: 'User', mes: 'A legacy anchor.' };
    const reply = { is_user: false, name: 'Bot', mes: 'Already on the page.' };
    fixture.context.chat = [anchor, reply];
    fixture.metadata.director.fate = {
        version: 1, pity: 2, recent: ['weather'], held: null,
        bound: { id: 'legacy-bound', title: '远方来讯', strength: 'light', event: privateEvent, slotIndex: 1, prevFingerprint: messageFingerprint(anchor) },
    };
    assert.equal(fixture.controller.view().bound.rarity, 'common');
    assert.equal(fixture.controller.view().reveal.event, privateEvent);
    assert.equal(fixture.controller.view().reveal.rarity, 'common');
    const reveals = fixture.reveals.length;
    await fixture.complete(await fixture.request('swipe'), { append: false });
    assert.equal(fixture.metadata.director.fate.pity, 2);
    assert.deepEqual(fixture.metadata.director.fate.recent, ['weather']);
    assert.equal(fixture.reveals.length, reveals);
    fixture.metadata.director.fate.held = { id: 'nope', title: '具体发生了什么', strength: 'medium', event: privateEvent };
    assert.equal(fixture.controller.view().held, null);
});

test('an open offer can be swapped once, and the spent allowance survives a reloaded view', async () => {
    const fixture = lab();
    fixture.metadata.director = { fate: { version: 1, pity: 5, recent: ['deadline'] } };
    assert.equal(fixture.controller.view().rerolls, 1);
    assert.equal(await fixture.controller.deal(), true);
    const first = fixture.metadata.director.fate.offer.id;
    assert.equal(fixture.metadata.director.fate.version, 1);
    assert.equal(fixture.metadata.director.fate.rerolls, 1);
    assert.equal(fixture.metadata.director.fate.pity, 5);
    assert.deepEqual(fixture.metadata.director.fate.recent, ['deadline']);
    assert.equal(fixture.controller.view().rerolls, 1);
    assert.equal(await fixture.controller.deal(), true);
    assert.notEqual(fixture.metadata.director.fate.offer.id, first);
    assert.equal(fixture.metadata.director.fate.offer.cards.length, 3);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
    assert.equal(fixture.controller.view().rerolls, 0);
    assert.equal(fixture.metadata.director.fate.pity, 5);
    assert.deepEqual(fixture.metadata.director.fate.recent, ['deadline']);
    const spentOffer = fixture.metadata.director.fate.offer.id;
    const saves = fixture.saves;
    await assert.rejects(fixture.controller.deal(), error => error.message === '本次已换过一组');
    assert.equal(fixture.metadata.director.fate.offer.id, spentOffer);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
    assert.equal(fixture.saves, saves);
    assert.equal(fixture.controller.view().busy, false);
    assert.equal(fixture.controller.view().phase, 'idle');

    const metadata = structuredClone(fixture.metadata);
    const eventSource = new EventEmitter();
    const reloaded = createFateController(() => ({
        eventSource, eventTypes, chatId: fixture.context.chatId, chatMetadata: metadata,
        groupId: null, characterId: 0, chat: fixture.context.chat, extensionPrompts: {},
        saveMetadataDebounced() {},
    }), { random: () => 0, uuid: () => 'reloaded', save: async () => true });
    assert.equal(reloaded.view().rerolls, 0);
    assert.equal(reloaded.view().offer.id, spentOffer);
    await assert.rejects(reloaded.deal(), error => error.message === '本次已换过一组');
    assert.equal(metadata.director.fate.offer.id, spentOffer);
    assert.equal(metadata.director.fate.rerolls, 0);
    assert.equal(metadata.director.fate.version, 1);
});

test('legacy fate state without rerolls still allows one swap', async () => {
    const fixture = lab();
    fixture.metadata.director = { fate: { version: 1, pity: 4, recent: ['echo'], offer: fixedOffer() } };
    assert.equal(Object.hasOwn(fixture.metadata.director.fate, 'rerolls'), false);
    assert.equal(fixture.controller.view().rerolls, 1);
    assert.equal(fixture.metadata.director.fate.version, 1);
    const before = fixture.metadata.director.fate.offer.id;
    assert.equal(await fixture.controller.deal(), true);
    assert.notEqual(fixture.metadata.director.fate.offer.id, before);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
    assert.equal(fixture.metadata.director.fate.version, 1);
    assert.equal(fixture.metadata.director.fate.pity, 4);
    assert.deepEqual(fixture.metadata.director.fate.recent, ['echo']);
    await assert.rejects(fixture.controller.deal(), error => error.message === '本次已换过一组');
    assert.equal(fixture.metadata.director.fate.pity, 4);
});

test('a failed deal save rolls the offer and the allowance back together', async () => {
    const fixture = lab();
    fixture.setSave(async () => false);
    await assert.rejects(fixture.controller.deal(), /保存失败/);
    assert.equal(fixture.metadata.director?.fate, undefined);
    assert.equal(fixture.controller.view().rerolls, 1);
    fixture.setSave(async () => true);
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(fixture.metadata.director.fate.rerolls, 1);

    const before = structuredClone(fixture.metadata.director.fate);
    fixture.setSave(async () => { throw new Error('disk full'); });
    await assert.rejects(fixture.controller.deal(), /保存失败/);
    assert.deepEqual(fixture.metadata.director.fate, before);
    assert.equal(fixture.controller.view().rerolls, 1);
    assert.equal(fixture.controller.view().offer.id, before.offer.id);
    fixture.setSave(async () => true);
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
    assert.notEqual(fixture.metadata.director.fate.offer.id, before.offer.id);
    assert.equal(fixture.metadata.director.fate.pity, before.pity);
});

test('a deal with no offer does not spend the swap, and pick plus discard does not refill a spent one', async () => {
    const fixture = lab();
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(await fixture.controller.pick(0), true);
    assert.equal(await fixture.controller.discard(), true);
    assert.equal(fixture.metadata.director.fate.rerolls, 1);
    assert.equal(fixture.metadata.director.fate.offer, null);
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(fixture.metadata.director.fate.rerolls, 1);

    assert.equal(await fixture.controller.deal(), true);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
    assert.equal(await fixture.controller.pick(1, 'light'), true);
    assert.equal(fixture.metadata.director.fate.offer, null);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
    assert.equal(await fixture.controller.discard(), true);
    assert.equal(fixture.metadata.director.fate.held, null);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
    assert.equal(fixture.controller.view().rerolls, 0);
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
    assert.equal(fixture.metadata.director.fate.offer.cards.length, 3);
    const locked = fixture.metadata.director.fate.offer.id;
    await assert.rejects(fixture.controller.deal(), error => error.message === '本次已换过一组');
    assert.equal(fixture.metadata.director.fate.offer.id, locked);
    assert.equal(await fixture.controller.pick(0), true);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
    assert.ok(fixture.metadata.director.fate.held);
});

test('applying the held card restores one reroll, and a failed apply does not', async () => {
    const fixture = lab();
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(await fixture.controller.pick(0), true);
    fixture.setGenerate(async () => { throw new Error('provider down'); });
    await assert.rejects(fixture.controller.apply(), /采用失败/);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
    assert.ok(fixture.metadata.director.fate.held);
    assert.equal(fixture.metadata.director.fate.offer, null);
    fixture.setGenerate(async () => { await fixture.complete(await fixture.request()); });
    assert.equal(await fixture.controller.apply(), true);
    assert.equal(fixture.metadata.director.fate.held, null);
    assert.ok(fixture.metadata.director.fate.bound);
    assert.equal(fixture.metadata.director.fate.rerolls, 1);
    assert.equal(fixture.controller.view().rerolls, 1);
    const pity = fixture.metadata.director.fate.pity;
    const recent = fixture.metadata.director.fate.recent.slice();
    await fixture.complete(await fixture.request('swipe'), { append: false });
    assert.equal(fixture.metadata.director.fate.rerolls, 1);
    assert.equal(fixture.metadata.director.fate.pity, pity);
    assert.deepEqual(fixture.metadata.director.fate.recent, recent);
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(fixture.metadata.director.fate.rerolls, 1);
    assert.equal(fixture.controller.view().rerolls, 1);
    const offer = fixture.metadata.director.fate.offer.id;
    assert.equal(await fixture.controller.deal(), true);
    assert.notEqual(fixture.metadata.director.fate.offer.id, offer);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
});

test('applying restores the reroll for an offer that was dealt while the swap was spent', async () => {
    const fixture = lab();
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(await fixture.controller.pick(0), true);
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
    const offer = fixture.metadata.director.fate.offer;
    assert.ok(fixture.metadata.director.fate.held);
    fixture.setGenerate(async () => { await fixture.complete(await fixture.request()); });
    assert.equal(await fixture.controller.apply(), true);
    assert.equal(fixture.metadata.director.fate.offer, offer);
    assert.equal(fixture.metadata.director.fate.rerolls, 1);
    assert.equal(await fixture.controller.deal(), true);
    assert.notEqual(fixture.metadata.director.fate.offer.id, offer.id);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
    assert.equal(await fixture.controller.pick(2), true);
});

test('draw still seals one card and does not spend or refill the reroll', async () => {
    const fixture = lab();
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(await fixture.controller.draw(), true);
    assert.equal(fixture.quietCalls.length, 1);
    assert.equal(fixture.metadata.director.fate.offer, null);
    assert.equal(fixture.metadata.director.fate.rerolls, 1);
    assert.ok(fixture.metadata.director.fate.held);
    assert.equal(await fixture.controller.discard(), true);
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(await fixture.controller.deal(), true);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
    const locked = fixture.metadata.director.fate.offer;
    assert.equal(await fixture.controller.draw(), true);
    assert.equal(fixture.quietCalls.length, 2);
    assert.equal(fixture.metadata.director.fate.offer, null);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
    assert.notEqual(fixture.metadata.director.fate.held.id, undefined);
    assert.equal(await fixture.controller.discard(), true);
    assert.equal(await fixture.controller.deal(), true);
    await assert.rejects(fixture.controller.deal(), error => error.message === '本次已换过一组');
    assert.notEqual(fixture.metadata.director.fate.offer, locked);
    assert.equal(fixture.metadata.director.fate.rerolls, 0);
});

test('seeded rollOffer frequencies, distinct categories and pity stay inside the deal rules', () => {
    const counts = { common: 0, rare: 0, legendary: 0 };
    const random = lcg(20261031);
    for (let index = 0; index < 10000; index++) {
        const recent = ['object', 'misunderstanding'];
        const cards = rollOffer(random, { recent, pity: 0 });
        const ids = cards.map(card => card.category);
        assert.equal(new Set(ids).size, 3);
        for (const id of recent) assert.equal(ids.includes(id), false, id);
        for (const card of cards) counts[card.rarity]++;
    }
    assert.ok(Math.abs(counts.common / 30000 - 0.70) <= 0.02, JSON.stringify(counts));
    assert.ok(Math.abs(counts.rare / 30000 - 0.25) <= 0.02, JSON.stringify(counts));
    assert.ok(Math.abs(counts.legendary / 30000 - 0.05) <= 0.02, JSON.stringify(counts));
    for (let index = 0; index < 10000; index++) {
        const cards = rollOffer(lcg(index + 7), { recent: ['echo'], pity: 8 });
        assert.equal(cards.some(card => card.rarity !== 'common'), true);
    }
});

class ClassList {
    constructor() { this.names = []; }
    contains(name) { return this.names.includes(name); }
    add(...names) { for (const name of names) if (name && !this.contains(name)) this.names.push(name); }
    remove(...names) { this.names = this.names.filter(name => !names.includes(name)); }
    toggle(name, force) {
        const next = force === undefined ? !this.contains(name) : Boolean(force);
        if (next) this.add(name);
        else this.remove(name);
        return next;
    }
}

class MiniNode {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.attributes = new Map();
        this.listeners = new Map();
        this.classList = new ClassList();
        this.dataset = {};
        this.hidden = false;
        this.disabled = false;
        this.id = '';
        this.type = '';
        this.value = '';
        this.checked = false;
        this.htmlFor = '';
        this.tabIndex = 0;
        this.text = '';
    }
    set className(value) { this.classList.names = String(value ?? '').split(/\s+/).filter(Boolean); }
    get className() { return this.classList.names.join(' '); }
    set textContent(value) { this.text = value == null ? '' : String(value); this.children = []; }
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text; }
    get childElementCount() { return this.children.length; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    append(...nodes) {
        for (const node of nodes) {
            node.parent = this;
            this.children.push(node);
        }
    }
    replaceChildren(...nodes) {
        this.children = [];
        this.append(...nodes);
    }
    add(option) { this.append(option); }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, handler) {
        const list = this.listeners.get(type) ?? [];
        list.push(handler);
        this.listeners.set(type, list);
    }
    removeEventListener(type, handler) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== handler));
    }
    focus() {}
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) {
        const out = [];
        for (const part of selector.split(',').map(item => item.trim()).filter(Boolean)) {
            let level = [this];
            for (const step of part.split(/\s+/)) {
                const next = [];
                for (const node of level) collect(node, step, next);
                level = next;
            }
            out.push(...level);
        }
        return out;
    }
}

function matches(node, step) {
    if (step.startsWith('#')) return node.id === step.slice(1);
    if (step.startsWith('.')) return node.classList.contains(step.slice(1));
    return node.tagName === step.toUpperCase();
}

function collect(node, step, out) {
    for (const child of node.children) {
        if (matches(child, step)) out.push(child);
        collect(child, step, out);
    }
}

function installDom(t) {
    const previous = { document: globalThis.document, Option: globalThis.Option };
    const nodes = [];
    globalThis.document = {
        createElement(tag) {
            const node = new MiniNode(tag);
            nodes.push(node);
            return node;
        },
        createElementNS(_namespace, tag) {
            const node = new MiniNode(tag);
            nodes.push(node);
            return node;
        },
        getElementById(id) { return nodes.find(node => node.id === id) ?? null; },
    };
    globalThis.Option = function Option(text, value) {
        const option = document.createElement('option');
        option.textContent = text;
        option.value = value;
        return option;
    };
    t.after(() => {
        if (previous.document === undefined) delete globalThis.document;
        else globalThis.document = previous.document;
        if (previous.Option === undefined) delete globalThis.Option;
        else globalThis.Option = previous.Option;
    });
}

test('deal, view and panel refresh do not traverse a 2000-message chat', async t => {
    installDom(t);
    const stats = { indexes: 0, scans: 0 };
    const scan = new Set(['map', 'forEach', 'slice', 'filter', 'reduce', 'find', 'some', 'every', 'flat', 'join', 'concat', 'indexOf', 'findIndex', 'entries', 'keys', 'values', 'at']);
    const messages = Array.from({ length: 2000 }, (_, index) => ({ is_user: index % 2 === 0, is_system: false, name: 'Story', mes: `Line ${index}` }));
    const chat = new Proxy(messages, {
        get(target, prop, receiver) {
            if (typeof prop === 'string' && /^\d+$/.test(prop)) stats.indexes++;
            const value = Reflect.get(target, prop, receiver);
            if (typeof value === 'function' && scan.has(String(prop))) {
                return (...args) => { stats.scans++; return value.apply(target, args); };
            }
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    const eventSource = new EventEmitter();
    const metadata = {};
    const context = {
        eventSource, eventTypes, chatId: 'chat-one', chatMetadata: metadata, groupId: null, characterId: 0, chat,
        extensionPrompts: {}, generateQuietPrompt: async () => { throw new Error('deal must not generate'); },
        saveMetadataDebounced() {},
    };
    let panel;
    const controller = createFateController(() => context, {
        random: () => 0, uuid: () => 'deal-once', save: async () => true, onChange: () => panel?.refresh(),
    });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    class Popup {
        constructor(_content, _type, _text, options = {}) {
            this.dlg = { addEventListener() {} };
            this.options = options;
        }
        show() { this.options.onOpen?.(); return gate; }
    }
    panel = createFatePanel(controller, {
        Popup, POPUP_TYPE: { TEXT: 'text' }, POPUP_RESULT: { AFFIRMATIVE: 1 },
        hasDraft: () => false, warn() {}, settings: { reveal: 'tap', sound: false, motion: 'system' },
        sound: { play() {} }, saveSettings() {}, restoreFocus() {},
    });
    const opening = panel.open();
    assert.equal(stats.scans, 0);
    assert.equal(stats.indexes, 0);
    assert.equal(await controller.deal(), true);
    panel.refresh();
    for (let repeat = 0; repeat < 20; repeat++) controller.view();
    assert.equal(stats.scans, 0);
    assert.equal(stats.indexes, 0);
    assert.equal(metadata.director.fate.offer.cards.length, 3);
    release();
    await opening;
});
