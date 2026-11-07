import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await fs.readFile(new URL('../public/script.js', import.meta.url), 'utf8');
const olderSource = source.slice(source.indexOf('let olderMessagesLoading ='), source.indexOf('\nexport async function printMessages')).replaceAll('export ', '');
const deletionSource = source.slice(source.indexOf('export async function deleteLastMessage()'), source.indexOf('\nfunction getMessageDeletionStartId')).replace('export ', '');

function fixture({ buttonInView = false } = {}) {
    let now = 0;
    let shift = 0;
    let rectReads = 0;
    let heightReads = 0;
    let insertCount = 0;
    let scrollHeight = 1000;
    const inserted = [];
    const created = [];
    const yields = [];
    const rect = () => {
        rectReads++;
        return { top: 30 + shift - container.scrollTop, bottom: 130 + shift - container.scrollTop };
    };
    const messages = [40, 41].map(id => ({
        isConnected: true,
        getAttribute: () => String(id),
        getBoundingClientRect: rect,
    }));
    const container = {
        scrollTop: 0,
        get scrollHeight() {
            heightReads++;
            return scrollHeight;
        },
        querySelector: () => messages[0],
        querySelectorAll: () => messages,
        getBoundingClientRect: rect,
        insertBefore(fragment, before) {
            assert.equal(before, messages[0]);
            insertCount++;
            inserted.push(...fragment.items);
            shift += 500;
            scrollHeight += 500;
        },
    };
    const events = [];
    const context = vm.createContext({
        globalThis: { scheduler: { yield: async () => { yields.push(created.at(-1).items.length); } } },
        performance: { now: () => now },
        document: {
            createDocumentFragment() {
                const fragment = { items: [], append(value) { this.items.push(value); } };
                created.push(fragment);
                return fragment;
            },
            getElementById: () => ({ id: 'show_more_messages' }),
        },
        isElementInViewport: () => buttonInView,
        characterChatLoadSerial: 0, this_chid: 0, selected_group: null, chat_metadata: {},
        currentChatId: 'history', getCurrentChatId: () => context.currentChatId,
        chat: Array.from({ length: 42 }, (_, id) => ({ id })),
        chatElement: { 0: container, children: () => ({ last: () => ({ remove() {} }) }) },
        createMessageRenderContext: () => ({}),
        updateMessageElement(message, { messageId }) {
            assert.equal(message.id, messageId);
            now += messageId % 3 === 0 ? 7 : 3;
            return [messageId];
        },
        power_user: { chat_truncation: 40 },
        clamp: (value, min, max) => Math.min(Math.max(value, min), max),
        getLastMessageId: () => 41,
        refreshSwipeButtons() {}, applyStylePins() {},
        $: () => ({ remove() {} }),
        deleteItemizedPromptForMessage() {},
        eventSource: { emit: async name => { events.push(name); } },
        event_types: { MORE_MESSAGES_LOADED: 'older', MESSAGE_DELETED: 'deleted' },
    });
    vm.runInContext(olderSource + '\n' + deletionSource, context);
    return {
        context, inserted, created, yields, events, container,
        get insertCount() { return insertCount; },
        get rectReads() { return rectReads; },
        get heightReads() { return heightReads; },
    };
}

test('older preparation stays off-DOM, uses elapsed work and preserves order', async () => {
    const f = fixture({ buttonInView: true });
    const fragment = await vm.runInContext('prepareOlderMessageFragment(0, 40)', f.context);
    assert.equal(f.insertCount, 0);
    assert.equal(f.rectReads, 0);
    assert.deepEqual(fragment.items, Array.from({ length: 40 }, (_, i) => i));
    const sizes = [];
    let previous = 0;
    for (const count of f.yields) {
        sizes.push(count - previous);
        previous = count;
    }
    sizes.push(40 - previous);
    assert.equal(f.yields.length, sizes.length - 1);
    // The last slice can be shorter; earlier boundaries depend on variable cost.
    assert.ok(new Set(sizes.slice(0, -1)).size > 1);
    assert.ok(f.yields.every(count => count > 0 && count < 40));
});

test('one live insertion corrects scroll only while the show-more button is in view', async () => {
    const visible = fixture({ buttonInView: true });
    await visible.context.showMoreMessages(40);
    assert.equal(visible.insertCount, 1);
    assert.deepEqual(visible.inserted, Array.from({ length: 40 }, (_, i) => i));
    assert.equal(visible.rectReads, 0);
    assert.equal(visible.heightReads, 2);
    assert.equal(visible.container.scrollTop, 500);
    assert.deepEqual(visible.events, ['older']);

    const hidden = fixture({ buttonInView: false });
    await hidden.context.showMoreMessages(40);
    assert.equal(hidden.insertCount, 1);
    assert.equal(hidden.rectReads, 0);
    assert.equal(hidden.heightReads, 0);
    assert.equal(hidden.container.scrollTop, 0);
});

