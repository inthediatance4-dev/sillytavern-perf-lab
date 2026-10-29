import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
const rossSource = readFileSync(new URL('../public/scripts/RossAscends-mods.js', import.meta.url), 'utf8');
const helpersStart = source.indexOf('let requestId = null;');
const helpersEnd = source.indexOf('\n/**\n * @deprecated', helpersStart);
const handlersStart = source.indexOf("    const chatElementScroll = document.getElementById('chat');");
const handlersEnd = source.indexOf("\n    $(document).on('click', '.mes',", handlersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'application scroll helpers exist');
assert.ok(handlersStart >= 0 && handlersEnd > handlersStart, 'application scroll handlers exist');
const scrollSource = source.slice(helpersStart, helpersEnd).replace(/^export /gm, '');
const handlersSource = source.slice(handlersStart, handlersEnd);

// Run the real helpers and listeners with controllable frame, geometry and input boundaries.
function fixture() {
    const frames = new Map();
    const writes = [];
    const geometry = [];
    const created = [];
    const events = new Map();
    let nextFrameId = 0;
    let position = 1500;
    let height = 2000;
    let clientHeight = 500;
    class Element {
        listeners = new Map();
        attributes = new Map();
        editable = false;
        hidden = false;
        addEventListener(name, callback) {
            const listeners = this.listeners.get(name) ?? [];
            listeners.push(callback);
            this.listeners.set(name, listeners);
        }
        setAttribute(name, value) { this.attributes.set(name, value); }
        closest() { return this.editable ? this : null; }
        dispatch(name, data = {}) {
            const event = { target: this, ...data };
            for (const callback of this.listeners.get(name) ?? []) callback(event);
        }
    }
    const container = new Element();
    Object.defineProperties(container, {
        scrollTop: {
            get() { geometry.push('top'); return position; },
            set(value) {
                position = Math.min(Math.max(value, 0), height - clientHeight);
                writes.push(position);
            },
        },
        scrollHeight: { get() { geometry.push('height'); return height; } },
        clientHeight: { get() { geometry.push('client'); return clientHeight; } },
        offsetHeight: { get() { return clientHeight; } },
    });
    const composer = { children: [], append(element) { this.children.push(element); } };
    const context = vm.createContext({
        Element, HTMLElement: Element, AbortController,
        scrollLock: false,
        power_user: { auto_scroll_chat_to_bottom: true },
        chatElement: { 0: container },
        document: {
            getElementById(id) {
                if (id === 'chat') return container;
                assert.equal(id, 'form_sheld');
                return composer;
            },
            createElement(tag) {
                const element = new Element();
                element.tagName = tag.toUpperCase();
                created.push(element);
                return element;
            },
        },
        requestAnimationFrame(callback) {
            const id = nextFrameId++;
            frames.set(id, callback);
            return id;
        },
        cancelAnimationFrame(id) { frames.delete(id); },
        eventSource: { on(name, callback) { events.set(name, callback); } },
        event_types: { CHAT_CHANGED: 'changed' },
    });
    vm.runInContext(scrollSource + '\n' + handlersSource, context);
    const run = text => vm.runInContext(text, context);
    run('streamingScrollActive = true; readChatScrollPosition();');
    return {
        context, container, frames, writes, geometry, created, events, Element, run,
        get position() { return position; },
        get bottom() { return height - clientHeight; },
        get button() { return composer.children[0]; },
        userScroll(top) { position = top; },
        grow(amount) { height += amount; },
        resizeClient(amount) { clientHeight += amount; },
        frame() {
            assert.ok(frames.size, 'a frame must be queued');
            const [id, callback] = frames.entries().next().value;
            frames.delete(id);
            callback();
        },
    };
}

test('upward intent cancels a queued scroll, including frame id zero and a late callback', () => {
    const f = fixture();
    f.context.scrollChatToBottom({ waitForFrame: true });
    const late = f.frames.get(0);
    assert.equal(typeof late, 'function');
    f.container.dispatch('wheel', { deltaY: -100 });
    assert.equal(f.frames.size, 0);
    f.userScroll(f.bottom - 600);
    late();
    assert.equal(f.context.scrollLock, true);
    assert.deepEqual(f.writes, []);
});

