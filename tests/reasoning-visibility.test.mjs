import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const reasoning = read('../public/scripts/reasoning.js');
const script = read('../public/script.js');
const openai = read('../public/scripts/openai.js');
const powerUser = read('../public/scripts/power-user.js');
const utils = read('../public/scripts/utils.js');

// Execute production statements; DOM, Markdown and events are synthetic boundaries.
// These are unit tests, not browser rendering tests.
function declaration(source, marker) {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `${marker} exists`);
    const end = /^};?$/m.exec(source.slice(start));
    assert.ok(end, `${marker} has a top-level closing brace`);
    return source.slice(start, start + end.index + end[0].length).replace(/^export /, '');
}

function fixture({ show = false, autoParse = true, trim = true, mainApi = 'openai' } = {}) {
    class Element {
        dataset = {};
        open = false;
        title = '';
        html = '';
        classes = new Set();
        classList = {
            toggle: (key, value) => value ? this.classes.add(key) : this.classes.delete(key),
            remove: key => this.classes.delete(key),
        };
        getAttribute() { return '0'; }
        get innerHTML() { return this.html; }
        set innerHTML(value) { this.html = value; }
        get textContent() { return this.html; }
        set textContent(value) { this.html = value; }
    }
    const nodes = Object.fromEntries(['.mes_text', '.mes_reasoning_details', '.mes_reasoning', '.mes_reasoning_header_title', '.mes_edit_add_reasoning'].map(key => [key, new Element()]));
    const messageDom = new Element();
    messageDom.querySelector = key => nodes[key] ?? null;
    const chat = [{ mes: '', name: 'Fixture', is_user: false, is_system: false, extra: {} }];
    const listeners = new Map();
    let saves = 0;
    const eventTypes = Object.fromEntries(['MESSAGE_RECEIVED', 'MESSAGE_UPDATED', 'GENERATION_STOPPED', 'GENERATION_ENDED', 'CHAT_CHANGED', 'IMPERSONATE_READY', 'STREAM_REASONING_DONE'].map(key => [key, key]));
    const context = vm.createContext({
        console: { debug() {}, warn() {}, error: error => { throw error; } },
        performance, Date, AbortController, Event, HTMLElement: Element,
        chat, main_api: mainApi, oai_settings: { show_thoughts: show },
        power_user: {
            trim_spaces: trim, optimized_streaming: false, stream_fade_in: false,
            allow_name2_display: true,
            reasoning: { auto_parse: autoParse, prefix: '<think>', suffix: '</think>', auto_expand: true },
        },
        document: { querySelector: () => messageDom },
        streamingPerfEnabled: false, recordStreamingDomMode() {},
        setDatasetProperty(element, key, value) {
            if (value === null) delete element.dataset[key];
            else element.dataset[key] = value;
        },
        getRegexedString: value => value,
        regex_placement: { REASONING: 6, AI_OUTPUT: 2, USER_INPUT: 1 },
        getChatCompletionModel: () => '',
        moment: { duration: () => ({ asSeconds: () => 0, locale: () => ({ humanize: () => '0s' }) }) },
        getCurrentLocale: () => 'en',
        t: (parts, ...values) => parts.reduce((value, part, i) => value + part + (values[i] ?? ''), ''),
        translate: value => value,
        replaceStreamingHtml(element, html) { element.innerHTML = html; return 'full'; },
        event_types: eventTypes,
        eventSource: {
            on: (event, callback) => listeners.set(event, callback),
            makeFirst: (event, callback) => listeners.set(event, callback),
            emit: async (event, ...args) => listeners.get(event)?.(...args),
        },
        syncMesToSwipe() {}, saveChatDebounced() { saves++; },
        updateMessageBlock(id, message) { nodes['.mes_text'].innerHTML = context.messageFormatting(message.mes, message.name, message.is_system, message.is_user, id, {}, false); },
        COMMENT_NAME_DEFAULT: 'Comment', systemUserName: 'System', mesForShowdownParse: '',
        substituteParams: value => value,
        getMessageDepth: () => 0,
        MessageFormatter: { stage: {}, runStage: (_stage, value) => value },
        escapeHtml: value => value.replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
        converter: { makeHtml: value => value },
        DOMPurify: { sanitize: value => value },
        encodeStyleTags: value => value, decodeStyleTags: value => value,
        scrollLock: true, prepareStreamingScroll() {},
        cleanUpMessage: ({ getMessage }) => getMessage,
        countOccurrences: (value, part) => value.split(part).length - 1,
        isOdd: value => value % 2 !== 0,
    });
    const declarations = [
        declaration(utils, 'export function escapeRegex('),
        declaration(utils, 'export function trimSpaces('),
        declaration(openai, 'export const chat_completion_sources ='),
        declaration(reasoning, 'export const ReasoningType ='),
        declaration(reasoning, 'export const ReasoningState ='),
        declaration(reasoning, 'export function isHiddenReasoningModel('),
        declaration(reasoning, 'export class ReasoningHandler {'),
        declaration(reasoning, 'export class PromptReasoning {'),
        declaration(reasoning, 'export function parseReasoningFromString('),
        declaration(reasoning, 'export function parseReasoningInSwipes('),
        declaration(reasoning, 'export function extractReasoningFromData('),
        declaration(reasoning, 'function registerReasoningAppEvents('),
        declaration(openai, 'export function getStreamingReply('),
        declaration(script, 'export function messageFormatting('),
        declaration(script, 'class StreamingProcessor {'),
    ];
    vm.runInContext(`${declarations.join('\n')}\nregisterReasoningAppEvents();\nglobalThis.Handler = ReasoningHandler; globalThis.Processor = StreamingProcessor;`, context);
    const handler = new context.Handler();
    return {
        context, handler, chat, nodes, messageDom,
        get saves() { return saves; },
        async tick(text, isFinal = false, prompt) {
            chat[0].mes = text;
            await handler.process(0, true, prompt, { isFinal });
            handler.updateDom(0);
            return chat[0].mes;
        },
        format: (text = chat[0].mes, user = false, isReasoning = false) => context.messageFormatting(text, '', false, user, 0, {}, isReasoning),
        event: event => context.eventSource.emit(eventTypes[event], 0),
    };
}

