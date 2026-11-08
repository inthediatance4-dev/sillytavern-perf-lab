import { CATEGORIES, RARITIES } from './fate-decks.js';

/** Piggyback mode appends one private JSON block to a normal story reply, so a
 * round of fate costs one provider call instead of two. The block is stripped
 * before the reply is saved or left visible. */
export const PIGGYBACK_MARKER = '[[DIRECTOR_FATE_OFFER]]';
// Pregenerated events are written at this strength; a pick at another strength
// falls back to its own quiet draw so the event always matches the choice.
export const PIGGYBACK_STRENGTH = 'medium';
const MAX_BLOCK_LENGTH = 16000;
const MAX_EVENT_LENGTH = 400;
const STRENGTH_LINE = 'a meaningful but manageable turn';
const categoryById = new Map(CATEGORIES.map(category => [category.id, category]));

const validEvent = value => typeof value === 'string' && value.trim().length > 0
    && Array.from(value).length <= MAX_EVENT_LENGTH && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);

/** cards: the locally rolled faces ({category,title,rarity}) the model must write events for. */
export function buildPiggybackInstruction(cards) {
    const lines = [
        '【系统附加任务，非角色扮演】完成上面的故事回复后，另起一行，先原样输出标记 ' + PIGGYBACK_MARKER + '，再紧跟一个JSON对象。',
        '该对象恰好含一个键 events：一个恰好3项的数组，按顺序为下面三张牌各写一个突发事件。每项恰好含 category、title、event 三个键，category 和 title 必须与对应牌完全一致。',
        'event 用故事语言简述一个具体的突发事件，最多400字，保持角色自主性和已有事实，不要续写剧情、不要写对话、不要给助手下指令。',
        'JSON之外不要输出任何解释。故事正文中不得提及此任务或标记。',
    ];
    cards.forEach((card, index) => {
        const category = categoryById.get(card.category);
        const parts = [`第${index + 1}张: category="${card.category}", title="${card.title}"。主题: ${category?.theme ?? card.category}。强度: ${STRENGTH_LINE}。`];
        const rarityLine = RARITIES[card.rarity]?.line;
        if (rarityLine) parts.push(rarityLine);
        lines.push(parts.join(' '));
    });
    return lines.join('\n');
}

/** Index of the marker that starts the appended block, or -1. */
export function piggybackBlockStart(text) {
    if (typeof text !== 'string') return -1;
    return text.indexOf(PIGGYBACK_MARKER);
}

/** Everything from the marker onward is private; the story keeps only the prefix. */
export function stripPiggyback(text) {
    const start = piggybackBlockStart(text);
    if (start < 0) return text;
    return text.slice(0, start).replace(/\s+$/, '');
}

function firstObject(raw) {
    const start = raw.indexOf('{');
    if (start < 0) throw new Error();
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < raw.length; index++) {
        const character = raw[index];
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') quoted = false;
        } else if (character === '"') quoted = true;
        else if (character === '{') depth++;
        else if (character === '}' && --depth === 0) return JSON.parse(raw.slice(start, index + 1));
    }
    throw new Error();
}

/**
 * Validate the appended block against the rolled faces. Returns three event
 * strings in card order, or null when the model deviated; callers then keep the
 * faces and fall back to the normal per-pick draw.
 */
export function parsePiggybackEvents(raw, cards) {
    if (typeof raw !== 'string' || !Array.isArray(cards) || cards.length !== 3) return null;
    const start = piggybackBlockStart(raw);
    if (start < 0) return null;
    // Budget only the private block; a long story prefix must not reject it.
    if (raw.length - start > MAX_BLOCK_LENGTH) return null;
    let value;
    try {
        value = firstObject(raw.slice(start + PIGGYBACK_MARKER.length));
    } catch {
        return null;
    }
    if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || !Array.isArray(value.events) || value.events.length !== 3) return null;
    const events = [];
    for (let index = 0; index < 3; index++) {
        const item = value.events[index];
        const card = cards[index];
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        if (Object.keys(item).length !== 3 || item.category !== card.category || item.title !== card.title || !validEvent(item.event)) return null;
        events.push(item.event.trim());
    }
    return events;
}