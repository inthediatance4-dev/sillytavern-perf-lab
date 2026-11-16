import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHostEventBridge } from '../public/scripts/plugin-runtime/host-events.js';
import { createFateController } from '../public/scripts/extensions/director/fate.js';
import { rollOffer } from '../public/scripts/extensions/director/fate-decks.js';
import { PIGGYBACK_MARKER } from '../public/scripts/extensions/director/fate-piggyback.js';

class NativeEvents {
    listeners = new Map();
    on(type, fn) { const list = this.listeners.get(type) ?? []; list.push(fn); this.listeners.set(type, list); }
    removeListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== fn)); }
    makeFirst(type, fn) { this.removeListener(type, fn); this.listeners.set(type, [fn, ...(this.listeners.get(type) ?? [])]); }
    async emit(type, ...args) { for (const fn of [...(this.listeners.get(type) ?? [])]) await fn(...args); }
}
const names = Object.fromEntries(['GENERATION_STARTED', 'GENERATE_AFTER_DATA', 'MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED',
    'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHAT_CHANGED'].map(name => [name, name]));
const source = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
const start = source.indexOf('export async function saveReply(');
const nativeSaveReply = source.slice(start, source.indexOf('\n}', start) + 2).replace(/^export /, '');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

function harness() {
    let serial = 0;
    const native = new NativeEvents();
    const context = { eventSource: native, eventTypes: names, groupId: null, characterId: 0,
        chatId: 'stock-fixture', chatMetadata: {}, characters: [{ name: 'Bot', avatar: 'fixture.png', chat: 'stock-fixture' }],
        chat: [{ name: 'User', is_user: true, mes: 'Tell a story.', extra: {} }], extensionPrompts: {}, saveMetadataDebounced() {} };
    const written = [];
    const target = { fetch: async (input, init = {}) => {
        if (String(input).includes('/chats/')) {
            const body = new Headers(init.headers).get('Content-Encoding') === 'gzip' ? gunzipSync(Buffer.from(init.body)).toString() : init.body;
            written.push(JSON.parse(body));
            return new Response('{}');
        }
        return new Response('{"choices":[{"message":{"content":"Story."}}]}');
    } };
    const bridge = createHostEventBridge(() => context, {}, {}, { uuid: () => `request-${++serial}`, fetchTarget: target });
    const current = () => ({ ...context, eventSource: bridge.eventSource, eventTypes: bridge.eventTypes });
    const controller = createFateController(current, { piggyback: () => true, random: () => 0,
        registerReplySanitizer: (...args) => bridge.registerReplySanitizer?.(...args),
        uuid: () => `card-${++serial}`, save: async () => true });
    const completed = [];
    bridge.eventSource.on(bridge.eventTypes.GENERATION_COMPLETED, payload => { completed.push(payload); });
    const cards = rollOffer(() => 0, { recent: [], pity: 0 });
    const block = PIGGYBACK_MARKER + '\n' + JSON.stringify({ events: cards.map((card, index) => ({
        category: card.category, title: card.title, event: `PRIVATE_STOCK_EVENT_${index}` })) });
    const sandbox = vm.createContext({ chat: context.chat, name2: 'Bot', selected_group: null,
        characters: context.characters, this_chid: 0, generation_started: null, power_user: {}, structuredClone,
        console: { debug() {}, trace() {} }, getMessageTimeStamp: () => 'fixed', getGeneratingApi: () => 'fixture', getGeneratingModel: () => 'fixture',
        processImageAttachment: async () => {}, parseReasoningInSwipes() {}, statMesProcess() {},
        event_types: names, eventSource: native, addOneMessage() {} });
    // Exercise the production append order with the stock host's event availability.
    // Real unmodified official source is exercised separately by the browser runner.
    vm.runInContext(nativeSaveReply, sandbox);
    async function generate(primaryBlock, extraBlock) {
        await native.emit(names.GENERATION_STARTED, 'normal', {}, false);
        const chat = context.chat.map(message => ({ ...message }));
        bridge.prepare('normal', chat); controller.prepare('normal', chat);
        const data = { prompt: chat.map(message => message.mes).join('\n') };
        await native.emit(names.GENERATE_AFTER_DATA, data, false);
        await target.fetch('/api/backends/chat-completions/generate', { method: 'POST', body: JSON.stringify(data) });
        await sandbox.saveReply({ type: 'normal', getMessage: 'Story.' + (primaryBlock ? '\n' + block : ''),
            swipes: extraBlock ? ['Alternate.\n' + block] : [] });
        return data;
    }
    function body() { return { file_name: context.chatId, avatar_url: 'fixture.png',
        chat: [{ chat_metadata: context.chatMetadata }, ...structuredClone(context.chat)] }; }
    async function save(payload = body(), gzip = false) {
        await target.fetch('/api/chats/save', { method: 'POST', body: gzip ? gzipSync(JSON.stringify(payload)) : JSON.stringify(payload),
            headers: gzip ? { 'Content-Encoding': 'gzip' } : {} });
        await flush();
    }
    return { context, native, bridge, controller, block, written, completed, generate, save, body };
}

