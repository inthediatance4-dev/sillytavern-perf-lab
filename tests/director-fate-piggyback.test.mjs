import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from '../public/lib/eventemitter.js';
import { createFateController } from '../public/scripts/extensions/director/fate.js';
import {
    PIGGYBACK_MARKER, buildPiggybackInstruction, parsePiggybackEvents, piggybackBlockStart, stripPiggyback,
} from '../public/scripts/extensions/director/fate-piggyback.js';
import { RARITIES, rollOffer } from '../public/scripts/extensions/director/fate-decks.js';

globalThis.localStorage = { getItem: () => null };

const events = Object.fromEntries([
    'CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED',
    'GENERATE_AFTER_DATA', 'GENERATION_COMPLETED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_DELETED',
].map(name => [name, name]));

const faces = [
    { category: 'echo', title: '意外的回声', rarity: 'common' },
    { category: 'secret', title: '秘密浮现', rarity: 'rare' },
    { category: 'dilemma', title: '两难之境', rarity: 'legendary' },
];
const privateEvents = ['PRIVATE_EVENT_ONE：旧信里的名字。', 'PRIVATE_EVENT_TWO：面具下的人。', 'PRIVATE_EVENT_THREE：两条路只能选一条。'];
// The lab rolls with random() === 0; the model block must answer those exact faces.
const rolledFaces = rollOffer(() => 0, { recent: [], pity: 0 });

function blockFor(cards = rolledFaces, texts = privateEvents) {
    return `${PIGGYBACK_MARKER}\n${JSON.stringify({ events: cards.map((card, index) => ({ category: card.category, title: card.title, event: texts[index] })) })}`;
}

function lab({ piggyback = true, group = false } = {}) {
    const eventSource = new EventEmitter();
    let serial = 0;
    let saves = 0;
    let saveResult = true;
    const quietCalls = [];
    const repaints = [];
    const errors = [];
    let changes = 0;
    let response = JSON.stringify({ event: 'QUIET_FALLBACK_EVENT' });
    let generate = async () => {};
    const metadata = {};
    let context = {
        eventSource, eventTypes: events, chatId: 'chat-one', chatMetadata: metadata,
        groupId: group ? 'group-one' : null, characterId: group ? undefined : 0,
        chat: [{ is_user: true, name: 'User', mes: 'Tell me what happens.' }],
        extensionPrompts: {},
        generateQuietPrompt: async options => { quietCalls.push(options); return response; },
        saveMetadataDebounced() {},
    };
    const controller = createFateController(() => context, {
        uuid: () => `pb-${++serial}`, random: () => 0, piggyback: () => piggyback,
        generate: () => generate(),
        save: async () => { saves++; if (!saveResult) return false; },
        repaintMessage: id => repaints.push(id),
        onError: message => errors.push(message),
        onChange: () => { changes++; },
    });
    const emit = (name, ...args) => eventSource.emit(events[name], ...args);
    const api = {
        controller, metadata, quietCalls, repaints, errors, emit,
        get context() { return context; }, get saves() { return saves; }, get changes() { return changes; },
        setSaveResult(value) { saveResult = value; },
        setResponse(value) { response = value; },
        setGenerate(value) { generate = value; },
        switchChat() { context = { ...context, chatId: 'chat-two', chatMetadata: {} }; },
        async start(type = 'normal') {
            await emit('GENERATION_STARTED', type, {}, false);
            const requestChat = context.chat.map(message => ({ ...message }));
            const prepared = controller.prepare(type, requestChat);
            return { requestChat, prepared, row: requestChat.find(message => message.extra?.directorFatePiggyback) };
        },
        async request(type = 'normal') {
            const { requestChat, prepared, row } = await api.start(type);
            if (!row) return { prepared, requestChat, data: null };
            const data = { prompt: [{ role: 'system', content: [{ type: 'text', text: row.mes }] }], input: row.mes };
            await emit('GENERATE_AFTER_DATA', data, false);
            return { prepared, requestChat, data, token: row.mes };
        },
        async receive(text, { swipes = null, slot = null } = {}) {
            const message = { is_user: false, name: 'Bot', mes: text };
            if (swipes) { message.swipes = swipes; message.swipe_id = 0; }
            if (slot === null) context.chat.push(message);
            else context.chat[slot] = message;
            const index = slot === null ? context.chat.length - 1 : slot;
            await emit('MESSAGE_RECEIVED', index);
            return message;
        },
        async complete(data, type = 'normal') {
            await emit('GENERATION_ENDED');
            await emit('GENERATION_COMPLETED', { data, type, chatId: context.chatId, chatMetadata: context.chatMetadata });
        },
        async round(replyText, { swipes = null } = {}) {
            const request = await api.request();
            assert.ok(request.data, 'piggyback row must be injected');
            await api.receive(replyText, { swipes });
            await api.complete(request.data);
            return request;
        },
    };
    return api;
}

