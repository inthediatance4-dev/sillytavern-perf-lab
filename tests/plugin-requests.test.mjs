import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const moduleUrl = new URL('../public/scripts/plugin-runtime/requests.js', import.meta.url);
const api = existsSync(moduleUrl) ? await import(moduleUrl) : {};
const { buildIsolatedRequest, createIsolatedGenerator, createOwnedChatSaver } = api;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function context() {
    return {
        mainApi: 'openai', maxContext: 8192,
        chatCompletionSettings: { chat_completion_source: 'custom', custom_model: 'fixture-model', custom_url: 'https://fixture.invalid/v1',
            custom_include_body: 'messages: PRIVATE_HISTORY', custom_include_headers: 'Authorization: PRIVATE_SECRET',
            custom_prompt_post_processing: 'single', openai_max_tokens: 9999, stream_openai: true },
        textCompletionSettings: { type: 'vllm', vllm_model: 'fixture-text', server_urls: { vllm: 'https://text.invalid' }, stream: true },
        koboldSettings: { api_server: 'https://kobold.invalid/api', temp: 0.7, grammar: '{{private_macro}}', streaming_kobold: true },
        novelSettings: { model_novel: 'kayra-v1', temperature: 1.2, preamble: 'PRIVATE_PREAMBLE', prefix: 'vanilla' },
        hordeSettings: { models: ['fixture-horde'], trusted_workers_only: true },
        chatId: 'fixture-chat', characterId: 0, groupId: null,
        chat: [{ name: 'Fixture', mes: 'PRIVATE_HISTORY', extra: { nested: 1 } }],
        chatMetadata: { integrity: 'fixture-integrity', create_date: 'fixture-date' },
        characters: [{ name: 'Fixture', chat: 'fixture-chat', avatar: 'fixture.png' }], groups: [],
        getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'fixture-csrf' }),
        generateQuietPrompt() { throw new Error('native quiet must never execute'); },
        generateRaw() { throw new Error('native raw must never execute'); },
        saveChat() { throw new Error('native save must never execute'); },
    };
}

test('isolated chat request contains one literal prompt and only allowlisted connection settings', () => {
    assert.equal(typeof buildIsolatedRequest, 'function');
    const c = context();
    const schema = { name: 'fixture', value: { type: 'object' } };
    const request = buildIsolatedRequest(() => c, { quietPrompt: 'Evaluate {{literal}}', maxOutputTokens: 9999, jsonSchema: schema });
    assert.equal(request.kind, 'chat');
    assert.deepEqual(request.messages, [{ role: 'user', content: 'Evaluate {{literal}}' }]);
    assert.deepEqual(request.payload.messages, request.messages);
    assert.equal(request.payload.model, 'fixture-model');
    assert.equal(request.payload.custom_url, 'https://fixture.invalid/v1');
    assert.equal(request.payload.max_tokens, 2048);
    assert.equal(request.payload.stream, false);
    assert.equal(request.payload.custom_prompt_post_processing, '');
    assert.deepEqual(request.payload.json_schema, schema);
    schema.value.type = 'string';
    assert.equal(request.payload.json_schema.value.type, 'object');
    assert.doesNotMatch(JSON.stringify(request), /PRIVATE_|private_macro|custom_include/);
    assert.equal(c.chatCompletionSettings.openai_max_tokens, 9999);
});

test('all official chat sources select the corresponding model and reject unknown sources', () => {
    const sources = ['openai', 'claude', 'openrouter', 'ai21', 'makersuite', 'vertexai', 'mistralai', 'custom', 'cohere', 'perplexity', 'groq', 'electronhub', 'chutes', 'nanogpt', 'deepseek', 'aimlapi', 'xai', 'pollinations', 'moonshot', 'fireworks', 'cometapi', 'azure_openai', 'zai', 'siliconflow', 'workers_ai', 'minimax'];
    for (const source of sources) {
        const c = context();
        c.chatCompletionSettings.chat_completion_source = source;
        const modelKey = source === 'makersuite' ? 'google_model' : source === 'azure_openai' ? 'azure_openai_model' : `${source}_model`;
        c.chatCompletionSettings[modelKey] = `fixture-${source}`;
        assert.equal(buildIsolatedRequest(() => c, { quietPrompt: 'literal' }).payload.model, `fixture-${source}`);
    }
    const c = context(); c.chatCompletionSettings.chat_completion_source = 'unrecognized';
    assert.throws(() => buildIsolatedRequest(() => c, { quietPrompt: 'literal' }), /Unsupported/);
});

