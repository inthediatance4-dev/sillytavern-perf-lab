// Deliberately bypass native prompt builders: they expand macros, include chat
// state, emit generation hooks, and (on official 1.19) alter global length state.
const CHAT_MODELS = Object.freeze({
    openai: 'openai_model', claude: 'claude_model', openrouter: 'openrouter_model', ai21: 'ai21_model',
    makersuite: 'google_model', vertexai: 'vertexai_model', mistralai: 'mistralai_model', custom: 'custom_model',
    cohere: 'cohere_model', perplexity: 'perplexity_model', groq: 'groq_model', electronhub: 'electronhub_model',
    chutes: 'chutes_model', nanogpt: 'nanogpt_model', deepseek: 'deepseek_model', aimlapi: 'aimlapi_model',
    xai: 'xai_model', pollinations: 'pollinations_model', moonshot: 'moonshot_model', fireworks: 'fireworks_model',
    cometapi: 'cometapi_model', azure_openai: 'azure_openai_model', zai: 'zai_model', siliconflow: 'siliconflow_model',
    workers_ai: 'workers_ai_model', minimax: 'minimax_model',
});
const TEXT_TYPES = new Set(['ooba', 'mancer', 'vllm', 'aphrodite', 'tabby', 'koboldcpp', 'togetherai',
    'llamacpp', 'ollama', 'infermaticai', 'dreamgen', 'openrouter', 'featherless', 'huggingface', 'generic']);
const CHAT_ROUTING = Object.freeze({
    custom: ['custom_url'], azure_openai: ['azure_base_url', 'azure_deployment_name', 'azure_api_version'],
    vertexai: ['vertexai_auth_mode', 'vertexai_region', 'vertexai_express_project_id'],
    workers_ai: ['workers_ai_account_id'], nanogpt: ['nanogpt_provider', 'nanogpt_payg_override'],
    zai: ['zai_endpoint'], pollinations: ['pollinations_endpoint'], siliconflow: ['siliconflow_endpoint'],
    minimax: ['minimax_endpoint'],
});
const PROXY_SOURCES = new Set(['openai', 'claude', 'makersuite', 'vertexai', 'mistralai', 'deepseek']);
const KOBOLD_SAMPLERS = ['rep_pen', 'rep_pen_range', 'rep_pen_slope', 'tfs', 'top_a', 'top_k', 'top_p', 'typical'];
const NOVEL_SAMPLERS = ['temperature', 'repetition_penalty', 'repetition_penalty_range', 'repetition_penalty_slope',
    'repetition_penalty_frequency', 'repetition_penalty_presence', 'tail_free_sampling', 'top_k', 'top_p', 'top_a',
    'typical_p', 'min_p', 'math1_temp', 'math1_quad', 'math1_quad_entropy_scale', 'mirostat_lr', 'mirostat_tau'];

function copyScalars(target, source, keys) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) target[key] = value;
    }
}

function outputLimit(options) {
    const value = Number(options.maxOutputTokens ?? options.responseLength ?? 1024);
    return Number.isFinite(value) ? Math.max(1, Math.min(2048, Math.floor(value))) : 1024;
}

function legacyKobold(context, prompt, limit, isHorde) {
    const settings = context.koboldSettings ?? context.kai_settings ?? {};
    const payload = {
        prompt, gui_settings: false, max_length: limit,
        max_context_length: Math.max(limit + 1, Math.floor(Number(context.maxContext) || 4096)),
        temperature: Number.isFinite(settings.temp) ? settings.temp : 0.7,
        streaming: false, can_abort: !isHorde, use_world_info: false, singleline: false,
    };
    copyScalars(payload, settings, KOBOLD_SAMPLERS);
    if (Array.isArray(settings.sampler_order) && settings.sampler_order.every(Number.isInteger)) payload.sampler_order = [...settings.sampler_order];
    if (!isHorde) payload.api_server = typeof settings.api_server === 'string' ? settings.api_server : '';
    return payload;
}

