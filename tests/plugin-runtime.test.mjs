import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeFromHost, installedExtensionId } from '../public/scripts/plugin-runtime/runtime.js';
class Events {
    listeners = new Map();
    on(type, callback) { const list = this.listeners.get(type) ?? []; list.push(callback); this.listeners.set(type, list); }
    removeListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== callback)); }
    makeFirst(type, callback) { this.removeListener(type, callback); this.listeners.set(type, [callback, ...(this.listeners.get(type) ?? [])]); }
}
function fixture() {
    const settings = { disabledExtensions: ['director', 'affinity'], affinity: { enabled: true } };
    const context = { eventSource: new Events(), eventTypes: { GENERATION_COMPLETED: 'complete', GENERATE_AFTER_DATA: 'after' },
        extensionSettings: settings, mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'custom', custom_model: 'fixture' },
        getTokenCountAsync: async text => text.length };
    const host = { core: { getMaxContextTokens: () => 8192, Generate() {}, getGeneratingApi: () => 'custom', getGeneratingModel: () => 'fixture' },
        extensions: { getContext: () => context, extension_settings: settings }, groups: {},
        tokenizers: { countTokensOpenAIAsync: async messages => JSON.stringify(messages).length }, textgen: {}, utils: { uuidv4: () => 'fixture' } };
    const target = { fetch() { throw new Error('Unexpected transport'); } };
    return { settings, context, host, target };
}
test('extension ID follows real installed directory, including third party and escaped folder names', () => {
    assert.equal(installedExtensionId('https://fixture.invalid/scripts/extensions/director/index.js'), 'director');
    assert.equal(installedExtensionId('https://fixture.invalid/scripts/extensions/third-party/custom%20cards/index.js'), 'third-party/custom cards');
    assert.throws(() => installedExtensionId('https://fixture.invalid/not-an-extension/index.js'));
});

test('external interceptor name cannot collide with disabled built-in manifests and each request is claimed once', () => {
    const f = fixture();
    const runtime = createRuntimeFromHost('https://fixture.invalid/scripts/extensions/third-party/cards/index.js', 'director', f.host, f.target);
    assert.equal(runtime.interceptorKey, 'standalone_director_cards_interceptor');
    const request = [];
    assert.equal(runtime.claim(request), true);
    assert.equal(runtime.claim(request), false);
    assert.equal(runtime.claim([]), true);
});
test('disabled built-in copies do not disable independently installed plugins or mutate native settings', () => {
    const f = fixture();
    const runtime = createRuntimeFromHost('https://fixture.invalid/scripts/extensions/third-party/st-affinity-memory/index.js', 'affinity', f.host, f.target);
    assert.equal(runtime.getContext().extensionSettings.disabledExtensions.includes('affinity'), false);
    assert.deepEqual(f.settings.disabledExtensions, ['director', 'affinity']);
    f.settings.disabledExtensions.push(runtime.extensionId);
    assert.equal(runtime.getContext().extensionSettings.disabledExtensions.includes('affinity'), true);
});
test('two independently bundled runtimes coordinate through one host registry and keep data references live', () => {
    const f = fixture();
    const a = createRuntimeFromHost('https://fixture.invalid/scripts/extensions/third-party/a/index.js', 'affinity', f.host, f.target);
    const d = createRuntimeFromHost('https://fixture.invalid/scripts/extensions/third-party/d/index.js', 'director', f.host, f.target);
    assert.equal(a.getContext().saveChat, d.getContext().saveChat);
    assert.equal(a.getContext().generateQuietPrompt, d.getContext().generateQuietPrompt);
    assert.equal(a.getContext().eventSource, f.context.eventSource);
    f.context.chatMetadata = { changed: true };
    assert.equal(a.getContext().chatMetadata, f.context.chatMetadata);
    assert.equal(f.context.eventSource.listeners.get('after').length, 1);
});
test('budget counts the same single literal message sent by isolated transport, plus schema and reserve', async () => {
    const f = fixture();
    const runtime = createRuntimeFromHost('https://fixture.invalid/scripts/extensions/affinity/index.js', 'affinity', f.host, f.target);
    const prompt = 'Literal {{char}}';
    const schema = { value: { type: 'object' } };
    const expected = JSON.stringify([{ role: 'user', content: prompt }]).length + JSON.stringify(schema.value).length + 64;
    assert.equal(await runtime.countPromptTokens(prompt, schema), expected);
});
