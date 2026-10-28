import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');

function declaration(source, name, kind = 'function') {
    const keyword = kind === 'function' ? '(?:async )?function' : kind;
    const start = source.search(new RegExp(`^(?:export )?${keyword} ${name}[({ ]`, 'm'));
    assert.notEqual(start, -1, `${name} must exist`);
    return source.slice(start, source.indexOf('\n}', start) + 2).replace(/^export /, '');
}

function element(classes = [], attributes = {}, parentElement = null) {
    const values = new Set(classes);
    const attrs = new Map(Object.entries(attributes));
    return {
        parentElement,
        classList: { contains: value => values.has(value), add: value => values.add(value) },
        matches: selector => selector.startsWith('.') && values.has(selector.slice(1)),
        closest(selector) {
            for (let node = this; node; node = node.parentElement) {
                if (selector.split(',').some(part => node.matches(part.trim()))) return node;
            }
            return null;
        },
        hasAttribute: name => attrs.has(name),
        getAttribute: name => attrs.get(name) ?? null,
        setAttribute: (name, value) => attrs.set(name, String(value)),
        removeAttribute: name => attrs.delete(name),
    };
}

function keyboard(collection = []) {
    const context = vm.createContext({
        CSS: { supports: () => false },
        MutationObserver: class { observe() {} },
        document: {
            body: {}, addEventListener() {},
            querySelectorAll: selector => ['.interactable', '.extension-control'].includes(selector) ? collection : [],
        },
    });
    vm.runInContext(read('scripts/keyboard.js').replace(/^export /gm, ''), context);
    return context;
}

test('variadic keyboard wrapper preserves order, custom classes and tabindex state', () => {
    const context = keyboard();
    const custom = element([], { tabindex: '7' });
    const parent = element(['disabled']);
    const disabled = element(['interactable'], { tabindex: '3' }, parent);
    const normal = element(['interactable']);
    assert.equal(context.makeKeyboardInteractable(), undefined);
    assert.equal(context.makeKeyboardInteractable(custom, disabled, normal), undefined);
    assert.equal(custom.classList.contains('custom_interactable'), true);
    assert.equal(custom.classList.contains('interactable'), true);
    assert.equal(custom.getAttribute('tabindex'), '7');
    assert.equal(disabled.hasAttribute('tabindex'), false);
    assert.equal(disabled.getAttribute('data-original-tabindex'), '3');
    assert.equal(normal.getAttribute('tabindex'), '0');
    disabled.parentElement = null;
    context.makeKeyboardInteractable(disabled);
    assert.equal(disabled.getAttribute('tabindex'), '3');

    const writes = [];
    const repeated = element(['interactable']);
    repeated.hasAttribute = () => false;
    repeated.setAttribute = (name, value) => writes.push([name, value]);
    context.makeKeyboardInteractable(repeated, repeated);
    assert.deepEqual(writes, [['tabindex', '0'], ['tabindex', '0']]);
});

test('keyboard initialization and extension registration iterate 300k controls without argument spread', () => {
    let visits = 0;
    const control = element(['interactable']);
    control.hasAttribute = name => { visits++; return control.getAttribute(name) !== null; };
    const controls = Array(300000).fill(control);
    const context = keyboard(controls);
    context.initKeyboard();
    assert.equal(visits, controls.length);
    visits = 0;
    // A NodeList-like iterable with forEach, deliberately not an Array.
    const nodeList = { [Symbol.iterator]: () => controls.values(), forEach: callback => controls.forEach(callback) };
    context.document.querySelectorAll = () => nodeList;
    context.registerInteractableType('.extension-control', { notFocusableByDefault: true });
    assert.equal(control.classList.contains('not_focusable'), true);
    assert.equal(control.getAttribute('tabindex'), null);
    // Disabled controls do not call hasAttribute; exercise the enabled NodeList too.
    const enabled = element(['interactable']);
    enabled.hasAttribute = () => { visits++; return true; };
    controls.fill(enabled);
    visits = 0;
    context.registerInteractableType('.extension-control');
    assert.equal(visits, controls.length);
});

