import seedrandom from 'seedrandom';

export const bootstrapSeed = 'opus-round1.5';
export const resamples = 2000;
export const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
export const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const interval = values => [percentile(values, 0.025), percentile(values, 0.975)];

export function summarize(values) {
    const random = seedrandom(bootstrapSeed);
    const medians = [], tails = [];
    for (let i = 0; i < resamples; i++) {
        const sample = values.map(() => values[Math.floor(random() * values.length)]);
        medians.push(median(sample));
        tails.push(percentile(sample, 0.95));
    }
    return { median: median(values), p95: percentile(values, 0.95), median_ci95: interval(medians), p95_ci95: interval(tails), samples: values };
}

// Resample iteration pairs together, retaining the interleaved A/B pairing.
export function medianDifference(baseline, current) {
    const random = seedrandom(bootstrapSeed);
    const differences = [];
    for (let i = 0; i < resamples; i++) {
        const indices = baseline.map(() => Math.floor(random() * baseline.length));
        differences.push(median(indices.map(index => current[index])) - median(indices.map(index => baseline[index])));
    }
    return { current_minus_baseline: median(current) - median(baseline), ci95: interval(differences) };
}

export function referenceCriteria(baseline, current) {
    const medianRegression = (current.median / baseline.median - 1) * 100;
    const p95Absolute = current.p95 - baseline.p95;
    const p95Relative = (current.p95 / baseline.p95 - 1) * 100;
    return {
        record_only: true,
        median_regression_percent: medianRegression,
        p95_regression_ms: p95Absolute,
        p95_regression_percent: p95Relative,
        meets_reference: medianRegression <= 10 && (p95Absolute <= 5 || p95Relative <= 25),
    };
}
