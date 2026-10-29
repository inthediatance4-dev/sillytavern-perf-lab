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

/**
 * Consume only Director-owned instructions included in a completed request.
 * Upstream /inject ephemeral=true keeps its existing end/stop lifecycle.
 * @param {() => object} getContext Current extension context
 */
export function initInstructLifecycle(getContext) {
    const requests = new WeakMap();
    const { eventSource, eventTypes } = getContext();
    eventSource.on(eventTypes.GENERATE_AFTER_DATA, (data, dryRun) => {
        if (dryRun) return;
        const context = getContext();
        const injects = Object.entries(context.chatMetadata.script_injects ?? {}).filter(([, inject]) =>
            inject.directorEphemeral === true && includesInstruction(data.prompt ?? data.input, inject.value));
        if (injects.length) requests.set(data, { metadata: context.chatMetadata, chatId: context.chatId, injects });
    });
    eventSource.on(eventTypes.GENERATION_COMPLETED, async ({ data, chatMetadata, chatId }) => {
        const request = requests.get(data);
        requests.delete(data);
        const context = getContext();
        if (!request || request.metadata !== chatMetadata || request.chatId !== chatId
            || context.chatMetadata !== chatMetadata || context.chatId !== chatId) return;
        let changed = false;
        for (const [id, inject] of request.injects) {
            if (chatMetadata.script_injects?.[id] !== inject || !includesInstruction(data.prompt ?? data.input, inject.value)) continue;
            delete chatMetadata.script_injects[id];
            context.setExtensionPrompt(`script_inject_${id}`, '', inject.position, inject.depth, inject.scan, inject.role);
            changed = true;
        }
        // Persist consumption before auto-continue can assemble another request.
        if (changed) await context.saveMetadata();
    });
}
