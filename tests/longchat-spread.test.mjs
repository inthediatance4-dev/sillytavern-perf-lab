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

// Keep each changed call site explicit: 19 in P1-1 minus the three reverted in M1.
// Complex UI/loader functions are tested by extracting their changed statements,
// including empty operands that the surrounding product guards normally skip.
function statements(file, first, last = first) {
    const source = read(file);
    const start = source.indexOf(first);
    assert.notEqual(start, -1, `${file}: ${first} must exist`);
    assert.equal(source.indexOf(first, start + first.length), -1, `${file}: start must be unique`);
    const end = source.indexOf(last, start);
    assert.notEqual(end, -1, `${file}: ${last} must exist`);
    return source.slice(start, end + last.length);
}

const swipeAppendSites = [
    ['StreamingProcessor swipe payload', 'for (const swipe of [...this.swipes]) message.swipes.push(swipe);', 'message.swipes', 'this.swipes'],
    ['StreamingProcessor swipe metadata', 'for (const swipeInfo of swipeInfoArray) message.swipe_info.push(swipeInfo);', 'message.swipe_info', 'swipeInfoArray'],
    ['saveReply swipe payload', 'for (const swipe of [...swipes]) item.swipes.push(swipe);', 'item.swipes', 'swipes'],
    ['saveReply swipe metadata', 'for (const swipeInfo of swipeInfoArray) item.swipe_info.push(swipeInfo);', 'item.swipe_info', 'swipeInfoArray'],
];

const chatReplacementSites = [
    ['getChat loaded history', 'script.js', 'data'],
    ['getGroupChat loaded history', 'scripts/group-chats.js', 'data'],
    ['assistant-note import history', 'scripts/chats.js', 'messages'],
];

// Minimal DOM child-move semantics; fragments contribute their children, not a node.
function childContainer(children = [], fragment = false) {
    const container = {
        children: [], fragment, replacements: 0,
        append(...nodes) {
            for (const node of nodes) {
                if (node.fragment) {
                    this.append(...node.children.slice());
                    continue;
                }
                if (node.parentNode) {
                    const siblings = node.parentNode.children;
                    siblings.splice(siblings.indexOf(node), 1);
                }
                this.children.push(node);
                node.parentNode = this;
            }
        },
        replaceChildren(...nodes) {
            this.replacements++;
            for (const child of this.children) child.parentNode = null;
            this.children = [];
            this.append(...nodes);
        },
    };
    container.append(...children);
    return container;
}

