import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
const utils = readFileSync(new URL('../public/scripts/utils.js', import.meta.url), 'utf8');
const start = source.indexOf('class StreamingProcessor {');
const end = source.indexOf('\n/**\n * Constructs a prompt', start);
const clockStart = utils.indexOf('export class Stopwatch {');
const clockEnd = utils.indexOf('\n/**', clockStart + 20);
assert.ok(start >= 0 && end > start, 'real StreamingProcessor source exists');
assert.ok(clockStart >= 0 && clockEnd > clockStart, 'real Stopwatch source exists');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

// Exercise the application class and Stopwatch with a deterministic clock,
// frame queue and message delivery boundary. Formatting itself is covered by
// the browser equivalence/race suites; these assertions cover scheduling.
function fixture(optimized = true) {
    let now = 1000;
    let frameId = 0;
    let incoming = deferred();
    let processed = deferred();
    const frames = new Map();
    const cancelled = [];
    const tasks = [];
    const writes = [];
    const tokens = [];
    let channels = 0;
    class Element {
        innerHTML = '';
        classList = { toggle() {} };
        dispatchEvent() {}
    }
    const text = new Element();
    const timer = new Element();
    const counter = new Element();
    const textarea = new Element();
    const message = new Element();
    message.querySelector = selector => ({ '.mes_text': text, '.mes_timer': timer, '.tokenCounterDisplay': counter })[selector];
    const reasoning = new Element();
    class ReasoningHandler {
        reasoning = '';
        reasoningDisplayText = '';
        scheduler = null;
        setStreamDomScheduler(callback) { this.scheduler = callback; }
        updateReasoning(id, value = '') { this.reasoning = value; this.reasoningDisplayText = value; }
        updateDom() {}
        async process(id) {
            if (this.scheduler) this.scheduler(id);
            else this.applyStreamingDom(id, { incremental: false });
        }
        applyStreamingDom(id, options) {
            reasoning.innerHTML = this.reasoning;
            writes.push({ type: 'reasoning', text: this.reasoning, ...options });
            return 0;
        }
        getDuration() { return 0; }
    }
    class FakeDate extends Date {
        constructor(value = now) { super(value); }
        static now() { return now; }
    }
    const chat = [{ name: 'Fixture', mes: '...', is_user: false, is_system: false, extra: {} }];
    const context = vm.createContext({
        Date: FakeDate, performance: { now: () => now }, console: { warn() {}, error(error) { throw error; } },
        AbortController, HTMLElement: Element, Event, ReasoningHandler,
        chat, main_api: 'openai', scrollLock: true,
        power_user: { optimized_streaming: optimized, streaming_fps: 30, stream_fade_in: false },
        document: { querySelector: selector => selector === '#send_textarea' ? textarea : message },
        event_types: { STREAM_TOKEN_RECEIVED: 'token' },
        eventSource: { async emit(name, value) { if (name === 'token') tokens.push(value); } },
        getStoppingStrings: () => [],
        cleanUpMessage: ({ getMessage }) => getMessage,
        countOccurrences: (value, part) => value.split(part).length - 1,
        isOdd: value => value % 2 !== 0,
        prepareStreamingScroll() {}, scrollChatToBottom() {},
        streamingPerfEnabled: false, recordStreamingDomFrame() {}, recordStreamingDomMode() {},
        messageFormatting: value => `<p>${value}</p>`,
        formatGenerationTimer: () => ({ timerValue: '', timerTitle: '' }),
        replaceStreamingHtml(element, html, incremental) {
            element.innerHTML = html;
            writes.push({ type: 'content', text: html, incremental });
        },
        requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { if (frames.has(id)) cancelled.push(frames.get(id)); frames.delete(id); },
        MessageChannel: class {
            constructor() {
                channels++;
                this.port1 = {};
                this.port2 = { postMessage: data => tasks.push(() => this.port1.onmessage({ data })) };
            }
        },
    });
    vm.runInContext(`${utils.slice(clockStart, clockEnd).replace('export ', '')}\n${source.slice(start, end)}\nglobalThis.Processor = StreamingProcessor;`, context);
    const processor = new context.Processor('normal', false, new FakeDate(), '', {});
    processor.messageId = 0;
    processor.generator = async function* () {
        while (true) {
            const chunk = await incoming.promise;
            incoming = deferred();
            if (!chunk) return;
            yield chunk;
            processed.resolve();
        }
    };
    const run = processor.generate();
    return {
        processor, chat, text, reasoning, writes, frames, tasks, tokens,
        get channels() { return channels; },
        async tick(value, thought = '', elapsed = 0) {
            now += elapsed;
            processed = deferred();
            incoming.resolve({ text: value, state: { reasoning: thought } });
            await processed.promise;
        },
        frame() {
            now += 17;
            const ready = [...frames.values()];
            frames.clear();
            for (const callback of ready) callback(now);
        },
        staleFrames() { for (const callback of cancelled.splice(0)) callback(now); },
        task() { tasks.shift()?.(); },
        async close() { incoming.resolve(null); await run; },
    };
}

