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
});

test('index.html loads the global Apple UI stylesheet and appearance controller', () => {
    const html = read('../public/index.html');
    assert.match(html, /href="css\/apple-ui\.css"/);
    assert.match(html, /src="scripts\/apple-ui\.js"/);
});

test('apple-ui.css defines dual-mode tokens, guards hidden native checkboxes, and honors reduced motion', () => {
    const css = read('../public/css/apple-ui.css');
    assert.equal(css.includes('html[data-apple-appearance="dark"]'), true);
    assert.equal(css.includes('html[data-apple-appearance="light"]'), true);
    assert.equal(css.includes(':not(.del_checkbox):not(#rm_button_panel_pin):not(#lm_button_panel_pin):not(#WI_panel_pin)'), true);
    assert.equal(css.includes('@media (prefers-reduced-motion: reduce)'), true);
});

test('applyAppleAppearance toggles dark/light dataset, theme-color meta, toggle button, and localStorage', async t => {
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

    assert.equal(applyAppleAppearance('dark'), 'dark');
    assert.equal(globalThis.document.documentElement.dataset.appleAppearance, 'dark');
    assert.equal(attrs.get('content'), '#000000');
    assert.equal(stored.get('st_apple_appearance'), 'dark');
    assert.equal(toggleBtn.attrs.get('aria-pressed'), 'false');
    assert.equal(icon.className, 'fa-solid fa-sun');
});
