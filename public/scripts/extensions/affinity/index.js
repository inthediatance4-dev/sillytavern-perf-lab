import { createRawPrompt, getMaxContextTokens, getMaxPromptTokens, isGenerating, getGeneratingApi, getGeneratingModel } from '../../../script.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../extensions.js';
import { countTokensOpenAIAsync, getTokenizerBestMatch } from '../../tokenizers.js';
import { getTextGenModel } from '../../textgen-settings.js';
import { uuidv4 } from '../../utils.js';
import { AFFINITY_SCHEMA, createAffinityController } from './affinity.js';
import { affinityOutputTokenLimit, fitAffinityPrompt, fitAffinityVerificationPrompts } from './affinity-prompt-budget.js';

let affinityDiagnostics = { total: 0, counts: {} };
export function getAffinityDiagnostics() {
    return structuredClone(affinityDiagnostics);
}

export async function init() {
    if (extension_settings.disabledExtensions.includes('affinity') || document.getElementById('affinity_settings')) return;
    const settings = extension_settings.affinity ??= {};
    let seeded = false;
    if (typeof settings.enabled !== 'boolean') {
        settings.enabled = true;
        seeded = true;
    }
    if (![5, 10].includes(settings.interval)) {
        settings.interval = 10;
        seeded = true;
    }
    const context = getContext();
    const countAffinityPromptTokens = async prompt => {
        const current = getContext();
        const formatted = createRawPrompt(prompt, current.mainApi, false, false, '', '', { literal: true });
        const textTokens = Array.isArray(formatted)
            ? await countTokensOpenAIAsync(formatted, true)
            : await current.getTokenCountAsync(formatted, 0);
        const schemaTokens = current.mainApi === 'openai'
            ? await current.getTokenCountAsync(JSON.stringify(AFFINITY_SCHEMA.value), 0) : 0;
        return textTokens + schemaTokens + 64;
    };
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

    globalThis.affinity_memory_interceptor = async function affinity_memory_interceptor(requestChat, _contextSize, _abort, type) {
        try {
            affinity.prepare(type, requestChat);
        } catch (error) {
            console.error('Affinity memory interceptor failed', error);
        }
    };

    if (seeded) context.saveSettingsDebounced();
    $('#extensions_settings').append(await renderExtensionTemplateAsync('affinity', 'settings'));
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