/** A synchronous, detached snapshot of the exact evaluator input and routing. */
export function buildIsolatedRequest(getContext, options = {}) {
    const context = getContext();
    const prompt = options.quietPrompt ?? options.prompt;
    if (typeof prompt !== 'string') throw new Error('Invalid isolated evaluation prompt.');
    const limit = outputLimit(options);
    if (context.mainApi === 'openai') {
        const settings = context.chatCompletionSettings ?? {};
        const source = settings.chat_completion_source;
        if (!Object.hasOwn(CHAT_MODELS, source)) throw new Error('Unsupported isolated evaluation provider.');
        const selectedModel = settings[CHAT_MODELS[source]];
        const model = source === 'openrouter' && selectedModel === 'OR_Website' ? null : selectedModel;
        const messages = [{ role: 'user', content: prompt }];
        const payload = { messages, model, type: 'quiet', chat_completion_source: source, max_tokens: limit, stream: false,
            use_sysprompt: true, custom_prompt_post_processing: '', include_reasoning: false, enable_web_search: false };
        copyScalars(payload, settings, CHAT_ROUTING[source] ?? []);
        if (PROXY_SOURCES.has(source) && settings.reverse_proxy) copyScalars(payload, settings, ['reverse_proxy', 'proxy_password']);
        if (source === 'openrouter') {
            copyScalars(payload, settings, ['openrouter_use_fallback', 'openrouter_allow_fallbacks']);
            payload.use_fallback = payload.openrouter_use_fallback; delete payload.openrouter_use_fallback;
            payload.allow_fallbacks = payload.openrouter_allow_fallbacks; delete payload.openrouter_allow_fallbacks;
            for (const [from, to] of [['openrouter_providers', 'provider'], ['openrouter_quantizations', 'quantizations']]) {
                if (Array.isArray(settings[from]) && settings[from].every(x => typeof x === 'string')) payload[to] = [...settings[from]];
            }
        }
        if (options.jsonSchema) payload.json_schema = structuredClone(options.jsonSchema);
        if (['openai', 'azure_openai', 'openrouter'].includes(source) && /^(?:openai\/)?(?:o[134](?:-|$)|gpt-[56])/.test(model ?? '')) {
            payload.max_completion_tokens = limit; delete payload.max_tokens;
        }
        return { kind: 'chat', messages, payload };
    }
    if (context.mainApi === 'textgenerationwebui') {
        const settings = context.textCompletionSettings ?? {};
        const type = settings.type;
        if (!TEXT_TYPES.has(type)) throw new Error('Unsupported isolated evaluation provider.');
        const model = type === 'ooba' ? settings.custom_model : type === 'huggingface' ? 'tgi' : settings[`${type}_model`];
        const payload = { prompt, model, api_type: type,
            api_server: typeof context.getTextGenServer === 'function' ? context.getTextGenServer(type) : settings.server_urls?.[type] ?? '',
            max_tokens: limit, max_new_tokens: limit, stream: false };
        if (options.jsonSchema) {
            const schema = structuredClone(options.jsonSchema.value ?? options.jsonSchema);
            if (['tabby', 'llamacpp'].includes(type)) payload.json_schema = schema;
            if (['vllm', 'aphrodite'].includes(type)) payload.guided_json = schema;
        }
        return { kind: 'text', prompt, payload };
    }
    if (context.mainApi === 'kobold') return { kind: 'kobold', prompt, payload: legacyKobold(context, prompt, limit, false) };
    if (context.mainApi === 'novel') {
        const settings = context.novelSettings ?? context.nai_settings ?? {};
        const payload = { input: prompt, model: settings.model_novel, use_string: true, max_length: limit,
            min_length: 1, streaming: false, generate_until_sentence: false, use_cache: false, return_full_text: false,
            prefix: 'vanilla', order: [1, 5, 0, 2, 3, 4] };
        copyScalars(payload, settings, NOVEL_SAMPLERS);
        if (Array.isArray(settings.order) && settings.order.every(Number.isInteger)) payload.order = [...settings.order];
        // Clio/older models expose a fixed 150 token output ceiling in the native client.
        if (!/kayra|erato/.test(settings.model_novel ?? '')) payload.max_length = Math.min(150, limit);
        return { kind: 'novel', prompt, payload };
    }
    if (context.mainApi === 'koboldhorde') {
        const settings = context.hordeSettings ?? context.horde_settings ?? {};
        const params = legacyKobold(context, prompt, limit, true); delete params.prompt;
        Object.assign(params, { n: 1, frmtadsnsp: false, frmtrmblln: false, frmtrmspch: false, frmttriminc: false });
        const models = Array.isArray(settings.models) ? settings.models.filter(x => typeof x === 'string') : [];
        if (!models.length) throw new Error('Unsupported isolated evaluation provider.');
        return { kind: 'horde', prompt, payload: { prompt, params, models: [...models], trusted_workers: Boolean(settings.trusted_workers_only) } };
    }
    throw new Error('Unsupported isolated evaluation provider.');
}

