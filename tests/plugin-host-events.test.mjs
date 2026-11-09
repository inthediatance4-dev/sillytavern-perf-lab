import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

const implementation = await import('../public/scripts/plugin-runtime/host-events.js').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
});

test('standalone host bridge exposes the adapter factory', () => {
    assert.equal(typeof implementation.createHostEventBridge, 'function');
});

class NativeEvents {
    listeners = new Map();
    on(type, listener) { const list = this.listeners.get(type) ?? []; list.push(listener); this.listeners.set(type, list); }
    removeListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener)); }
    makeFirst(type, listener) { this.removeListener(type, listener); this.listeners.set(type, [listener, ...(this.listeners.get(type) ?? [])]); }
    async emit(type, ...args) { for (const listener of [...(this.listeners.get(type) ?? [])]) await listener(...args); }
}
const nativeNames = ['GENERATION_STARTED', 'GENERATE_AFTER_DATA', 'MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED',
    'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHAT_CHANGED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED',
    'MESSAGE_DELETED', 'MESSAGE_SWIPE_DELETED', 'GROUP_WRAPPER_STARTED', 'GROUP_WRAPPER_FINISHED', 'GROUP_UPDATED'];
const flush = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); };
function harness({ fork = false, generationBody = { choices: [{ text: 'answer' }] }, saveOk = true, generationOk = true } = {}) {
    const eventTypes = Object.fromEntries(nativeNames.map(name => [name, name.toLowerCase()]));
    if (fork) for (const name of ['GENERATION_COMPLETED', 'GROUP_REGENERATION_STARTED', 'GROUP_REGENERATION_FINISHED']) eventTypes[name] = name.toLowerCase();
    const native = new NativeEvents();
    const context = { eventSource: native, eventTypes, chat: [{ is_user: true, name: 'User', mes: 'hello' }], chatMetadata: { integrity: 'slug' },
        chatId: 'one', characterId: 0, characters: [{ avatar: 'A.png', name: 'A', chat: 'one' }], groups: [], groupId: null,
        mainApi: 'textgenerationwebui', SlashCommandParser: { commands: {} } };
    const core = { is_send_press: false, streamingProcessor: null, isGenerating: () => core.is_send_press, Generate: async () => 'generated' };
    let groupCalls = 0;
    const group = { regenerateGroup: async () => { groupCalls++; return 'group result'; } };
    context.SlashCommandParser.commands.regenerate = { callback: async () => { groupCalls++; return ''; } };
    const calls = [];
    const pending = [];
    const target = { fetch: (input, init = {}) => {
        calls.push({ input, init });
        if (pending.length) return pending.shift()(input, init);
        return Promise.resolve(new Response(JSON.stringify(String(input).includes('/chats/') ? {} : generationBody), { status: String(input).includes('/chats/') ? (saveOk ? 200 : 500) : (generationOk ? 200 : 500) }));
    } };
    const originalFetch = target.fetch;
    const domListeners = new Map();
    const document = { addEventListener: (name, listener) => domListeners.set(name, listener), removeEventListener: (name, listener) => { if (domListeners.get(name) === listener) domListeners.delete(name); } };
    let serial = 0;
    const bridge = implementation.createHostEventBridge(() => context, core, group, { uuid: () => `test-${++serial}`, fetchTarget: target, document });
    const completed = [];
    bridge.eventSource.on(bridge.eventTypes.GENERATION_COMPLETED, event => { completed.push(event); });
    const emit = (name, ...args) => native.emit(eventTypes[name], ...args);
    async function dispatch(type = 'normal', { stream = false, text = 'hello' } = {}) {
        await emit('GENERATION_STARTED', type, {}, false);
        const requestChat = [{ is_user: true, mes: text }];
        bridge.prepare(type, requestChat);
        bridge.seal?.(requestChat);
        const data = { prompt: requestChat.map(message => message.mes).join('\n') };
        await emit('GENERATE_AFTER_DATA', data, false);
        const signal = new AbortController();
        const response = await target.fetch('/api/backends/text-completions/generate', { method: 'POST', body: JSON.stringify({ ...data, stream }), signal: signal.signal });
        await flush();
        return { data, signal, response };
    }
    async function receive(type = 'normal', text = 'answer', index = context.chat.length) {
        const message = context.chat[index] ??= { is_user: false, name: 'A', extra: {} };
        Object.assign(message, { mes: text, gen_finished: 'finished' });
        await emit('MESSAGE_RECEIVED', index, type);
        message.swipe_id ??= 0;
        message.swipes ??= [];
        message.swipes[message.swipe_id] = text;
        message.swipe_info ??= [];
        message.swipe_info[message.swipe_id] = { extra: {} };
        await emit('CHARACTER_MESSAGE_RENDERED', index, type);
        return message;
    }
    function saveBody() { return { file_name: context.chatId, avatar_url: context.characters[context.characterId]?.avatar, chat: [{ chat_metadata: context.chatMetadata }, ...structuredClone(context.chat)], force: false }; }
    async function save(body = saveBody(), { gzip = false } = {}) {
        await target.fetch(context.groupId ? '/api/chats/group/save' : '/api/chats/save', { method: 'POST', body: gzip ? gzipSync(JSON.stringify(body)) : JSON.stringify(body), headers: gzip ? { 'Content-Encoding': 'gzip' } : {} });
        await flush();
    }
    return { context, core, group, bridge, native, completed, calls, target, originalFetch, emit, dispatch, receive, save, saveBody, pending, domListeners, groupCalls: () => groupCalls };
}