test('duplicate trigger is ignored and mutation waits; completion listeners can mutate', async () => {
    const f = fixture();
    let resume;
    let started = 0;
    f.context.pauseRender = () => { started++; return new Promise(resolve => { resume = () => resolve({ items: [] }); }); };
    vm.runInContext('prepareOlderMessageFragment = pauseRender', f.context);
    const first = f.context.showMoreMessages();
    await f.context.showMoreMessages();
    const deletion = f.context.deleteLastMessage();
    assert.equal(started, 1);
    assert.equal(f.context.chat.length, 42);
    assert.deepEqual(f.events, []);
    f.context.eventSource.emit = async name => {
        f.events.push(name);
        if (name === 'older') await f.context.deleteLastMessage();
    };
    resume();
    await Promise.all([first, deletion]);
    assert.equal(f.context.chat.length, 40);
    assert.equal(f.events.filter(name => name === 'older').length, 1);
});

test('render failure releases mutation waiters and permits another load without completion event', async () => {
    const f = fixture();
    f.context.fail = async () => { throw new Error('render failed'); };
    vm.runInContext('prepareOlderMessageFragment = fail', f.context);
    await assert.rejects(f.context.showMoreMessages(), /render failed/);
    await f.context.deleteLastMessage();
    assert.equal(f.context.chat.length, 41);
    assert.deepEqual(f.events, ['deleted']);
    vm.runInContext('prepareOlderMessageFragment = async () => document.createDocumentFragment()', f.context);
    await f.context.showMoreMessages();
    assert.deepEqual(f.events, ['deleted', 'older']);
});

test('MessageChannel fallback yields a task and closes both ports', async () => {
    const f = fixture();
    let closed = 0;
    let posted = 0;
    f.context.globalThis.scheduler = undefined;
    f.context.MessageChannel = class {
        constructor() {
            this.port1 = { close() { closed++; } };
            this.port2 = { close() { closed++; }, postMessage: () => { posted++; queueMicrotask(() => this.port1.onmessage()); } };
        }
    };
    const pending = vm.runInContext('yieldOlderMessages()', f.context);
    assert.equal(posted, 1);
    assert.equal(closed, 0);
    await pending;
    assert.equal(closed, 2);
});

test('explicit older count and default truncation load exactly the requested IDs', async () => {
    for (const count of [null, 7]) {
        const f = fixture();
        await f.context.showMoreMessages(count);
        const firstId = count === null ? 0 : 33;
        assert.deepEqual(f.inserted, Array.from({ length: 40 - firstId }, (_, i) => firstId + i));
        assert.deepEqual(f.events, ['older']);
    }
});

test('send already awaiting an attachment rechecks the insertion barrier before changing the model', async () => {
    const f = fixture();
    const start = source.indexOf('export async function sendMessageAsUser(');
    const end = source.indexOf('\n}', start) + 2;
    vm.runInContext(source.slice(start, end).replace('export ', ''), f.context);
    let attach;
    let render;
    let saved;
    Object.assign(f.context, {
        name1: 'Synthetic', user_avatar: 'synthetic.png', characters: [], this_chid: 0,
        getRegexedString: text => text, regex_placement: { USER_INPUT: 1 },
        getMessageTimeStamp: () => 'fixed-time', substituteParams: text => text,
        populateFileAttachment: () => new Promise(resolve => { attach = resolve; }),
        statMesProcess() {}, chat_metadata: {},
        saveChatConditional: async () => { saved = JSON.parse(JSON.stringify(f.context.chat)); },
        addOneMessage() {},
        pauseRender: () => new Promise(resolve => { render = () => resolve({ items: [] }); }),
    });
    f.context.power_user.personas = {};
    const sending = f.context.sendMessageAsUser('queued send');
    vm.runInContext('prepareOlderMessageFragment = pauseRender', f.context);
    const loading = f.context.showMoreMessages();
    attach();
    await Promise.resolve();
    assert.equal(f.context.chat.length, 42);
    assert.equal(saved, undefined);
    render();
    await Promise.all([loading, sending]);
    assert.equal(f.context.chat.length, 43);
    assert.equal(saved.length, 43);
    assert.equal(saved.at(-1).mes, 'queued send');
    assert.equal(f.events.filter(name => name === 'older').length, 1);
});

