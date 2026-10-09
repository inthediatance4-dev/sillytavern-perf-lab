import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const promptSource = readFileSync(new URL('../public/scripts/itemized-prompts.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
const groupSource = readFileSync(new URL('../public/scripts/group-chats.js', import.meta.url), 'utf8');
const welcomeSource = readFileSync(new URL('../public/scripts/welcome-screen.js', import.meta.url), 'utf8');
function fn(source, name) {
    const start = source.search(new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, `${name} exists`);
    return source.slice(start, source.indexOf('\n}', start) + 2).replace(/^export /, '');
}
const prefix = promptSource.slice(0, promptSource.indexOf('export async function replaceItemizedPromptText'))
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
const rows = id => [{ mesId: 0, rawPrompt: `synthetic ${id}` }];
const plain = value => JSON.parse(JSON.stringify(value));
function harness() {
    const stored = new Map([['A', rows('A')], ['B', rows('B')]]);
    const reads = [], writes = [], events = [], logs = [];
    const c = vm.createContext({
        localforage: { createInstance: () => ({
            getItem(id) { const gate = deferred(); reads.push({ id, ...gate }); return gate.promise; },
            async setItem(id, value) { const snapshot = plain(value); writes.push({ id, rows: snapshot }); await c.setGate?.promise; stored.set(id, snapshot); },
        }) },
        console: { log: (...args) => logs.push(args), debug() {}, warn() {} },
        event_types: { ITEMIZED_PROMPTS_LOADED: 'loaded', ITEMIZED_PROMPTS_SAVED: 'saved' },
        eventSource: { async emit(type, payload) { events.push({ type, ...payload }); await c.listener?.(type, payload); } },
        chat: [], characters: [{ name: 'Synthetic', avatar: 'a.png', chat: 'A' }], this_chid: 0,
        selected_group: null, chat_metadata: {}, name2: '', power_user: { chat_truncation: 100 },
        getCurrentChatId: () => c.selected_group ? c.groups.find(g => g.id === c.selected_group)?.chat_id : c.characters[c.this_chid]?.chat,
        mediaLoadScrollHandler: { cancel() {} }, cancelDebouncedChatSave() {}, cancelDebouncedMetadataSave() {}, closeMessageEditor() {},
        extension_prompts: {}, is_delete_mode: false, $: () => ({ length: 0, is: () => false, trigger() { return this; } }),
        chatElement: { children: () => ({ remove() {} }), find: () => ({ remove() {} }) },
    });
    vm.runInContext(prefix + '\nlet characterChatLoadSerial = 0;\n' + fn(mainSource, 'clearChat'), c);
    return { c, stored, reads, writes, events, logs, cache: () => plain(vm.runInContext('itemizedPrompts', c)), setCache: value => { c.seed = value; vm.runInContext('itemizedPrompts = seed;', c); } };
}
for (const sameFile of [false, true]) {
    test(`reversed ${sameFile ? 'same-file' : 'different-file'} reads preserve the newest cache and suppress stale events`, async () => {
        const h = harness(); const a = h.c.loadItemizedPrompts('A'); const b = h.c.loadItemizedPrompts(sameFile ? 'A' : 'B');
        h.reads[1].resolve(rows('new')); assert.equal(await b, undefined); h.reads[0].resolve(rows('old')); assert.equal(await a, false);
        assert.deepEqual(h.cache(), rows('new')); assert.equal(h.events.length, 1);
    });
}
test('stale read rejection neither empties current cache nor logs', async () => {
    const h = harness(); const a = h.c.loadItemizedPrompts('A'); const b = h.c.loadItemizedPrompts('B');
    h.reads[1].resolve(rows('B')); await b; h.reads[0].reject(new Error('synthetic')); assert.equal(await a, false);
    assert.deepEqual(h.cache(), rows('B')); assert.equal(h.logs.length, 0);
});
test('close during pending read preserves stored prompts and refuses late cache resurrection', async () => {
    const h = harness(); const loading = h.c.loadItemizedPrompts('A'); await h.c.clearChat({ clearData: true });
    h.reads[0].resolve(rows('A')); assert.equal(await loading, false);
    assert.deepEqual(h.stored.get('A'), rows('A')); assert.deepEqual(h.writes, []); assert.deepEqual(h.cache(), []); assert.deepEqual(h.events, []);
});
test('late clear persistence cannot empty a newer loaded cache or chat model', async () => {
    const h = harness(); h.setCache(rows('A')); h.c.chat = [{ mes: 'A' }]; h.c.setGate = deferred();
    const clearing = h.c.clearChat({ clearData: true }); const loading = h.c.loadItemizedPrompts('B'); h.c.chat = [{ mes: 'B' }];
    h.reads[0].resolve(rows('B')); await loading; h.c.setGate.resolve(); await clearing;
    assert.deepEqual(h.cache(), rows('B')); assert.deepEqual(h.c.chat, [{ mes: 'B' }]); assert.deepEqual(h.stored.get('A'), rows('A'));
});
test('current storage failure suppresses writes including generated pushes until successful retry', async () => {
    const h = harness(); const bad = h.c.loadItemizedPrompts('A'); h.reads[0].reject(new Error('synthetic')); await bad;
    vm.runInContext('itemizedPrompts.push({ mesId: 1, rawPrompt: "generated synthetic" });', h.c);
    await h.c.saveItemizedPrompts('A'); assert.deepEqual(h.writes, []); assert.deepEqual(h.stored.get('A'), rows('A'));
    const retry = h.c.loadItemizedPrompts('A'); h.reads[1].resolve(rows('retry')); await retry; await h.c.saveItemizedPrompts('A');
    assert.deepEqual(h.stored.get('A'), rows('retry'));
});
test('loaded listener rejection preserves successfully read cache', async () => {
    const h = harness(); h.c.listener = async type => { if (type === 'loaded') throw new Error('synthetic listener'); };
    const loading = h.c.loadItemizedPrompts('A'); h.reads[0].resolve(rows('A')); await loading;
    assert.deepEqual(h.cache(), rows('A')); await h.c.saveItemizedPrompts('bookmark'); assert.deepEqual(h.stored.get('bookmark'), rows('A'));
});
test('listener cancellation rejection preserves newer cache without stale log', async () => {
    const h = harness(); const gate = deferred(); h.c.listener = (type, payload) => type === 'loaded' && payload.chatId === 'A' ? gate.promise : undefined;
    const a = h.c.loadItemizedPrompts('A'); h.reads[0].resolve(rows('A')); await tick();
    const b = h.c.loadItemizedPrompts('B'); h.reads[1].resolve(rows('B')); await b; gate.reject(new Error('synthetic listener')); await a;
    assert.deepEqual(h.cache(), rows('B')); assert.equal(h.logs.length, 0);
});
test('legacy no-id supersedes a pending read and creates saveable empty neutral state', async () => {
    const h = harness(); const a = h.c.loadItemizedPrompts('A'); assert.equal(await h.c.loadItemizedPrompts(), undefined);
    h.reads[0].resolve(rows('A')); await a; await h.c.saveItemizedPrompts('neutral');
    assert.deepEqual(h.cache(), []); assert.deepEqual(h.events, [{ type: 'saved', chatId: 'neutral' }]);
});
test('missing stored prompts become ready empty and preserve legacy event payloads', async () => {
    const h = harness(); const loading = h.c.loadItemizedPrompts('missing'); h.reads[0].resolve(null); assert.equal(await loading, undefined);
    assert.equal(await h.c.saveItemizedPrompts('bookmark'), undefined); assert.deepEqual(h.stored.get('bookmark'), []);
    assert.deepEqual(h.events, [{ type: 'loaded', chatId: 'missing' }, { type: 'saved', chatId: 'bookmark' }]);
});
test('optional caller ownership rejects the request before storage begins', async () => {
    const h = harness(); const loading = h.c.loadItemizedPrompts('A', { isCurrent: () => false });
    h.reads[0]?.resolve(rows('A')); await loading; assert.equal(h.reads.length, 0);
});

test('stale prepared reservation does not supersede or start a read', async () => {
    const h = harness(); const old = h.c.reserveItemizedPrompts(); const loading = h.c.loadItemizedPrompts('B');
    assert.equal(await h.c.loadItemizedPrompts('A', { request: old }), false);
    h.reads[0].resolve(rows('B')); await loading; assert.equal(h.reads.length, 1); assert.deepEqual(h.cache(), rows('B'));
});
test('caller ownership lost during storage prevents assignment and events', async () => {
    const h = harness(); let current = true; const loading = h.c.loadItemizedPrompts('A', { isCurrent: () => current });
    current = false; h.reads[0].resolve(rows('A')); assert.equal(await loading, false); assert.deepEqual(h.cache(), []); assert.deepEqual(h.events, []);
});
test('started ready save completes for its original filename and rows after a newer read', async () => {
    const h = harness(); h.setCache(rows('A')); h.c.setGate = deferred(); const saving = h.c.saveItemizedPrompts('bookmark');
    const loading = h.c.loadItemizedPrompts('B'); h.reads[0].resolve(rows('B')); await loading; h.c.setGate.resolve(); await saving;
    assert.deepEqual(h.stored.get('bookmark'), rows('A')); assert.deepEqual(h.cache(), rows('B'));
});

function characterHarness() {
    const h = harness(); const c = h.c; h.renders = 0;
    Object.assign(c, {
        unshallowCharacter: async () => {}, fetch: async () => ({ ok: true, json: async () => [] }),
        getRequestHeaders: () => ({}), ensureMessageMediaIsArray() {}, uuidv4: () => 'synthetic',
        getFirstMessage: () => ({ mes: 'synthetic greeting' }),
        saveChatConditional: () => c.saveItemizedPrompts(c.getCurrentChatId()),
        printMessages: async () => { h.renders++; }, select_selected_character() {},
        delay: async () => {}, debounce_timeout: { short: 10 }, document: { activeElement: {} },
    });
    vm.runInContext(['beginCharacterChatLoad', 'isCharacterChatLoadCurrent', 'shouldYieldCharacterChatLoad', 'getChat', 'getChatResult'].map(name => fn(mainSource, name)).join('\n'), c);
    return h;
}
test('character reserves before preparation and fresh greeting save without overwriting unread prompts', async () => {
    const h = characterHarness(); h.setCache(rows('previous')); const gate = deferred(); h.c.unshallowCharacter = () => gate.promise;
    const loading = h.c.getChat(); await h.c.saveItemizedPrompts('A'); assert.deepEqual(h.writes, []);
    gate.resolve(); await tick(); assert.equal(h.reads.length, 1); assert.deepEqual(h.writes, []);
    h.reads[0].resolve(rows('A')); assert.equal(await loading, undefined); assert.equal(h.renders, 1); assert.deepEqual(h.stored.get('A'), rows('A'));
});
test('character canceled during prompt read stops before rendering and chat events', async () => {
    const h = characterHarness(); const loading = h.c.getChat(); await tick(); await h.c.clearChat({ clearData: true });
    h.reads[0].resolve(rows('A')); assert.equal(await loading, false); assert.equal(h.renders, 0); assert.deepEqual(h.events, []);
});

function groupHarness() {
    const h = harness(); h.renders = 0; const c = h.c;
    Object.assign(c, {
        selected_group: 'group-A', groups: [{ id: 'group-A', chat_id: 'A', members: [] }, { id: 'group-B', chat_id: 'B', members: [] }],
        validateGroup: async () => {}, unshallowGroupMembers: async () => {},
        loadGroupChat: async () => [{ chat_metadata: { integrity: 'synthetic' } }, { mes: 'synthetic group message' }],
        uuidv4: () => 'synthetic', ensureMessageMediaIsArray() {}, printMessages: async () => { h.renders++; },
        updateChatMetadata: value => { c.chat_metadata = value; }, select_group_chats() {},
    });
    vm.runInContext(fn(groupSource, 'getGroupChat'), c); return h;
}
for (const boundary of ['validateGroup', 'unshallowGroupMembers', 'loadGroupChat']) {
    test(`old group suspended at ${boundary} cannot supersede newer prompts`, async () => {
        const h = groupHarness(); const gate = deferred(); const original = h.c[boundary]; let first = true;
        h.c[boundary] = async (...args) => { if (first) { first = false; await gate.promise; } return original(...args); };
        const a = h.c.getGroupChat('group-A'); await tick(); h.c.selected_group = 'group-B'; const b = h.c.getGroupChat('group-B'); await tick();
        h.reads[0].resolve(rows('B')); await b; gate.resolve(); assert.equal(await a, false);
        assert.equal(h.reads.length, 1); assert.deepEqual(h.cache(), rows('B')); assert.equal(h.renders, 1);
    });
}
test('same-file group reopen supersedes the older group fetch', async () => {
    const h = groupHarness(); const gate = deferred(); let first = true; const original = h.c.loadGroupChat;
    h.c.loadGroupChat = async (...args) => { if (first) { first = false; await gate.promise; } return original(...args); };
    const a = h.c.getGroupChat('group-A'); await tick(); const b = h.c.getGroupChat('group-A'); await tick();
    h.reads[0].resolve(rows('new')); await b; gate.resolve(); assert.equal(await a, false); assert.equal(h.reads.length, 1); assert.deepEqual(h.cache(), rows('new'));
});
test('group prompt cancellation stops before message model and metadata application', async () => {
    const h = groupHarness(); const metadata = h.c.chat_metadata; const a = h.c.getGroupChat('group-A'); await tick(); await h.c.clearChat();
    h.reads[0].resolve(rows('A')); assert.equal(await a, false); assert.equal(h.renders, 0); assert.equal(h.c.chat.length, 0); assert.equal(h.c.chat_metadata, metadata); assert.deepEqual(h.events, []);
});
test('validation may legitimately initialize a missing group chat id', async () => {
    const h = groupHarness(); h.c.groups[0].chat_id = undefined; h.c.validateGroup = async group => { group.chat_id = 'initialized'; };
    const loading = h.c.getGroupChat('group-A'); await tick(); assert.equal(h.reads.length, 1);
    assert.equal(h.reads[0].id, 'initialized'); h.reads[0].resolve(rows('initialized')); assert.equal(await loading, undefined);
});
test('already stale group entry cannot reserve over the selected group cache', async () => {
    const h = groupHarness(); h.c.selected_group = 'group-B'; const loading = h.c.loadItemizedPrompts('B');
    h.reads[0].resolve(rows('B')); await loading; assert.equal(await h.c.getGroupChat('group-A'), false);
    assert.deepEqual(h.cache(), rows('B')); await h.c.saveItemizedPrompts('bookmark'); assert.deepEqual(h.stored.get('bookmark'), rows('B'));
});
test('group filename changed during preparation is canceled before starting a prompt read', async () => {
    const h = groupHarness(); const gate = deferred(); h.c.unshallowGroupMembers = () => gate.promise;
    const loading = h.c.getGroupChat('group-A'); await tick(); h.c.groups[0].chat_id = 'new-file'; gate.resolve();
    assert.equal(await loading, false); assert.equal(h.reads.length, 0); assert.equal(h.renders, 0); assert.deepEqual(h.events, []);
});
for (const state of ['loaded', 'pending', 'failed']) {
    test(`repeated clear of an addressed ${state} chat preserves stored inspection prompts`, async () => {
        const h = harness(); const loading = h.c.loadItemizedPrompts('A');
        if (state === 'loaded') { h.reads[0].resolve(rows('A')); await loading; }
        if (state === 'failed') { h.reads[0].reject(new Error('synthetic failure')); await loading; }
        await h.c.clearChat({ clearData: true }); await h.c.clearChat({ clearData: true });
        if (state === 'pending') { h.reads[0].resolve(rows('A')); assert.equal(await loading, false); }
        assert.deepEqual(h.stored.get('A'), rows('A'));
        assert.deepEqual(h.writes, state === 'loaded' ? [{ id: 'A', rows: rows('A') }] : []);
        assert.deepEqual(h.cache(), []);
    });
}
test('clear without an addressed chat retains ready neutral empty-save behavior', async () => {
    const h = harness(); h.c.this_chid = undefined; await h.c.clearChat();
    assert.equal(await h.c.saveItemizedPrompts('neutral'), undefined);
    assert.deepEqual(h.stored.get('neutral'), []); assert.deepEqual(h.events, [{ type: 'saved', chatId: 'neutral' }]);
});
test('successful reload after repeated clear restores ready save-as behavior', async () => {
    const h = harness(); h.setCache(rows('A')); await h.c.clearChat(); await h.c.clearChat();
    const loading = h.c.loadItemizedPrompts('A'); h.reads[0].resolve(rows('A')); await loading;
    await h.c.saveItemizedPrompts('bookmark'); assert.deepEqual(h.stored.get('bookmark'), rows('A'));
});


function groupOpeningHarness() {
    const h = groupHarness(); const c = h.c;
    h.active = []; h.settings = 0; h.historyEdits = []; h.clears = 0;
    for (const group of c.groups) group.chats = [group.chat_id, `${group.chat_id}-history`, `${group.chat_id}-newer`];
    Object.assign(c, {
        selected_group: null, isChatSaving: false, is_send_press: false, is_group_generating: false,
        setCharacterId: value => { c.this_chid = value; }, setCharacterName() {}, setEditedMessageId() {}, cancelTtsPlay() {},
        setActiveGroup: id => { h.active.push(id); }, saveSettingsDebounced: () => { h.settings++; },
        waitUntilCondition: async predicate => { assert.equal(predicate(), true); }, debounce_timeout: { extended: 10 },
        editGroup: async id => { h.historyEdits.push({ id, file: c.groups.find(g => g.id === id).chat_id }); },
        toastr: { info() {}, error() { assert.fail('unexpected group opening error'); } },
        t: parts => parts.join(''),
    });
    const clear = c.clearChat;
    c.clearChat = async (...args) => { h.clears++; return clear(...args); };
    const declarations = [
        groupSource.match(/^let groupChatOpenSerial = .*;$/m)?.[0],
        welcomeSource.match(/^let recentGroupChatOpenSerial = .*;$/m)?.[0],
    ].filter(Boolean);
    vm.runInContext([...declarations, fn(groupSource, 'resetSelectedGroup'), fn(groupSource, 'openGroupById'),
        fn(groupSource, 'openGroupChat'), fn(welcomeSource, 'openRecentGroupChat')].join('\n'), c);
    return h;
}

test('openGroupById propagates a canceled actual prompt read as false', async () => {
    const h = groupOpeningHarness(); const opening = h.c.openGroupById('group-A'); await tick();
    assert.equal(h.reads.length, 1); await h.c.clearChat({ clearData: true }); h.c.resetSelectedGroup();
    h.reads[0].resolve(rows('A')); assert.equal(await opening, false); assert.equal(h.renders, 0);
});

test('canceled recent group opening never activates, saves settings or clears HOME again', async () => {
    const h = groupOpeningHarness(); const opening = h.c.openRecentGroupChat('group-A', 'A-history'); await tick();
    await h.c.clearChat({ clearData: true }); h.c.resetSelectedGroup();
    const clearCount = h.clears; h.reads[0].resolve(rows('A')); await opening;
    assert.deepEqual(h.active, []); assert.equal(h.settings, 0); assert.deepEqual(h.historyEdits, []);
    assert.equal(h.clears, clearCount); assert.equal(h.c.selected_group, null);
});

test('already-selected group preserves legacy false and opens another recent history normally', async () => {
    const h = groupOpeningHarness(); h.c.selected_group = 'group-A';
    assert.equal(await h.c.openGroupById('group-A'), false);
    const opening = h.c.openRecentGroupChat('group-A', 'A-history'); await tick();
    assert.equal(h.reads.length, 1); assert.equal(h.reads[0].id, 'A-history'); h.reads[0].resolve(rows('A-history')); await opening;
    assert.deepEqual(h.active, ['group-A']); assert.equal(h.settings, 1);
    assert.deepEqual(h.historyEdits, [{ id: 'group-A', file: 'A-history' }]); assert.equal(h.renders, 1);
});

for (const guard of ['isChatSaving', 'is_send_press', 'is_group_generating']) {
    test(`already-selected recent group still refuses ${guard}`, async () => {
        const h = groupOpeningHarness(); h.c.selected_group = 'group-A'; h.c[guard] = true;
        h.c.waitUntilCondition = async () => {};
        const opening = h.c.openRecentGroupChat('group-A', 'A-history'); await tick();
        for (const read of h.reads) read.resolve(rows(read.id)); await opening;
        assert.deepEqual(h.active, []); assert.equal(h.settings, 0); assert.equal(h.clears, 0); assert.equal(h.reads.length, 0);
    });
}

test('rapid same-group recent entries only continue the newest requested history', async () => {
    const h = groupOpeningHarness(); h.c.selected_group = 'group-A';
    const old = h.c.openRecentGroupChat('group-A', 'A-history');
    const newest = h.c.openRecentGroupChat('group-A', 'A-newer'); await tick();
    for (const read of h.reads) read.resolve(rows(read.id)); await Promise.all([old, newest]);
    assert.deepEqual(h.active, ['group-A']); assert.equal(h.settings, 1);
    assert.deepEqual(h.historyEdits, [{ id: 'group-A', file: 'A-newer' }]); assert.equal(h.reads.length, 1);
});

test('same-group filename change after selected-group return prevents stale recent continuation', async () => {
    const h = groupOpeningHarness(); h.c.selected_group = 'group-A'; const original = h.c.openGroupById;
    h.c.openGroupById = async (...args) => { const result = await original(...args); h.c.groups[0].chat_id = 'A-newer'; return result; };
    const opening = h.c.openRecentGroupChat('group-A', 'A-history'); await tick();
    for (const read of h.reads) read.resolve(rows(read.id)); await opening;
    assert.deepEqual(h.active, []); assert.equal(h.settings, 0); assert.equal(h.clears, 0); assert.equal(h.reads.length, 0);
});

test('same-group reopen during awaited clear cannot let the older entry start a late read', async () => {
    const h = groupOpeningHarness(); const gate = deferred(); const clear = h.c.clearChat; let first = true;
    h.c.clearChat = async (...args) => { await clear(...args); if (first) { first = false; await gate.promise; } };
    const older = h.c.openGroupById('group-A'); await tick();
    const newer = h.c.openGroupById('group-A'); await tick(); h.reads[0].resolve(rows('new')); assert.equal(await newer, true);
    gate.resolve(); await tick(); for (const read of h.reads.slice(1)) read.resolve(rows('old'));
    assert.equal(await older, false); assert.equal(h.reads.length, 1); assert.deepEqual(h.cache(), rows('new'));
});

test('native reset during awaited opening clear prevents a late group selection', async () => {
    const h = groupOpeningHarness(); const gate = deferred(); const clear = h.c.clearChat;
    h.c.clearChat = async (...args) => { await clear(...args); await gate.promise; };
    const opening = h.c.openGroupById('group-A'); await tick(); h.c.resetSelectedGroup(); gate.resolve(); await tick();
    for (const read of h.reads) read.resolve(rows('late'));
    assert.equal(await opening, false); assert.equal(h.c.selected_group, null); assert.equal(h.reads.length, 0);
});

test('openGroupById refuses success when prompt ownership changes during awaited rendering', async () => {
    const h = groupOpeningHarness(); const gate = deferred(); h.c.printMessages = () => gate.promise;
    const opening = h.c.openGroupById('group-A'); await tick(); h.reads[0].resolve(rows('A')); await tick();
    const newer = h.c.loadItemizedPrompts('A'); h.reads[1].resolve(rows('new')); await newer; gate.resolve();
    assert.equal(await opening, false); assert.deepEqual(h.cache(), rows('new'));
});

test('normal group terminal events may replace metadata without canceling successful opening', async () => {
    const h = groupOpeningHarness(); h.c.event_types.CHAT_CHANGED = 'chat-changed'; h.c.event_types.GROUP_CHAT_CREATED = 'group-created';
    h.c.loadGroupChat = async () => []; h.c.saveGroupChat = async () => {};
    h.c.listener = async type => { if (type === 'chat-changed' || type === 'group-created') h.c.chat_metadata = { from: type }; };
    const opening = h.c.openGroupById('group-A'); await tick(); h.reads[0].resolve(rows('A'));
    assert.equal(await opening, true); assert.deepEqual(h.events.map(event => event.type), ['loaded', 'chat-changed', 'group-created']);
});
