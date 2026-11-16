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

test('piggyback mode echoes the faces named in the request and clears on reconfigure', async () => {
    const fake = await createFakeOpenAI({ reply: 'Plain', rate: 10000, tokens: 8 });
    try {
        const piggyback = { story: 'Story body.', events: ['ONE', 'TWO', 'THREE'] };
        const configured = await fetch(new URL('/__configure', fake.url), { method: 'POST', body: JSON.stringify({ reply: 'Story body.', tokens: 8, rate: 10000, piggyback }) });
        assert.equal(configured.status, 200);
        const instruction = '第1张: category="echo", title="尘封的低语"。\n第2张: category="gift", title="命运的馈赠"。\n第3张: category="turn", title="悄然转向"。';
        const body = { model: 'synthetic', messages: [{ role: 'system', content: instruction }], stream: false };
        const expected = 'Story body.\n[[DIRECTOR_FATE_OFFER]]\n' + JSON.stringify({ events: [
            { category: 'echo', title: '尘封的低语', event: 'ONE' },
            { category: 'gift', title: '命运的馈赠', event: 'TWO' },
            { category: 'turn', title: '悄然转向', event: 'THREE' },
        ] });
        const content = (await (await fetch(fake.url + '/chat/completions', { method: 'POST', body: JSON.stringify(body) })).json()).choices[0].message.content;
        assert.equal(content, expected);
        body.stream = true;
        const text = await (await fetch(fake.url + '/chat/completions', { method: 'POST', body: JSON.stringify(body) })).text();
        const streamed = text.split('\n\n').filter(Boolean).map(s => s.slice(6)).slice(0, -1).map(s => JSON.parse(s).choices[0].delta.content || '').join('');
        assert.equal(streamed, expected);
        const plain = (await (await fetch(fake.url + '/chat/completions', { method: 'POST', body: JSON.stringify({ ...body, stream: false, messages: [] }) })).json()).choices[0].message.content;
        assert.equal(plain, 'Story body.');
        assert.equal((await fetch(new URL('/__configure', fake.url), { method: 'POST', body: JSON.stringify({ piggyback: { story: 'x', events: ['a'] } }) })).status, 400);
        await fetch(new URL('/__configure', fake.url), { method: 'POST', body: JSON.stringify({ reply: 'Plain again', tokens: 8 }) });
        const cleared = (await (await fetch(fake.url + '/chat/completions', { method: 'POST', body: JSON.stringify({ ...body, stream: false }) })).json()).choices[0].message.content;
        assert.equal(cleared, 'Plain again');
    } finally { await fake.close(); }
});

test('piggyback channel routes the private block into an extra candidate or reasoning', async () => {
    const fake = await createFakeOpenAI({ reply: 'Story body.', rate: 10000, tokens: 8 });
    try {
        const piggyback = { story: 'Story body.', events: ['ONE', 'TWO', 'THREE'] };
        const instruction = '第1张: category="echo", title="尘封的低语"。\n第2张: category="gift", title="命运的馈赠"。\n第3张: category="turn", title="悄然转向"。';
        const block = '[[DIRECTOR_FATE_OFFER]]\n' + JSON.stringify({ events: [
            { category: 'echo', title: '尘封的低语', event: 'ONE' },
            { category: 'gift', title: '命运的馈赠', event: 'TWO' },
            { category: 'turn', title: '悄然转向', event: 'THREE' },
        ] });
        const body = { model: 'synthetic', messages: [{ role: 'system', content: instruction }], stream: false };
        const configure = channel => fetch(new URL('/__configure', fake.url), { method: 'POST', body: JSON.stringify({ reply: 'Story body.', tokens: 8, rate: 10000, piggyback, piggybackChannel: channel }) });
        await configure('candidate');
        const candidate = (await (await fetch(fake.url + '/chat/completions', { method: 'POST', body: JSON.stringify(body) })).json()).choices;
        assert.equal(candidate.length, 2);
        assert.equal(candidate[0].message.content, 'Story body.');
        assert.equal(candidate[0].message.reasoning_content, undefined);
        assert.equal(candidate[1].message.content, 'Story body.\n' + block);
        await configure('reasoning');
        const reasoning = (await (await fetch(fake.url + '/chat/completions', { method: 'POST', body: JSON.stringify(body) })).json()).choices;
        assert.equal(reasoning.length, 1);
        assert.equal(reasoning[0].message.content, 'Story body.');
        assert.equal(reasoning[0].message.reasoning_content, 'Synthetic reasoning.\nStory body.\n' + block);
        assert.equal((await fetch(new URL('/__configure', fake.url), { method: 'POST', body: JSON.stringify({ piggybackChannel: 'bogus' }) })).status, 400);
    } finally { await fake.close(); }
});
