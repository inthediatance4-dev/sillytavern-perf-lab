import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// The optional path runs the very same behavioral cases against the retained original.
const source = readFileSync(process.env.AUTOCOMPLETE_SOURCE ?? new URL('../public/scripts/autocomplete/AutoComplete.js', import.meta.url), 'utf8');
const utilsSource = readFileSync(new URL('../public/scripts/utils.js', import.meta.url), 'utf8');
const debounceStart = utilsSource.indexOf('export function debounce(');
const debounceSource = utilsSource.slice(debounceStart, utilsSource.indexOf('\n}', debounceStart) + 2).replace(/^export /, '');

function harness(t, { floating = true, attached = true, dialog = false, provider } = {}) {
    const observers = [];
    const mutations = [];
    const callbacks = new Map();
    let timerId = 0;
    let layoutReads = 0;
    const rect = { left: 20, right: 420, top: 200, bottom: 300, height: 100 };
    class Element extends EventTarget {
        children = [];
        parentElement = null;
        dataset = {};
        value = 'he';
        selectionStart = 2;
        selectionEnd = 2;
        scrollTop = 0;
        scrollLeft = 0;
        classes = new Set();
        style = { setProperty(key, value) { this[key] = value; }, getPropertyValue(key) { return this[key] ?? ''; } };
        classList = {
            add: (...names) => names.forEach(name => this.classes.add(name)),
            remove: (...names) => names.forEach(name => this.classes.delete(name)),
            toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
        };
        constructor(tag) { super(); this.tag = tag; }
        get isConnected() { return this === body || Boolean(this.parentElement?.isConnected); }
        append(...nodes) {
            for (const node of nodes) {
                if (!(node instanceof Element)) continue;
                node.remove();
                node.parentElement = this;
                this.children.push(node);
            }
        }
        remove() {
            if (!this.parentElement) return;
            const target = this.parentElement;
            target.children = target.children.filter(child => child !== this);
            this.parentElement = null;
            mutations.push({ target, removedNodes: [this] });
        }
        contains(node) { return this === node || this.children.some(child => child.contains(node)); }
        closest(selector) {
            if (selector.split(',').map(it => it.trim()).includes(this.tag)) return this;
            return this.parentElement?.closest(selector) ?? null;
        }
        getBoundingClientRect() { layoutReads++; return this.rect ?? rect; }
        set innerHTML(value) { this.children.forEach(child => child.parentElement = null); this.children = []; }
        querySelector() { return { children: [] }; }
    }
    const body = new Element('body');
    body.rect = { left: 0, right: 1000, top: 0, bottom: 800, height: 800 };
    const host = new Element(dialog ? 'dialog' : 'section'); body.append(host);
    if (dialog) host.rect = { left: 10, right: 850, top: 50, bottom: 750, height: 700 };
    const parent = new Element('div'); host.append(parent);
    const textarea = new Element('textarea'); if (attached) parent.append(textarea);
    const window = new EventTarget();
    window.innerWidth = 1000; window.innerHeight = 800;
    window.getComputedStyle = () => Object.assign(['whiteSpace', 'tabSize'], { whiteSpace: 'pre-wrap', tabSize: '4' });
    const document = {
        body, activeElement: textarea,
        createElement: tag => new Element(tag),
        createDocumentFragment: () => new Element('fragment'),
        querySelector: () => body,
    };
    class Observer {
        targets = new Map();
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(target, options) { assert.ok(target instanceof Element, 'MutationObserver requires an attached parent'); this.targets.set(target, options); }
        disconnect() { this.targets.clear(); }
    }
    const context = vm.createContext({
        document, window, Event, MutationObserver: Observer,
        power_user: { stscript: { matching: 'strict', autocomplete: { width: { left: 0, right: 2 }, select: 3 } } },
        setTimeout: callback => { const id = ++timerId; callbacks.set(id, callback); return id; },
        clearTimeout: id => callbacks.delete(id),
        escapeRegex: value => value,
        AutoCompleteSecondaryNameResult: class {},
    });
    vm.runInContext('const debounceMap = new WeakMap();\n' + debounceSource + '\n' + source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nthis.AutoComplete = AutoComplete;', context);
    const option = name => ({
        name, value: name, isSelectable: true,
        renderItem() { const li = new Element('li'); li.append(new Element('div')); return li; },
        renderDetails() { return new Element('p'); },
    });
    const getNameAt = provider ?? (async () => ({ name: 'he', start: 0, canBeQuoted: false, getSecondaryNameAt: () => null, optionList: [option('help'), option('hello')] }));
    const ac = new context.AutoComplete(textarea, () => true, getNameAt, floating);
    const flushCallbacks = () => {
        let count = 0;
        while (callbacks.size) {
            assert.ok(count++ < 50, 'queued work settles');
            const pending = [...callbacks.values()]; callbacks.clear();
            pending.forEach(callback => callback());
        }
    };
    const flushMutations = () => {
        const pending = mutations.splice(0);
        for (const observer of observers) {
            const matches = pending.filter(mutation => [...observer.targets].some(([target, opts]) => target === mutation.target || (opts.subtree && target.contains(mutation.target))));
            if (matches.length) observer.callback(matches);
        }
    };
    t.after(() => {
        for (const event of ['resize', 'keyup']) for (const listener of getEventListeners(window, event)) window.removeEventListener(event, listener);
        observers.forEach(observer => observer.disconnect());
        callbacks.clear();
    });
    return { ac, textarea, window, body, host, parent, observers, option, settings: context.power_user.stscript.autocomplete, flushCallbacks, flushMutations, callbacks, layoutReads: () => layoutReads };
}

for (const floating of [false, true]) {
    test(`removed ${floating ? 'floating' : 'normal'} input ignores resize and direct layout before observer delivery`, t => {
        const h = harness(t, { floating });
        h.textarea.remove();
        const before = h.layoutReads();
        h.window.dispatchEvent(new Event('resize'));
        assert.doesNotThrow(h.flushCallbacks);
        for (const method of ['updatePosition', 'updateDetailsPosition', 'updateFloatingPosition', 'updateFloatingDetailsPosition', 'getCursorPosition']) {
            assert.doesNotThrow(() => h.ac[method](), method);
        }
        assert.equal(h.layoutReads(), before, 'removed input is never measured');
        assert.equal(h.ac.getCursorPosition(), null);
        assert.equal(getEventListeners(h.window, 'resize').length, 0);
    });
}

test('removal releases clone, wrappers, observer and native window listener without another resize', t => {
    const h = harness(t);
    h.ac.getCursorPosition();
    assert.equal(h.observers.length, 1, 'layout and measurement share one observer');
    assert.deepEqual([...h.observers[0].targets.keys()], [h.parent, h.host, h.body]);
    assert.ok([...h.observers[0].targets.values()].every(options => options.childList && !options.subtree), 'only direct changes to owned ancestors are observed');
    const clone = h.ac.clone;
    h.body.append(h.ac.domWrap, h.ac.detailsWrap);
    h.textarea.remove(); h.flushMutations();
    assert.equal(clone.isConnected, false);
    assert.equal(h.ac.clone == null, true, 'measurement reference is released');
    assert.equal(h.ac.domWrap.isConnected, false);
    assert.equal(h.ac.detailsWrap.isConnected, false);
    assert.equal(getEventListeners(h.window, 'resize').length, 0);
    assert.ok(h.observers.every(observer => observer.targets.size === 0));
    h.ac.updatePosition(); h.ac.updatePosition(); h.ac.hide();
    assert.equal(getEventListeners(h.window, 'resize').length, 0, 'repeated cleanup stays empty');
});

test('ancestor removal releases resources and moving an attached input updates removal coverage', t => {
    const h = harness(t);
    h.ac.getCursorPosition();
    const next = new h.parent.constructor('section');
    h.body.append(next); next.append(h.textarea); h.flushMutations();
    assert.equal(getEventListeners(h.window, 'resize').length, 1, 'a connected move remains usable');
    next.remove(); h.flushMutations();
    assert.equal(getEventListeners(h.window, 'resize').length, 0, 'new ancestor removal is observed');
    assert.equal(h.ac.clone == null, true);
});

for (const delivered of [false, true]) {
    test(`queued render, details and layout callbacks cannot revive a removed input ${delivered ? 'after' : 'before'} removal delivery`, t => {
        const h = harness(t);
        h.ac.isActive = true; h.ac.isReplaceable = true;
        h.ac.result = [h.option('help')]; h.ac.result[0].dom = h.ac.result[0].renderItem(); h.ac.selectedItem = h.ac.result[0];
        for (const name of ['renderDebounced', 'renderDetailsDebounced', 'updatePositionDebounced', 'updateDetailsPositionDebounced', 'updateFloatingPositionDebounced']) h.ac[name]();
        h.textarea.remove();
        if (delivered) h.flushMutations();
        assert.doesNotThrow(h.flushCallbacks);
        assert.equal(h.ac.isActive, false);
        assert.equal(h.ac.domWrap.isConnected, false);
        assert.equal(h.ac.detailsWrap.isConnected, false);
        assert.equal(getEventListeners(h.window, 'resize').length, 0);
    });
}

test('async provider finishing after removal cannot schedule or reactivate autocomplete', async t => {
    let resolve;
    const h = harness(t, { provider: () => new Promise(done => resolve = done) });
    const showing = h.ac.show(true);
    h.textarea.remove(); h.flushMutations();
    resolve({ name: 'he', start: 0, canBeQuoted: false, optionList: [h.option('help')] });
    await showing;
    assert.equal(h.ac.isActive, false);
    assert.equal(h.callbacks.size, 0);
    assert.equal(getEventListeners(h.window, 'resize').length, 0);
});

test('old async provider cannot reactivate a new attachment after removal cleanup', async t => {
    let resolve;
    const h = harness(t, { provider: () => new Promise(done => resolve = done) });
    const showing = h.ac.show(true);
    h.textarea.remove(); h.flushMutations();
    h.parent.append(h.textarea);
    resolve({ name: 'he', start: 0, canBeQuoted: false, optionList: [h.option('help')] });
    await showing;
    assert.equal(h.ac.isActive, false);
    assert.equal(h.callbacks.size, 0);
});

test('removal settles and releases a pending own window keyup wait', async t => {
    const h = harness(t);
    const handling = h.ac.handleKeyDown({ key: 'ArrowLeft' });
    assert.equal(getEventListeners(h.window, 'keyup').length, 1);
    h.textarea.remove(); h.flushMutations();
    assert.equal(getEventListeners(h.window, 'keyup').length, 0);
    await handling;
    assert.equal(h.ac.isActive, false);
});

test('construction before attachment and reconnect after cleanup remain usable', async t => {
    const h = harness(t, { attached: false });
    assert.doesNotThrow(() => h.ac.updatePosition());
    assert.equal(getEventListeners(h.window, 'resize').length, 0);
    h.parent.append(h.textarea);
    await h.ac.show(true); h.flushCallbacks();
    assert.equal(h.ac.isActive, true);
    assert.equal(getEventListeners(h.window, 'resize').length, 1);
    h.textarea.remove(); h.flushMutations();
    h.parent.append(h.textarea);
    await h.ac.show(true); h.flushCallbacks();
    assert.equal(h.ac.isActive, true);
    assert.equal(h.ac.clone.isConnected, true);
    assert.equal(getEventListeners(h.window, 'resize').length, 1);
});

for (const floating of [false, true]) {
    test(`attached ${floating ? 'floating' : 'full-width'} dialog preserves parsing, positioning and keyboard selection`, async t => {
        const h = harness(t, { floating, dialog: true });
        await h.ac.show(true); h.flushCallbacks();
        assert.equal(h.ac.getLayer(), h.host);
        assert.equal(h.ac.domWrap.parentElement, h.host);
        assert.deepEqual(Array.from(h.ac.result, item => item.name), ['hello', 'help']);
        assert.equal(h.ac.selectedItem.name, 'hello');
        assert.ok(h.layoutReads() > 0);
        const evt = new Event('keydown', { cancelable: true }); Object.defineProperty(evt, 'key', { value: 'Tab' });
        await h.ac.handleKeyDown(evt);
        assert.equal(evt.defaultPrevented, true);
        assert.equal(h.textarea.value, 'hello');
        assert.equal(h.textarea.selectionStart, 5);
        h.window.dispatchEvent(new Event('resize')); assert.doesNotThrow(h.flushCallbacks);
        assert.equal(getEventListeners(h.window, 'resize').length, 1);
    });
}

for (const floating of [false, true]) {
    for (const dialog of [false, true]) {
        test(`attached ${floating ? 'floating' : 'full-width'} details position in ${dialog ? 'dialog' : 'body'} remains intact`, async t => {
            const h = harness(t, { floating, dialog });
            h.settings.width.left = 2; h.settings.width.right = 2;
            await h.ac.show(true); h.flushCallbacks();
            h.ac.isShowingDetails = true; h.ac.renderDetails(); h.flushCallbacks(); h.ac.updatePosition();
            const layer = dialog ? h.host : h.body;
            assert.equal(h.ac.detailsWrap.parentElement, layer);
            if (floating) {
                assert.equal(h.ac.detailsWrap.style['--targetOffset'], `${20 - layer.rect.left}`);
                assert.equal(h.ac.detailsWrap.style.top, `${300 - layer.rect.top}px`);
                assert.equal(h.ac.detailsWrap.classes.has('right'), true);
            } else {
                assert.equal(h.ac.domWrap.style['--leftOffset'], `max(1vw, ${layer.rect.left}px)`);
                assert.equal(h.ac.detailsWrap.style['--bottomOffset'], 'calc(100vh - 200px)');
            }
            h.ac.isReplaceable = false; h.ac.updateDetailsPosition();
            assert.equal(h.ac.detailsWrap.classes.has('full'), true);
            if (!floating) {
                assert.equal(h.ac.detailsWrap.style['--leftOffset'], `${layer.rect.left}px`);
                assert.equal(h.ac.detailsWrap.style['--rightOffset'], `calc(100vw - ${layer.rect.right}px)`);
            }
        });
    }
}
