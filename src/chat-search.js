/**
 * Match all query fragments across messages. Each chat gets its own state.
 * The callable form remains a pure array matcher; accept() consumes one message.
 * @param {string[]} fragments Normalized query fragments
 * @returns {((texts: string[]) => boolean) & {accept: (text: unknown) => boolean}}
 */
export function createTextMatcher(fragments) {
    const remaining = new Set(fragments);
    const matcher = texts => fragments.every(fragment => texts.some(text => String(text ?? '').toLowerCase().includes(fragment)));
    matcher.accept = text => {
        if (remaining.size === 0) return true;
        const normalized = String(text ?? '').toLowerCase();
        for (const fragment of remaining) {
            if (normalized.includes(fragment)) remaining.delete(fragment);
        }
        return remaining.size === 0;
    };
    return matcher;
}
