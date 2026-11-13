import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const entryPath = path.join(root, 'public/scripts/extensions/affinity/index.js');
const manifest = JSON.parse(readFileSync(new URL('../public/scripts/extensions/affinity/manifest.json', import.meta.url), 'utf8'));
const extensionSource = readFileSync(new URL('../public/scripts/extensions.js', import.meta.url), 'utf8');
const hookStart = extensionSource.indexOf('async function callExtensionHook(name, hookName) {');
const hookEnd = extensionSource.indexOf('\n/**\n * Enables an extension by name.', hookStart);
assert.ok(hookStart >= 0 && hookEnd > hookStart, 'the native hook loader is present');
const hookSource = extensionSource.slice(hookStart, hookEnd);
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

// The manifest and native loader activate the complete production entry,
// controller, state, and budget modules. Only host I/O and DOM widgets are fixtures.
function harness(initialSettings) {
    let domPresent = false;
    let saves = 0;
    let modelCalls = 0;
    let sequence = 0;
    const logs = [];
    const handlers = new Map();
    const widgets = new Map();
    const sandbox = vm.createContext({
        structuredClone, AbortController, URL, setTimeout, clearTimeout,
        console: Object.fromEntries(['debug', 'warn', 'error', 'log'].map(name => [name, (...args) => logs.push([name, ...args])])),
        document: { getElementById: () => domPresent ? {} : null },
        $(selector) {
            if (!widgets.has(selector)) widgets.set(selector, { properties: {}, handlers: {} });
            const widget = widgets.get(selector);
            return {
                append() { domPresent = true; return this; },
                prop(name, value) { widget.properties[name] = value; return this; },
                val(value) { if (value === undefined) return widget.value; widget.value = value; return this; },
                on(name, handler) { widget.handlers[name] = handler; return this; },
            };
        },
    });
    const settings = vm.runInContext(`(${JSON.stringify(initialSettings)})`, sandbox);
    const context = {
        extensionSettings: settings, chatMetadata: {},
        chat: [{ is_user: true, name: 'Fixture player', mes: 'Fixture greeting.', extra: {} }],
        chatId: 'fixture-chat', getCurrentChatId: () => 'fixture-chat', characterId: 0,
        characters: [{ name: 'Fixture character', avatar: 'fixture.png' }], groups: [],
        eventTypes: new Proxy({}, { get: (_target, name) => name }),
        eventSource: { on(name, handler) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(handler); } },
        saveSettingsDebounced() { saves++; }, saveChat: async () => true,
        extensionPrompts: {}, mainApi: 'openai', powerUserSettings: {},
        getTokenizerModel: () => 'fixture-model', getTokenCountAsync: async text => text.length,
        chatCompletionSettings: {}, generateQuietPrompt: async () => { modelCalls++; return '{"events":[]}'; },
    };
    const host = new Map([
        ['public/script.js', {
            createRawPrompt: text => text, getMaxContextTokens: () => 8192, getMaxPromptTokens: () => 6144,
            isGenerating: () => false, getGeneratingApi: () => 'openai', getGeneratingModel: () => 'fixture-model',
        }],
        ['public/scripts/extensions.js', {
            extension_settings: settings, getContext: () => context, renderExtensionTemplateAsync: async () => '<fixture-settings/>',
        }],
        ['public/scripts/tokenizers.js', { countTokensOpenAIAsync: async () => 1, getTokenizerBestMatch: () => 'fixture-tokenizer' }],
        ['public/scripts/textgen-settings.js', { getTextGenModel: () => 'fixture-model' }],
        ['public/scripts/utils.js', { uuidv4: () => `fixture-${++sequence}` }],
        // Runtime I/O is covered independently by plugin-* and installed-browser
        // checks. This fixture isolates upgrade preferences and controller cadence.
        ['public/scripts/plugin-runtime/runtime.js', { createPluginRuntime: async () => ({
            extensionId: 'affinity', getContext: () => context, prepare() {}, seal: async () => {},
            interceptorKey: 'affinity_memory_interceptor', claim: () => true,
            countPromptTokens: async prompt => prompt.length + 64,
        }) }],
    ].map(([filename, exports]) => [path.resolve(root, filename), exports]));
    const modules = new Map();
    async function load(filename) {
        filename = path.resolve(filename);
        if (modules.has(filename)) return modules.get(filename);
        const exports = host.get(filename);
        const module = exports
            ? new vm.SyntheticModule(Object.keys(exports), function () {
                for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
            }, { context: sandbox, identifier: filename })
            : new vm.SourceTextModule(readFileSync(filename, 'utf8'), { context: sandbox, identifier: filename });
        modules.set(filename, module);
        await module.link((specifier, referring) => load(path.resolve(path.dirname(referring.identifier), specifier)));
        return module;
    }
    async function activate() {
        const module = new vm.SourceTextModule(`const manifests = { affinity: ${JSON.stringify(manifest)} };\nconst delay = () => new Promise(() => {});\n${hookSource}\nexport { callExtensionHook };`, {
            context: sandbox, identifier: 'native-extension-hook',
            importModuleDynamically: async url => {
                assert.equal(url, '/scripts/extensions/affinity/index.js');
                const entry = await load(entryPath);
                if (entry.status !== 'evaluated') await entry.evaluate();
                return entry;
            },
        });
        await module.link(() => { throw new Error('Unexpected native hook import'); });
        await module.evaluate();
        await module.namespace.callExtensionHook('affinity', 'activate');
        assert.deepEqual(logs.filter(([level]) => level === 'error'), [], 'native activation succeeds');
    }
    async function emit(name, ...args) {
        for (const handler of handlers.get(name) ?? []) await handler(...args);
    }
    async function generate() {
        await emit('GENERATION_STARTED', 'normal', {}, false);
        const requestChat = [];
        await sandbox.affinity_memory_interceptor(requestChat, 8192, () => {}, 'normal');
        const data = { messages: requestChat };
        await emit('GENERATE_AFTER_DATA', data, false, { type: 'normal' });
        const message = { is_user: false, name: 'Fixture character', mes: `Fixture reply ${context.chat.length}.`, extra: {} };
        context.chat.push(message);
        await emit('MESSAGE_RECEIVED', context.chat.length - 1, 'normal');
        message.swipe_id = 0;
        message.swipes = [message.mes];
        message.swipe_info = [{ extra: structuredClone(message.extra) }];
        await emit('GENERATION_ENDED');
        await emit('GENERATION_COMPLETED', { data, type: 'normal', chatMetadata: context.chatMetadata, chatId: context.chatId });
        await turn();
        await turn();
    }
    return {
        settings, context, widgets, handlers, activate, generate,
        evaluate: source => vm.runInContext(source, sandbox),
        get saves() { return saves; }, get modelCalls() { return modelCalls; },
        get registered() { return typeof sandbox.affinity_memory_interceptor === 'function'; },
    };
}

