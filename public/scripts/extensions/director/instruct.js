import { containsExpandableMacro } from './template.js';

/**
 * Whether the assembled request contains an injection's literal text.
 * Chat completion prompts may contain multimodal content arrays.
 * @param {any} prompt Assembled prompt
 * @param {string} text Injection text
 * @returns {boolean} Whether the text is present
 */
function includesInstruction(prompt, text) {
    if (typeof prompt === 'string') return prompt.includes(text);
    if (prompt && typeof prompt === 'object') return Object.values(prompt).some(value => includesInstruction(value, text));
    return false;
}

/** Types that may copy a bound instruction back into the prompt. */
const REINJECT_TYPES = ['swipe', 'regenerate', 'continue'];
/** Types that produce the AI chat message a consumed instruction binds to. */
const BIND_TYPES = ['normal', 'swipe', 'regenerate', 'continue'];
/** In-memory prompt key. Not stored in script_injects, so M6 does not consume it. */
export const BOUND_INSTRUCT_PROMPT_KEY = 'script_inject_director-bound';
/** extension_prompt_types.IN_CHAT. Kept local so node tests do not load the app. */
const IN_CHAT = 1;
/** extension_prompt_roles.SYSTEM. */
const SYSTEM_ROLE = 0;
export const INSTRUCT_PREVIEW_LENGTH = 16;

/**
 * Stable FNV-1a of a string. send_date is intentionally not part of the input.
 * @param {string} text
 * @returns {string}
 */
function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Fingerprint of the message before a bound slot. Missing messages hash the same empty value.
 * @param {object} [message]
 * @returns {string}
 */
export function messageFingerprint(message) {
    const isUser = message && Object.prototype.hasOwnProperty.call(message, 'is_user') ? message.is_user : null;
    const name = message && Object.prototype.hasOwnProperty.call(message, 'name') ? message.name : null;
    const mes = message && Object.prototype.hasOwnProperty.call(message, 'mes') ? message.mes : null;
    return fnv1a(JSON.stringify([isUser, name, mes]));
}

/**
 * @param {object} metadata Chat metadata
 * @returns {[string, object][]}
 */
export function listPendingInstructs(metadata) {
    return Object.entries(metadata?.script_injects ?? {}).filter(([, inject]) => inject?.directorEphemeral === true && typeof inject.value === 'string');
}

/**
 * @param {object} metadata Chat metadata
 * @returns {object|null}
 */
export function readBoundInstruct(metadata) {
    const bound = metadata?.director?.boundInstruct;
    if (!bound || typeof bound !== 'object' || Array.isArray(bound)) return null;
    if (typeof bound.text !== 'string' || !Number.isInteger(bound.slotIndex) || typeof bound.prevFingerprint !== 'string') return null;
    return bound;
}

/**
 * @param {object[]} chat Chat at completion time, after the AI message exists
 * @param {{id: string, value: string}} consumed Last consumed pending inject
 * @returns {object|null}
 */
export function createBoundInstruct(chat, consumed) {
    if (!Array.isArray(chat) || chat.length === 0 || !consumed || typeof consumed.value !== 'string') return null;
    const slotIndex = chat.length - 1;
    return {
        id: consumed.id,
        text: consumed.value,
        slotIndex,
        prevFingerprint: messageFingerprint(chat[slotIndex - 1]),
        boundAt: Date.now(),
    };
}

/**
 * @param {object} metadata Chat metadata
 * @returns {boolean} Whether a binding was removed
 */
export function removeBoundInstruct(metadata) {
    if (!readBoundInstruct(metadata)) return false;
    delete metadata.director.boundInstruct;
    if (metadata.director && Object.keys(metadata.director).length === 0) delete metadata.director;
    return true;
}

/** @param {object} metadata */
export function applyUserSentClear(metadata) {
    return removeBoundInstruct(metadata);
}

/**
 * A committed message after the bound slot ends the binding.
 * The received id equals the slot for swipe, continue, and regenerate.
 * @param {object} metadata
 * @param {number} messageId
 * @returns {boolean}
 */
export function applyCommittedMessageClear(metadata, messageId) {
    const binding = readBoundInstruct(metadata);
    if (!binding || !Number.isInteger(messageId) || messageId <= binding.slotIndex) return false;
    return removeBoundInstruct(metadata);
}

