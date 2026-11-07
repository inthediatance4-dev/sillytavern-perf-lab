import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { initAccessibility } from '../public/scripts/a11y.js';
import { createFatePanel } from '../public/scripts/extensions/director/fate-ui.js';

// Exercise the panel and the real app accessibility rules together. Layout and
// viewport checks live in browser_fate_cases.py.
class Element {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.nodeType = 1;
        this.children = [];
        this.attributes = new Map();
        this.dataset = {};
        this.listeners = new Map();
        this.classes = new Set();
        this.classList = {
            add: (...names) => names.forEach(name => this.classes.add(name)),
            remove: (...names) => names.forEach(name => this.classes.delete(name)),
            contains: name => this.classes.has(name),
            toggle: (name, force = !this.classes.has(name)) => {
                if (force) this.classes.add(name);
                else this.classes.delete(name);
                return force;
            },
        };
        this.hidden = false;
        this.disabled = false;
        this.text = '';
    }
    set id(value) { this.setAttribute('id', value); }
    get id() { return this.getAttribute('id') ?? ''; }
    set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classes].join(' '); }
    set textContent(value) { this.text = String(value ?? ''); this.replaceChildren(); }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    get childElementCount() { return this.children.length; }
    get isConnected() { return document.documentElement.contains(this); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) {
        if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
            return this.dataset[key] ?? null;
        }
        return this.attributes.get(name) ?? null;
    }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...children) {
        for (const child of children) {
            child.parentElement = this;
            this.children.push(child);
        }
    }
    replaceChildren(...children) {
        for (const child of this.children) child.parentElement = null;
        this.children = [];
        this.append(...children);
    }
    remove() {
        if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
        this.parentElement = null;
    }
    add(option) { this.append(option); }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    matches(selector) {
        return selector.split(',').some(part => {
            const steps = part.trim().split(/\s+/);
            let node = this;
            if (!matchesStep(node, steps.pop())) return false;
            while (steps.length) {
                const step = steps.pop();
                do { node = node.parentElement; } while (node && !matchesStep(node, step));
                if (!node) return false;
            }
            return true;
        });
    }
    closest(selector) {
        for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
        return null;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) {
        const out = [];
        const visit = node => {
            for (const child of node.children) {
                if (child.matches(selector)) out.push(child);
                visit(child);
            }
        };
        visit(this);
        return out;
    }
    addEventListener(type, handler) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]); }
    removeEventListener(type, handler) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== handler));
    }
    fire(type, fields = {}) {
        const event = { target: this, type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...fields };
        for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event);
        return event;
    }
    click() { if (!this.disabled) this.fire('click'); }
    focus() { document.activeElement = this; }
    scrollIntoView(options) { this.scrolled = options; }
}

function matchesStep(node, selector) {
    const tag = selector.match(/^[\w-]+/);
    if (tag && node.tagName !== tag[0].toUpperCase()) return false;
    for (const [, id] of selector.matchAll(/#([\w-]+)/g)) if (node.id !== id) return false;
    for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(name)) return false;
    for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (node.getAttribute(name) === null || (value !== undefined && node.getAttribute(name) !== value)) return false;
    }
    return true;
}

const secret = 'A private <event> crosses the story.';
const entry = (id, fields = {}) => ({
    id, category: 'echo', title: `命运 ${id}`, strength: 'medium', rarity: 'rare', event: secret,
    slotIndex: 1, prevFingerprint: 'anchor', generationId: 'generation', at: '2026-11-04T00:00:00.000Z',
    replays: 0, status: 'ok', ...fields,
});

