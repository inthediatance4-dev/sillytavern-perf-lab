import assert from 'node:assert/strict';
import test from 'node:test';
import { streamingFixture, createFakeOpenAI } from '../scripts/fake-openai-endpoint.mjs';
import { get_encoding } from 'tiktoken';

test('fixed seed gives exact token lengths, mixed Markdown and deterministic chunk jitter', () => {
    const encoder = get_encoding('cl100k_base');
    try {
        for (const tokens of [500, 3000]) {
            const a = streamingFixture({ tokens, reasoning: true });
            assert.deepEqual(a, streamingFixture({ tokens, reasoning: true }));
            assert.equal(encoder.encode(a.content).length, tokens);
            for (const pattern of [/中文/, /English/, /\*\*Bold/, /\*italic/, /1\. /, /- /, /> /, /```javascript/, /\| Place \|/]) assert.match(a.content, pattern);
            assert.equal(a.chunks.filter(c => c.field === 'content').map(c => c.content).join(''), a.content);
            assert.ok(a.chunks.every(c => c.tokens >= 1 && c.tokens <= 3 && c.delayMs > 0));
            assert.equal(a.chunks[0].field, 'reasoning');
            assert.equal(a.chunks.at(-1).field, 'content');
            assert.notEqual(a.content, streamingFixture({ tokens, seed: 'another-seed' }).content);
        }
    } finally { encoder.free(); }
});

test('provider records bodies for parent and HTTP, supports models, SSE and startup nonstreaming', async () => {
    const fake = await createFakeOpenAI({ reply: 'Synthetic reply', rate: 10000 });
    try {
        const body = { model: 'synthetic', messages: [{ role: 'user', content: 'hello' }], stream: true };
        const response = await fetch(fake.url + '/chat/completions', { method: 'POST', body: JSON.stringify(body) });
        const text = await response.text();
        const events = text.split('\n\n').filter(Boolean).map(s => s.slice(6));
        assert.equal(events.at(-1), '[DONE]');
        assert.equal(events.slice(0, -1).map(s => JSON.parse(s).choices[0].delta.content || '').join(''), 'Synthetic reply');
        assert.deepEqual(fake.requests, [body]);
        assert.deepEqual(await (await fetch(new URL('/__requests', fake.url))).json(), [body]);
        assert.equal((await (await fetch(fake.url + '/models')).json()).data[0].id, 'startup-synthetic');
        const timing = (await (await fetch(new URL('/__timings', fake.url))).json())[0];
        assert.ok(timing.firstChunkEpochMs >= timing.receivedEpochMs);
        assert.ok(timing.lastChunkEpochMs >= timing.firstChunkEpochMs);
        body.stream = false;
        const complete = await (await fetch(fake.url + '/chat/completions', { method: 'POST', body: JSON.stringify(body) })).json();
        assert.equal(complete.choices[0].message.content, 'Synthetic reply');
        fake.reset();
        assert.equal(fake.requests.length, 0);
        assert.equal(fake.generations.length, 0);
    } finally { await fake.close(); }
});

test('HTTP fixture control fails exactly the next API request and keeps request records', async () => {
    const fake = await createFakeOpenAI({ reply: 'Retry succeeds', rate: 10000 });
    try {
        const configured = await fetch(new URL('/__configure', fake.url), { method: 'POST', body: JSON.stringify({ nextStatus: 500 }) });
        assert.equal(configured.status, 200);
        const body = { model: 'synthetic', messages: [], stream: false };
        const failed = await fetch(fake.url + '/chat/completions', { method: 'POST', body: JSON.stringify(body) });
        assert.equal(failed.status, 500);
        assert.match((await failed.json()).error.message, /Synthetic/);
        const retry = await fetch(fake.url + '/chat/completions', { method: 'POST', body: JSON.stringify(body) });
        assert.equal((await retry.json()).choices[0].message.content, 'Retry succeeds');
        assert.equal(fake.requests.length, 2);
        assert.equal(fake.generations[0].status, 500);
    } finally { await fake.close(); }
});