test('first content bypasses the initial Stopwatch interval and paints before any frame', async () => {
    const lab = fixture();
    await lab.tick('first');
    assert.equal(lab.text.innerHTML, '<p>first</p>');
    assert.equal(lab.frames.size, 0);
    assert.equal(lab.tasks.length, 0);
    assert.equal(lab.writes.find(item => item.type === 'content').incremental, false);
    await lab.tick('second', '', 34);
    assert.equal(lab.chat[0].mes, 'second');
    assert.equal(lab.text.innerHTML, '<p>first</p>');
    assert.equal(lab.frames.size, 1);
    lab.frame();
    assert.equal(lab.tasks.length, 1);
    assert.equal(lab.text.innerHTML, '<p>first</p>');
    lab.task();
    assert.equal(lab.text.innerHTML, '<p>second</p>');
    assert.equal(lab.writes.at(-1).incremental, true);
    assert.deepEqual(lab.tokens, ['first', 'second']);
    await lab.close();
});

test('reasoning and subsequent first message content each paint immediately', async () => {
    const lab = fixture();
    await lab.tick('', 'first thought');
    assert.equal(lab.reasoning.innerHTML, 'first thought');
    assert.equal(lab.frames.size, 0);
    await lab.tick('first content', 'first thought');
    assert.equal(lab.text.innerHTML, '<p>first content</p>');
    assert.equal(lab.frames.size, 0);
    await lab.tick('second content', 'second thought', 34);
    assert.equal(lab.text.innerHTML, '<p>first content</p>');
    assert.equal(lab.reasoning.innerHTML, 'first thought');
    lab.frame();
    lab.task();
    assert.equal(lab.text.innerHTML, '<p>second content</p>');
    assert.equal(lab.reasoning.innerHTML, 'second thought');
    await lab.close();
});

test('disabled optimization retains upstream Stopwatch and synchronous full writes without a channel', async () => {
    const lab = fixture(false);
    await lab.tick('too soon');
    assert.equal(lab.writes.length, 0);
    await lab.tick('first tick', '', 34);
    assert.equal(lab.text.innerHTML, '<p>first tick</p>');
    await lab.tick('second tick', '', 34);
    assert.equal(lab.text.innerHTML, '<p>second tick</p>');
    assert.equal(lab.channels, 0);
    assert.equal(lab.frames.size, 0);
    assert.equal(lab.tasks.length, 0);
    assert.ok(lab.writes.filter(item => item.type === 'content').every(item => !item.incremental));
    assert.deepEqual(lab.tokens, ['too soon', 'first tick', 'second tick']);
    await lab.close();
});

for (const kind of ['final', 'stop', 'error', 'abandon']) {
    for (const afterFrame of [false, true]) {
        test(`${kind} rejects stale ${afterFrame ? 'MessageChannel' : 'frame'} callbacks`, async () => {
            const lab = fixture();
            await lab.tick('first');
            await lab.tick('pending partial', '', 34);
            if (afterFrame) lab.frame();
            if (kind === 'final') await lab.processor.onProgressStreaming(0, 'final text', true);
            else if (kind === 'stop') lab.processor.onStopStreaming();
            else if (kind === 'error') {
                lab.processor.markUIGenStopped = () => {};
                lab.processor.onErrorStreaming();
            } else lab.processor.abandonStreamingDom();
            const writes = lab.writes.length;
            const html = lab.text.innerHTML;
            lab.staleFrames();
            lab.task();
            assert.equal(lab.writes.length, writes);
            assert.equal(lab.text.innerHTML, html);
            if (kind === 'final') assert.equal(html, '<p>final text</p>');
            else if (kind !== 'abandon') assert.equal(html, '<p>pending partial</p>');
            await lab.close();
        });
    }
}

test('a stale task cannot flush newer queued work after a synchronous token invalidation', async () => {
    const lab = fixture();
    await lab.tick('first');
    await lab.tick('old pending', '', 34);
    lab.frame();
    assert.equal(lab.tasks.length, 1);
    // The first visible reasoning update invalidates the old content-only task.
    await lab.tick('new immediate', 'first thought', 34);
    assert.equal(lab.text.innerHTML, '<p>new immediate</p>');
    await lab.tick('new pending', 'second thought', 34);
    lab.frame();
    assert.equal(lab.tasks.length, 2);
    const writes = lab.writes.length;
    lab.task();
    assert.equal(lab.writes.length, writes, 'stale task must not steal the new generation pending message');
    assert.equal(lab.text.innerHTML, '<p>new immediate</p>');
    lab.task();
    assert.equal(lab.text.innerHTML, '<p>new pending</p>');
    await lab.close();
});

test('abandonment while reasoning awaits prevents an in-flight tick from painting', async () => {
    const lab = fixture();
    await lab.tick('first');
    const entered = deferred();
    const resume = deferred();
    lab.processor.reasoningHandler.process = async () => {
        entered.resolve();
        await resume.promise;
    };
    const pending = lab.processor.onProgressStreaming(0, 'in-flight partial', false);
    await entered.promise;
    lab.processor.abandonStreamingDom();
    const writes = lab.writes.length;
    lab.text.innerHTML = 'selected chat sentinel';
    resume.resolve();
    await pending;
    lab.staleFrames();
    lab.task();
    assert.equal(lab.writes.length, writes);
    assert.equal(lab.text.innerHTML, 'selected chat sentinel');
    assert.equal(lab.frames.size, 0);
    await lab.close();
});