test('chat connection routing snapshots proxy, Azure, Vertex and endpoint fields without secrets from arbitrary settings', () => {
    for (const [source, values] of Object.entries({
        claude: { reverse_proxy: 'https://proxy.invalid', proxy_password: 'fixture-proxy' },
        azure_openai: { azure_base_url: 'https://azure.invalid', azure_deployment_name: 'fixture', azure_api_version: 'fixture-version' },
        vertexai: { vertexai_auth_mode: 'express', vertexai_region: 'fixture-region', vertexai_express_project_id: 'fixture-project' },
        workers_ai: { workers_ai_account_id: 'fixture-account' },
        siliconflow: { siliconflow_endpoint: 'cn' },
    })) {
        const c = context(); Object.assign(c.chatCompletionSettings, values, { chat_completion_source: source });
        const request = buildIsolatedRequest(() => c, { quietPrompt: 'literal' });
        for (const [key, value] of Object.entries(values)) assert.equal(request.payload[key], value);
        assert.doesNotMatch(JSON.stringify(request.payload), /custom_include|PRIVATE_/);
    }
});

test('text request uses selected model and endpoint with a literal prompt and capped local output', () => {
    const c = context(); c.mainApi = 'textgenerationwebui';
    const request = buildIsolatedRequest(() => c, { quietPrompt: 'literal {{macro}}', responseLength: 123 });
    assert.equal(request.kind, 'text');
    assert.equal(request.prompt, 'literal {{macro}}');
    assert.equal(request.payload.prompt, request.prompt);
    assert.equal(request.payload.api_server, 'https://text.invalid');
    assert.equal(request.payload.model, 'fixture-text');
    assert.equal(request.payload.max_tokens, 123);
    assert.equal(request.payload.max_new_tokens, 123);
    assert.equal(request.payload.stream, false);
});

test('generator sends the immutable local snapshot and normalizes structured content to JSON text', async () => {
    const c = context(); const before = structuredClone(c.chatCompletionSettings); const hold = deferred(); let received;
    c.ChatCompletionService = { async sendRequest(payload, extract, signal) { received = { payload, extract, signal }; await hold.promise; return { content: { score: 2 } }; } };
    const aborter = new AbortController();
    const run = createIsolatedGenerator(() => c)({ quietPrompt: 'literal', maxOutputTokens: 32, signal: aborter.signal });
    c.chatCompletionSettings.custom_model = 'changed';
    assert.equal(received.payload.model, 'fixture-model');
    assert.equal(received.payload.max_tokens, 32); assert.equal(received.extract, true); assert.equal(received.signal, aborter.signal);
    hold.resolve(); assert.equal(await run, '{"score":2}');
    c.chatCompletionSettings.custom_model = before.custom_model; assert.deepEqual(c.chatCompletionSettings, before);
});

test('generator obeys local abort and emits a static error without provider response content', async () => {
    const c = context(); let calls = 0;
    c.ChatCompletionService = { async sendRequest() { calls++; throw new Error('PRIVATE_PROVIDER_RESPONSE'); } };
    const generate = createIsolatedGenerator(() => c);
    await assert.rejects(generate({ quietPrompt: 'literal' }), error => error.message === 'Isolated evaluation request failed.');
    const controller = new AbortController(); controller.abort('PRIVATE_ABORT_REASON');
    await assert.rejects(generate({ quietPrompt: 'literal', signal: controller.signal }), error => error.name === 'AbortError' && !error.message.includes('PRIVATE'));
    assert.equal(calls, 1);
});

