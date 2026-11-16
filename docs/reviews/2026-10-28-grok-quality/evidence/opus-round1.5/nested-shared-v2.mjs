import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { review, source } from '../../review-context.mjs';
import '../../preserve-deletions.mjs';
const load = name => import(pathToFileURL(path.join(source, name)).href);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const mode = 'nested-shared';
const root = fs.mkdtempSync(path.join(review, 'temp', mode + '-v2-'));
function emit(result) {
    const record = { scenario: mode, reproduced: false, code: null, op: null, cause: null, name: null, message: null, ...result };
    fs.writeFileSync(path.join(review, mode + '-v2.json'), JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify(record));
}
try {
    const { withPathLocks, chatLockPaths } = await load('src/chat-io.js');
    let entered, resume;
    const inside = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { resume = resolve; });
    const outer = withPathLocks(chatLockPaths([path.join(root, 'a.jsonl')]), async () => {
        entered(); await gate;
        return withPathLocks(chatLockPaths([path.join(root, 'b.jsonl')]), async () => 'inner');
    });
    await inside;
    const writer = withPathLocks([root], async () => 'writer');
    resume();
    const outcome = await Promise.race([Promise.all([outer, writer]).then(() => 'finished'), delay(150).then(() => 'deadlocked')]);
    emit({ scenario: mode, reproduced: outcome === 'deadlocked', outcome, filesystemWrites: 0 });
} catch (error) {
    if (!(error.name === 'LockOrderError')) throw error;
    emit({ reproduced: false, code: error.code ?? null, op: error.op ?? null,
        cause: error.cause?.code ?? null, name: error.name, message: error.message });
}