test('a queued scroll rechecks a changed auto-scroll setting', () => {
    const f = fixture();
    f.context.scrollChatToBottom({ waitForFrame: true });
    f.context.power_user.auto_scroll_chat_to_bottom = false;
    f.grow(200);
    f.frame();
    assert.deepEqual(f.writes, []);
    assert.equal(f.position, 1500);
});

test('a scrollbar moving up before its delayed scroll event prevents the queued write', () => {
    const f = fixture();
    f.context.setChatScrollTop(f.bottom);
    f.container.dispatch('scroll');
    f.writes.length = 0;
    f.context.scrollChatToBottom({ waitForFrame: true });
    f.userScroll(f.bottom - 600);
    f.frame();
    assert.equal(f.context.scrollLock, true);
    assert.deepEqual(f.writes, []);
});

test('a final queued streaming scroll still respects upward motion after generation stops', () => {
    const f = fixture();
    f.context.scrollChatToBottom({ waitForFrame: true });
    f.run('streamingScrollActive = false;');
    f.userScroll(f.bottom - 600);
    f.frame();
    assert.equal(f.context.scrollLock, true);
    assert.deepEqual(f.writes, []);
    assert.equal(f.button.hidden, false);
});

test('position-preserving writes observe raw user motion before marking their scroll event', () => {
    const f = fixture();
    f.userScroll(f.bottom - 600);
    f.context.setChatScrollTop(f.position);
    f.container.dispatch('scroll');
    assert.equal(f.context.scrollLock, true, 'upward motion is retained before a programmatic marker');
    assert.equal(f.button.hidden, false);
    f.userScroll(f.bottom - 20);
    f.context.setChatScrollTop(f.position);
    f.container.dispatch('scroll');
    assert.equal(f.context.scrollLock, false, 'returning near the bottom is retained before the marker');
    assert.equal(f.button.hidden, true);
});

test('programmatic scroll events cannot resume a reader who is paused', () => {
    const f = fixture();
    f.container.dispatch('wheel', { deltaY: -100 });
    f.run('prepareStreamingScroll();');
    f.context.setChatScrollTop(f.bottom);
    f.container.dispatch('scroll');
    assert.equal(f.context.scrollLock, true);
    assert.equal(f.button.hidden, false);
});

test('DOM growth without upward movement keeps following even beyond the bottom tolerance', () => {
    const f = fixture();
    f.grow(800);
    f.container.dispatch('scroll');
    f.run('prepareStreamingScroll();');
    assert.equal(f.context.scrollLock, false);
    assert.equal(f.created.length, 0);
    f.context.scrollChatToBottom({ waitForFrame: true });
    f.frame();
    assert.equal(f.position, f.bottom);
});

test('a native clamp to the new bottom after content shrinks keeps following', () => {
    const f = fixture();
    f.grow(-100);
    f.userScroll(f.bottom);
    f.container.dispatch('scroll');
    f.run('prepareStreamingScroll();');
    assert.equal(f.context.scrollLock, false);
    assert.equal(f.created.length, 0, 'layout clamping does not expose pending content');
    f.grow(200);
    f.context.scrollChatToBottom();
    assert.equal(f.position, f.bottom);
});

test('content growth cannot conceal a raw user scroll upward before its event', () => {
    const f = fixture();
    f.context.scrollChatToBottom({ waitForFrame: true });
    f.grow(200);
    f.userScroll(f.position - 600);
    f.frame();
    assert.equal(f.context.scrollLock, true);
    assert.deepEqual(f.writes, []);
    assert.equal(f.button.hidden, false);
});

test('final layout shrink near the bottom preserves following and explicit upward intent', () => {
    for (const paused of [false, true]) {
        const f = fixture();
        if (paused) f.container.dispatch('wheel', { deltaY: -100 });
        f.grow(-100);
        f.userScroll(f.bottom - 23);
        f.container.dispatch('scroll');
        assert.equal(f.context.scrollLock, paused);
    }
});

