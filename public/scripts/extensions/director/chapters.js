/** Messages farther than this from the loaded window ask before loading. */
export const CHAPTER_LOAD_CONFIRM_DISTANCE = 500;

/**
 * Chapter title rule. The stored title is the raw value of the first
 * `{{input}}` in the preset template, in template order. The default chapter
 * preset's only input prompt is 章节标题, so that value is the title. Later
 * inputs stay in the message body. The expanded message, including any
 * 第N章 text produced by `{{chapter}}`, is not the title. When the template
 * has no input, the preset name is used. An explicit empty string is kept.
 * Chapter numbers are never part of this value and are never stored.
 * @param {string[] | null | undefined} values Input values in template order
 * @param {string} [presetName] Fallback when the template has no input
 * @returns {string} Title stored at extra.director.chapter.title
 */
export function chapterTitleFromValues(values, presetName = '') {
    if (Array.isArray(values) && values.length > 0 && values[0] != null) return String(values[0]);
    return String(presetName ?? '');
}

/**
 * A chapter is a message with a string title. Numbers are not stored.
 * @param {object | null | undefined} message Chat message
 * @returns {boolean} Whether the message is a chapter start
 */
export function isDirectorChapter(message) {
    return typeof message?.extra?.director?.chapter?.title === 'string';
}

/**
 * Live chapter list in chat order. `number` is 1-based and derived here.
 * @param {object[]} [chat] Current messages, including ones not in the DOM
 * @returns {{index: number, number: number, title: string}[]} Chapters
 */
export function listChapters(chat = []) {
    const chapters = [];
    for (let index = 0; index < chat.length; index++) {
        const title = chat[index]?.extra?.director?.chapter?.title;
        if (typeof title !== 'string') continue;
        chapters.push({ index, number: chapters.length + 1, title });
    }
    return chapters;
}

/**
 * Divider text. The space after 章 is a normal space, not a stored field.
 * @param {number} number Live 1-based chapter number
 * @param {string} title Chapter title
 * @returns {string} Label rendered outside .mes_text
 */
export function chapterLabel(number, title) {
    return `第${number}章 ${title}`;
}

/**
 * First-line prefill for the mark dialog. Existing titles are not reused
 * because marking again is how a chapter is cleared.
 * @param {object | null | undefined} message Chat message
 * @returns {string} Suggested title
 */
export function prefillChapterTitle(message) {
    const line = String(message?.mes ?? '').split(/\r?\n/).find(item => item.trim());
    return line ? line.trim() : '';
}

/**
 * Chapter metadata belongs to the message, so every swipe must restore it.
 * Keep each swipe's other extras, and avoid sharing mutable director objects.
 * @param {object} message Chat message
 */
export function syncChapterToSwipes(message) {
    if (!Array.isArray(message.swipes) && !Array.isArray(message.swipe_info)) return;
    if (!Array.isArray(message.swipe_info)) message.swipe_info = [];
    const count = Math.max(message.swipes?.length ?? 0, message.swipe_info.length);
    for (let index = 0; index < count; index++) {
        if (!message.swipe_info[index] || typeof message.swipe_info[index] !== 'object') message.swipe_info[index] = {};
        const info = message.swipe_info[index];
        if (!info.extra || typeof info.extra !== 'object' || Array.isArray(info.extra)) info.extra = {};
        if (message.extra?.director) info.extra.director = structuredClone(message.extra.director);
        else delete info.extra.director;
    }
}

/**
 * Marks a message as a chapter start. An existing director block keeps its
 * id and preset; a new block uses preset 'chapter'. No chapter number is written.
 * @param {object} message Chat message
 * @param {string} title Chapter title
 * @param {string} [id] UUID for a newly created director block
 * @returns {object} The director block now stored on the message
 */
export function markChapter(message, title, id) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new TypeError('Expected a message');
    if (typeof title !== 'string') throw new TypeError('Expected a chapter title');
    if (!message.extra || typeof message.extra !== 'object' || Array.isArray(message.extra)) message.extra = {};
    const existing = message.extra.director;
    const director = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
    if (!director.id) director.id = id;
    if (!director.preset) director.preset = 'chapter';
    director.chapter = { title };
    message.extra.director = director;
    syncChapterToSwipes(message);
    return director;
}

/**
 * Removes the chapter title. The director block is removed when it is empty
 * or only the chapter shell remains (`id` plus `preset: 'chapter'`). A
 * non-chapter preset id and its id stay on the message.
 * @param {object} message Chat message
 * @returns {boolean} Whether a chapter title was removed
 */
export function unmarkChapter(message) {
    const director = message?.extra?.director;
    if (!director || typeof director !== 'object' || !Object.hasOwn(director, 'chapter')) return false;
    delete director.chapter;
    const keys = Object.keys(director);
    const chapterShell = keys.length > 0 && keys.every(key => key === 'id' || key === 'preset') && director.preset === 'chapter';
    if (keys.length === 0 || chapterShell) delete message.extra.director;
    syncChapterToSwipes(message);
    return true;
}

/**
 * How many messages sit before the loaded window. Zero when the target is
 * already inside it. SillyTavern loads a suffix, so targets are at or before
 * the first loaded id.
 * @param {number} firstLoadedId mesid of the first loaded message
 * @param {number} targetId Chapter message index
 * @returns {number} Messages that must be loaded
 */
export function messagesBeforeLoadedRange(firstLoadedId, targetId) {
    if (!Number.isInteger(firstLoadedId) || !Number.isInteger(targetId)) return 0;
    return Math.max(0, firstLoadedId - targetId);
}

/**
 * @param {number} distance Result of messagesBeforeLoadedRange
 * @returns {boolean} Whether the jump must ask first
 */
export function needsLoadConfirm(distance) {
    return distance > CHAPTER_LOAD_CONFIRM_DISTANCE;
}

/**
 * @param {number} distance Messages to load
 * @returns {string} Confirm dialog copy
 */
export function loadConfirmMessage(distance) {
    return `需要加载约 ${distance} 条消息`;
}