test('fork forwards native completion exactly once without injecting markers', async () => {
    const h = harness({ fork: true });
    assert.equal(h.bridge.eventSource, h.native);
    const messages = [{ mes: 'text' }];
    h.bridge.prepare('normal', messages);
    assert.equal(messages[0].mes, 'text');
    const payload = { data: {}, type: 'normal' };
    await h.emit('GENERATION_COMPLETED', payload);
    assert.deepEqual(h.completed, [payload]);
    h.bridge.dispose();
});

test('official bridge restores the exact request type and removes correlation from prompt and source chat', async () => {
    const h = harness();
    const source = { mes: 'plain' };
    const request = [source];
    h.bridge.prepare('swipe', request);
    assert.equal(source.mes, 'plain');
    assert.notEqual(request[0].mes, 'plain');
    const seen = [];
    h.bridge.eventSource.on(h.bridge.eventTypes.GENERATE_AFTER_DATA, (data, dry, meta) => seen.push([data, dry, meta]));
    const data = { prompt: [{ role: 'user', content: request[0].mes }] };
    await h.emit('GENERATE_AFTER_DATA', data, false);
    assert.equal(data.prompt[0].content, 'plain');
    assert.equal(seen[0][2].type, 'swipe');
    await h.emit('GENERATE_AFTER_DATA', { prompt: 'unrecognized' }, false);
    assert.equal(seen[1][2].type, undefined);
    assert.equal(h.completed.length, 0);
    h.bridge.dispose();
});

test('a helper-scoped stop does not revoke the official native completion receipt', async () => {
    const h = harness();
    const request = await h.dispatch();
    await h.emit('GENERATION_STOPPED', 'synthetic-helper-request');
    await h.receive();
    await h.save();
    assert.equal(h.completed.length, 1);
    assert.equal(h.completed[0].data, request.data);
    h.bridge.dispose();
});

test('an aborted native transport still cannot complete after a helper-scoped stop', async () => {
    const h = harness();
    const request = await h.dispatch();
    request.signal.abort();
    await h.emit('GENERATION_STOPPED', 'synthetic-helper-request');
    await h.receive();
    await h.save();
    assert.equal(h.completed.length, 0);
    h.bridge.dispose();
});

test('official normal completion requires successful generation, real received candidate, and matching successful native save', async () => {
    const h = harness();
    const record = await h.dispatch();
    await h.emit('GENERATION_ENDED', 1);
    assert.equal(h.completed.length, 0);
    await h.receive();
    assert.equal(h.completed.length, 0);
    await h.save();
    assert.equal(h.completed.length, 1);
    assert.equal(h.completed[0].data, record.data);
    assert.equal(h.completed[0].chatMetadata, h.context.chatMetadata);
    assert.equal(h.calls.filter(call => String(call.input).includes('/chats/')).length, 1);
    await h.save();
    assert.equal(h.completed.length, 1);
    h.bridge.dispose();
});

