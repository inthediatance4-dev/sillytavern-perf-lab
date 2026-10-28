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

export function focusDescriptor() {
    const el = document.activeElement;
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
    const start = dialog ?? document.body;
    start.tabIndex = -1;
    start.focus();
    return focusables.length + 2;
}
