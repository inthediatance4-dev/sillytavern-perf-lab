// Opt-in startup diagnostics. Importers guard on ST_STARTUP_TRACE as well.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import diagnostics from 'node:diagnostics_channel';

let enabled = Boolean(process.env.ST_STARTUP_TRACE);
let warned = false;
let blockTotalMs = 0;
let timer;
let spawnCount = 0;
let expected;

export function mark(name, detail) {
    if (!enabled) return;
    try {
        fs.appendFileSync(process.env.ST_STARTUP_TRACE, JSON.stringify({
            t: { hrtimeNs: process.hrtime.bigint().toString(), epochMs: Date.now(), processMs: performance.now() },
            name, ...(detail === undefined ? {} : { detail }),
        }) + '\n');
    } catch {
        enabled = false;
        if (timer) clearInterval(timer);
        if (!warned) { warned = true; console.warn('Startup trace unavailable; tracing disabled.'); }
    }
}

export async function measureAsync(name, fn) {
    if (!enabled) return fn();
    mark(`${name}_begin`);
    try { return await fn(); }
    finally { mark(`${name}_end`); }
}

export function childSpawnCount() { return spawnCount; }
export function noteChildSpawn(cmd) { spawnCount++; mark('child_spawn', { cmd }); }
export function noteEventLoopBlock(ms) {
    if (enabled && Number.isFinite(ms) && ms > 0) blockTotalMs += ms;
}
export function finalize({ rss } = {}) {
    if (!enabled) return;
    sampleDelay();
    clearInterval(timer);
    mark('listen_ready', { rss: rss ?? process.memoryUsage().rss, eventLoopBlockTotalMs: blockTotalMs,
        eventLoopMethod: 'sum of 10ms timer lateness (estimate, includes scheduling and trace overhead)' });
}
function sampleDelay() {
    const now = performance.now();
    noteEventLoopBlock(Math.max(0, now - expected));
    expected = now + 10;
}
if (enabled) {
    mark('node_timing', performance.nodeTiming.toJSON());
    if (enabled) {
        expected = performance.now() + 10;
        timer = setInterval(sampleDelay, 10);
        timer.unref();
        diagnostics.subscribe('child_process', ({ process: child }) => {
            // This channel fires at construction, before spawnfile is assigned.
            child?.once('spawn', () => noteChildSpawn(child.spawnfile));
        });
    }
}
