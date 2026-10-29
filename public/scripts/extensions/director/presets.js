export const PRESET_LIMITS = Object.freeze({ maxPresets: 50, id: 128, icon: 64, name: 200, template: 20000 });

const PRESET_FIELDS = ['id', 'icon', 'name', 'mode', 'template', 'isChapter', 'autoGenerate'];
const PRESET_MODES = ['narrator', 'comment', 'instruct'];
const DEFAULT_PRESETS = [
    { id: 'time-skip', icon: '⏩', name: '时间跳跃', mode: 'narrator', template: '——{{input:过了多久？|一段时间}}后——' },
    { id: 'scene', icon: '🎬', name: '场景切换', mode: 'narrator', template: '【场景：{{input:新的地点}}】' },
    { id: 'narration', icon: '📖', name: '旁白', mode: 'narrator', template: '{{input:旁白内容}}' },
    { id: 'chapter', icon: '🌙', name: '新章节', mode: 'narrator', template: '第{{chapter}}章　{{input:章节标题}}', isChapter: true },
    { id: 'event', icon: '⚡', name: '突发事件', mode: 'narrator', template: '（突然，{{input:发生了什么}}）' },
    { id: 'direct', icon: '🎭', name: '导演指令', mode: 'instruct', template: '[导演指令：{{input:你希望接下来怎么发展}}]' },
    { id: 'advance', icon: '🔁', name: '推进剧情', mode: 'instruct', template: '[导演指令：推动剧情向前发展，引入一个新的变化，不要重复之前的情节。]' },
    { id: 'note', icon: '📝', name: '备注', mode: 'comment', template: '{{input:写给自己的备注}}' },
];

/**
 * Returns fresh defaults so edits and restoration cannot alter the source list.
 * @returns {object[]} Default Director presets
 */
export function createDefaultPresets() {
    return DEFAULT_PRESETS.map(preset => ({ isChapter: false, autoGenerate: false, ...preset }));
}

/**
 * @param {unknown} value Value to inspect
 * @returns {boolean} Whether the value is a plain object
 */
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

/**
 * Validates the entire import before returning copies. Duplicate IDs and unknown
 * fields are rejected; an empty list is valid. Length limits count UTF-16 units.
 * @param {unknown} config Parsed versioned import
 * @returns {object[]} Validated, independent preset copies
 */
export function validatePresetConfig(config) {
    if (!isObject(config) || Object.keys(config).some(key => !['version', 'presets'].includes(key))) {
        throw new Error('Director config must be an object with version and presets.');
    }
    if (config.version !== 1 || !Array.isArray(config.presets)) {
        throw new Error('Director config requires version 1 and a presets array.');
    }
    if (config.presets.length > PRESET_LIMITS.maxPresets) {
        throw new Error(`Director supports at most ${PRESET_LIMITS.maxPresets} presets.`);
    }

    const ids = new Set();
    return Array.from(config.presets, (preset, index) => {
        const fail = message => { throw new Error(`Director preset ${index + 1}: ${message}`); };
        if (!isObject(preset) || Object.keys(preset).some(key => !PRESET_FIELDS.includes(key))) {
            fail('expected a preset object with supported fields.');
        }
        for (const field of ['id', 'icon', 'name', 'template']) {
            if (typeof preset[field] !== 'string' || preset[field].length > PRESET_LIMITS[field]) {
                fail(`${field} must be a string of at most ${PRESET_LIMITS[field]} characters.`);
            }
        }
        if (!preset.id.trim() || !preset.name.trim()) fail('id and name must not be empty.');
        if (!PRESET_MODES.includes(preset.mode)) fail('unknown mode.');
        if (typeof preset.isChapter !== 'boolean' || typeof preset.autoGenerate !== 'boolean') {
            fail('isChapter and autoGenerate must be booleans.');
        }
        if (ids.has(preset.id)) fail('duplicate id.');
        ids.add(preset.id);
        return Object.fromEntries(PRESET_FIELDS.map(field => [field, preset[field]]));
    });
}

/**
 * @param {object[]} presets Presets to export
 * @returns {string} Versioned JSON suitable for downloading
 */
export function exportPresetConfig(presets) {
    return JSON.stringify({ version: 1, presets: validatePresetConfig({ version: 1, presets }) }, null, 2) + '\n';
}

/**
 * The first nine positions are the popover's digit shortcuts.
 * @param {object[]} presets Ordered presets
 * @param {string | number} digit Shortcut digit
 * @returns {object | undefined} Selected preset
 */
export function presetForDigit(presets, digit) {
    return /^[1-9]$/.test(String(digit)) ? presets[Number(digit) - 1] : undefined;
}

/**
 * @param {object[]} presets Ordered presets
 * @param {string} selector Position or complete preset name
 * @returns {object | undefined} Selected preset
 */
function resolveSelector(presets, selector) {
    if (/^[1-9]\d*$/.test(selector)) return presets[Number(selector) - 1];
    return presets.find(preset => preset.name === selector)
        ?? presets.find(preset => preset.name.toLowerCase() === selector.toLowerCase());
}

/**
 * Resolves a 1-based position or name, then optional input text. Exact names win
 * before case-insensitive names; multiword names use the longest matching prefix.
 * Numeric selectors always mean position. Parser arrays preserve quoted names.
 * @param {object[]} presets Ordered presets
 * @param {string | string[]} argument Slash command argument or split arguments
 * @returns {{preset: object, text: string | undefined} | null} Match, or null
 */
export function resolvePresetArgument(presets, argument) {
    if (Array.isArray(argument)) {
        if (!argument.length || argument.length > 2 || argument.some(value => typeof value !== 'string')) return null;
        const [selector, text] = argument;
        const preset = resolveSelector(presets, selector) ?? resolveSelector(presets, selector.trim());
        if (preset) return { preset, text };
        return resolvePresetArgument(presets, argument.join(' '));
    }
    if (typeof argument !== 'string' || !argument.trim()) return null;
    const source = argument.trim();
    const numeric = source.match(/^([1-9]\d*)(?:\s+([\s\S]*))?$/);
    if (numeric) {
        const preset = resolveSelector(presets, numeric[1]);
        return preset ? { preset, text: numeric[2] } : null;
    }
    const whole = resolveSelector(presets, source);
    if (whole) return { preset: whole, text: undefined };
    const byLength = presets.slice().sort((a, b) => b.name.length - a.name.length);
    for (const insensitive of [false, true]) {
        const preset = byLength.find(preset => {
            const prefix = source.slice(0, preset.name.length);
            return (insensitive ? prefix.toLowerCase() === preset.name.toLowerCase() : prefix === preset.name)
                && /\s/.test(source[preset.name.length] ?? '');
        });
        if (preset) return { preset, text: source.slice(preset.name.length).trimStart() };
    }
    return null;
}