test('instruction names every face, the marker and the rarity lines', () => {
    const text = buildPiggybackInstruction(faces);
    assert.equal(text.includes(PIGGYBACK_MARKER), true);
    for (const card of faces) {
        assert.equal(text.includes(`category="${card.category}"`), true);
        assert.equal(text.includes(`title="${card.title}"`), true);
    }
    assert.equal(text.includes(RARITIES.rare.line), true);
    assert.equal(text.includes(RARITIES.legendary.line), true);
    assert.equal(text.includes('"events"') || text.includes('events'), true);
});

test('strip keeps the story prefix and removes everything from the marker', () => {
    assert.equal(stripPiggyback(`Story text.\n\n${blockFor()}`), 'Story text.');
    assert.equal(stripPiggyback('No block here.'), 'No block here.');
    assert.equal(piggybackBlockStart('plain'), -1);
    assert.equal(piggybackBlockStart(null), -1);
});

test('parse accepts exactly the rolled faces and rejects deviations', () => {
    const raw = `Reply.\n${blockFor(faces)}`;
    assert.deepEqual(parsePiggybackEvents(raw, faces), privateEvents.map(text => text.trim()));
    assert.equal(parsePiggybackEvents('no marker', faces), null);
    assert.equal(parsePiggybackEvents(`${PIGGYBACK_MARKER}\nnot json`, faces), null);
    assert.equal(parsePiggybackEvents(`${PIGGYBACK_MARKER}\n{"events":[]}`, faces), null);
    const itemOf = (card, index, extra = {}) => ({ category: card.category, title: card.title, event: privateEvents[index], ...extra });
    const wrongTitle = { events: faces.map((card, index) => itemOf(card, index, index === 0 ? { title: '别的标题' } : {})) };
    assert.equal(parsePiggybackEvents(`${PIGGYBACK_MARKER}\n${JSON.stringify(wrongTitle)}`, faces), null);
    const extraKey = { events: faces.map((card, index) => itemOf(card, index, { note: 'x' })) };
    assert.equal(parsePiggybackEvents(`${PIGGYBACK_MARKER}\n${JSON.stringify(extraKey)}`, faces), null);
    const longEvent = { events: faces.map((card, index) => itemOf(card, index, index === 1 ? { event: '长'.repeat(401) } : {})) };
    assert.equal(parsePiggybackEvents(`${PIGGYBACK_MARKER}\n${JSON.stringify(longEvent)}`, faces), null);
    const controlChar = { events: faces.map((card, index) => itemOf(card, index, index === 1 ? { event: 'bad\u0001char' } : {})) };
    assert.equal(parsePiggybackEvents(`${PIGGYBACK_MARKER}\n${JSON.stringify(controlChar)}`, faces), null);
    assert.equal(parsePiggybackEvents(`${PIGGYBACK_MARKER}\n${'x'.repeat(16001)}`, faces), null);
    const braces = privateEvents.map(text => `${text} {"nested": "}"}`);
    assert.deepEqual(parsePiggybackEvents(`Reply.\n${blockFor(faces, braces)}`, faces), braces.map(text => text.trim()));
});

test('one normal reply carries the offer: shielded injection, restore, strip before save, zero-call pick', async () => {
    const fixture = lab();
    const request = await fixture.request();
    assert.equal(request.prepared, true);
    // Before restore the request only holds the opaque frame: no raw newlines or braces.
    assert.equal(request.token.includes('\n'), false);
    assert.equal(request.token.includes('{'), false);
    assert.equal(request.token.includes('\uE009'), true);
    assert.match(request.token, /^\uE000directorpb\d+x[a-zA-Z0-9]+\uE001/);
    const restored = request.data.prompt[0].content[0].text;
    assert.equal(restored.includes(PIGGYBACK_MARKER), true);
    assert.equal(restored.includes('\uE000'), false);
    assert.equal(request.data.input, restored);
    assert.equal(fixture.quietCalls.length, 0);

    const message = await fixture.receive(`The story continues.\n\n${blockFor()}`, { swipes: [`The story continues.\n\n${blockFor()}`] });
    assert.equal(message.mes, 'The story continues.');
    assert.deepEqual(message.swipes, ['The story continues.']);
    assert.deepEqual(fixture.repaints, [1]);
    assert.equal(fixture.metadata.director?.fate ?? null, null);

    await fixture.complete(request.data);
    const fate = fixture.metadata.director.fate;
    assert.ok(fate.offer);
    assert.equal(fate.offer.cards.length, 3);
    assert.equal(fate.rerolls, 1);
    assert.deepEqual(fate.offer.cards.map(card => card.event), privateEvents);
    assert.deepEqual(fixture.controller.view().offer.cards, rolledFaces.map(({ category, title, rarity }) => ({ category, title, rarity })));
    assert.equal(JSON.stringify(fixture.controller.view()).includes('PRIVATE_EVENT'), false);

    const savesBefore = fixture.saves;
    assert.equal(await fixture.controller.pick(1, 'strong'), true);
    assert.equal(fixture.quietCalls.length, 0);
    assert.equal(fixture.saves, savesBefore + 1);
    assert.equal(fixture.metadata.director.fate.offer, null);
    assert.equal(fixture.metadata.director.fate.held.event, privateEvents[1]);
    assert.equal(fixture.metadata.director.fate.held.strength, 'strong');
    assert.equal(fixture.metadata.director.fate.held.rarity, rolledFaces[1].rarity);
});