test('last-message class transfer marks native anchoring without erasing prior user intent', () => {
    const start = source.indexOf('export function addOneMessage(');
    const end = source.indexOf('\n}', start) + 2;
    assert.ok(start >= 0 && end > start, 'application message insertion exists');
    for (const readingUp of [false, true]) {
        const f = fixture();
        const message = { mes: 'new streaming placeholder' };
        const rendered = {};
        const inserted = [];
        Object.assign(f.context, {
            chat: [message],
            SCROLL_BEHAVIOR: { ADJUST: 'adjust', NONE: 'none' },
            updateMessageElement: () => rendered,
            applyCharacterTagsToMessageDivs() {}, updateEditArrowClasses() {},
        });
        Object.assign(f.context.chatElement, {
            append(element) {
                inserted.push(element);
                f.grow(110);
            },
            find(selector) {
                assert.equal(selector, '.mes');
                return {
                    removeClass(name) {
                        assert.equal(name, 'last_mes');
                        // Removing the old tail's padding briefly clamps the viewport.
                        f.grow(-175);
                        f.userScroll(Math.min(f.position, f.bottom));
                    },
                    last: () => ({ addClass(name) {
                        assert.equal(name, 'last_mes');
                        f.grow(110);
                    } }),
                };
            },
        });
        f.run(source.slice(start, end).replace(/^export /, ''));
        if (readingUp) f.userScroll(f.position - 600);
        assert.equal(f.context.addOneMessage(message, { showSwipes: false }), rendered);
        assert.deepEqual(inserted, [rendered]);
        assert.equal(f.bottom, 1545, 'final geometry grows despite the intermediate clamp');
        if (!readingUp) assert.equal(f.position, 1435, 'native anchoring moved the viewport upward');
        f.container.dispatch('scroll');
        assert.equal(f.context.scrollLock, readingUp);
        f.frame();
        if (readingUp) {
            assert.deepEqual(f.writes, [], 'insertion cannot conceal user intent before its DOM writes');
        } else {
            assert.equal(f.position, f.bottom, 'the delayed native event must permit the queued bottom scroll');
            assert.equal(f.created.length, 0);
        }
    }
});

test('Ross resize corrections cannot move a paused or auto-scroll-disabled streaming reader', () => {
    const start = rossSource.indexOf("    const cssAutofit = CSS.supports('field-sizing', 'content');");
    const end = rossSource.indexOf("\n    sendTextArea.addEventListener('input',", start);
    assert.ok(start >= 0 && end > start, 'application chat resize observer exists');
    for (const phase of ['streaming', 'pending']) {
        for (const mode of ['paused', 'auto-off', 'following']) {
            const f = fixture();
            let onResize;
            Object.assign(f.context, {
                chatBlock: f.container,
                CSS: { supports: () => true },
                ResizeObserver: class {
                    constructor(callback) { onResize = callback; }
                    observe(target) { assert.equal(target, f.container); }
                },
            });
            f.run(rossSource.slice(start, end));
            if (mode === 'paused') {
                f.userScroll(f.position - 600);
                f.container.dispatch('scroll');
            } else if (mode === 'auto-off') {
                f.context.power_user.auto_scroll_chat_to_bottom = false;
            }
            f.run('prepareStreamingScroll();');
            if (phase === 'pending') f.run('streamingScrollActive = false;');
            const original = f.position;
            f.resizeClient(-19);
            onResize([{ target: f.container }]);
            if (mode === 'following') {
                assert.equal(f.position, original + 19, `${phase}: following preserves the viewport bottom`);
                assert.deepEqual(f.writes, [original + 19]);
            } else {
                assert.equal(f.position, original, `${phase}/${mode}: typing resize preserves the reader's position`);
                assert.deepEqual(f.writes, []);
            }
        }
    }
});