for (const failure of ['http', 'envelope', 'save', 'stop', 'wrong-chat', 'wrong-text', 'wrong-swipe']) test(`official ${failure} does not mint a completion receipt`, async () => {
    const h = harness({ generationOk: failure !== 'http', generationBody: failure === 'envelope' ? { error: 'failed' } : undefined, saveOk: failure !== 'save' });
    await h.dispatch();
    if (failure === 'stop') await h.emit('GENERATION_STOPPED');
    await h.receive();
    const body = h.saveBody();
    if (failure === 'wrong-chat') body.file_name = 'another';
    if (failure === 'wrong-text') body.chat[2].mes = 'another';
    if (failure === 'wrong-swipe') body.chat[2].swipe_id = 4;
    await h.save(body);
    await h.emit('GENERATION_ENDED', 2);
    assert.equal(h.completed.length, 0);
    h.bridge.dispose();
});

test('concurrent quiet request cannot acquire normal request provenance', async () => {
    const h = harness();
    const normal = await h.dispatch('normal', { text: 'foreground' });
    const quiet = await h.dispatch('quiet', { text: 'background' });
    assert.notEqual(normal.data, quiet.data);
    await h.receive();
    await h.save();
    assert.equal(h.completed.length, 1);
    assert.equal(h.completed[0].data, normal.data);
    h.bridge.dispose();
});

test('unmarked generation cannot turn an unrelated received message and save into a receipt', async () => {
    const h = harness();
    await h.emit('GENERATION_STARTED', 'normal', {}, false);
    await h.emit('GENERATE_AFTER_DATA', { prompt: 'unmarked' }, false);
    await h.target.fetch('/api/backends/text-completions/generate', { method: 'POST', body: JSON.stringify({ prompt: 'unmarked' }) });
    await h.receive();
    await h.save();
    assert.equal(h.completed.length, 0);
    h.bridge.dispose();
});

test('official stream unlock before received only completes after nonstopped finished stream and native save', async () => {
    const h = harness();
    h.core.streamingProcessor = { type: 'normal', messageId: 1, isFinished: false, isStopped: false, abortController: new AbortController(), toolCalls: [] };
    const seen = [];
    for (const name of ['GENERATION_ENDED', 'MESSAGE_RECEIVED', 'GENERATION_COMPLETED']) h.bridge.eventSource.on(h.bridge.eventTypes[name], () => { seen.push(name); });
    await h.dispatch('normal', { stream: true });
    h.core.streamingProcessor.isFinished = true;
    await h.emit('GENERATION_ENDED', 1);
    await h.receive();
    await h.save();
    assert.deepEqual(seen, ['GENERATION_ENDED', 'MESSAGE_RECEIVED', 'GENERATION_COMPLETED']);
    h.bridge.dispose();
});

test('error stream received/rendered events remain noncompleting even with text and a successful save', async () => {
    const h = harness();
    h.core.streamingProcessor = { type: 'normal', messageId: 1, isFinished: true, isStopped: true, abortController: new AbortController(), toolCalls: [] };
    await h.dispatch('normal', { stream: true });
    await h.emit('GENERATION_ENDED', 1);
    await h.receive();
    await h.save();
    assert.equal(h.completed.length, 0);
    h.bridge.dispose();
});

test('compressed native save confirms its frozen payload despite a controlled live continuation', async () => {
    const h = harness();
    const normal = await h.dispatch();
    const message = await h.receive();
    let finishSave;
    h.pending.push(() => new Promise(resolve => { finishSave = resolve; }));
    const saving = h.save(h.saveBody(), { gzip: true });
    await flush();
    await h.emit('GENERATION_STARTED', 'continue', {}, false);
    message.mes += ' continued';
    finishSave(new Response('{}', { status: 200 }));
    await saving;
    assert.equal(h.completed.length, 1);
    assert.equal(h.completed[0].data, normal.data);
    h.bridge.dispose();
});

test('tool-call intermediates never mint foreground completion receipts', async () => {
    const h = harness({ generationBody: { choices: [{ message: { content: 'thinking', tool_calls: [{ id: 'one' }] } }] } });
    await h.dispatch();
    await h.receive();
    await h.save();
    assert.equal(h.completed.length, 0);
    h.bridge.dispose();
});