function assertNoReasoning(lab) {
    assert.equal(lab.handler.reasoning, '');
    assert.equal(lab.nodes['.mes_reasoning'].textContent, '');
    assert.equal(lab.nodes['.mes_reasoning_header_title'].textContent, '');
    assert.equal(lab.nodes['.mes_reasoning_details'].open, false);
    assert.equal(lab.messageDom.classes.has('reasoning'), false);
    assert.equal(Object.keys(lab.chat[0].extra).some(key => key.startsWith('reasoning')), false);
}

test('each opening and closing character stays out of the message and reasoning UI', async () => {
    const lab = fixture();
    const raw = '<think>。\n隐藏</think>正文..';
    for (let i = 1; i <= raw.length; i++) {
        const text = raw.slice(0, i);
        const expected = text.includes('</think>') ? text.split('</think>')[1] : '';
        assert.equal(await lab.tick(text), expected, `chunk ${i}`);
        assertNoReasoning(lab);
    }
    await lab.handler.finish(0);
    assert.equal(lab.chat[0].mes, '正文..');
    assertNoReasoning(lab);
});

test('leading whitespace never flashes and the response keeps existing trim conventions', async () => {
    for (const trim of [true, false]) {
        const lab = fixture({ trim });
        const raw = ' \n\t<think>隐藏</think>\n 正文 \n';
        for (let i = 1; i <= raw.indexOf('</think>') + 8; i++) {
            assert.equal(await lab.tick(raw.slice(0, i)), '');
        }
        assert.equal(await lab.tick(raw, true), trim ? '正文' : '\n 正文 \n');
        assertNoReasoning(lab);
    }
});

test('mismatched candidates and literal tags inside prose are released exactly', async () => {
    for (const text of ['<thistle...', '他说<think>，是字面代码。', '他<', 'x < y', '<', ' \n<thi']) {
        const lab = fixture();
        for (let i = 1; i <= text.length; i++) await lab.tick(text.slice(0, i));
        assert.equal(await lab.tick(text, true), text);
        await lab.handler.finish(0);
        assert.equal(lab.chat[0].mes, text);
    }
});

