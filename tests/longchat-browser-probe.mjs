import { normalizeSnapshot } from './longchat-normalization.mjs';

// Loaded only by Playwright into the isolated synthetic lab.
export async function installProbe(truncation) {
    const { power_user } = await import(location.origin + '/scripts/power-user.js');
    window.labScript = await import(location.origin + '/script.js');
    window.labDefaultTruncation = power_user.chat_truncation;
    power_user.chat_truncation = truncation;
    window.labSettings = structuredClone(power_user);
    if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) throw new Error('Long-task observer unavailable');
    window.labTasks = [];
    window.labObserver = new PerformanceObserver(list => window.labTasks.push(...list.getEntries().map(x => ({ start: x.startTime, duration: x.duration }))));
    window.labObserver.observe({ type: 'longtask', buffered: false });
    window.labIdle = async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        let quiet = performance.now();
        while (performance.now() - quiet < 500) {
            await new Promise(resolve => setTimeout(resolve, 50));
            const last = window.labTasks.at(-1);
            if (last) quiet = Math.max(quiet, last.start + last.duration);
        }
    };
}

export async function openChat({ avatar, size }) {
    const ctx = SillyTavern.getContext();
    await ctx.getCharacters();
    const index = ctx.characters.findIndex(c => c.avatar === avatar);
    let changed = false;
    ctx.eventSource.once(ctx.eventTypes.CHAT_CHANGED, () => { changed = true; });
    window.labTasks = [];
    const start = performance.now();
    await ctx.selectCharacterById(String(index));
    if (!changed || ctx.chat.length !== size || !document.querySelector(`#chat .mes[mesid="${size - 1}"]`)) throw new Error('Open completion invariant failed');
    await window.labIdle();
    return { ms: performance.now() - start, tasks: window.labTasks.filter(t => t.start >= start), loadedTruncationBeforeOverride: window.labDefaultTruncation, settings: window.labSettings };
}

export async function scrollChat(maxBatches = 3) {
    const frames = [];
    const batches = [];
    const chat = document.querySelector('#chat');
    const sweep = async () => {
        let last = await new Promise(resolve => requestAnimationFrame(resolve));
        for (let step = 0; step <= 60; step++) {
            chat.scrollTop = (chat.scrollHeight - chat.clientHeight) * Math.abs(1 - step / 30);
            const now = await new Promise(resolve => requestAnimationFrame(resolve));
            frames.push(now - last);
            last = now;
        }
    };
    window.labTasks = [];
    await sweep();
    while (document.querySelector('#show_more_messages') && batches.length < maxBatches) {
        const before = chat.querySelectorAll('.mes').length;
        const start = performance.now();
        const taskStart = window.labTasks.length;
        await window.labScript.showMoreMessages();
        await window.labIdle();
        const after = chat.querySelectorAll('.mes').length;
        if (after <= before) throw new Error('Show-more made no progress');
        batches.push({ ms: performance.now() - start, added: after - before, tasks: window.labTasks.slice(taskStart) });
    }
    await sweep();
    await window.labIdle();
    return { frames, batches, olderMessagesRemain: !!document.querySelector('#show_more_messages'), tasks: window.labTasks };
}

export function chatSnapshot() {
    const tree = node => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent;
        if (node.nodeType === Node.COMMENT_NODE) return { comment: node.textContent };
        return { tag: node.localName, attributes: [...node.attributes].map(a => [a.name, a.value]), children: [...node.childNodes].map(tree) };
    };
    return normalizeSnapshot(tree(document.querySelector('#chat')));
}

export function focusDescriptor(el = document.activeElement) {
    const path = [];
    for (let node = el; node && node !== document.body; node = node.parentElement) {
        const siblings = [...node.parentElement.children].filter(x => x.localName === node.localName);
        path.unshift(`${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})`);
    }
    return { path: path.join('>'), tag: el.localName, id: el.id.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<random>'),
        message: el.closest('.mes')?.getAttribute('mesid') ?? null, role: el.getAttribute('role'),
        name: el.getAttribute('aria-label') ?? el.getAttribute('name'), title: el.getAttribute('title'),
        type: el.getAttribute('type'), href: el.getAttribute('href'), text: el.children.length ? null : el.textContent.trim().replace(/\s+/g, ' ').slice(0, 120), classes: [...el.classList].sort() };
}

