// Run from the repository root; reads only retained evidence.
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';

const { summarize, medianDifference, bootstrapSeed, resamples } = await import(
    new URL('./scripts/benchmark-statistics.mjs', 'file://' + process.cwd() + '/'));
const directory = new URL('./raw/', import.meta.url);
const result = { bootstrapSeed, resamples, runsPerSide: 12, metrics: {} };
for (const metric of ['server_main_import', 'imports_done', 'httpMs', 'uiMs']) {
    const sides = {};
    for (const side of ['base', 'head']) {
        sides[side] = Array.from({ length: 12 }, (_, index) => {
            const label = `${String(index + 1).padStart(2, '0')}-${side}`;
            const row = JSON.parse(fs.readFileSync(new URL(`${label}.json`, directory)));
            if (metric === 'server_main_import') return row.trace.stagesMs[metric];
            if (metric === 'imports_done') {
                const events = gunzipSync(fs.readFileSync(new URL(`${label}.trace.jsonl.gz`, directory)))
                    .toString().trim().split('\n').map(JSON.parse);
                return events.find(event => event.name === metric).t.processMs;
            }
            return row[metric];
        });
    }
    result.metrics[metric] = {
        summaries: Object.fromEntries(Object.entries(sides).map(([side, values]) => [side, summarize(values)])),
        difference: medianDifference(sides.base, sides.head),
    };
}
result.keep = ['server_main_import', 'httpMs'].some(metric => result.metrics[metric].difference.ci95[1] < 0);
console.log(JSON.stringify(result, null, 2));
