/** Default wait for admitted responses and persistence handlers during shutdown. */
export const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;

/**
 * Resolve the shutdown drain bound.
 * `SILLYTAVERN_DRAIN_TIMEOUT_MS` overrides the default. Invalid or negative
 * values keep the default. The isolated launcher strips inherited
 * `SILLYTAVERN_*` variables, so that lab process keeps this default.
 * @param {string | undefined} raw Env value, or the live env when omitted
 * @returns {number}
 */
export function resolveDrainTimeoutMs(raw = process.env.SILLYTAVERN_DRAIN_TIMEOUT_MS) {
    if (raw === undefined || raw === '') return DEFAULT_DRAIN_TIMEOUT_MS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DRAIN_TIMEOUT_MS;
    return parsed;
}

function isThenable(value) {
    return (typeof value === 'object' || typeof value === 'function') && value !== null && typeof value.then === 'function';
}

/** Track persistence independently of response lifetime. */
export function createPersistenceTracker() {
    const handlers = new Set();
    let stopping = false;
    return {
        pendingCount() {
            return handlers.size;
        },
        trackRouter(router) {
            for (const layer of router.stack) {
                for (const entry of layer.route?.stack ?? []) {
                    const handler = entry.handle;
                    if (typeof handler !== 'function') continue;
                    // Sync routes that return a Promise must be tracked the same way as async routes.
                    entry.handle = (request, response, next) => {
                        if (stopping) return response.sendStatus(503);
                        const result = handler(request, response, next);
                        if (!isThenable(result)) return result;
                        const pending = Promise.resolve(result);
                        handlers.add(pending);
                        pending.catch(next).finally(() => handlers.delete(pending));
                    };
                }
            }
        },
        stop() {
            stopping = true;
            return Promise.allSettled([...handlers]);
        },
    };
}

const persistence = createPersistenceTracker();
export const trackPersistenceRouter = persistence.trackRouter;

/**
 * Stop admitting requests synchronously, then wait for admitted work to finish.
 * The wait is bounded so a stuck response cannot hold shutdown open forever.
 * @param {{ stop: () => Promise<unknown>, pendingCount?: () => number }} [tracker]
 */
export function createRequestDrain(tracker = persistence) {
    let stopping = false;
    const active = new Set();
    return {
        middleware(_request, response, next) {
            if (stopping) return response.sendStatus(503);
            let finish;
            const completed = new Promise(resolve => { finish = resolve; });
            active.add(completed);
            const done = () => {
                response.off('finish', done);
                response.off('close', done);
                active.delete(completed);
                finish();
            };
            response.once('finish', done);
            response.once('close', done);
            next();
        },
        async stop(timeoutMs = resolveDrainTimeoutMs()) {
            if (typeof timeoutMs !== 'number') {
                stopping = true;
                return waitForShutdown(Promise.all([tracker.stop(), ...active]), timeoutMs);
            }
            stopping = true;
            const pendingHandlers = Promise.resolve(tracker.stop()).catch(error => {
                console.error('Persistence drain failed:', error);
            });
            const activeDrain = Promise.all([...active]).catch(error => {
                console.error('Request drain failed:', error);
            });
            let timer;
            // Keep the timer referenced so a stuck drain cannot exit the event
            // loop before the bound fires. It is cleared as soon as the race ends.
            const timeout = new Promise(resolve => {
                timer = setTimeout(() => resolve('timeout'), timeoutMs);
            });
            let outcome;
            try {
                outcome = await Promise.race([
                    Promise.all([activeDrain, pendingHandlers]).then(() => 'drained'),
                    timeout,
                ]);
            } finally {
                clearTimeout(timer);
            }
            if (outcome === 'timeout') {
                const handlersLeft = typeof tracker.pendingCount === 'function' ? tracker.pendingCount() : 'unknown';
                console.error(`Request drain timed out after ${timeoutMs}ms with ${active.size} open response(s) and ${handlersLeft} persistence handler(s); continuing shutdown.`);
            }
        },
    };
}

/** One abortable budget shared by every shutdown stage. */
export function createShutdownDeadline(timeoutMs = resolveDrainTimeoutMs()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Shutdown deadline expired')), timeoutMs);
    return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

/** Bound a wait without cancelling or releasing an in-progress file operation. */
export async function waitForShutdown(work, signal) {
    if (!signal) return work;
    if (signal.aborted) throw signal.reason;
    let abort;
    const expired = new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([work, expired]); }
    finally { signal.removeEventListener('abort', abort); }
}

/** Run all cleanup stages against the same deadline and report before exiting. */
export async function runShutdown(stages, pendingPaths, timeoutMs = resolveDrainTimeoutMs()) {
    const deadline = createShutdownDeadline(timeoutMs);
    let stage;
    try {
        for (const [name, cleanup] of stages) {
            stage = name;
            await waitForShutdown(Promise.resolve().then(() => cleanup(deadline.signal)), deadline.signal);
        }
        return 0;
    } catch (error) {
        console.error('Shutdown incomplete:', { stage, pendingPaths: pendingPaths(), error: String(error) });
        return 1;
    } finally {
        deadline.dispose();
    }
}
