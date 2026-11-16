import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { ProviderRequestError } from '../public/scripts/plugin-runtime/request-errors.js';

const openai = readFileSync(new URL('../public/scripts/openai.js', import.meta.url), 'utf8');
const script = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
const privateText = 'PRIVATE_PROMPT_REASONING sk-PRIVATE_KEY https://PRIVATE_USER:PRIVATE_PASSWORD@service.invalid';

function declaration(source, marker) {
    const start = source.indexOf(marker);
    const end = /^}/m.exec(source.slice(start));
    assert.ok(start >= 0 && end, `${marker} exists`);
    return source.slice(start, start + end.index + 1).replace(/^export /, '');
}

// Use the real transport, stream error parser and Generate.onError. Only host
// setup and I/O are fixtures; no browser, server or provider call is needed.
function fixture({ stream = false, status = 503, body, chunks = [] } = {}) {
    const notices = [], logs = [], unblocked = [];
    let reads = 0;
    const response = {
        status, ok: status >= 200 && status < 300, statusText: privateText,
        text: async () => typeof body === 'string' ? body : JSON.stringify(body),
        json: async () => body,
        body: { pipeThrough() {} },
    };
    const context = vm.createContext({
        AbortController, ProviderRequestError,
        oai_settings: {}, getChatCompletionModel: () => 'fixture',
        createGenerationParameters: async () => ({ generate_data: {}, stream, canMultiSwipe: false }),
        eventSource: { emit: async () => {} }, event_types: {}, getRequestHeaders: () => ({}),
        fetch: async () => response,
        getEventSourceStream: () => ({ readable: { getReader: () => ({ read: async () => reads < chunks.length
            ? { done: false, value: { data: chunks[reads++] } } : { done: true } }) } }),
        getStreamingReply: () => '正文', parseChatCompletionLogprobs: () => null,
        ToolManager: { parseToolCalls() {} }, delay: async () => {}, saveLogprobsForActiveMessage() {},
        toastr: { error: (...args) => notices.push(args), info: () => assert.fail('no raw moderation toast') },
        Popup: { show: { text: () => assert.fail('one toast owns quota failures') } },
        type: 'normal', streamingProcessor: {}, unblockGeneration: type => unblocked.push(type),
        console: { log: value => logs.push(value) },
        t: strings => strings.join(''),
    });
    for (const marker of ['function checkChatCompletionError(', 'export function tryParseStreamingError(', 'async function sendOpenAIRequest(']) {
        vm.runInContext(declaration(openai, marker), context);
    }
    const start = script.indexOf('    function onError(exception) {', script.indexOf('export async function Generate('));
    const end = script.indexOf('\n    }', start) + '\n    }'.length;
    assert.ok(start >= 0 && end > start, 'real Generate.onError exists');
    vm.runInContext(script.slice(start, end), context);
    return { context, notices, logs, unblocked, response, reads: () => reads,
        generate: async () => {
            const result = await context.sendOpenAIRequest('normal', [], null);
            if (stream) for await (const _chunk of result()) { /* Drain real stream generator. */ }
            return result;
        } };
}

async function expectOneFailure(lab, expected) {
    await assert.rejects(lab.generate(), error => {
        assert.ok(error instanceof ProviderRequestError);
        assert.equal(error.message, expected);
        assert.equal(error.cause, undefined);
        assert.throws(() => lab.context.onError(error), caught => caught === error);
        return true;
    });
    assert.equal(lab.notices.length, 1, 'Generate does not duplicate the transport notification');
    assert.deepEqual(lab.notices[0], [expected, '生成失败']);
    assert.deepEqual(lab.unblocked, ['normal']);
    assert.doesNotMatch(JSON.stringify([lab.notices, lab.logs]), /PRIVATE|https?:|sk-|service\.invalid/);
}

for (const stream of [true, false]) {
    test(`${stream ? 'streaming' : 'non-streaming'} HTTP 503 model_not_found produces one safe Chinese toast`, async () => {
        await expectOneFailure(fixture({ stream, body: { error: { code: 'model_not_found', type: 'invalid_request_error', message: privateText } } }),
            'HTTP 503：模型不存在或不可用');
    });

    test(`${stream ? 'streaming' : 'non-streaming'} HTTP errors survive absent, plain and malformed JSON bodies`, async () => {
        for (const body of ['', `<html>${privateText}</html>`, `{broken ${privateText}`, {}, { error: privateText }]) {
            await expectOneFailure(fixture({ stream, status: 502, body }), 'HTTP 502：上游服务响应异常');
        }
    });

    test(`${stream ? 'streaming' : 'non-streaming'} existing quota, context, moderation and nested error paths toast only once`, async () => {
        for (const [body, status, expected] of [
            [{ quota_error: true, error: { message: privateText } }, 429, 'HTTP 429：服务额度不足或请求过于频繁'],
            [{ error: { code: 'context_length_exceeded', message: privateText } }, 400, 'HTTP 400：请求超出模型上下文限制'],
            [{ error: { message: `requires moderation ${privateText}`, metadata: { flagged_input: privateText } } }, 403, 'HTTP 403：内容被服务安全策略拦截'],
            [{ detail: { error: { code: 'model_not_found', message: privateText } } }, 503, 'HTTP 503：模型不存在或不可用'],
        ]) await expectOneFailure(fixture({ stream, status, body }), expected);
    });
}

test('successful HTTP stream error envelopes stop reading and notify once without inventing an HTTP error status', async () => {
    const lab = fixture({ stream: true, status: 200, chunks: [
        '{"choices":[{"delta":{"content":"正文"}}]}',
        JSON.stringify({ error: { code: 'model_not_found', message: privateText } }),
        '{"choices":[{"delta":{"content":"不应读取"}}]}',
    ] });
    await expectOneFailure(lab, '模型不存在或不可用');
    assert.equal(lab.reads(), 2, 'a provider error is not swallowed as a JSON parse failure');
});

test('successful HTTP non-streaming error envelopes produce one safe fallback or known reason', async () => {
    for (const [body, expected] of [
        [{ error: { code: 'model_not_found', message: privateText } }, '模型不存在或不可用'],
        [{ error: { message: privateText } }, '服务未返回可用的错误原因'],
        [{ quota_error: true }, '服务额度不足或请求过于频繁'],
    ]) await expectOneFailure(fixture({ status: 200, body }), expected);
});

test('quiet callers receive sanitized throws without toasts and successful chunks remain unaffected', () => {
    const lab = fixture();
    for (const quiet of [true, false]) {
        assert.doesNotThrow(() => lab.context.tryParseStreamingError({ ok: true, status: 200 }, '{"choices":[]}', { quiet }));
        assert.doesNotThrow(() => lab.context.tryParseStreamingError({ ok: true, status: 200 }, '[DONE]', { quiet }));
    }
    for (const [response, body, expected] of [
        [lab.response, JSON.stringify({ error: { code: 'model_not_found', message: privateText } }), 'HTTP 503：模型不存在或不可用'],
        [lab.response, privateText, 'HTTP 503：服务暂时不可用'],
        [{ ok: true, status: 200 }, JSON.stringify({ error: { code: 'model_not_found' } }), '模型不存在或不可用'],
    ]) assert.throws(() => lab.context.tryParseStreamingError(response, body, { quiet: true }), error => error.message === expected);
    assert.deepEqual(lab.notices, []);
});
