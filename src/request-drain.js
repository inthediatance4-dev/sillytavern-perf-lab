/** Track persistence independently of response lifetime. */
export function createPersistenceTracker() {
    const handlers = new Set();
    let stopping = false;
    return {
        trackRouter(router) {
            for (const layer of router.stack) {
                for (const entry of layer.route?.stack ?? []) {
                    const handler = entry.handle;
                    if (handler.constructor.name !== 'AsyncFunction') continue;
                    entry.handle = (request, response, next) => {
                        if (stopping) return response.sendStatus(503);
                        const pending = Promise.resolve().then(() => handler(request, response, next));
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

/** Stop admitting requests synchronously, then wait for admitted responses to finish. */
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
        async stop() {
            stopping = true;
            const pendingHandlers = tracker.stop();
            await Promise.all([...active]);
            await pendingHandlers;
        },
    };
}
