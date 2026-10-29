// Measurement only; injected before application scripts. No product source rewriting.
(() => {
    performance.setResourceTimingBufferSize(10000);
    const probe = window.__startupProbe = { appReadyMs: null, events: [], extensionScripts: [], libJsEvaluatedByMs: null, longAnimationFrames: [] };
    let hooked = false;
    function hook(app) {
        if (hooked || !app?.getContext) return;
        let context;
        try { context = app.getContext(); }
        catch (error) {
            // The global is assigned before script.js finishes initializing its exports.
            if (error instanceof ReferenceError && error.message.includes('before initialization')) return;
            throw error;
        }
        const { eventSource, eventTypes } = context;
        if (!eventSource || !eventTypes) return;
        hooked = true;
        eventSource.once(eventTypes.APP_READY, () => { probe.appReadyMs = performance.now(); });
        for (const name of ['EXTENSION_SETTINGS_LOADED', 'EXTENSIONS_FIRST_LOAD']) {
            if (eventTypes[name]) eventSource.once(eventTypes[name], () => probe.events.push({ name, ms: performance.now() }));
        }
    }
    let app;
    Object.defineProperty(window, 'SillyTavern', { configurable: true, get: () => app,
        set(value) { app = value; probe.libJsEvaluatedByMs = performance.now(); hook(value); } });
    const timer = setInterval(() => { hook(window.SillyTavern); if (hooked) clearInterval(timer); }, 10);
    document.addEventListener('load', event => {
        if (event.target.tagName === 'SCRIPT' && event.target.src.includes('/scripts/extensions/')) {
            probe.extensionScripts.push({ path: new URL(event.target.src).pathname, loadedMs: performance.now() });
        }
    }, true);
    if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
        new PerformanceObserver(list => {
            for (const e of list.getEntries()) probe.longAnimationFrames.push({ startMs: e.startTime, durationMs: e.duration,
                blockingDurationMs: e.blockingDuration, scripts: e.scripts.map(s => ({ sourceURL: s.sourceURL,
                    function: s.sourceFunctionName, durationMs: s.duration })) });
        }).observe({ type: 'long-animation-frame', buffered: true });
    }
    probe.snapshot = () => {
        const resources = performance.getEntriesByType('resource').map(e => ({ path: new URL(e.name).pathname,
            startMs: e.startTime, durationMs: e.duration, transferBytes: e.transferSize,
            encodedBytes: e.encodedBodySize, decodedBytes: e.decodedBodySize, status: e.responseStatus }));
        return { appReadyMs: probe.appReadyMs, libJsEvaluatedByMs: probe.libJsEvaluatedByMs, navNowMs: performance.now(), navigation: performance.getEntriesByType('navigation')[0]?.toJSON(),
            resources, resourceCount: resources.length, transferBytes: resources.reduce((n, e) => n + e.transferBytes, 0),
            keyApis: resources.filter(e => e.path.startsWith('/api/')), events: probe.events,
            extensionScripts: probe.extensionScripts, extensionActivation: 'No per-extension activation events exposed; script load endpoints and aggregate events only',
            longAnimationFrames: probe.longAnimationFrames };
    };
})();