test('stock successful primary cleanup still receives exactly one strictly matched completion and offer', async () => {
    const h = harness();
    const data = await h.generate(true, false);
    assert.equal(h.context.chat.at(-1).mes, 'Story.');
    await h.save();
    assert.equal(h.completed.length, 1);
    assert.equal(h.completed[0].data, data);
    assert.deepEqual(h.context.chatMetadata.director.fate.offer.cards.map(card => card.event),
        ['PRIVATE_STOCK_EVENT_0', 'PRIVATE_STOCK_EVENT_1', 'PRIVATE_STOCK_EVENT_2']);
    await h.save(); assert.equal(h.completed.length, 1);
    h.bridge.dispose();
});

for (const gzip of [false, true]) test(`stock post-append candidate and reasoning are scrubbed before ${gzip ? 'gzip' : 'plain'} HTTP write`, async () => {
    const h = harness();
    await h.generate(false, true);
    h.context.chat.at(-1).swipe_info[1].extra.reasoning = 'Thinking.\n' + h.block;
    await h.save(h.body(), gzip);
    assert.doesNotMatch(JSON.stringify(h.written), /DIRECTOR_FATE_OFFER|PRIVATE_STOCK_EVENT/);
    assert.deepEqual(Array.from(h.context.chat.at(-1).swipes), ['Story.', 'Alternate.']);
    assert.equal(h.context.chat.at(-1).swipe_info[1].extra.reasoning, 'Thinking.');
    assert.equal(h.context.chatMetadata.director.fate.offer.cards.length, 3);
    h.bridge.dispose();
});

test('a foreign-owner save cannot authorize cleanup or a success receipt', async () => {
    const h = harness();
    await h.generate(false, true);
    const foreign = h.body(); foreign.avatar_url = 'someone-else.png';
    await h.save(foreign);
    assert.equal(h.completed.length, 0);
    assert.match(JSON.stringify(h.written[0]), /PRIVATE_STOCK_EVENT/);
    assert.equal(h.context.chatMetadata.director?.fate?.offer, undefined);
    h.bridge.dispose();
});

test('a captured old-chat save is scrubbed after switching without touching the new chat or granting a receipt', async () => {
    const h = harness();
    await h.generate(false, true);
    const pending = h.save(h.body(), true);
    h.context.chatId = 'new-chat'; h.context.chatMetadata = {}; h.context.chat = [];
    await h.native.emit(names.CHAT_CHANGED, 'new-chat');
    await pending;
    assert.doesNotMatch(JSON.stringify(h.written[0].chat.slice(1)), /DIRECTOR_FATE_OFFER|PRIVATE_STOCK_EVENT/);
    assert.equal(h.completed.length, 0);
    assert.deepEqual(h.context.chatMetadata, {});
    assert.equal(h.context.chat.length, 0);
    h.bridge.dispose();
});

test('two already captured saves are both scrubbed even after the first completion consumes the request', async () => {
    const h = harness();
    await h.generate(false, true);
    const first = h.body(); const second = structuredClone(first);
    await Promise.all([h.save(first), h.save(second, true)]);
    assert.equal(h.written.length, 2);
    assert.ok(h.written.every(body => !JSON.stringify(body.chat.slice(1)).includes(PIGGYBACK_MARKER)));
    assert.equal(h.completed.length, 1);
    assert.equal(h.context.chatMetadata.director.fate.offer.cards.length, 3);
    h.bridge.dispose();
});

test('an old snapshot reaching fetch only after compression and chat switch remains private', async () => {
    const h = harness();
    await h.generate(false, true);
    const oldBody = h.body();
    h.context.chatId = 'new-chat'; h.context.chatMetadata = {}; h.context.chat = [];
    await h.native.emit(names.CHAT_CHANGED, 'new-chat');
    await h.save(oldBody, true);
    assert.doesNotMatch(JSON.stringify(h.written[0].chat.slice(1)), /DIRECTOR_FATE_OFFER|PRIVATE_STOCK_EVENT/);
    assert.equal(h.completed.length, 0);
    assert.equal(h.context.chat.length, 0);
    h.bridge.dispose();
});

test('private piggyback instructions stay out of the actual native WI input filter', () => {
    const expression = source.match(/const chatForWI = (.*);/)[1];
    const sandbox = vm.createContext({ world_info_include_names: false, coreChat: [
        { name: 'User', mes: 'Story.' }, { name: 'Narrator', mes: 'PRIVATE_TASK', extra: { directorFatePiggyback: true } },
    ] });
    const result = vm.runInContext(expression, sandbox);
    assert.equal(result.includes('PRIVATE_TASK'), false);
    assert.equal(result.includes('Story.'), true);
});
