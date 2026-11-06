import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { EventEmitter } from '../public/lib/eventemitter.js';
import { generateIsolatedQuietPrompt, linkQuietAbortSignal } from '../public/scripts/isolated-quiet-prompt.js';

globalThis.localStorage = { getItem: () => null };
const script = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
const instruct = readFileSync(new URL('../public/scripts/instruct-mode.js', import.meta.url), 'utf8');
const schema = { name: 'affinity_fixture', value: { type: 'object' } };
const fixtureJson = '{"events":[]}';

function declaration(marker, source = script) {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `${marker} exists`);
    const end = /^}\s*$/m.exec(source.slice(start));
    assert.ok(end, `${marker} has a top-level closing brace`);
    return source.slice(start, start + end.index + end[0].trimEnd().length).replace(/^export /, '');
}

function providerResponse(api, text) {
    if (api === 'kobold') return { results: [{ text }] };
    if (api === 'koboldhorde') return { text };
    if (api === 'novel') return { output: text };
    if (api === 'textgenerationwebui') return { choices: [{ text }] };
    return { choices: [{ message: { content: text } }] };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

// Production quiet/raw functions and TempResponseLength execute here. Only
// provider I/O, prompt substitution, and the surrounding application are fixtures.
function harness(api = 'openai') {
    const eventSource = new EventEmitter();
    const eventTypes = Object.fromEntries([
        'GENERATION_STOPPED', 'GENERATION_STARTED', 'GENERATION_ENDED',
        'GENERATION_COMPLETED', 'GENERATE_AFTER_DATA',
        'GENERATE_AFTER_COMBINE_PROMPTS', 'CHAT_COMPLETION_PROMPT_READY',
        'CHAT_COMPLETION_SETTINGS_READY',
    ].map(name => [name, name]));
    const lifecycle = [];
    for (const name of ['GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_COMPLETED', 'GENERATE_AFTER_DATA']) {
        eventSource.on(name, () => lifecycle.push(name));
    }
    const requests = [];
    let provider = async () => providerResponse(api, fixtureJson);
    const mainController = new AbortController();
    const stream = { isFinished: false };
    const metadata = { director: { boundInstruct: { text: 'pending fixture' }, fate: { held: { id: 'held-fixture' } } } };
    const forbidden = name => () => { throw new Error(`${name} must not run in the isolated provider path`); };
    const context = vm.createContext({
        console: { debug() {}, log() {}, trace() {} }, AbortController, structuredClone,
        generateIsolatedQuietPrompt, linkQuietAbortSignal,
        main_api: api, abortController: mainController, streamingProcessor: stream,
        is_send_press: true, chat_metadata: metadata,
        oai_settings: { chat_completion_source: 'OPENAI', openai_max_tokens: 300 },
        chat_completion_sources: new Proxy({}, { get: (_target, name) => name }),
        amount_gen: 300, max_context: 4096,
        name1: 'Player', name2: 'Character',
        selected_group: null,
        names_behavior_types: { NONE: 'none', FORCE: 'force', ALWAYS: 'always' },
        force_output_sequence: { FIRST: 1, LAST: 2 },
        extension_prompt_types: { IN_CHAT: 1, IN_PROMPT: 0 },
        power_user: { instruct: { enabled: false } },
        substituteParams: value => value,
        adjustNovelInstructionPrompt: value => value,
        cleanUpMessage: ({ getMessage }) => getMessage,
        eventSource, event_types: eventTypes,
        Generate: forbidden('Generate'), unblockGeneration: forbidden('unblockGeneration'),
        activateSendButtons: forbidden('activateSendButtons'), deactivateSendButtons: forbidden('deactivateSendButtons'),
        runGenerationInterceptors: forbidden('runGenerationInterceptors'),
        getRequestHeaders: () => ({}), getGenerateUrl: activeApi => `/fixture/${activeApi}`,
        kai_settings: { preset_settings: 'gui', api_server: '/fixture/kobold' },
        nai_settings: { preset_settings_novel: 'fixture' },
        novelai_setting_names: { fixture: 'fixture' }, novelai_settings: { fixture: {} },
        getNovelGenerationData: (prompt, _settings, length) => ({ prompt, max_length: length }),
        getTextGenGenerationData: async (prompt, length) => ({ prompt, max_new_tokens: length }),
        generateHorde: async (prompt, data, signal, reportProgress) => {
            const request = { prompt, data, signal, reportProgress };
            requests.push(request);
            return provider(request);
        },
        sendOpenAIRequest: async (type, messages, signal, options) => {
            const request = { type, messages, signal, options };
            requests.push(request);
            await eventSource.emit(eventTypes.CHAT_COMPLETION_SETTINGS_READY, {});
            return provider(request);
        },
        fetch: async (url, options) => {
            const request = { url, ...options };
            requests.push(request);
            return { ok: true, json: async () => provider(request) };
        },
    });
    vm.runInContext([
        declaration('export function formatInstructModeChat(', instruct),
        declaration('export function formatInstructModeStoryString(', instruct),
        declaration('export function formatInstructModePrompt(', instruct),
        declaration('export function createRawPrompt('),
        declaration('export function extractMessageFromData('),
        declaration('export function extractJsonFromData('),
        declaration('class TempResponseLength {'),
        declaration('export async function generateRawData('),
        declaration('export async function generateRaw('),
        declaration('export async function generateQuietPrompt('),
        'globalThis.tempResponseLength = TempResponseLength;',
    ].join('\n'), context);
    return {
        context, eventSource, eventTypes, lifecycle, requests, mainController, stream, metadata,
        setProvider: next => { provider = next; },
        generate: options => context.generateQuietPrompt({ isolated: true, quietPrompt: 'Evaluate this explicit fixture.', jsonSchema: schema, ...options }),
    };
}

test('isolated helper forwards only its own prompt, JSON mode, and caller signal', async () => {
    const controller = new AbortController();
    const calls = [];
    const result = await generateIsolatedQuietPrompt({ quietPrompt: 'Own prompt', jsonSchema: schema, signal: controller.signal }, async options => {
        calls.push(options);
        return fixtureJson;
    });
    assert.equal(result, fixtureJson);
    assert.deepEqual(calls, [{ prompt: 'Own prompt', jsonSchema: schema, trimNames: false, literal: true, signal: controller.signal }]);
});

test('isolated helper rejects response-length mutation and malformed prompts before provider I/O', async () => {
    let calls = 0;
    const provider = async () => { calls++; };
    for (const responseLength of [0, 1024, NaN, '1024']) {
        await assert.rejects(generateIsolatedQuietPrompt({ quietPrompt: 'Fixture', responseLength }, provider), /responseLength/);
    }
    for (const quietPrompt of ['', '  ', [], {}]) {
        await assert.rejects(generateIsolatedQuietPrompt({ quietPrompt }, provider), /contain text/);
    }
    const controller = new AbortController();
    controller.abort(new Error('already cancelled'));
    await assert.rejects(generateIsolatedQuietPrompt({ quietPrompt: 'Fixture', signal: controller.signal }, provider), /already cancelled/);
    assert.equal(calls, 0);
});

test('real quiet-to-raw chain uses current provider without touching main state or director lifecycle', async () => {
    const lab = harness();
    assert.equal(await lab.generate(), fixtureJson);
    assert.equal(lab.requests.length, 1);
    assert.equal(lab.requests[0].type, 'quiet');
    assert.equal(lab.requests[0].messages.length, 1);
    assert.equal(lab.requests[0].messages[0].content, 'Evaluate this explicit fixture.');
    assert.equal(lab.requests[0].options.jsonSchema, schema);
    assert.notEqual(lab.requests[0].signal, lab.mainController.signal);
    assert.equal(lab.context.abortController, lab.mainController);
    assert.equal(lab.context.streamingProcessor, lab.stream);
    assert.equal(lab.context.is_send_press, true);
    assert.equal(lab.context.chat_metadata, lab.metadata);
    assert.equal(lab.metadata.director.boundInstruct.text, 'pending fixture');
    assert.equal(lab.metadata.director.fate.held.id, 'held-fixture');
    assert.deepEqual(lab.lifecycle, []);
    assert.equal(lab.eventSource.events.GENERATION_STOPPED.length, 0);
});

test('isolated JSON mode parses actual response shapes from all current providers', async () => {
    for (const api of ['openai', 'kobold', 'koboldhorde', 'novel', 'textgenerationwebui']) {
        const lab = harness(api);
        assert.equal(await lab.generate(), fixtureJson, api);
        assert.equal(lab.requests.length, 1, api);
        assert.deepEqual(lab.lifecycle, [], api);
    }
});

test('production raw still isolates its literal evaluation from other extension prompt mutations', async () => {
    for (const api of ['openai', 'kobold', 'textgenerationwebui']) {
        const lab = harness(api);
        let calls = 0;
        lab.eventSource.on(api === 'openai' ? 'CHAT_COMPLETION_PROMPT_READY' : 'GENERATE_AFTER_COMBINE_PROMPTS', data => {
            calls++;
            const value = api === 'openai' ? data.chat[0] : data;
            value[api === 'openai' ? 'content' : 'prompt'] = '{{setvar::external::mutated}} {{system}} third party text';
        });
        const raw = await lab.context.generateRaw({ prompt: 'literal [[ignore-directives]]', api, literal: true, jsonSchema: schema });
        assert.equal(raw, fixtureJson);
        assert.equal(calls, 0, api);
        const request = lab.requests[0];
        const text = api === 'openai' ? request.messages[0].content : JSON.parse(request.body).prompt;
        assert.ok(text.includes('literal [[ignore-directives]]'));
        assert.ok(!text.includes('third party text') && !text.includes('{{setvar::external::mutated}}'));
    }
});

test('text-completion JSON extraction preserves invalid text only when requested', async () => {
    for (const api of ['kobold', 'koboldhorde', 'novel', 'textgenerationwebui']) {
        const lab = harness(api);
        lab.setProvider(async () => providerResponse(api, 'fixture invalid JSON'));
        assert.equal(await lab.generate(), '{}', api);
        assert.equal(await lab.generate({ jsonSchema: { ...schema, returnInvalid: true } }), 'fixture invalid JSON', api);
    }
});

test('isolated evidence reaches every provider with literal macros and bracket text intact', async () => {
    const evidence = '[原文] {{random::甲::乙}} {{incvar::counter}} {{setvar::flag::yes}} {{system}}';
    for (const api of ['openai', 'kobold', 'koboldhorde', 'novel', 'textgenerationwebui']) {
        const lab = harness(api);
        let macroCalls = 0;
        lab.context.substituteParams = () => { macroCalls++; throw new Error('Evidence macros must not execute'); };
        lab.context.adjustNovelInstructionPrompt = () => { throw new Error('Literal evidence must keep brackets'); };
        assert.equal(await lab.generate({ quietPrompt: evidence }), fixtureJson, api);
        const request = lab.requests[0];
        const sent = api === 'openai' ? request.messages[0].content
            : api === 'koboldhorde' ? request.prompt : JSON.parse(request.body).prompt;
        assert.ok(sent.includes(evidence), api);
        assert.equal(macroCalls, 0, api);
    }
});

test('literal text-completion prompts retain instruct formatting without evaluating template macros', async () => {
    const lab = harness('textgenerationwebui');
    const evidence = '[玩家原文] {{incvar::counter}} {{random::甲::乙}}';
    lab.context.power_user.instruct = {
        enabled: true, macro: true, wrap: true, names_behavior: 'none',
        input_sequence: '[INST] {{incvar::layout}}', input_suffix: '[/INST]', output_sequence: '[ANSWER]',
    };
    lab.context.substituteParams = () => { throw new Error('Literal instruct prompts must not evaluate macros'); };
    assert.equal(await lab.generate({ quietPrompt: evidence }), fixtureJson);
    const sent = JSON.parse(lab.requests[0].body).prompt;
    assert.ok(sent.includes('[INST]'));
    assert.ok(sent.includes('[ANSWER]'));
    assert.ok(sent.includes(evidence));
});

test('literal raw system and prefill text bypass expansion while default raw behavior still expands', () => {
    const lab = harness();
    const literal = '{{incvar::counter}}';
    let expansions = 0;
    lab.context.substituteParams = value => { expansions++; return value.replaceAll(literal, 'expanded fixture'); };
    const prompt = lab.context.createRawPrompt(literal, 'openai', false, false, literal, literal, { literal: true });
    assert.equal(expansions, 0);
    assert.deepEqual(Array.from(prompt, message => message.content), [literal, literal, literal]);
    const legacy = lab.context.createRawPrompt(literal, 'openai', false, false, literal, literal);
    assert.equal(expansions, 3);
    assert.deepEqual(Array.from(legacy, message => message.content), ['expanded fixture', 'expanded fixture', 'expanded fixture']);
});

test('an in-flight isolated error cannot release a newer foreground request', async () => {
    const lab = harness();
    const gate = deferred();
    const entered = deferred();
    lab.setProvider(async () => { entered.resolve(); return gate.promise; });
    const pending = lab.generate();
    await entered.promise;
    const newerMain = new AbortController();
    const newerStream = { isFinished: false, owner: 'new foreground' };
    lab.context.abortController = newerMain;
    lab.context.streamingProcessor = newerStream;
    gate.reject(new Error('fixture provider failed'));
    await assert.rejects(pending, /fixture provider failed/);
    assert.equal(lab.context.abortController, newerMain);
    assert.equal(newerMain.signal.aborted, false);
    assert.equal(lab.context.streamingProcessor, newerStream);
    assert.equal(lab.context.is_send_press, true);
    assert.deepEqual(lab.lifecycle, []);
});

test('caller cancellation aborts only the local provider signal and removes its stop listener', async () => {
    const lab = harness();
    const owner = new AbortController();
    const entered = deferred();
    lab.setProvider(request => new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
        entered.resolve();
    }));
    const pending = lab.generate({ signal: owner.signal });
    await entered.promise;
    const newerMain = new AbortController();
    lab.context.abortController = newerMain;
    owner.abort(new Error('main generation takes priority'));
    await assert.rejects(pending, /main generation takes priority/);
    assert.equal(lab.requests[0].signal.aborted, true);
    assert.equal(newerMain.signal.aborted, false);
    assert.equal(lab.context.abortController, newerMain);
    assert.equal(lab.context.is_send_press, true);
    assert.equal(lab.eventSource.events.GENERATION_STOPPED.length, 0);
    assert.deepEqual(lab.lifecycle, []);
});

