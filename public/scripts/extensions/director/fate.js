import { messageFingerprint } from './instruct.js';
import { ALL_TITLES, CATEGORIES, CATEGORY_IDS, RARITIES, findCategoryByTitle, rollOffer } from './fate-decks.js';

/** Legacy shared key is only cleaned up; new Fate prompts are request-local. */
export const FATE_PROMPT_KEY = 'director_fate';
const FATE_NARRATOR_NAME = 'Narrator';
// Remove an entire unknown frame, including private text, or an old short token.
const FATE_FRAMES = /\uE000(directorfate\d+x[a-zA-Z0-9]+)\uE001[\s\S]*?\uE002\1\uE003|(\uE000directorfate\d+x[a-zA-Z0-9]+\uE001[\s\S]*$)|directorfate\d+x[a-zA-Z0-9]+/g;
const STRENGTHS = { light: 'a small, plausible ripple', medium: 'a meaningful but manageable turn', strong: 'a major, consequential upheaval' };
const categoryById = new Map(CATEGORIES.map(category => [category.id, category]));
const isGroup = context => context.groupId !== undefined && context.groupId !== null && context.groupId !== '';
const isAi = message => message?.is_user === false && !message.is_system;
const validEvent = value => typeof value === 'string' && value.trim().length > 0
    && Array.from(value).length <= 400 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);

function cardRarity(card) {
    return Object.hasOwn(RARITIES, card?.rarity) ? card.rarity : 'common';
}

function cardCategoryId(card) {
    if (CATEGORY_IDS.has(card?.category)) return card.category;
    return findCategoryByTitle(card?.title)?.id ?? null;
}

function readCard(value) {
    // TODO: custom decks (item 4) need per-deck validation.
    if (!value || typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 200) return null;
    if (!ALL_TITLES.has(value.title) || !Object.hasOwn(STRENGTHS, value.strength) || !validEvent(value.event)) return null;
    if (!cardCategoryId(value)) return null;
    return value;
}

function readOffer(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 200) return null;
    if (!Array.isArray(value.cards) || value.cards.length !== 3) return null;
    const seen = new Set();
    for (const card of value.cards) {
        const category = categoryById.get(card?.category);
        if (!category || !category.titles.includes(card.title) || !Object.hasOwn(RARITIES, card.rarity) || seen.has(category.id)) return null;
        seen.add(category.id);
    }
    return value;
}

function readPity(value) {
    return Number.isInteger(value) && value >= 0 && value <= 99 ? value : 0;
}

function readRecent(value) {
    if (!Array.isArray(value) || value.length > 2 || value.some(id => !CATEGORY_IDS.has(id))) return [];
    return value;
}

function readLog(value) {
    if (!Array.isArray(value)) return [];
    const entries = [];
    const seen = new Set();
    for (const entry of value) {
        if (!readCard(entry) || !Number.isInteger(entry.slotIndex) || entry.slotIndex < 0
            || typeof entry.prevFingerprint !== 'string' || typeof entry.at !== 'string'
            || !Number.isFinite(Date.parse(entry.at)) || new Date(entry.at).toISOString() !== entry.at
            || !Number.isInteger(entry.replays) || entry.replays < 0 || entry.replays > 999
            || !(entry.generationId === null || typeof entry.generationId === 'string' || Number.isFinite(entry.generationId))
            || seen.has(entry.id)) continue;
        seen.add(entry.id);
        entries.push(entry);
        if (entries.length === 50) break;
    }
    return entries;
}