test('completion suppresses an unclosed confirmed opening but releases a partial opening', async () => {
    for (const text of ['<think>', '<think>unfinished', ' \n<think>unfinished']) {
        const lab = fixture();
        await lab.tick(text);
        await lab.handler.finish(0);
        assert.equal(lab.chat[0].mes, '');
        assert.equal(await lab.tick(text, true), '');
        await lab.event('MESSAGE_RECEIVED');
        assertNoReasoning(lab);
    }
    const lab = fixture();
    await lab.tick('<thi');
    await lab.handler.finish(0);
    assert.equal(lab.chat[0].mes, '<thi');
    await lab.event('MESSAGE_RECEIVED');
    assert.equal(lab.chat[0].mes, '<thi');
});

test('explicit show thoughts retains parsed reasoning and the legacy fold header', async () => {
    const lab = fixture({ show: true });
    await lab.tick('<think>隐藏</think>正文', true);
    await lab.handler.finish(0);
    assert.equal(lab.chat[0].mes, '正文');
    assert.equal(lab.handler.reasoning, '隐藏');
    assert.equal(lab.chat[0].extra.reasoning, '隐藏');
    assert.equal(lab.chat[0].extra.reasoning_type, 'parsed');
    assert.equal(lab.nodes['.mes_reasoning'].textContent, '隐藏');
    assert.ok(lab.nodes['.mes_reasoning_header_title'].textContent);
    assert.equal(lab.messageDom.classes.has('reasoning'), true);
});

test('CUSTOM native streaming fields follow show thoughts independently of content tags', async () => {
    for (const show of [false, true]) {
        const lab = fixture({ show });
        const state = { reasoning: '' };
        assert.equal(lab.context.getStreamingReply({ choices: [{ delta: { reasoning_content: 'r' } }] }, state, { chatCompletionSource: 'custom' }), '');
        assert.equal(lab.context.getStreamingReply({ choices: [{ delta: { content: '正文' } }] }, state, { chatCompletionSource: 'custom' }), '正文');
        assert.equal(state.reasoning, show ? 'r' : '');
        lab.handler.updateReasoning(0, 'r', { persist: true });
        await lab.tick('正文', true);
        await lab.handler.finish(0);
        assert.equal(lab.chat[0].mes, '正文');
        if (!show) assertNoReasoning(lab);
        assert.equal(lab.context.extractReasoningFromData({ choices: [{ message: { reasoning: 'r' } }] }, { chatCompletionSource: 'custom' }), show ? 'r' : '');
    }
});

test('history projection hides raw tags and saved fields without mutating history', () => {
    for (const extra of [{}, { reasoning: 'saved', reasoning_duration: 20, reasoning_display_text: 'translated' }]) {
        const lab = fixture();
        Object.assign(lab.chat[0], { mes: '<think>record</think>response', extra });
        const before = JSON.stringify(lab.chat);
        assert.equal(lab.format(), 'response');
        lab.handler.initHandleMessage(0);
        assert.equal(lab.nodes['.mes_reasoning'].textContent, '');
        assert.equal(lab.nodes['.mes_reasoning_header_title'].textContent, '');
        assert.equal(lab.messageDom.classes.has('reasoning'), false);
        assert.equal(JSON.stringify(lab.chat), before);
        lab.context.oai_settings.show_thoughts = true;
        const restored = new lab.context.Handler();
        restored.initHandleMessage(0);
        assert.equal(lab.format(), 'response');
        assert.equal(lab.nodes['.mes_reasoning'].textContent, extra.reasoning_display_text ?? 'record');
        assert.ok(lab.nodes['.mes_reasoning_header_title'].textContent);
        assert.equal(lab.messageDom.classes.has('reasoning'), true);
        assert.equal(JSON.stringify(lab.chat), before);
        assert.equal(lab.saves, 0);
    }
});

test('explicit auto parse opt-out preserves tagged content in streaming, history and events', async () => {
    const lab = fixture({ autoParse: false });
    const text = '<think>literal</think>response';
    assert.equal(await lab.tick(text, true), text);
    assert.ok(lab.format().includes('literal'));
    await lab.event('MESSAGE_RECEIVED');
    assert.equal(lab.chat[0].mes, text);
    assertNoReasoning(lab);
});

