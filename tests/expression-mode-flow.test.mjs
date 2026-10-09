import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const file = 'public/scripts/extensions/expressions/index.js';
const baseline = execFileSync('git', ['show', `0b2bdbc9d17433b191f921b5a946772c7676dc2f:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
const source = process.env.EXPRESSION_MODE_SOURCE === 'baseline' ? baseline : readFileSync(process.env.EXPRESSION_MODE_SOURCE || new URL(`../${file}`, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

// Evaluate the entire actual module, including its private state and worker.
// Only ESM imports/exports are removed. Browser initialization is not invoked.
// Context/jQuery stand-ins expose display and write contracts, not real layout.
// Sprite validation/rendering use synthetic data; classification uses the real
// "none" API path. Native geometry and full application checks are separate.
function harness(code = source, { vn = false, mobile = false, geometry = true, ancestorHidden = false, emptyCache = false } = {}) {
    const context = { characterId: vn ? undefined : 0, groupId: vn ? 'synthetic-group' : null, name2: 'Synthetic', characters: [], chat: [{ name: 'Synthetic', mes: 'Synthetic message.', original_avatar: 'Synthetic.png' }] };
    const nodes = new Map();
    const seen = { reads: [], writes: [], renders: [], validations: [], errors: [], overrides: [], updates: [] };
    const node = selector => {
        if (!nodes.has(selector)) nodes.set(selector, { display: selector === '#visual-novel-wrapper' || selector === '.expression_settings .offline_mode' ? 'none' : 'block', children: ['synthetic-sprite'], styles: {}, src: 'synthetic.png' });
        return nodes.get(selector);
    };
    const $ = selector => {
        const state = node(selector);
        const write = (operation, value) => { seen.writes.push({ selector, operation, value }); return api; };
        const api = {
            show() { state.display = 'block'; return write('show'); },
            hide() { state.display = 'none'; return write('hide'); },
            empty() { state.children = []; return write('empty'); },
            css(key, value) {
                if (typeof key === 'object') Object.assign(state.styles, key);
                else if (key === 'display') state.display = value;
                else state.styles[key] = value;
                return write('css', typeof key === 'object' ? plain(key) : { [key]: value });
            },
            is(predicate) {
                assert.equal(predicate, ':visible');
                seen.reads.push(selector);
                return state.display !== 'none' && (selector !== '#visual-novel-wrapper' || (h.geometry && !h.ancestorHidden));
            },
            off() { return api; },
            prop(key, value) { state[key] = value; return api; },
            removeClass() { return api; },
        };
        return api;
    };
    const h = { context, seen, node, geometry, ancestorHidden, mobile, validationGate: null };
    const c = vm.createContext({
        $, getContext: () => context, isMobile: () => h.mobile, power_user: { waifuMode: vn },
        modules: ['classify'], extension_settings: { expressions: { api: 99, showDefault: true, fallback_expression: 'joy' }, expressionOverrides: [] },
        debounce: fn => fn, debounce_timeout: { quick: 1 }, getCharaFilename: () => 'Synthetic.png',
        system_message_types: { NARRATOR: 'narrator' }, substituteParams: value => value,
        trimToEndSentence: value => value, trimToStartSentence: value => value,
        console: { log: (...args) => seen.errors.push(args), error: (...args) => seen.errors.push(args), debug() {} },
        validate: async (folder, force = false) => {
            seen.validations.push({ folder, force });
            await h.validationGate?.promise;
            c.validatedFolder = folder;
            vm.runInContext('spriteCache[validatedFolder] = [{ label: "joy", files: [] }];', c);
        },
        renderVN: async (folder, expression) => { seen.renders.push({ mode: true, folder, expression }); },
        renderSingle: (folder, expression, options) => { seen.renders.push({ mode: false, folder, expression, options: plain(options) }); },
        list: async () => ['joy'], override: force => seen.overrides.push(force),
    });
    const evaluable = code.replace(/^import .*;\r?\n/gm, '').replace(/^export \{.*\};\r?\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(evaluable, c, { filename: file });
    vm.runInContext('validateImages = validate; updateVisualNovelMode = renderVN; setExpression = renderSingle; getExpressionsList = list; setExpressionOverrideHtml = override;', c);
    if (!emptyCache) vm.runInContext('spriteCache = { Synthetic: [{ label: "joy", files: [] }] }; expressionsList = ["joy"];', c);
    h.c = c;
    h.run = options => c.moduleWorker(options);
    h.state = () => plain(vm.runInContext('({ lastMessage, lastCharacter, lastExpression, inApiCall })', c));
    h.resets = () => seen.writes.filter(row => row.selector === '#expression-holder' && row.operation === 'css').length;
    h.clears = () => seen.writes.filter(row => row.selector === '#visual-novel-wrapper' && row.operation === 'empty').length;
    h.vnReads = () => seen.reads.filter(selector => selector === '#visual-novel-wrapper').length;
    h.drag = () => Object.assign(node('#expression-holder').styles, { top: '27px', left: '43px', width: '100px' });
    h.snapshot = () => plain({ state: h.state(), nodes: [...nodes].sort(([a], [b]) => a.localeCompare(b)), renders: seen.renders, validations: seen.validations, writes: seen.writes });
    h.chatChanged = async () => {
        const start = code.indexOf('    eventSource.on(event_types.CHAT_CHANGED, () => {');
        const end = code.indexOf('\n    });', start);
        assert.ok(start >= 0 && end > start, 'actual CHAT_CHANGED registration exists');
        c.event_types = { CHAT_CHANGED: 'chat' };
        c.eventSource = { on: (_type, callback) => { h.handler = callback; } };
        c.document = { getElementById: () => null };
        c.updateFunction = options => { seen.updates.push(plain(options)); h.pending = h.run(options); };
        vm.runInContext(code.slice(start, end + '\n    });'.length), c);
        h.handler();
        await h.pending;
    };
    return h;
}

for (const vn of [false, true]) {
    test(`stable ${vn ? 'VN' : 'normal'} mode performs no VN visibility geometry read`, async () => {
        const h = harness(source, { vn });
        await h.run(); await h.run();
        assert.equal(h.vnReads(), 0, 'mode inference must not read layout through :visible');
        assert.equal(h.seen.reads.filter(x => x === '.expression_settings .offline_mode').length, 2, 'offline predicate remains');
        assert.equal(h.seen.writes.filter(x => x.selector === '#visual-novel-wrapper' && x.operation === (vn ? 'show' : 'hide')).length, 2, 'wrapper display is enforced every worker');
        assert.deepEqual(h.seen.errors, []);
    });
}

for (const [name, options] of [['zero geometry', { geometry: false }], ['CSS-hidden ancestor', { ancestorHidden: true }]]) {
    test(`stable VN retains sprites and drag geometry with ${name}`, async () => {
        const h = harness(source, { vn: true, ...options });
        await h.run(); h.node('#visual-novel-wrapper').children = ['retained-sprite']; h.drag();
        await h.run(); await h.run();
        assert.equal(h.resets(), 1, 'only entry into VN resets drag style');
        assert.equal(h.clears(), 1, 'stable hidden VN must not clear sprites');
        assert.deepEqual(h.node('#visual-novel-wrapper').children, ['retained-sprite']);
        assert.equal(h.node('#expression-holder').styles.top, '27px');
        assert.equal(h.seen.renders.length, 1, 'unchanged message is not reclassified/rendered');
    });
    test(`leaving VN resets once despite ${name}`, async () => {
        const h = harness(source, { vn: true, ...options });
        await h.run(); h.drag(); h.c.power_user.waifuMode = false;
        await h.run(); await h.run();
        assert.equal(h.resets(), 2, 'leaving applied VN is a real transition');
        assert.equal(h.node('#expression-holder').styles.top, '');
        assert.equal(h.seen.renders.length, 2);
        assert.equal(h.seen.renders.at(-1).mode, false);
    });
}

test('initial normal mode preserves dragged holder while enforcing wrapper display every time', async () => {
    const h = harness(); h.drag();
    await h.run(); await h.run();
    assert.equal(h.resets(), 0); assert.equal(h.clears(), 0);
    assert.equal(h.node('#expression-holder').styles.left, '43px');
    assert.equal(h.node('#visual-novel-wrapper').display, 'none');
    assert.equal(h.seen.writes.filter(x => x.selector === '#visual-novel-wrapper' && x.operation === 'hide').length, 2);
});

test('external VN display changes do not invent a normal-mode transition', async () => {
    const h = harness(); await h.run(); h.drag();
    h.node('#visual-novel-wrapper').display = 'block';
    await h.run();
    assert.equal(h.resets(), 0); assert.equal(h.node('#expression-holder').styles.top, '27px');
    assert.equal(h.node('#visual-novel-wrapper').display, 'none');
});

test('desktop/mobile and group/single mode changes reset exactly once each', async () => {
    const h = harness(source, { vn: true });
    const changes = [() => {}, () => { h.mobile = true; }, () => { h.mobile = false; }, () => { h.context.groupId = null; h.context.characterId = 0; }, () => { h.context.groupId = 'synthetic-group'; h.context.characterId = undefined; }, () => { h.c.power_user.waifuMode = false; }];
    for (const [index, change] of changes.entries()) {
        change(); await h.run(); await h.run();
        assert.equal(h.resets(), index + 1);
        assert.equal(h.clears(), index + 1);
        assert.equal(h.seen.renders.length, index + 1);
    }
    assert.deepEqual(h.seen.errors, []);
});

test('home returns before applying mode and same-mode reopen keeps drag positions', async () => {
    const h = harness(source, { vn: true }); await h.run(); h.drag();
    h.context.groupId = null; h.context.characterId = undefined;
    await h.run();
    assert.equal(h.node('#visual-novel-wrapper').display, 'block');
    assert.equal(h.state().lastMessage, null);
    h.context.groupId = 'synthetic-group'; h.ancestorHidden = true;
    await h.run({ newChat: true });
    assert.equal(h.resets(), 1); assert.equal(h.node('#expression-holder').styles.top, '27px');
    assert.equal(h.seen.renders.length, 3, 'new chat refresh plus explicitly invalidated message refresh remain');
});

test('home followed by different mode resets once on reopen', async () => {
    const h = harness(source, { vn: true }); await h.run();
    h.context.groupId = null; h.context.characterId = undefined; await h.run();
    h.context.characterId = 0; await h.run(); await h.run();
    assert.equal(h.resets(), 2); assert.equal(h.seen.renders.length, 2);
});

test('explicit lastMessage invalidation refreshes stable VN without resetting geometry', async () => {
    const h = harness(source, { vn: true }); await h.run(); h.drag();
    h.c.removeExpression(); await h.run();
    assert.equal(h.resets(), 1); assert.equal(h.clears(), 1);
    assert.equal(h.seen.renders.length, 2); assert.equal(h.state().lastMessage, 'Synthetic message.');
    assert.equal(h.node('#expression-holder').styles.top, '27px');
});

test('newChat refresh remains independent from stable-mode invalidation', async () => {
    const h = harness(source, { vn: true }); await h.run(); h.drag();
    await h.run({ newChat: true });
    assert.equal(h.resets(), 1); assert.equal(h.seen.renders.length, 2);
    assert.equal(h.seen.renders.at(-1).folder, undefined);
    assert.equal(h.node('#expression-holder').styles.left, '43px');
});

test('actual CHAT_CHANGED handler still clears sprites and invalidates the message independently', async () => {
    const h = harness(source, { vn: true }); await h.run(); h.drag();
    await h.chatChanged();
    assert.equal(h.resets(), 1); assert.equal(h.clears(), 2);
    assert.deepEqual(h.seen.updates, [{ newChat: true }]);
    assert.deepEqual(h.seen.overrides, [true]);
    assert.equal(h.seen.validations.length, 1);
    assert.equal(h.seen.renders.length, 3);
    assert.equal(h.node('#expression-holder').styles.left, '43px');
});

test('applied state advances before first async sprite validation', async () => {
    const h = harness(source, { vn: true, emptyCache: true, geometry: false });
    h.validationGate = deferred();
    const first = h.run(); const second = h.run();
    const resetsBeforeValidation = h.resets();
    h.validationGate.resolve(); await Promise.all([first, second]);
    assert.equal(resetsBeforeValidation, 1, 'same-mode overlapping worker must see already-applied mode');
    assert.equal(h.clears(), 1); assert.deepEqual(h.seen.errors, []);
});

test('offline connectivity visibility predicate and reconnect refresh remain intact', async () => {
    const h = harness(source, { vn: true });
    h.c.modules.length = 0; h.c.extension_settings.expressions.api = 1;
    await h.run();
    assert.equal(h.node('.expression_settings .offline_mode').display, 'block');
    assert.equal(h.state().lastMessage, null);
    h.c.modules.push('classify'); h.c.extension_settings.expressions.api = 99;
    await h.run();
    assert.equal(h.seen.reads.filter(x => x === '.expression_settings .offline_mode').length, 1);
    assert.equal(h.node('.expression_settings .offline_mode').display, 'none');
    assert.equal(h.seen.validations.length, 2);
    assert.equal(h.seen.renders.length, 3); assert.equal(h.resets(), 1);
});

test('no sprites/defaults still skips expression rendering', async () => {
    const h = harness();
    vm.runInContext('spriteCache = { Synthetic: [] };', h.c);
    h.c.extension_settings.expressions.showDefault = false;
    await h.run(); await h.run();
    assert.equal(h.seen.renders.length, 0); assert.equal(h.state().lastMessage, null);
});

for (const vn of [false, true]) {
    test(`normal geometry terminal behavior independently matches immutable base (${vn ? 'VN' : 'normal'})`, async () => {
        const current = harness(source, { vn }); const original = harness(baseline, { vn });
        for (const h of [current, original]) {
            await h.run(); h.drag(); await h.run();
            h.context.chat.push({ name: 'Synthetic', mes: 'Next synthetic message.', original_avatar: 'Synthetic.png' });
            await h.run({ newChat: true });
            h.context.groupId = null; h.context.characterId = 0; await h.run();
            assert.deepEqual(h.seen.errors, []);
        }
        assert.deepEqual(current.snapshot(), original.snapshot());
    });
}
