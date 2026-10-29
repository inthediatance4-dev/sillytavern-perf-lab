// Read-only lab probes. The URL switch is evaluated once, before generation.
export const streamingPerfEnabled = new URLSearchParams(location.search).get('stPerfStreaming') === '1';
const capacity = 60000;
if (streamingPerfEnabled) window.__stStreamingPerf = { records: [], cursor: 0, capacity };

export function recordStreamingPerf(kind, start, messageId) {
    const probe = window.__stStreamingPerf;
    const record = { kind, start, end: performance.now(), messageId };
    if (probe.records.length < capacity) probe.records.push(record);
    else probe.records[probe.cursor++ % capacity] = record;
}
