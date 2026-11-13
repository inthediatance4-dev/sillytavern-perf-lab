import assert from 'node:assert/strict';
import test from 'node:test';

const { createResponseFilters } = await import('../public/scripts/plugin-runtime/response-filters.js').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
});

function lab() {
    const listeners = new Map();
    const context = { chatId: 'one', chatMetadata: {}, chat: [], groupId: null, mainApi: 'openai',
        eventTypes: { CHAT_CHANGED: 'changed', GENERATION_STARTED: 'started' },
        eventSource: { on: (name, callback) => listeners.set(name, callback), removeListener: name => listeners.delete(name) } };
    const calls = [];
    const target = { fetch: async (input, init) => { calls.push([input, init]); return new Response('raw'); } };
    const original = target.fetch;
    const filters = createResponseFilters(() => context, target);
    const data = { prompt: [{ role: 'user', content: 'owned' }] };
    let filtered = 0;
    filters.register(data, async (response, request) => {
        assert.deepEqual(request.messages, data.prompt);
        filtered++;
        return new Response('clean ' + await response.text());
    });
    const send = (body = { messages: data.prompt }, url = '/api/backends/chat-completions/generate') =>
        target.fetch(url, { method: 'POST', body: JSON.stringify(body) });
    return { context, listeners, target, original, filters, data, send, calls, filtered: () => filtered };
}

test('response filter follows final prompt mutations and is consumed by its exact transport once', async () => {
    assert.equal(typeof createResponseFilters, 'function');
    const h = lab();
    h.data.prompt[0].content += ' later native listener';
    assert.equal(await (await h.send()).text(), 'clean raw');
    assert.equal(await (await h.send()).text(), 'raw');
    assert.equal(h.filtered(), 1);
    h.filters.dispose();
    assert.equal(h.target.fetch, h.original);
});

for (const foreign of ['prompt', 'chat', 'metadata', 'save', 'quiet']) test(`response filter does not touch foreign ${foreign}`, async () => {
    const h = lab();
    if (foreign === 'chat') h.context.chatId = 'two';
    if (foreign === 'metadata') h.context.chatMetadata = {};
    if (foreign === 'quiet') h.listeners.get('started')('quiet');
    const body = foreign === 'prompt' || foreign === 'quiet' ? { messages: [{ content: 'unrelated' }] } : undefined;
    const url = foreign === 'save' ? '/api/chats/save' : undefined;
    assert.equal(await (await h.send(body, url)).text(), 'raw');
    assert.equal(h.filtered(), 0);
    h.filters.dispose();
});

test('chat changes discard pending registrations even if the old chat becomes current again', async () => {
    const h = lab();
    h.listeners.get('changed')();
    assert.equal(await (await h.send()).text(), 'raw');
    h.filters.dispose();
});

test('Request objects preserve the actual body and signal while filtering the response', async () => {
    const h = lab();
    const input = new Request('http://localhost/api/backends/chat-completions/generate', {
        method: 'POST', body: JSON.stringify({ messages: h.data.prompt }), signal: new AbortController().signal,
    });
    assert.equal(await (await h.target.fetch(input)).text(), 'clean raw');
    assert.equal(h.calls[0][0], input);
    h.filters.dispose();
});
