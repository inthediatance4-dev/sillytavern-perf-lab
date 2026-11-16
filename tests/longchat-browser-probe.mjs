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

export async function openChat({ avatar, size, chatFile }) {
    const ctx = SillyTavern.getContext();
    await ctx.getCharacters();
    const index = ctx.characters.findIndex(c => c.avatar === avatar);
    let changed = false;
    ctx.eventSource.once(ctx.eventTypes.CHAT_CHANGED, () => { changed = true; });
    window.labTasks = [];
    const start = performance.now();
    await ctx.selectCharacterById(String(index), chatFile ? { chatFile } : {});
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

// Functional P4 check; deliberately excluded from latency samples.
export async function trimBoundaryScenario({ avatar, chatName }) {
    const ctx = SillyTavern.getContext();
    const { power_user } = await import(location.origin + '/scripts/power-user.js');
    const container = document.querySelector('#chat');
    container.style.overflowAnchor = 'none';
    const ids = () => [...container.querySelectorAll(':scope > .mes')].map(el => Number(el.getAttribute('mesid')));
    const checkIds = (first, count) => {
        const actual = ids();
        if (actual.length !== count || actual.some((id, i) => id !== first + i)) throw new Error('Trim scenario message IDs differ');
        return actual;
    };
    for (let i = 0; i < 10; i++) await labScript.showMoreMessages();
    const beforeIds = checkIds(900, 1100);
    const originalChat = JSON.stringify(ctx.chat);
    // Exercise restoration even when the existing button is absent, as after reaching ID 0.
    document.querySelector('#show_more_messages').remove();
    container.scrollTop = container.scrollHeight - container.clientHeight - 300;
    const anchor = container.querySelector('.mes[mesid="1500"]');
    const beforeTop = anchor.getBoundingClientRect().top;
    power_user.auto_scroll_chat_to_bottom = false;
    let drift;
    let atSent;
    ctx.eventSource.once(ctx.eventTypes.MESSAGE_SENT, () => {
        drift = Math.abs(anchor.getBoundingClientRect().top - beforeTop);
        atSent = checkIds(1500, 500);
    });
    await labScript.sendMessageAsUser('Synthetic trim boundary append');
    await labIdle();
    const afterIds = checkIds(1500, 501);
    if (drift > 2 || atSent?.length !== 500) throw new Error('Trim anchor moved or send event missing');
    if (JSON.stringify(ctx.chat.slice(0, -1)) !== originalChat) throw new Error('Trim changed chat data');
    const restoredButton = !!document.querySelector('#show_more_messages');
    if (!restoredButton) throw new Error('Trim failed to restore show-more');
    const afterSendChat = JSON.stringify(ctx.chat);
    const response = await fetch('/api/chats/get', { method: 'POST', headers: labScript.getRequestHeaders(),
        body: JSON.stringify({ avatar_url: avatar, file_name: chatName }) });
    if (!response.ok) throw new Error('Cannot verify saved chat after trim');
    const stored = (await response.json()).slice(1);
    if (JSON.stringify(stored) !== afterSendChat) throw new Error('Saved chat differs after trim');
    await labScript.messageEdit(1499);
    await labScript.deleteMessage(1499);
    if (JSON.stringify(ctx.chat) !== afterSendChat || document.querySelector('#curEditTextarea')) throw new Error('Missing-DOM edit/delete changed state');
    await labScript.messageEdit(1500);
    if (!container.querySelector('.mes[mesid="1500"] #curEditTextarea')) throw new Error('Boundary edit did not open');
    container.querySelector('.mes[mesid="1500"] .mes_edit_cancel').click();
    await labIdle();
    const nextMessage = ctx.chat[1501];
    await labScript.deleteMessage(1500);
    const afterDeleteIds = checkIds(1500, 500);
    if (ctx.chat[1500] !== nextMessage) throw new Error('Boundary deletion changed survivor data');
    await labScript.showMoreMessages();
    const afterReloadIds = checkIds(1400, 600);
    await labScript.messageEdit(1499);
    if (!container.querySelector('.mes[mesid="1499"] #curEditTextarea')) throw new Error('Reloaded message cannot be edited');
    container.querySelector('.mes[mesid="1499"] .mes_edit_cancel').click();
    await labIdle();
    return { beforeIds, atSent, afterIds, afterDeleteIds, afterReloadIds, anchorDriftPx: drift,
        restoredButton, chatPrefixUnchanged: true, savedMatchesChat: true, missingDomEditDeleteNoop: true,
        boundaryEditDelete: true, reloadedMessageEditable: true, overflowAnchor: container.style.overflowAnchor };
}

// Each run starts from the identical saved chat in a fresh page. The reference
// invokes the same operation only after showMoreMessages resolves.
export async function preparationConcurrency({ case: scenario, mode, target }) {
    const ctx = SillyTavern.getContext();
    const script = window.labScript;
    // Date is fixed across paired pages. jQuery animations use Date.now(), so
    // disable their duration to let regeneration's hide callback complete.
    script.setAnimationDuration(0);
    const { power_user } = await import(location.origin + '/scripts/power-user.js');
    const { SWIPE_SOURCE, SWIPE_DIRECTION } = await import(location.origin + '/scripts/constants.js');
    const container = document.querySelector('#chat');
    container.style.overflowAnchor = 'none';
    // Rendering backfills swipe metadata. Canonicalize the same starting model
    // on both sides so unrelated-entry checks include those fields exactly.
    for (const [id, message] of ctx.chat.entries()) {
        if (script.ensureSwipes(message)) script.syncMesToSwipe(id);
    }
    const initial = JSON.parse(JSON.stringify(ctx.chat));
    const originalIdentity = { character: script.this_chid, chat: script.getCurrentChatId() };
    const before = container.querySelectorAll('.mes').length;
    const boundary = Number(container.querySelector('.mes').getAttribute('mesid'));
    const editId = boundary + 2;
    const deleteId = boundary - 1; // In the detached batch; deletion must wait until it is displayed.
    const swipeId = ctx.chat.findIndex((m, i) => i >= boundary && m.swipes?.length > 1);
    const wrongChatInsertions = [];
    const insertions = [];
    let loading = true;
    let trigger = null;
    let operation;
    let operationError;
    let completions = 0;
    const completed = () => { completions++; };
    ctx.eventSource.on(ctx.eventTypes.MORE_MESSAGES_LOADED, completed);
    // Inspect synchronously at the actual insertion, before a clear can erase
    // transient contamination. A later final snapshot alone cannot detect it.
    const originals = new Map();
    for (const method of ['insertBefore', 'prepend']) {
        const original = container[method];
        originals.set(method, original);
        container[method] = function (node, ...rest) {
            if (loading && node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && node.querySelector('.mes')) {
                const record = { method, count: node.querySelectorAll('.mes').length,
                    character: script.this_chid ?? null, chat: script.getCurrentChatId() ?? null };
                insertions.push(record);
                if (script.this_chid !== originalIdentity.character || script.getCurrentChatId() !== originalIdentity.chat) {
                    wrongChatInsertions.push(record);
                }
            }
            return original.call(this, node, ...rest);
        };
    }
    const perform = async () => {
        if (scenario === 'switch-character') {
            const id = ctx.characters.findIndex(c => c.avatar === target.avatar);
            if (id < 0) throw new Error('Target character missing');
            await script.selectCharacterById(String(id), { chatFile: target.chatFile });
        } else if (scenario === 'switch-chat') {
            await script.selectCharacterById(String(script.this_chid), { chatFile: target.sameChatFile });
        } else if (scenario === 'delete') {
            await script.deleteMessage(deleteId);
        } else if (scenario === 'delete-last') {
            await script.deleteLastMessage();
        } else if (scenario === 'edit') {
            await script.messageEdit(editId);
            const textarea = container.querySelector('#curEditTextarea');
            if (!textarea) throw new Error('Editor did not open');
            textarea.value = 'Synthetic edited message.';
            const updated = new Promise(resolve => ctx.eventSource.once(ctx.eventTypes.MESSAGE_UPDATED, resolve));
            container.querySelector('.mes[mesid="' + editId + '"] .mes_edit_done').click();
            await updated;
        } else if (scenario === 'swipe') {
            if (swipeId < 0) throw new Error('Swipe fixture missing');
            await script.swipe(null, SWIPE_DIRECTION.RIGHT, { source: SWIPE_SOURCE.SWIPE_PICKER,
                forceMesId: swipeId, forceSwipeId: 1, forceDuration: 0 });
        } else if (scenario === 'regenerate') {
            await script.Generate('regenerate');
        } else {
            throw new Error('Unknown preparation scenario');
        }
    };
    if (scenario === 'regenerate') {
        script.changeMainAPI('kobold');
        (await import(location.origin + '/scripts/kai-settings.js')).kai_settings.streaming_kobold = false;
        script.setOnlineStatus('longchat-synthetic');
    }
    const scheduler = globalThis.scheduler;
    const originalYield = scheduler?.yield;
    if (!originalYield) throw new Error('Preparation yield hook unavailable');
    if (mode === 'concurrent') {
        scheduler.yield = async () => {
            if (!trigger) {
                trigger = { liveCount: container.querySelectorAll('.mes').length, before, insertions: insertions.length };
                operation = perform().catch(error => { operationError = error; });
                // These operations touch displayed messages only and can complete
                // while the older fragment remains detached. Structural ops queue.
                if (scenario === 'edit' || scenario === 'swipe') await operation;
                // Same-character navigation first polls the save gate (10 ms).
                // Hold this detached slice across that poll so clearChat is reached
                // before rendering resumes; this pause is outside all latency data.
                if (scenario === 'switch-chat') await new Promise(resolve => setTimeout(resolve, 50));
            }
            return originalYield.call(scheduler);
        };
    }
    try {
        await script.showMoreMessages();
        loading = false;
        if (mode === 'reference') operation = perform().catch(error => { operationError = error; });
        else if (!trigger || trigger.liveCount !== before || trigger.insertions !== 0) throw new Error('Operation did not trigger during off-DOM preparation');
        await operation;
        if (operationError) throw operationError;
        await labIdle();
        // Drain pending edit/deletion/swipe saves and compare exact JSON data.
        script.cancelDebouncedChatSave();
        if (await script.saveChatConditional() === false) throw new Error('Scenario save failed');
        await labIdle();
        const active = SillyTavern.getContext();
        const chat = JSON.parse(JSON.stringify(active.chat));
        let expected = structuredClone(initial);
        const switched = scenario.startsWith('switch-');
        if (switched) {
            if (chat.length !== 1 || chat[0].mes !== 'SWITCH TARGET only.') throw new Error('Switch array contaminated');
        } else {
            if (scenario === 'delete') expected.splice(deleteId, 1);
            if (scenario === 'delete-last') expected.pop();
            if (scenario === 'edit') {
                if (chat[editId].mes !== 'Synthetic edited message.') throw new Error('Edit did not apply');
                expected.splice(editId, 1);
            }
            if (scenario === 'swipe') {
                if (chat[swipeId].swipe_id !== 1 || chat[swipeId].mes !== initial[swipeId].swipes[1]) throw new Error('Swipe did not apply');
                expected.splice(swipeId, 1);
            }
            if (scenario === 'regenerate') {
                if (chat.at(-1).mes !== 'Synthetic regenerated response.') throw new Error('Regenerate did not replace reply');
                expected.pop();
                // saveReply initializes reasoning on the preceding user message
                // before appending the replacement reply. Expect that exact field;
                // every other field on this message remains subject to comparison.
                if (!expected.at(-1).extra.reasoning) expected.at(-1).extra.reasoning = '';
            }
            const untouched = chat.filter((_, i) => !(scenario === 'edit' && i === editId)
                && !(scenario === 'swipe' && i === swipeId) && !(scenario === 'regenerate' && i === chat.length - 1));
            if (JSON.stringify(untouched) !== JSON.stringify(expected)) {
                const differences = [];
                const compare = (before, after, path) => {
                    if (JSON.stringify(before) === JSON.stringify(after) || differences.length >= 8) return;
                    if (before && after && typeof before === 'object' && typeof after === 'object') {
                        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) compare(before[key], after[key], `${path}.${key}`);
                    } else differences.push({ path, expected: before ?? null, actual: after ?? null });
                };
                compare(expected, untouched, 'chat');
                throw new Error('Operation changed unrelated chat entries: ' + JSON.stringify(differences));
            }
        }
        const ids = [...container.querySelectorAll('.mes')].map(el => Number(el.getAttribute('mesid')));
        const first = switched ? 0 : boundary - power_user.chat_truncation;
        if (ids.length !== chat.length - first || ids.some((id, i) => id !== first + i)) throw new Error('Final message IDs invalid');
        const expectedInsertions = mode === 'concurrent' && switched ? 0 : 1;
        if (insertions.length !== expectedInsertions || completions !== expectedInsertions) throw new Error('Unexpected older fragment insertion/completion count');
        const response = await fetch('/api/chats/get', { method: 'POST', headers: script.getRequestHeaders(),
            body: JSON.stringify({ avatar_url: active.characters[active.characterId].avatar, file_name: script.getCurrentChatId() }) });
        if (!response.ok || JSON.stringify((await response.json()).slice(1)) !== JSON.stringify(chat)) throw new Error('Saved chat differs from active array');
        return { scenario, mode, initialLength: initial.length, boundary, deleteId, editId, swipeId,
            trigger, completions, insertions, wrongChatInsertions, ids,
            arrayIntegrity: true, savedMatchesChat: true, chat, dom: chatSnapshot() };
    } finally {
        scheduler.yield = originalYield;
        for (const [method, original] of originals) container[method] = original;
        ctx.eventSource.removeListener(ctx.eventTypes.MORE_MESSAGES_LOADED, completed);
    }
}
