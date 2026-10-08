import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
function fn(name) {
    const start = source.search(new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, 'm'));
    assert.notEqual(start, -1);
    return source.slice(start, source.indexOf('\n}', start) + 2).replace(/^export /, '');
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(messages = [{ mes: 'hello' }, { mes: 'world' }]) {
    const seen = { renders: 0, menus: 0, events: [], focus: 0, saves: 0, yields: 0, logs: 0 };
    const timers = [];
    const c = vm.createContext({
        characters: [{ name: 'Synthetic', avatar: 'synthetic.png', chat: 'history' }], this_chid: 0,
        selected_group: null, chat_metadata: {}, chat: [], name2: '', power_user: { chat_truncation: 100 },
        console: { log() { seen.logs++; }, debug() {} }, unshallowCharacter: async () => {},
        fetch: async () => ({ ok: true, json: async () => [{ chat_metadata: { integrity: 'synthetic' } }, ...messages] }),
        getRequestHeaders: () => ({}), ensureMessageMediaIsArray() {}, uuidv4: () => 'synthetic',
        getFirstMessage: () => ({ mes: 'greeting' }), saveChatConditional: async () => { seen.saves++; },
        loadItemizedPrompts: async () => {}, printMessages: async () => { seen.renders++; },
        select_selected_character() { seen.menus++; }, getCurrentChatId: () => c.characters[c.this_chid]?.chat,
        event_types: Object.fromEntries(['CHAT_CHANGED', 'CHAT_CREATED', 'MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED', 'CHAT_LOADED'].map(x => [x, x])),
        eventSource: { emit: async type => { seen.events.push(type); } },
        delay: ms => { if (ms === 0) { seen.yields++; return Promise.resolve(); } const gate = deferred(); timers.push(gate); return gate.promise; },
        debounce_timeout: { short: 10, extended: 100 }, document: { activeElement: {} },
        $: () => ({ is: () => false, trigger() { seen.focus++; return this; }, length: 0, val() {} }),
        mediaLoadScrollHandler: { cancel() {} }, cancelDebouncedChatSave() {}, cancelDebouncedMetadataSave() {}, closeMessageEditor() {},
        extension_prompts: {}, is_delete_mode: false, chatElement: { children: () => ({ remove() {} }) },
        saveItemizedPrompts: async () => {}, itemizedPrompts: [],
        waitUntilCondition: async () => {}, CustomEvent: class {}, createOrEditCharacter: async () => { seen.saves++; },
    });
    const helpers = ['beginCharacterChatLoad', 'isCharacterChatLoadCurrent', 'shouldYieldCharacterChatLoad'].filter(name => source.includes(`function ${name}(`)).map(fn);
    vm.runInContext(['let characterChatLoadSerial = 0;', ...helpers, ...['getChat', 'getChatResult', 'clearChat', 'openCharacterChat', 'doNewChat', 'selectCharacterById', 'reloadCurrentChatUnsafe', 'replaceCurrentChat'].map(fn)].join('\n'), c);
    return { c, seen, timers };
}
test('success preserves void return and terminal event order without scheduling small loads', async () => {
    const h = harness(); assert.equal(await h.c.getChat(), undefined);
    assert.deepEqual(h.seen.events, ['CHAT_CHANGED', 'CHAT_LOADED']); assert.equal(h.seen.yields, 0);
});
test('large visible text receives exactly one post-render task boundary', async () => {
    const h = harness([{ mes: 'x'.repeat(250000) }]);
    h.c.delay = ms => { if (ms === 0) { assert.equal(h.seen.renders, 1); assert.equal(h.seen.menus, 0); h.seen.yields++; } return Promise.resolve(); };
    await h.c.getChat(); assert.equal(h.seen.yields, 1);
});
test('truncated history counts only visible text', async () => {
    const h = harness([{ mes: 'x'.repeat(90000) }, { mes: 'small' }, { mes: 'small' }]); h.c.power_user.chat_truncation = 2;
    await h.c.getChat(); assert.equal(h.seen.yields, 0);
});
for (const boundary of ['unshallowCharacter', 'fetch', 'loadItemizedPrompts', 'printMessages']) {
    test(`clear immediately invalidates the load suspended at ${boundary}`, async () => {
        const h = harness(); const gate = deferred(); const original = h.c[boundary];
        h.c[boundary] = async (...args) => { await gate.promise; return original(...args); };
        const loading = h.c.getChat(); await tick(); await h.c.clearChat({ clearData: true }); gate.resolve();
        assert.equal(await loading, false); assert.equal(h.seen.menus, 0); assert.deepEqual(h.seen.events, []);
        if (boundary === 'fetch' || boundary === 'unshallowCharacter') assert.equal(h.c.chat.length, 0);
    });
}
test('same-file reload supersedes late response without overwriting newer model', async () => {
    const h = harness(); const gate = deferred(); let calls = 0;
    h.c.fetch = async () => { const call = ++calls; if (call === 1) await gate.promise; return { ok: true, json: async () => [{ chat_metadata: { integrity: 'synthetic' } }, { mes: call === 1 ? 'older' : 'newer' }, { mes: 'tail' }] }; };
    const old = h.c.getChat(); await tick(); await h.c.getChat(); gate.resolve();
    assert.equal(await old, false); assert.equal(h.c.chat[0].mes, 'newer'); assert.equal(h.seen.renders, 1); assert.deepEqual(h.seen.events, ['CHAT_CHANGED', 'CHAT_LOADED']);
});
test('clear during task boundary suppresses menu terminal events and delayed focus', async () => {
    const h = harness([{ mes: 'x'.repeat(250000) }]); const gate = deferred(); h.c.delay = ms => ms === 0 ? gate.promise : Promise.resolve();
    const loading = h.c.getChat(); await tick(); await h.c.clearChat({ clearData: true }); gate.resolve();
    assert.equal(await loading, false); assert.equal(h.seen.menus, 0); assert.deepEqual(h.seen.events, []); assert.equal(h.seen.focus, 0);
});
test('stale render rejection does not enter catch fallback', async () => {
    const h = harness(); const gate = deferred(); h.c.printMessages = async () => { h.seen.renders++; await gate.promise; };
    const loading = h.c.getChat(); await tick(); await h.c.clearChat(); gate.reject(new Error('synthetic stale render'));
    assert.equal(await loading, false); assert.equal(h.seen.renders, 1); assert.equal(h.seen.logs, 0);
});
test('real fetch failure still renders fallback and logs error', async () => {
    const h = harness(); h.c.fetch = async () => { throw new Error('synthetic network'); };
    assert.equal(await h.c.getChat(), undefined); assert.equal(h.seen.renders, 1); assert.equal(h.seen.logs, 1); assert.equal(h.seen.saves, 1);
});
test('CHAT_CHANGED listener cancellation suppresses later first-message events and CHAT_LOADED', async () => {
    const h = harness([{ mes: 'greeting' }]); h.c.eventSource.emit = async type => { h.seen.events.push(type); if (type === 'CHAT_CHANGED') await h.c.clearChat(); };
    assert.equal(await h.c.getChat(), false); assert.deepEqual(h.seen.events, ['CHAT_CHANGED']);
});
test('delayed textarea focus ignores a cleared successful load', async () => {
    const h = harness(); await h.c.getChat(); await h.c.clearChat(); h.timers.forEach(gate => gate.resolve()); await tick(); assert.equal(h.seen.focus, 0);
});
for (const guarded of [false, true]) {
    test(`cancelled ${guarded ? 'guarded' : 'legacy'} open never persists character`, async () => {
        const h = harness(); h.c.getChat = async () => false;
        assert.equal(await h.c.openCharacterChat('history', guarded ? { id: 0, avatar: 'synthetic.png', chatMetadata: h.c.chat_metadata } : undefined), false);
        assert.equal(h.seen.saves, 0);
    });
}
test('general redisplay remains atomic without task scheduling', () => {
    assert.doesNotMatch(fn('redisplayChat'), /await |delay\(|yield/);
});

for (const length of [249999, 250000, 250001]) {
    test(`visible text threshold at ${length} characters`, async () => {
        const h = harness([{ mes: 'x'.repeat(length) }]); await h.c.getChat();
        assert.equal(h.seen.yields, length >= 250000 ? 1 : 0);
    });
}
test('CHAT_LOADED synchronous navigation cancels outer persistence', async () => {
    const h = harness(); h.c.eventSource.emit = type => {
        h.seen.events.push(type);
        if (type === 'CHAT_LOADED') h.c.clearChat();
        return Promise.resolve();
    };
    assert.equal(await h.c.openCharacterChat('history'), false); assert.equal(h.seen.saves, 0);
});
test('cancelled new chat does not save or delete the selected history', async () => {
    const h = harness(); let deleted = 0;
    Object.assign(h.c, { menu_type: '', chat_file_for_del: undefined, is_send_press: false, humanizedDateTime: () => 'synthetic', getCurrentChatDetails: () => ({ sessionName: 'old' }), getChat: async () => false, delChat: async () => { deleted++; } });
    assert.equal(await h.c.doNewChat({ deleteCurrentChat: false }), false); assert.equal(h.seen.saves, 0); assert.equal(deleted, 0);
});
test('group identity change during response refuses model application', async () => {
    const h = harness(); const gate = deferred(); h.c.fetch = async () => { await gate.promise; return { ok: true, json: async () => [{}, { mes: 'stale' }] }; };
    const loading = h.c.getChat(); await tick(); h.c.selected_group = 'synthetic-group'; gate.resolve();
    assert.equal(await loading, false); assert.equal(h.c.chat.length, 0); assert.equal(h.seen.renders, 0);
});
test('json response suspension cannot overwrite changed metadata', async () => {
    const h = harness(); const gate = deferred(); h.c.fetch = async () => ({ ok: true, json: async () => { await gate.promise; return [{}, { mes: 'stale' }]; } });
    const loading = h.c.getChat(); await tick(); const newer = { integrity: 'newer' }; h.c.chat_metadata = newer; gate.resolve();
    assert.equal(await loading, false); assert.equal(h.c.chat_metadata, newer); assert.equal(h.c.chat.length, 0);
});
test('empty load preserves greeting save and event order', async () => {
    const h = harness([]); await h.c.getChat(); assert.equal(h.seen.saves, 1);
    assert.deepEqual(h.seen.events, ['CHAT_CHANGED', 'CHAT_CREATED', 'MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED', 'CHAT_LOADED']);
});

test('legitimate CHAT_CHANGED metadata update preserves successful terminal events', async () => {
    const h = harness(); h.c.eventSource.emit = async type => {
        h.seen.events.push(type);
        if (type === 'CHAT_CHANGED') h.c.chat_metadata = { ...h.c.chat_metadata, syntheticPlugin: true };
    };
    assert.equal(await h.c.getChat(), undefined); assert.deepEqual(h.seen.events, ['CHAT_CHANGED', 'CHAT_LOADED']);
});

test('clear invalidates before its prompt persistence await completes', async () => {
    const h = harness([{ mes: 'x'.repeat(250000) }]); const renderGate = deferred(); const clearGate = deferred();
    h.c.delay = ms => ms === 0 ? renderGate.promise : Promise.resolve(); h.c.saveItemizedPrompts = () => clearGate.promise;
    const loading = h.c.getChat(); await tick(); const clearing = h.c.clearChat(); renderGate.resolve();
    assert.equal(await loading, false); assert.equal(h.seen.menus, 0); clearGate.resolve(); await clearing;
});
test('targeted default character selection propagates cancelled load', async () => {
    const h = harness(); Object.assign(h.c, {
        this_chid: undefined, isChatSaving: false, is_group_generating: false, is_send_press: false,
        setCharacterId: id => { h.c.this_chid = id; }, setCharacterName: name => { h.c.name2 = name; },
        resetSelectedGroup: () => { h.c.selected_group = null; }, cancelTtsPlay() {}, getChat: async () => false,
    });
    assert.equal(await h.c.selectCharacterById(0, { chatFile: 'history' }), false); assert.equal(h.seen.saves, 0);
});
test('cancelled reload does not refresh swipe buttons for a newer chat', async () => {
    const h = harness(); let swipes = 0;
    Object.assign(h.c, { preserveNeutralChat() {}, getChat: async () => false, refreshSwipeButtons() { swipes++; } });
    assert.equal(await h.c.reloadCurrentChatUnsafe(), false); assert.equal(swipes, 0);
});
test('same-file reload during CHAT_CHANGED suppresses old terminal events even with restored metadata', async () => {
    const h = harness(); let first = true;
    h.c.eventSource.emit = async type => {
        h.seen.events.push(type);
        if (type === 'CHAT_CHANGED' && first) { first = false; await h.c.getChat(); }
    };
    assert.equal(await h.c.getChat(), false);
    assert.deepEqual(h.seen.events, ['CHAT_CHANGED', 'CHAT_CHANGED', 'CHAT_LOADED']);
});