test('group regeneration wrapper emits cancelable markers around the native exported operation', async () => {
    const h = harness();
    h.context.groupId = 'group';
    h.context.groups = [{ id: 'group', chat_id: 'one', members: ['A.png'] }];
    h.context.chat.push({ is_user: false, mes: 'old', original_avatar: 'A.png', extra: { gen_id: 77 } });
    const seen = [];
    h.bridge.eventSource.on(h.bridge.eventTypes.GROUP_REGENERATION_STARTED, marker => { seen.push(['start', marker.generationId]); marker.cancelled = true; });
    h.bridge.eventSource.on(h.bridge.eventTypes.GROUP_REGENERATION_FINISHED, marker => seen.push(['end', marker.cancelled]));
    await h.context.SlashCommandParser.commands.regenerate.callback({ await: 'true' });
    assert.equal(h.groupCalls(), 0);
    assert.deepEqual(seen, [['start', 77], ['end', true]]);
    h.bridge.dispose();
});

test('dispose releases native subscriptions and the narrow fetch observer', () => {
    const h = harness();
    assert.notEqual(h.target.fetch, h.originalFetch);
    h.bridge.dispose();
    assert.equal(h.target.fetch, h.originalFetch);
    assert.equal([...h.native.listeners.values()].reduce((sum, entries) => sum + entries.length, 0), 0);
});

test('completion metadata persistence cannot deadlock the native save HTTP return', async () => {
    const h = harness();
    await h.dispatch();
    await h.receive();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    h.bridge.eventSource.on(h.bridge.eventTypes.GENERATION_COMPLETED, () => pending);
    const outcome = await Promise.race([
        h.save().then(() => 'saved'),
        new Promise(resolve => setTimeout(() => resolve('blocked'), 100)),
    ]);
    release();
    assert.equal(outcome, 'saved');
    h.bridge.dispose();
});

test('a chat switch during the awaited group predelete hook resets the send state and never deletes the new chat', async () => {
    const h = harness();
    h.context.groupId = 'group';
    h.context.groups = [{ id: 'group', chat_id: 'one', members: ['A.png'] }];
    h.core.setSendButtonState = value => { h.core.is_send_press = value; };
    h.bridge.eventSource.on(h.bridge.eventTypes.GROUP_REGENERATION_STARTED, () => {
        h.core.is_send_press = true;
        h.context.chatId = 'new chat';
    });
    await h.context.SlashCommandParser.commands.regenerate.callback({ await: 'true' });
    assert.equal(h.core.is_send_press, false);
    assert.equal(h.groupCalls(), 0);
    h.bridge.dispose();
});

test('native Horde task polling must confirm the exact task before a saved reply receives a receipt', async () => {
    const h = harness();
    await h.emit('GENERATION_STARTED', 'normal', {}, false);
    const chat = [{ mes: 'Horde prompt' }];
    h.bridge.prepare('normal', chat);
    const data = { prompt: chat[0].mes };
    await h.emit('GENERATE_AFTER_DATA', data, false);
    h.pending.push(() => Promise.resolve(new Response('{"id":"task-one"}')));
    await h.target.fetch('/api/horde/generate-text', { method: 'POST', body: JSON.stringify({ prompt: data.prompt }) });
    h.pending.push(() => Promise.resolve(new Response('{"done":true,"generations":[{"text":"answer"}]}')));
    await h.target.fetch('/api/horde/task-status', { method: 'POST', body: '{"taskId":"task-one"}' });
    await h.receive();
    await h.save();
    assert.equal(h.completed.length, 1);
    h.bridge.dispose();
});

test('stopping a later continuation cannot revoke an earlier completed reply awaiting its native save', async () => {
    const h = harness();
    const first = await h.dispatch();
    await h.receive();
    let release;
    h.pending.push(() => new Promise(resolve => { release = resolve; }));
    const saving = h.save();
    await flush();
    await h.dispatch('continue');
    await h.emit('GENERATION_STOPPED');
    release(new Response('{}'));
    await saving;
    assert.equal(h.completed.length, 1);
    assert.equal(h.completed[0].data, first.data);
    h.bridge.dispose();
});
