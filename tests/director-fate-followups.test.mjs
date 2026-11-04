import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { EventEmitter } from '../public/lib/eventemitter.js';
import { createFateController } from '../public/scripts/extensions/director/fate.js';

globalThis.localStorage = { getItem: () => null };

for (const [text, attachment, expected] of [
    ['', false, false], ['  \n', false, false], ['Unsent draft', false, true],
    ['', true, true], ['  \n', true, true], ['Unsent draft', true, true],
]) {
    test(`S2 actual adoption guard checks draft ${JSON.stringify(text)} / attachment ${attachment}`, () => {
        const source = readFileSync(new URL('../public/scripts/extensions/director/index.js', import.meta.url), 'utf8');
        const declaration = source.match(/const hasDraft = [^;]+;/)?.[0];
        assert.ok(declaration, 'Missing shared controller/panel adoption guard');
        const hasDraft = new Function('document', 'hasPendingFileAttachment', `${declaration} return hasDraft;`)(
            { getElementById: () => ({ value: text }) }, () => attachment,
        );
        assert.equal(hasDraft(), expected);
    });
}

const eventTypes = Object.fromEntries([
    'CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED',
    'GENERATE_AFTER_DATA', 'GENERATION_COMPLETED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED',
    'MESSAGE_DELETED', 'GROUP_REGENERATION_STARTED', 'GROUP_REGENERATION_FINISHED',
].map(name => [name, name]));
const privateEvent = 'An unexpected messenger arrives with a sealed letter.';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function lab({ group = false, metadata = {}, save } = {}) {
    const eventSource = new EventEmitter();
    let response = JSON.stringify({ event: privateEvent });
    let saves = 0;
    let serial = 0;
    let generate = async () => {};
    const context = {
        eventSource, eventTypes, chatId: 'chat-one', chatMetadata: metadata,
        groupId: group ? 'group-one' : null, characterId: group ? undefined : 0,
        chat: [{ is_user: true, name: 'User', mes: 'Tell me what happens.' }],
        extensionPrompts: {},
        generateQuietPrompt: async () => response,
        saveMetadataDebounced: () => { saves++; },
    };
    const controller = createFateController(() => context, {
        uuid: () => `followup-${++serial}`, random: () => 0,
        save: async (...args) => { saves++; return save?.(...args); },
        generate: () => generate(),
    });
    const emit = (name, ...args) => eventSource.emit(eventTypes[name], ...args);
    const api = {
        controller, context, metadata, emit,
        get saves() { return saves; },
        setResponse(value) { response = value; },
        async request(type = 'normal') {
            await emit('GENERATION_STARTED', type, {}, false);
            const requestChat = context.chat.map(message => ({ ...message }));
            assert.equal(controller.prepare(type, requestChat), true);
            const token = requestChat.find(message => message.extra?.directorFatePrompt)?.mes;
            assert.ok(token);
            const data = { prompt: token };
            await emit('GENERATE_AFTER_DATA', data, false);
            assert.ok(data.prompt.includes(privateEvent));
            return data;
        },
        async complete(data, type = 'normal', { append = true, generationId = null } = {}) {
            const message = { is_user: false, name: 'Bot', mes: 'A successfully generated reply.',
                extra: generationId === null ? {} : { gen_id: generationId } };
            if (append) context.chat.push(message);
            else context.chat[context.chat.length - 1] = message;
            await emit('MESSAGE_RECEIVED', context.chat.length - 1);
            await emit('GENERATION_ENDED');
            await emit('GENERATION_COMPLETED', { data, type, chatId: context.chatId, chatMetadata: metadata });
        },
        async adopt({ generationId = null } = {}) {
            assert.equal(await controller.draw(), true);
            generate = async () => { await api.complete(await api.request(), 'normal', { generationId }); };
            assert.equal(await controller.apply(), true);
        },
    };
    return api;
}