function abortError() {
    const error = new Error('Isolated evaluation request aborted.'); error.name = 'AbortError'; return error;
}
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function wait(milliseconds, signal) {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener('abort', abort);
        const abort = () => { clearTimeout(timer); cleanup(); reject(abortError()); };
        const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
        signal?.addEventListener('abort', abort, { once: true });
    });
}

async function postJson(fetcher, url, payload, headers, signal) {
    checkAbort(signal);
    const response = await fetcher(url, { method: 'POST', headers, cache: 'no-cache', body: JSON.stringify(payload), signal });
    checkAbort(signal);
    if (!response.ok) throw new Error('Isolated evaluation request failed.');
    const data = await response.json();
    checkAbort(signal);
    if (data?.error) throw new Error('Isolated evaluation request failed.');
    return data;
}

async function generateHorde(request, fetcher, headers, signal) {
    const task = await postJson(fetcher, '/api/horde/generate-text', request.payload, headers, signal);
    if (typeof task.id !== 'string' || !task.id) throw new Error('Isolated evaluation request failed.');
    let completed = false;
    try {
        for (let attempt = 0; attempt < 480; attempt++) {
            const status = await postJson(fetcher, '/api/horde/task-status', { taskId: task.id }, headers, signal);
            if (status.faulted || status.is_possible === false) throw new Error('Isolated evaluation request failed.');
            if (status.done && typeof status.generations?.[0]?.text === 'string') { completed = true; return status.generations[0].text; }
            await wait(2500, signal);
        }
        throw new Error('Isolated evaluation request failed.');
    } finally {
        if (!completed) {
            // Cancellation has its own lifetime: the evaluator's signal is already aborted.
            void postJson(fetcher, '/api/horde/cancel-task', { taskId: task.id }, headers, undefined).catch(() => {});
        }
    }
}

/** Native sendRequest is pure transport; never use processRequest/preset builders. */
export function createIsolatedGenerator(getContext, dependencies = {}) {
    return async (options = {}) => {
        const signal = options.signal ?? new AbortController().signal;
        try {
            checkAbort(signal);
            const context = getContext();
            const request = buildIsolatedRequest(() => context, options);
            let response;
            if (request.kind === 'chat' || request.kind === 'text') {
                const service = request.kind === 'chat'
                    ? dependencies.chatCompletionService ?? context.ChatCompletionService ?? dependencies.core?.ChatCompletionService
                    : dependencies.textCompletionService ?? context.TextCompletionService ?? dependencies.core?.TextCompletionService;
                if (typeof service?.sendRequest !== 'function') throw new Error('Isolated evaluation transport unavailable.');
                response = await service.sendRequest(request.payload, true, signal);
                checkAbort(signal);
                response = response?.content;
            } else {
                const fetcher = dependencies.fetch ?? globalThis.fetch;
                const headers = { ...context.getRequestHeaders() };
                if (request.kind === 'horde') response = await generateHorde(request, fetcher, headers, signal);
                else {
                    const endpoint = request.kind === 'kobold' ? '/api/backends/kobold/generate' : '/api/novelai/generate';
                    const data = await postJson(fetcher, endpoint, request.payload, headers, signal);
                    response = request.kind === 'kobold' ? data.results?.[0]?.text : data.output;
                }
            }
            checkAbort(signal);
            if (typeof response === 'string') return response;
            if (response && typeof response === 'object') return JSON.stringify(response);
            throw new Error('Isolated evaluation request failed.');
        } catch (error) {
            if (signal.aborted || error?.name === 'AbortError') throw abortError();
            // Provider errors can contain prompts, headers, response bodies, or credentials.
            throw new Error('Isolated evaluation request failed.');
        }
    };
}

