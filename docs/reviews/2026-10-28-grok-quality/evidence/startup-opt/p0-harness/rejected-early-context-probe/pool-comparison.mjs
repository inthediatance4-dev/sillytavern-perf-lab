// Run from <repo>. Pool every pair from the two predeclared shared-context invocations.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { medianDifference, summarize, bootstrapSeed, resamples } = await import(pathToFileURL(path.resolve('scripts/benchmark-statistics.mjs')));
const root = path.dirname(new URL(import.meta.url).pathname);
const groups = ['same-commit-initial', 'same-commit-followup'];
const records = [], commits = new Set();
for (const group of groups) {
    const invocation = JSON.parse(await fs.readFile(path.join(root, group, 'invocation.json'), 'utf8'));
    if (invocation.products.base.revision !== invocation.products.head.revision || invocation.products.base.productSourceSha256 !== invocation.products.head.productSourceSha256) throw new Error('Source identity mismatch');
    commits.add(invocation.products.base.revision);
    const n = Number(invocation.args.runs);
    for (let i = 1; i <= n; i++) for (const side of ['base', 'head']) {
        const record = JSON.parse(await fs.readFile(path.join(root, group, `${String(i).padStart(2, '0')}-${side}.json`), 'utf8'));
        if (record.status !== 'ok' || !record.lockGone || record.exit.code !== 0) throw new Error('Failed sample cannot be pooled');
        records.push({ ...record, group });
    }
}
if (commits.size !== 1) throw new Error('Tool commit changed between invocations');
const result = { commit: [...commits][0], groups, runsPerSide: records.length / 2, bootstrapSeed, resamples,
    allCiIncludeZero: true, order: records.map(r => `${r.group}/${r.label}`), metrics: {} };
for (const key of ['httpMs', 'uiMs', 'sendMs', 'navigationToUiMs', 'uiAfterHttpMs', 'sendAfterUiMs']) {
    const base = records.filter(r => r.side === 'base').map(r => r[key]);
    const head = records.filter(r => r.side === 'head').map(r => r[key]);
    const difference = medianDifference(base, head);
    const ciIncludesZero = difference.ci95[0] <= 0 && difference.ci95[1] >= 0;
    result.metrics[key] = { summaries: { base: summarize(base), head: summarize(head) }, difference, ciIncludesZero };
    result.allCiIncludeZero &&= ciIncludesZero;
}
await fs.writeFile(path.join(root, 'comparison.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ runsPerSide: result.runsPerSide, allCiIncludeZero: result.allCiIncludeZero,
    intervals: Object.fromEntries(Object.entries(result.metrics).map(([key, value]) => [key, value.difference.ci95])) }, null, 2));
if (!result.allCiIncludeZero) process.exitCode = 1;