test('injection stays out of disabled, held, open-offer, group, swipe and regenerate cases', async () => {
    const disabled = lab({ piggyback: false });
    assert.equal((await disabled.start()).prepared, false);

    const group = lab({ group: true });
    assert.equal((await group.start()).prepared, false);

    const held = lab();
    held.metadata.director = { fate: { version: 1, held: { id: 'h', title: '意外的回声', strength: 'medium', event: 'An event.', category: 'echo', rarity: 'common' } } };
    assert.equal((await held.start()).prepared, false);

    const offered = lab();
    await offered.round(`Reply.\n${blockFor()}`);
    assert.equal((await offered.start()).prepared, false);
    assert.equal((await offered.start('swipe')).prepared, false);
    assert.equal((await offered.start('regenerate')).prepared, false);
});

test('a malformed block keeps the faces and each pick falls back to one quiet draw', async () => {
    const fixture = lab();
    const request = await fixture.round(`Reply.\n${PIGGYBACK_MARKER}\n{"events": "wrong shape"}`);
    assert.ok(request.data);
    const offer = fixture.metadata.director.fate.offer;
    assert.equal(offer.cards.length, 3);
    assert.equal(offer.cards.every(card => !Object.hasOwn(card, 'event')), true);
    assert.equal(await fixture.controller.pick(0), true);
    assert.equal(fixture.quietCalls.length, 1);
    assert.equal(fixture.metadata.director.fate.held.event, 'QUIET_FALLBACK_EVENT');
});

test('a reply without the marker is untouched and still deals faces', async () => {
    const fixture = lab();
    await fixture.round('Just a normal reply.');
    assert.equal(fixture.context.chat[1].mes, 'Just a normal reply.');
    assert.deepEqual(fixture.repaints, []);
    const offer = fixture.metadata.director.fate.offer;
    assert.equal(offer.cards.length, 3);
    assert.equal(offer.cards.every(card => !Object.hasOwn(card, 'event')), true);
});

test('a stopped partial reply is stripped but never deals an offer', async () => {
    const fixture = lab();
    const request = await fixture.request();
    await fixture.emit('GENERATION_STOPPED');
    const message = await fixture.receive(`Half a story.\n${PIGGYBACK_MARKER}\n{"events": [{"cate`);
    assert.equal(message.mes, 'Half a story.');
    await fixture.complete(request.data);
    assert.equal(fixture.metadata.director?.fate?.offer ?? null, null);
});

test('a chat switch before completion drops the offer', async () => {
    const fixture = lab();
    const request = await fixture.request();
    await fixture.receive(`Reply.\n${blockFor()}`);
    fixture.switchChat();
    await fixture.complete(request.data);
    assert.equal(fixture.metadata.director?.fate ?? null, null);
});

test('a card drawn while the reply generates keeps the state; completion does not clobber it', async () => {
    const fixture = lab();
    const request = await fixture.request();
    await fixture.receive(`Reply.\n${blockFor()}`);
    fixture.metadata.director = { fate: { version: 1, held: { id: 'meanwhile', title: '秘密浮现', strength: 'light', event: 'Drawn meanwhile.', category: 'secret', rarity: 'rare' } } };
    await fixture.complete(request.data);
    assert.equal(fixture.metadata.director.fate.held.id, 'meanwhile');
    assert.equal(fixture.metadata.director.fate.offer ?? null, null);
});