function state(metadata) {
    const value = metadata?.director?.fate;
    if (value?.version !== 1) return { version: 1, held: null, bound: null, offer: null, pity: 0, recent: [], log: [] };
    const bound = readCard(value.bound);
    return {
        version: 1, held: readCard(value.held), offer: readOffer(value.offer), pity: readPity(value.pity), recent: readRecent(value.recent),
        bound: bound && Number.isInteger(bound.slotIndex) && bound.slotIndex >= 0 && typeof bound.prevFingerprint === 'string' ? bound : null,
        log: readLog(value.log),
    };
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
 * Blind-card state and request lifecycle. Only view() and the completed log() may cross the UI boundary.
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
    const publicCard = card => card ? { id: card.id, title: card.title, strength: card.strength, rarity: cardRarity(card) } : null;
    const publicReveal = card => ({ ...publicCard(card), slotIndex: card.slotIndex });
    const publicEntry = entry => ({ ...publicReveal(entry), category: cardCategoryId(entry), event: entry.event,
        prevFingerprint: entry.prevFingerprint, generationId: entry.generationId, at: entry.at, replays: entry.replays });
    const publicOffer = offer => offer ? {
        id: offer.id, cards: offer.cards.map(card => ({ category: card.category, title: card.title, rarity: card.rarity })),
    } : null;
    const view = () => {
        const context = getContext();
        const value = state(context.chatMetadata);
        const visibleBusy = busy && current(busy.snapshot);
        const reveal = value.bound && anchorMatches(context, value.bound) && isAi(context.chat[value.bound.slotIndex])
            ? { ...publicReveal(value.bound), event: value.bound.event } : null;
        return { held: publicCard(value.held), bound: publicCard(value.bound), reveal, offer: publicOffer(value.offer),
            busy: Boolean(visibleBusy), phase: visibleBusy ? busy.phase : 'idle', logCount: value.log.length };
    };
    const log = slotIndex => {
        const context = getContext();
        const chat = context.chat ?? [];
        const entries = state(context.chatMetadata).log.filter(entry => slotIndex === undefined || entry.slotIndex === slotIndex);
        let slot;
        return entries.map(entry => {
            // Marks can request one slot before a full cache exists. Inspect its
            // chat rows once even if several completed entries share that slot.
            if (!slot || slotIndex === undefined) {
                const missing = entry.slotIndex >= chat.length;
                const ai = !missing && isAi(chat[entry.slotIndex]);
                slot = { missing, ai, prevFingerprint: ai ? messageFingerprint(chat[entry.slotIndex - 1]) : null };
            }
            return { ...publicEntry(entry), status: slot.missing ? 'missing'
                : slot.ai && slot.prevFingerprint === entry.prevFingerprint ? 'ok' : 'changed' };
        });
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

    function quietPrompt(category, rarity, strength) {
        const lines = [
            'Invent one unexpected event for the current story. Adapt to its genre, setting, tone and characters.',
            `Category: ${category.theme}. Strength: ${STRENGTHS[strength]}.`,
        ];
        const rarityLine = RARITIES[rarity]?.line;
        if (rarityLine) lines.push(rarityLine);
        lines.push(
            'Keep character agency and existing story facts. Use the story language. Describe a concrete event, not instructions to the assistant.',
            'Return only JSON with exactly one property: {"event":"the private event"}. Be concise; use at most 400 Unicode codepoints.',
        );
        return lines.join('\n');
    }

    async function drawWith(snapshot, operation, chosen, strength) {
        const category = categoryById.get(chosen.category);
        const raw = await snapshot.context.generateQuietPrompt({ responseLength: 1024, quietPrompt: quietPrompt(category, chosen.rarity, strength) });
        if (!current(snapshot) || operation.cancelled) return false;
        const event = parseEvent(raw);
        const held = { id: uuid(), title: chosen.title, strength, event, category: category.id, rarity: chosen.rarity };
        // A failed save rolls back, so a rejected event cannot replace the held card or the offer.
        return await commit(snapshot, { ...state(snapshot.metadata), held, offer: null });
    }

    function finishDrawing(operation, snapshot) {
        if (busy === operation) { busy = null; if (current(snapshot)) notify(); }
    }

    async function deal() {
        checkAvailable();
        nonce++;
        const context = getContext();
        const snapshot = capture(context);
        const operation = busy = { snapshot, phase: 'drawing' };
        notify();
        try {
            const value = state(snapshot.metadata);
            const offer = { id: uuid(), cards: rollOffer(random, { recent: value.recent, pity: value.pity }) };
            return await commit(snapshot, { ...value, offer });
        } catch (error) {
            if (!current(snapshot)) return false;
            throw error;
        } finally {
            finishDrawing(operation, snapshot);
        }
    }

    async function pick(index, strength = 'medium') {
        checkAvailable();
        if (!Object.hasOwn(STRENGTHS, strength)) throw new Error('请选择有效的命运强度。');
        const context = getContext();
        const offer = state(context.chatMetadata).offer;
        if (!offer || !Number.isInteger(index) || index < 0 || index > 2) throw new Error('请选择三张牌中的一张。');
        nonce++;
        const snapshot = capture(context);
        const operation = busy = { snapshot, phase: 'drawing' };
        notify();
        try {
            return await drawWith(snapshot, operation, offer.cards[index], strength);
        } catch {
            if (!current(snapshot) || operation.cancelled) return false;
            throw new Error('命运卡抽取失败，请重试。');
        } finally {
            finishDrawing(operation, snapshot);
        }
    }

    // Internal/test-only compat path. Stays one quiet call and one commit. Persisting
    // deal() first would add a save and would not yet have held.event, which existing callers assert.
    async function draw(strength = 'medium') {
        checkAvailable();
        if (!Object.hasOwn(STRENGTHS, strength)) throw new Error('请选择有效的命运强度。');
        nonce++;
        const context = getContext();
        const snapshot = capture(context);
        const operation = busy = { snapshot, phase: 'drawing' };
        const value = state(snapshot.metadata);
        const cards = rollOffer(random, { recent: value.recent, pity: value.pity });
        const index = Math.min(cards.length - 1, Math.max(0, Math.floor(random() * cards.length)));
        notify();
        try {
            return await drawWith(snapshot, operation, cards[index], strength);
        } catch {
            if (!current(snapshot) || operation.cancelled) return false;
            throw new Error('命运卡抽取失败，请重试。');
        } finally {
            finishDrawing(operation, snapshot);
        }
    }

    async function discard() {
        checkAvailable();
        const context = getContext();
        if (!state(context.chatMetadata).held) return false;
        nonce++;
        return commit(capture(context), { ...state(context.chatMetadata), held: null });
    }

    async function clearLog() {
        const context = getContext();
        return commit(capture(context), { ...state(context.chatMetadata), log: [] });
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
        const attempt = armed = { snapshot, card, claimed: false, consumed: false, stopped: false };
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
        // Stop during pre-interceptor setup aborts the normal Generate before a provider request.
        if (type === 'normal' && armed && armed.stopped) return 'abort';
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
        const next = { ...value, held: record.attempt ? null : value.held, bound };
        if (record.attempt) {
            const rarity = cardRarity(record.card);
            const categoryId = cardCategoryId(record.card);
            if (categoryId) bound.category = categoryId;
            bound.rarity = rarity;
            next.pity = rarity === 'common' ? Math.min(99, value.pity + 1) : 0;
            next.recent = categoryId ? [categoryId, ...value.recent].slice(0, 2) : value.recent.slice(0, 2);
            next.log = [publicEntry({ ...bound, at: new Date().toISOString(), replays: 0 }),
                ...value.log.filter(entry => entry.id !== bound.id)].slice(0, 50);
        } else {
            next.log = value.log.map(entry => entry.id === bound.id
                ? { ...entry, generationId: bound.generationId, prevFingerprint: bound.prevFingerprint,
                    replays: Math.min(999, entry.replays + 1) } : entry);
        }
        try {
            const saving = commit(record.snapshot, next, false);
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
            if (armed && current(armed.snapshot)) {
                // Not claimed yet: Generate has no abortController for this call. The interceptor must abort it.
                if (!armed.claimed) armed.stopped = true;
                armed.claimed = true;
            }
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
    return { view, log, clearLog, draw, deal, pick, discard, apply, prepare };
}