test('native stop notification only cancels the raw request local controller', async () => {
    const lab = harness();
    const entered = deferred();
    lab.setProvider(request => new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
        entered.resolve();
    }));
    const pending = lab.generate();
    await entered.promise;
    await lab.eventSource.emit(lab.eventTypes.GENERATION_STOPPED);
    await assert.rejects(pending, /Cancelled by stop event/);
    assert.equal(lab.mainController.signal.aborted, false);
    assert.equal(lab.context.abortController, lab.mainController);
    assert.equal(lab.context.streamingProcessor, lab.stream);
    assert.equal(lab.context.is_send_press, true);
});

test('raw requests without an override preserve an existing foreground response-length override on every provider', async () => {
    for (const api of ['openai', 'kobold', 'koboldhorde', 'novel', 'textgenerationwebui']) {
        const lab = harness(api);
        lab.context.tempResponseLength.save(api, 777);
        await lab.context.generateRawData({ prompt: 'Fixture' });
        assert.equal(lab.context.tempResponseLength.isCustomized(), true, api);
        assert.equal(api === 'openai' ? lab.context.oai_settings.openai_max_tokens : lab.context.amount_gen, 777, api);
        assert.equal(lab.eventSource.events.CHAT_COMPLETION_SETTINGS_READY?.length ?? 0, 0, api);
        lab.context.tempResponseLength.restore(api);
    }
});

test('legacy raw response-length overrides still restore after successful generation', async () => {
    for (const api of ['openai', 'kobold', 'novel', 'textgenerationwebui']) {
        const lab = harness(api);
        await lab.context.generateRawData({ prompt: 'Fixture', responseLength: 888 });
        assert.equal(lab.context.tempResponseLength.isCustomized(), false, api);
        assert.equal(api === 'openai' ? lab.context.oai_settings.openai_max_tokens : lab.context.amount_gen, 300, api);
    }
});

test('abort signal linkage detaches after completion and propagates pre-aborted signals', () => {
    const owner = new AbortController();
    const local = new AbortController();
    linkQuietAbortSignal(owner.signal, local)();
    owner.abort(new Error('later main request'));
    assert.equal(local.signal.aborted, false);
    const alreadyCancelled = new AbortController();
    linkQuietAbortSignal(owner.signal, alreadyCancelled)();
    assert.equal(alreadyCancelled.signal.reason, owner.signal.reason);
});