function lab(t, { entries = [entry('first')], reveal = 'tap', motion = 'system' } = {}) {
    const previous = Object.fromEntries(['document', 'Element', 'Node', 'Option', 'MutationObserver'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const html = new Element('html');
    const body = new Element('body');
    const opener = new Element('button');
    opener.id = 'director_fate_open';
    html.append(body);
    body.append(opener);
    const document = {
        documentElement: html, body, activeElement: opener,
        createElement: tag => new Element(tag),
        createElementNS: (_namespace, tag) => new Element(tag),
        getElementById: id => html.querySelector(`#${id}`),
        querySelector: selector => html.querySelector(selector),
    };
    let observe;
    Object.assign(globalThis, {
        document, Element, Node: { ELEMENT_NODE: 1 },
        Option: function Option(text, value) {
            const option = new Element('option');
            option.textContent = text;
            option.value = value;
            return option;
        },
        MutationObserver: class {
            constructor(callback) { observe = callback; }
            observe() {}
        },
    });
    t.after(() => {
        for (const [key, descriptor] of Object.entries(previous)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    const popups = [];
    const confirmCalls = [];
    let confirmResult = 0;
    class Popup {
        static show = { confirm: async (...args) => { confirmCalls.push(args); return confirmResult; } };
        constructor(content, _type, _text, options) {
            this.content = content;
            this.options = options;
            this.dlg = new Element('dialog');
            this.cancel = new Element('button');
            this.cancel.setAttribute('autofocus', '');
            this.dlg.append(content, this.cancel);
            this.promise = new Promise(resolve => { this.resolve = resolve; });
            popups.push(this);
        }
        show() {
            body.append(this.dlg);
            this.autofocus = this.dlg.querySelector('[autofocus]');
            this.autofocus?.focus();
            // Exercise the explicit focus after show() as well as autofocus.
            this.cancel.focus();
            return this.promise;
        }
        async complete(value) { this.dlg.remove(); this.resolve(value); }
    }
    let logs = entries;
    const latest = logs[0];
    let view = { phase: 'idle', busy: false, held: null, bound: latest, reveal: latest, offer: null, logCount: logs.length };
    let clears = 0;
    const sounds = [];
    const jumps = [];
    const warnings = [];
    const settings = { reveal, motion, sound: false };
    const controller = {
        view: () => ({ ...view, logCount: logs.length }),
        log: () => logs.map(value => ({ ...value })),
        async clearLog() { clears++; logs = []; },
    };
    const panel = createFatePanel(controller, {
        Popup, POPUP_TYPE: { TEXT: 'text' }, POPUP_RESULT: { AFFIRMATIVE: 1 }, hasDraft: () => false,
        warn: warning => warnings.push(warning), settings, sound: { play: name => sounds.push(name) },
        jumpToMessage: async (...args) => { jumps.push(args); await args[2](); },
    });
    let opening;
    const query = selector => document.querySelector(selector);
    return {
        panel, settings, controller, document, body, opener, popups, query, sounds, jumps, warnings, confirmCalls,
        get clears() { return clears; },
        setConfirm(value) { confirmResult = value; },
        setView(value) { view = { ...view, ...value }; panel.refresh(); },
        open(options) { opening = panel.open(options); return popups.at(-1); },
        async close(escape = false) {
            const popup = popups.at(-1);
            if (escape) popup.dlg.fire('cancel');
            await popup.complete(0);
            await opening;
        },
        applyA11y() {
            initAccessibility();
            observe([{ type: 'childList', addedNodes: [popups.at(-1).content] }]);
        },
    };
}

async function settle() {
    for (let index = 0; index < 8; index++) await Promise.resolve();
}

function assertSecretAbsent(panel) {
    assert.equal(panel.textContent.includes(secret), false);
    for (const node of [panel, ...panel.querySelectorAll('*')]) {
        for (const value of node.attributes.values()) assert.equal(value.includes(secret), false);
        assert.equal(Object.values(node.dataset).some(value => String(value).includes(secret)), false);
    }
}

test('Fate tab roles survive the unchanged core a11y observer and keyboard navigation wraps', async t => {
    const fixture = lab(t);
    fixture.open();
    fixture.applyA11y();
    const current = fixture.query('#director_fate_tab_current');
    const log = fixture.query('#director_fate_tab_log');
    assert.equal(current.className, 'director_fate_tab');
    assert.equal(log.className, 'director_fate_tab');
    for (const tab of [current, log]) {
        assert.equal(tab.getAttribute('role'), 'tab');
        assert.equal(tab.parentElement.getAttribute('role'), 'tablist');
        const content = fixture.query(`#${tab.getAttribute('aria-controls')}`);
        assert.equal(content.getAttribute('role'), 'tabpanel');
        assert.equal(content.getAttribute('aria-labelledby'), tab.id);
    }
    assert.equal(fixture.query('#director_fate_draw').getAttribute('role'), 'button');
    function selected(tab, other) {
        assert.equal(tab.getAttribute('aria-selected'), 'true');
        assert.equal(tab.tabIndex, 0);
        assert.equal(other.getAttribute('aria-selected'), 'false');
        assert.equal(other.tabIndex, -1);
        assert.equal(fixture.query(`#${tab.getAttribute('aria-controls')}`).hidden, false);
        assert.equal(fixture.query(`#${other.getAttribute('aria-controls')}`).hidden, true);
    }
    selected(current, log);
    for (const [from, key, to] of [[current, 'ArrowLeft', log], [log, 'ArrowRight', current],
        [current, 'End', log], [log, 'Home', current], [current, 'ArrowRight', log], [log, 'ArrowLeft', current]]) {
        assert.equal(from.fire('keydown', { key }).defaultPrevented, true);
        selected(to, from);
        assert.equal(fixture.document.activeElement, to);
    }
    log.click();
    selected(log, current);
    await fixture.close();
});

test('log entry receives autofocus and immediate focus, delayed onOpen respects user navigation, Esc restores opener', async t => {
    const fixture = lab(t, { entries: [entry('first'), entry('second')] });
    const popup = fixture.open({ tab: 'log', entryId: 'second' });
    const target = fixture.query('.director_fate_log_entry[data-entry-id="second"]');
    assert.equal(popup.autofocus, target);
    assert.equal(fixture.document.activeElement, target);
    assert.deepEqual(target.scrolled, { block: 'nearest' });
    const current = fixture.query('#director_fate_tab_current');
    current.focus();
    popup.options.onOpen();
    assert.equal(fixture.document.activeElement, current);
    const jump = target.querySelector('.director_fate_log_jump');
    jump.focus();
    popup.options.onOpen();
    assert.equal(fixture.document.activeElement, jump);
    await fixture.panel.open({ tab: 'log', entryId: 'first' });
    assert.equal(fixture.document.activeElement.dataset.entryId, 'first');
    await fixture.close(true);
    assert.equal(fixture.document.activeElement, fixture.opener);
    fixture.open({ tab: 'log', entryId: 'missing' });
    assert.equal(fixture.document.activeElement, fixture.query('#director_fate_tab_log'));
    await fixture.close();
});

test('log reveal follows tap, auto and off and shares flips with the current card across opens', async t => {
    const fixture = lab(t);
    const popup = fixture.open();
    assertSecretAbsent(popup.content);
    fixture.query('#director_fate_tab_log').click();
    assertSecretAbsent(popup.content);
    assert.equal(fixture.query('.director_fate_log_flip').hidden, false);
    fixture.query('.director_fate_log_flip').click();
    assert.equal(fixture.query('.director_fate_log_event').textContent, secret);
    assert.equal(fixture.query('.director_fate_log_flip').hidden, true);
    fixture.query('#director_fate_tab_current').click();
    assert.equal(fixture.query('.director_fate_face').textContent, secret);
    assert.equal(fixture.query('.director_fate_log_event').textContent, '');
    assert.deepEqual(fixture.sounds, ['flip']);
    await fixture.close();
    fixture.open({ tab: 'log' });
    assert.equal(fixture.query('.director_fate_log_event').textContent, secret);
    fixture.settings.reveal = 'off';
    fixture.panel.refresh();
    assertSecretAbsent(fixture.popups.at(-1).content);
    assert.equal(fixture.query('.director_fate_log_flip').hidden, true);
    fixture.settings.reveal = 'auto';
    fixture.panel.refresh();
    assert.equal(fixture.query('.director_fate_log_event').textContent, secret);
    assert.equal(fixture.query('.director_fate_log_flip').hidden, true);
    await fixture.close();
});

test('flipping the current card reveals the same log entry without another flip', async t => {
    const fixture = lab(t);
    fixture.open();
    fixture.query('#director_fate_flip').click();
    assert.equal(fixture.query('.director_fate_face').textContent, secret);
    fixture.query('#director_fate_tab_log').click();
    assert.equal(fixture.query('.director_fate_log_event').textContent, secret);
    assert.equal(fixture.query('.director_fate_log_flip').hidden, true);
    assert.deepEqual(fixture.sounds, ['flip']);
    await fixture.close();
});

test('log preserves newest order, labels and status tags; only an ok entry can jump and close', async t => {
    const fixture = lab(t, { entries: [entry('newest', { slotIndex: 20, rarity: 'legendary', strength: 'strong' }),
        entry('changed', { status: 'changed', slotIndex: 6 }), entry('missing', { status: 'missing', slotIndex: 9 })] });
    fixture.open({ tab: 'log' });
    const items = fixture.query('#director_fate_log_list').children;
    assert.deepEqual(items.map(node => node.dataset.entryId), ['newest', 'changed', 'missing']);
    assert.equal(fixture.query('#director_fate_tab_log').textContent, '本局命运（3）');
    assert.equal(items[0].querySelector('strong').textContent, '命运 newest');
    assert.equal(items[0].querySelector('.director_fate_rarity_dot').dataset.rarity, 'legendary');
    assert.equal(items[0].querySelector('.director_fate_rarity_dot').getAttribute('aria-label'), '传说');
    assert.equal(items[0].querySelector('.director_fate_mark_emblem').dataset.silhouette, 'crown');
    assert.equal(items[0].querySelector('.director_fate_mark_label'), null);
    assert.equal(/[普稀传●◆★]/.test(items[0].querySelector('.director_fate_rarity_dot').textContent), false);
    assert.deepEqual(items.map(node => node.querySelector('.director_fate_mark_emblem').dataset.silhouette), ['crown', 'gem', 'gem']);
    assert.equal(items[0].querySelector('.director_fate_log_details').textContent, '重大变故第 21 条');
    assert.equal(items[0].querySelector('.director_fate_log_status'), null);
    assert.equal(items[1].querySelector('.director_fate_log_status').textContent, '消息已改写');
    assert.equal(items[2].querySelector('.director_fate_log_status').textContent, '消息已删除');
    assert.equal(items[1].querySelector('.director_fate_log_jump').disabled, true);
    assert.equal(items[2].querySelector('.director_fate_log_jump').disabled, true);
    items[1].querySelector('.director_fate_log_jump').click();
    assert.equal(fixture.jumps.length, 0);
    items[0].querySelector('.director_fate_log_jump').click();
    await settle();
    assert.equal(fixture.jumps.length, 1);
    assert.equal(fixture.jumps[0][0], 20);
    assert.equal(fixture.jumps[0][1], 'director-fate-highlight');
    assert.deepEqual(fixture.jumps[0][3], { warnMissing: true });
    assert.deepEqual(fixture.warnings, []);
});

test('clear log requires confirmation, respects busy state and refreshes the empty list', async t => {
    const fixture = lab(t);
    fixture.open({ tab: 'log' });
    fixture.setView({ busy: true });
    fixture.query('#director_fate_clear_log').click();
    assert.equal(fixture.confirmCalls.length, 0);
    fixture.setView({ busy: false });
    fixture.query('#director_fate_clear_log').click();
    await settle();
    assert.equal(fixture.confirmCalls.length, 1);
    assert.equal(fixture.clears, 0);
    assert.equal(fixture.query('#director_fate_log_list').children.length, 1);
    fixture.setConfirm(1);
    fixture.query('#director_fate_clear_log').click();
    await settle();
    assert.equal(fixture.clears, 1);
    assert.equal(fixture.query('#director_fate_log_list').children.length, 0);
    assert.equal(fixture.query('#director_fate_tab_log').textContent, '本局命运（0）');
    assert.equal(fixture.query('#director_fate_log_empty').hidden, false);
    assert.equal(fixture.query('#director_fate_clear_log').disabled, true);
    assert.equal(fixture.controller.view().bound.id, 'first');
    await fixture.close();
});

test('a full fifty-entry log renders every row in order with no virtual window', async t => {
    const entries = Array.from({ length: 50 }, (_, index) => entry(`row-${index}`, { slotIndex: 49 - index, rarity: index % 3 === 0 ? 'legendary' : 'common' }));
    const fixture = lab(t, { entries });
    fixture.open({ tab: 'log' });
    const list = fixture.query('#director_fate_log_list');
    assert.equal(list.children.length, 50);
    assert.deepEqual(list.children.map(node => node.dataset.entryId), entries.map(item => item.id));
    assert.equal(list.children[0].querySelector('.director_fate_log_details').textContent.includes('第 50 条'), true);
    assert.equal(list.children[49].querySelector('.director_fate_log_details').textContent.includes('第 1 条'), true);
    assert.equal(fixture.query('#director_fate_tab_log').textContent, '本局命运（50）');
    await fixture.close();
});

test('reduced-motion rules stop tab and mark animation and keep the card fade', () => {
    const css = readFileSync(new URL('../public/scripts/extensions/director/style.css', import.meta.url), 'utf8');
    const quiet = `.director_fate_nomotion .director_fate_tab,
body.reduced-motion .director_fate_tab,
body.reduced-motion .director_fate_mark {
    animation: none !important;
    transition: none;
}`;
    assert.equal(css.includes(quiet), true);
    assert.equal(css.includes('.director_fate_tab { animation: none !important; transition: none; }'), true);
    assert.equal(css.includes('.director_fate_nomotion .director_fate_back,\n.director_fate_nomotion .director_fate_face { transform: none; transition: opacity 150ms ease; }'), true);
    assert.equal(css.includes('.director_fate_back, .director_fate_face { transform: none !important; transition: opacity 150ms ease; }'), true);
});

test('card and log rows carry rarity for their stock and never the event', async t => {
    const fixture = lab(t, { entries: [entry('first', { rarity: 'legendary' }), entry('older', { rarity: 'common', slotIndex: 0 })] });
    fixture.open();
    const card = fixture.query('.director_fate_card');
    assert.equal(card.dataset.rarity, 'legendary');
    fixture.setView({ held: entry('picked', { rarity: 'rare' }) });
    assert.equal(card.dataset.state, 'sealed');
    assert.equal(card.dataset.rarity, 'rare');
    assertSecretAbsent(fixture.popups.at(-1).content);
    fixture.setView({ held: null, bound: null, reveal: null });
    assert.equal(card.dataset.state, 'empty');
    assert.equal('rarity' in card.dataset, false);
    fixture.query('#director_fate_tab_log').click();
    const items = fixture.query('#director_fate_log_list').children;
    assert.deepEqual(items.map(node => node.dataset.rarity), ['legendary', 'common']);
    await fixture.close();
});

test('polish motion stays off under every reduced-motion path and nothing loops in chat', () => {
    const css = readFileSync(new URL('../public/scripts/extensions/director/style.css', import.meta.url), 'utf8');
    const media = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const selector of ['.director_fate_choice > *', '.director_fate_choice::after', '.director_fate_card ::after']) {
        assert.equal(media.includes(selector), true, selector);
        assert.equal(css.includes(`.director_fate_nomotion ${selector}`), true, selector);
        assert.equal(css.includes(`body.reduced-motion ${selector}`), true, selector);
    }
    // The hover lift uses translate, which pick motion ignores. Reduced motion drops it.
    assert.equal(media.includes('.director_fate_choice { translate: none; }'), true);
    assert.equal(css.includes('.director_fate_nomotion .director_fate_choice,\nbody.reduced-motion .director_fate_choice { translate: none; }'), true);
    // Dealing must not move the button box: the 390px layout is measured while it settles.
    const deal = css.match(/@keyframes director_fate_deal \{([^}]*\}[^}]*)\}/)[1];
    assert.equal(/transform|translate|scale/.test(deal), false);
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/infinite/.test(body)) continue;
        if (selector.includes('.director_fate_mark_sheen::after')) {
            assert.equal(selector.includes('.director_fate_mark[data-rarity="legendary"]'), true, selector.trim());
            continue;
        }
        assert.equal(/director_fate_mark|\.mes\b/.test(selector), false, selector.trim());
    }
    for (const needle of ['.director_fate_nomotion .director_fate_mark_sheen::after', 'body.reduced-motion .director_fate_mark_sheen::after']) {
        assert.equal(css.includes(needle), true, needle);
    }
    assert.equal(media.includes('.director_fate_mark_sheen::after'), true);
});

