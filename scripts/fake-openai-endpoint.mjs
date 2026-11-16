#!/usr/bin/env node
// Synthetic provider shared by browser measurements and lifecycle tests.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import seedrandom from 'seedrandom';
import { get_encoding } from 'tiktoken';

const introduction = `中文与 English paragraphs describe a quiet river and a patient traveller.\n\n**Bold observation** and *italic reflection*.\n\n1. Open the map.\n2. Follow the river.\n\n- 林间小路\n- A distant lantern\n\n> The journey continues beyond the bridge.\n\n\`\`\`javascript\nconst river = ['山', 'water'];\nconsole.log(river.join(' '));\n\`\`\`\n\n| Place | Light |\n| --- | --- |\n| 河岸 | gold |\n| Forest | blue |\n\n`;
const prose = ['The traveller watched the water and remembered the distant village. ', '风吹过河岸，灯光映在平静的水面上。', 'Every turn revealed another path through the trees, and the story continued without interruption. '];

export function streamingFixture({ tokens = 3000, seed = 'opus-streaming-s0', rate = 200, jitter = 0.25, reasoning = false, reply } = {}) {
    if (!Number.isInteger(tokens) || tokens < 1 || !(rate > 0) || !(jitter >= 0 && jitter <= 1)) throw new Error('Invalid streaming fixture options');
    const random = seedrandom(seed);
    const encoder = get_encoding('cl100k_base');
    try {
        let text = introduction;
        while (encoder.encode(text).length < tokens) text += prose[Math.floor(random() * prose.length)];
        const ids = reply === undefined ? encoder.encode(text).slice(0, tokens) : encoder.encode(reply);
        const decoder = new TextDecoder();
        const chunks = [];
        const append = (sequence, field) => {
            for (let i = 0; i < sequence.length;) {
                const count = Math.min(1 + Math.floor(random() * 3), sequence.length - i);
                const content = decoder.decode(encoder.decode(sequence.slice(i, i + count)), { stream: true });
                chunks.push({ field, content, tokens: count, delayMs: count / rate * 1000 * (1 + (random() * 2 - 1) * jitter) });
                i += count;
            }
        };
        if (reasoning) append(encoder.encode('先检查地图，然后沿着河岸前进。 Consider the route carefully. '.repeat(12)), 'reasoning');
        append(ids, 'content');
        return { content: new TextDecoder().decode(encoder.decode(ids)), chunks, tokens: ids.length, seed, rate, jitter, reasoning };
    } finally { encoder.free(); }
}

// Mimics a compliant piggyback model: echo the faces named in the request's
// instruction lines so the synthetic block always matches the local roll.
function piggybackReply(payload, piggyback) {
    const faces = [];
    for (const message of payload.messages ?? []) {
        const text = typeof message.content === 'string' ? message.content : '';
        for (const match of text.matchAll(/category="([^"]+)", title="([^"]+)"/g)) {
            faces.push({ category: match[1], title: match[2] });
        }
    }
    if (faces.length !== 3) return piggyback.story;
    const events = faces.map((face, index) => ({ ...face, event: piggyback.events[index] }));
    return piggyback.story + '\n[[DIRECTOR_FATE_OFFER]]\n' + JSON.stringify({ events });
}

