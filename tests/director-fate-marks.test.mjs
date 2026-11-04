import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createFateEmblem, createFateMarks } from '../public/scripts/extensions/director/fate-marks.js';
import { createFateController } from '../public/scripts/extensions/director/fate.js';
import { EventEmitter } from '../public/lib/eventemitter.js';
import { messageFingerprint } from '../public/scripts/extensions/director/instruct.js';

class Element {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.attributes = new Map();
        this.dataset = {};
        this.listeners = new Map();
        this.classes = new Set();
        this.classList = {
            add: (...names) => names.forEach(name => this.classes.add(name)),
            remove: (...names) => names.forEach(name => this.classes.delete(name)),
            contains: name => this.classes.has(name),
        };
        this.text = '';
    }
    set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classes].join(' '); }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    get previousElementSibling() {
        return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] ?? null;
    }
    get nextElementSibling() {
        return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null;
    }
    append(...children) {
        for (const child of children) {
            child.remove();
            child.parentElement = this;
            this.children.push(child);
        }
    }
    after(node) {
        node.remove();
        node.parentElement = this.parentElement;
        this.parentElement.children.splice(this.parentElement.children.indexOf(this) + 1, 0, node);
    }
    remove() {
        if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
        this.parentElement = null;
    }
    matches(selector) {
        if (selector.startsWith('#')) return this.getAttribute('id') === selector.slice(1);
        const match = selector.match(/^\.([\w-]+)(?:\[([\w-]+)="([^"]*)"\])?$/);
        return !!match && this.classes.has(match[1]) && (!match[2] || this.getAttribute(match[2]) === match[3]);
    }
    closest(selector) {
        for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
        return null;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) {
        let found = [this];
        for (const step of selector.split(/\s+/)) {
            const next = [];
            const walk = node => {
                for (const child of node.children) {
                    if (child.matches(step)) next.push(child);
                    walk(child);
                }
            };
            found.forEach(walk);
            found = next;
        }
        return found;
    }
    addEventListener(type, handler) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
    }
    removeEventListener(type, handler) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter(value => value !== handler));
    }
    fire(type, fields = {}) {
        const event = { target: this, preventDefault() {}, stopPropagation() {}, ...fields };
        for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event);
    }
    scrollIntoView(options) { this.scrolled = options; }
}