for (const [name, raw, expected] of [
    ['explanation before and after', 'Here is the event:\n{"event":"A messenger arrives."}\nThis suits the current story.', 'A messenger arrives.'],
    ['a fenced object inside explanation', 'The card is ready.\n```json\n{"event":"A locked door opens."}\n```\nEnd of card.', 'A locked door opens.'],
    ['braces and escaped quotes inside the event', `Card:\n${JSON.stringify({ event: 'A note reads "{wait}" beside a \\ path and "quoted words".' })}\nFinished.`, 'A note reads "{wait}" beside a \\ path and "quoted words".'],
    ['an event ending with a literal backslash', `Card:\n${JSON.stringify({ event: 'The trail ends at a mark \\' })}\nFinished.`, 'The trail ends at a mark \\'],
    ['the first complete object before another object', 'First: {"event":"The first event."}\nSecond: {"event":"The later event."}', 'The first event.'],
    ['exactly 400 Unicode codepoints', JSON.stringify({ event: '🧭'.repeat(400) }), '🧭'.repeat(400)],
]) {
    test(`S1 draw extracts ${name}`, async () => {
        const fixture = lab();
        fixture.setResponse(raw);
        assert.equal(await fixture.controller.draw(), true);
        assert.equal(fixture.metadata.director.fate.held.event, expected);
        assert.equal(fixture.saves, 1);
        assert.equal(JSON.stringify(fixture.controller.view()).includes(expected), false);
    });
}

for (const [name, raw] of [
    ['empty output', ''],
    ['an empty object before a valid object', '{}\n{"event":"Do not select this later event."}'],
    ['a wrong event type before a valid object', '{"event":42}\n{"event":"Do not select this later event."}'],
    ['an invalid first JSON object before a valid object', '{"event":}\n{"event":"Do not select this later event."}'],
    ['an extra property before a valid object', '{"event":"secret","title":"spoiler"}\n{"event":"Do not select this later event."}'],
    ['a nested object in the wrong first object', '{"wrapper":{"event":"Do not select this nested event."}}\n{"event":"Do not select this later event."}'],
    ['an empty event', '{"event":"   "}'],
    ['401 Unicode codepoints', JSON.stringify({ event: '🧭'.repeat(401) })],
    ['a control character in the event', JSON.stringify({ event: 'secret\u0000event' })],
    ['an array', '[]'],
    ['null', 'null'],
]) {
    test(`S1 draw still rejects ${name}`, async () => {
        const fixture = lab();
        await fixture.controller.draw();
        const held = fixture.metadata.director.fate.held;
        fixture.setResponse(raw);
        await assert.rejects(fixture.controller.draw(), error => error.message === '命运牌抽取失败，请重试。');
        assert.equal(fixture.metadata.director.fate.held, held);
        assert.equal(fixture.saves, 1);
        assert.equal(fixture.controller.view().busy, false);
    });
}

test('S3 successful native swipe does not save an unchanged Fate binding again', async () => {
    const fixture = lab();
    await fixture.adopt();
    const before = structuredClone(fixture.metadata.director.fate);
    const savesBefore = fixture.saves;
    const request = await fixture.request('swipe');
    await fixture.complete(request, 'swipe', { append: false });
    assert.deepEqual(fixture.metadata.director.fate, before);
    assert.equal(fixture.saves, savesBefore);
});

test('S3 group replay still saves a changed generation ID', async () => {
    const fixture = lab({ group: true });
    await fixture.adopt({ generationId: 100 });
    const savesBefore = fixture.saves;
    const request = await fixture.request('swipe');
    await fixture.complete(request, 'swipe', { append: false, generationId: 200 });
    assert.equal(fixture.metadata.director.fate.bound.generationId, 200);
    assert.equal(fixture.saves, savesBefore + 1);
});

test('S4 failed Fate save preserves a concurrently added Director instruction binding', async () => {
    const saving = deferred();
    const persistence = deferred();
    const fixture = lab({ save: async () => { saving.resolve(); await persistence.promise; } });
    assert.equal(Object.hasOwn(fixture.metadata, 'director'), false);
    const drawing = fixture.controller.draw();
    await saving.promise;
    assert.equal(fixture.metadata.director.fate.held.event, privateEvent);
    const boundInstruct = { text: 'A concurrently bound Director instruction.', slotIndex: 1 };
    fixture.metadata.director.boundInstruct = boundInstruct;
    persistence.reject(new Error('synthetic persistence failure'));
    await assert.rejects(drawing, error => error.message === '命运牌抽取失败，请重试。');
    assert.equal(fixture.metadata.director?.fate, undefined);
    assert.equal(fixture.metadata.director?.boundInstruct, boundInstruct);
    assert.equal(fixture.controller.view().held, null);
    assert.equal(fixture.controller.view().busy, false);
});
