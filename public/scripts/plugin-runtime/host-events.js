const FOREGROUND = new Set(['normal', 'swipe', 'regenerate', 'continue', 'append', 'appendFinal']);
const MARKER = /\uE030strequest([a-zA-Z0-9-]+)\uE031/g;

function visit(value, replace, seen = new WeakSet()) {
    if (typeof value === 'string') return replace(value);
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const key of Object.keys(value)) value[key] = visit(value[key], replace, seen);
    return value;
}

class Events {
    listeners = new Map();
    on(type, callback) { const list = this.listeners.get(type) ?? []; list.push(callback); this.listeners.set(type, list); }
    removeListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== callback)); }
    makeFirst(type, callback) { this.removeListener(type, callback); this.listeners.set(type, [callback, ...(this.listeners.get(type) ?? [])]); }
    once(type, callback) { const wrapped = async (...args) => { this.removeListener(type, wrapped); return callback(...args); }; this.on(type, wrapped); }
    async emit(type, ...args) { for (const callback of [...(this.listeners.get(type) ?? [])]) await callback(...args); }
}

async function jsonBody(input, init = {}) {
    let body = init.body;
    const headers = new Headers(init.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : {}));
    if (body === undefined && typeof Request !== 'undefined' && input instanceof Request) body = await input.clone().arrayBuffer();
    if (headers.get('Content-Encoding') === 'gzip') {
        body = await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) body = new TextDecoder().decode(body);
    else if (body instanceof Blob) body = await body.text();
    return typeof body === 'string' ? JSON.parse(body) : null;
}
const requestKey = body => JSON.stringify(body?.messages ?? body?.prompt ?? body?.input);
const ownerOf = context => ({ chatId: context.chatId, chatMetadata: context.chatMetadata, chat: context.chat,
    groupId: context.groupId, avatar: context.characters?.[context.characterId]?.avatar });
const currentOwner = (context, owner) => context.chat === owner.chat && context.chatMetadata === owner.chatMetadata
    && context.chatId === owner.chatId && context.groupId === owner.groupId;
const replyStamp = message => JSON.stringify([message.name, message.gen_started, message.gen_finished,
    message.send_date, message.extra?.gen_id]);

/** Official hosts lack typed completion receipts. Observe transport and native saves;
 * UI unlock alone is deliberately never treated as successful generation. */
