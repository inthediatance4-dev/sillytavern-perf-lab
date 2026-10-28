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