test('a dry run restores the instruction but tracks nothing', async () => {
    const fixture = lab();
    await fixture.emit('GENERATION_STARTED', 'normal', {}, true);
    const requestChat = fixture.context.chat.map(message => ({ ...message }));
    assert.equal(fixture.controller.prepare('normal', requestChat), true);
    const token = requestChat.find(message => message.extra?.directorFatePiggyback).mes;
    const data = { prompt: token, input: token };
    await fixture.emit('GENERATE_AFTER_DATA', data, true);
    assert.equal(data.prompt.includes(PIGGYBACK_MARKER), true);
    await fixture.receive(`Reply.\n${blockFor()}`);
    await fixture.complete(data);
    assert.equal(fixture.metadata.director?.fate ?? null, null);
});

test('a failed offer save reports once and keeps the chat clean', async () => {
    const fixture = lab();
    fixture.setSaveResult(false);
    const request = await fixture.request();
    await fixture.receive(`Reply.\n${blockFor()}`);
    await fixture.complete(request.data);
    assert.equal(fixture.metadata.director?.fate ?? null, null);
    assert.equal(fixture.errors.length, 1);
    assert.equal(fixture.context.chat[1].mes, 'Reply.');
});

test('the block may ride in a swipe entry instead of mes', async () => {
    const fixture = lab();
    const request = await fixture.request();
    const message = await fixture.receive('Clean active text.', { swipes: ['Clean active text.', `Alt swipe.\n${blockFor()}`] });
    assert.deepEqual(message.swipes, ['Clean active text.', 'Alt swipe.']);
    await fixture.complete(request.data);
    assert.deepEqual(fixture.metadata.director.fate.offer.cards.map(card => card.event), privateEvents);
});

test('a message at another slot is never stripped', async () => {
    const fixture = lab();
    await fixture.request();
    fixture.context.chat.push({ is_user: true, name: 'User', mes: 'Another user line.' });
    const message = await fixture.receive(`Not the target.\n${blockFor()}`);
    assert.equal(message.mes, `Not the target.\n${blockFor()}`);
    assert.deepEqual(fixture.repaints, []);
});

test('a corrupt stored event drops the whole offer on read', async () => {
    const fixture = lab();
    await fixture.round(`Reply.\n${blockFor()}`);
    fixture.metadata.director.fate.offer.cards[0].event = 'x'.repeat(401);
    assert.equal(fixture.controller.view().offer, null);
    fixture.metadata.director.fate.offer.cards[0].event = privateEvents[0];
    assert.ok(fixture.controller.view().offer);
});

test('after an apply and the next user send, a new round piggybacks again', async () => {
    const fixture = lab();
    await fixture.round(`Reply.\n${blockFor()}`);
    assert.equal(await fixture.controller.pick(0), true);
    fixture.setGenerate(async () => {
        await fixture.emit('GENERATION_STARTED', 'normal', {}, false);
        const requestChat = fixture.context.chat.map(message => ({ ...message }));
        assert.equal(fixture.controller.prepare('normal', requestChat), true);
        const row = requestChat.find(message => message.extra?.directorFatePrompt);
        assert.ok(row, 'apply must inject the held event, not a piggyback instruction');
        assert.equal(requestChat.some(message => message.extra?.directorFatePiggyback), false);
        const data = { prompt: row.mes, input: row.mes };
        await fixture.emit('GENERATE_AFTER_DATA', data, false);
        assert.equal(data.input.includes(privateEvents[0]), true);
        await fixture.receive('The event happens.');
        await fixture.complete(data);
    });
    assert.equal(await fixture.controller.apply(), true);
    assert.ok(fixture.metadata.director.fate.bound);
    assert.equal(fixture.metadata.director.fate.held, null);
    // While the bound stands, an unsent normal generation does not piggyback.
    assert.equal((await fixture.start()).prepared, false);
    await fixture.emit('MESSAGE_SENT');
    const next = await fixture.request();
    assert.ok(next.data, 'after the bound clears, the next reply piggybacks again');
});

test('faces rolled for the instruction respect recent categories and pity', async () => {
    const fixture = lab();
    fixture.metadata.director = { fate: { version: 1, recent: ['echo', 'secret'], pity: 9 } };
    const { row } = await fixture.start();
    assert.ok(row);
    const data = { prompt: row.mes, input: row.mes };
    await fixture.emit('GENERATE_AFTER_DATA', data, false);
    const instruction = data.input;
    assert.equal(instruction.includes('category="echo"'), false);
    assert.equal(instruction.includes('category="secret"'), false);
    assert.equal((instruction.match(/第\d张: /g) ?? []).length, 3);
    // random() === 0 rolls three commons; pity >= 8 must upgrade one to rare.
    assert.equal(instruction.includes(RARITIES.rare.line), true);
});