export function createHostEventBridge(getContext, core, groups, options = {}) {
    const native = getContext().eventSource;
    const names = getContext().eventTypes;
    if (names.GENERATION_COMPLETED) return { eventSource: native, eventTypes: names,
        prepare() {}, seal() {}, registerReplySanitizer() {}, runGenerate: (...args) => core.Generate(...args), dispose() {} };
    const events = new Events();
    const eventTypes = { ...names, GENERATION_COMPLETED: 'standalone_generation_completed',
        CHAT_SAVE_PREPARED: 'standalone_chat_save_prepared',
        GROUP_REGENERATION_STARTED: 'standalone_group_regeneration_started', GROUP_REGENERATION_FINISHED: 'standalone_group_regeneration_finished' };
    const subscriptions = [];
    const tokens = new Map();
    const requests = new Set();
    const sanitizers = new Map();
    const uuid = options.uuid ?? (() => crypto.randomUUID());
    const target = options.fetchTarget ?? globalThis;
    const originalFetch = target.fetch;
    let disposed = false;
    let groupRunning = false;
    let saveTail = Promise.resolve();
    let active = null;
    const on = (name, callback) => {
        if (!names[name]) return;
        native.on(names[name], callback);
        if (name === 'MESSAGE_RECEIVED') native.makeFirst?.(names[name], callback);
        subscriptions.push([names[name], callback]);
    };
    const prepared = new WeakMap();
    function registerReplySanitizer(index, sanitize) {
        const context = getContext();
        const message = context.chat?.[index];
        if (typeof sanitize !== 'function' || !message || message.is_user || message.is_system
            || !(message.gen_started || message.gen_finished || message.send_date)) return;
        // No chat graphs, request bodies or private text survive a chat switch.
        // These compact provenance stamps protect native snapshots whose async
        // compression finishes only after CHAT_CHANGED has cleared live requests.
        const scope = { chatId: context.chatId, groupId: context.groupId,
            avatar: context.characters?.[context.characterId]?.avatar, index, stamp: replyStamp(message), sanitize };
        const key = JSON.stringify([scope.chatId, scope.groupId, scope.avatar, index, scope.stamp]);
        sanitizers.set(key, scope);
        if (sanitizers.size > 128) sanitizers.delete(sanitizers.keys().next().value);
    }
    function prepare(type, requestChat) {
        if (!Array.isArray(requestChat) || prepared.has(requestChat)) return;
        const record = { type: type || 'normal', ...ownerOf(getContext()), stopped: false, sent: false, ok: false, candidates: [] };
        if (FOREGROUND.has(record.type)) active = record;
        const id = uuid().replace(/[^a-zA-Z0-9-]/g, '');
        const marker = `\uE030strequest${id}\uE031`;
        tokens.set(id, record);
        // Never mutate persistent chat objects supplied by another interceptor.
        if (requestChat.length) requestChat[requestChat.length - 1] = { ...requestChat.at(-1), mes: String(requestChat.at(-1).mes ?? '') + marker };
        else requestChat.push({ name: 'System', is_user: false, is_system: true, mes: marker, extra: { type: 'narrator' } });
        prepared.set(requestChat, record);
        if (tokens.size > 128) tokens.delete(tokens.keys().next().value);
    }
    async function afterData(data, dryRun) {
        const found = new Set();
        visit(data, text => text.replace(MARKER, (_match, id) => {
            const record = tokens.get(id);
            if (record) found.add(record);
            return '';
        }));
        const record = found.size === 1 ? [...found][0] : null;
        await events.emit(eventTypes.GENERATE_AFTER_DATA, data, dryRun, { type: record?.type });
        if (record && FOREGROUND.has(record.type) && !dryRun && currentOwner(getContext(), record)) {
            record.data = data;
            requests.add(record);
            if (requests.size > 128) requests.delete(requests.values().next().value);
        }
    }
    function captureReceived(id, type) {
        const context = getContext();
        const message = context.chat?.[id];
        if (!message || message.is_user || message.is_system) return;
        const record = [...requests].reverse().find(item => item.sent && !item.stopped && FOREGROUND.has(item.type)
            && (item.type === type || item.type === 'regenerate' && type === 'normal') && currentOwner(context, item));
        if (!record) return;
        return { record, index: id, message, swipe: message.swipe_id ?? 0 };
    }
    function receive(candidate) {
        if (!candidate) return;
        const { record, index, message, swipe } = candidate;
        const context = getContext();
        if (!currentOwner(context, record) || context.chat[index] !== message || (message.swipe_id ?? 0) !== swipe) return;
        // Freeze after our awaited finalization listeners, so controlled privacy
        // cleanup is part of the receipt. Later edits still fail the saved-text check.
        record.candidates.push({ index, message, text: message.mes, swipe, rendered: false });
        if (record.stream) {
            const stream = record.processor;
            record.ok = !!stream && stream.isFinished === true && stream.isStopped !== true
                && !stream.abortController?.signal.aborted && !stream.toolCalls?.length;
        }
    }
    const matchesSaveOwner = (record, body, url) => record.groupId != null && record.groupId !== ''
        ? url === '/api/chats/group/save' && body.id === record.chatId
        : url === '/api/chats/save' && body.file_name === record.chatId && body.avatar_url === record.avatar;
    async function prepareSave(body, url, plan) {
        if (!Array.isArray(body?.chat)) return false;
        let changed = false;
        for (const { record, candidate } of plan) {
            if (!matchesSaveOwner(record, body, url)) continue;
            const message = body.chat[candidate.index + 1];
            if (!message || message.is_user || message.is_system) continue;
            const payload = { data: record.data, type: record.type, chatId: record.chatId, chatMetadata: record.chatMetadata,
                groupId: record.groupId, messageId: candidate.index, message, liveMessage: candidate.message, changed: false };
            await events.emit(eventTypes.CHAT_SAVE_PREPARED, payload);
            changed ||= payload.changed === true;
        }
        for (const scope of sanitizers.values()) {
            if (!matchesSaveOwner(scope, body, url)) continue;
            const message = body.chat[scope.index + 1];
            if (!message || message.is_user || message.is_system || replyStamp(message) !== scope.stamp) continue;
            const stripped = scope.sanitize(message);
            changed = stripped || changed;
        }
        return changed;
    }
    async function saved(body, url) {
        if (!Array.isArray(body?.chat)) return;
        for (const record of [...requests]) {
            if (record.stopped || !record.ok || !currentOwner(getContext(), record) || !FOREGROUND.has(record.type)) continue;
            if (!matchesSaveOwner(record, body, url)) continue;
            const candidates = record.candidates.filter(candidate => {
                const message = body.chat[candidate.index + 1];
                return message && !message.is_user && !message.is_system && message.mes === candidate.text
                    && (message.swipe_id ?? 0) === candidate.swipe;
            });
            if (!candidates.length) continue;
            requests.delete(record);
            await events.emit(eventTypes.GENERATION_COMPLETED, { data: record.data, type: record.type,
                chatId: record.chatId, chatMetadata: record.chatMetadata });
        }
    }
    const observedFetch = async function (input, init) {
        const url = String(typeof Request !== 'undefined' && input instanceof Request ? input.url : input);
        const pathname = new URL(url, 'http://localhost').pathname;
        const generating = /^\/api\/(?:backends\/(?:chat-completions|text-completions|kobold)\/generate|novelai\/generate|horde\/generate-text)$/.test(pathname);
        const polling = pathname === '/api/horde/task-status';
        const saving = pathname === '/api/chats/save' || pathname === '/api/chats/group/save';
        if (!generating && !saving && !polling) return originalFetch.call(this, input, init);
        // Generation transport is immediate; native saves wait for scoped cleanup.
        const bodyPromise = jsonBody(input, init).catch(() => null);
        // Bind cleanup before decoding/queueing: an already captured old-chat save
        // must also be scrubbed if the UI switches chats while it waits.
        const context = saving ? getContext() : null;
        const plan = saving ? [...requests].filter(record => currentOwner(context, record)).flatMap(record => record.candidates
            .filter(candidate => context.chat[candidate.index] === candidate.message).map(candidate => ({ record, candidate }))) : [];
        const dispatchSave = async () => {
            const body = await bodyPromise;
            let outgoing = init;
            if (body && await prepareSave(body, pathname, plan)) {
                const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : {}));
                let serialized = JSON.stringify(body);
                if (headers.get('Content-Encoding') === 'gzip' && typeof CompressionStream === 'function') {
                    serialized = await new Response(new Blob([serialized]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
                } else headers.delete('Content-Encoding');
                headers.delete('Content-Length');
                outgoing = { ...init, headers, body: serialized };
            }
            return originalFetch.call(this, input, outgoing);
        };
        const responsePromise = saving ? saveTail.then(dispatchSave) : originalFetch.call(this, input, init);
        if (saving) saveTail = responsePromise.then(() => {}, () => {});
        responsePromise.catch(() => {});
        let record;
        const body = await bodyPromise;
        if (generating && body) {
            record = [...requests].find(item => !item.sent && requestKey(item.data) === requestKey(body)
                && (!body.type || body.type === item.type || item.type === 'regenerate' && body.type === 'normal'));
            if (record) {
                record.sent = true;
                record.stream = body.stream === true || body.streaming === true;
                record.processor = record.stream ? core.streamingProcessor : null;
                const signal = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : null);
                signal?.addEventListener('abort', () => { record.stopped = true; }, { once: true });
            }
        }
        const response = await responsePromise;
        if (polling && response.ok && body) {
            const task = [...requests].find(item => item.hordeId && item.hordeId === body.taskId);
            if (task) {
                try {
                    const result = await response.clone().json();
                    task.ok = result.done === true && !result.faulted && typeof result.generations?.[0]?.text === 'string';
                } catch { task.ok = false; }
            }
        }
        // Completion listeners may save metadata themselves. Never hold the native
        // save's fetch open while they wait for native isChatSaving to clear.
        if (saving && response.ok && body) saved(body, pathname).catch(() => {});
        if (record && !record.stream && response.ok) {
            try {
                const result = await response.clone().json();
                if (pathname === '/api/horde/generate-text' && typeof result.id === 'string') record.hordeId = result.id;
                const choice = result.choices?.[0];
                record.ok = !result.error && !choice?.message?.tool_calls?.length
                    && (typeof choice?.text === 'string' || typeof choice?.message?.content === 'string'
                        || typeof result.results?.[0]?.text === 'string' || typeof result.output === 'string');
            } catch { record.ok = false; }
        }
        return response;
    };
    target.fetch = observedFetch;
    for (const [name, value] of Object.entries(names)) {
        if (name === 'GENERATE_AFTER_DATA') { on(name, afterData); continue; }
        on(name, async (...args) => {
            // A helper-scoped cancellation cannot revoke a native transport
            // receipt or cancel another plugin's native generation lifecycle.
            if (name === 'GENERATION_STOPPED' && typeof args[0] === 'string') return;
            const candidate = name === 'MESSAGE_RECEIVED' ? captureReceived(...args) : null;
            if (name === 'GENERATION_STARTED' && !args[2] && args[0] !== 'quiet' && args[0] !== 'impersonate') {
                active = null;
                for (const record of requests) if (record.stopped || !record.candidates.length) requests.delete(record);
            }
            if (name === 'GENERATION_STOPPED' && active) active.stopped = true;
            // Finalize native received-listener edits once; later rerenders cannot reauthorize manual edits.
            if (name === 'CHARACTER_MESSAGE_RENDERED') {
                const context = getContext();
                for (const record of requests) {
                    if (!currentOwner(context, record)) continue;
                    for (const candidate of record.candidates) {
                        if (candidate.rendered || candidate.index !== Number(args[0])
                            || context.chat[candidate.index] !== candidate.message
                            || (candidate.message.swipe_id ?? 0) !== candidate.swipe) continue;
                        candidate.text = candidate.message.mes;
                        candidate.rendered = true;
                    }
                }
            }
            if (name === 'CHAT_CHANGED') { requests.clear(); tokens.clear(); active = null; }
            await events.emit(value, ...args);
            if (candidate) receive(candidate);
        });
    }
    async function regenerateGroup() {
        if (groupRunning) return;
        const context = getContext();
        const owner = ownerOf(context);
        const marker = { generationId: context.chat.at(-1)?.extra?.gen_id ?? null, cancelled: false };
        groupRunning = true;
        try {
            await events.emit(eventTypes.GROUP_REGENERATION_STARTED, marker);
            if (marker.cancelled || !currentOwner(getContext(), owner)) { core.setSendButtonState?.(false); return; }
            return await groups.regenerateGroup();
        } finally {
            groupRunning = false;
            await events.emit(eventTypes.GROUP_REGENERATION_FINISHED, marker);
        }
    }
    const command = getContext().SlashCommandParser?.commands?.regenerate;
    const callback = command?.callback;
    const wrappedCallback = async function (...args) {
        const context = getContext();
        if (context.groupId != null && context.groupId !== '') {
            const owner = ownerOf(context);
            const operation = async () => {
                const started = Date.now();
                while (core.isGenerating?.() || groups.is_group_generating) {
                    if (Date.now() - started >= 10000 || !currentOwner(getContext(), owner)) return '';
                    await new Promise(resolve => setTimeout(resolve, 25));
                }
                if (!currentOwner(getContext(), owner)) return '';
                await regenerateGroup();
                return '';
            };
            const pending = operation();
            if (String(args[0]?.await).toLowerCase() === 'true') return pending;
            pending.catch(() => core.setSendButtonState?.(false));
            return '';
        }
        return callback.apply(this, args);
    };
    if (command) command.callback = wrappedCallback;
    const document = options.document ?? globalThis.document;
    const click = event => {
        if (!event.target?.closest?.('#option_regenerate')) return;
        const context = getContext();
        if (context.groupId == null || context.groupId === '') return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (core.isGenerating?.() || groups.is_group_generating || core.this_edit_mes_id === context.chat.length - 1) return;
        regenerateGroup().catch(() => core.setSendButtonState?.(false));
    };
    document?.addEventListener('click', click, true);
    return { eventSource: events, eventTypes, prepare, seal() {}, registerReplySanitizer, runGenerate: (...args) => core.Generate(...args),
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const [type, listener] of subscriptions) native.removeListener(type, listener);
            if (target.fetch === observedFetch) target.fetch = originalFetch;
            if (command?.callback === wrappedCallback) command.callback = callback;
            document?.removeEventListener('click', click, true);
            requests.clear(); tokens.clear(); sanitizers.clear(); active = null;
        } };
}
