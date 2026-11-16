import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
const raw = 'Visible story.\n[[DIRECTOR_FATE_OFFER]]\n{"events":["private"]}';
const clean = 'Visible story.';

test('streaming normal return and continuation chunk follow the finalized cleaned message', async () => {
    const chat = [{ mes: raw }];
    let continuation;
    const processor = { messageId: 0, abortController: new AbortController(),
        onFinishStreaming: async () => { chat[0].mes = clean; } };
    const sandbox = vm.createContext({ chat, streamingProcessor: processor, messageChunk: raw,
        type: 'normal', isContinue: false, isImpersonate: false,
        notifyGenerationCompleted: async () => {}, triggerAutoContinue: text => { continuation = text; } });
    const start = source.indexOf('                const completedStream = streamingProcessor;');
    const end = source.indexOf('\n            }\n        } else {', start);
    assert.ok(start >= 0 && end > start);
    vm.runInContext('async function finish(getMessage) {' + source.slice(start, end) + '\n}', sandbox);
    const result = await sandbox.finish(raw);
    assert.equal(String(result), clean);
    assert.equal(result.messageChunk, clean);
    assert.equal(continuation, clean);
    assert.equal(result.fromStream, true);
});

test('non-streaming normal return chunk follows the saveReply sanitized result', async () => {
    let continuation;
    const sandbox = vm.createContext({
        type: 'normal', originalType: 'normal', isImpersonate: false, isContinue: false,
        canPerformToolCalls: false, jsonSchema: null, power_user: { trim_spaces: false, auto_swipe: false },
        abortController: new AbortController(), streamingProcessor: null, kobold_horde_model: '', continue_mag: '',
        console: { debug() {} }, regex_placement: { REASONING: 1 },
        extractMessageFromData: () => raw, extractTitleFromData: () => '', extractReasoningFromData: () => '',
        extractImagesFromData: () => [], extractReasoningSignatureFromData: () => null, extractMultiSwipes: () => [],
        cleanUpMessage: ({ getMessage }) => getMessage, getRegexedString: value => value,
        saveReply: async () => ({ type: 'normal', getMessage: clean }), parseAndSaveLogprobs() {},
        playMessageSound() {}, saveChatConditional: async () => true, notifyGenerationCompleted: async () => {},
        unblockGeneration() {}, triggerAutoContinue: text => { continuation = text; },
    });
    const start = source.indexOf('    async function onSuccess(data)');
    const end = source.indexOf('\n    /**', start);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(source.slice(start, end), sandbox);
    const result = await sandbox.onSuccess({ choices: [] });
    assert.equal(String(result), clean);
    assert.equal(result.messageChunk, clean);
    assert.equal(continuation, clean);
});

test('a chat switch while streaming finalization waits cannot substitute another chat into the return', async () => {
    const origin = { mes: raw };
    let continuationCalls = 0;
    const sandbox = vm.createContext({ chat: [origin], type: 'normal', messageChunk: raw, isImpersonate: false,
        notifyGenerationCompleted: async () => {}, triggerAutoContinue() { continuationCalls++; } });
    sandbox.streamingProcessor = { messageId: 0, abortController: new AbortController(),
        onFinishStreaming: async () => { origin.mes = clean; sandbox.chat = [{ mes: 'OTHER_CHAT_CONTENT' }]; } };
    const start = source.indexOf('                const completedStream = streamingProcessor;');
    const end = source.indexOf('\n            }\n        } else {', start);
    vm.runInContext('async function finish(getMessage) {' + source.slice(start, end) + '\n}', sandbox);
    const result = await sandbox.finish(raw);
    assert.equal(String(result), clean);
    assert.equal(result.messageChunk, clean);
    assert.equal(continuationCalls, 0);
});