test('Tab recorder captures each Tab after dispatch and removes its listener', async () => {
    let listener;
    let descriptor = 'before dispatch';
    const window = {
        addEventListener(name, callback, capture) {
            assert.equal(name, 'keyup');
            assert.equal(capture, true);
            listener = callback;
        },
        removeEventListener(name, callback, capture) {
            assert.equal(name, 'keyup');
            assert.equal(capture, true);
            assert.equal(callback, listener);
            listener = null;
        },
    };
    const probe = await fs.readFile(new URL('./longchat-browser-probe.mjs', import.meta.url), 'utf8');
    const start = probe.indexOf('export function beginTabRecording()');
    const end = probe.indexOf('export async function prepareTabScenario', start);
    const context = vm.createContext({ window, queueMicrotask, focusDescriptor: () => descriptor });
    vm.runInContext(probe.slice(start, end).replaceAll('export ', ''), context);
    context.beginTabRecording();
    listener({ key: 'Enter' });
    listener({ key: 'Tab' });
    descriptor = 'after dispatch';
    assert.equal(window.labTabSequence.length, 0);
    await Promise.resolve();
    listener({ key: 'Tab' });
    descriptor = 'second dispatch';
    await Promise.resolve();
    assert.deepEqual(Array.from(context.finishTabRecording()), ['after dispatch', 'second dispatch']);
    assert.equal(listener, null);
    assert.equal(window.labTabSequence.length, 0);
});

test('older-load queue covers structural mutations and not displayed-message edits', () => {
    const between = (startMarker, endMarker) => {
        const start = source.indexOf(startMarker);
        assert.ok(start >= 0, startMarker);
        const end = source.indexOf(endMarker, start + startMarker.length);
        assert.ok(end > start, endMarker);
        return source.slice(start, end);
    };
    for (const marker of [
        'export async function redisplayChat(',
        'export async function clearChat(',
        'export async function deleteLastMessage(',
        'export async function deleteMessage(',
        'export async function Generate(',
        'export async function sendMessageAsUser(',
    ]) {
        assert.match(between(marker, '\nexport '), /if \(olderMessagesInsertion\) await olderMessagesInsertion;/);
    }
    const gate = /if \(olderMessagesInsertion\) await olderMessagesInsertion;/g;
    assert.equal(between('export async function sendMessageAsUser(', '\nexport ').match(gate).length, 2);
    assert.equal(between('export async function deleteMessage(', '\nexport ').match(gate).length, 2);
    assert.match(between("$('#dialogue_del_mes_ok')", "$('#main_api')"), /olderMessagesInsertion/);
    for (const [startMarker, endMarker] of [
        ['async function messageEditAuto(', 'export async function messageEdit('],
        ['export async function messageEdit(', 'async function messageEditCancel('],
        ['async function messageEditCancel(', 'async function messageEditMove('],
        ['async function messageEditMove(', 'async function messageEditDone('],
        ['async function messageEditDone(', 'export async function getChatsFromFiles('],
        ["$(document).on('click', '.mes_edit_copy'", "$(document).on('click', '.mes_edit_delete'"],
    ]) {
        assert.doesNotMatch(between(startMarker, endMarker), /olderMessagesInsertion/);
    }
});

test('concurrent older scenario hooks preparation yield instead of a partial insertion', async () => {
    const probe = await fs.readFile(new URL('./longchat-browser-probe.mjs', import.meta.url), 'utf8');
    const concurrent = probe.slice(probe.indexOf('export async function concurrentOlderSend'));
    assert.match(concurrent, /scheduler\.yield/);
    assert.match(concurrent, /did not trigger during preparation/);
    assert.doesNotMatch(concurrent, /MutationObserver/);
});

for (const [label, invalidate] of [
    ['same-file reload serial', c => { c.characterChatLoadSerial++; }],
    ['character', c => { c.this_chid = 1; }],
    ['group', c => { c.selected_group = 'another-group'; }],
    ['chat file', c => { c.currentChatId = 'another-file'; }],
    ['metadata owner', c => { c.chat_metadata = {}; }],
    ['array replacement', c => { c.chat = Array.from(c.chat); }],
    ['message count', c => { c.chat.pop(); }],
]) {
    test(`stale preparation discards its fragment after changing ${label}`, async () => {
        const f = fixture();
        let changed = false;
        f.context.globalThis.scheduler.yield = async () => {
            if (!changed) { changed = true; invalidate(f.context); }
        };
        await f.context.showMoreMessages();
        assert.equal(changed, true);
        assert.equal(f.insertCount, 0);
        assert.deepEqual(f.events, []);
        assert.ok(f.created[0].items.length < 40, 'stop rendering after the first stale slice');
        assert.equal(vm.runInContext('olderMessagesInsertion', f.context), null);
        assert.equal(vm.runInContext('olderMessagesLoading', f.context), false);
    });
}

test('ownership is checked again after preparation resolves and before insertion', async () => {
    const f = fixture();
    f.context.finishStale = async () => {
        f.context.currentChatId = 'another-file';
        return { items: [] };
    };
    vm.runInContext('prepareOlderMessageFragment = finishStale', f.context);
    await f.context.showMoreMessages();
    assert.equal(f.insertCount, 0);
    assert.deepEqual(f.events, []);
});
