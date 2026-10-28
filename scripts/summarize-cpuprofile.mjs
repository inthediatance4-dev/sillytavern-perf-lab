import fs from 'node:fs';

const profile = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const nodes = new Map(profile.nodes.map(node => [node.id, node.callFrame]));
const totals = new Map();
let total = 0;
for (let i = 0; i < profile.samples.length; i++) {
    const frame = nodes.get(profile.samples[i]);
    const key = `${frame.functionName || '(anonymous)'}\t${frame.url || '(native)'}`;
    const duration = profile.timeDeltas[i];
    totals.set(key, (totals.get(key) || 0) + duration);
    total += duration;
}
console.log('Sampled self time, aggregated by function + URL (includes idle/native samples).');
console.log('CPU samples cannot attribute threadpool fsync blocking time; idle is not fsync evidence.');
console.log(`Sampled duration: ${(total / 1000).toFixed(3)} ms`);
console.log('self_ms\tpercent\tfunction\turl');
for (const [key, duration] of [...totals].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    console.log(`${(duration / 1000).toFixed(3)}\t${(duration / total * 100).toFixed(2)}\t${key}`);
}
