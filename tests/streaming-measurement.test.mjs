import assert from 'node:assert/strict';
import test from 'node:test';
import { measureStreamingMetrics } from '../scripts/streaming-measurement.mjs';

function fixture({ late = false } = {}) {
    const generation = { receivedEpochMs: 990, firstChunkEpochMs: 1000, lastChunkEpochMs: 1100 };
    const browser = { timeOrigin: 900, probeTimeOrigin: 900, probeStartEpochMs: 970, generationStartedEpochMs: 980,
        targetMessageId: 102, firstPaintMessageId: 102, finalPaintMessageId: 102,
        firstVisibleMutationEpochMs: late ? 1300 : 1001, firstPaintEpochMs: late ? 1330 : 1030, finalPaintEpochMs: 1500,
        frames: [{ epochMs: 1020, ms: 17 }, { epochMs: 1400, ms: 40 }],
        typing: late ? [{ epochMs: 1400, ms: 30 }] : [{ epochMs: 1020, ms: 20 }, { epochMs: 1400, ms: 30 }],
        hooks: { records: [] }, loaf: [], writes: [], scrollProbeEpochMs: 1200 };
    for (const epoch of late ? [1400] : [1020, 1400]) {
        for (const kind of ['format', 'dom', 'reasoning', 'scroll']) browser.hooks.records.push({ kind, messageId: 102, start: epoch - 900, end: epoch - 900 + 1 });
    }
    return { browser, generation };
}

test('ordinary metrics retain the network window and ignore smooth backlog samples', () => {
    const { browser, generation } = fixture();
    const measured = measureStreamingMetrics(browser, generation);
    assert.equal(measured.window.kind, 'network');
    assert.equal(measured.window.endEpochMs, 1100);
    assert.equal(measured.metrics.frameP95Ms, 17);
    assert.equal(measured.metrics.typingP95Ms, 20);
    assert.equal(measured.metrics.updatesPerSecond, 10);
    assert.equal(measured.metrics.finishMs, 400);
    assert.deepEqual(measured.samples.selected, measured.samples.network);
});

test('smooth backlog has valid metrics when visible content and typing start after the last network chunk', () => {
    const { browser, generation } = fixture({ late: true });
    const measured = measureStreamingMetrics(browser, generation, { smooth: true });
    assert.equal(measured.window.kind, 'network-through-final-paint');
    assert.equal(measured.window.endEpochMs, 1500);
    assert.equal(measured.samples.network.keys, 0);
    assert.equal(measured.samples.network.format, 0);
    assert.equal(measured.samples.selected.keys, 1);
    assert.equal(measured.metrics.firstTokenMs, 340);
    assert.equal(measured.metrics.finishMs, 400);
    assert.ok(Object.values(measured.metrics).every(Number.isFinite));
});

test('missing samples, late probe clocks and a different target give specific diagnostic failures', () => {
    const { browser, generation } = fixture({ late: true });
    assert.throws(() => measureStreamingMetrics(browser, generation), /Required keys measurement has no samples in network window/);
    browser.probeStartEpochMs = 1200;
    assert.throws(() => measureStreamingMetrics(browser, generation, { smooth: true }), /Probe\/generation start follows provider receipt/);
    browser.probeStartEpochMs = 970;
    browser.probeTimeOrigin = 901;
    assert.throws(() => measureStreamingMetrics(browser, generation, { smooth: true }), /Document changed/);
    browser.probeTimeOrigin = 900;
    browser.firstPaintMessageId = 101;
    assert.throws(() => measureStreamingMetrics(browser, generation, { smooth: true }), /generation target/);
});

test('format and DOM samples from another message cannot satisfy the generation target', () => {
    const { browser, generation } = fixture();
    browser.hooks.records.forEach(record => { record.messageId = 101; });
    assert.throws(() => measureStreamingMetrics(browser, generation), /Required format measurement has no samples/);
});
