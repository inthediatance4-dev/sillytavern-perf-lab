import { percentile } from './benchmark-statistics.mjs';

function quantiles(values, name, window) {
    if (!values.length) throw new Error(`Required ${name} measurement has no samples in ${window.kind} window (${window.startEpochMs}..${window.endEpochMs})`);
    return { p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99) };
}

/** Keep ordinary runs on the provider window; smooth runs include their visible backlog. */
export function measureStreamingMetrics(browser, generation, { smooth = false } = {}) {
    const first = generation.firstChunkEpochMs, last = generation.lastChunkEpochMs;
    const window = { kind: smooth ? 'network-through-final-paint' : 'network', startEpochMs: first, endEpochMs: smooth ? browser.finalPaintEpochMs : last };
    if (![first, last, browser.finalPaintEpochMs, browser.timeOrigin].every(Number.isFinite) || last < first || window.endEpochMs <= first) throw new Error('Invalid provider/render measurement window');
    if (browser.probeTimeOrigin !== browser.timeOrigin) throw new Error('Document changed after the streaming probe started');
    if (!(browser.probeStartEpochMs <= generation.receivedEpochMs && browser.generationStartedEpochMs <= generation.receivedEpochMs)) throw new Error('Probe/generation start follows provider receipt; check document and provider clocks');
    if (browser.chatChanged || !Number.isFinite(browser.firstVisibleMutationEpochMs) || browser.firstVisibleMutationEpochMs > browser.firstPaintEpochMs || browser.firstPaintMessageId !== browser.targetMessageId || browser.finalPaintMessageId !== browser.targetMessageId) throw new Error('Paint probe did not observe the generation target in order');
    const select = end => {
        const inside = record => record.epochMs >= first && record.epochMs <= end;
        const hooks = browser.hooks.records.filter(r => r.messageId === browser.targetMessageId && r.start + browser.timeOrigin >= first && r.end + browser.timeOrigin <= end);
        const durations = kind => hooks.filter(r => r.kind === kind).map(r => r.end - r.start);
        return { frames: browser.frames.filter(inside).map(r => r.ms), keys: browser.typing.filter(inside).map(r => r.ms),
            loaf: browser.loaf.filter(inside), format: durations('format'), dom: durations('dom'), reasoning: durations('reasoning'), scroll: durations('scroll') };
    };
    const selected = select(window.endEpochMs), network = select(last);
    const counts = samples => Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, values.length]));
    const distribution = name => quantiles(selected[name], name, window);
    const frame = distribution('frames'), typing = distribution('keys'), format = distribution('format'), dom = distribution('dom');
    const attributed = { messageFormatting: 0, DOMPurify: 0, keyboard: 0, other: 0 };
    for (const entry of selected.loaf) for (const script of entry.scripts) {
        const name = script.sourceFunctionName + ' ' + script.sourceURL;
        const category = /messageFormatting/.test(name) ? 'messageFormatting' : /purify|DOMPurify/i.test(name) ? 'DOMPurify' : /keyboard\.js/.test(name) ? 'keyboard' : 'other';
        attributed[category] += script.duration;
    }
    return { window: { ...window, networkStartEpochMs: first, networkEndEpochMs: last }, samples: { selected: counts(selected), network: counts(network) }, metrics: {
        frameP50Ms: frame.p50, frameP95Ms: frame.p95, frameP99Ms: frame.p99,
        framesOver16_7Pct: selected.frames.filter(t => t > 16.7).length / selected.frames.length * 100, framesOver33Pct: selected.frames.filter(t => t > 33).length / selected.frames.length * 100,
        loafCount: selected.loaf.length, loafTotalMs: selected.loaf.reduce((sum, r) => sum + r.ms, 0), ...Object.fromEntries(Object.entries(attributed).map(([key, value]) => [`loafScript${key}Ms`, value])),
        formatP50Ms: format.p50, formatP95Ms: format.p95, domP50Ms: dom.p50, domP95Ms: dom.p95,
        reasoningP95Ms: distribution('reasoning').p95, scrollCallP95Ms: distribution('scroll').p95,
        updatesPerSecond: selected.dom.length / ((window.endEpochMs - first) / 1000), firstTokenMs: browser.firstPaintEpochMs - generation.receivedEpochMs,
        finishMs: browser.finalPaintEpochMs - last, typingP50Ms: typing.p50, typingP95Ms: typing.p95,
        scrollStolen: browser.writes.filter(r => r.epochMs >= browser.scrollProbeEpochMs && r.epochMs <= browser.finalPaintEpochMs).length,
    } };
}
