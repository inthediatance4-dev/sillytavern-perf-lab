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