test('final message events and swipes discard hidden reasoning, including unclosed blocks', async () => {
    for (const event of ['MESSAGE_RECEIVED', 'MESSAGE_UPDATED']) {
        for (const show of [false, true]) {
            const lab = fixture({ show });
            lab.chat[0].mes = ' \n<think>r</think>response';
            await lab.event(event);
            assert.equal(lab.chat[0].mes, 'response');
            assert.equal(lab.chat[0].extra.reasoning, show ? 'r' : undefined);
            const swipes = ['<think>r</think>response', '<think>unfinished', '<thi', 'prose<think>literal'];
            const info = swipes.map(() => ({ extra: {} }));
            lab.context.parseReasoningInSwipes(swipes, info, 10);
            assert.deepEqual(swipes, ['response', '', '<thi', 'prose<think>literal']);
            assert.equal(info[0].extra.reasoning, show ? 'r' : undefined);
            assert.equal(info[1].extra.reasoning, show ? 'unfinished' : undefined);
            lab.chat[0].mes = '<think>unfinished';
            lab.chat[0].extra = {};
            await lab.event(event);
            assert.equal(lab.chat[0].mes, '');
            assert.equal(lab.chat[0].extra.reasoning, show ? 'unfinished' : undefined);
        }
    }
});

test('native metadata does not bypass tagged-body parsing on completion', async () => {
    const lab = fixture({ show: true });
    lab.chat[0].extra.reasoning = 'native';
    lab.chat[0].mes = '<think>r</think>response';
    await lab.event('MESSAGE_RECEIVED');
    assert.equal(lab.chat[0].mes, 'response');
});

test('configured nonempty templates are literal; empty templates and manual parsing retain their semantics', async () => {
    const lab = fixture();
    Object.assign(lab.context.power_user.reasoning, { prefix: '[r+]', suffix: '[/r+]' });
    assert.equal(await lab.tick('[r'), '');
    assert.equal(await lab.tick('[r+]r[/r+]response', true), 'response');
    for (const key of ['prefix', 'suffix']) {
        const old = lab.context.power_user.reasoning[key];
        lab.context.power_user.reasoning[key] = '';
        assert.equal(await lab.tick('[r+]literal', true), '[r+]literal');
        lab.context.power_user.reasoning[key] = old;
    }
    assert.equal(lab.context.parseReasoningFromString('before[r+]r[/r+]after', { strict: false }).reasoning, 'r');
    assert.equal(lab.context.parseReasoningFromString('[r+]unfinished').content, '[r+]unfinished');
});

test('Text Completion and user/reasoning formatting keep their existing behavior', async () => {
    const lab = fixture({ mainApi: 'textgenerationwebui' });
    await lab.tick('<think>r</think>response', true);
    await lab.handler.finish(0);
    assert.equal(lab.chat[0].extra.reasoning, 'r');
    assert.ok(lab.format('<think>literal</think>', true).includes('literal'));
    assert.ok(lab.format('<think>literal</think>', false, true).includes('literal'));
});

test('real StreamingProcessor forwards finality so a partial opening releases at the final paint', async () => {
    const lab = fixture();
    const processor = new lab.context.Processor('normal', false, new Date(), '', {});
    processor.messageId = 0;
    for (const text of ['<', '<thi', '<think>', '<think>r', '<think>r</think>response']) {
        await processor.onProgressStreaming(0, text);
        assert.equal(lab.chat[0].mes, text.endsWith('response') ? 'response' : '');
        assert.equal(lab.nodes['.mes_text'].textContent, text.endsWith('response') ? 'response' : '');
    }
    for (const [text, expected] of [['<thi', '<thi'], ['<think>unfinished', '']]) {
        const next = fixture();
        const generation = new next.context.Processor('normal', false, new Date(), '', {});
        generation.messageId = 0;
        await generation.onProgressStreaming(0, text);
        assert.equal(next.nodes['.mes_text'].textContent, '');
        await generation.onProgressStreaming(0, text, true);
        assert.equal(next.chat[0].mes, expected);
        assert.equal(next.nodes['.mes_text'].textContent, expected);
    }
});