/**
 * Regenerate deletes the bound AI message before the interceptor, so that
 * temporary length === slotIndex must not clear. Deleting the message itself
 * outside regenerate does. Upstream also clears when length <= slotIndex - 1
 * or the previous message no longer matches.
 * @param {object[]} chat
 * @param {object|null} binding
 * @param {boolean} duringRegenerate
 * @returns {boolean}
 */
export function shouldDropBoundOnDelete(chat, binding, duringRegenerate) {
    if (!binding || !Array.isArray(chat)) return false;
    const slot = binding.slotIndex;
    if (chat.length <= slot - 1) return true;
    if (messageFingerprint(chat[slot - 1]) !== binding.prevFingerprint) return true;
    if (!duringRegenerate && chat.length <= slot) return true;
    return false;
}

/**
 * @param {object} metadata
 * @param {object[]} chat
 * @param {boolean} duringRegenerate
 * @returns {boolean}
 */
export function applyDeletionClear(metadata, chat, duringRegenerate) {
    if (!shouldDropBoundOnDelete(chat, readBoundInstruct(metadata), duringRegenerate)) return false;
    return removeBoundInstruct(metadata);
}

/**
 * True only for the delete Generate('regenerate') performs before the interceptor.
 * That delete leaves chat.length === slotIndex. A later delete of the same message
 * has no skip, or a different chat, and must still clear.
 * @param {{chatId: string, metadata: object, slotIndex: number}|null} skip
 * @param {object} context
 * @returns {boolean}
 */
export function matchesRegenerateDelete(skip, context) {
    if (!skip || !context) return false;
    if (skip.chatId !== context.chatId || skip.metadata !== context.chatMetadata) return false;
    const binding = readBoundInstruct(context.chatMetadata);
    if (!binding || binding.slotIndex !== skip.slotIndex) return false;
    return Array.isArray(context.chat) && context.chat.length === binding.slotIndex;
}

/**
 * @param {string} type
 * @param {object[]} chat
 * @param {number} slotIndex
 * @returns {boolean}
 */
function positionMatches(type, chat, slotIndex) {
    if (!Array.isArray(chat) || !Number.isInteger(slotIndex)) return false;
    // Generate('regenerate') removes the last AI message before the interceptor.
    if (type === 'regenerate') return chat.length === slotIndex;
    if (type === 'swipe' || type === 'continue') return chat.length - 1 === slotIndex;
    return false;
}

/**
 * @param {{type: string, chat: object[], binding: object, hasPending: boolean}} state
 * @returns {boolean}
 */
export function shouldReinject({ type, chat, binding, hasPending }) {
    if (hasPending || !binding || typeof binding.text !== 'string') return false;
    if (!REINJECT_TYPES.includes(type)) return false;
    if (!positionMatches(type, chat, binding.slotIndex)) return false;
    return messageFingerprint(chat[binding.slotIndex - 1]) === binding.prevFingerprint;
}

/**
 * Fingerprint drift at reinject time drops the binding and does not inject.
 * A pending instruction suppresses reinject and does not clear the binding.
 * @param {{type: string, chat: object[], binding: object, hasPending: boolean}} state
 * @returns {boolean}
 */
export function shouldClearBoundForFingerprint({ type, chat, binding, hasPending }) {
    if (hasPending || !binding) return false;
    if (!REINJECT_TYPES.includes(type)) return false;
    if (!positionMatches(type, chat, binding.slotIndex)) return false;
    return messageFingerprint(chat[binding.slotIndex - 1]) !== binding.prevFingerprint;
}

/**
 * @param {object} context Extension context
 */
export function clearTemporaryInstruct(context) {
    const prompts = context?.extensionPrompts;
    if (prompts && Object.prototype.hasOwnProperty.call(prompts, BOUND_INSTRUCT_PROMPT_KEY)) {
        delete prompts[BOUND_INSTRUCT_PROMPT_KEY];
    }
}

/** Per-chat token → literal, so prompt assembly never sees the user's macros. */
const promptShields = new WeakMap();

/**
 * @param {object} metadata
 * @returns {Map<string, string>}
 */
function shieldsFor(metadata) {
    let shields = promptShields.get(metadata);
    if (!shields) {
        shields = new Map();
        promptShields.set(metadata, shields);
    }
    return shields;
}