test('narrow fate controls keep short labels on one line and mirror hover on touch', () => {
    const css = readFileSync(new URL('../public/scripts/extensions/director/style.css', import.meta.url), 'utf8');
    const buttons = css.match(/#director_fate_panel \.menu_button \{([^}]*)\}/)[1];
    assert.equal(/width:\s*auto/.test(buttons), true);
    assert.equal(/white-space:\s*nowrap/.test(buttons), true);
    assert.equal(/flex-shrink:\s*0/.test(buttons), true);
    assert.equal(/transition-property:\s*background-color,\s*border-color,\s*filter,\s*box-shadow/.test(buttons), true);
    assert.equal(/transition-property:[^;]*\b(?:all|min-height|height|width)\b/.test(buttons), false);
    assert.equal(/#director_fate_panel #director_fate_settings_toggle,\s*#director_fate_panel #director_fate_clear_log \{[^}]*width:\s*100%/.test(css), true);
    assert.equal(/\.director_fate_actions \.menu_button \{[^}]*white-space:\s*normal/.test(css), false);
    assert.equal(/\.director_fate_log_actions \.menu_button \{[^}]*white-space:\s*normal/.test(css), false);
    assert.equal(css.includes('.director_fate_choice:not(:disabled):hover,\n.director_fate_choice:focus-visible'), false);
    const hoverAt = css.indexOf('@media (hover: hover)');
    assert.equal(hoverAt > 0, true);
    const hoverBlock = css.slice(hoverAt, hoverAt + 500);
    assert.equal(/\.director_fate_choice:not\(:disabled\):hover \{[^}]*translate:\s*0 -4px/.test(hoverBlock), true);
    assert.equal(/\.director_fate_choice:not\(:disabled\):active,\s*\.director_fate_choice:focus-visible \{[^}]*translate:\s*0 -4px/.test(css), true);
    for (const selector of ['.director_fate_tab:active', '.director_fate_log_flip:active', '.director_fate_mark:active', '#directorPopover button:not(:disabled):active']) {
        assert.equal(css.includes(selector), true, selector);
    }
    const narrowAt = css.indexOf('@media (max-width: 480px), ((pointer: coarse) and (max-width: 900px))');
    assert.equal(narrowAt > 0, true);
    const narrow = css.slice(narrowAt);
    assert.equal(/min-height:\s*44px/.test(narrow), true);
    assert.equal(/min-width:\s*44px/.test(narrow), true);
    assert.equal(/\.director_fate_choice_title \{[^}]*align-self:\s*stretch/.test(css), true);
    assert.equal(/\.director_fate_choice_title \{[^}]*overflow-wrap:\s*anywhere/.test(css), true);
    assert.equal(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(css), true);
    assert.equal(/\.director_fate_choice \{[^}]*min-height:\s*150px/.test(css), true);
    const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.equal(motion.includes('.director_fate_choice:not(:disabled):active'), true);
    assert.equal(motion.includes('.director_fate_choice { translate: none; }'), true);
});

test('picking and revealing work with no animation events under app reduced motion and Fate motion off', async t => {
    const fixture = lab(t, { motion: 'off' });
    fixture.body.classList.add('reduced-motion');
    fixture.open();
    assert.equal(fixture.document.documentElement.classList.contains('director_fate_nomotion'), true);
    fixture.setView({ held: null, bound: null, reveal: null, offer: { id: 'offer', cards: [
        { title: '一', rarity: 'common' }, { title: '二', rarity: 'rare' }, { title: '三', rarity: 'legendary' },
    ] } });
    const choices = fixture.query('.director_fate_offer').children;
    const picked = [];
    fixture.controller.pick = async (index, strength) => {
        picked.push({ index, strength });
        fixture.setView({ offer: null, held: entry('picked') });
        return true;
    };
    choices[1].click();
    await settle();
    assert.deepEqual(picked, [{ index: 1, strength: 'medium' }]);
    assert.equal(fixture.query('.director_fate_offer').hidden, true);
    assert.equal(fixture.query('.director_fate_offer').classList.contains('is_picking'), false);
    assert.equal(fixture.query('.director_fate_offer').listeners.get('animationend')?.length, 0);
    assert.equal(fixture.query('.director_fate_offer').listeners.get('transitionend')?.length, 0);
    fixture.setView({ held: null, bound: entry('first'), reveal: entry('first') });
    fixture.query('#director_fate_flip').click();
    fixture.query('#director_fate_tab_log').click();
    assert.equal(fixture.query('.director_fate_log_event').textContent, secret);
    await fixture.close();
});

test('opening the log recovers a shifted slot, and jump follows that index', async t => {
    const entries = [entry('shifted', { slotIndex: 4, status: 'changed' })];
    const fixture = lab(t, { entries });
    const calls = [];
    fixture.controller.recoverLog = async () => {
        calls.push('recover');
        entries[0] = { ...entries[0], slotIndex: entries[0].slotIndex - 1, status: 'ok' };
        return true;
    };
    fixture.open();
    await settle();
    assert.deepEqual(calls, []);
    assert.equal(fixture.query('.director_fate_log_jump').disabled, true);
    fixture.query('#director_fate_tab_log').click();
    await settle();
    assert.deepEqual(calls, ['recover']);
    assert.equal(fixture.query('.director_fate_log_details').textContent.includes('第 4 条'), true);
    assert.equal(fixture.query('.director_fate_log_status'), null);
    assert.equal(fixture.query('.director_fate_log_jump').disabled, false);
    fixture.query('.director_fate_log_jump').click();
    await settle();
    assert.deepEqual(calls, ['recover', 'recover']);
    assert.equal(fixture.jumps.length, 1);
    assert.equal(fixture.jumps[0][0], 2);
    assert.equal(fixture.jumps[0][1], 'director-fate-highlight');
});

test('a log jump stays disabled when recovery leaves the row changed', async t => {
    const entries = [entry('changed', { status: 'changed', slotIndex: 6 })];
    const fixture = lab(t, { entries });
    let calls = 0;
    fixture.controller.recoverLog = async () => {
        calls++;
        return false;
    };
    fixture.open({ tab: 'log' });
    await settle();
    assert.equal(calls, 1);
    assert.equal(fixture.query('.director_fate_log_status').textContent, '消息已改写');
    assert.equal(fixture.query('.director_fate_log_jump').disabled, true);
    fixture.query('.director_fate_log_jump').click();
    await settle();
    assert.equal(calls, 1);
    assert.equal(fixture.jumps.length, 0);
});

test('the current card jump does not recover log slots', async t => {
    const fixture = lab(t);
    let calls = 0;
    fixture.controller.recoverLog = async () => {
        calls++;
        return false;
    };
    fixture.open();
    fixture.query('#director_fate_flip').click();
    fixture.query('#director_fate_jump').click();
    await settle();
    assert.equal(calls, 0);
    assert.equal(fixture.jumps[0][0], 1);
});

test('the draw button shows one free swap, then locks with a hint until the offer is gone', async t => {
    const fixture = lab(t);
    const deals = [];
    fixture.controller.deal = async () => { deals.push('deal'); return true; };
    fixture.open();
    const draw = fixture.query('#director_fate_draw');
    assert.equal(draw.textContent, '发牌');
    assert.equal(draw.disabled, false);
    assert.equal(draw.getAttribute('title'), null);
    assert.equal(draw.getAttribute('aria-label'), null);
    const offer = { id: 'offer', cards: [
        { title: '一', rarity: 'common' }, { title: '二', rarity: 'rare' }, { title: '三', rarity: 'legendary' },
    ] };
    fixture.setView({ held: null, bound: null, reveal: null, offer });
    assert.equal(draw.textContent, '换一组 (1)');
    assert.equal(draw.disabled, false);
    assert.equal(fixture.query('#director_fate_status').textContent, '三张牌已备好，请选择一张。');
    draw.click();
    await settle();
    assert.deepEqual(deals, ['deal']);
    assert.deepEqual(fixture.sounds, ['draw']);

    fixture.controller.deal = async () => { throw new Error('本次已换过一组'); };
    draw.click();
    await settle();
    assert.equal(fixture.query('#director_fate_status').textContent, '三张牌已备好，请选择一张。');
    assert.equal(draw.disabled, false);

    fixture.setView({ rerolls: 0 });
    assert.equal(draw.textContent, '换一组 (0)');
    assert.equal(draw.disabled, true);
    assert.equal(draw.getAttribute('title'), '本次已换过一组');
    assert.equal(draw.getAttribute('aria-label'), '换一组 (0)，本次已换过一组');
    assert.equal(fixture.query('#director_fate_status').textContent, '三张牌已备好，请选择一张。本次已换过一组。');
    draw.click();
    await settle();
    assert.deepEqual(deals, ['deal']);
    assert.deepEqual(fixture.sounds, ['draw', 'draw']);

    fixture.setView({ busy: true, phase: 'drawing' });
    assert.equal(draw.disabled, true);
    assert.equal(fixture.query('#director_fate_status').textContent, '正在为当前剧情抽牌…');
    fixture.setView({ busy: false, phase: 'idle' });
    assert.equal(draw.textContent, '换一组 (0)');
    assert.equal(draw.disabled, true);
    assert.equal(draw.getAttribute('title'), '本次已换过一组');

    fixture.setView({ offer: null, rerolls: 0 });
    assert.equal(draw.textContent, '发牌');
    assert.equal(draw.disabled, false);
    assert.equal(draw.getAttribute('title'), null);
    assert.equal(draw.getAttribute('aria-label'), null);
    assert.equal(fixture.query('#director_fate_status').textContent, '抽取一张牌，让故事迎来转折。');
    await fixture.close();
});