test('new defaults and shallow settings migration preserve explicit preferences', () => {
    const defaultShow = declaration(openai, 'const default_settings =').match(/^    show_thoughts: (.+),$/m)?.[1];
    const defaultParse = powerUser.match(/^        auto_parse: (.+),$/m)?.[1];
    assert.equal(vm.runInNewContext(defaultShow), false);
    assert.equal(vm.runInNewContext(defaultParse), true);
    const load = declaration(powerUser, 'export async function loadPowerUserSettings(');
    const loadPrefix = load.slice(load.indexOf('    const defaultStscript'), load.indexOf('    if (power_user.stscript === undefined)'));
    for (const preference of [undefined, false, true]) {
        const saved = { prefix: '<think>', suffix: '</think>' };
        if (preference !== undefined) saved.auto_parse = preference;
        const context = vm.createContext({
            power_user: { stscript: {}, reasoning: { auto_parse: true } },
            settings: { power_user: { reasoning: saved } }, chat_styles: { DOCUMENT: 'document' },
        });
        vm.runInContext(loadPrefix, context);
        assert.equal(context.power_user.reasoning.auto_parse, preference ?? true);
    }
    const loadOai = declaration(openai, 'function loadOpenAISettings(');
    const loopStart = loadOai.indexOf('    for (const key of Object.keys(default_settings))');
    const loopEnd = loadOai.indexOf('\n    }', loopStart) + 6;
    for (const preference of [undefined, false, true]) {
        const context = vm.createContext({
            settings: preference === undefined ? {} : { show_thoughts: preference },
            default_settings: { show_thoughts: vm.runInNewContext(defaultShow) }, oai_settings: {}, settingsToUpdate: {},
        });
        vm.runInContext(loadOai.slice(loopStart, loopEnd), context);
        assert.equal(context.oai_settings.show_thoughts, preference ?? false);
    }
    const presetStart = openai.indexOf('        for (const [key, [selector, setting, isCheckbox, isConnection]] of Object.entries(settingsToUpdate))');
    assert.ok(presetStart >= 0);
    const presetEnd = openai.indexOf('\n        }', presetStart) + 10;
    for (const current of [false, true]) {
        for (const preference of [undefined, false, true]) {
            const context = vm.createContext({
                preset: preference === undefined ? {} : { show_thoughts: preference },
                oai_settings: { show_thoughts: current }, updateCheckbox() {}, updateInput() {},
            });
            vm.runInContext(declaration(openai, 'export const settingsToUpdate ='), context);
            vm.runInContext(openai.slice(presetStart, presetEnd), context);
            assert.equal(context.oai_settings.show_thoughts, preference ?? current);
        }
    }
});


test('stopping inside an incomplete tag releases the literal fragment in storage and DOM', async () => {
    const lab = fixture();
    assert.equal(await lab.tick('<thi'), '');
    await lab.handler.finish(0);
    assert.equal(lab.chat[0].mes, '<thi');
    assert.equal(lab.nodes['.mes_text'].textContent, '<thi');

    const processor = new lab.context.Processor('normal', false, new Date(), '', {});
    processor.messageId = 0;
    await processor.onProgressStreaming(0, '<thicker than a tag', true);
    assert.equal(lab.chat[0].mes, '<thicker than a tag');
    assert.equal(lab.nodes['.mes_text'].textContent, '<thicker than a tag');
});

test('unlabeled character interiority stays in the bubble; only a leading confirmed tag is filtered', async () => {
    const lab = fixture();
    const raw = '她想：他大概误会了。\n<think>prefaced innermost thoughts</think>“算了，我还是问清楚吧。”';
    const stream = '她的心跳漏了一拍，面上却仍维持着平静。';
    assert.equal(await lab.tick(stream, true), stream);
    await lab.handler.finish(0);
    await lab.event('MESSAGE_RECEIVED');
    assert.equal(lab.chat[0].mes, stream);
    assertNoReasoning(lab);
    const formatted = lab.format(raw);
    assert.ok(formatted.includes('她想：他大概误会了。'));
    assert.ok(formatted.includes('&lt;think&gt;prefaced innermost thoughts&lt;/think&gt;'));
    assert.ok(formatted.includes('“算了，我还是问清楚吧。”'));
});

test('continuing an incomplete tagged prefix applies the same visibility preference', async () => {
    for (const show of [false, true]) {
        const lab = fixture({ show });
        const prompt = { prefixIncomplete: true, prefixReasoning: 'r', prefixReasoningFormatted: '<think>r' };
        lab.handler.initContinue(prompt);
        assert.equal(await lab.tick('s', false, prompt), '');
        assert.equal(await lab.tick('s</think>response', true, prompt), 'response');
        await lab.handler.finish(0);
        assert.equal(lab.chat[0].extra.reasoning, show ? 'rs' : undefined);
        if (!show) assertNoReasoning(lab);
    }
});
