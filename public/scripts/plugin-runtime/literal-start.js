/** Official Generate re-expands chat[0] before interceptors. A system-only empty
 * anchor keeps finalized Director text out of that slot, including concurrent saves. */
export function ensureLiteralStart(context, { inserting = false } = {}) {
    const chat = context.chat;
    if (!Array.isArray(chat) || (chat.length ? !chat[0]?.extra?.director : !inserting)) return false;
    const shift = value => {
        if (!value || typeof value !== 'object') return;
        if (Number.isInteger(value.slotIndex) && value.slotIndex >= 0) value.slotIndex++;
        if (Number.isInteger(value.batchEndIndex) && value.batchEndIndex >= 0) value.batchEndIndex++;
    };
    const metadata = context.chatMetadata;
    shift(metadata?.director?.boundInstruct);
    shift(metadata?.director?.fate?.bound);
    for (const entry of metadata?.director?.fate?.log ?? []) shift(entry);
    // Quote identity is logical-message/swipe/fingerprint based. Physical indices
    // are cached projections and move together; quotes and ledger IDs stay intact.
    for (const state of [metadata?.affinity?.__affinity, metadata?.director?.__affinity]) {
        for (const event of [...(state?.events ?? []), ...(state?.archives ?? [])]) {
            for (const key of ['source', 'result', 'acknowledgement']) {
                if (Number.isInteger(event?.[key]?.index) && event[key].index >= 0) event[key].index++;
            }
        }
    }
    chat.unshift({ name: 'System', is_user: false, is_system: true, mes: '', send_date: '',
        extra: { type: 'narrator', directorStart: true } });
    return true;
}

export function hideLiteralStart(context, document = globalThis.document) {
    if (!context.chat?.[0]?.extra?.directorStart) return;
    const element = document?.querySelector('#chat .mes[mesid="0"]');
    if (element) { element.hidden = true; element.style.display = 'none'; }
}
