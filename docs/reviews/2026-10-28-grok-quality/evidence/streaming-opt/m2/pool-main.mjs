import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { medianDifference, summarize, bootstrapSeed, resamples } from '../../../../../../scripts/benchmark-statistics.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const batches = ['ab-main-short', 'ab-main-replication'];
const records = { base: [], head: [] };
const invocations = [];
for (const batch of batches) {
    const invocation = JSON.parse(await fs.readFile(`${root}/${batch}/invocation.json`));
    const comparison = JSON.parse(await fs.readFile(`${root}/${batch}/comparison.json`));
    assert.equal(comparison.runsPerSide.main, 10);
    invocations.push(invocation);
    for (let i = 1; i <= 10; i++) for (const side of ['base', 'head']) {
        const file = `${batch}/main-${String(i).padStart(2, '0')}-${side}.json`;
        const record = JSON.parse(await fs.readFile(`${root}/${file}`));
        assert.equal(record.status, 'ok');
        assert.equal(record.discarded, false);
        records[side].push({ file, ...record });
    }
}
assert.deepEqual(invocations[0].sourceSha256, invocations[1].sourceSha256);
assert.equal(invocations[0].chromium, invocations[1].chromium);
assert.equal(invocations[0].node, invocations[1].node);
assert.equal(invocations[0].products.base.revision, invocations[1].products.base.revision);
const table = {};
for (const key of Object.keys(records.base[0].metrics)) {
    const base = records.base.map(row => row.metrics[key]);
    const head = records.head.map(row => row.metrics[key]);
    const difference = medianDifference(base, head);
    table[key] = { summaries: { base: summarize(base), head: summarize(head) }, difference,
        ciIncludesZero: difference.ci95[0] <= 0 && difference.ci95[1] >= 0 };
}
const output = { runsPerSide: { main: 20 }, bootstrapSeed, resamples, batches,
    samplingPlan: 'One fixed 10-pair main replication after the first batch showed variable frame tails. Pool all 20 valid main pairs, with the original two warmups per batch excluded. No valid measured runs selected or discarded; both standalone batch comparisons retained.',
    sourceSha256: invocations[0].sourceSha256, sourceHashesEqual: true,
    records: Object.fromEntries(Object.entries(records).map(([side, rows]) => [side, rows.map(row => row.file)])),
    scenarios: { main: table } };
await fs.writeFile(`${root}/pooled-main.json`, JSON.stringify(output, null, 2) + '\n');
for (const key of ['firstTokenMs', 'finishMs', 'frameP95Ms', 'framesOver33Pct', 'typingP95Ms', 'scrollStolen']) {
    const row = table[key];
    console.log(key, JSON.stringify({ base: row.summaries.base.median, head: row.summaries.head.median, ...row.difference }));
}