test('returning within 40 pixels resumes following and dismisses pending content', () => {
    const f = fixture();
    f.userScroll(f.bottom - 600);
    f.container.dispatch('scroll');
    f.run('prepareStreamingScroll();');
    assert.equal(f.button.hidden, false);
    f.userScroll(f.bottom - 41);
    f.container.dispatch('scroll');
    assert.equal(f.context.scrollLock, true);
    f.userScroll(f.bottom - 40);
    f.container.dispatch('scroll');
    assert.equal(f.context.scrollLock, false);
    assert.equal(f.button.hidden, true);
    f.grow(100);
    f.context.scrollChatToBottom();
    assert.equal(f.position, f.bottom);
});

test('a coalesced scroll event at the old bottom cannot erase explicit upward intent', () => {
    const f = fixture();
    f.container.dispatch('wheel', { deltaY: -1 });
    f.container.dispatch('scroll');
    assert.equal(f.context.scrollLock, true);
    f.run('prepareStreamingScroll();');
    assert.equal(f.button.hidden, false);
});

test('new-content button is lazy, accessible and remains available after streaming finishes', () => {
    const f = fixture();
    f.run('prepareStreamingScroll();');
    assert.equal(f.created.length, 0, 'normal following adds no DOM');
    f.container.dispatch('wheel', { deltaY: -100 });
    f.userScroll(f.bottom - 600);
    f.run('prepareStreamingScroll();');
    assert.equal(f.button.tagName, 'BUTTON');
    assert.equal(f.button.type, 'button');
    assert.equal(f.button.textContent, '↓ 新内容');
    assert.ok(f.button.attributes.get('aria-label'));
    f.run('streamingScrollActive = false; updateChatNewContentButton();');
    assert.equal(f.button.hidden, false);
    f.button.dispatch('click');
    assert.equal(f.position, f.bottom);
    assert.equal(f.context.scrollLock, false);
    assert.equal(f.button.hidden, true);
    assert.equal(f.created.length, 1);
});

test('auto-scroll off allows only the explicit new-content button to scroll', () => {
    const f = fixture();
    f.context.power_user.auto_scroll_chat_to_bottom = false;
    f.grow(300);
    f.run('prepareStreamingScroll();');
    f.context.scrollChatToBottom();
    f.context.scrollChatToBottom({ waitForFrame: true });
    assert.equal(f.frames.size, 0);
    assert.deepEqual(f.writes, []);
    assert.equal(f.button.hidden, false);
    f.userScroll(f.bottom - 600);
    f.button.dispatch('click');
    assert.equal(f.position, f.bottom);
    assert.equal(f.context.scrollLock, false);
    assert.equal(f.button.hidden, true);
    f.writes.length = 0;
    f.grow(100);
    f.run('prepareStreamingScroll();');
    f.context.scrollChatToBottom();
    assert.deepEqual(f.writes, []);
    assert.equal(f.button.hidden, false);
});

test('only vertical single-finger downward gestures pause following', () => {
    const touch = (x, y, identifier = 7) => ({ identifier, clientX: x, clientY: y });
    for (const [name, moved, expected] of [
        ['down', [touch(10, 30)], true],
        ['up', [touch(10, 0)], false],
        ['tap', [touch(10, 13)], false],
        ['sideways', [touch(100, 30)], false],
        ['other finger', [touch(10, 30, 8)], false],
        ['pinch', [touch(10, 30), touch(20, 40, 8)], false],
    ]) {
        const f = fixture();
        f.container.dispatch('touchstart', { touches: [touch(10, 10)] });
        f.container.dispatch('touchmove', { touches: moved });
        assert.equal(f.context.scrollLock, expected, name);
        f.container.dispatch('touchend');
        f.context.scrollLock = false;
        f.container.dispatch('touchmove', { touches: [touch(10, 50)] });
        assert.equal(f.context.scrollLock, false, 'ended gesture cannot retain intent');
    }
});

test('upward navigation keys pause chat following without intercepting editable input', () => {
    for (const key of ['PageUp', 'ArrowUp', 'Home']) {
        const f = fixture();
        const textarea = new f.Element();
        textarea.editable = true;
        let prevented = 0;
        f.container.dispatch('keydown', { key, target: textarea, preventDefault() { prevented++; } });
        assert.equal(f.context.scrollLock, false, `${key} in a textarea`);
        assert.equal(prevented, 0);
        f.container.dispatch('keydown', { key });
        assert.equal(f.context.scrollLock, true, `${key} in chat`);
    }
    const f = fixture();
    f.container.dispatch('keydown', { key: 'a' });
    f.container.dispatch('wheel', { deltaY: 100 });
    assert.equal(f.context.scrollLock, false);
});

