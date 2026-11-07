// Read-only lab probes. The URL switches are evaluated once, before generation.
const streamingLabQuery = new URLSearchParams(globalThis.location?.search ?? '');
export const streamingPerfEnabled = streamingLabQuery.get('stPerfStreaming') === '1';

/**
 * Measured messageFormatting cost used only to exercise the adaptive frame gap.
 * `?stPerfFormatDelay=12` holds samples that finished faster than 12ms at 12ms.
 * Absent, empty, or non-positive queries are 0. Values above 50 are capped.
 * @param {URLSearchParams} params
 * @returns {number}
 */
export function readStreamingFormatDelayMs(params) {
    const raw = params.get('stPerfFormatDelay');
    if (raw == null || raw === '') return 0;
    const ms = Number(raw);
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return Math.min(ms, 50);
}

/** @type {number} 0 unless the lab query above is set. Not a per-token clock. */
export const streamingFormatDelayMs = readStreamingFormatDelayMs(streamingLabQuery);
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
