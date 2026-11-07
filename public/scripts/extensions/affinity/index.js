import { getMaxContextTokens, getMaxPromptTokens, isGenerating, getGeneratingApi, getGeneratingModel } from '../../../script.js';
import { extension_settings, getContext as nativeGetContext, renderExtensionTemplateAsync } from '../../extensions.js';
import { getTokenizerBestMatch } from '../../tokenizers.js';
import { getTextGenModel } from '../../textgen-settings.js';
import { uuidv4 } from '../../utils.js';
import { AFFINITY_SCHEMA, createAffinityController } from './affinity.js';
import { affinityOutputTokenLimit, fitAffinityPrompt, fitAffinityVerificationPrompts } from './affinity-prompt-budget.js';
import { createPluginRuntime } from '../../plugin-runtime/runtime.js';

let runtime;
const getContext = () => runtime ? runtime.getContext() : nativeGetContext();

let affinityDiagnostics = { total: 0, counts: {} };
export function getAffinityDiagnostics() {
    return structuredClone(affinityDiagnostics);
}

export async function init() {
    if (document.getElementById('affinity_settings')) return;
    runtime = await createPluginRuntime(import.meta.url, 'affinity');
    if (extension_settings.disabledExtensions.includes(runtime.extensionId)) return;
    let seeded = false;
    const isSettingsObject = value => value !== null && typeof value === 'object'
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    if (!isSettingsObject(extension_settings.affinity)) {
        extension_settings.affinity = {};
        seeded = true;
    }
    const settings = extension_settings.affinity;
    const legacy = isSettingsObject(extension_settings.director) && isSettingsObject(extension_settings.director.affinity)
        ? extension_settings.director.affinity : null;
    // Standalone memory keeps explicit new preferences. Only absent fields may
    // inherit the former bundled preferences; the Director namespace is retained.
    if (!Object.hasOwn(settings, 'enabled') && legacy && Object.hasOwn(legacy, 'enabled') && typeof legacy.enabled === 'boolean') {
        settings.enabled = legacy.enabled;
        seeded = true;
    }
    if (!Object.hasOwn(settings, 'interval') && legacy && Object.hasOwn(legacy, 'interval') && [5, 10].includes(legacy.interval)) {
        settings.interval = legacy.interval;
        seeded = true;
    }
    if (typeof settings.enabled !== 'boolean') {
        settings.enabled = true;
        seeded = true;
    }
    if (![5, 10].includes(settings.interval)) {
        settings.interval = 10;
        seeded = true;
    }
    const context = getContext();
    const countAffinityPromptTokens = prompt => runtime.countPromptTokens(prompt, AFFINITY_SCHEMA);
    const affinityOutputLimit = () => affinityOutputTokenLimit(getMaxContextTokens());
    const affinityIdentity = () => {
        const active = getContext();
        return JSON.stringify([active.mainApi, getGeneratingApi(), getGeneratingModel(),
            active.mainApi === 'textgenerationwebui' ? getTextGenModel() : null,
            active.powerUserSettings?.tokenizer, active.mainApi === 'openai' ? active.getTokenizerModel() : getTokenizerBestMatch(active.mainApi),
            active.mainApi === 'openai' ? active.chatCompletionSettings?.custom_url : active.getTextGenServer?.(),
            active.powerUserSettings?.instruct, getMaxContextTokens(), affinityOutputLimit()]);
    };
    const affinityBudget = signal => ({
        maxTokens: () => getMaxPromptTokens(affinityOutputLimit()), countTokens: countAffinityPromptTokens, signal, getIdentity: affinityIdentity,
    });
    const affinity = createAffinityController(getContext, {
        isGenerating, uuid: uuidv4,
        requestIdentity: affinityIdentity,
        onDiagnostic: snapshot => { affinityDiagnostics = { total: snapshot.total, counts: { ...snapshot.counts } }; },
        maxOutputTokens: affinityOutputLimit,
        fitPrompt: (render, refs, state, owners, signal) => fitAffinityPrompt(
            (shown, memory) => render(shown, memory, owners), { refs, state },
            affinityBudget(signal),
        ),
        fitVerificationPrompt: (render, candidates, signal) => fitAffinityVerificationPrompts(render, candidates, affinityBudget(signal)),
    });
    affinityDiagnostics = affinity.getDiagnostics();

    globalThis[runtime.interceptorKey] = async function affinity_memory_interceptor(requestChat, _contextSize, _abort, type) {
        if (!runtime.claim(requestChat)) return;
        try {
            runtime.prepare(type, requestChat);
            affinity.prepare(type, requestChat);
            await runtime.seal(requestChat);
        } catch (error) {
            console.error('Affinity memory interceptor failed', error);
            _abort(true);
        }
    };

    if (seeded) context.saveSettingsDebounced();
    $('#extensions_settings').append(await renderExtensionTemplateAsync(runtime.extensionId, 'settings'));
    $('#affinity_enabled').prop('checked', settings.enabled).on('change', function () {
        settings.enabled = this.checked;
        affinity.refresh();
        context.saveSettingsDebounced();
    });
    $('#affinity_interval').val(String(settings.interval)).on('change', function () {
        settings.interval = Number($(this).val()) === 5 ? 5 : 10;
        affinity.refresh();
        context.saveSettingsDebounced();
    });
    affinity.refresh();
}
