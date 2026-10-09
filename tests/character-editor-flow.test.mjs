import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(process.env.CHARACTER_EDITOR_SOURCE ?? new URL('../public/script.js', import.meta.url), 'utf8');
// An external, byte-verified .bak can be supplied by the isolated acceptance run.
// The immutable ancestor makes the same comparison reproducible in a checkout.
const baseline = process.env.CHARACTER_EDITOR_BASELINE
    ? readFileSync(process.env.CHARACTER_EDITOR_BASELINE, 'utf8')
    : execFileSync('git', ['show', 'cfeca4bf431403a5e0204a8e2f8150ac8dc83759:public/script.js'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const worldSource = readFileSync(new URL('../public/scripts/world-info.js', import.meta.url), 'utf8');
const chatSource = readFileSync(new URL('../public/scripts/chats.js', import.meta.url), 'utf8');
function fn(text, name) {
    const start = text.search(new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, `actual function ${name} exists`);
    const end = text.indexOf('\n}', start);
    assert.notEqual(end, -1, `${name} has a top-level closing brace`);
    return text.slice(start, end + 2).replace(/^export /, '');
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const draft = () => ({
    name: 'Draft name', description: 'Draft description', world: 'Draft world', creator_notes: 'Draft notes',
    post_history_instructions: 'Draft post', system_prompt: 'Draft system', tags: 'Draft tags', creator: 'Draft creator',
    character_version: 'Draft version', personality: 'Draft personality', first_message: 'Draft greeting', talkativeness: 0.7,
    scenario: 'Draft scenario', depth_prompt_prompt: 'Draft depth', depth_prompt_depth: 9, depth_prompt_role: 'user', mes_example: 'Draft examples',
});
const character = () => ({
    name: 'Selected name', description: 'Selected description', avatar: 'selected.png', creatorcomment: 'Legacy notes',
    personality: 'Selected personality', first_mes: 'Selected greeting', scenario: 'Selected scenario', talkativeness: 0.4,
    mes_example: 'Selected examples', chat: 'Selected history', create_date: '2026-01-02', json_data: '{"synthetic":true}', fav: true,
    data: { creator_notes: 'Selected notes', character_version: 'Selected version', system_prompt: 'Selected system',
        post_history_instructions: 'Selected post', tags: ['one', 'two'], creator: 'Selected creator', character_book: { entries: [] },
        extensions: { world: 'Selected world', depth_prompt: { prompt: 'Selected depth', depth: 3, role: 'assistant' }, source_url: 'https://example.invalid/synthetic' } },
});

function harness(text = source, options = {}) {
    const elements = new Map();
    const seen = { writes: [], helpers: [], formatting: [], timeline: [], avatarSaves: 0, fetches: [], notices: [], menus: [] };
    const avatarGate = deferred();
    function element(key) {
        if (!elements.has(key)) elements.set(key, { id: key.replace(/^#/, ''), value: `initial:${key}`, text: `initial:${key}`, html: `initial:${key}`,
            attrs: {}, props: {}, data: {}, dataset: {}, classes: new Set(), display: 'inline-block', previousDisplay: 'inline-block', opacity: 1, files: undefined });
        return elements.get(key);
    }
    // Seed both programs' selectors so untouched residuals also participate in snapshots.
    const selectorSource = [
        ...[source, baseline].flatMap(text => ['select_selected_character', 'select_rm_create', 'updateFavButtonState', 'selectRightMenuWithAnimation'].map(name => fn(text, name))),
        ...['setWorldInfoButtonClass', 'checkEmbeddedWorld'].map(name => fn(worldSource, name)),
    ].join('\n');
    for (const match of selectorSource.matchAll(/\$\('([^']+)'\)/g)) {
        for (const key of match[1].split(/,\s*/)) element(key);
    }
    element('#right-nav-panel'); element('#rm_button_selected_ch > h2');
    const menus = ['rm_ch_create_block', 'rm_characters_block', 'rm_group_chats_block'].map(id => element(`#${id}`));
    for (const [key, patch] of Object.entries(options.initial ?? {})) Object.assign(element(key), patch);
    function $(selector) {
        const nodes = typeof selector === 'string' ? selector.split(/,\s*/).map(element) : [selector];
        const write = (operation, value) => { for (const node of nodes) seen.writes.push({ key: node.id, operation, value }); };
        const api = {
            get: index => nodes[index],
            val(value) { if (!arguments.length) return nodes[0].value; write('val', value); for (const node of nodes) { node.value = value == null ? '' : String(value); if (node.id === 'add_avatar_button' && value === '') node.files = undefined; } return api; },
            text(value) { write('text', value); nodes.forEach(node => { node.text = value; }); return api; },
            html(value) { write('html', value); nodes.forEach(node => { node.html = value; }); return api; },
            attr(key, value) { if (value === undefined) return nodes[0].attrs[key]; write(`attr:${key}`, value); nodes.forEach(node => { if (value === null) delete node.attrs[key]; else node.attrs[key] = value; }); return api; },
            prop(key, value) { if (value === undefined) return nodes[0].props[key]; write(`prop:${key}`, value); nodes.forEach(node => { node.props[key] = value; }); return api; },
            data(key, value) { if (value === undefined) return nodes[0].data[key]; write(`data:${key}`, value); nodes.forEach(node => { node.data[key] = value; }); return api; },
            css(key, value) { write(`css:${key}`, value); nodes.forEach(node => { node[key] = value; }); return api; },
            hide() { write('hide'); nodes.forEach(node => { if (node.display !== 'none') node.previousDisplay = node.display || 'inline-block'; node.display = 'none'; }); return api; },
            show() { write('show'); nodes.forEach(node => { if (node.display === 'none') node.display = node.previousDisplay; }); return api; },
            toggle(value) { write('toggle', value); nodes.forEach(node => { if (!value) { if (node.display !== 'none') node.previousDisplay = node.display || 'inline-block'; node.display = 'none'; } else if (node.display === 'none') node.display = node.previousDisplay; }); return api; },
            addClass(name) { nodes.forEach(node => node.classes.add(name)); return api; },
            removeClass(name) { nodes.forEach(node => node.classes.delete(name)); return api; },
            toggleClass(name, value) { nodes.forEach(node => value ? node.classes.add(name) : node.classes.delete(name)); return api; },
            children: name => $(`${selector} > ${name}`),
            transition(config) { nodes.forEach(node => { node.opacity = config.opacity; }); return api; },
        };
        return api;
    }
    const account = new Map();
    const c = vm.createContext({
        $, characters: [options.character ?? character()], create_save: options.draft ?? draft(), this_chid: 0,
        selected_button: options.selectedButton ?? 'characters', menu_type: options.menuType ?? 'characters', selected_group: options.group ?? null,
        depth_prompt_depth_default: 4, depth_prompt_role_default: 'system', talkativeness_default: 0.5, default_avatar: '/default.png',
        world_names: ['Selected world'], power_user: { never_resize_avatars: true, world_import_dialog: false, forbid_external_media: options.forbidMedia ?? false,
            external_media_allowed_overrides: options.allowed ?? [], external_media_forbidden_overrides: options.forbidden ?? [] },
        document: { getElementById: id => element(`#${id}`), querySelectorAll: selector => selector === '#right-nav-panel .right_menu' ? menus : [] },
        animation_duration: 0, animation_easing: 'linear',
        timestampToMoment: date => ({ toISOString: () => `ISO:${date}` }),
        accountStorage: { getItem: key => account.get(key), setItem: (key, value) => account.set(key, value) },
        toastr: { info: (...args) => seen.notices.push(args) },
        StylesPreference: class { constructor(avatar) { this.avatar = avatar; } get() { return this.avatar === 'selected.png'; } },
        substituteParams: text => text ?? '', converter: { makeHtml: text => { seen.formatting.push(text); return `<p>${text}</p><script>unsafe</script>`; } },
        encodeStyleTags: value => value, decodeStyleTags: (value, params) => `${params.prefix}${value}`,
        DOMPurify: { sanitize: html => html.replace(/<script>.*?<\/script>/g, '') },
        event_types: { CHARACTER_EDITOR_OPENED: 'CHARACTER_EDITOR_OPENED' },
        eventSource: { emit: (type, chid) => seen.timeline.push({ type, chid, snapshot: snapshot() }) },
        saveSettingsDebounced: () => seen.timeline.push({ type: 'saveSettings' }),
        getBase64Async: async () => { await avatarGate.promise; return 'data:synthetic-avatar'; },
        createOrEditCharacter: async () => { seen.avatarSaves++; },
        FormData: class { get() { return 'selected.png'; } },
        fetch: async (url, config) => { seen.fetches.push({ url, config: { ...config } }); },
        console: { log() {}, debug() {} },
        Popup: class { constructor() { this.cropData = 'synthetic-crop'; } async show() { return options.cropResult ?? false; } }, POPUP_TYPE: { CROP: 'crop' },
    });
    const scriptFns = ['select_selected_character', 'select_rm_create', 'setMenuType', 'selectRightMenuWithAnimation', 'updateFavButtonState', 'getCharacterSource', 'getThumbnailUrl', 'read_avatar_load'];
    vm.runInContext([
        ...scriptFns.map(name => fn(text, name)),
        ...['setWorldInfoButtonClass', 'checkEmbeddedWorld'].map(name => fn(worldSource, name)),
        ...['formatCreatorNotes', 'getCurrentEntityId', 'isExternalMediaAllowed'].map(name => fn(chatSource, name)),
    ].join('\n'), c);
    for (const name of ['updateFavButtonState', 'setWorldInfoButtonClass', 'checkEmbeddedWorld']) {
        const original = c[name]; c[name] = (...args) => { seen.helpers.push({ name, args }); return original(...args); };
    }
    const menu = c.setMenuType; c.setMenuType = value => { seen.menus.push(value); menu(value); };
    function snapshot() {
        return { menu: c.menu_type, favorite: c.fav_ch_checked,
            elements: Object.fromEntries([...elements].map(([key, node]) => [key, {
                value: node.value, text: node.text, html: node.html, attrs: { ...node.attrs }, props: { ...node.props }, data: { ...node.data },
                dataset: { ...node.dataset }, classes: [...node.classes].sort(), display: node.display, opacity: node.opacity,
            }])) };
    }
    return { c, seen, snapshot, element, avatarGate, account };
}

for (const selectedButton of ['characters', 'create']) {
    test(`selection from ${selectedButton} formats only selected notes`, () => {
        const h = harness(source, { selectedButton }); h.c.select_selected_character(0);
        assert.deepEqual(h.seen.formatting, ['Selected notes']);
        assert.doesNotMatch(h.element('#creator_notes_spoiler').html, /unsafe|script/);
    });
    test(`selection from ${selectedButton} never writes draft field values`, () => {
        const h = harness(source, { selectedButton }); h.c.select_selected_character(0);
        const draftValues = new Set(Object.values(h.c.create_save));
        assert.deepEqual(h.seen.writes.filter(row => row.operation === 'val' && draftValues.has(row.value)), []);
        for (const id of ['character_name_pole', 'description_textarea', 'character_version_textarea', 'character_world']) {
            assert.equal(h.seen.writes.filter(row => row.key === id && row.operation === 'val').length, 1, id);
        }
    });
}
test('selected world, embedded-world and favorite helpers run once with selected arguments', () => {
    const h = harness(); h.c.select_selected_character(0);
    assert.deepEqual(h.seen.helpers, [
        { name: 'updateFavButtonState', args: [true] }, { name: 'setWorldInfoButtonClass', args: [0] }, { name: 'checkEmbeddedWorld', args: [0] },
    ]);
});
test('selected chrome does not hide controls immediately before showing them', () => {
    const h = harness(); h.c.select_selected_character(0);
    for (const id of ['delete_button', 'export_button', 'dupe_button', 'char_connections_button', 'set_chat_character_settings', 'character_open_media_overrides']) {
        assert.equal(h.seen.writes.filter(row => row.key === id && ['hide', 'show', 'toggle', 'css:display'].includes(row.operation)).length, 1, id);
    }
});

const scenarios = [
    ['ordinary', {}], ['draft entry', { selectedButton: 'create' }], ['group peek', { group: 'synthetic-group', menuType: 'group_edit' }],
    ['no menu switch', { menuType: 'group_edit', switchMenu: false }], ['group without menu switch', { group: 'synthetic-group', menuType: 'group_edit', switchMenu: false }],
    ['legacy optional fields', { character: { ...character(), data: undefined, fav: false, avatar: 'none', talkativeness: 0 } }],
    ['empty optional fields', { character: { ...character(), data: { tags: 'not-an-array', extensions: { depth_prompt: { prompt: '', depth: 0, role: '' }, world: 'missing-world' } }, fav: 'true' } }],
    ['media globally forbidden', { forbidMedia: true }], ['media allowed override', { forbidMedia: true, allowed: ['selected.png'] }],
    ['media forbidden override', { forbidden: ['selected.png'] }], ['group media override', { group: 'synthetic-group', forbidMedia: true, allowed: ['synthetic-group'] }],
    ['residual controls', { initial: { '#delete_button_div': { display: 'flex' }, '#character_import_button': { display: 'none' }, '#avatar_div': { display: 'none' } } }],
];
for (const [name, options] of scenarios) {
    test(`final editor state and terminal ordering match independent base: ${name}`, () => {
        const current = harness(source, options); const original = harness(baseline, options);
        const draftBefore = JSON.stringify(current.c.create_save); const selectedBefore = JSON.stringify(current.c.characters);
        assert.equal(current.c.select_selected_character(0, { switchMenu: options.switchMenu ?? true }), undefined);
        original.c.select_selected_character(0, { switchMenu: options.switchMenu ?? true });
        assert.deepEqual(current.snapshot(), original.snapshot());
        assert.deepEqual(current.seen.timeline, original.seen.timeline);
        assert.deepEqual(current.seen.menus, original.seen.menus);
        assert.deepEqual(current.seen.menus, options.switchMenu === false ? [] : ['create', 'character_edit']);
        assert.deepEqual(current.seen.timeline.map(row => [row.type, row.chid]), [['CHARACTER_EDITOR_OPENED', 0], ['saveSettings', undefined]]);
        assert.deepEqual(current.seen.timeline[0].snapshot, current.snapshot());
        assert.equal(JSON.stringify(current.c.create_save), draftBefore); assert.equal(JSON.stringify(current.c.characters), selectedBefore);
        if (options.group) assert.equal(current.element('#rm_button_selected_ch > h2').text, 'initial:#rm_button_selected_ch > h2');
    });
}
for (const switchMenu of [true, false]) {
    test(`default create restoration remains identical to base (switchMenu=${switchMenu})`, () => {
        const options = { menuType: 'character_edit' }; const current = harness(source, options); const original = harness(baseline, options);
        current.c.select_rm_create({ switchMenu }); original.c.select_rm_create({ switchMenu });
        assert.deepEqual(current.snapshot(), original.snapshot()); assert.deepEqual(current.seen, original.seen);
        assert.deepEqual(current.seen.formatting, ['Draft notes']);
    });
}
test('opening an existing character then returning to create restores the unchanged draft', () => {
    const current = harness(); const original = harness(baseline); const draftBefore = JSON.stringify(current.c.create_save);
    for (const h of [current, original]) { h.c.select_selected_character(0); h.c.selected_button = 'create'; h.c.select_rm_create(); }
    assert.deepEqual(current.snapshot(), original.snapshot()); assert.equal(JSON.stringify(current.c.create_save), draftBefore);
    assert.equal(current.element('#character_name_pole').value, 'Draft name');
});
for (const selected of [false, true]) {
    test(`legacy draft FileList restoration and asynchronous avatar path match base (${selected ? 'selected' : 'create'})`, async () => {
        const files = { 0: { name: 'synthetic.png' }, length: 1 }; const originalFiles = JSON.stringify(files);
        const options = { selectedButton: 'create', draft: { ...draft(), avatar: files } };
        const current = harness(source, options); const original = harness(baseline, { ...options, draft: { ...draft(), avatar: files } });
        for (const h of [current, original]) {
            if (selected) h.c.select_selected_character(0); else h.c.select_rm_create();
            assert.equal(h.c.create_save.avatar, files);
            assert.equal(h.element('#add_avatar_button').files, selected ? undefined : files);
            h.avatarGate.resolve();
        }
        await tick();
        assert.deepEqual(current.snapshot(), original.snapshot());
        assert.equal(current.seen.avatarSaves, selected ? 1 : 0);
        assert.deepEqual(current.seen.fetches, original.seen.fetches);
        assert.equal(current.element('#avatar_load_preview').attrs.src, 'data:synthetic-avatar');
        assert.equal(JSON.stringify(files), originalFiles);
    });
}
test('an avatar draft is not restored when the previous selected button is not create', async () => {
    const files = { 0: { name: 'synthetic.png' }, length: 1 }; const h = harness(source, { draft: { ...draft(), avatar: files } });
    h.c.select_selected_character(0); h.avatarGate.resolve(); await tick();
    assert.equal(h.seen.avatarSaves, 0); assert.equal(h.element('#avatar_load_preview').attrs.src, '/thumbnail?type=avatar&file=selected.png');
    assert.equal(h.c.create_save.avatar, files);
});
for (const cropResult of [false, 'data:synthetic-crop']) {
    test(`legacy selected draft-avatar crop outcome remains identical (${cropResult ? 'accepted' : 'cancelled'})`, async () => {
        const files = { 0: { name: 'synthetic.png' }, length: 1 };
        const options = { selectedButton: 'create', draft: { ...draft(), avatar: files }, cropResult };
        const current = harness(source, options); const original = harness(baseline, { ...options, draft: { ...draft(), avatar: files } });
        for (const h of [current, original]) { h.c.power_user.never_resize_avatars = false; h.c.select_selected_character(0); h.avatarGate.resolve(); }
        await tick();
        assert.deepEqual(current.snapshot(), original.snapshot()); assert.deepEqual(current.seen.fetches, original.seen.fetches);
        assert.equal(current.seen.avatarSaves, cropResult ? 1 : 0); assert.equal(current.c.crop_data, original.c.crop_data);
        assert.equal(current.c.create_save.avatar, files);
    });
}