test('a chat change resets following and preserves the fresh navigation scroll', () => {
    const f = fixture();
    f.container.dispatch('wheel', { deltaY: -100 });
    f.run('prepareStreamingScroll();');
    f.context.scrollChatToBottom({ waitForFrame: true });
    f.events.get('changed')();
    assert.equal(f.frames.size, 1, 'printMessages queued the navigation scroll before CHAT_CHANGED');
    assert.equal(f.context.scrollLock, false);
    assert.equal(f.button.hidden, true);
    assert.equal(f.run('streamingScrollActive'), false);
    assert.equal(f.run('streamingContentPending'), false);
    f.grow(100);
    f.frame();
    assert.equal(f.position, f.bottom);
});

test('streaming paints read chat geometry before reasoning and message DOM writes', async () => {
    const start = source.indexOf('class StreamingProcessor {');
    const end = source.indexOf('\n}', start) + 2;
    assert.ok(start >= 0 && end > start, 'application streaming processor exists');
    for (const path of ['final', 'coalesced']) {
        const f = fixture();
        const tasks = [];
        const message = new f.Element();
        const text = new f.Element();
        message.querySelector = selector => selector === '.mes_text' ? text : null;
        f.context.document.querySelector = selector => selector === '#send_textarea' ? {} : message;
        Object.assign(f.context, {
            console: { warn() {}, error(error) { throw error; } },
            chat: [{ mes: 'previous', name: 'Synthetic', extra: {} }],
            streamingPerfEnabled: false,
            performance: { now: () => 0 },
            cleanUpMessage: ({ getMessage }) => getMessage,
            countOccurrences: () => 0,
            isOdd: count => count % 2 === 1,
            messageFormatting: text => text,
            replaceStreamingHtml() { f.geometry.push('message-write'); return 'full'; },
            recordStreamingDomMode() {}, recordStreamingDomFrame() {},
            getStoppingStrings: () => [], main_api: 'openai',
            Stopwatch: class { async tick(callback) { await callback(); } },
            ReasoningHandler: class {
                reasoning = '';
                updateDom() { f.geometry.push('reasoning-write'); }
                updateReasoning() {}
                setStreamDomScheduler() {}
                async process() {}
                applyStreamingDom() { f.geometry.push('reasoning-write'); return 0; }
            },
            MessageChannel: class {
                constructor() {
                    this.port1 = {};
                    this.port2 = { postMessage: () => tasks.push(() => this.port1.onmessage()) };
                }
            },
        });
        f.context.eventSource.emit = async () => {};
        f.run(source.slice(start, end) + '\nglobalThis.StreamingProcessor = StreamingProcessor;');
        const processor = new f.context.StreamingProcessor('normal', false, new Date(0), '', {});
        processor.messageId = 0;
        if (path === 'coalesced') {
            processor.generator = async function* () { yield { text: 'new text' }; };
            await processor.generate();
            f.geometry.length = 0;
            f.frame();
            assert.equal(tasks.length, 1);
            tasks.shift()();
        } else {
            f.geometry.length = 0;
            await processor.onProgressStreaming(0, 'new text', true);
        }
        const firstWrite = f.geometry.findIndex(value => value.endsWith('-write'));
        assert.ok(firstWrite >= 0, `${path} performs a DOM write`);
        assert.ok(f.geometry.slice(0, firstWrite).includes('height'), `${path} reads old scrollHeight`);
        assert.ok(f.geometry.slice(0, firstWrite).includes('client'), `${path} reads old clientHeight`);
        assert.ok(f.geometry.slice(0, firstWrite).includes('top'), `${path} reads old scrollTop`);
        assert.ok(f.geometry.includes('message-write'), `${path} paints message text`);
    }
});