/**
 * @param {Map<string, string>} shields
 * @param {string} literal
 * @returns {string}
 */
function tokenFor(shields, literal) {
    for (const [token, value] of shields) {
        if (value === literal) return token;
    }
    let token = '';
    const collides = () => {
        if (!token || literal.includes(token)) return true;
        for (const [existing, value] of shields) {
            if (existing.includes(token) || token.includes(existing) || value.includes(token)) return true;
        }
        return false;
    };
    do {
        token = `directorliteral${shields.size}x${Math.random().toString(16).slice(2)}`;
    } while (collides());
    shields.set(token, literal);
    return token;
}

/**
 * getExtensionPrompt always runs substituteParams. Director text that still
 * contains macros is swapped for a macro-free token until the request exists.
 * script_injects and boundInstruct keep the literal; macro-free text is untouched.
 * @param {object} context
 */
export function shieldDirectorPromptValues(context) {
    const metadata = context?.chatMetadata;
    const prompts = context?.extensionPrompts;
    if (!metadata || !prompts) return;
    /** @type {[object, string][]} */
    const replacements = [];
    for (const [id, inject] of listPendingInstructs(metadata)) {
        const prompt = prompts[`script_inject_${id}`];
        if (!prompt || !containsExpandableMacro(inject.value)) continue;
        replacements.push([prompt, inject.value]);
    }
    const binding = readBoundInstruct(metadata);
    const bound = prompts[BOUND_INSTRUCT_PROMPT_KEY];
    if (bound && binding && containsExpandableMacro(binding.text)) {
        replacements.push([bound, binding.text]);
    }
    // Macro-free instructions stay on the upstream prompt object untouched.
    if (!replacements.length) return;
    const shields = shieldsFor(metadata);
    for (const [prompt, literal] of replacements) {
        prompt.value = tokenFor(shields, literal);
    }
}

/**
 * @param {Map<string, string>} shields
 * @param {any} value
 * @param {WeakSet<object>} seen
 * @returns {any}
 */
function unshieldValue(shields, value, seen) {
    if (typeof value === 'string') {
        const entries = [...shields.entries()].sort((left, right) => right[0].length - left[0].length);
        let result = value;
        for (const [token, literal] of entries) {
            if (result.includes(token)) result = result.split(token).join(literal);
        }
        return result;
    }
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return value;
    seen.add(value);
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) value[index] = unshieldValue(shields, value[index], seen);
        return value;
    }
    for (const key of Object.keys(value)) value[key] = unshieldValue(shields, value[key], seen);
    return value;
}

/**
 * Put shielded literals back into the assembled request before it is sent.
 * @param {object} metadata
 * @param {object} data Generate data
 */
export function unshieldGenerateData(metadata, data) {
    if (!metadata || !data) return;
    const shields = promptShields.get(metadata);
    if (!shields || shields.size === 0) return;
    const seen = new WeakSet();
    if (Object.prototype.hasOwnProperty.call(data, 'prompt')) data.prompt = unshieldValue(shields, data.prompt, seen);
    if (Object.prototype.hasOwnProperty.call(data, 'input')) data.input = unshieldValue(shields, data.input, seen);
}

/**
 * Restore extension prompt values so later reads see the literal again.
 * Tokens stay in the shield map for this page session. A quiet generation can
 * reach this handler while another generation has already copied a token into
 * its request, and clearing the map here would send that token.
 * @param {object} context
 */
export function restoreShieldedPromptValues(context) {
    const metadata = context?.chatMetadata;
    const prompts = context?.extensionPrompts;
    const shields = metadata ? promptShields.get(metadata) : null;
    if (!prompts || !shields) return;
    for (const [id, inject] of listPendingInstructs(metadata)) {
        const prompt = prompts[`script_inject_${id}`];
        if (prompt && typeof inject.value === 'string') prompt.value = inject.value;
    }
    const binding = readBoundInstruct(metadata);
    const bound = prompts[BOUND_INSTRUCT_PROMPT_KEY];
    if (bound && binding) bound.value = binding.text;
}

/** Prompt keys hidden for one quiet or impersonate generation. */
let directorPromptMask = null;

/**
 * @param {object} [context]
 * @returns {boolean}
 */
