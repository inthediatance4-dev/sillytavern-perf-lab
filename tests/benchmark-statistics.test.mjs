import assert from 'node:assert/strict';
import test from 'node:test';
import { percentile, median, summarize, medianDifference, referenceCriteria } from '../scripts/benchmark-statistics.mjs';

test('nearest-rank p95, even median and deterministic bootstrap intervals', () => {
    assert.equal(percentile(Array.from({ length: 30 }, (_, i) => i + 1), 0.95), 29);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.deepEqual(summarize([2, 2, 2]), { median: 2, p95: 2, median_ci95: [2, 2], p95_ci95: [2, 2], samples: [2, 2, 2] });
    assert.deepEqual(summarize([1, 2, 9]), summarize([1, 2, 9]));
    assert.deepEqual(medianDifference([1, 2, 3], [4, 5, 6]), { current_minus_baseline: 3, ci95: [3, 3] });
});

test('record-only reference uses median AND either absolute or relative p95 limit', () => {
    const baseline = { median: 10, p95: 20 };
    assert.equal(referenceCriteria(baseline, { median: 10, p95: 25 }).meets_reference, true);
    assert.equal(referenceCriteria({ median: 10, p95: 100 }, { median: 10, p95: 125 }).meets_reference, true);
    assert.equal(referenceCriteria(baseline, { median: 12, p95: 20 }).meets_reference, false);
    assert.equal(referenceCriteria(baseline, { median: 10, p95: 26 }).meets_reference, false);
    assert.equal(referenceCriteria(baseline, baseline).record_only, true);
});
