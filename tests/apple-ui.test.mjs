import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('Apple Dark and Apple Light themes are valid JSON and registered in default content index', () => {
    const index = JSON.parse(read('../default/content/index.json'));
    const names = new Set(index.map(item => item.filename));
    assert.equal(names.has('themes/Apple Dark.json'), true);
    assert.equal(names.has('themes/Apple Light.json'), true);

    const dark = JSON.parse(read('../default/content/themes/Apple Dark.json'));
    const light = JSON.parse(read('../default/content/themes/Apple Light.json'));
    assert.equal(dark.name, 'Apple Dark');
    assert.equal(light.name, 'Apple Light');

    const settings = JSON.parse(read('../default/content/settings.json'));
    assert.equal(settings.power_user.theme, 'Apple Dark');
    assert.equal(settings.power_user.fast_ui_mode, false);
});

test('index.html loads the global Apple UI stylesheet and appearance controller', () => {
    const html = read('../public/index.html');
    assert.match(html, /href="css\/apple-ui\.css"/);
    assert.match(html, /src="scripts\/apple-ui\.js"/);
});

test('apple-ui.css enforces GPU-only drawer springs, compositor-friendly #sheld, checkbox guards, no-blur, and reduced motion', () => {
    const css = read('../public/css/apple-ui.css');
    assert.equal(css.includes('html[data-apple-appearance="dark"]'), true);
    assert.equal(css.includes('html[data-apple-appearance="light"]'), true);
    assert.equal(css.includes(':not(.del_checkbox):not(#rm_button_panel_pin):not(#lm_button_panel_pin):not(#WI_panel_pin)'), true);
    assert.equal(css.includes('transition-property: opacity, transform, display;'), true);
    assert.equal(css.includes('@keyframes apple-popup-in'), true);
    assert.equal(css.includes('#apple_scroll_bottom'), true);
    assert.equal(css.includes('body.no-blur #top-bar'), true);
    assert.equal(css.includes('@media (prefers-reduced-motion: reduce)'), true);
    assert.match(css, /#sheld\s*\{[^}]*backdrop-filter:\s*none/);
});

test('script.js switches unpinned top drawers without artificial delay and bounds inline-drawer duration', () => {
    const script = read('../public/script.js');
    const navStart = script.indexOf('export async function doNavbarIconClick()');
    const navEnd = script.indexOf('\n}', navStart);
    assert.ok(navStart >= 0 && navEnd > navStart);
    const navBody = script.slice(navStart, navEnd);
    assert.equal(navBody.includes('await delay(animation_duration)'), false);
    assert.equal(script.includes('Math.min(animation_duration, 110)'), true);
});

test('applyAppleAppearance toggles dark/light dataset, transient cross-fade flag, theme-color meta, toggle button, and localStorage', async t => {
    const stored = new Map();
    const attrs = new Map();
    const icon = { className: '' };
    const toggleBtn = {
        attrs: new Map(),
        setAttribute(name, value) { this.attrs.set(name, value); },
        querySelector(sel) { return sel === 'i' ? icon : null; },
    };
    const meta = {
        setAttribute(name, value) { attrs.set(name, value); },
    };
    const prevDoc = globalThis.document;
    const prevStorage = globalThis.localStorage;

    globalThis.localStorage = {
        getItem: key => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, String(value)),
    };
    globalThis.document = {
        readyState: 'complete',
        documentElement: { dataset: {} },
        body: { classList: { contains: () => false } },
        querySelector: sel => sel === 'meta[name="theme-color"]' ? meta : null,
        getElementById: id => id === 'apple_appearance_toggle' ? toggleBtn : null,
    };
    t.after(() => {
        if (prevDoc === undefined) delete globalThis.document;
        else globalThis.document = prevDoc;
        if (prevStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = prevStorage;
    });

    const { applyAppleAppearance } = await import('../public/scripts/apple-ui.js');
    assert.equal(applyAppleAppearance('light'), 'light');
    assert.equal(globalThis.document.documentElement.dataset.appleAppearance, 'light');
    assert.equal(attrs.get('content'), '#f2f2f7');
    assert.equal(stored.get('st_apple_appearance'), 'light');
    assert.equal(toggleBtn.attrs.get('aria-pressed'), 'true');
    assert.equal(icon.className, 'fa-solid fa-moon');

    assert.equal(applyAppleAppearance('dark', { animate: true }), 'dark');
    assert.equal(globalThis.document.documentElement.dataset.appleAppearance, 'dark');
    assert.equal(globalThis.document.documentElement.dataset.appleTransitioning, 'true');
    assert.equal(attrs.get('content'), '#070b14');
    assert.equal(stored.get('st_apple_appearance'), 'dark');
    assert.equal(toggleBtn.attrs.get('aria-pressed'), 'false');
    assert.equal(icon.className, 'fa-solid fa-sun');

    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(globalThis.document.documentElement.dataset.appleTransitioning, undefined);
});

test('scrollChatToLatest performs bounded cubic glide and respects instant / reduced-motion jumps', async t => {
    const prevDoc = globalThis.document;
    const prevRaf = globalThis.requestAnimationFrame;
    const prevCancel = globalThis.cancelAnimationFrame;
    const prevPerf = globalThis.performance;

    let now = 1000;
    const frames = [];
    globalThis.performance = { now: () => now };
    globalThis.requestAnimationFrame = cb => { frames.push(cb); return frames.length; };
    globalThis.cancelAnimationFrame = () => { frames.length = 0; };
    globalThis.document = {
        readyState: 'complete',
        documentElement: { dataset: {} },
        body: { classList: { contains: () => false } },
        querySelector: () => null,
        getElementById: () => null,
    };

    t.after(() => {
        if (prevDoc === undefined) delete globalThis.document;
        else globalThis.document = prevDoc;
        globalThis.requestAnimationFrame = prevRaf;
        globalThis.cancelAnimationFrame = prevCancel;
        globalThis.performance = prevPerf;
    });

    const { scrollChatToLatest } = await import('../public/scripts/apple-ui.js');
    const chat = { scrollTop: 0, scrollHeight: 20000, clientHeight: 500 };
    scrollChatToLatest(chat);
    // Bounded jump immediately places scrollTop within ~2.2 viewports of bottom before gliding
    assert.equal(chat.scrollTop >= 20000 - 500 - 1100, true);
    assert.equal(frames.length, 1);

    now = 1090;
    frames.shift()(now);
    assert.equal(chat.scrollTop > 18400 && chat.scrollTop < 19500, true);

    now = 1200;
    frames.shift()(now);
    assert.equal(chat.scrollTop, 20000);
});

test('handleAppleKeydown closes unpinned drawers on Escape, skips modal/editor states, and focuses composer on /', async t => {
    const prevDoc = globalThis.document;
    const prevGetComputedStyle = globalThis.getComputedStyle;

    let drawerClicked = 0;
    let textareaFocused = 0;
    let openDialog = null;
    let openUnpinnedDrawer = {
        parentElement: {
            querySelector: sel => sel === '.drawer-toggle' ? { click: () => { drawerClicked++; } } : null,
        },
        classList: { contains: () => true, remove() {}, add() {} },
    };
    const body = {};
    const textarea = {
        disabled: false,
        hidden: false,
        value: '',
        offsetParent: body,
        focus() { textareaFocused++; },
        dispatchEvent() {},
    };

    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1', position: 'static' });
    globalThis.document = {
        readyState: 'complete',
        documentElement: { dataset: {} },
        body,
        querySelector: sel => {
            if (sel.includes('dialog[open]')) return openDialog;
            if (sel === '.drawer-content.openDrawer:not(.pinnedOpen)') return openUnpinnedDrawer;
            return null;
        },
        querySelectorAll: () => [],
        getElementById: id => id === 'send_textarea' ? textarea : null,
    };

    t.after(() => {
        if (prevDoc === undefined) delete globalThis.document;
        else globalThis.document = prevDoc;
        globalThis.getComputedStyle = prevGetComputedStyle;
    });

    const { handleAppleKeydown } = await import('../public/scripts/apple-ui.js');

    // When a native modal is open, Escape is left untouched for Popup
    openDialog = {};
    assert.equal(handleAppleKeydown({ key: 'Escape', preventDefault() {} }), false);
    assert.equal(drawerClicked, 0);

    // When no modal is open, Escape closes the active unpinned drawer
    openDialog = null;
    let prevented = 0;
    assert.equal(handleAppleKeydown({ key: 'Escape', preventDefault() { prevented++; } }), true);
    assert.equal(drawerClicked, 1);
    assert.equal(prevented, 1);

    // Bare '/' on document.body focuses #send_textarea and seeds '/' when no drawer is open
    openUnpinnedDrawer = null;
    assert.equal(handleAppleKeydown({ key: '/', target: body, preventDefault() { prevented++; } }), true);
    assert.equal(textareaFocused, 1);
    assert.equal(textarea.value, '/');
});

test('registerDismissLayer orders custom overlays by priority, supports declarative [data-apple-dismiss], and unregisters cleanly', async t => {
    const prevDoc = globalThis.document;
    const prevGetComputedStyle = globalThis.getComputedStyle;

    const events = [];
    let declarativeEl = null;
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1', position: 'fixed' });
    globalThis.document = {
        readyState: 'complete',
        documentElement: { dataset: {} },
        body: {},
        querySelector: () => null,
        querySelectorAll: sel => {
            if (sel === '[data-apple-dismiss]' && declarativeEl && !declarativeEl.hidden) return [declarativeEl];
            return [];
        },
        getElementById: () => null,
    };

    t.after(() => {
        if (prevDoc === undefined) delete globalThis.document;
        else globalThis.document = prevDoc;
        globalThis.getComputedStyle = prevGetComputedStyle;
    });

    const { registerDismissLayer, handleAppleKeydown } = await import('../public/scripts/apple-ui.js');
    let lowOpen = true;
    let highOpen = true;
    const disposeLow = registerDismissLayer({
        id: 'test-low',
        priority: 50,
        isActive: () => lowOpen,
        dismiss: () => { lowOpen = false; events.push('low'); return true; },
    });
    const disposeHigh = registerDismissLayer({
        id: 'test-high',
        priority: 85,
        isActive: () => highOpen,
        dismiss: () => { highOpen = false; events.push('high'); return true; },
    });

    try {
        // High-priority layer wins first Escape
        assert.equal(handleAppleKeydown({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} }), true);
        assert.deepEqual(events, ['high']);
        assert.equal(lowOpen, true);

        // Declarative [data-apple-dismiss] (priority 75) beats priority 50
        declarativeEl = { hidden: false, getAttribute: () => 'self' };
        assert.equal(handleAppleKeydown({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} }), true);
        assert.equal(declarativeEl.hidden, true);
        assert.equal(lowOpen, true);

        // Next Escape reaches priority 50
        assert.equal(handleAppleKeydown({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} }), true);
        assert.deepEqual(events, ['high', 'low']);
    } finally {
        disposeLow();
        disposeHigh();
    }
});

