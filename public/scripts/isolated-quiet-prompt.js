/**
 * Run a self-contained evaluator prompt without entering the chat generation
 * lifecycle. The raw provider path owns its abort controller and never unlocks
 * the foreground generation UI.
 * @param {{quietPrompt?: string, jsonSchema?: object|null, responseLength?: number|null, signal?: AbortSignal|null}} options
 * @param {(options: object) => Promise<string>} generateRaw Current-provider raw generator
 * @returns {Promise<string>}
 */
export async function generateIsolatedQuietPrompt({ quietPrompt = '', jsonSchema = null, responseLength = null, signal = null } = {}, generateRaw) {
    if (responseLength !== null && responseLength !== undefined) {
        throw new Error('Isolated quiet prompts do not support responseLength overrides.');
    }
    if (typeof quietPrompt !== 'string' || !quietPrompt.trim()) {
        throw new Error('An isolated quiet prompt must contain text.');
    }
    signal?.throwIfAborted();
    return generateRaw({ prompt: quietPrompt, jsonSchema, trimNames: false, literal: true, signal });
}

/**
 * Link a caller-owned cancellation signal to a request-local controller.
 * @param {AbortSignal|null} signal Caller-owned signal
 * @param {AbortController} controller Request-local controller
 * @returns {() => void} Remove the listener after the request settles
 */
export function linkQuietAbortSignal(signal, controller) {
    if (!signal) return () => {};
    const cancel = () => controller.abort(signal.reason);
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
    return () => signal.removeEventListener('abort', cancel);
}
