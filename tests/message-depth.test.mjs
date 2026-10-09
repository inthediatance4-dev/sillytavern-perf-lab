import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
const regexEngine = readFileSync(new URL('../public/scripts/extensions/regex/engine.js', import.meta.url), 'utf8');

function functionSource(source, name) {
    const start = source.search(new RegExp(`^(?:export )?function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, `${name} must exist in the application source`);
    const end = source.indexOf('\n}', start);
    assert.notEqual(end, -1, `${name} must have a top-level closing brace`);
    return source.slice(start, end + 2).replace(/^export /, '');
}

// The reference is the former map/filter/findIndex expression, not the new algorithm.
function legacyDepth(messages, messageId) {
    const usableMessages = messages.map((message, index) => ({ message, index })).filter(x => !x.message.is_system);
    const indexOf = usableMessages.findIndex(x => x.index === Number(messageId));
    return messageId >= 0 && indexOf !== -1 ? usableMessages.length - indexOf - 1 : undefined;
}

const placements = { USER_INPUT: 1, AI_OUTPUT: 2, SLASH_COMMAND: 3, REASONING: 6 };
const messagesOf = count => Array.from({ length: count }, (_, i) => ({ mes: `message ${i}`, is_system: false }));

function harness(messages, scripts = []) {
    const calls = [];
    const stages = [];
    const context = vm.createContext({
        chat: messages,
        mesForShowdownParse: '',
        COMMENT_NAME_DEFAULT: 'Comment', systemUserName: 'System',
        regex_placement: placements,
        console: { warn() {}, debug() {} },
        extension_settings: { disabledExtensions: [] },
        getRegexScripts: () => scripts,
        // Upstream 1.19 runs extension hooks through MessageFormatter inside
        // messageFormatting; identity stages preserve the depth/output contract
        // under test. Real hook behavior is covered by upstream's own suites.
        MessageFormatter: {
            stage: { BEFORE_REGEX: 'beforeRegex', AFTER_REGEX: 'afterRegex', AFTER_MARKDOWN: 'afterMarkdown' },
            runStage: (stage, value) => value,
        },
        // Script selection and min/max filtering execute the actual regex engine.
        // Regex execution is a synthetic boundary; Markdown/DOMPurify/style helpers
        // are identity boundaries here. Real browser HTML checks run separately.
        runRegexScript: (rule, value, options) => {
            stages.push({ stage: 'regex', rule: rule.scriptName, options: { ...options } });
            return value.replace(new RegExp(rule.findRegex, 'g'), rule.replaceString);
        },
        substituteParams: value => value,
        power_user: {
            user_prompt_bias: '', show_user_prompt_bias: false,
            auto_fix_generated_markdown: false, encode_tags: false,
            allow_name2_display: true, reasoning: { prefix: '', suffix: '' },
        },
        fixMarkdown: value => value,
        canUseNegativeLookbehind: () => true,
        escapeHtml: value => value,
        escapeRegex: value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        converter: { makeHtml: value => { stages.push({ stage: 'markdown', value }); return value; } },
        encodeStyleTags: value => { stages.push({ stage: 'encode', value }); return value; },
        DOMPurify: { sanitize: (value, config) => { stages.push({ stage: 'sanitize', value, config: { ...config } }); return value; } },
        decodeStyleTags: (value, options) => { stages.push({ stage: 'decode', value, options: { ...options } }); return value; },
    });
    vm.runInContext(functionSource(regexEngine, 'getRegexedString'), context);
    const actualRegex = context.getRegexedString;
    context.getRegexedString = (value, placement, options) => {
        calls.push({ value, placement, options: { ...options } });
        return actualRegex(value, placement, options);
    };
    const helper = /^(?:export )?function getMessageDepth\(/m.test(script) ? functionSource(script, 'getMessageDepth') : '';
    vm.runInContext(`${helper}\n${functionSource(script, 'messageFormatting')}`, context);
    return {
        context, calls, stages,
        format: (id, { text = 'synthetic text', name = 'Synthetic character', system = false, user = false, reasoning = false, sanitizer = {} } = {}) =>
            context.messageFormatting(text, name, system, user, id, sanitizer, reasoning),
    };
}

test('actual formatting preserves numeric/string/coercible IDs and undefined depths', () => {
    const messages = messagesOf(6);
    messages[1].is_system = true;
    const h = harness(messages);
    const ids = [0, -0, 1, 2, 5, 6, 999, -1, -0.5, 0.5, NaN, Infinity, -Infinity,
        '0', '2', '02', ' 2 ', '2e0', '0x2', '5', '6', '-1', 'temporary', 'NaN',
        null, false, true, '', ' ', undefined];
    for (const id of ids) {
        h.format(id);
        assert.equal(h.calls.at(-1).options.depth, legacyDepth(messages, id), `messageId ${String(id)}`);
    }
    const empty = harness([]);
    empty.format(0);
    assert.equal(empty.calls[0].options.depth, undefined);
});

test('actual formatting skips sparse holes and truthy system flags like map/filter', () => {
    const messages = new Array(9);
    messages[0] = { is_system: false };
    messages[2] = { is_system: true };
    messages[3] = { is_system: false };
    messages[5] = { is_system: 'hidden' };
    messages[6] = { mes: 'system flag absent' };
    messages[8] = { is_system: false };
    const h = harness(messages);
    for (let id = 0; id <= messages.length; id++) {
        h.format(id);
        assert.equal(h.calls.at(-1).options.depth, legacyDepth(messages, id), `sparse index ${id}`);
    }
});

test('seeded mixed histories agree with the former expression for every index', () => {
    let seed = 0x12345678;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
    };
    const h = harness([]);
    for (let fixture = 0; fixture < 40; fixture++) {
        const messages = new Array(Math.floor(random() * 100));
        for (let i = 0; i < messages.length; i++) {
            if (random() < 0.15) continue;
            messages[i] = { is_system: random() < 0.35, mes: `fixture ${fixture}, message ${i}` };
        }
        h.context.chat = messages;
        for (let id = -1; id <= messages.length; id++) {
            h.format(String(id));
            assert.equal(h.calls.at(-1).options.depth, legacyDepth(messages, String(id)), `fixture ${fixture}, index ${id}`);
        }
    }
});

test('edits, insertion, deletion, system toggles and replacement use current history', () => {
    const messages = messagesOf(5);
    const h = harness(messages);
    const check = () => {
        for (let id = 0; id <= h.context.chat.length; id++) {
            h.format(id);
            assert.equal(h.calls.at(-1).options.depth, legacyDepth(h.context.chat, id));
        }
    };
    check();
    messages[2].mes = 'edited content';
    check();
    messages[4].is_system = true;
    check();
    messages.splice(1, 0, { is_system: false, mes: 'inserted message' });
    check();
    messages.splice(3, 1);
    check();
    delete messages[2]; // An in-memory sparse slot, not a filesystem deletion.
    check();
    messages[4].is_system = false;
    check();
    h.context.chat = messagesOf(2);
    check();
});

test('actual regex min/max filters preserve transformed output for valid and undefined depths', () => {
    const rules = [
        ['zero', 0, 0], ['one', 1, 1], ['two-plus', 2, null],
        ['up-to-two', -1, 2], ['unbounded', null, null], ['disabled-bound', -2, -1],
    ].map(([name, minDepth, maxDepth]) => ({
        scriptName: name, minDepth, maxDepth, markdownOnly: true,
        placement: Object.values(placements), findRegex: `token_${name}`, replaceString: `[${name}]`,
    }));
    const messages = messagesOf(7);
    messages[2].is_system = true;
    messages[5].is_system = true;
    const h = harness(messages, rules);
    const text = rules.map(rule => `token_${rule.scriptName}`).join(' ');
    for (const id of [0, '1', 2, 3, 4, 5, 6, -1, 8, 'transient', null, false, '']) {
        const expected = h.context.getRegexedString(text, placements.AI_OUTPUT, {
            characterOverride: 'Synthetic character', isMarkdown: true, depth: legacyDepth(messages, id),
        });
        assert.equal(h.format(id, { text }), expected, `regex output for ID ${String(id)}`);
    }
});

test('placement, bias stripping, transient reasoning, narrator, hidden and comments remain intact', () => {
    const messages = messagesOf(5);
    messages[2].extra = { type: 'narrator' };
    messages[3].is_system = true;
    messages[4].is_system = true;
    const h = harness(messages);
    h.context.power_user.user_prompt_bias = 'BIAS ';
    const cases = [
        [1, {}, placements.AI_OUTPUT, 'body'],
        [1, { user: true }, placements.USER_INPUT, 'BIAS body'],
        [2, {}, placements.SLASH_COMMAND, 'body'],
        [-1, { reasoning: true }, placements.REASONING, 'body'],
        [1, { user: true, reasoning: true }, placements.REASONING, 'BIAS body'],
        [3, { system: true, name: 'Hidden' }, placements.AI_OUTPUT, 'body'],
        [4, { system: true, name: 'Comment' }, placements.AI_OUTPUT, 'body'],
    ];
    for (const [id, options, placement, expectedText] of cases) {
        assert.equal(h.format(id, { text: 'BIAS body', ...options }), expectedText);
        const call = h.calls.at(-1);
        assert.equal(call.value, expectedText);
        assert.equal(call.placement, placement);
        assert.equal(call.options.depth, legacyDepth(messages, id));
        assert.equal(call.options.characterOverride, options.name ?? 'Synthetic character');
        assert.equal(call.options.isMarkdown, true);
    }
    const previousCalls = h.calls.length;
    assert.equal(h.format(3, { text: 'BIAS body', system: true, name: 'System' }), 'BIAS body');
    assert.equal(h.calls.length, previousCalls);
    assert.equal(h.format(1, { text: '' }), '');
    assert.equal(h.calls.length, previousCalls);
});

test('formatting still forwards sanitizer overrides and preserves boundary order and chat data', () => {
    const messages = messagesOf(3);
    const before = structuredClone(messages);
    const h = harness(messages, [{
        scriptName: 'synthetic', markdownOnly: true, minDepth: 0, maxDepth: 2,
        placement: [placements.AI_OUTPUT], findRegex: 'input', replaceString: 'output',
    }]);
    assert.equal(h.format(1, { text: 'input', sanitizer: { ADD_TAGS: ['synthetic-tag'] } }), 'output');
    assert.deepEqual(h.stages.map(item => item.stage), ['regex', 'markdown', 'encode', 'sanitize', 'decode']);
    const config = h.stages.find(item => item.stage === 'sanitize').config;
    assert.deepEqual(config.ADD_TAGS, ['synthetic-tag']);
    assert.equal(config.MESSAGE_SANITIZE, true);
    assert.equal(config.RETURN_DOM, false);
    assert.equal(h.stages.at(-1).options.prefix, '.mes_text ');
    assert.deepEqual(messages, before);
});

test('formatting the last 100 of 3000 messages reads at most 5050 system flags', t => {
    let reads = 0;
    const messages = Array.from({ length: 3000 }, () => ({
        get is_system() { reads++; return false; },
    }));
    for (let id = 2900; id < 3000; id++) assert.equal(legacyDepth(messages, id), 2999 - id);
    const referenceReads = reads;
    assert.equal(referenceReads, 300000);
    reads = 0;
    const h = harness(messages);
    for (let id = 2900; id < 3000; id++) {
        h.format(id);
        assert.equal(h.calls.at(-1).options.depth, 2999 - id);
    }
    t.diagnostic(`is_system reads: legacy=${referenceReads}, actual=${reads}, budget=5050`);
    assert.ok(reads <= 5050, `actual formatting read ${reads} system flags; expected <= 5050 (legacy ${referenceReads})`);
});