export function directorPromptsAreMasked(context) {
    const mask = directorPromptMask;
    if (!mask) return false;
    if (!context) return true;
    return context.chatMetadata === mask.metadata && context.chatId === mask.chatId;
}

/**
 * Drop a mask without writing prompts back. Chat switch rebuilds script_inject_*
 * from the new chat before Director's CHAT_CHANGED listener runs.
 */
export function discardDirectorPromptMask() {
    directorPromptMask = null;
}

/**
 * Hide pending director prompts and the bound copy so this generation cannot
 * include them. script_injects and boundInstruct stay. The saved prompt value
 * may already be a shield token; restore reads the literal from metadata.
 * @param {object} context
 */
export function maskDirectorPrompts(context) {
    const prompts = context?.extensionPrompts;
    const metadata = context?.chatMetadata;
    /** @type {string[]} */
    const keys = [];
    if (prompts && metadata) {
        for (const [id] of listPendingInstructs(metadata)) {
            const key = `script_inject_${id}`;
            if (Object.prototype.hasOwnProperty.call(prompts, key)) {
                keys.push(key);
                delete prompts[key];
            }
        }
        if (Object.prototype.hasOwnProperty.call(prompts, BOUND_INSTRUCT_PROMPT_KEY)) {
            keys.push(BOUND_INSTRUCT_PROMPT_KEY);
            delete prompts[BOUND_INSTRUCT_PROMPT_KEY];
        }
    }
    directorPromptMask = { metadata, chatId: context?.chatId, keys };
}

/**
 * Put masked prompts back. Values come from script_injects and boundInstruct,
 * not from the object removed at mask time. A different chat discards the mask.
 * @param {object} context
 * @returns {boolean} Whether prompts were written back
 */
export function restoreDirectorPrompts(context) {
    const mask = directorPromptMask;
    if (!mask) return false;
    directorPromptMask = null;
    if (!context || context.chatMetadata !== mask.metadata || context.chatId !== mask.chatId) return false;
    if (typeof context.setExtensionPrompt !== 'function') return false;
    const metadata = context.chatMetadata;
    for (const key of mask.keys) {
        if (key === BOUND_INSTRUCT_PROMPT_KEY) {
            const binding = readBoundInstruct(metadata);
            if (!binding) continue;
            context.setExtensionPrompt(key, binding.text, IN_CHAT, 0, false, SYSTEM_ROLE);
            continue;
        }
        if (!key.startsWith('script_inject_')) continue;
        const id = key.slice('script_inject_'.length);
        const inject = metadata?.script_injects?.[id];
        if (!inject || inject.directorEphemeral !== true || typeof inject.value !== 'string') continue;
        context.setExtensionPrompt(key, inject.value, inject.position, inject.depth, inject.scan, inject.role);
    }
    return true;
}

/**
 * Copy binding.text through the same in-chat system prompt /inject uses.
 * The copy is not written to script_injects.
 * @param {object} context
 * @param {string} type
 * @returns {{reinjected: boolean, cleared: boolean}}
 */
export function applyBoundReinject(context, type) {
    clearTemporaryInstruct(context);
    const metadata = context.chatMetadata;
    const binding = readBoundInstruct(metadata);
    const hasPending = listPendingInstructs(metadata).length > 0;
    const chat = context.chat;
    if (shouldClearBoundForFingerprint({ type, chat, binding, hasPending })) {
        removeBoundInstruct(metadata);
        return { reinjected: false, cleared: true };
    }
    if (shouldReinject({ type, chat, binding, hasPending })) {
        context.setExtensionPrompt(BOUND_INSTRUCT_PROMPT_KEY, binding.text, IN_CHAT, 0, false, SYSTEM_ROLE);
        return { reinjected: true, cleared: false };
    }
    return { reinjected: false, cleared: false };
}

/**
 * @param {object} context
 * @param {string} id
 * @returns {boolean}
 */
export function cancelPendingInstruct(context, id) {
    const injects = context.chatMetadata?.script_injects;
    const inject = injects?.[id];
    if (!inject || inject.directorEphemeral !== true) return false;
    delete injects[id];
    context.setExtensionPrompt(`script_inject_${id}`, '', inject.position, inject.depth, inject.scan, inject.role);
    return true;
}