// Record after trusted keyup dispatch, avoiding one browser RPC per Tab.
export function beginTabRecording() {
    window.labTabSequence = [];
    window.labTabListener = event => {
        if (event.key === 'Tab') queueMicrotask(() => window.labTabSequence.push(focusDescriptor()));
    };
    window.addEventListener('keyup', window.labTabListener, true);
}

export function finishTabRecording() {
    window.removeEventListener('keyup', window.labTabListener, true);
    return window.labTabSequence.splice(0);
}

export async function prepareTabScenario(name) {
    if (name === 'class-added') {
        const root = document.createElement('div');
        root.id = 'lab-dynamic';
        root.innerHTML = '<div id="lab-late">Late control</div><div id="lab-ancestor"><div class="interactable" id="lab-child">Child control</div></div>';
        document.querySelector('#send_form').append(root);
        await window.labIdle();
        document.querySelector('#lab-late').classList.add('interactable');
    } else if (name === 'ancestor-disabled' || name === 'ancestor-enabled') {
        document.querySelector('#lab-ancestor').classList.toggle('disabled', name === 'ancestor-disabled');
    } else if (name === 'popup-open') {
        const { Popup, POPUP_TYPE } = await import(location.origin + '/scripts/popup.js');
        window.labPopup = new Popup('<div class="interactable" id="lab-popup-control">Popup control</div>', POPUP_TYPE.TEXT);
        void window.labPopup.show();
    } else if (name === 'popup-closed') {
        await window.labPopup.complete(1);
    }
    await window.labIdle();
    const dialog = document.querySelector('dialog[open]');
    const focusables = [...(dialog ?? document).querySelectorAll('input,select,textarea,button,a[href],[tabindex]')]
        .filter(el => el.tabIndex >= 0 && !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    window.labTabOrder = focusables.map((el, index) => ({ el, index }))
        .sort((a, b) => (a.el.tabIndex > 0 ? a.el.tabIndex : Infinity) - (b.el.tabIndex > 0 ? b.el.tabIndex : Infinity) || a.index - b.index)
        .map(({ el }) => focusDescriptor(el));
    const start = dialog ?? document.body;
    start.tabIndex = -1;
    start.focus();
    return focusables.length + 2;
}

// Test-extension listeners use the public eventSource, without replacing emit().
export function installRenderingRecorder() {
    const ctx = SillyTavern.getContext();
    window.labRenderingEvents = [];
    window.labRenderingEventNames = Object.keys(ctx.eventTypes).filter(name => name.endsWith('_RENDERED')
        || ['MORE_MESSAGES_LOADED', 'CHAT_CHANGED', 'CHAT_LOADED'].includes(name));
    for (const name of window.labRenderingEventNames) {
        ctx.eventSource.on(ctx.eventTypes[name], (...args) => {
            // CHAT_LOADED carries the full mutable card; compare its identity projection.
            const recordedArgs = name === 'CHAT_LOADED'
                ? args.map(value => ({ detail: { id: value.detail.id,
                    character: { avatar: value.detail.character.avatar, name: value.detail.character.name } } }))
                : args.map(value => value === undefined ? '<undefined>'
                    : name === 'CHAT_CHANGED' && value === ctx.getCurrentChatId() ? '<chat-id>' : value);
            const messageId = name.endsWith('_RENDERED') && typeof args[0] === 'number' ? args[0] : null;
            const connected = messageId === null ? null : !!document.querySelector(`#chat .mes[mesid="${messageId}"]`);
            window.labRenderingEvents.push({ name, args: structuredClone(recordedArgs), connected });
            if (connected === false) throw new Error(`Rendered message ${messageId} is not in the document`);
        });
    }
}

export function takeRenderingEvents() {
    return { registered: window.labRenderingEventNames, records: window.labRenderingEvents.splice(0) };
}

// P3 interval excludes the historical 500 ms quiet window and scroll sweeps.
export async function measureOlderBatches(maxBatches) {
    const chat = document.querySelector('#chat');
    const batches = [];
    // Prove the explicit anchor correction without browser scroll anchoring.
    const previousAnchor = chat.style.overflowAnchor;
    chat.style.overflowAnchor = 'none';
    for (let batch = 0; batch < maxBatches && document.querySelector('#show_more_messages'); batch++) {
        chat.scrollTop = 0;
        await window.labIdle();
        const before = chat.querySelectorAll('.mes').length;
        const anchor = [...chat.querySelectorAll('.mes')].find(el => el.getBoundingClientRect().bottom > chat.getBoundingClientRect().top);
        const offset = anchor.getBoundingClientRect().top;
        const drifts = [];
        const sample = () => drifts.push(Math.abs(anchor.getBoundingClientRect().top - offset));
        const observer = new MutationObserver(sample);
        observer.observe(chat, { childList: true });
        window.labTasks = [];
        const start = performance.now();
        await window.labScript.showMoreMessages();
        const end = performance.now();
        sample();
        observer.disconnect();
        await window.labIdle();
        const ids = [...chat.querySelectorAll('.mes')].map(el => Number(el.getAttribute('mesid')));
        const size = SillyTavern.getContext().chat.length;
        const expected = Array.from({ length: ids.length }, (_, i) => size - ids.length + i);
        if (JSON.stringify(ids) !== JSON.stringify(expected)) throw new Error('Older message IDs missing, duplicated or out of order');
        batches.push({ ms: end - start, added: ids.length - before, firstId: ids[0], lastId: ids.at(-1),
            count: ids.length, orderCorrect: true, anchorId: Number(anchor.getAttribute('mesid')),
            anchorDriftPx: Math.max(...drifts), anchorSamples: drifts.length,
            tasks: window.labTasks.filter(task => task.start < end && task.start + task.duration >= start) });
    }
    if (previousAnchor) chat.style.overflowAnchor = previousAnchor;
    else chat.style.removeProperty('overflow-anchor');
    return { frames: [], batches, olderMessagesRemain: !!document.querySelector('#show_more_messages'), tasks: batches.flatMap(batch => batch.tasks) };
}

export async function concurrentOlderSend(mode) {
    const ctx = SillyTavern.getContext();
    const initialLength = ctx.chat.length;
    const before = document.querySelectorAll('#chat .mes').length;
    const batch = (await import(location.origin + '/scripts/power-user.js')).power_user.chat_truncation;
    let partialCount = null;
    let send;
    let completionCount = 0;
    const completed = () => { completionCount++; };
    ctx.eventSource.on(ctx.eventTypes.MORE_MESSAGES_LOADED, completed);
    // Preparation no longer inserts per slice, so a child-list observer cannot see a partial batch.
    // The first scheduler.yield is inside that off-DOM window, while the live count is still `before`.
    const scheduler = globalThis.scheduler;
    const originalYield = scheduler?.yield?.bind(scheduler);
    if (mode !== 'reference') {
        if (!originalYield) throw new Error('Preparation yield hook unavailable');
        scheduler.yield = () => {
            if (!send) {
                partialCount = document.querySelectorAll('#chat .mes').length;
                send = mode === 'double' ? labScript.showMoreMessages() : labScript.sendMessageAsUser('Synthetic concurrent append');
            }
            return originalYield();
        };
    }
    try {
        await labScript.showMoreMessages();
    } finally {
        if (originalYield) scheduler.yield = originalYield;
    }
    if (mode === 'reference') send = labScript.sendMessageAsUser('Synthetic concurrent append');
    if (!send) throw new Error('Scenario did not trigger during preparation');
    await send;
    await labIdle();
    ctx.eventSource.removeListener(ctx.eventTypes.MORE_MESSAGES_LOADED, completed);
    const ids = [...document.querySelectorAll('#chat .mes')].map(el => Number(el.getAttribute('mesid')));
    const expectedLength = initialLength + (mode === 'double' ? 0 : 1);
    const expectedCount = before + batch + (mode === 'double' ? 0 : 1);
    if (ctx.chat.length !== expectedLength || ids.length !== expectedCount || completionCount !== 1
        || ids.some((id, i) => id !== initialLength - before - batch + i)) throw new Error('Concurrent load final invariant failed');
    // Normalize only the appended send's wall-clock field. All other chat data is significant.
    // Match save serialization: swipe metadata can contain undefined generation fields.
    const chat = JSON.parse(JSON.stringify(ctx.chat));
    if (mode !== 'double') chat.at(-1).send_date = '<send-time>';
    return { mode, initialLength, partialCount, completionCount, ids, chat,
        dom: chatSnapshot(), events: takeRenderingEvents() };
}
