import { messageFingerprint } from './instruct.js';

/** Legacy shared key is only cleaned up; new Fate prompts are request-local. */
export const FATE_PROMPT_KEY = 'director_fate';
const FATE_NARRATOR_NAME = 'Narrator';
// Remove an entire unknown frame, including private text, or an old short token.
const FATE_FRAMES = /\uE000(directorfate\d+x[a-zA-Z0-9]+)\uE001[\s\S]*?\uE002\1\uE003|(\uE000directorfate\d+x[a-zA-Z0-9]+\uE001[\s\S]*$)|directorfate\d+x[a-zA-Z0-9]+/g;
const CATEGORIES = [
    { title: '意外的回声', theme: 'a surprising discovery or new information' },
    { title: '不期而遇', theme: 'an unexpected encounter or arrival' },
    { title: '悄然转向', theme: 'a change in circumstances or an unforeseen obstacle' },
    { title: '命运的馈赠', theme: 'an opportunity with an unexpected complication' },
    { title: '暗流涌动', theme: 'a shift in a relationship, trust, or motivation' },
    { title: '远方来讯', theme: 'a consequence of an earlier choice returning to the story' },
];
const STRENGTHS = { light: 'a small, plausible ripple', medium: 'a meaningful but manageable turn', strong: 'a major, consequential upheaval' };
const TITLES = new Set(CATEGORIES.map(category => category.title));
const isGroup = context => context.groupId !== undefined && context.groupId !== null && context.groupId !== '';
const isAi = message => message?.is_user === false && !message.is_system;
const validEvent = value => typeof value === 'string' && value.trim().length > 0
    && Array.from(value).length <= 400 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);

function readCard(value) {
    return value && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200
        && TITLES.has(value.title) && Object.hasOwn(STRENGTHS, value.strength) && validEvent(value.event) ? value : null;
}

function state(metadata) {
    const value = metadata?.director?.fate;
    if (value?.version !== 1) return { version: 1, held: null, bound: null };
    const bound = readCard(value.bound);
    return { version: 1, held: readCard(value.held), bound: bound && Number.isInteger(bound.slotIndex)
        && bound.slotIndex >= 0 && typeof bound.prevFingerprint === 'string' ? bound : null };
}

function parseEvent(raw) {
    if (typeof raw !== 'string' || raw.length > 16000) throw new Error();
    const start = raw.indexOf('{');
    if (start < 0) throw new Error();
    let depth = 0;
    let quoted = false;
    let escaped = false;
    let end = -1;
    for (let index = start; index < raw.length; index++) {
        const character = raw[index];
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') quoted = false;
        } else if (character === '"') quoted = true;
        else if (character === '{') depth++;
        else if (character === '}' && --depth === 0) { end = index + 1; break; }
    }
    if (end < 0) throw new Error();
    // Keep strict validation of the first complete object; never skip a bad
    // object to select a later response with different private content.
    const value = JSON.parse(raw.slice(start, end));
    if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || !validEvent(value.event)) throw new Error();
    return value.event.trim();
}

/** Visit only request prompt values; multimodal arrays and cyclic data are safe. */
function visit(value, transform, seen = new WeakSet()) {
    if (typeof value === 'string') return transform(value);
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const key of Object.keys(value)) value[key] = visit(value[key], transform, seen);
    return value;
}

function contains(data, text) {
    let found = false;
    for (const key of ['prompt', 'input']) visit(data?.[key], value => { found ||= value.includes(text); return value; });
    return found;
}

/**
 * Blind-card state and request lifecycle. Only view() may cross the UI boundary.
 * Group membership changes characterId during generation; the group owns that chat.
 * @param {() => object} getContext Current extension context
 * @param {object} options Injected generation and UI dependencies
 * @returns {object} Public controller
 */