test('standalone Exit Chat button stays hidden on welcome screen, shows in active chat, and invokes native close-chat', async () => {
    const { hasActiveChat, syncExitChatButton, exitCurrentChat } = await import('../public/scripts/apple-ui.js');
    const drawer = { hidden: true };
    const exitBtn = { disabled: false };
    let welcomePresent = true;
    let hasMes = false;
    let closedNative = 0;
    let closedDrawer = 0;

    const fakeDoc = {
        getElementById: id => {
            if (id === 'apple_exit_chat_drawer') return drawer;
            if (id === 'apple_exit_chat_btn') return exitBtn;
            if (id === 'chat') {
                return {
                    querySelector: sel => {
                        if (sel === '.welcomePanel') return welcomePresent ? {} : null;
                        if (sel === '.mes') return hasMes ? {} : null;
                        return null;
                    },
                };
            }
            return null;
        },
        querySelector: sel => {
            if (sel === '.drawer-content.openDrawer:not(.pinnedOpen)') {
                return { parentElement: { querySelector: () => ({ click: () => { closedDrawer++; } }) } };
            }
            if (sel === '#options #option_close_chat:not(.displayNone)') {
                return { click: () => { closedNative++; } };
            }
            return null;
        },
    };

    assert.equal(hasActiveChat(fakeDoc), false);
    assert.equal(syncExitChatButton(fakeDoc), false);
    assert.equal(drawer.hidden, true);

    welcomePresent = false;
    hasMes = true;
    assert.equal(hasActiveChat(fakeDoc), true);
    assert.equal(syncExitChatButton(fakeDoc), true);
    assert.equal(drawer.hidden, false);

    assert.equal(await exitCurrentChat(fakeDoc), true);
    assert.equal(closedDrawer, 1);
    assert.equal(closedNative, 1);
});
