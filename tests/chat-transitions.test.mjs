import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
const welcomeScript = readFileSync(new URL('../public/scripts/welcome-screen.js', import.meta.url), 'utf8');

// Execute production orchestration; substitute only network, DOM and extension boundaries.
function functionSource(source, name) {
    const start = source.search(new RegExp(`^(?:export )?async function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, `${name} must exist in the application source`);
    const end = source.indexOf('\n}', start);
    assert.notEqual(end, -1);
    return source.slice(start, end + 2).replace(/^export /, '');
}

const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(overrides = {}) {
    const observations = { loads: [], events: [], clears: [], selections: [], persisted: [], active: [], saves: 0, tts: 0, errors: 0, info: 0, unshallowed: [], fields: [] };
    const context = vm.createContext({
        console: { error() {}, debug() {} },
        t: (parts, ...values) => parts.reduce((text, part, i) => text + part + (values[i] ?? ''), ''),
        toastr: { error: () => { observations.errors++; }, info: () => { observations.info++; } },
        characters: [
            { name: 'Prior', avatar: 'prior.png', chat: 'prior-default' },
            { name: 'Target', avatar: 'target.png', chat: 'default' },
            { name: 'Other', avatar: 'other.png', chat: 'other-default' },
        ],
        this_chid: 0, selected_group: null, name2: 'Prior',
        isChatSaving: false, is_group_generating: false, is_send_press: false,
        this_edit_mes_id: 42, selected_button: 'other', chat_metadata: { old: true },
        debounce_timeout: { extended: 1 },
        setCharacterId: id => { context.this_chid = id; },
        setCharacterName: name => { context.name2 = name; },
        resetSelectedGroup: () => { context.selected_group = null; },
        clearChat: async options => { observations.clears.push({ ...options, id: context.this_chid, group: context.selected_group, name: context.name2 }); },
        cancelTtsPlay: () => { observations.tts++; },
        unshallowCharacter: async id => { observations.unshallowed.push(id); },
        select_selected_character: (id, options) => { observations.selections.push({ id, options: options && { ...options } }); },
        getChat: async () => {
            const load = { id: context.this_chid, file: context.characters[context.this_chid].chat };
            observations.loads.push(load);
            observations.events.push(load.file);
            context.chat_metadata = { loaded: load.file };
        },
        waitUntilCondition: async predicate => { assert.equal(predicate(), true); },
        $: selector => ({ val: value => { observations.fields.push({ selector, value }); } }),
        CustomEvent: class { constructor(type) { this.type = type; } },
        createOrEditCharacter: async event => { observations.persisted.push({ id: context.this_chid, file: context.characters[context.this_chid].chat, event: event.type }); },
        getCurrentChatId: () => context.characters[context.this_chid]?.chat,
        setActiveCharacter: avatar => { observations.active.push(avatar); },
        saveSettingsDebounced: () => { observations.saves++; },
        ...overrides,
    });
    const busyDeclaration = welcomeScript.match(/^let recentCharacterChatOpening = false;$/m)?.[0] ?? '';
    vm.runInContext([
        busyDeclaration,
        functionSource(script, 'selectCharacterById'),
        functionSource(script, 'openCharacterChat'),
        functionSource(welcomeScript, 'openRecentCharacterChat'),
    ].join('\n'), context);
    return { context, observations };
}

test('recent character history opens exactly once without loading its default', async () => {
    const h = harness();
    await h.context.openRecentCharacterChat('target.png', 'history');
    assert.deepEqual(h.observations.loads, [{ id: 1, file: 'history' }]);
    assert.deepEqual(h.observations.events, ['history']);
    assert.deepEqual(h.observations.persisted, [{ id: 1, file: 'history', event: 'newChat' }]);
    assert.deepEqual(h.observations.active, ['target.png']);
    assert.equal(h.observations.saves, 1);
});

test('legacy selection retains its void return, default load and reset behavior', async () => {
    const h = harness({ selected_group: 'prior-group' });
    assert.equal(await h.context.selectCharacterById(1, { switchMenu: false }), undefined);
    assert.deepEqual(h.observations.loads, [{ id: 1, file: 'default' }]);
    assert.deepEqual(h.observations.clears, [{ clearData: true, id: undefined, group: null, name: '' }]);
    assert.equal(h.context.this_edit_mes_id, undefined);
    assert.equal(h.context.selected_button, 'character_edit');
    assert.equal(h.observations.tts, 1);
});

for (const switchMenu of [true, false]) {
    test(`legacy same-character selection retains switchMenu=${switchMenu}`, async () => {
        const h = harness({ this_chid: 1 });
        assert.equal(await h.context.selectCharacterById(1, { switchMenu }), undefined);
        assert.deepEqual(h.observations.loads, []);
        assert.deepEqual(h.observations.unshallowed, [1]);
        assert.deepEqual(h.observations.selections, [{ id: 1, options: { switchMenu } }]);
        assert.equal(h.context.selected_button, switchMenu ? 'character_edit' : 'other');
    });
}

test('targeting the default loads once without changing or persisting the filename', async () => {
    const h = harness();
    assert.equal(await h.context.selectCharacterById(1, { chatFile: 'default' }), true);
    assert.deepEqual(h.observations.loads, [{ id: 1, file: 'default' }]);
    assert.deepEqual(h.observations.persisted, []);
    assert.deepEqual(h.context.chat_metadata, { loaded: 'default' });
});

for (const switchMenu of [true, false]) {
    test(`targeting the already open same-character file retains switchMenu=${switchMenu}`, async () => {
        const h = harness({ this_chid: 1 });
        assert.equal(await h.context.selectCharacterById(1, { chatFile: 'default', switchMenu }), true);
        assert.deepEqual(h.observations.loads, []);
        assert.deepEqual(h.observations.selections, [{ id: 1, options: { switchMenu } }]);
        assert.equal(h.context.selected_button, switchMenu ? 'character_edit' : 'other');
    });
}

test('same-character history runs normal loading, form selection and newChat persistence', async () => {
    const h = harness({ this_chid: 1 });
    assert.equal(await h.context.selectCharacterById(1, { chatFile: 'history' }), true);
    assert.deepEqual(h.observations.loads, [{ id: 1, file: 'history' }]);
    assert.deepEqual(h.observations.fields, [{ selector: '#selected_chat_pole', value: 'history' }]);
    assert.deepEqual(h.observations.persisted, [{ id: 1, file: 'history', event: 'newChat' }]);
});

for (const refreshedFile of ['history', 'refreshed-default']) {
    test(`shallow card replacement is refreshed before comparing target with ${refreshedFile}`, async () => {
        const h = harness();
        h.context.unshallowCharacter = async id => {
            assert.equal(h.context.this_chid, id);
            assert.deepEqual(Object.keys(h.context.chat_metadata), []);
            h.observations.unshallowed.push(id);
            h.context.characters[id] = { name: 'Refreshed', avatar: 'target.png', chat: refreshedFile };
        };
        assert.equal(await h.context.selectCharacterById(1, { chatFile: 'history' }), true);
        assert.deepEqual(h.observations.loads, [{ id: 1, file: 'history' }]);
        assert.equal(h.observations.persisted.length, refreshedFile === 'history' ? 0 : 1);
    });
}

for (const chatFile of [undefined, null, 0, {}, '', '   ']) {
    test(`explicit invalid chatFile ${JSON.stringify(chatFile)} refuses without changing selection`, async () => {
        const h = harness();
        assert.equal(await h.context.selectCharacterById(1, { chatFile }), false);
        assert.equal(h.context.this_chid, 0);
        assert.deepEqual(h.observations.loads, []);
        assert.deepEqual(h.observations.clears, []);
    });
}

test('invalid character ID and missing avatar never load or save active settings', async () => {
    const h = harness();
    assert.equal(await h.context.selectCharacterById(-1, { chatFile: 'history' }), false);
    assert.equal(await h.context.selectCharacterById(-1), undefined);
    await h.context.openRecentCharacterChat('missing.png', 'history');
    assert.deepEqual(h.observations.loads, []);
    assert.deepEqual(h.observations.active, []);
    assert.equal(h.observations.saves, 0);
});

for (const guard of [
    { isChatSaving: true },
    { selected_group: 'busy-group', is_group_generating: true },
    { is_send_press: true },
]) {
    test(`targeted selection respects guard ${JSON.stringify(guard)} including current character`, async () => {
        const h = harness({ ...guard, this_chid: 1 });
        assert.equal(await h.context.selectCharacterById(1, { chatFile: 'history' }), false);
        await h.context.openRecentCharacterChat('target.png', 'history');
        assert.deepEqual(h.observations.loads, []);
        assert.deepEqual(h.observations.clears, []);
        assert.deepEqual(h.observations.active, []);
        assert.equal(h.observations.saves, 0);
    });
}

test('targeted group-to-character navigation resets prior state and loads only the target', async () => {
    const h = harness({ selected_group: 'prior-group' });
    assert.equal(await h.context.selectCharacterById(1, { chatFile: 'history' }), true);
    assert.deepEqual(h.observations.clears[0], { clearData: true, id: undefined, group: null, name: '' });
    assert.equal(h.context.selected_group, null);
    assert.equal(h.context.this_chid, 1);
    assert.equal(h.context.this_edit_mes_id, undefined);
    assert.equal(h.observations.tts, 1);
    assert.deepEqual(h.observations.loads, [{ id: 1, file: 'history' }]);
});

for (const nextSelection of [{ this_chid: 2 }, { this_chid: undefined, selected_group: 'new-group' }]) {
    for (const boundary of ['clearChat', 'unshallowCharacter']) {
        test(`stale ${boundary} prep refuses after navigation to ${JSON.stringify(nextSelection)}`, async () => {
            const h = harness();
            h.context[boundary] = async () => { Object.assign(h.context, nextSelection); };
            assert.equal(await h.context.selectCharacterById(1, { chatFile: 'history' }), false);
            assert.deepEqual(h.observations.loads, []);
            assert.deepEqual(h.observations.persisted, []);
            assert.equal(h.context.characters[2].chat, 'other-default');
        });
    }
}

test('overlapping recent clicks are ignored and a later click can open normally', async () => {
    const h = harness();
    let release;
    h.context.unshallowCharacter = () => new Promise(resolve => { release = resolve; });
    const first = h.context.openRecentCharacterChat('target.png', 'history');
    await tick();
    await h.context.openRecentCharacterChat('other.png', 'other-history');
    assert.equal(h.context.this_chid, 1);
    release();
    await first;
    h.context.unshallowCharacter = async () => {};
    await h.context.openRecentCharacterChat('other.png', 'other-history');
    assert.deepEqual(h.observations.loads, [{ id: 1, file: 'history' }, { id: 2, file: 'other-history' }]);
    assert.deepEqual(h.observations.active, ['target.png', 'other.png']);
});

test('recent busy state releases on failure and preserves error toast before retry', async () => {
    const h = harness();
    h.context.unshallowCharacter = async () => { throw new Error('synthetic refresh failure'); };
    await h.context.openRecentCharacterChat('target.png', 'history');
    assert.equal(h.observations.errors, 1);
    assert.deepEqual(h.observations.active, []);
    h.context.unshallowCharacter = async () => {};
    await h.context.openRecentCharacterChat('target.png', 'history');
    assert.deepEqual(h.observations.loads, [{ id: 1, file: 'history' }]);
    assert.deepEqual(h.observations.active, ['target.png']);
});

test('recent busy state releases after refused selection', async () => {
    const h = harness({ isChatSaving: true });
    await h.context.openRecentCharacterChat('target.png', 'history');
    h.context.isChatSaving = false;
    await h.context.openRecentCharacterChat('target.png', 'history');
    assert.deepEqual(h.observations.loads, [{ id: 1, file: 'history' }]);
    assert.equal(h.observations.saves, 1);
});

for (const boundary of ['waitUntilCondition', 'clearChat', 'getChat']) {
    test(`history transition refuses stale identity during openCharacterChat ${boundary}`, async () => {
        const h = harness({ this_chid: 1 });
        const original = h.context[boundary];
        h.context[boundary] = async (...args) => {
            await original(...args);
            h.context.this_chid = 2;
        };
        assert.equal(await h.context.selectCharacterById(1, { chatFile: 'history' }), false);
        assert.equal(h.context.characters[2].chat, 'other-default');
        assert.deepEqual(h.observations.persisted, []);
        assert.deepEqual(h.observations.fields, []);
        assert.deepEqual(h.observations.loads, boundary === 'getChat' ? [{ id: 1, file: 'history' }] : []);
    });
}

test('card identity changing at the same index during refresh refuses the target', async () => {
    const h = harness();
    h.context.unshallowCharacter = async id => { h.context.characters[id] = { name: 'Replacement', avatar: 'replacement.png', chat: 'replacement-default' }; };
    assert.equal(await h.context.selectCharacterById(1, { chatFile: 'history' }), false);
    assert.deepEqual(h.observations.loads, []);
    assert.deepEqual(h.observations.persisted, []);
});

test('ordinary openCharacterChat keeps its legacy void return and persistence', async () => {
    const h = harness({ this_chid: 1 });
    assert.equal(await h.context.openCharacterChat('history'), undefined);
    assert.deepEqual(h.observations.loads, [{ id: 1, file: 'history' }]);
    assert.deepEqual(h.observations.persisted, [{ id: 1, file: 'history', event: 'newChat' }]);
});
