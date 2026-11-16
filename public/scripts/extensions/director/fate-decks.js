/** Local face-down decks. Titles stay vague; the model invents the private event. */
const CATEGORY_LIST = [
    { id: 'echo', titles: ['意外的回声', '尘封的低语', '忽然想起的事'], theme: 'a surprising discovery or new information' },
    { id: 'encounter', titles: ['不期而遇', '路过的人', '门边的身影'], theme: 'an unexpected encounter or arrival' },
    { id: 'turn', titles: ['悄然转向', '路变得不同', '节外的变化'], theme: 'a change in circumstances or an unforeseen obstacle' },
    { id: 'gift', titles: ['命运的馈赠', '送上门的机会', '意料之外的门'], theme: 'an opportunity with an unexpected complication' },
    { id: 'undercurrent', titles: ['暗流涌动', '关系的涟漪', '心绪微动'], theme: 'a shift in a relationship, trust, or motivation' },
    { id: 'tidings', titles: ['远方来讯', '旧事回潮', '迟来的音信'], theme: 'a consequence of an earlier choice returning to the story' },
    { id: 'secret', titles: ['秘密浮现', '遮掩的一角', '不为人知的事'], theme: 'a secret or hidden fact beginning to surface' },
    { id: 'deadline', titles: ['时限逼近', '将至的时刻', '不能再拖'], theme: 'a time limit or approaching deadline' },
    { id: 'object', titles: ['得失之物', '手中之物', '不见的一件'], theme: 'an object gained, lost, or changing hands' },
    { id: 'weather', titles: ['天时异变', '天空变了', '四周的征候'], theme: 'a change in weather or the surrounding environment' },
    { id: 'misunderstanding', titles: ['误会丛生', '话没有说清', '各想各的'], theme: 'a misunderstanding between characters' },
    { id: 'dilemma', titles: ['两难之境', '难以两全', '必须取舍'], theme: 'a dilemma facing an NPC or the situation, never deciding the choice for the user\'s character' },
];

export const CATEGORIES = Object.freeze(CATEGORY_LIST.map(category => Object.freeze({
    ...category, titles: Object.freeze(category.titles.slice()),
})));

export const RARITIES = Object.freeze({
    common: Object.freeze({ weight: 70, label: '寻常', line: null }),
    rare: Object.freeze({ weight: 25, label: '稀有', line: 'Tie the event to a detail, object or character already established earlier in the story.' }),
    legendary: Object.freeze({ weight: 5, label: '传说', line: 'Make the event a revelation that recasts something believed so far, without contradicting established facts.' }),
});

export const CATEGORY_IDS = new Set(CATEGORIES.map(category => category.id));
export const ALL_TITLES = new Set(CATEGORIES.flatMap(category => category.titles));
const RARITY_ENTRIES = Object.entries(RARITIES);
const RARITY_TOTAL = RARITY_ENTRIES.reduce((sum, [, rarity]) => sum + rarity.weight, 0);

export function findCategoryByTitle(title) {
    return CATEGORIES.find(category => category.titles.includes(title)) ?? null;
}

function rollIndex(random, length) {
    return Math.min(length - 1, Math.max(0, Math.floor(random() * length)));
}

function rollRarity(random) {
    let roll = random() * RARITY_TOTAL;
    for (const [id, rarity] of RARITY_ENTRIES) {
        roll -= rarity.weight;
        if (roll < 0) return id;
    }
    return RARITY_ENTRIES.at(-1)[0];
}

/**
 * Deal three face-down cards. Categories are distinct and avoid `recent`.
 * Rarity is independent. Pity upgrades one common card to rare when none are higher.
 * @param {() => number} random
 * @param {{ recent?: string[], pity?: number }} [options]
 * @returns {{ category: string, title: string, rarity: string }[]}
 */
export function rollOffer(random, { recent = [], pity = 0 } = {}) {
    const excluded = new Set(recent.filter(id => CATEGORY_IDS.has(id)));
    let pool = CATEGORIES.filter(category => !excluded.has(category.id));
    if (pool.length < 3) pool = CATEGORIES.slice();
    const available = pool.slice();
    const picked = [];
    for (let count = 0; count < 3; count++) {
        const category = available.splice(rollIndex(random, available.length), 1)[0];
        const title = category.titles[rollIndex(random, category.titles.length)];
        picked.push({ category: category.id, title, rarity: rollRarity(random) });
    }
    if (pity >= 8 && picked.every(card => card.rarity === 'common')) {
        const index = rollIndex(random, picked.length);
        picked[index] = { ...picked[index], rarity: 'rare' };
    }
    return picked;
}
