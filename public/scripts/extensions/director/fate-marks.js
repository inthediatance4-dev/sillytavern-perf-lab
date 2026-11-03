/**
 * Paint only loaded message headers. The controller validates at most 50 log
 * anchors; the cached slot map keeps ordinary message renders independent of
 * chat length and never reads or changes a message body.
 * getEntries(slotIndex) limits status checks to one slot; getEntries() reads the full log.
 */
export function createFateMarks({ getContext, getEntries, onOpen }) {
    let dirty = true;
    let metadata;
    let chatId;
    let slots = new Map();
    const checkedSlots = new Set();
    const entryIds = new WeakMap();
    const pulsed = new Set();

    function invalidate() {
        dirty = true;
        slots.clear();
        checkedSlots.clear();
    }

    function entriesBySlot(index) {
        const context = getContext();
        if (metadata !== context.chatMetadata || chatId !== context.chatId) {
            metadata = context.chatMetadata;
            chatId = context.chatId;
            invalidate();
            pulsed.clear();
        }
        if (dirty) {
            if (index !== undefined && checkedSlots.has(index)) return slots;
            if (index === undefined) slots = new Map();
            for (const entry of getEntries(index)) {
                // Logs are newest first. If replays share a slot, its newest
                // surviving fate owns the single header mark.
                if ((index === undefined || entry.slotIndex === index) && entry.status === 'ok'
                    && !slots.has(entry.slotIndex)) slots.set(entry.slotIndex, entry);
            }
            if (index === undefined) {
                dirty = false;
                checkedSlots.clear();
            } else checkedSlots.add(index);
        }
        return slots;
    }

    // after-hours.css sets animation and transition to none under body.reduced-motion
    // and prefers-reduced-motion. Those rules do not emit animationend, so the
    // fresh class must be omitted or removed without waiting for that event.
    function motionReduced(mark) {
        if (document.body?.classList.contains('reduced-motion') || mark.closest('.director_fate_nomotion')) return true;
        if (typeof globalThis.matchMedia !== 'function') return false;
        return Boolean(globalThis.matchMedia('(prefers-reduced-motion: reduce)')?.matches);
    }

    function paintOne(mesId) {
        const index = Number(mesId);
        if (!Number.isInteger(index) || index < 0) return null;
        const entry = entriesBySlot(index).get(index);
        const mes = document.querySelector(`#chat .mes[mesid="${index}"]`);
        const header = mes?.querySelector('.ch_name');
        if (!header || header.closest('.mes_text')) return null;
        let mark = header.querySelector('.director_fate_mark');
        if (!entry) {
            mark?.remove();
            return null;
        }
        const name = header.querySelector('.name_text');
        if (!name) return null;
        if (!mark) {
            mark = document.createElement('button');
            mark.type = 'button';
            mark.className = 'director_fate_mark';
            mark.textContent = '🎴';
            mark.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                onOpen(entryIds.get(mark));
            });
            const finishPulse = event => {
                if (event.target === mark) mark.classList.remove('is_fresh');
            };
            mark.addEventListener('animationend', finishPulse);
            mark.addEventListener('animationcancel', finishPulse);
            name.after(mark);
        }
        entryIds.set(mark, entry.id);
        mark.dataset.rarity = entry.rarity;
        mark.setAttribute('aria-label', `命运牌：〈${entry.title}〉`);
        if (motionReduced(mark)) mark.classList.remove('is_fresh');
        return mark;
    }

    function paintAll() {
        const entries = entriesBySlot();
        // Limit removal to headers too: a similarly named element in formatted
        // message content must never make this painter change .mes_text.
        for (const mark of document.querySelectorAll('#chat .ch_name .director_fate_mark')) {
            if (mark.closest('.mes_text')) continue;
            const index = Number(mark.closest('.mes')?.getAttribute('mesid'));
            if (!entries.has(index)) mark.remove();
        }
        for (const index of entries.keys()) paintOne(index);
    }

    function pulse(entryId) {
        const entries = entriesBySlot();
        if (pulsed.has(entryId)) return;
        const entry = [...entries.values()].find(value => value.id === entryId);
        if (!entry) return;
        const mark = paintOne(entry.slotIndex);
        if (!mark) return;
        pulsed.add(entryId);
        if (motionReduced(mark)) return;
        mark.classList.add('is_fresh');
    }

    return { paintOne, paintAll, invalidate, pulse };
}
