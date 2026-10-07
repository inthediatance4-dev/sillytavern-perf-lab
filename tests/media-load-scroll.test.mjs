import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
const handlerUrl = new URL('../public/scripts/media-load-scroll.js', import.meta.url);
const handlerSource = existsSync(handlerUrl) ? readFileSync(handlerUrl, 'utf8').replace(/^export /gm, '') : '';

class ImageElement extends EventTarget {
    complete = false;
}
class MediaElement extends EventTarget {
    static HAVE_CURRENT_DATA = 2;
    readyState = 0;
}

function functionSource(name) {
    const start = script.search(new RegExp(`^export (?:async )?function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, `${name} exists in application source`);
    const end = script.indexOf('\n}', start);
    return script.slice(start, end + 2).replace(/^export /, '');
}

// Run the real application wrapper and clearChat with only browser/storage boundaries supplied.
function harness(t, media = []) {
    const fixtures = new Set(media);
    const timers = new Set();
    const timerCallbacks = [];
    const scrolls = [];
    const observations = { removed: 0, selectors: [] };
    let currentMedia = media;
    const context = vm.createContext({
        HTMLImageElement: ImageElement, HTMLMediaElement: MediaElement,
        Date, console: { debug() {} },
        setTimeout(callback, delay) {
            timerCallbacks.push(callback);
            const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
            timers.add(timer);
            return timer;
        },
        clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
        scrollLock: false, power_user: { auto_scroll_chat_to_bottom: true },
        scrollChatToBottom(options) { scrolls.push(options); },
        chatElement: {
            find(selector) { observations.selectors.push(selector); return { toArray: () => currentMedia }; },
            children() { return { remove() { observations.removed++; context.onRemove?.(); } }; },
        },
        cancelDebouncedChatSave() {}, cancelDebouncedMetadataSave() {}, closeMessageEditor() {},
        extension_prompts: {}, is_delete_mode: false,
        $: () => ({ length: 0 }),
        saveItemizedPrompts: async () => {}, getCurrentChatId: () => 'synthetic-media-chat',
        itemizedPrompts: [], chat: [],
    });
    // The legacy source has no singleton. This lets RED execute that old function directly.
    const singletonStart = script.indexOf('const mediaLoadScrollHandler =');
    const singleton = singletonStart === -1 ? '' : script.slice(singletonStart, script.indexOf('\n});', singletonStart) + 4);
    vm.runInContext([handlerSource, singleton, functionSource('scrollOnMediaLoad'), functionSource('clearChat')].join('\n'), context);
    t.after(() => {
        vm.runInContext('if (typeof mediaLoadScrollHandler !== "undefined") mediaLoadScrollHandler.cancel();', context);
        for (const timer of timers) clearTimeout(timer);
        for (const element of fixtures) {
            for (const event of ['load', 'loadeddata', 'error']) {
                for (const listener of getEventListeners(element, event)) element.removeEventListener(event, listener);
            }
        }
    });
    return { context, scrolls, observations, timers, timerCallbacks, setMedia(elements) {
        currentMedia = elements;
        for (const element of elements) fixtures.add(element);
    } };
}

const listenerCount = element => ['load', 'loadeddata', 'error'].reduce((count, event) => count + getEventListeners(element, event).length, 0);
const dispatch = (element, event) => element.dispatchEvent(new Event(event));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('wrapper does not pull a reader down when pending media settles after scrolling up', t => {
    const image = new ImageElement();
    const h = harness(t, [image]);
    h.context.scrollOnMediaLoad();
    h.context.scrollLock = true;
    dispatch(image, 'load');
    assert.equal(h.scrolls.length, 0, 'reading-up scrollLock must be consulted at settlement');
});

test('wrapper respects the current auto-scroll preference for already-ready media', t => {
    const image = new ImageElement(); image.complete = true;
    const h = harness(t, [image]);
    h.context.power_user.auto_scroll_chat_to_bottom = false;
    h.context.scrollOnMediaLoad();
    assert.equal(h.scrolls.length, 0);
});

test('repeated wrapper calls replace the batch without accumulating event listeners', t => {
    const image = new ImageElement();
    const h = harness(t, [image]);
    h.context.scrollOnMediaLoad();
    h.context.scrollOnMediaLoad();
    assert.equal(listenerCount(image), 2, 'one load and one error listener for the current batch');
    dispatch(image, 'error');
    assert.equal(h.scrolls.length, 1);
    assert.equal(listenerCount(image), 0);
});

test('a load followed by error cannot settle the same item twice while another item is pending', t => {
    const first = new ImageElement(), second = new ImageElement();
    const h = harness(t, [first, second]);
    h.context.scrollOnMediaLoad();
    dispatch(first, 'load');
    dispatch(first, 'error');
    assert.equal(h.scrolls.length, 0, 'the second image is still pending');
    assert.equal(listenerCount(first), 0, 'both listeners must be removed on first settlement');
    dispatch(second, 'error');
    assert.equal(h.scrolls.length, 1);
    assert.equal(listenerCount(second), 0);
});

test('the one-second wrapper deadline releases listeners even if no media event arrives', async t => {
    const image = new ImageElement();
    const h = harness(t, [image]);
    h.context.scrollOnMediaLoad();
    await sleep(1100);
    assert.equal(listenerCount(image), 0, 'expiry must clean up without an event');
    dispatch(image, 'load');
    assert.equal(h.scrolls.length, 0);
});

test('clearChat cancels the old batch before removing DOM and a new chat gets its own batch', async t => {
    const oldImage = new ImageElement(), newImage = new ImageElement();
    const h = harness(t, [oldImage]);
    h.context.scrollOnMediaLoad();
    let countAtRemoval;
    h.context.onRemove = () => { countAtRemoval = listenerCount(oldImage); };
    await h.context.clearChat();
    assert.equal(countAtRemoval, 0, 'cancel before removing the old chat DOM');
    assert.equal(h.observations.removed, 1);
    h.setMedia([newImage]);
    h.context.scrollOnMediaLoad();
    dispatch(oldImage, 'load');
    assert.equal(h.scrolls.length, 0, 'a retired chat cannot scroll the new one');
    dispatch(newImage, 'load');
    assert.equal(h.scrolls.length, 1);
});

test('wrapper keeps the message media selector and immediate ready-media scroll options', t => {
    const image = new ImageElement(), video = new MediaElement();
    image.complete = true; video.readyState = MediaElement.HAVE_CURRENT_DATA;
    const h = harness(t, [image, video]);
    h.context.scrollOnMediaLoad();
    assert.deepEqual(h.observations.selectors, ['.mes_block img, .mes_block video, .mes_block audio']);
    assert.equal(h.scrolls.length, 1);
    assert.equal(h.scrolls[0].waitForFrame, true);
    assert.equal(listenerCount(image) + listenerCount(video), 0);
    assert.equal(h.timers.size, 0);
});

test('empty media does not scroll and mixed image/audio/video waits for all pending items', t => {
    const h = harness(t);
    h.context.scrollOnMediaLoad();
    assert.equal(h.scrolls.length, 0);
    const image = new ImageElement(), audio = new MediaElement(), video = new MediaElement();
    h.setMedia([image, audio, video]);
    h.context.scrollOnMediaLoad();
    dispatch(image, 'error'); dispatch(audio, 'loadeddata');
    assert.equal(h.scrolls.length, 0);
    dispatch(video, 'error');
    assert.equal(h.scrolls.length, 1);
});

function handlerHarness(t, options = {}) {
    const h = harness(t);
    const scroll = options.scroll ?? (() => h.scrolls.push('scroll'));
    h.context.scrollChatToBottom = scroll;
    // Before the helper exists, exercise exactly the old application function for semantic RED.
    // The adapter supplies the intended track/cancel API without a missing-module failure.
    const handler = h.context.createMediaLoadScrollHandler
        ? h.context.createMediaLoadScrollHandler({ scroll, shouldScroll: () => true, ...options })
        : { track: () => h.context.scrollOnMediaLoad(), cancel: () => { void h.context.clearChat(); } };
    t.after(() => handler.cancel());
    return { ...h, handler, track(media) { h.setMedia(media); handler.track(media); } };
}

test('cancel is idempotent and releases every listener and timer without scrolling', t => {
    const image = new ImageElement(), audio = new MediaElement();
    const h = handlerHarness(t);
    h.track([image, audio]);
    h.handler.cancel(); h.handler.cancel();
    assert.equal(listenerCount(image) + listenerCount(audio), 0);
    assert.equal(h.timers.size, 0);
    dispatch(image, 'load'); dispatch(audio, 'error');
    assert.equal(h.scrolls.length, 0);
});

test('configured expiry removes all event handlers without a final media event', async t => {
    const image = new ImageElement(), video = new MediaElement();
    const h = handlerHarness(t, { timeoutMs: 20 });
    h.track([image, video]);
    await sleep(50);
    assert.equal(listenerCount(image) + listenerCount(video), 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.scrolls.length, 0);
});

test('a late event checks the deadline even when the expiry callback has not run', t => {
    const image = new ImageElement(), audio = new MediaElement();
    const h = handlerHarness(t, { timeoutMs: 20 });
    let now = 100;
    h.context.Date = { now: () => now };
    h.track([image, audio]);
    now = 121;
    dispatch(image, 'load');
    assert.equal(listenerCount(image) + listenerCount(audio), 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.scrolls.length, 0);
});

test('settlement clears both handlers and the timer before checking current permission', t => {
    const image = new ImageElement();
    let h, checked = 0;
    h = handlerHarness(t, { shouldScroll() {
        checked++;
        assert.equal(listenerCount(image), 0);
        assert.equal(h.timers.size, 0);
        return true;
    } });
    h.track([image]);
    dispatch(image, 'load'); dispatch(image, 'error');
    assert.equal(checked, 1);
    assert.equal(h.scrolls.length, 1);
});

test('ready media checks permission once and empty or unrecognized media never scrolls', t => {
    let checked = 0;
    const h = handlerHarness(t, { shouldScroll: () => { checked++; return true; } });
    const image = new ImageElement(); image.complete = true;
    const audio = new MediaElement(); audio.readyState = 2;
    h.track([]); h.track([new EventTarget()]);
    assert.equal(checked, 0);
    h.track([new EventTarget(), image, audio]);
    assert.equal(checked, 1);
    assert.equal(h.scrolls.length, 1);
    assert.equal(h.timers.size, 0);
});

test('an empty replacement cancels an unfinished batch without causing a scroll', t => {
    const image = new ImageElement();
    const h = handlerHarness(t);
    h.track([image]); h.track([]);
    assert.equal(listenerCount(image), 0);
    dispatch(image, 'load');
    assert.equal(h.scrolls.length, 0);
});

test('a cancelled batch timer cannot clean listeners from a newer batch', t => {
    const oldImage = new ImageElement(), newImage = new ImageElement();
    const h = handlerHarness(t);
    h.track([oldImage]);
    const oldExpiry = h.timerCallbacks[0];
    h.track([newImage]);
    oldExpiry?.(); // Model an expiry callback already queued before cancellation.
    assert.equal(listenerCount(oldImage), 0);
    assert.equal(listenerCount(newImage), 2);
    assert.equal(h.timers.size, 1);
    dispatch(newImage, 'error');
    assert.equal(h.scrolls.length, 1);
});

test('permission callback can track a new batch and old cleanup never removes it', t => {
    const first = new ImageElement(), second = new ImageElement();
    let h, checked = 0;
    h = handlerHarness(t, { shouldScroll() {
        checked++;
        if (checked === 1) h.track([second]);
        return true;
    } });
    h.track([first]);
    const oldExpiry = h.timerCallbacks[0];
    dispatch(first, 'load');
    oldExpiry?.();
    assert.equal(listenerCount(first), 0);
    assert.equal(listenerCount(second), 2);
    assert.equal(h.timers.size, 1);
    dispatch(second, 'error');
    assert.equal(checked, 2);
    assert.equal(h.scrolls.length, 2);
    assert.equal(h.timers.size, 0);
});

test('scroll callback can replace a settled batch and new media still settles once', t => {
    const first = new ImageElement(), second = new ImageElement();
    let h, scrolled = 0;
    h = handlerHarness(t, { scroll() {
        scrolled++;
        if (scrolled === 1) h.track([second]);
    } });
    h.track([first]); dispatch(first, 'load');
    assert.equal(listenerCount(first), 0);
    assert.equal(listenerCount(second), 2);
    dispatch(first, 'error'); dispatch(second, 'loadeddata');
    assert.equal(scrolled, 1, 'an image does not settle on a media loadeddata event');
    dispatch(second, 'error'); dispatch(second, 'load');
    assert.equal(scrolled, 2);
    assert.equal(h.timers.size, 0);
});

test('duplicate media references settle once and many items do not need a shared abort signal', t => {
    const images = Array.from({ length: 24 }, () => new ImageElement());
    const h = handlerHarness(t);
    h.track([...images, images[0]]);
    for (const image of images) dispatch(image, 'load');
    assert.equal(h.scrolls.length, 1);
    assert.equal(images.reduce((sum, image) => sum + listenerCount(image), 0), 0);
    assert.equal(h.timers.size, 0);
});
