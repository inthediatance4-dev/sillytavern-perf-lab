import { createHostEventBridge } from './host-events.js';
import { buildIsolatedRequest, createIsolatedGenerator, createOwnedChatSaver } from './requests.js';
import { ensureLiteralStart, hideLiteralStart } from './literal-start.js';
import { createPromptShield } from './prompt-shield.js';

const REGISTRY = Symbol.for('sillytavern.independent-director-affinity.runtime.v1');

export function installedExtensionId(url) {
    const pathname = decodeURIComponent(new URL(url).pathname);
    const prefix = '/scripts/extensions/';
    if (!pathname.includes(prefix) || !pathname.endsWith('/index.js')) throw new Error('Unsupported plugin installation path.');
    const id = pathname.slice(pathname.indexOf(prefix) + prefix.length, -'/index.js'.length);
    if (!id || id.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsupported plugin installation path.');
    return id;
}

/** Exported separately so native host surfaces can be exercised without a DOM loader. */
export function createRuntimeFromHost(url, kind, host, target = globalThis) {
    const id = installedExtensionId(url);
    const claims = new WeakSet();
    const { core, extensions, groups, tokenizers, textgen, utils, kobold, novel, horde } = host;
    const nativeContext = extensions.getContext;
    const registry = target[REGISTRY] ??= new WeakMap();
    const nativeEvents = nativeContext().eventSource;
    let shared = registry.get(nativeEvents);
    const enrich = () => ({ ...nativeContext(), maxContext: core.getMaxContextTokens(),
        koboldSettings: kobold?.kai_settings, novelSettings: novel?.nai_settings, hordeSettings: horde?.horde_settings });
    if (!shared) {
        const bridge = createHostEventBridge(nativeContext, core, groups, { uuid: utils.uuidv4, fetchTarget: target, document: target.document });
        const isolated = createIsolatedGenerator(enrich, { core, fetch: (...args) => target.fetch(...args) });
        // Fate drawing needs the current story. Only explicitly isolated evidence
        // evaluation bypasses the native quiet prompt builder and lifecycle.
        const quiet = options => options?.isolated ? isolated(options) : nativeContext().generateQuietPrompt(options);
        const official = !nativeContext().eventTypes.GENERATION_COMPLETED;
        const saver = !official && typeof core.saveChatConditional === 'function'
            ? options => core.saveChatConditional(options)
            : createOwnedChatSaver(enrich, { fetch: (...args) => target.fetch(...args), isSaving: () => core.isChatSaving });
        const shield = createPromptShield({ uuid: utils.uuidv4, count: text => nativeContext().getTokenCountAsync(text, 0) });
        const restore = data => shield.restore(data);
        bridge.eventSource.on(bridge.eventTypes.GENERATE_AFTER_DATA, restore);
        bridge.eventSource.makeFirst(bridge.eventTypes.GENERATE_AFTER_DATA, restore);
        shared = { bridge, isolated, quiet, saver, official, shield, directorRegistered: false };
        registry.set(nativeEvents, shared);
    }
    const getContext = () => {
        const current = enrich();
        const settings = current.extensionSettings ?? extensions.extension_settings;
        const disabled = settings.disabledExtensions ?? [];
        const normalized = disabled.filter(name => name !== kind);
        if (disabled.includes(id)) normalized.push(kind);
        return { ...current, extensionSettings: { ...settings, disabledExtensions: normalized },
            eventSource: shared.bridge.eventSource, eventTypes: shared.bridge.eventTypes,
            generateQuietPrompt: shared.quiet, generateRaw: shared.isolated,
            saveChat: shared.saver, saveMetadata: shared.saver,
            saveMetadataDebounced: () => { shared.saver().catch(() => console.warn('Plugin metadata save failed.')); },
            generate: shared.bridge.runGenerate };
    };
    async function ensureStart(inserting = false) {
        if (!shared.official) return false;
        const context = getContext();
        const changed = ensureLiteralStart(context, { inserting });
        if (changed && context.chat.length > 1) {
            // Refresh physical message IDs after migrating an existing first narrative.
            await core.printMessages?.();
        }
        hideLiteralStart(getContext(), target.document);
        if (changed) await shared.saver();
        return changed;
    }
    if (kind === 'director' && shared.official && !shared.directorRegistered) {
        shared.directorRegistered = true;
        const source = shared.bridge.eventSource;
        const types = shared.bridge.eventTypes;
        // Install before Director's snapshots: migration cannot invalidate a live attempt.
        source.on(types.GENERATION_STARTED, async (_type, _params, dry) => { if (!dry) await ensureStart(); });
        for (const name of ['CHAT_CHANGED', 'MORE_MESSAGES_LOADED', 'MESSAGE_DELETED']) {
            if (types[name]) source.on(types[name], () => ensureStart());
        }
    }
    return { extensionId: id, getContext, ensureStart,
        interceptorKey: id === kind ? (kind === 'director' ? 'director_rebind_interceptor' : 'affinity_memory_interceptor')
            : (kind === 'director' ? 'standalone_director_cards_interceptor' : 'standalone_affinity_memory_interceptor'),
        claim(request) { if (claims.has(request)) return false; claims.add(request); return true; },
        prepare: shared.bridge.prepare,
        seal: request => shared.official ? shared.shield.seal(request) : Promise.resolve(),
        async countPromptTokens(prompt, schema) {
            const current = getContext();
            const request = buildIsolatedRequest(() => current, { quietPrompt: prompt });
            const tokens = request.messages ? await tokenizers.countTokensOpenAIAsync(request.messages, true)
                : await current.getTokenCountAsync(request.prompt, 0);
            const schemaTokens = current.mainApi === 'openai' && schema
                ? await current.getTokenCountAsync(JSON.stringify(schema.value ?? schema), 0) : 0;
            return tokens + schemaTokens + 64;
        },
        requestIdentity: () => JSON.stringify([core.getGeneratingApi(), core.getGeneratingModel(),
            nativeContext().mainApi === 'textgenerationwebui' ? textgen.getTextGenModel() : null]),
    };
}

export async function createPluginRuntime(url, kind) {
    const [core, extensions, groups, tokenizers, textgen, utils, kobold, novel, horde] = await Promise.all([
        import('/script.js'), import('/scripts/extensions.js'), import('/scripts/group-chats.js'),
        import('/scripts/tokenizers.js'), import('/scripts/textgen-settings.js'), import('/scripts/utils.js'),
        import('/scripts/kai-settings.js'), import('/scripts/nai-settings.js'), import('/scripts/horde.js'),
    ]);
    return createRuntimeFromHost(url, kind, { core, extensions, groups, tokenizers, textgen, utils, kobold, novel, horde });
}
