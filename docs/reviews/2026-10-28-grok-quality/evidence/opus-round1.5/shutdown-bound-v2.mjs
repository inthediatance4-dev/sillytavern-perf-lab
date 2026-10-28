import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { review, source } from '../../review-context.mjs';
import '../../preserve-deletions.mjs';
const load = name => import(pathToFileURL(path.join(source, name)).href);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const mode = 'shutdown-bound';
const root = fs.mkdtempSync(path.join(review, 'temp', mode + '-v2-'));
function emit(result) {
    const record = { scenario: mode, reproduced: false, code: null, op: null, cause: null, name: null, message: null, ...result };
    fs.writeFileSync(path.join(review, mode + '-v2.json'), JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify(record));
}
try {
    const { createRequestDrain, createPersistenceTracker } = await load('src/request-drain.js');
    const { withPathLock, waitForChatIO } = await load('src/chat-io.js');
    const tracker = createPersistenceTracker();
    const drain = createRequestDrain(tracker);
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    let write;
    const entry = { handle: () => { write = withPathLock(path.join(root, 'synthetic-chat'), async () => { entered(); await blocked; }); return write; } };
    tracker.trackRouter({ stack: [{ route: { stack: [entry] } }] });
    entry.handle({}, {}, error => { throw error; });
    await started;
    const at = Date.now();
    await drain.stop(20);
    const drainElapsedMs = Date.now() - at;
    const outcome = await Promise.race([waitForChatIO().then(() => 'finished'), delay(150).then(() => 'still-blocked')]);
    release(); await write;
    emit({ scenario: mode, reproduced: outcome === 'still-blocked', configuredDrainMs: 20, drainElapsedMs, elapsedMs: Date.now() - at, outcome });
} catch (error) {
    if (!(error instanceof TypeError && /requires an AbortSignal/.test(error.message))) throw error;
    emit({ reproduced: false, code: error.code ?? null, op: error.op ?? null,
        cause: error.cause?.code ?? null, name: error.name, message: error.message });
}
