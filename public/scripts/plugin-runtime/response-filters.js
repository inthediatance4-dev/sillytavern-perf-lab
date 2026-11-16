const requestKey = body => JSON.stringify(body?.messages ?? body?.prompt ?? body?.input);
const generationPath = /^\/api\/(?:backends\/(?:chat-completions|text-completions|kobold)\/generate|novelai\/generate|horde\/generate-text)$/;

export function createResponseFilters(getContext, target = globalThis) {
    const pending = new Set();
    const { eventSource, eventTypes } = getContext();
    const original = target.fetch;
    const clear = () => pending.clear();
    const started = (type, _params, dry) => { if (!dry && type !== 'quiet' && type !== 'impersonate') clear(); };
    eventSource.on(eventTypes.CHAT_CHANGED, clear);
    eventSource.on(eventTypes.GENERATION_STARTED, started);
    const owned = record => {
        const context = getContext();
        return context.chatId === record.chatId && context.chatMetadata === record.metadata
            && context.chat === record.chat && context.groupId === record.groupId;
    };
    const wrapped = async function (input, init) {
        const isRequest = typeof Request !== 'undefined' && input instanceof Request;
        const pathname = new URL(isRequest ? input.url : String(input), 'http://localhost').pathname;
        if (!pending.size || !generationPath.test(pathname)) return original.call(this, input, init);
        const text = init?.body ?? (isRequest ? input.clone().text() : null);
        const response = original.call(this, input, init);
        response.catch(() => {});
        let body;
        try { body = JSON.parse(await text); } catch { return response; }
        const key = requestKey(body);
        const matches = [...pending].filter(record => owned(record) && key !== undefined && requestKey(record.data) === key);
        if (matches.length !== 1) return response;
        const record = matches[0];
        pending.delete(record);
        const result = await response;
        return result.ok ? record.filter(result, body) : result;
    };
    target.fetch = wrapped;
    return {
        register(data, filter) {
            const context = getContext();
            pending.add({ data, filter, chatId: context.chatId, metadata: context.chatMetadata,
                chat: context.chat, groupId: context.groupId });
            if (pending.size > 32) pending.delete(pending.values().next().value);
        },
        dispose() {
            clear();
            eventSource.removeListener(eventTypes.CHAT_CHANGED, clear);
            eventSource.removeListener(eventTypes.GENERATION_STARTED, started);
            if (target.fetch === wrapped) target.fetch = original;
        },
    };
}