test('legacy provider payloads preserve literal input and selected routing without preset macros', () => {
    for (const mainApi of ['kobold', 'novel', 'koboldhorde']) {
        const c = context(); c.mainApi = mainApi;
        const request = buildIsolatedRequest(() => c, { quietPrompt: 'literal {{macro}}', maxOutputTokens: 64 });
        assert.equal(request.prompt, 'literal {{macro}}');
        assert.doesNotMatch(JSON.stringify(request), /PRIVATE_|private_macro|grammar/);
        assert.equal(request.payload.stream ?? request.payload.streaming ?? false, false);
        if (mainApi === 'kobold') { assert.equal(request.payload.api_server, 'https://kobold.invalid/api'); assert.equal(request.payload.max_length, 64); }
        if (mainApi === 'novel') { assert.equal(request.payload.input, request.prompt); assert.equal(request.payload.model, 'kayra-v1'); assert.equal(request.payload.max_length, 64); }
        if (mainApi === 'koboldhorde') { assert.deepEqual(request.payload.models, ['fixture-horde']); assert.equal(request.payload.params.max_length, 64); }
    }
});

test('legacy direct transport posts only to the existing same origin endpoint with a local signal', async () => {
    for (const [mainApi, endpoint, result] of [['kobold', '/api/backends/kobold/generate', { results: [{ text: 'kobold output' }] }], ['novel', '/api/novelai/generate', { output: 'novel output' }]]) {
        const c = context(); c.mainApi = mainApi; const calls = []; const controller = new AbortController();
        const generate = createIsolatedGenerator(() => c, { fetch: async (url, init) => { calls.push([url, init]); return { ok: true, json: async () => result }; } });
        assert.equal(await generate({ quietPrompt: 'literal', signal: controller.signal }), `${mainApi} output`);
        assert.equal(calls[0][0], endpoint); assert.equal(calls[0][1].signal, controller.signal);
        assert.equal(calls[0][1].headers['X-CSRF-Token'], 'fixture-csrf');
    }
});

test('Horde transport polls the local task and returns only text', async () => {
    const c = context(); c.mainApi = 'koboldhorde'; const calls = [];
    const generate = createIsolatedGenerator(() => c, { fetch: async (url, init) => {
        calls.push([url, JSON.parse(init.body)]);
        return { ok: true, json: async () => url.endsWith('generate-text') ? { id: 'fixture-task' } : { done: true, generations: [{ text: 'horde output', worker_name: 'private worker' }] } };
    } });
    assert.equal(await generate({ quietPrompt: 'literal' }), 'horde output');
    assert.deepEqual(calls.map(x => x[0]), ['/api/horde/generate-text', '/api/horde/task-status']);
    assert.deepEqual(calls[1][1], { taskId: 'fixture-task' });
});

test('single save sends the official metadata header and a detached chat snapshot', async () => {
    const c = context(); const hold = deferred(); const calls = [];
    const save = createOwnedChatSaver(() => c, { fetch: async (url, init) => { calls.push([url, JSON.parse(init.body)]); await hold.promise; return { ok: true }; } });
    const result = save(); await tick(); c.chat[0].mes = 'newer in memory'; c.chat[0].extra.nested = 2;
    assert.deepEqual(calls[0], ['/api/chats/save', { ch_name: 'Fixture', file_name: 'fixture-chat', avatar_url: 'fixture.png', force: false,
        chat: [{ chat_metadata: { integrity: 'fixture-integrity', create_date: 'fixture-date' }, user_name: 'unused', character_name: 'unused' },
            { name: 'Fixture', mes: 'PRIVATE_HISTORY', extra: { nested: 1 } }] }]);
    hold.resolve(); assert.equal(await result, true);
});

