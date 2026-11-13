const INPUT_PATTERN = /{{input:([^{}]*?)}}/g;
const TOKEN_PATTERN = /{{input:([^{}]*?)}}|{{chapter}}/g;
// Host macro triggers. The legacy engine also accepts <USER>, <BOT>, <CHAR>, <GROUP>, <CHARIFNOTGROUP>.
const EXPANDABLE_MACRO = /{{|<(?:user|bot|char|group|charifnotgroup)>/i;

/**
 * Whether a second substituteParams pass would be able to rewrite this text.
 * Macro-free text is left on the upstream path unchanged.
 * @param {string} text
 * @returns {boolean}
 */
export function containsExpandableMacro(text) {
    return EXPANDABLE_MACRO.test(String(text ?? ''));
}

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
 * A marker is a string title at extra.director.chapter.title. Chapter numbers
 * are not stored, and a chapter object without a title does not count.
 * @param {object[]} chat Current messages
 * @returns {number} Number of marked chapters
 */
export function countChapters(chat = []) {
    return chat.filter(message => typeof message?.extra?.director?.chapter?.title === 'string').length;
}

/**
 * Expands macros in template literals only. User input is copied through, and
 * {{chapter}} becomes the live chapter number. A macro cannot span those tokens.
 * A null input result cancels the whole template. Explicit empty input values
 * are allowed, including fields with no default; they remain empty strings.
 * @param {string} template Preset template
 * @param {object} options Rendering dependencies
 * @param {(inputs: DirectorTemplateInput[]) => Promise<string[] | null> | string[] | null} [options.collectInputs] Collect all input values once
 * @param {object[]} [options.chat] Live chat array for chapter counting
 * @param {(text: string) => string} [options.substituteParams] Standard macro expansion, applied to each literal fragment
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

    const nextChapter = String(countChapters(chat) + 1);
    let inputIndex = 0;
    let cursor = 0;
    let rendered = '';
    const expandLiteral = text => (text ? substituteParams(text) : '');
    for (const match of template.matchAll(TOKEN_PATTERN)) {
        rendered += expandLiteral(template.slice(cursor, match.index));
        if (match[0] === '{{chapter}}') {
            rendered += nextChapter;
        } else {
            const index = inputIndex++;
            rendered += values[index] ?? inputs[index].defaultValue;
        }
        cursor = match.index + match[0].length;
    }
    rendered += expandLiteral(template.slice(cursor));
    return rendered;
}