test('native activation preserves a legacy disabled preference through completed replies', async () => {
    const lab = harness({ disabledExtensions: [], director: { affinity: { enabled: false, interval: 5 }, hotkey: 'Ctrl+D' } });
    const directorBefore = JSON.stringify(lab.settings.director);
    await lab.activate();
    assert.equal(lab.settings.affinity.enabled, false);
    assert.equal(lab.settings.affinity.interval, 5);
    assert.equal(lab.widgets.get('#affinity_enabled').properties.checked, false);
    assert.equal(lab.widgets.get('#affinity_interval').value, '5');
    for (let index = 0; index < 10; index++) await lab.generate();
    assert.equal(lab.modelCalls, 0, 'disabled legacy memory must never request background extraction');
    assert.equal(JSON.stringify(lab.settings.director), directorBefore);
    assert.equal(lab.saves, 1);
});

test('native activation applies a legacy five-reply cadence to the real controller', async () => {
    const lab = harness({ disabledExtensions: [], director: { affinity: { enabled: true, interval: 5 } } });
    await lab.activate();
    for (let index = 0; index < 4; index++) await lab.generate();
    assert.equal(lab.modelCalls, 0);
    await lab.generate();
    assert.equal(lab.modelCalls, 1, 'the fifth completed reply starts extraction');
    await lab.activate();
    assert.equal(lab.saves, 1, 'a repeated activation neither reseeds nor duplicates the entry');
});

