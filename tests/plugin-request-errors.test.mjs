import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createIsolatedGenerator } from '../public/scripts/plugin-runtime/requests.js';
import { ProviderRequestError, publicFailureMessage, safeRequestReason } from '../public/scripts/plugin-runtime/request-errors.js';

const privateText = 'PRIVATE_CHAT_QUOTE_REASONING';
const credentialUrl = 'https://PRIVATE_USER:PRIVATE_PASSWORD@service.invalid/?key=PRIVATE_KEY';

test('provider errors expose only bounded fixed reasons, never arbitrary upstream text or credentials', () => {
    for (const error of [
        { status: 400, message: `Invalid response_format ${credentialUrl} ${privateText} ${'x'.repeat(20000)}` },
        { error: { status: 400, message: `Invalid json_schema ${credentialUrl}`, reasoning: privateText } },
        Object.assign(new Error(`HTTP 400 response_format ${privateText}`), { stack: privateText }),
    ]) {
        const reason = safeRequestReason(error);
        assert.match(reason, /HTTP 400.*结构化输出参数被服务拒绝/);
        assert.ok(reason.length < 80);
        assert.doesNotMatch(reason, /PRIVATE|https?:|service\.invalid|\bx{10}/);
        const publicError = new ProviderRequestError(error);
        assert.equal(publicError.message, reason);
        assert.equal(publicError.cause, undefined, 'the raw cause is discarded');
        assert.doesNotMatch(JSON.stringify(publicError), /PRIVATE/);
    }
    assert.equal(safeRequestReason({ status: 200, error: { message: 'Bad Request' } }), '请求参数被服务拒绝（Bad Request）');
    assert.equal(safeRequestReason(new Error(privateText)), '');
    assert.equal(new ProviderRequestError(new Error(privateText)).message, '服务未返回可用的错误原因');
    assert.equal(publicFailureMessage(new Error(privateText), '未能发牌，请重试。'), '未能发牌，请重试。');
    assert.equal(publicFailureMessage(new Error('正在生成，请稍后重试。'), '未能发牌，请重试。'), '正在生成，请稍后重试。');
});

test('HTTP status and known connection, context and quota reasons remain actionable', () => {
    for (const [error, expected] of [
        [{ status: 429, message: privateText }, /HTTP 429.*额度不足/],
        [{ status: 503, message: privateText }, /HTTP 503.*暂时不可用/],
        [{ status: 401, message: privateText }, /HTTP 401.*授权失败/],
        [new Error(`context_length_exceeded ${privateText}`), /超出模型上下文/],
        [new Error(`Failed to fetch ${credentialUrl}`), /无法连接服务/],
    ]) assert.match(safeRequestReason(error), expected);
});

const source = readFileSync(new URL('../public/scripts/custom-request.js', import.meta.url), 'utf8');
// Execute each real non-streaming service method. Imports and transport alone
// are fixtures, so HTTP 200 error envelopes exercise the actual throw path.
function nativeService(index, response) {
    let start = -1;
    for (let occurrence = 0; occurrence <= index; occurrence++) start = source.indexOf('    static async sendRequest(', start + 1);
    assert.ok(start >= 0);
    const end = source.indexOf('\n    }', start) + '\n    }'.length;
    return vm.runInNewContext(`(class Service { static TYPE = 'fixture'; ${source.slice(start, end)} })`, {
        AbortController, fetch: async () => response, getGenerateUrl: () => '/fixture', getRequestHeaders: () => ({}),
    });
}

for (const index of [0, 1]) {
    test(`native service ${index} preserves HTTP status through the isolated error boundary`, async () => {
        const c = {
            mainApi: index === 0 ? 'textgenerationwebui' : 'openai',
            textCompletionSettings: { type: 'vllm', vllm_model: 'fixture' },
            chatCompletionSettings: { chat_completion_source: 'custom', custom_model: 'fixture' },
        };
        const serviceKey = index === 0 ? 'TextCompletionService' : 'ChatCompletionService';
        for (const [status, errorMessage, expected] of [
            [400, `Invalid response_format ${privateText} ${credentialUrl}`, /HTTP 400.*结构化输出/],
            [200, 'Bad Request', /请求参数被服务拒绝（Bad Request）/],
        ]) {
            c[serviceKey] = nativeService(index, { ok: status === 200, status, json: async () => ({ error: { message: errorMessage }, quota_error: false }) });
            await assert.rejects(createIsolatedGenerator(() => c)({ quietPrompt: privateText }), error => {
                assert.match(error.message, expected);
                assert.doesNotMatch(error.message, /PRIVATE|https?:/);
                assert.equal(error.cause, undefined);
                return true;
            });
        }
    });
}

test('legacy transport retains HTTP failures even when no JSON error body can be read', async () => {
    const c = { mainApi: 'kobold', getRequestHeaders: () => ({}), koboldSettings: {} };
    const generate = createIsolatedGenerator(() => c, { fetch: async () => ({
        ok: false, status: 502, json: async () => { throw new Error(privateText); },
    }) });
    await assert.rejects(generate({ quietPrompt: privateText }), /HTTP 502.*上游服务响应异常/);
});