export async function createFakeOpenAI(options = {}) {
    let fixture = streamingFixture(options);
    let piggyback = null;
    let piggybackChannel = 'story';
    let currentOptions = options;
    let nextStatus = 0;
    const requests = [], generations = [];
    const server = http.createServer(async (request, response) => {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Content-Type', 'application/json');
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (request.method === 'GET' && pathname === '/__requests') { response.end(JSON.stringify(requests)); return; }
        if (request.method === 'GET' && pathname === '/__timings') { response.end(JSON.stringify(generations)); return; }
        if (pathname.endsWith('/models')) { response.end(JSON.stringify({ data: [{ id: 'startup-synthetic', object: 'model' }] })); return; }
        const receivedEpochMs = performance.timeOrigin + performance.now();
        const receivedNs = process.hrtime.bigint();
        let body = '';
        for await (const chunk of request) body += chunk;
        let payload;
        try { payload = JSON.parse(body); } catch { response.writeHead(400).end('{}'); return; }
        if (pathname === '/__configure') {
            const { nextStatus: status = 0, piggyback: piggybackOption, piggybackChannel: channelOption, ...fixtureOptions } = payload;
            if (status !== 0 && (!Number.isInteger(status) || status < 400 || status > 599)) {
                response.writeHead(400).end('{}'); return;
            }
            if (channelOption !== undefined && !['story', 'candidate', 'reasoning'].includes(channelOption)) {
                response.writeHead(400).end('{}'); return;
            }
            if (piggybackOption && (typeof piggybackOption.story !== 'string' || !Array.isArray(piggybackOption.events)
                || piggybackOption.events.length !== 3 || piggybackOption.events.some(event => typeof event !== 'string'))) {
                response.writeHead(400).end('{}'); return;
            }
            try {
                if (Object.keys(fixtureOptions).length) { fixture = streamingFixture(fixtureOptions); currentOptions = fixtureOptions; }
            } catch { response.writeHead(400).end('{}'); return; }
            piggyback = piggybackOption ?? null;
            piggybackChannel = channelOption ?? 'story';
            nextStatus = status;
            response.end(JSON.stringify({ configured: true }));
            return;
        }
        requests.push(payload);
        if (!pathname.endsWith('/chat/completions')) { response.writeHead(404).end('{}'); return; }
        const generation = { receivedEpochMs, receivedNs: receivedNs.toString(), path: pathname, model: payload.model, messageCount: payload.messages?.length, chunks: [] };
        generations.push(generation);
        if (nextStatus) {
            generation.status = nextStatus;
            nextStatus = 0;
            response.writeHead(generation.status).end(JSON.stringify({ error: { message: 'Synthetic configured API failure' } }));
            return;
        }
        const compliant = piggyback ? piggybackReply(payload, piggyback) : null;
        const active = piggyback ? streamingFixture({ ...currentOptions, reply: piggybackChannel === 'story' ? compliant : piggyback.story }) : fixture;
        if (!payload.stream) {
            generation.lastChunkEpochMs = performance.timeOrigin + performance.now();
            const primary = { role: 'assistant', content: active.content };
            // A compliant model may leak the private block into an extra n>1 candidate
            // or into reasoning_content instead of the story; both must be sanitized.
            if (piggyback && piggybackChannel === 'reasoning') primary.reasoning_content = 'Synthetic reasoning.\n' + compliant;
            const choices = [{ index: 0, message: primary, finish_reason: 'stop' }];
            if (piggyback && piggybackChannel === 'candidate') choices.push({ index: 1, message: { role: 'assistant', content: compliant }, finish_reason: 'stop' });
            response.end(JSON.stringify({ id: 'synthetic', object: 'chat.completion', model: payload.model, usage: { prompt_tokens: 1, completion_tokens: active.tokens, total_tokens: active.tokens + 1 }, choices }));
            return;
        }
        response.setHeader('Content-Type', 'text/event-stream');
        response.setHeader('Cache-Control', 'no-cache');
        response.flushHeaders();
        for (const chunk of active.chunks) {
            await delay(chunk.delayMs);
            if (response.destroyed) return;
            const sent = performance.timeOrigin + performance.now();
            generation.firstChunkEpochMs ??= sent;
            generation.lastChunkEpochMs = sent;
            generation.chunks.push({ epochMs: sent, tokens: chunk.tokens, field: chunk.field });
            response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { [chunk.field]: chunk.content }, finish_reason: null }] })}\n\n`);
        }
        generation.doneEpochMs = performance.timeOrigin + performance.now();
        response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve); });
    return { server, requests, generations, url: `http://127.0.0.1:${server.address().port}/v1`,
        configure: options => (fixture = streamingFixture(options)),
        reset: () => { requests.length = 0; generations.length = 0; },
        close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const options = {};
    for (let i = 2; i < process.argv.length; i++) {
        const key = process.argv[i].replace(/^--/, '');
        if (key === 'reasoning') options.reasoning = true;
        else if (['port', 'tokens', 'rate', 'jitter', 'seed'].includes(key) && process.argv[i + 1]) options[key] = key === 'seed' ? process.argv[++i] : Number(process.argv[++i]);
        else throw new Error(`Unknown option ${process.argv[i]}`);
    }
    const fake = await createFakeOpenAI(options);
    console.log(JSON.stringify({ url: fake.url }));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await fake.close(); });
}
