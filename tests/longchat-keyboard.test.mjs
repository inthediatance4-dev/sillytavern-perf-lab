import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/scripts/keyboard.js', import.meta.url), 'utf8').replace(/^export /gm, '');

function keyboard() {
    const frames = [];
    const records = [];
    let callback;
    let observed;
    class Element {
        nodeType = 1;
        parentElement = null;
        children = [];
        attributes = new Map();
        scans = 0;
        writes = [];
        listeners = [];
        constructor(classes = [], attributes = {}) {
            const values = new Set(classes);
            this.classList = {
                contains: value => values.has(value),
                add: value => {
                    if (values.has(value)) return;
                    values.add(value);
                    this.changed('class');
                },
                remove: value => {
                    if (values.delete(value)) this.changed('class');
                },
            };
            this.attributes = new Map(Object.entries(attributes));
        }
        get isConnected() { return this === body || !!this.parentElement?.isConnected; }
        changed(name) {
            if (this.isConnected && observed?.attributeFilter.includes(name)) {
                records.push({ type: 'attributes', target: this, attributeName: name });
            }
        }
        append(child) {
            child.parentElement = this;
            this.children.push(child);
            if (this.isConnected) records.push({ type: 'childList', addedNodes: [child] });
            return child;
        }
        matches(selector) {
            if (selector === '.extension-parent .extension-child') {
                return this.classList.contains('extension-child') && !!this.parentElement?.closest('.extension-parent');
            }
            return /^\.[\w-]+$/.test(selector) && this.classList.contains(selector.slice(1));
        }
        closest(selector) {
            for (let node = this; node; node = node.parentElement) {
                if (selector.split(',').some(part => node.matches(part.trim()))) return node;
            }
            return null;
        }
        querySelectorAll(selector) {
            this.scans++;
            const matches = [];
            const visit = root => {
                for (const child of root.children) {
                    if (child.matches(selector)) matches.push(child);
                    visit(child);
                }
            };
            visit(this);
            return matches;
        }
        hasAttribute(name) { return this.attributes.has(name); }
        getAttribute(name) { return this.attributes.get(name) ?? null; }
        setAttribute(name, value) {
            this.writes.push([name, String(value)]);
            this.attributes.set(name, String(value));
            this.changed(name);
        }
        removeAttribute(name) {
            this.writes.push([name, null]);
            this.attributes.delete(name);
            this.changed(name);
        }
        addEventListener(name) { this.listeners.push(name); }
    }
    const body = new Element();
    const document = { body, scans: 0, addEventListener() {}, querySelectorAll(selector) {
        this.scans++;
        return body.querySelectorAll(selector);
    } };
    const context = vm.createContext({
        Element, HTMLElement: Element, Node: { ELEMENT_NODE: 1 }, document,
        CSS: { supports: () => false },
        MutationObserver: class {
            constructor(handler) { callback = handler; }
            observe(target, options) { assert.equal(target, body); observed = options; }
        },
        requestAnimationFrame: handler => { frames.push(handler); return frames.length; },
    });
    vm.runInContext(source, context);
    context.initKeyboard();
    return { context, body, document, Element, frames, records, get observed() { return observed; },
        deliver() { if (records.length) callback(records.splice(0)); },
        frame() { assert.ok(frames.length, 'a frame must be scheduled'); frames.shift()(); },
    };
}

test('observer coalesces callbacks, covers roots and descendants, and scans no document after startup', () => {
    const lab = keyboard();
    const initialScans = lab.document.scans;
    const root = lab.body.append(new lab.Element(['interactable']));
    const child = root.append(new lab.Element(['interactable']));
    lab.deliver();
    root.classList.add('other');
    lab.deliver();
    assert.equal(lab.frames.length, 1);
    assert.equal(root.getAttribute('tabindex'), null);
    lab.frame();
    assert.equal(root.getAttribute('tabindex'), '0');
    assert.equal(child.getAttribute('tabindex'), '0');
    assert.ok(root.scans > 0);
    assert.equal(child.scans, 0, 'queued descendant is covered by its ancestor');
    assert.equal(lab.document.scans, initialScans);
    lab.deliver();
    assert.equal(lab.frames.length, 0, 'tabindex writes do not schedule another round');
});

