/**
 * Tracks one batch of chat media without retaining listeners after it settles.
 * @param {object} options Callbacks and maximum media wait
 * @param {function(): void} options.scroll Scroll the chat to the bottom
 * @param {function(): boolean} options.shouldScroll Check the user's current scroll intent
 * @param {number} [options.timeoutMs=1000] Maximum wait in milliseconds
 * @returns {{track: function(Iterable<Element>): void, cancel: function(): void}} Media tracker
 */
export function createMediaLoadScrollHandler({ scroll, shouldScroll, timeoutMs = 1000 }) {
    let currentBatch = null;

    function removeListeners(element, subscription) {
        element.removeEventListener(subscription.event, subscription.settle);
        element.removeEventListener('error', subscription.settle);
    }

    function cleanup(batch) {
        // A cancelled expiry may already be queued when a new batch starts.
        if (currentBatch !== batch) return;
        currentBatch = null;
        clearTimeout(batch.timer);
        for (const [element, subscription] of batch.pending) {
            removeListeners(element, subscription);
        }
        batch.pending.clear();
    }

    function cancel() {
        if (currentBatch) cleanup(currentBatch);
    }

    function track(media) {
        cancel();
        const recognized = [...new Set(media)].filter(element =>
            element instanceof HTMLImageElement || element instanceof HTMLMediaElement);
        if (recognized.length === 0) return;

        const pending = recognized.filter(element => element instanceof HTMLImageElement
            ? !element.complete
            : element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA);
        if (pending.length === 0) {
            if (shouldScroll()) scroll();
            return;
        }

        const batch = { pending: new Map(), deadline: Date.now() + timeoutMs, timer: null };
        currentBatch = batch;
        batch.timer = setTimeout(() => cleanup(batch), timeoutMs);

        for (const element of pending) {
            const event = element instanceof HTMLImageElement ? 'load' : 'loadeddata';
            const settle = () => {
                if (currentBatch !== batch || !batch.pending.has(element)) return;
                // Enforce the deadline even if an event runs before a delayed timer.
                if (Date.now() >= batch.deadline) {
                    cleanup(batch);
                    return;
                }
                removeListeners(element, batch.pending.get(element));
                batch.pending.delete(element);
                if (batch.pending.size === 0) {
                    // Release this batch before callbacks that may call track again.
                    cleanup(batch);
                    if (shouldScroll()) scroll();
                }
            };
            batch.pending.set(element, { event, settle });
            element.addEventListener(event, settle);
            element.addEventListener('error', settle);
        }
    }

    return { track, cancel };
}