test('displayed-message minimum handles 300k DOM IDs and retains empty/NaN/signed-zero semantics', () => {
    let ids = [];
    const context = vm.createContext({ document: { querySelectorAll: () => ids.map(id => ({ getAttribute: () => id })) } });
    vm.runInContext(declaration(read('script.js'), 'getFirstDisplayedMessageId'), context);
    for (const values of [[], ['NaN'], ['7', '2', '-1'], ['-0', '0'], ['Infinity', '-Infinity']]) {
        ids = values;
        const expected = Math.min(...values.map(Number).filter(x => !isNaN(x)));
        assert.equal(context.getFirstDisplayedMessageId(), expected);
    }
    ids = Array.from({ length: 300000 }, (_, i) => String(300000 - i));
    assert.equal(context.getFirstDisplayedMessageId(), 1);
});

test('neutral chat restoration keeps array identity and message order for 300k messages', () => {
    const messages = Array.from({ length: 300000 }, (_, i) => ({ mes: String(i) }));
    const chat = [{ mes: 'old' }];
    const seen = [];
    const context = vm.createContext({
        this_chid: undefined, selected_group: null, name2: 'Assistant', neutralCharacterName: 'Assistant',
        NEUTRAL_CHAT_KEY: 'neutralChat', chat,
        sessionStorage: { getItem: () => JSON.stringify({ chat: messages, chat_metadata: { key: 'value' } }), removeItem: key => seen.push(key) },
        updateChatMetadata: (metadata, reset) => seen.push({ ...metadata, reset }),
    });
    vm.runInContext(declaration(read('scripts/chats.js'), 'restoreNeutralChat'), context);
    context.restoreNeutralChat();
    assert.equal(context.chat, chat);
    assert.deepEqual(JSON.parse(JSON.stringify(chat)), messages);
    assert.deepEqual(seen, [{ key: 'value', reset: true }, 'neutralChat']);
});

test('reply swipe append preserves aliased input, array identity and render event arguments', async () => {
    const events = [];
    const swipes = ['original'];
    const message = { mes: 'original', extra: {}, swipe_id: 0, swipes, swipe_info: [] };
    const context = vm.createContext({
        chat: [message], characters: [], this_chid: 0, generation_started: null, power_user: {}, structuredClone,
        console: { debug() {} }, getMessageTimeStamp: () => 'fixed',
        getGeneratingApi: () => 'synthetic', getGeneratingModel: () => 'synthetic',
        processImageAttachment: async () => {}, parseReasoningInSwipes() {}, statMesProcess() {},
        event_types: { MESSAGE_RECEIVED: 'received', CHARACTER_MESSAGE_RENDERED: 'rendered' },
        eventSource: { emit: async (...args) => events.push(args) },
        addOneMessage: (item, options) => { assert.equal(item, message); events.push(['render', options.type]); },
    });
    vm.runInContext(declaration(read('script.js'), 'saveReply'), context);
    await context.saveReply({ type: 'append', getMessage: ' continued', swipes });
    assert.equal(message.swipes, swipes);
    assert.deepEqual(swipes, ['original continued', 'original continued']);
    assert.equal(message.swipe_info.length, 2);
    assert.deepEqual(events, [['received', 0, 'append'], ['render', 'swipe'], ['rendered', 0, 'append']]);
});

test('message flattening and API chat assembly retain order and fields for 300k messages', () => {
    const source = read('scripts/openai.js');
    const context = vm.createContext({ Message: class {} });
    vm.runInContext(`${declaration(source, 'MessageCollection', 'class')}\n${declaration(source, 'ChatCompletion', 'class')}`, context);
    const result = vm.runInContext(`(() => {
        const nested = new MessageCollection('history');
        nested.collection = Array.from({ length: 300000 }, (_, i) => Object.assign(new Message(), { role: 'user', content: String(i), identifier: i }));
        const root = new MessageCollection('root', nested);
        const completion = new ChatCompletion();
        completion.messages = root;
        return { flat: root.flatten(), chat: completion.getChat(), original: nested.collection };
    })()`, context);
    assert.equal(result.flat.length, 300000);
    assert.equal(result.chat.length, 300000);
    for (let i = 0; i < result.flat.length; i++) {
        assert.equal(result.flat[i], result.original[i]);
        assert.equal(result.chat[i].content, String(i));
        assert.equal(result.chat[i].role, 'user');
    }
});