/**
 * Pending wins over bound so the chip shows the instruction that will be sent.
 * @param {object} metadata
 * @returns {{state: string, id: string, text: string}|null}
 */
export function activeInstruct(metadata) {
    const pending = listPendingInstructs(metadata);
    if (pending.length) {
        const [id, inject] = pending[pending.length - 1];
        return { state: 'pending', id, text: inject.value };
    }
    const bound = readBoundInstruct(metadata);
    if (!bound) return null;
    return { state: 'bound', id: bound.id, text: bound.text };
}

/**
 * First 16 Unicode code points. The ellipsis is present only when the text is longer.
 * @param {string} text
 * @returns {string}
 */
export function instructPreview(text) {
    const chars = Array.from(String(text ?? ''));
    if (chars.length <= INSTRUCT_PREVIEW_LENGTH) return chars.join('');
    return chars.slice(0, INSTRUCT_PREVIEW_LENGTH).join('') + '…';
}

/**
 * @param {string} state
 * @param {string} text
 * @returns {string}
 */
export function instructStatusText(state, text) {
    const status = state === 'pending' ? '待生效' : '重生沿用';
    return `🎭 ${status}：${instructPreview(text)}`;
}

/**
 * @param {string} state
 * @param {string} text
 * @returns {string}
 */
export function instructChipLabel(state, text) {
    return `${instructStatusText(state, text)} ✕`;
}

/**
 * Consume only Director-owned instructions included in a completed request.
 * Upstream /inject ephemeral=true keeps its existing end/stop lifecycle.
 * A consumed instruction becomes chat_metadata.director.boundInstruct when the
 * generation type produces an AI chat message. Quiet and impersonate never
 * consume: the interceptor removes their prompts, and this handler ignores
 * those types even if the text was still in the request.
 * @param {() => object} getContext Current extension context
 * @param {() => void} [onChange] Called after a consumption save
 */
export function initInstructLifecycle(getContext, onChange = () => {}) {
    const requests = new WeakMap();
    const { eventSource, eventTypes } = getContext();
    eventSource.on(eventTypes.GENERATE_AFTER_DATA, (data, dryRun) => {
        const context = getContext();
        // Tokens stand in for user macros while getExtensionPrompt runs. Put the
        // literal back before the inclusion check, including on dry runs.
        unshieldGenerateData(context.chatMetadata, data);
        restoreShieldedPromptValues(context);
        if (dryRun || directorPromptsAreMasked(context)) return;
        const injects = Object.entries(context.chatMetadata.script_injects ?? {}).filter(([, inject]) =>
            inject.directorEphemeral === true && includesInstruction(data.prompt ?? data.input, inject.value));
        if (injects.length) requests.set(data, { metadata: context.chatMetadata, chatId: context.chatId, injects });
    });
    eventSource.on(eventTypes.GENERATION_COMPLETED, async ({ data, chatMetadata, chatId, type }) => {
        const request = requests.get(data);
        requests.delete(data);
        // Quiet and impersonate do not bind and must not delete the pending inject.
        if (type === 'quiet' || type === 'impersonate') return;
        const context = getContext();
        if (!request || request.metadata !== chatMetadata || request.chatId !== chatId
            || context.chatMetadata !== chatMetadata || context.chatId !== chatId) return;
        let changed = false;
        let consumed = null;
        for (const [id, inject] of request.injects) {
            if (chatMetadata.script_injects?.[id] !== inject || !includesInstruction(data.prompt ?? data.input, inject.value)) continue;
            delete chatMetadata.script_injects[id];
            context.setExtensionPrompt(`script_inject_${id}`, '', inject.position, inject.depth, inject.scan, inject.role);
            changed = true;
            consumed = { id, value: inject.value };
        }
        if (changed && consumed && BIND_TYPES.includes(type)) {
            const bound = createBoundInstruct(context.chat, consumed);
            if (bound) {
                if (!chatMetadata.director || typeof chatMetadata.director !== 'object' || Array.isArray(chatMetadata.director)) {
                    chatMetadata.director = {};
                }
                chatMetadata.director.boundInstruct = bound;
            }
        }
        // Persist consumption before auto-continue can assemble another request.
        if (changed) {
            await context.saveMetadata();
            try {
                onChange();
            } catch (error) {
                console.error('Director instruct refresh failed', error);
            }
        }
    });
}