function captureOwner(context) {
    const group = context.groupId != null && context.groupId !== '';
    return { chatId: context.chatId, groupId: context.groupId, characterId: group ? undefined : context.characterId,
        chat: context.chat, chatMetadata: context.chatMetadata };
}
function owns(context, owner) {
    return owner.chatId != null && owner.chatId !== '' && context.chatId === owner.chatId
        && context.groupId === owner.groupId && (owner.groupId != null && owner.groupId !== '' || context.characterId === owner.characterId)
        && context.chat === owner.chat && context.chatMetadata === owner.chatMetadata;
}
function saveSnapshot(context) {
    if (!Array.isArray(context.chat) || !context.chat.length || !context.chatMetadata || typeof context.chatMetadata !== 'object') return null;
    const header = { chat_metadata: context.chatMetadata, user_name: 'unused', character_name: 'unused' };
    if (context.groupId != null && context.groupId !== '') {
        const group = context.groups?.find(x => String(x.id) === String(context.groupId));
        if (!group || group.chat_id !== context.chatId) return null;
        return { url: '/api/chats/group/save', payload: structuredClone({ id: context.chatId, chat: [header, ...context.chat], force: false }) };
    }
    const character = context.characters?.[context.characterId];
    if (!character || character.chat !== context.chatId || !character.avatar) return null;
    return { url: '/api/chats/save', payload: structuredClone({ ch_name: character.name, file_name: context.chatId,
        chat: [header, ...context.chat], avatar_url: character.avatar, force: false }) };
}

/** One saver is shared by both plugins through the host registry. */
export function createOwnedChatSaver(getContext, dependencies = {}) {
    let queue = Promise.resolve();
    return ({ shouldSave = () => true } = {}) => {
        const owner = captureOwner(getContext());
        const valid = () => shouldSave() && owns(getContext(), owner);
        const run = async () => {
            if (!valid()) return false;
            if (dependencies.waitForIdle) await dependencies.waitForIdle();
            const started = Date.now();
            while (dependencies.isSaving?.()) {
                if (!valid()) return false;
                if (Date.now() - started > 10000) throw new Error('Chat save failed.');
                await wait(10);
            }
            if (!valid()) return false;
            const context = getContext();
            // Snapshot only after native writes finish so the save includes their latest text.
            const snapshot = saveSnapshot(context);
            if (!snapshot || !valid()) return false;
            try {
                const fetcher = dependencies.fetch ?? globalThis.fetch;
                const response = await fetcher(snapshot.url, { method: 'POST', cache: 'no-cache',
                    headers: { ...context.getRequestHeaders() }, body: JSON.stringify(snapshot.payload) });
                if (!response.ok) throw new Error('Chat save failed.');
                if (valid() && dependencies.onSaved) await dependencies.onSaved(owner, snapshot.payload);
                return true;
            } catch {
                throw new Error('Chat save failed.');
            }
        };
        const result = queue.then(run);
        queue = result.catch(() => {});
        return result;
    };
}