test('detached roots and non-element added nodes do no work', () => {
    const lab = keyboard();
    const root = lab.body.append(new lab.Element(['interactable']));
    lab.records.push({ type: 'childList', addedNodes: [{ nodeType: 3 }] });
    lab.deliver();
    root.parentElement = null;
    lab.frame();
    assert.equal(root.scans, 0);
    assert.deepEqual(root.writes, []);
});

test('ancestor queued after a child covers it, and generated interactable classes settle', () => {
    const lab = keyboard();
    const parent = lab.body.append(new lab.Element());
    lab.deliver();
    lab.frame();
    const child = parent.append(new lab.Element(['menu_button']));
    lab.deliver();
    parent.classList.add('changed');
    lab.deliver();
    const scans = parent.scans;
    lab.frame();
    assert.ok(parent.scans > scans);
    assert.equal(child.scans, 0);
    assert.equal(child.getAttribute('tabindex'), '0');
    assert.equal(child.classList.contains('interactable'), true);
    lab.deliver();
    assert.equal(lab.frames.length, 1, 'generated class is observed');
    lab.frame();
    lab.deliver();
    assert.equal(lab.frames.length, 0, 'no repeated class or tabindex churn');
});

test('late classes and ancestor disabled/not_focusable toggles preserve subtree semantics', () => {
    const lab = keyboard();
    const parent = lab.body.append(new lab.Element());
    const child = parent.append(new lab.Element());
    lab.deliver();
    lab.frame();
    child.classList.add('interactable');
    lab.deliver();
    lab.frame();
    assert.equal(child.getAttribute('tabindex'), '0');
    for (const name of ['disabled', 'not_focusable']) {
        parent.classList.add(name);
        lab.deliver();
        lab.frame();
        assert.equal(child.getAttribute('tabindex'), null);
        assert.equal(child.getAttribute('data-original-tabindex'), '0');
        parent.classList.remove(name);
        lab.deliver();
        lab.frame();
        assert.equal(child.getAttribute('tabindex'), '0');
    }
});

test('registered descendant selectors and scroll reset containers are initialized in changed subtrees', () => {
    const lab = keyboard();
    lab.context.registerInteractableType('.extension-parent .extension-child');
    const parent = lab.body.append(new lab.Element());
    const child = parent.append(new lab.Element(['extension-child']));
    lab.deliver();
    lab.frame();
    assert.equal(child.getAttribute('tabindex'), null);
    parent.classList.add('extension-parent');
    lab.deliver();
    lab.frame();
    assert.equal(child.getAttribute('tabindex'), '0');
    const container = parent.append(new lab.Element(['scroll-reset-container']));
    lab.deliver();
    lab.frame();
    assert.deepEqual(container.listeners, ['focusout']);
});

test('filter follows the class-only contract and stable states avoid attribute writes', () => {
    const lab = keyboard();
    assert.deepEqual(Array.from(lab.observed.attributeFilter), ['class']);
    const control = lab.body.append(new lab.Element(['interactable'], { tabindex: '7' }));
    lab.deliver();
    lab.frame();
    assert.deepEqual(control.writes, []);
    control.setAttribute('disabled', '');
    lab.deliver();
    assert.equal(lab.frames.length, 0, 'native disabled was not observed by the original module');
    assert.equal(control.getAttribute('tabindex'), '7');
    control.classList.add('disabled');
    lab.deliver();
    lab.frame();
    assert.equal(control.getAttribute('data-original-tabindex'), '7');
    // Retain the original repeated-disabled-call semantics, including String(null).
    lab.context.makeKeyboardInteractable(control);
    assert.equal(control.getAttribute('data-original-tabindex'), 'null');
    control.writes.length = 0;
    lab.context.makeKeyboardInteractable(control);
    assert.deepEqual(control.writes, []);
    lab.deliver();
    assert.equal(lab.frames.length, 0);
});
