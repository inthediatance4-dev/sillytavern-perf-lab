const INPUT_PATTERN = /{{input:([^{}]*?)}}/g;
const TOKEN_PATTERN = /{{input:([^{}]*?)}}|{{chapter}}/g;

/**
 * @typedef {object} DirectorTemplateInput
 * @property {string} prompt Input label
 * @property {string} defaultValue Initial value (empty when no default was given)
 */

/**
 * Reads input fields in template order. Only the first pipe separates the default.
 * @param {string} template Preset template
 * @returns {DirectorTemplateInput[]} Input fields
 */
export function parseInputs(template) {
    return Array.from(template.matchAll(INPUT_PATTERN), match => {
        const separator = match[1].indexOf('|');
        return {
            prompt: separator < 0 ? match[1] : match[1].slice(0, separator),
            defaultValue: separator < 0 ? '' : match[1].slice(separator + 1),
        };
    });
}

/**
 * Slash text fills the first input. Later explicit defaults (including an empty
 * default) are used directly; only remaining inputs without defaults are asked.
 * @param {string} template Preset template
 * @param {string | undefined} text Optional slash command input
 * @param {(inputs: DirectorTemplateInput[]) => Promise<string[] | null> | string[] | null} collectInputs Input dialog callback
 * @returns {Promise<string[] | null>} Complete values in template order, or cancellation
 */
export async function collectPresetInputs(template, text, collectInputs) {
    const inputs = parseInputs(template);
    if (!inputs.length) return [];
    if (text === undefined) return collectInputs(inputs);
    const values = inputs.map(input => input.defaultValue);
    values[0] = text;
    const remaining = Array.from(template.matchAll(INPUT_PATTERN))
        .map((match, index) => ({ index, hasDefault: match[1].includes('|') }))
        .filter(input => input.index > 0 && !input.hasDefault);
    if (remaining.length) {
        const result = await collectInputs(remaining.map(input => inputs[input.index]));
        if (result === null) return null;
        remaining.forEach((input, index) => { values[input.index] = result[index] ?? ''; });
    }
    return values;
}

/**
 * Counts chapter markers from the current chat, so deletions need no renumbering.
 * @param {object[]} chat Current messages
 * @returns {number} Number of marked chapters
 */
export function countChapters(chat = []) {
    return chat.filter(message => message?.extra?.director?.chapter).length;
}

/**
 * Resolves all inputs in one call, then expands the host application's macros.
 * A null input result cancels the whole template. Explicit empty input values
 * are allowed, including fields with no default; they remain empty strings.
 * @param {string} template Preset template
 * @param {object} options Rendering dependencies
 * @param {(inputs: DirectorTemplateInput[]) => Promise<string[] | null> | string[] | null} [options.collectInputs] Collect all input values once
 * @param {object[]} [options.chat] Live chat array for chapter counting
 * @param {(text: string) => string} [options.substituteParams] Standard macro expansion
 * @returns {Promise<string | null>} Resolved template, or null on cancellation
 */
export async function renderDirectorTemplate(template, { collectInputs, chat = [], substituteParams = text => text } = {}) {
    const inputs = parseInputs(template);
    let values = [];
    if (inputs.length) {
        values = await collectInputs(inputs);
        if (values === null) {
            return null;
        }
    }

    const nextChapter = countChapters(chat) + 1;
    let inputIndex = 0;
    // Replace template tokens in one pass so input text is never parsed again.
    const text = template.replace(TOKEN_PATTERN, (match, input) => {
        if (input === undefined) {
            return String(nextChapter);
        }
        const index = inputIndex++;
        return values[index] ?? inputs[index].defaultValue;
    });
    return substituteParams(text);
}
