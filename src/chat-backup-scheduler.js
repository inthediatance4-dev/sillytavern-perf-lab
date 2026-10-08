/**
 * Leading/latest-trailing scheduling with one asynchronous writer per key.
 * Only maxKeys idle/throttled states are retained. Overflow states have no
 * timer: they write immediately, keep one latest snapshot while busy, and
 * disappear after draining. Both kinds participate in shutdown flush.
 * @param {(...args: any[]) => Promise<void>} write
 * @param {{interval?: number, maxKeys?: number, idleMs?: number, onError?: (error: any) => void}} options
 */
export function createChatBackupScheduler(write, options = {}) {
    const interval = Number.isFinite(options.interval) && options.interval >= 0 ? options.interval : 10_000;
    const maxKeys = Number.isSafeInteger(options.maxKeys) && options.maxKeys > 0 ? options.maxKeys : 256;
    const idleMs = Number.isFinite(options.idleMs) && options.idleMs >= 0 ? options.idleMs : 60_000;
    const onError = options.onError || (error => console.error('Could not backup chat', error));
    const retained = new Map();
    const overflow = new Map();

    function cancelTimer(state) {
        if (state.timer !== null) clearTimeout(state.timer);
        state.timer = null;
    }

    function removeDrained(state) {
        if (state.active || state.pending) return;
        cancelTimer(state);
        const registry = state.retained ? retained : overflow;
        if (registry.get(state.key) === state) registry.delete(state.key);
    }

    function run(state, force = false) {
        if (force) { state.force = true; cancelTimer(state); }
        if (state.active) return;
        if (!state.pending) {
            state.force = false;
            if (state.retiring || !state.retained) removeDrained(state);
            return;
        }
        const remaining = state.started === null ? 0 : state.started + interval - Date.now();
        if (!state.force && state.retained && !state.retiring && remaining > 0) {
            if (state.timer === null) state.timer = setTimeout(() => { state.timer = null; run(state, true); }, remaining);
            return;
        }
        cancelTimer(state);
        const args = state.pending;
        state.pending = null;
        state.force = false;
        state.started = Date.now();
        // Publish active before invoking the callback, including a synchronous throw.
        state.active = Promise.resolve().then(() => write(...args)).catch(error => {
            try { onError(error); }
            catch (reportError) { console.error('Could not report chat backup failure', reportError); }
        }).then(() => {
            state.active = null;
            run(state, state.retiring || !state.retained || state.force);
        });
    }

    function retire(state) {
        state.retiring = true;
        // Keep the key addressable until active and latest writes finish. A save
        // arriving during retirement joins the same writer rather than overlapping.
        run(state, true);
    }

    function schedule(key, ...args) {
        const now = Date.now();
        for (const state of retained.values()) {
            if (!state.retiring && now - state.used >= idleMs) retire(state);
        }
        let state = retained.get(key) || overflow.get(key);
        if (!state) {
            if (retained.size >= maxKeys) {
                // FIFO capacity retirement; never cancel pending data to make room.
                const oldest = [...retained.values()].find(candidate => !candidate.retiring);
                if (oldest) retire(oldest);
            }
            const keep = retained.size < maxKeys;
            state = { key, retained: keep, retiring: false, pending: null, active: null, timer: null, force: false, started: null, used: now };
            (keep ? retained : overflow).set(key, state);
        }
        state.used = now;
        state.pending = args;
        run(state, state.retiring || !state.retained);
    }

    async function flush() {
        // Completion callbacks and concurrent saves can add a latest write after
        // an awaited batch. Repeat until every registered/overflow key is drained.
        while (true) {
            const states = [...retained.values(), ...overflow.values()];
            for (const state of states) run(state, true);
            const active = states.map(state => state.active).filter(Boolean);
            if (!active.length) return;
            await Promise.all(active);
        }
    }

    return { schedule, flush };
}