for (const count of [0, 1]) {
    const edge = count === 0 ? 'empty' : 'single-element';

    for (const [site, statement, destination, input] of swipeAppendSites) {
        test(`${site}: ${edge} append matches spread`, () => {
            const before = { original: true };
            const value = { added: true };
            const values = count ? [value] : [];
            const actual = [before];
            const expected = [before];
            expected.push(...values);
            const message = { swipes: actual, swipe_info: actual };
            const context = vm.createContext({ message, item: message, swipes: values, swipeInfoArray: values });
            vm.runInContext(statements('script.js', statement), context);
            assert.deepEqual(actual, expected);
            assert.equal(vm.runInContext(destination, context), actual);
            assert.equal(vm.runInContext(input, context).length, count);
            assert.equal(actual[0], before);
            if (count) assert.equal(actual[1], value);
        });
    }

    for (const [site, file, input] of chatReplacementSites) {
        test(`${site}: ${edge} replacement matches splice spread`, () => {
            const message = { mes: 'loaded' };
            const values = count ? [message] : [];
            const chat = [{ mes: 'stale' }];
            const expected = chat.slice();
            expected.splice(0, expected.length, ...values);
            // Include the clear as well as the loop: empty replacement clears old data.
            const source = read(file);
            const last = `for (const message of ${input}) chat.push(message);`;
            const end = source.indexOf(last);
            assert.notEqual(end, -1);
            assert.equal(source.indexOf(last, end + last.length), -1);
            const start = source.lastIndexOf('chat.splice(0, chat.length);', end);
            assert.notEqual(start, -1);
            const context = vm.createContext({ chat, [input]: values });
            vm.runInContext(source.slice(start, end + last.length), context);
            assert.equal(context.chat, chat);
            assert.deepEqual(chat, expected);
            assert.equal(values.length, count);
            if (count) assert.equal(chat[0], message);
        });
    }

    test(`restoreNeutralChat: ${edge} replacement matches splice spread`, () => {
        const values = count ? [{ mes: 'neutral' }] : [];
        const chat = [{ mes: 'stale' }];
        const expected = chat.slice();
        expected.splice(0, expected.length, ...values);
        const seen = [];
        const context = vm.createContext({
            this_chid: undefined, selected_group: null, name2: 'Assistant', neutralCharacterName: 'Assistant',
            NEUTRAL_CHAT_KEY: 'neutralChat', chat,
            sessionStorage: {
                getItem: () => JSON.stringify({ chat: values, chat_metadata: { edge } }),
                removeItem: key => seen.push(key),
            },
            updateChatMetadata: (metadata, reset) => seen.push({ ...metadata, reset }),
        });
        vm.runInContext(declaration(read('scripts/chats.js'), 'restoreNeutralChat'), context);
        context.restoreNeutralChat();
        assert.equal(context.chat, chat);
        assert.deepEqual(JSON.parse(JSON.stringify(chat)), expected);
        assert.deepEqual(seen, [{ edge, reset: true }, 'neutralChat']);
    });

    for (const site of ['initializeInteractables', 'registerInteractableType']) {
        test(`${site}: ${edge} controls match variadic call`, () => {
            const controls = count ? [element(['interactable'])] : [];
            const legacyControls = count ? [element(['interactable'])] : [];
            const untouched = element(['interactable'], { tabindex: '7' });
            const context = keyboard(controls);
            if (site === 'registerInteractableType') {
                context.document.querySelectorAll = () => ({
                    [Symbol.iterator]: () => controls.values(),
                    forEach: callback => controls.forEach(callback),
                });
            }
            const legacy = keyboard();
            assert.equal(legacy.makeKeyboardInteractable(...legacyControls), undefined);
            const result = site === 'initializeInteractables'
                ? context.initializeInteractables()
                : context.registerInteractableType('.extension-control');
            assert.equal(result, undefined);
            assert.equal(controls.length, count);
            assert.equal(untouched.getAttribute('tabindex'), '7');
            for (let i = 0; i < count; i++) {
                assert.equal(controls[i].getAttribute('tabindex'), legacyControls[i].getAttribute('tabindex'));
                assert.equal(controls[i].getAttribute('tabindex'), '0');
                assert.equal(controls[i].classList.contains('interactable'), true);
            }
        });
    }

    test(`getFirstDisplayedMessageId: ${edge} minimum matches Math.min spread`, () => {
        for (const value of [7, -0, 0, Infinity, -Infinity, NaN]) {
            const values = count ? [value] : [];
            const context = vm.createContext({ document: {
                querySelectorAll: () => values.map(id => ({ getAttribute: () => Object.is(id, -0) ? '-0' : String(id) })),
            } });
            vm.runInContext(declaration(read('script.js'), 'getFirstDisplayedMessageId'), context);
            assert.equal(context.getFirstDisplayedMessageId(), Math.min(...values.filter(x => !isNaN(x))));
        }
    });

    test(`visualNovelUpdateLayers: ${edge} maximum matches Math.max spread`, () => {
        // Evaluate the shipped expression itself, including its -Infinity seed.
        const expression = statements('scripts/extensions/expressions/index.js',
            'imagesWidth.reduce((max, width) => Math.max(max, width), -Infinity)');
        for (const value of [7, -0, 0, Infinity, -Infinity, NaN]) {
            const imagesWidth = count ? [value] : [];
            assert.equal(vm.runInNewContext(expression, { imagesWidth }), Math.max(...imagesWidth));
        }
    });

    for (const method of ['flatten', 'getChat']) {
        const site = method === 'flatten' ? 'MessageCollection.flatten' : 'ChatCompletion.getChat';
        test(`${site}: ${edge} nested collection matches push spread`, () => {
            const source = read('scripts/openai.js');
            const context = vm.createContext({ Message: class {} });
            vm.runInContext(`${declaration(source, 'MessageCollection', 'class')}\n${declaration(source, 'ChatCompletion', 'class')}`, context);
            const { nested, root, completion } = vm.runInContext(`(() => {
                const nested = new MessageCollection('history');
                const root = new MessageCollection('root', nested);
                const completion = new ChatCompletion();
                completion.messages = root;
                return { nested, root, completion };
            })()`, context);
            const message = new context.Message();
            Object.assign(message, { role: 'user', content: 'one', name: 'User' });
            if (count) nested.add(message);
            const expected = [];
            expected.push(...(method === 'flatten' ? nested.flatten() : nested.getChat()));
            const actual = method === 'flatten' ? root.flatten() : completion.getChat();
            assert.deepEqual(Array.from(actual, item => ({ ...item })), Array.from(expected, item => ({ ...item })));
            assert.equal(actual.length, count);
            assert.equal(nested.collection.length, count);
            if (count && method === 'flatten') assert.equal(actual[0], message);
            // Empty nested input must preserve messages already accumulated on either side.
            const prefix = Object.assign(new context.Message(), { role: 'system', content: 'prefix' });
            const suffix = Object.assign(new context.Message(), { role: 'assistant', content: 'suffix' });
            root.collection = [prefix, nested, suffix];
            const withNeighbors = method === 'flatten' ? root.flatten() : completion.getChat();
            assert.deepEqual(Array.from(withNeighbors, item => item.content), count ? ['prefix', 'one', 'suffix'] : ['prefix', 'suffix']);
            if (method === 'flatten') {
                assert.equal(withNeighbors[0], prefix);
                assert.equal(withNeighbors[withNeighbors.length - 1], suffix);
            }
            // The reduce must also retain its [] initial value when the root is empty.
            root.collection = [];
            assert.deepEqual(Array.from(method === 'flatten' ? root.flatten() : completion.getChat()), []);
        });
    }

    test(`applyStylePins: ${edge} style NodeList matches append spread`, () => {
        const styles = count ? [{}] : [];
        const original = childContainer(styles);
        const sentinel = {};
        const pins = childContainer([sentinel]);
        // Use a NodeList-like iterable, not an Array.
        const styleTags = { length: count, [Symbol.iterator]: () => styles.values() };
        const expected = [sentinel];
        expected.push(...styles);
        vm.runInNewContext(statements('scripts/power-user.js', 'for (const style of styleTags) pinsElement.append(style);'),
            { styleTags, pinsElement: pins });
        assert.deepEqual(pins.children, expected);
        assert.equal(original.children.length, 0);
        assert.equal(pins.children[0], sentinel);
        if (count) assert.equal(styles[0].parentNode, pins);
        // Also exercise the full function's empty early-return and single-style move.
        const chatElement = { prepend: node => { chatElement.pins = node; } };
        const productStyles = count ? [{}] : [];
        let creates = 0;
        const context = vm.createContext({
            power_user: { pin_styles: true }, getFirstDisplayedMessageId: () => 1,
            chat: [{ mes: 'styles' }], messageFormatting: () => '',
            console: { error: error => { throw error; } },
            document: {
                querySelector: () => null, getElementById: () => chatElement,
                createElement: () => ++creates === 1
                    ? { querySelectorAll: () => productStyles }
                    : Object.assign(childContainer(), { classList: { add() {} } }),
            },
        });
        vm.runInContext(declaration(read('scripts/power-user.js'), 'applyStylePins'), context);
        context.applyStylePins();
        assert.equal(creates, count ? 2 : 1);
        assert.deepEqual(chatElement.pins?.children ?? [], productStyles);
    });

    test(`openSwipePicker: ${edge} blocks match replaceChildren spread`, () => {
        const blocks = count ? [{}] : [];
        const original = childContainer(blocks);
        const stale = {};
        const listContainer = childContainer([stale]);
        const legacy = childContainer([{}]);
        const legacyBlocks = count ? [{}] : [];
        legacy.replaceChildren(...legacyBlocks);
        let fragment;
        vm.runInNewContext(statements('scripts/swipe-picker.js',
            'const fragment = document.createDocumentFragment();', 'listContainer.replaceChildren(fragment);'), {
            swipeBlocks: blocks, listContainer,
            document: { createDocumentFragment: () => (fragment = childContainer([], true)) },
        });
        assert.deepEqual(listContainer.children, blocks);
        assert.equal(listContainer.children.length, legacy.children.length);
        assert.equal(listContainer.replacements, legacy.replacements);
        assert.equal(listContainer.replacements, 1);
        assert.equal(stale.parentNode, null);
        assert.equal(original.children.length, 0);
        assert.deepEqual(fragment.children, []);
        if (count) assert.equal(blocks[0].parentNode, listContainer);
    });
}