function dom(t) {
    const previous = Object.fromEntries(['document', 'matchMedia', 'HTMLElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const html = new Element('html');
    const body = new Element('body');
    const chat = new Element();
    chat.setAttribute('id', 'chat');
    html.append(body);
    body.append(chat);
    const document = {
        documentElement: html,
        body,
        createElement: tag => new Element(tag),
        createElementNS: (_namespace, tag) => new Element(tag),
        querySelector: selector => html.querySelector(selector),
        querySelectorAll: selector => html.querySelectorAll(selector),
    };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    Object.defineProperty(globalThis, 'matchMedia', { configurable: true, writable: true, value: () => ({ matches: false }) });
    Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: Element });
    t.after(() => {
        for (const [key, descriptor] of Object.entries(previous)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    function addMessage(index) {
        const message = new Element();
        message.className = 'mes';
        message.setAttribute('mesid', index);
        const header = new Element();
        header.className = 'ch_name';
        const name = new Element('span');
        name.className = 'name_text';
        name.textContent = 'Story';
        const outer = new Element();
        outer.className = 'flex-container flex1';
        const baseline = new Element();
        baseline.className = 'flex-container alignItemsBaseline';
        baseline.append(name);
        outer.append(baseline);
        header.append(outer);
        const text = new Element();
        text.className = 'mes_text';
        text.textContent = `Original story ${index}`;
        // Catch accidental writes, even ones that restore the same content.
        const originalText = text.textContent;
        Object.defineProperty(text, 'textContent', {
            get: () => originalText,
            set: () => { throw new Error('Marks must never modify .mes_text'); },
        });
        text.append = () => { throw new Error('Marks must never append to .mes_text'); };
        message.append(header, text);
        chat.append(message);
        return { message, header, name, text };
    }
    return { document, html, body, chat, addMessage };
}

const secret = 'Private event text stays sealed until the reveal setting allows it.';
const entry = (slotIndex, fields = {}) => ({
    id: `fate-${slotIndex}`, title: '涟漪', rarity: 'rare', strength: 'light', slotIndex,
    event: secret, status: 'ok', ...fields,
});

function fixture(t, entries = [entry(1)]) {
    const tree = dom(t);
    const context = { chatId: 'one', chatMetadata: {} };
    const opened = [];
    let current = entries;
    let reads = 0;
    const marks = createFateMarks({
        getContext: () => context,
        getEntries: index => { reads++; return index === undefined ? current : current.filter(item => item.slotIndex === index); },
        onOpen: id => opened.push(id),
    });
    return { ...tree, context, opened, marks, setEntries: value => { current = value; }, get reads() { return reads; } };
}

function serialized(node) {
    return JSON.stringify({ text: node.textContent, attrs: [...node.attributes], dataset: node.dataset,
        children: node.children.map(child => serialized(child)) });
}

test('marks paint only valid headers, expose public labels and open their current log entry', t => {
    const lab = fixture(t, [entry(1), entry(2, { status: 'changed' }), entry(3, { status: 'missing' })]);
    const rows = [1, 2, 3].map(lab.addMessage);
    lab.marks.paintAll();
    const mark = rows[0].header.querySelector('.director_fate_mark');
    assert.ok(mark);
    assert.equal(mark.type, 'button');
    assert.equal(mark.querySelector('.director_fate_mark_label'), null);
    assert.equal(mark.querySelector('.director_fate_mark_shape'), null);
    assert.equal(mark.querySelector('.director_fate_mark_emblem').dataset.silhouette, 'gem');
    assert.equal(mark.querySelector('.director_fate_mark_emblem').getAttribute('aria-hidden'), 'true');
    assert.equal(mark.textContent.trim(), '');
    assert.equal(mark.dataset.rarity, 'rare');
    assert.equal(mark.getAttribute('aria-label'), '命运牌：〈涟漪〉，稀有');
    assert.equal(mark.getAttribute('title'), '命运牌：〈涟漪〉，稀有');
    assert.equal(rows[0].name.nextElementSibling, mark);
    assert.equal(mark.previousElementSibling, rows[0].name);
    assert.equal(mark.closest('.ch_name'), rows[0].header);
    assert.equal(mark.closest('.mes_text'), null);
    assert.equal(rows[1].header.querySelector('.director_fate_mark'), null);
    assert.equal(rows[2].header.querySelector('.director_fate_mark'), null);
    assert.equal(rows[0].text.textContent, 'Original story 1');
    assert.equal(serialized(lab.html).includes(secret), false);
    let prevented = false;
    let stopped = false;
    mark.fire('click', { preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.deepEqual(lab.opened, ['fate-1']);
    assert.equal(prevented && stopped, true);
    lab.setEntries([entry(1, { id: 'replacement', title: '回声', rarity: 'legendary' })]);
    lab.marks.invalidate();
    assert.equal(lab.marks.paintOne(1), mark);
    assert.equal(mark.dataset.rarity, 'legendary');
    assert.equal(mark.querySelector('.director_fate_mark_emblem').dataset.silhouette, 'crown');
    assert.equal(mark.querySelector('.director_fate_mark_label'), null);
    assert.equal(mark.getAttribute('aria-label'), '命运牌：〈回声〉，传说');
    assert.equal(mark.getAttribute('title'), '命运牌：〈回声〉，传说');
    mark.fire('click');
    assert.deepEqual(lab.opened, ['fate-1', 'replacement']);
    assert.equal(serialized(lab.html).includes(secret), false);
});

test('each rarity renders a distinct wordless emblem and keeps the rarity in the accessible name', t => {
    const lab = fixture(t, [
        entry(1, { rarity: 'common', title: '涟漪' }),
        entry(2, { rarity: 'rare', title: '回声' }),
        entry(3, { rarity: 'legendary', title: '尘封的低语' }),
    ]);
    const rows = [1, 2, 3].map(lab.addMessage);
    lab.marks.paintAll();
    const faces = [
        ['common', 'seal', ['disc', 'nib'], '寻常', '涟漪'],
        ['rare', 'gem', ['gem', 'facet'], '稀有', '回声'],
        ['legendary', 'crown', ['crown', 'seal'], '传说', '尘封的低语'],
    ];
    const outlines = [];
    faces.forEach(([rarity, silhouette, parts, name, title], index) => {
        const mark = rows[index].header.querySelector('.director_fate_mark');
        const emblem = mark.querySelector('.director_fate_mark_emblem');
        assert.equal(mark.dataset.rarity, rarity);
        assert.equal(emblem.dataset.silhouette, silhouette);
        assert.equal(emblem.getAttribute('aria-hidden'), 'true');
        assert.equal(mark.querySelector('.director_fate_mark_glyph').getAttribute('aria-hidden'), 'true');
        assert.equal(mark.querySelector('.director_fate_mark_label'), null);
        assert.equal(mark.querySelector('.director_fate_mark_shape'), null);
        assert.equal(/[普稀传●◆★]/.test(mark.textContent), false);
        assert.deepEqual([...mark.querySelectorAll('.director_fate_emblem_part')].map(part => part.dataset.part), parts);
        outlines.push(mark.querySelector('.director_fate_emblem_part').dataset.geometry);
        const caption = `命运牌：〈${title}〉，${name}`;
        assert.equal(mark.getAttribute('aria-label'), caption);
        assert.equal(mark.getAttribute('title'), caption);
        const sheen = mark.querySelector('.director_fate_mark_sheen');
        if (silhouette === 'crown') {
            const geometry = mark.querySelector('.director_fate_emblem_part').dataset.geometry;
            const clip = sheen.getAttribute('style');
            for (const pair of geometry.split(' ')) {
                const [x, y] = pair.split(',').map(Number);
                assert.equal(clip.includes(`${(x / 32 * 100).toFixed(2)}% ${(y / 32 * 100).toFixed(2)}%`), true, pair);
            }
        } else {
            assert.equal(sheen, null);
        }
    });
    assert.equal(new Set(outlines).size, 3);
    const kept = rows[1].header.querySelector('.director_fate_mark_emblem');
    lab.marks.paintAll();
    assert.equal(rows[1].header.querySelector('.director_fate_mark_emblem'), kept);
    assert.equal(serialized(lab.html).includes(secret), false);
    const css = readFileSync(new URL('../public/scripts/extensions/director/style.css', import.meta.url), 'utf8');
    const ui = readFileSync(new URL('../public/scripts/extensions/director/fate-ui.js', import.meta.url), 'utf8');
    assert.equal(css.includes('director_fate_mark_label'), false);
    assert.equal(css.includes('director_fate_mark_shape'), false);
    assert.match(css, /\.director_fate_mark,\s*\n\.director_fate_rarity_dot\s*\{[^}]*--fate-plate:/);
    assert.match(css, /\.director_fate_mark\[data-rarity="rare"\],\s*\n\.director_fate_rarity_dot\[data-rarity="rare"\]/);
    assert.match(css, /\.director_fate_mark\[data-rarity="legendary"\],\s*\n\.director_fate_rarity_dot\[data-rarity="legendary"\]/);
    assert.match(css, /\.director_fate_mark\s*\{[^}]*align-self:\s*center/);
    assert.match(css, /\.director_fate_mark:hover,\s*\n\.director_fate_mark:active,\s*\n\.director_fate_mark:focus-visible\s*\{/);
    assert.match(css, /\.director_fate_mark\[data-rarity="legendary"\] \.director_fate_mark_sheen::after\s*\{[^}]*animation:[^;]*director_fate_mark_sheen[^;]*infinite/);
    assert.match(ui, /dot\.append\(createFateEmblem\(entry\.rarity\)\)/);
    assert.equal(ui.includes("textContent = '●'"), false);
    const lone = createFateEmblem('legendary');
    assert.equal(lone.dataset.silhouette, 'crown');
    assert.equal(createFateEmblem('rare').dataset.silhouette, 'gem');
    assert.equal(createFateEmblem('nope').dataset.silhouette, 'seal');
    const touchAt = css.indexOf('@media (max-width: 480px), ((pointer: coarse) and (max-width: 900px))');
    const touch = css.slice(touchAt);
    const hit = touch.match(/\.director_fate_mark::before\s*\{([^}]*)\}/)[1];
    assert.match(hit, /position:\s*absolute/);
    assert.match(hit, /width:\s*44px/);
    assert.match(hit, /height:\s*44px/);
    assert.match(hit, /transition:\s*none/);
    assert.equal(/transition-property:[^;]*\b(?:all|width|height|min-height|min-width)\b/.test(hit), false);
    const quiet = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.match(quiet, /\.director_fate_mark\s*\{[^}]*animation:\s*none !important/);
    assert.match(quiet, /\.director_fate_mark_sheen::after\s*\{[^}]*animation:\s*none !important/);
    assert.equal(/director_fate_mark_glyph[^}]*transform:\s*none/.test(quiet), false);
    assert.equal(css.includes('.director_fate_nomotion .director_fate_mark_sheen::after'), true);
    assert.equal(css.includes('body.reduced-motion .director_fate_mark_sheen::after'), true);
});

test('slot cache rebuilds lazily, prefers newest fate and removes stale or unloaded marks', t => {
    const lab = fixture(t, [entry(1), entry(1, { id: 'older' }), entry(40)]);
    const row = lab.addMessage(1);
    assert.equal(lab.reads, 0);
    lab.marks.paintOne(1);
    lab.marks.paintOne(1);
    lab.marks.paintOne(2);
    assert.equal(lab.reads, 2);
    row.header.querySelector('.director_fate_mark').fire('click');
    assert.deepEqual(lab.opened, ['fate-1']);
    assert.equal(lab.marks.paintOne(40), null);
    assert.equal(lab.marks.paintOne(-1), null);
    assert.equal(lab.marks.paintOne('not-an-index'), null);
    lab.setEntries([entry(1, { status: 'changed' })]);
    lab.marks.invalidate();
    assert.equal(lab.reads, 3);
    lab.marks.paintAll();
    assert.equal(lab.reads, 4);
    assert.equal(row.header.querySelector('.director_fate_mark'), null);
    lab.setEntries([entry(1)]);
    lab.marks.invalidate();
    lab.marks.paintOne(1);
    lab.setEntries([]);
    lab.marks.invalidate();
    lab.marks.paintAll();
    assert.equal(row.header.querySelector('.director_fate_mark'), null);
    lab.setEntries([entry(1)]);
    lab.marks.invalidate();
    lab.marks.paintOne(1);
    lab.context.chatMetadata = {};
    lab.context.chatId = 'two';
    lab.setEntries([]);
    lab.marks.paintAll();
    assert.equal(row.header.querySelector('.director_fate_mark'), null);
});

test('fresh marks pulse once, clean up on their own animationend and never animate in reduced motion', t => {
    const lab = fixture(t, [entry(1), entry(2), entry(3)]);
    const rows = [1, 2, 3].map(lab.addMessage);
    lab.marks.paintAll();
    const mark = rows[0].header.querySelector('.director_fate_mark');
    lab.marks.pulse('fate-1');
    assert.equal(mark.classList.contains('is_fresh'), true);
    lab.marks.paintAll();
    mark.fire('animationend', { target: rows[0].name });
    assert.equal(mark.classList.contains('is_fresh'), true);
    mark.fire('animationend');
    assert.equal(mark.classList.contains('is_fresh'), false);
    lab.marks.pulse('fate-1');
    assert.equal(mark.classList.contains('is_fresh'), false);
    globalThis.matchMedia = () => ({ matches: true });
    lab.marks.pulse('fate-2');
    assert.equal(rows[1].header.querySelector('.director_fate_mark').classList.contains('is_fresh'), false);
    globalThis.matchMedia = () => ({ matches: false });
    lab.html.classList.add('director_fate_nomotion');
    lab.marks.pulse('fate-3');
    assert.equal(rows[2].header.querySelector('.director_fate_mark').classList.contains('is_fresh'), false);
});

test('paintAll leaves similarly named elements inside .mes_text untouched', t => {
    const lab = fixture(t, []);
    const row = lab.addMessage(1);
    const unrelated = new Element();
    unrelated.className = 'director_fate_mark';
    row.text.children.push(unrelated);
    unrelated.parentElement = row.text;
    lab.marks.paintAll();
    assert.equal(row.text.children[0], unrelated);
    const forgedHeader = new Element();
    forgedHeader.className = 'ch_name';
    const forgedMark = new Element('button');
    forgedMark.className = 'director_fate_mark';
    forgedHeader.append(forgedMark);
    row.text.children.push(forgedHeader);
    forgedHeader.parentElement = row.text;
    lab.marks.invalidate();
    lab.marks.paintAll();
    assert.equal(forgedHeader.children[0], forgedMark);
    assert.equal(forgedMark.parentElement, forgedHeader);
});

test('paintOne ignores forged headers in message text when a native header is absent', t => {
    const lab = fixture(t);
    const row = lab.addMessage(1);
    row.header.remove();
    row.text.children.push(row.header);
    row.header.parentElement = row.text;
    assert.equal(lab.marks.paintOne(1), null);
    assert.equal(row.header.querySelector('.director_fate_mark'), null);
});

test('app reduced motion skips the pulse without requiring an animation event', t => {
    const lab = fixture(t);
    const row = lab.addMessage(1);
    lab.body.classList.add('reduced-motion');
    lab.marks.pulse('fate-1');
    const mark = row.header.querySelector('.director_fate_mark');
    assert.ok(mark);
    assert.equal(mark.classList.contains('is_fresh'), false);
    lab.body.classList.remove('reduced-motion');
    lab.marks.pulse('fate-1');
    assert.equal(mark.classList.contains('is_fresh'), false);
});

test('cancelling an active pulse clears its class and does not replay it', t => {
    const lab = fixture(t);
    const row = lab.addMessage(1);
    lab.marks.pulse('fate-1');
    const mark = row.header.querySelector('.director_fate_mark');
    assert.equal(mark.classList.contains('is_fresh'), true);
    lab.body.classList.add('reduced-motion');
    mark.fire('animationcancel');
    assert.equal(mark.classList.contains('is_fresh'), false);
    lab.body.classList.remove('reduced-motion');
    lab.marks.pulse('fate-1');
    assert.equal(mark.classList.contains('is_fresh'), false);
});

test('reduced motion drops a fresh class on the next paint without an animation event', t => {
    const lab = fixture(t, [entry(1), entry(2), entry(3)]);
    const rows = [1, 2, 3].map(lab.addMessage);
    lab.marks.pulse('fate-1');
    const first = rows[0].header.querySelector('.director_fate_mark');
    assert.equal(first.classList.contains('is_fresh'), true);
    lab.body.classList.add('reduced-motion');
    lab.marks.paintOne(1);
    assert.equal(first.classList.contains('is_fresh'), false);
    lab.body.classList.remove('reduced-motion');
    globalThis.matchMedia = () => ({ matches: true });
    lab.marks.pulse('fate-2');
    const second = rows[1].header.querySelector('.director_fate_mark');
    assert.equal(second.classList.contains('is_fresh'), false);
    lab.marks.paintOne(2);
    assert.equal(second.classList.contains('is_fresh'), false);
    globalThis.matchMedia = () => ({ matches: false });
    lab.html.classList.add('director_fate_nomotion');
    lab.marks.pulse('fate-3');
    const third = rows[2].header.querySelector('.director_fate_mark');
    assert.equal(third.classList.contains('is_fresh'), false);
    lab.marks.paintAll();
    assert.equal([...rows].every(row => !row.header.querySelector('.director_fate_mark').classList.contains('is_fresh')), true);
});

test('a missing matchMedia implementation does not throw and still pulses when motion is allowed', t => {
    const lab = fixture(t);
    const row = lab.addMessage(1);
    globalThis.matchMedia = undefined;
    lab.marks.pulse('fate-1');
    const mark = row.header.querySelector('.director_fate_mark');
    assert.equal(mark.classList.contains('is_fresh'), true);
    lab.context.chatId = 'rematch';
    globalThis.matchMedia = () => undefined;
    lab.marks.pulse('fate-1');
    assert.equal(mark.classList.contains('is_fresh'), true);
});

test('log and marks use bounded index reads on a 2000-message Proxy chat without traversal', t => {
    const tree = dom(t);
    const stats = { indexes: 0, scans: 0 };
    const messages = Array.from({ length: 2000 }, (_, index) => ({ is_user: index % 2 === 0, name: 'Story', mes: `Line ${index}` }));
    const scans = new Set(['map', 'forEach', 'slice', 'filter', 'reduce', 'find', 'some', 'every', 'entries', 'keys', 'values', 'at']);
    const chat = new Proxy(messages, {
        get(target, property, receiver) {
            if (typeof property === 'string' && /^\d+$/.test(property)) stats.indexes++;
            if (property === Symbol.iterator || scans.has(property)) {
                stats.scans++;
                throw new Error('Full chat traversal is forbidden');
            }
            return Reflect.get(target, property, receiver);
        },
    });
    const log = Array.from({ length: 50 }, (_, index) => {
        const slotIndex = 1999 - index * 2;
        tree.addMessage(slotIndex);
        return { id: `log-${index}`, category: 'echo', title: '意外的回声', rarity: 'common', strength: 'light', event: secret,
            slotIndex, prevFingerprint: messageFingerprint(messages[slotIndex - 1]), generationId: `generation-${index}`,
            at: '2026-11-04T00:00:00.000Z', replays: 0 };
    });
    const eventSource = new EventEmitter();
    const eventTypes = Object.fromEntries(['CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED',
        'GENERATE_AFTER_DATA', 'GENERATION_COMPLETED', 'MESSAGE_RECEIVED'].map(name => [name, name]));
    const context = { chat, chatId: 'long', chatMetadata: { director: { fate: { version: 1, log } } },
        eventSource, eventTypes, extensionPrompts: {}, groupId: null, characterId: 0 };
    const controller = createFateController(() => context);
    const marks = createFateMarks({ getContext: () => context, getEntries: controller.log, onOpen() {} });
    const entries = controller.log();
    assert.equal(entries.length, 50);
    assert.equal(entries.every(value => value.status === 'ok'), true);
    assert.ok(stats.indexes <= entries.length * 2, `${stats.indexes} log reads`);
    stats.indexes = 0;
    marks.paintOne(1999);
    assert.equal(stats.indexes, 2, 'cold paintOne checks only its target and predecessor');
    stats.indexes = 0;
    marks.paintOne(1999);
    assert.equal(stats.indexes, 0, 'repeated paintOne reuses its partial cache');
    marks.paintOne(1997);
    assert.equal(stats.indexes, 2, 'a second uncached slot checks only its own anchor');
    stats.indexes = 0;
    marks.paintOne(1998);
    assert.equal(stats.indexes, 0, 'a slot without a log entry does not read chat indexes');
    marks.invalidate();
    marks.paintOne(1999);
    assert.equal(stats.indexes, 2, 'invalidated paintOne stays within two reads');
    stats.indexes = 0;
    marks.paintAll();
    assert.ok(stats.indexes <= entries.length * 2, `${stats.indexes} paintAll reads`);
    assert.equal(tree.document.querySelectorAll('#chat .director_fate_mark').length, 50);
    stats.indexes = 0;
    marks.paintOne(1999);
    assert.ok(stats.indexes <= 2, `${stats.indexes} paintOne reads`);
    marks.invalidate();
    stats.indexes = 0;
    marks.paintAll();
    assert.ok(stats.indexes <= entries.length * 2, `${stats.indexes} invalidated paintAll reads`);
    assert.equal(stats.scans, 0);
});

test('a displayed swipe without the recorded event drops the mark until that swipe returns', t => {
    const tree = dom(t);
    tree.addMessage(1);
    const previous = { is_user: true, name: 'User', mes: 'What happens next?' };
    const message = { is_user: false, name: 'Bot', mes: 'A completed reply.', swipe_id: 0, extra: { gen_id: 1 } };
    const logged = {
        id: 'saved-card', category: 'echo', title: '尘封的低语', strength: 'medium', rarity: 'rare', event: secret,
        slotIndex: 1, prevFingerprint: messageFingerprint(previous), generationId: 1,
        at: '2026-01-01T00:00:00.000Z', replays: 0, swipeIds: [0],
    };
    const context = {
        chat: [previous, message], chatId: 'swipe-mark', chatMetadata: { director: { fate: { version: 1, log: [logged] } } },
        eventSource: new EventEmitter(), eventTypes: {}, extensionPrompts: {}, groupId: null, characterId: 0,
    };
    const controller = createFateController(() => context);
    const marks = createFateMarks({ getContext: () => context, getEntries: controller.log, onOpen() {} });
    marks.paintAll();
    assert.ok(tree.document.querySelector('#chat .director_fate_mark'));
    message.swipe_id = 1;
    marks.invalidate();
    marks.paintOne(1);
    assert.equal(tree.document.querySelector('#chat .director_fate_mark'), null);
    assert.equal(controller.log()[0].status, 'changed');
    message.swipe_id = 0;
    marks.invalidate();
    marks.paintOne(1);
    const restored = tree.document.querySelector('#chat .director_fate_mark');
    assert.ok(restored);
    assert.equal(restored.getAttribute('aria-label'), '命运牌：〈尘封的低语〉，稀有');
    assert.equal(restored.querySelector('.director_fate_mark_emblem').dataset.silhouette, 'gem');
    assert.equal(restored.querySelector('.director_fate_mark_label'), null);
    assert.equal(controller.log()[0].status, 'ok');
    assert.equal(serialized(tree.document.querySelector('#chat .mes_text')).includes(secret), false);
});

const source = readFileSync(new URL('../public/scripts/extensions/director/index.js', import.meta.url), 'utf8');
const jumpSource = source.slice(source.indexOf('async function jumpToMessage('), source.indexOf('\nasync function jumpToChapter('));

test('completion reveal invalidates a warmed cache before its microtask paints and pulses', async t => {
    const lab = fixture(t, []);
    const row = lab.addMessage(1);
    lab.marks.paintAll();
    assert.equal(lab.reads, 1);
    // commit publishes the completed log before its pending save calls onChange.
    lab.setEntries([entry(1)]);
    const callback = source.match(/onReveal: (card => \{[\s\S]*?)\n        \},\n    \}\);/);
    assert.ok(callback, 'completion reveal callback must remain wired');
    const onReveal = new Function('fateMarks', 'toastr', 'fatePanel', `return ${callback[1]}\n};`)(
        lab.marks, { info() {} }, { open: async () => {} },
    );
    onReveal({ id: 'fate-1', title: '涟漪', slotIndex: 1 });
    assert.equal(row.header.querySelector('.director_fate_mark'), null);
    await Promise.resolve();
    const mark = row.header.querySelector('.director_fate_mark');
    assert.ok(mark);
    assert.equal(mark.classList.contains('is_fresh'), true);
    assert.equal(serialized(lab.html).includes(secret), false);
});

function jumpLab(t, { first = 900, length = 1000, confirm = true } = {}) {
    const tree = dom(t);
    tree.addMessage(first);
    const context = { chat: { length }, chatId: 'one' };
    const confirmations = [];
    const loaded = [];
    const warnings = [];
    const timers = [];
    let current = context;
    const dependencies = {
        closePopover() {}, getContext: () => current, chatRevision: 0,
        isCurrentChat: owner => owner === current,
        loadedMessageRange: () => {
            const node = tree.document.querySelector('#chat .mes');
            return node ? Number(node.getAttribute('mesid')) : null;
        },
        messagesBeforeLoadedRange: (start, target) => Math.max(0, start - target),
        needsLoadConfirm: distance => distance > 500,
        loadConfirmMessage: distance => `需要加载约 ${distance} 条消息`,
        POPUP_TYPE: { CONFIRM: 'confirm' }, POPUP_RESULT: { AFFIRMATIVE: 1 },
        showMoreMessages: async count => {
            loaded.push(count);
            const target = first - count;
            const row = tree.addMessage(target);
            row.message.remove();
            tree.chat.children.unshift(row.message);
            row.message.parentElement = tree.chat;
        },
        toastr: { warning: message => warnings.push(message) },
        setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    };
    context.callGenericPopup = async (...args) => { confirmations.push(args); return confirm ? 1 : 0; };
    const declarations = `const { ${Object.keys(dependencies).join(', ')} } = dependencies; let highlightToken = 0;`;
    const jump = new Function('dependencies', `${declarations}\n${jumpSource}\nreturn jumpToMessage;`)(dependencies);
    return { ...tree, jump, context, confirmations, loaded, warnings, timers, switchChat: () => { current = { chat: { length } }; } };
}

test('chapter jumps keep their silent timer path and marks stay off the chapter scan', () => {
    const chapter = source.slice(source.indexOf('async function jumpToChapter('), source.indexOf('\nfunction showChapterList('));
    assert.match(chapter, /return jumpToMessage\(index, 'director-chapter-highlight', applyChapterDividers\);/);
    assert.equal(chapter.includes('warnMissing'), false);
    assert.equal(/animationend|transitionend/.test(chapter), false);
    const refreshStart = source.indexOf('const refreshChapters = () => {');
    const refreshEnd = source.indexOf('context.eventSource.on(type, refreshChapters);');
    const refreshBody = source.slice(refreshStart, refreshEnd);
    assert.equal(/fateMarks|paintOne|paintAll|director_fate_mark/.test(refreshBody), false);
    const wiring = source.slice(source.indexOf('// Marks have their own bounded work'), source.indexOf('chatRevision++;'));
    assert.match(wiring, /CHARACTER_MESSAGE_RENDERED, id => fateMarks\.paintOne\(id\)/);
    assert.match(wiring, /MESSAGE_UPDATED, context\.eventTypes\.MESSAGE_SWIPED/);
    assert.match(wiring, /fateMarks\.invalidate\(\);\s*fateMarks\.paintOne\(id\);\s*\/\/ Editing\/swiping the predecessor can invalidate the next anchor\.\s*fateMarks\.paintOne\(Number\(id\) \+ 1\);/);
    assert.match(wiring, /CHAT_CHANGED, context\.eventTypes\.MORE_MESSAGES_LOADED,\s*context\.eventTypes\.MESSAGE_DELETED, context\.eventTypes\.MESSAGE_EDITED/);
    assert.match(wiring, /fateMarks\.invalidate\(\);\s*fateMarks\.paintAll\(\);/);
});

test('generic jumps confirm distant loads, scroll and remove highlights with the existing 1500ms timer', async t => {
    const lab = jumpLab(t);
    assert.equal(await lab.jump(1, 'director-fate-highlight'), true);
    assert.equal(lab.confirmations.length, 1);
    assert.equal(lab.confirmations[0][0], '需要加载约 899 条消息');
    assert.deepEqual(lab.loaded, [899]);
    const row = lab.document.querySelector('#chat .mes[mesid="1"]');
    assert.deepEqual(row.scrolled, { block: 'center', inline: 'nearest' });
    assert.equal(row.classList.contains('director-fate-highlight'), true);
    assert.equal(lab.timers.length, 1);
    assert.equal(lab.timers[0].delay, 1500);
    lab.timers[0].callback();
    assert.equal(row.classList.contains('director-fate-highlight'), false);
    assert.equal(/animationend/.test(jumpSource), false);
    assert.equal(/setTimeout|setInterval/.test(readFileSync(new URL('../public/scripts/extensions/director/fate-marks.js', import.meta.url), 'utf8')), false);
});

test('generic jumps preserve loaded chapter callbacks and cancellation without loading', async t => {
    const lab = jumpLab(t, { first: 10, confirm: false });
    let beforeScroll = 0;
    assert.equal(await lab.jump(10, 'director-chapter-highlight', () => { beforeScroll++; }), true);
    assert.equal(beforeScroll, 1);
    const row = lab.document.querySelector('#chat .mes[mesid="10"]');
    assert.equal(row.classList.contains('director-chapter-highlight'), true);
    assert.equal(lab.confirmations.length, 0);
    assert.equal(await lab.jump(-1), false);
    assert.equal(await lab.jump(1000), false);
    assert.equal(await lab.jump(11), false);
    assert.deepEqual(lab.warnings, []);
    assert.deepEqual(lab.loaded, []);
});

test('chapter highlight cleanup works without animation events and protects the latest jump token', async t => {
    const lab = jumpLab(t, { first: 10 });
    const row = lab.document.querySelector('#chat .mes[mesid="10"]');
    lab.body.classList.add('reduced-motion');
    globalThis.matchMedia = () => ({ matches: true });
    assert.equal(await lab.jump(10, 'director-chapter-highlight'), true);
    assert.equal(lab.timers[0].delay, 1500);
    assert.equal(await lab.jump(10, 'director-chapter-highlight'), true);
    lab.timers[0].callback();
    assert.equal(row.classList.contains('director-chapter-highlight'), true);
    lab.timers[1].callback();
    assert.equal(row.classList.contains('director-chapter-highlight'), false);
});

test('a missing chapter target stays silent while Fate explicitly requests its warning', async t => {
    const lab = jumpLab(t, { first: 10 });
    assert.equal(await lab.jump(11, 'director-chapter-highlight'), false);
    assert.deepEqual(lab.warnings, []);
    assert.equal(await lab.jump(11, 'director-fate-highlight', () => {}, { warnMissing: true }), false);
    assert.deepEqual(lab.warnings, ['该消息未加载，请向上滚动']);
    assert.equal(lab.timers.length, 0);
});

test('distant jumps honor cancellation and a chat switch during confirmation', async t => {
    const lab = jumpLab(t, { confirm: false });
    assert.equal(await lab.jump(0), false);
    assert.deepEqual(lab.loaded, []);
    lab.context.callGenericPopup = async () => { lab.switchChat(); return 1; };
    assert.equal(await lab.jump(0), false);
    assert.deepEqual(lab.loaded, []);
});

test('generic jumps wait for the dialog to close before scrolling and stop if that changes chats', async t => {
    const lab = jumpLab(t, { first: 10 });
    const row = lab.document.querySelector('#chat .mes[mesid="10"]');
    let finishClose;
    const closing = new Promise(resolve => { finishClose = resolve; });
    const jumping = lab.jump(10, 'director-fate-highlight', () => closing);
    await Promise.resolve();
    assert.equal(row.scrolled, undefined);
    assert.equal(row.classList.contains('director-fate-highlight'), false);
    finishClose();
    assert.equal(await jumping, true);
    assert.deepEqual(row.scrolled, { block: 'center', inline: 'nearest' });
    lab.timers[0].callback();
    row.scrolled = undefined;

    let finishSecondClose;
    const secondClosing = new Promise(resolve => { finishSecondClose = resolve; });
    const secondJump = lab.jump(10, 'director-fate-highlight', () => secondClosing);
    await Promise.resolve();
    lab.switchChat();
    finishSecondClose();
    assert.equal(await secondJump, false);
    assert.equal(row.scrolled, undefined);
    assert.equal(row.classList.contains('director-fate-highlight'), false);
});
