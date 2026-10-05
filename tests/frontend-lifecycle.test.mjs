import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
const groupScript = readFileSync(new URL('../public/scripts/group-chats.js', import.meta.url), 'utf8');

// Execute the application functions, keeping DOM/network boundaries outside this VM.
function functionSource(source, name) {
    const start = source.search(new RegExp(`^(?:export )?async function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, `${name} must exist in the application source`);
    const end = source.indexOf('\n}', start);
    assert.notEqual(end, -1, `${name} must have a top-level closing brace`);
    return source.slice(start, end + 2).replace(/^export /, '');
}

const helperOffset = script.indexOf('export async function handleChatLifecycleConflict(');
assert.notEqual(helperOffset, -1);
const helperStart = script.indexOf('const chatLifecycleConflicts = new Map();');
assert.notEqual(helperStart, -1);
const helperEnd = script.indexOf('\n}', helperOffset) + 2;
const helperSource = script.slice(helperStart, helperEnd).replaceAll('export async function', 'async function').replaceAll('export function', 'function');
const tick = () => new Promise(resolve => setImmediate(resolve));
const lifecycleError = { error: 'chat_lifecycle', reason: 'retired' };
const rows = text => [{ chat_metadata: { integrity: 'synthetic' } }, { mes: text, is_user: true }];
const jsonl = snapshot => snapshot.map(row => JSON.stringify(row)).join('\n');

function harness(functions = []) {
    const popups = [];
    const downloads = [];
    const requests = [];
    const observations = { reloads: 0, redraws: 0, groupEdits: 0, cacheWrites: 0 };
    let response = { ok: false, status: 409, statusText: 'Conflict', json: async () => lifecycleError };
    const context = vm.createContext({
        console: { warn() {}, error() {}, debug() {} },
        t: (parts, ...values) => parts.reduce((text, part, i) => text + part + (values[i] ?? ''), ''),
        POPUP_RESULT: { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null },
        Popup: { show: {
            confirm: (header, text, options) => new Promise((resolve, reject) => popups.push({ header, text, options, resolve, reject })),
            input: () => { throw new Error('Lifecycle conflicts must not request force overwrite'); },
        } },
        download: (content, name, type) => downloads.push({ content, name, type }),
        window: { location: { reload: () => { observations.reloads++; } } },
        toastr: { error() {} },
        selected_group: null,
        this_chid: 0,
        characters: [{ name: 'Synthetic character', avatar: 'synthetic.png', chat: 'retired-chat' }],
        name1: 'Synthetic user', name2: 'Synthetic character', user_avatar: 'synthetic-user.png',
        neutralCharacterName: 'Neutral',
        chat: rows('unsaved synthetic message').slice(1),
        chat_metadata: { integrity: 'synthetic', tainted: true },
        groups: [{ id: 'synthetic-group', chat_id: 'retired-group-chat', chats: [] }],
        compressRequest: async request => request,
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
        fetch: async (url, request) => {
            const captured = { url, body: JSON.parse(request.body) };
            requests.push(captured);
            return typeof response === 'function' ? response(captured) : response;
        },
        editGroup: async () => { observations.groupEdits++; },
        isChatSaving: false,
        DEFAULT_SAVE_EDIT_TIMEOUT: 1,
        waitUntilCondition: async predicate => assert.equal(predicate(), true),
        cancelDebouncedChatSave() {},
        saveTokenCache: () => { observations.cacheWrites++; },
        saveItemizedPrompts: () => { observations.cacheWrites++; },
        getCurrentChatId: () => 'retired-chat',
        getRegexedString: value => value,
        regex_placement: { USER_INPUT: 1 },
        getMessageTimeStamp: () => 'synthetic-time',
        substituteParams: value => value,
        power_user: { message_token_count_enabled: false, personas: {} },
        populateFileAttachment: async () => {},
        statMesProcess() {},
        eventSource: { emit: async () => {} },
        event_types: { MESSAGE_SENT: 'sent', USER_MESSAGE_RENDERED: 'rendered' },
        addOneMessage() {},
        reloadCurrentChat: async () => { observations.reloads++; context.chat.splice(0); },
        redisplayChat: async () => { observations.redraws++; },
    });
    const source = [helperSource, ...functions.map(([file, name]) => functionSource(file, name))].join('\n');
    vm.runInContext(source, context);
    return { context, popups, downloads, requests, observations, setResponse: value => { response = value; } };
}

test('ordinary errors do not open a lifecycle popup', async () => {
    const h = harness();
    assert.equal(await h.context.handleChatLifecycleConflict({ error: 'integrity' }, rows('ordinary'), 'a'), false);
    assert.equal(h.popups.length, 0);
    assert.equal(h.downloads.length, 0);
});

test('Keep this tab neither reloads nor downloads the conflicted snapshot', async () => {
    const h = harness();
    const pending = h.context.handleChatLifecycleConflict(lifecycleError, rows('keep'), 'a');
    await tick();
    assert.equal(h.popups[0].options.okButton, 'Download unsaved chat');
    assert.equal(h.popups[0].options.cancelButton, 'Keep this tab');
    h.popups[0].resolve(0);
    assert.equal(await pending, true);
    assert.equal(h.downloads.length, 0);
    assert.equal(h.observations.reloads, 0);
});

test('a later conflict for the same chat downloads its latest frozen snapshot once', async () => {
    const h = harness();
    const first = h.context.handleChatLifecycleConflict(lifecycleError, rows('earlier'), 'character:a.png:one');
    await tick();
    const latest = rows('后续未保存消息');
    const expected = jsonl(latest);
    const second = h.context.handleChatLifecycleConflict(lifecycleError, latest, 'character:a.png:one');
    latest[1].mes = 'mutation after capture';
    await tick();
    assert.equal(h.popups.length, 1);
    h.popups[0].resolve(1);
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(h.downloads.length, 1);
    assert.equal(h.downloads[0].content, expected);
    assert.equal(h.downloads[0].type, 'application/jsonl');
});

test('different chat identities receive separate serial popups and exact JSONL downloads', async () => {
    const h = harness();
    const firstSnapshot = rows('character snapshot');
    const secondSnapshot = rows('group snapshot');
    const first = h.context.handleChatLifecycleConflict(lifecycleError, firstSnapshot, 'character:a.png:one');
    const second = h.context.handleChatLifecycleConflict(lifecycleError, secondSnapshot, 'group:one');
    await tick();
    assert.equal(h.popups.length, 1);
    h.popups[0].resolve(1);
    await first;
    await tick();
    assert.equal(h.popups.length, 2);
    h.popups[1].resolve(1);
    await second;
    assert.deepEqual(h.downloads.map(item => item.content), [jsonl(firstSnapshot), jsonl(secondSnapshot)]);
});

test('popup failure releases that identity and does not block a queued chat or a retry', async () => {
    const h = harness();
    const first = h.context.handleChatLifecycleConflict(lifecycleError, rows('failed'), 'a');
    const failure = assert.rejects(first, /popup failed/);
    const second = h.context.handleChatLifecycleConflict(lifecycleError, rows('next'), 'b');
    second.catch(() => {}); // Observe legacy shared rejection without an unhandled promise.
    await tick();
    h.popups[0].reject(new Error('popup failed'));
    await failure;
    await tick();
    assert.equal(h.popups.length, 2);
    h.popups[1].resolve(0);
    await second;
    const retry = h.context.handleChatLifecycleConflict(lifecycleError, rows('retry'), 'a');
    await tick();
    assert.equal(h.popups.length, 3);
    h.popups[2].resolve(1);
    await retry;
    assert.equal(h.downloads[0].content, jsonl(rows('retry')));
});

const saveFunctions = [[script, 'saveChat'], [script, 'saveChatConditional']];

function delayResponses(h) {
    h.setResponse(request => new Promise(resolve => { request.resolve = resolve; }));
    return index => h.requests[index].resolve({ ok: false, status: 409, statusText: 'Conflict', json: async () => lifecycleError });
}

test('reverse character save responses download the newest submitted snapshot', async () => {
    const h = harness(saveFunctions);
    const respond = delayResponses(h);
    const first = h.context.saveChat();
    await tick();
    h.context.chat.push({ mes: 'newer unsaved message', is_user: true });
    const second = h.context.saveChat();
    await tick();
    respond(1);
    await tick();
    respond(0);
    await tick();
    h.popups[0].resolve(1);
    assert.deepEqual(await Promise.all([first, second]), [false, false]);
    assert.equal(h.popups.length, 1);
    assert.equal(h.downloads[0].content, jsonl(h.requests[1].body.chat));
});

test('an older response after the newest popup closes does not offer an older download', async () => {
    const h = harness(saveFunctions);
    const respond = delayResponses(h);
    const first = h.context.saveChat();
    await tick();
    h.context.chat.push({ mes: 'newer unsaved message', is_user: true });
    const second = h.context.saveChat();
    await tick();
    respond(1);
    await tick();
    h.popups[0].resolve(1);
    assert.equal(await second, false);
    respond(0);
    await tick();
    h.popups[1]?.resolve(0);
    assert.equal(await first, false);
    assert.equal(h.popups.length, 1);
    assert.equal(h.downloads.length, 1);
    assert.equal(h.downloads[0].content, jsonl(h.requests[1].body.chat));
});

test('a newer response as the previous popup completes still offers its own recovery', async () => {
    const h = harness(saveFunctions);
    const respond = delayResponses(h);
    const first = h.context.saveChat();
    await tick();
    h.context.chat.push({ mes: 'newer unsaved message', is_user: true });
    const second = h.context.saveChat();
    await tick();
    respond(0);
    await tick();
    h.popups[0].resolve(1);
    respond(1);
    await tick();
    h.popups[1]?.resolve(1);
    assert.deepEqual(await Promise.all([first, second]), [false, false]);
    assert.equal(h.popups.length, 2);
    assert.equal(h.downloads.length, 2);
    assert.equal(h.downloads[1].content, jsonl(h.requests[1].body.chat));
});

test('a same-realm popup completion cannot consume a newer conflict without offering it', async () => {
    const h = harness();
    h.context.testPopups = h.popups;
    h.context.testError = lifecycleError;
    h.context.testNewer = rows('newer unsaved message');
    vm.runInContext(`Popup.show.confirm = (header, text, options) => new Promise((resolve, reject) => {
        testPopups.push({ header, text, options, resolve, reject });
    });`, h.context);
    const first = h.context.handleChatLifecycleConflict(lifecycleError, rows('older'), 'a');
    await tick();
    h.popups[0].resolve(1);
    vm.runInContext('globalThis.newerConflict = Promise.resolve().then(() => handleChatLifecycleConflict(testError, testNewer, "a"));', h.context);
    await tick();
    h.popups[1]?.resolve(1);
    assert.deepEqual(await Promise.all([first, h.context.newerConflict]), [true, true]);
    assert.equal(h.popups.length, 2);
    assert.equal(h.downloads.length, 2);
    assert.equal(h.downloads[1].content, jsonl(rows('newer unsaved message')));
});

test('character recovery uses the frozen request payload after in-memory editing', async () => {
    const h = harness(saveFunctions);
    const respond = delayResponses(h);
    const pending = h.context.saveChat();
    await tick();
    h.context.chat[0].mes = 'edited after submission';
    respond(0);
    await tick();
    h.popups[0].resolve(1);
    assert.equal(await pending, false);
    assert.equal(h.downloads[0].content, jsonl(h.requests[0].body.chat));
});

test('late group conflict keeps the submitted group snapshot and identity after switching chats', async () => {
    const h = harness([[groupScript, 'saveGroupChat']]);
    const respond = delayResponses(h);
    const identities = [];
    const actualHelper = h.context.handleChatLifecycleConflict;
    h.context.handleChatLifecycleConflict = (error, snapshot, identity) => {
        identities.push(identity);
        return actualHelper(error, snapshot, identity);
    };
    const pending = h.context.saveGroupChat('synthetic-group', false);
    await tick();
    h.context.groups[0].chat_id = 'different-chat';
    h.context.chat.splice(0, h.context.chat.length, { mes: 'different group message', is_user: true });
    respond(0);
    await tick();
    h.popups[0].resolve(1);
    assert.equal(await pending, false);
    assert.deepEqual(identities, [JSON.stringify(['group', 'retired-group-chat'])]);
    assert.equal(h.downloads[0].content, jsonl(h.requests[0].body.chat));
});

test('group bookmark freezes its payload before awaiting the group metadata write', async () => {
    const h = harness([[groupScript, 'saveGroupBookmarkChat']]);
    const expected = jsonl([{ chat_metadata: { ...h.context.chat_metadata }, user_name: 'unused', character_name: 'unused' }, ...h.context.chat]);
    let continueEdit;
    h.context.editGroup = () => new Promise(resolve => { continueEdit = resolve; });
    const pending = h.context.saveGroupBookmarkChat('synthetic-group', 'retired-group-chat', {});
    await tick();
    h.context.chat.splice(0, h.context.chat.length, { mes: 'different group message', is_user: true });
    continueEdit();
    await tick();
    h.popups[0].resolve(1);
    await pending;
    assert.equal(jsonl(h.requests[0].body.chat), expected);
    assert.equal(h.downloads[0].content, expected);
});

test('character lifecycle save returns failure through saveChatConditional without force or cache success', async () => {
    const h = harness(saveFunctions);
    const pending = h.context.saveChatConditional();
    await tick();
    h.popups[0].resolve(0);
    assert.equal(await pending, false);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].body.force, false);
    assert.equal(h.observations.reloads, 0);
    assert.equal(h.observations.cacheWrites, 0);
    assert.equal(h.context.isChatSaving, false);
});

test('successful character save still returns success and writes caches', async () => {
    const h = harness(saveFunctions);
    h.setResponse({ ok: true, status: 200, statusText: 'OK', json: async () => ({ result: 'ok' }) });
    assert.equal(await h.context.saveChatConditional(), true);
    assert.equal(h.observations.cacheWrites, 2);
    assert.equal(h.popups.length, 0);
});

test('insertAt retains unsaved messages and redraws locally after lifecycle save failure', async () => {
    const h = harness([...saveFunctions, [script, 'sendMessageAsUser']]);
    const pending = h.context.sendMessageAsUser('inserted synthetic message', '', 0);
    await tick();
    h.popups[0].resolve(0);
    await pending;
    assert.equal(h.observations.reloads, 0);
    assert.equal(h.context.chat.length, 2);
    assert.equal(h.context.chat[0].mes, 'inserted synthetic message');
    assert.equal(h.observations.redraws, 1);
});

test('successful insertAt retains the existing server reload behavior', async () => {
    const h = harness([...saveFunctions, [script, 'sendMessageAsUser']]);
    h.setResponse({ ok: true, status: 200, statusText: 'OK', json: async () => ({ result: 'ok' }) });
    await h.context.sendMessageAsUser('inserted synthetic message', '', 0);
    assert.equal(h.observations.reloads, 1);
    assert.equal(h.observations.redraws, 0);
});

test('group lifecycle save returns failure through saveChatConditional without editing group metadata', async () => {
    const h = harness([...saveFunctions, [groupScript, 'saveGroupChat']]);
    h.context.selected_group = 'synthetic-group';
    const pending = h.context.saveChatConditional();
    await tick();
    h.popups[0].resolve(0);
    assert.equal(await pending, false);
    assert.equal(h.observations.groupEdits, 0);
    assert.equal(h.observations.cacheWrites, 0);
    assert.equal(h.requests[0].body.force, false);
});

test('successful group save still edits group metadata and returns success', async () => {
    const h = harness([...saveFunctions, [groupScript, 'saveGroupChat']]);
    h.context.selected_group = 'synthetic-group';
    h.setResponse({ ok: true, status: 200, statusText: 'OK', json: async () => ({ result: 'ok' }) });
    assert.equal(await h.context.saveChatConditional(), true);
    assert.equal(h.observations.groupEdits, 1);
    assert.equal(h.observations.cacheWrites, 2);
});

test('actual character saves with the same file name but different avatars have distinct conflict identities', async () => {
    const h = harness(saveFunctions);
    const first = h.context.saveChat({ chatName: 'same-name' });
    await tick();
    h.context.characters[0].avatar = 'second-synthetic.png';
    const second = h.context.saveChat({ chatName: 'same-name' });
    await tick();
    assert.equal(h.popups.length, 1);
    h.popups[0].resolve(0);
    await first;
    await tick();
    assert.equal(h.popups.length, 2);
    h.popups[1].resolve(0);
    await second;
});

test('group bookmark save shares its identity with a save of that same group chat', async () => {
    const h = harness([[groupScript, 'saveGroupChat'], [groupScript, 'saveGroupBookmarkChat']]);
    const first = h.context.saveGroupChat('synthetic-group', false);
    await tick();
    const latest = [{ mes: 'latest synthetic bookmark snapshot', is_user: true }];
    const second = h.context.saveGroupBookmarkChat('synthetic-group', 'retired-group-chat', {}, undefined, latest);
    await tick();
    assert.equal(h.popups.length, 1);
    h.popups[0].resolve(1);
    await Promise.all([first, second]);
    assert.equal(h.downloads.length, 1);
    assert.equal(JSON.parse(h.downloads[0].content.split('\n')[1]).mes, latest[0].mes);
});

test('token-count backfill keeps the tab after a lifecycle failure instead of reloading', async () => {
    const h = harness(saveFunctions);
    const start = script.indexOf('    const doBackfill = async () => {');
    const end = script.indexOf('\n    };', start) + '\n    };'.length;
    assert.notEqual(start, -1);
    h.context.getTokenCountAsync = async () => 1;
    vm.runInContext(`${script.slice(start, end)}\nglobalThis.doBackfill = doBackfill;`, h.context);
    const pending = h.context.doBackfill();
    await tick();
    h.popups[0].resolve(0);
    await pending;
    assert.equal(h.observations.reloads, 0);
    assert.equal(h.context.chat.length, 1);
});
