// Installed by Playwright only; no production import.
(() => {
    // jQuery UI's local-tab test compares URLs against <base href="/">.
    // Keep the flag for module evaluation only, before tabs initialize.
    Object.defineProperty(window, '__stStreamingPerf', { configurable: true, set(value) {
        Object.defineProperty(window, '__stStreamingPerf', { value, configurable: true, writable: true });
        const url = new URL(location.href);
        url.searchParams.delete('stPerfStreaming');
        history.replaceState(null, '', url);
    } });
    const epoch = () => performance.timeOrigin + performance.now();
    const probe = window.__streamingProbe = { frames: [], loaf: [], typing: [], writes: [], events: [], firstPaintEpochMs: null,
        finalPaintEpochMs: null, scrollProbeEpochMs: null, active: false, loafSupported: PerformanceObserver.supportedEntryTypes.includes('long-animation-frame') };
    let appHooked = false;
    const appTimer = setInterval(() => {
        if (!window.SillyTavern?.getContext) return;
        try {
            const context = SillyTavern.getContext();
            context.eventSource.once(context.eventTypes.APP_READY, () => { probe.appReady = true; });
            appHooked = true;
        } catch (error) {
            if (!(error instanceof ReferenceError)) throw error;
        }
        if (appHooked) clearInterval(appTimer);
    }, 10);
    const afterPaint = callback => requestAnimationFrame(() => requestAnimationFrame(() => callback(epoch())));
    let previous;
    function frame(t) {
        if (probe.active && previous !== undefined) probe.frames.push({ epochMs: performance.timeOrigin + t, ms: Math.round((t - previous) * 1000) / 1000 });
        previous = t;
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    if (probe.loafSupported) new PerformanceObserver(list => {
        for (const entry of list.getEntries()) probe.loaf.push({ epochMs: performance.timeOrigin + entry.startTime, ms: entry.duration,
            scripts: entry.scripts.map(s => ({ sourceFunctionName: s.sourceFunctionName, sourceURL: s.sourceURL,
                duration: s.duration, executionStart: s.executionStart, forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration })) });
    }).observe({ type: 'long-animation-frame', buffered: true });
    document.addEventListener('keydown', event => {
        if (probe.active && event.target.id === 'send_textarea' && event.key.length === 1) {
            const start = epoch();
            afterPaint(end => probe.typing.push({ epochMs: start, ms: end - start }));
        }
    }, true);
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(Element.prototype, 'scrollTop', { ...descriptor, set(value) {
        const before = descriptor.get.call(this);
        descriptor.set.call(this, value);
        if (probe.active && this.id === 'chat' && probe.scrollProbeEpochMs !== null) {
            const after = descriptor.get.call(this);
            if (after > before + 5) probe.writes.push({ epochMs: epoch(), before, after, requested: value, method: 'scrollTop' });
        }
    } });
    const originalScrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (...args) {
        if (probe.active && this.id === 'chat' && probe.scrollProbeEpochMs !== null) {
            const top = typeof args[0] === 'object' ? args[0].top : args[1];
            if (top > this.scrollTop + 5) probe.writes.push({ epochMs: epoch(), before: this.scrollTop, requested: top, method: 'scrollTo' });
        }
        return originalScrollTo.apply(this, args);
    };
    probe.start = (mode = 'send') => {
        probe.active = true;
        previous = undefined;
        probe.probeTimeOrigin = performance.timeOrigin;
        probe.probeStartEpochMs = epoch();
        probe.probeStartVisibility = document.visibilityState;
        probe.probeStartFocused = document.hasFocus();
        window.__stStreamingPerf.records.length = 0;
        window.__stStreamingPerf.cursor = 0;
        const context = SillyTavern.getContext();
        probe.targetMessageId = context.chat.length + (mode === 'continue' ? -1 : 1);
        probe.chatId = context.getCurrentChatId();
        context.eventSource.on(context.eventTypes.GENERATION_STARTED, (type, options, dryRun) => {
            if (dryRun || probe.generationStartedEpochMs) return;
            probe.generationStartedEpochMs = epoch();
            probe.generationType = type;
        });
        context.eventSource.on(context.eventTypes.CHAT_COMPLETION_PROMPT_READY, ({ dryRun }) => {
            if (!dryRun) probe.promptReadyEpochMs = epoch();
        });
        for (const type of ['MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED']) context.eventSource.on(context.eventTypes[type], id => {
            probe.events.push({ type, id, epochMs: epoch() });
            if (type === 'CHARACTER_MESSAGE_RENDERED' && Number(id) === probe.targetMessageId) afterPaint(t => {
                probe.finalPaintEpochMs = t;
                probe.finalPaintMessageId = Number(id);
            });
        });
        const target = () => document.querySelector(`#chat .mes[mesid="${probe.targetMessageId}"]`);
        const initial = context.chat[probe.targetMessageId]?.mes;
        const initialVisible = target()?.querySelector('.mes_text')?.textContent;
        const observer = new MutationObserver(() => {
            if (probe.firstPaintEpochMs !== null || probe.firstPending) return;
            if (context.getCurrentChatId() !== probe.chatId) { probe.chatChanged = true; return; }
            const last = target();
            if (last?.getAttribute('is_user') === 'true') return;
            const text = context.chat[probe.targetMessageId]?.mes;
            const reasoningNode = last?.querySelector('.mes_reasoning');
            const reasoning = last?.querySelector('.mes_reasoning_details')?.open && reasoningNode?.getClientRects().length ? reasoningNode.textContent : '';
            const textNode = last?.querySelector('.mes_text');
            if ((textNode?.getClientRects().length && text?.trim() && text.trim() !== '...' && text !== initial && !['', '...', '…'].includes(textNode.textContent.trim()) && textNode.textContent !== initialVisible) || reasoning?.trim()) {
                probe.firstPaintKind = reasoning?.trim() ? 'reasoning' : 'content';
                probe.firstVisibleMutationEpochMs = epoch();
                probe.firstPaintMessageId = Number(last.getAttribute('mesid'));
                probe.firstVisibleMutationVisibility = document.visibilityState;
                probe.firstPending = true;
                afterPaint(t => {
                    probe.firstPaintEpochMs = t;
                    probe.firstPaintVisibility = document.visibilityState;
                    observer.disconnect();
                });
            }
        });
        observer.observe(document.querySelector('#chat .mes').closest('#chat'), { childList: true, subtree: true, characterData: true });
    };
})();