test('new preferences win independently and unrelated director settings are never read or changed', async () => {
    for (const affinity of [{ enabled: false }, { interval: 5 }, { enabled: false, interval: 5 }]) {
        const lab = harness({ disabledExtensions: [], affinity, director: { affinity: { enabled: false, interval: 5 }, hotkey: 'Ctrl+D' } });
        Object.defineProperty(lab.settings.director, 'unrelatedSecret', { get() { throw new Error('unrelated director field was read'); } });
        const legacy = lab.settings.director.affinity;
        await lab.activate();
        assert.equal(lab.settings.affinity.enabled, false);
        assert.equal(lab.settings.affinity.interval, 5);
        assert.equal(lab.settings.director.affinity, legacy);
        assert.equal(lab.settings.director.hotkey, 'Ctrl+D');
        assert.equal(lab.saves, Object.keys(affinity).length === 2 ? 0 : 1);
    }
    const lab = harness({ disabledExtensions: [], affinity: { enabled: false, interval: 5 }, director: { affinity: { enabled: true, interval: 10 } } });
    await lab.activate();
    assert.equal(lab.settings.affinity.enabled, false);
    assert.equal(lab.settings.affinity.interval, 5);
    assert.equal(lab.saves, 0);
});

test('invalid and explicitly present new fields use defaults instead of legacy values', async () => {
    const lab = harness({ disabledExtensions: [], affinity: { enabled: 'false', interval: '5' }, director: { affinity: { enabled: false, interval: 5 } } });
    await lab.activate();
    assert.equal(lab.settings.affinity.enabled, true);
    assert.equal(lab.settings.affinity.interval, 10);
    const undefinedField = harness({ disabledExtensions: [], affinity: {}, director: { affinity: { enabled: false, interval: 5 } } });
    undefinedField.settings.affinity.enabled = undefined;
    undefinedField.settings.affinity.interval = undefined;
    await undefinedField.activate();
    assert.equal(undefinedField.settings.affinity.enabled, true);
    assert.equal(undefinedField.settings.affinity.interval, 10);
});

test('malformed settings containers and legacy field types are normalized safely', async () => {
    for (const malformed of [null, false, 'bad', [], 5]) {
        const lab = harness({ disabledExtensions: [], affinity: malformed, director: { affinity: { enabled: 'false', interval: '5' } } });
        await lab.activate();
        assert.equal(lab.registered, true);
        assert.equal(lab.settings.affinity.enabled, true);
        assert.equal(lab.settings.affinity.interval, 10);
        assert.equal(Array.isArray(lab.settings.affinity), false);
    }
    for (const expression of ['[]', 'new Date()', 'new (class Settings { constructor() { this.enabled = false; this.interval = 5; } })()', 'Object.create({ enabled: false, interval: 5 })']) {
        const lab = harness({ disabledExtensions: [], director: {} });
        lab.settings.director.affinity = lab.evaluate(expression);
        await lab.activate();
        assert.equal(lab.settings.affinity.enabled, true);
        assert.equal(lab.settings.affinity.interval, 10);
    }
});

test('disabled extension activation leaves preferences and hook state untouched', async () => {
    const lab = harness({ disabledExtensions: ['affinity'], director: { affinity: { enabled: false, interval: 5 } } });
    const before = JSON.stringify(lab.settings);
    await lab.activate();
    assert.equal(lab.registered, false);
    assert.equal(lab.saves, 0);
    assert.equal(JSON.stringify(lab.settings), before);
});
