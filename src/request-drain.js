/** Stop admitting requests synchronously, then wait for admitted responses to finish. */
export function createRequestDrain() {
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
            await Promise.all([...active]);
        },
    };
}