export function createFateController(getContext, options = {}) {
    const { isGenerating = () => false, hasDraft = () => false, uuid = () => crypto.randomUUID(),
        random = Math.random, generate = context => context.generate('normal'), onChange = () => {},
        save = context => context.saveMetadata(), setSendButtonState = () => {},
        deactivateSendButtons = () => {}, activateSendButtons = () => {}, onRegenerateStart = () => {},
        onError = () => {}, onReveal = () => {} } = options;
    let revision = 0;
    let nonce = 0;
    let tokenSerial = 0;
    let busy = null;
    let armed = null;
    let regenerateDelete = null;
    let groupScope = null;
    const tokens = new Map();
    const requests = new WeakMap();
    const activeRequests = new Set();
    const dirtyMetadata = new WeakSet();
    const notify = () => { try { onChange(); } catch { /* UI failures cannot expose the private response. */ } };
    const capture = (context, independent = false) => ({ context, metadata: context.chatMetadata, chatId: context.chatId,
        groupId: context.groupId, characterId: isGroup(context) ? undefined : context.characterId, revision, nonce: independent ? null : nonce });
    const current = snapshot => {
        const context = getContext();
        return snapshot && snapshot.revision === revision && (snapshot.nonce === null || snapshot.nonce === nonce)
            && snapshot.metadata === context.chatMetadata && snapshot.chatId === context.chatId
            && snapshot.groupId === context.groupId && snapshot.characterId === (isGroup(context) ? undefined : context.characterId);
    };
    const clearPrompt = () => {
        delete getContext().extensionPrompts?.[FATE_PROMPT_KEY];
        for (const record of tokens.values()) delete record.snapshot.context.extensionPrompts?.[FATE_PROMPT_KEY];
    };
    const anchorMatches = (context, bound) => messageFingerprint(context.chat?.[bound.slotIndex - 1]) === bound.prevFingerprint;
    const publicCard = card => card ? { id: card.id, title: card.title, strength: card.strength } : null;
    const publicReveal = card => ({ ...publicCard(card), rarity: card.rarity ?? 'common', slotIndex: card.slotIndex });
    const view = () => {
        const context = getContext();
        const value = state(context.chatMetadata);
        const visibleBusy = busy && current(busy.snapshot);
        const reveal = value.bound && anchorMatches(context, value.bound) && isAi(context.chat[value.bound.slotIndex])
            ? { ...publicReveal(value.bound), event: value.bound.event } : null;
        return { held: publicCard(value.held), bound: publicCard(value.bound), reveal,
            busy: Boolean(visibleBusy), phase: visibleBusy ? busy.phase : 'idle' };
    };

    async function retrySave() {
        const snapshot = capture(getContext(), true);
        const metadata = snapshot.metadata;
        if (!metadata || !dirtyMetadata.has(metadata)) return;
        const value = metadata.director?.fate;
        try {
            if (await save(snapshot.context, () => current(snapshot)) !== false && current(snapshot)
                && metadata.director?.fate === value) dirtyMetadata.delete(metadata);
        } catch { /* Keep dirty state for the next save opportunity. */ }
    }

    async function commit(snapshot, next, rollbackOnFailure = true) {
        if (!current(snapshot)) return false;
        const metadata = snapshot.metadata;
        if (!metadata.director || typeof metadata.director !== 'object' || Array.isArray(metadata.director)) metadata.director = {};
        const previous = metadata.director.fate;
        metadata.director.fate = next;
        try {
            if (await save(snapshot.context, () => current(snapshot)) === false) throw new Error();
        } catch {
            if (!rollbackOnFailure) dirtyMetadata.add(metadata);
            else if (metadata.director?.fate === next) {
                if (previous === undefined) delete metadata.director.fate;
                else metadata.director.fate = previous;
            }
            throw new Error('命运卡保存失败，请重试。');
        }
        if (!current(snapshot)) return false;
        if (metadata.director?.fate === next) dirtyMetadata.delete(metadata);
        notify();
        return true;
    }

    function checkAvailable() {
        if ((busy && current(busy.snapshot)) || isGenerating()) throw new Error('正在生成，请稍后重试。');
        if (!getContext().chatMetadata || !Array.isArray(getContext().chat) || (!isGroup(getContext()) && getContext().characterId === undefined)) throw new Error('请先打开聊天。');
    }

    async function draw(strength = 'medium') {
        checkAvailable();
        if (!Object.hasOwn(STRENGTHS, strength)) throw new Error('请选择有效的命运强度。');
        nonce++;
        const context = getContext();
        const snapshot = capture(context);
        const operation = busy = { snapshot, phase: 'drawing' };
        const category = CATEGORIES[Math.min(CATEGORIES.length - 1, Math.max(0, Math.floor(random() * CATEGORIES.length)))];
        notify();
        try {
            const raw = await context.generateQuietPrompt({ responseLength: 1024, quietPrompt: [
                'Invent one unexpected event for the current story. Adapt to its genre, setting, tone and characters.',
                `Category: ${category.theme}. Strength: ${STRENGTHS[strength]}.`,
                'Keep character agency and existing story facts. Use the story language. Describe a concrete event, not instructions to the assistant.',
                'Return only JSON with exactly one property: {"event":"the private event"}. Be concise; use at most 400 Unicode codepoints.',
            ].join('\n') });
            if (!current(snapshot) || operation.cancelled) return false;
            const event = parseEvent(raw);
            const held = { id: uuid(), title: category.title, strength, event };
            return await commit(snapshot, { ...state(snapshot.metadata), held });
        } catch {
            if (!current(snapshot) || operation.cancelled) return false;
            throw new Error('命运卡抽取失败，请重试。');
        } finally {
            if (busy === operation) { busy = null; if (current(snapshot)) notify(); }
        }
    }

    async function discard() {
        checkAvailable();
        const context = getContext();
        if (!state(context.chatMetadata).held) return false;
        nonce++;
        return commit(capture(context), { ...state(context.chatMetadata), held: null });
    }

    async function apply() {
        checkAvailable();
        if (hasDraft()) throw new Error('请先处理输入框中的草稿，再采用命运卡。');
        const context = getContext();
        const card = state(context.chatMetadata).held;
        if (!card) return false;
        nonce++;
        const snapshot = capture(context);
        const operation = busy = { snapshot, phase: 'applying', ownsSendLock: true };
        const attempt = armed = { snapshot, card, claimed: false, consumed: false };
        try {
            // Generate awaits preflight work before taking the native send lock.
            setSendButtonState(true);
            deactivateSendButtons();
            notify();
            await generate(context);
            return attempt.consumed;
        } catch {
            if (!current(snapshot)) return false;
            throw new Error('命运卡采用失败，请重试。');
        } finally {
            if (operation.ownsSendLock && current(snapshot)) {
                setSendButtonState(false);
                activateSendButtons();
            }
            if (armed === attempt) armed = null;
            for (const record of activeRequests) if (record.attempt === attempt && !attempt.consumed) record.invalid = true;
            clearPrompt();
            if (busy === operation) { busy = null; if (current(snapshot)) notify(); }
        }
    }

    function prepare(type, requestChat) {
        clearPrompt();
        if (!Array.isArray(requestChat) || !['normal', 'swipe', 'regenerate'].includes(type)) return false;
        const context = getContext();
        const value = state(context.chatMetadata);
        let card;
        let attempt;
        let scope;
        let slotIndex;
        if (type === 'normal' && armed && !armed.claimed && current(armed.snapshot) && value.held === armed.card) {
            card = armed.card;
            attempt = armed;
            slotIndex = context.chat.length;
        } else if (value.bound) {
            const bound = value.bound;
            const exact = type === 'swipe' ? context.chat.length - 1 === bound.slotIndex && isAi(context.chat[bound.slotIndex])
                : type === 'regenerate' && context.chat.length === bound.slotIndex;
            const scoped = type === 'normal' && groupScope && !groupScope.injected && current(groupScope.snapshot)
                && groupScope.card === bound && context.chat.length === bound.slotIndex;
            if (!exact && !scoped) return false;
            if (!anchorMatches(context, bound)) { clearBound(); return false; }
            card = bound;
            scope = scoped ? groupScope : null;
            slotIndex = bound.slotIndex;
        }
        if (!card) return false;
        const text = `[Director Fate: introduce this fixed event naturally in this story reply.]\n${card.event}`;
        // Budget the complete text. Also protect whitespace that text-completion
        // assembly normalizes, so restoring literals cannot grow the reserved input.
        let tag;
        do { tag = `directorfate${++tokenSerial}x${uuid().replace(/[^a-zA-Z0-9]/g, '').slice(-8)}`; } while (text.includes(tag));
        const delimiters = { '{': '\uE004', '}': '\uE005', '<': '\uE006', '>': '\uE007', '\r': '\uE008', '\n': '\uE009' };
        const shielded = text.replace(/[{}<>\r\n]/g, character => delimiters[character]);
        const token = `\uE000${tag}\uE001${shielded}\uE002${tag}\uE003`;
        tokens.set(token, { token, text, card, attempt, scope, slotIndex, type, snapshot: capture(context, !attempt),
            prevFingerprint: messageFingerprint(context.chat[slotIndex - 1]), invalid: false });
        // The interceptor receives this Generate call's copy, not the persisted
        // chat. Other quiet requests therefore cannot inherit or remove its row.
        requestChat.push({ name: FATE_NARRATOR_NAME, is_user: false, is_system: true, mes: token,
            extra: { type: 'narrator', directorFatePrompt: true } });
        return true;
    }

    function clearBound() {
        const context = getContext();
        const value = state(context.chatMetadata);
        if (!value.bound) return;
        context.chatMetadata.director.fate = { ...value, bound: null };
        groupScope = null;
        notify();
        context.saveMetadataDebounced?.();
    }

    const { eventSource, eventTypes } = getContext();
    const on = (name, handler) => { if (eventTypes[name]) eventSource.on(eventTypes[name], handler); };
    on('CHAT_CHANGED', () => {
        clearPrompt();
        revision++;
        nonce++;
        busy = armed = regenerateDelete = groupScope = null;
        tokens.clear();
        activeRequests.clear();
        notify();
    });
    on('GENERATION_STARTED', async (type, _params, dryRun) => {
        if (dryRun) return;
        if (type === 'quiet' || type === 'impersonate') return retrySave();
        clearPrompt();
        for (const record of activeRequests) record.invalid = true;
        activeRequests.clear();
        tokens.clear();
        regenerateDelete = null;
        const context = getContext();
        const bound = state(context.chatMetadata).bound;
        if (type === 'regenerate' && !isGroup(context) && bound && isAi(context.chat[bound.slotIndex]) && context.chat.length - 1 === bound.slotIndex && anchorMatches(context, bound)) {
            regenerateDelete = { snapshot: capture(context, true), card: bound };
            onRegenerateStart();
        }
        await retrySave();
    });
    on('GENERATE_AFTER_DATA', (data, dryRun) => {
        if (!data || typeof data !== 'object') return;
        const matched = new Set();
        const seen = new WeakSet();
        for (const key of ['prompt', 'input']) if (Object.hasOwn(data, key)) {
            data[key] = visit(data[key], value => value.replace(FATE_FRAMES, (frame, _tag, malformedFrame) => {
                if (malformedFrame) console.warn('Director Fate stripped a malformed frame and the remaining prompt');
                const record = tokens.get(frame);
                if (!record || record.invalid || !current(record.snapshot)) return '';
                matched.add(record);
                return record.text;
            }), seen);
        }
        for (const record of matched) {
            if (!dryRun && !record.invalid) {
                requests.set(data, record);
                activeRequests.add(record);
                if (record.attempt) record.attempt.claimed = true;
                if (record.scope) record.scope.injected = true;
            }
        }
        if (!dryRun) clearPrompt();
    });
    on('GENERATION_COMPLETED', async ({ data, type, chatId, chatMetadata }) => {
        const record = requests.get(data);
        requests.delete(data);
        activeRequests.delete(record);
        if (!record || record.invalid || !current(record.snapshot) || record.type !== type
            || chatId !== record.snapshot.chatId || chatMetadata !== record.snapshot.metadata || !contains(data, record.text)) return;
        const context = getContext();
        const value = state(chatMetadata);
        const previous = record.attempt ? value.held : value.bound;
        if (previous !== record.card || !isAi(context.chat[record.slotIndex])
            || messageFingerprint(context.chat[record.slotIndex - 1]) !== record.prevFingerprint) return;
        const target = context.chat[record.slotIndex];
        const bound = { ...record.card, slotIndex: record.slotIndex, prevFingerprint: messageFingerprint(context.chat[record.slotIndex - 1]),
            generationId: target.extra?.gen_id ?? null, batchEndIndex: record.slotIndex, groupRetry: false };
        if (!record.attempt && value.bound && Object.keys(bound).length === Object.keys(value.bound).length
            && Object.keys(bound).every(key => Object.is(bound[key], value.bound[key]))) {
            if (record.scope) record.scope.card = value.bound;
            return;
        }
        // The reply is already saved. Consumption cannot be undone by a metadata
        // failure, or applying the held card again would duplicate its event.
        if (record.attempt) record.attempt.consumed = true;
        if (record.scope) record.scope.card = bound;
        try {
            const saving = commit(record.snapshot, { ...value, held: record.attempt ? null : value.held, bound }, false);
            // The binding is now visible in memory. Announce a new consumption
            // before persistence settles, without passing private event text.
            if (record.attempt) {
                try { onReveal(publicReveal(bound)); } catch { /* UI failures cannot undo a generated reply. */ }
            }
            await saving;
        } catch {
            if (current(record.snapshot)) {
                notify();
                onError('剧情已生成，但命运牌状态保存失败。');
                await retrySave();
            }
        }
    });
    const finish = stopped => {
        clearPrompt();
        regenerateDelete = null;
        if (stopped) {
            for (const record of tokens.values()) record.invalid = true;
            for (const record of activeRequests) record.invalid = true;
            if (armed && current(armed.snapshot)) armed.claimed = true;
            if (busy?.phase === 'drawing' && current(busy.snapshot)) busy.cancelled = true;
        }
        // ENDED is a UI unlock and runs before COMPLETED. Keep request provenance.
        // A later send lock belongs to native generation, not this apply's cleanup.
        if (!stopped && busy?.phase === 'applying') busy.ownsSendLock = false;
    };
    on('GENERATION_ENDED', () => finish(false));
    on('GENERATION_STOPPED', () => finish(true));
    on('MESSAGE_SENT', clearBound);
    on('MESSAGE_RECEIVED', messageId => {
        const context = getContext();
        const value = state(context.chatMetadata);
        if (!value.bound || Number(messageId) <= value.bound.slotIndex) return;
        const message = context.chat[Number(messageId)];
        if (isGroup(context) && isAi(message) && value.bound.generationId !== null && message.extra?.gen_id === value.bound.generationId) {
            const bound = { ...value.bound, batchEndIndex: Number(messageId) };
            context.chatMetadata.director.fate = { ...value, bound };
            if (groupScope?.card === value.bound) groupScope.card = bound;
            context.saveMetadataDebounced?.();
        } else clearBound();
    });
    on('MESSAGE_DELETED', () => {
        const context = getContext();
        const bound = state(context.chatMetadata).bound;
        if (!bound) return;
        const direct = isGenerating() && regenerateDelete && current(regenerateDelete.snapshot) && regenerateDelete.card === bound
            && context.chat.length === bound.slotIndex && anchorMatches(context, bound);
        const scoped = groupScope && current(groupScope.snapshot) && groupScope.card === bound
            && context.chat.length >= bound.slotIndex && anchorMatches(context, bound);
        regenerateDelete = null;
        if (!direct && !scoped && (context.chat.length <= (bound.batchEndIndex ?? bound.slotIndex) || !anchorMatches(context, bound))) clearBound();
    });
    on('GROUP_REGENERATION_STARTED', async marker => {
        groupScope = null;
        const context = getContext();
        const value = state(context.chatMetadata);
        const bound = value.bound;
        if (!isGroup(context) || !bound || marker?.groupId !== context.groupId || marker.chatId !== context.chatId || !anchorMatches(context, bound)) return;
        const batchMatches = bound.generationId !== null && marker.generationId === bound.generationId
            && context.chat.slice(bound.slotIndex).length > 0
            && context.chat.slice(bound.slotIndex).every(message => isAi(message) && message.extra?.gen_id === bound.generationId);
        const retryBatch = bound.groupRetry && context.chat.slice(bound.slotIndex).every(message => isAi(message))
            && new Set(context.chat.slice(bound.slotIndex).map(message => message.extra?.gen_id)).size <= 1;
        if (!batchMatches && !retryBatch) return;
        const retry = { ...bound, groupRetry: true };
        const snapshot = capture(context, true);
        groupScope = { marker, snapshot, card: retry, injected: false };
        try {
            if (!await commit(snapshot, { ...value, bound: retry })) marker.cancelled = true;
        } catch {
            marker.cancelled = true;
            onError('命运牌未能保存，未重新生成，请重试。');
        }
        if (marker.cancelled) groupScope = null;
    });
    on('GROUP_REGENERATION_FINISHED', marker => {
        if (groupScope?.marker !== marker) return;
        for (const record of activeRequests) if (record.scope === groupScope) record.invalid = true;
        groupScope = null;
        clearPrompt();
    });
    return { view, draw, discard, apply, prepare };
}