test('group save uses native chat id and the same metadata header', async () => {
    const c = context(); c.groupId = 'fixture-group'; c.chatId = 'group-chat'; c.groups = [{ id: 'fixture-group', chat_id: 'group-chat' }]; let call;
    const save = createOwnedChatSaver(() => c, { fetch: async (url, init) => { call = [url, JSON.parse(init.body)]; return { ok: true }; } });
    assert.equal(await save(), true); assert.equal(call[0], '/api/chats/group/save');
    assert.equal(call[1].id, 'group-chat'); assert.equal(call[1].force, false); assert.equal(call[1].chat[0].chat_metadata.create_date, 'fixture-date');
    assert.equal(call[1].ch_name, undefined);
});

test('queued save checks owner after native lock and saves newest text after the lock clears', async () => {
    const c = context(); const hold = deferred(); let call;
    const save = createOwnedChatSaver(() => c, { waitForIdle: () => hold.promise, fetch: async (_url, init) => { call = JSON.parse(init.body); return { ok: true }; } });
    const result = save(); await tick(); c.chat[0].mes = 'native update while saving'; hold.resolve();
    assert.equal(await result, true); assert.equal(call.chat[1].mes, 'native update while saving');
});

test('the group owns a queued save even when its native active speaker changes', async () => {
    const c = context(); c.groupId = 'group'; c.chatId = 'group-chat'; c.groups = [{ id: 'group', chat_id: 'group-chat' }];
    const hold = deferred(); let calls = 0;
    const save = createOwnedChatSaver(() => c, { waitForIdle: () => hold.promise,
        fetch: async () => { calls++; return { ok: true }; } });
    const result = save(); await tick(); c.characterId = undefined; hold.resolve();
    assert.equal(await result, true); assert.equal(calls, 1);
});

test('owner or caller guard invalidation during native lock prevents any stale save', async () => {
    for (const invalidate of [c => { c.chatId = 'other'; }, c => { c.groupId = 'other'; }, c => { c.chat = [...c.chat]; }, c => { c.chatMetadata = { ...c.chatMetadata }; }]) {
        const c = context(); const hold = deferred(); let calls = 0;
        const save = createOwnedChatSaver(() => c, { waitForIdle: () => hold.promise, fetch: async () => { calls++; return { ok: true }; } });
        const result = save(); await tick(); invalidate(c); hold.resolve();
        assert.equal(await result, false); assert.equal(calls, 0);
    }
    const c = context(); const hold = deferred(); let allowed = true; let calls = 0;
    const save = createOwnedChatSaver(() => c, { waitForIdle: () => hold.promise, fetch: async () => { calls++; return { ok: true }; } });
    const result = save({ shouldSave: () => allowed }); await tick(); allowed = false; hold.resolve();
    assert.equal(await result, false); assert.equal(calls, 0);
});

test('empty loading chat, missing owner, and an initially false guard make no request', async () => {
    for (const mutate of [c => { c.chat = []; }, c => { c.chatId = undefined; }, c => { c.characters[0].chat = 'different'; }]) {
        const c = context(); mutate(c); let calls = 0;
        const save = createOwnedChatSaver(() => c, { fetch: async () => { calls++; return { ok: true }; } });
        assert.equal(await save(), false); assert.equal(calls, 0);
    }
    let calls = 0; const save = createOwnedChatSaver(context, { fetch: async () => { calls++; return { ok: true }; } });
    assert.equal(await save({ shouldSave: () => false }), false); assert.equal(calls, 0);
});

test('one shared saver serializes its saves and an HTTP failure reaches the caller as a static error', async () => {
    const c = context(); const hold = deferred(); let calls = 0;
    const save = createOwnedChatSaver(() => c, { fetch: async () => { calls++; if (calls === 1) await hold.promise; return { ok: calls !== 1, status: 500, statusText: 'PRIVATE_SERVER' }; } });
    const first = save(); const firstRejected = assert.rejects(first, error => error.message === 'Chat save failed.'); const second = save();
    await tick(); assert.equal(calls, 1); hold.resolve(); await firstRejected; assert.equal(await second, true); assert.equal(calls, 2);
});
