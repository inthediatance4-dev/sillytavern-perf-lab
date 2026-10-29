// Read-only lab probes. The URL switch is evaluated once, before generation.
export const streamingPerfEnabled = new URLSearchParams(location.search).get('stPerfStreaming') === '1';
const capacity = 60000;
if (streamingPerfEnabled) {
    window.__stStreamingPerf = { records: [], cursor: 0, capacity };
    // S1 diagnostics: how often a frame patched a tail versus replaced the node.
    window.__stStreamingDom = { incremental: 0, full: 0, fade: 0, frames: 0 };
}

export function recordStreamingPerf(kind, start, messageId) {
    const probe = window.__stStreamingPerf;
    const record = { kind, start, end: performance.now(), messageId };
    if (probe.records.length < capacity) probe.records.push(record);
    else probe.records[probe.cursor++ % capacity] = record;
}

/** Counts a message/reasoning DOM write. No-op unless the lab probe is on. */
export function recordStreamingDomMode(mode) {
    if (!streamingPerfEnabled) return;
    const stats = window.__stStreamingDom;
    if (stats && Object.prototype.hasOwnProperty.call(stats, mode)) stats[mode]++;
}

/** Counts one coalesced streaming frame. No-op unless the lab probe is on. */
export function recordStreamingDomFrame() {
    if (!streamingPerfEnabled) return;
    if (window.__stStreamingDom) window.__stStreamingDom.frames++;
}
