import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_TITLES, CATEGORIES, CATEGORY_IDS, RARITIES, findCategoryByTitle, rollOffer } from '../public/scripts/extensions/director/fate-decks.js';

const ORIGINAL = [
    ['echo', '意外的回声', 'a surprising discovery or new information'],
    ['encounter', '不期而遇', 'an unexpected encounter or arrival'],
    ['turn', '悄然转向', 'a change in circumstances or an unforeseen obstacle'],
    ['gift', '命运的馈赠', 'an opportunity with an unexpected complication'],
    ['undercurrent', '暗流涌动', 'a shift in a relationship, trust, or motivation'],
    ['tidings', '远方来讯', 'a consequence of an earlier choice returning to the story'],
];

function lcg(seed) {
    let state = seed >>> 0 || 1;
    return () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

test('the deck keeps the original six titles and adds six vague categories', () => {
    assert.equal(CATEGORIES.length, 12);
    assert.equal(CATEGORY_IDS.size, 12);
    assert.equal(ALL_TITLES.size, 36);
    for (const [id, title, theme] of ORIGINAL) {
        const category = CATEGORIES.find(item => item.id === id);
        assert.ok(category, id);
        assert.equal(category.titles[0], title);
        assert.equal(category.titles.length, 3);
        assert.equal(category.theme, theme);
        assert.equal(findCategoryByTitle(title), category);
        assert.equal(ALL_TITLES.has(title), true);
    }
    const ids = ['secret', 'deadline', 'object', 'weather', 'misunderstanding', 'dilemma'];
    for (const id of ids) assert.equal(CATEGORY_IDS.has(id), true);
    const dilemma = CATEGORIES.find(category => category.id === 'dilemma');
    assert.equal(dilemma.theme, 'a dilemma facing an NPC or the situation, never deciding the choice for the user\'s character');
    for (const category of CATEGORIES) {
        assert.equal(/[.!?。]$/.test(category.theme), false, category.id);
        assert.equal(category.titles.length, 3);
        for (const title of category.titles) {
            assert.equal(findCategoryByTitle(title), category);
            assert.equal(title.includes(category.theme), false);
        }
    }
    assert.equal(findCategoryByTitle('具体发生了什么'), null);
    assert.deepEqual(RARITIES.common, { weight: 70, label: '寻常', line: null });
    assert.equal(RARITIES.rare.weight, 25);
    assert.equal(RARITIES.legendary.weight, 5);
    assert.match(RARITIES.rare.line, /already established/);
    assert.match(RARITIES.legendary.line, /without contradicting/);
});

test('rollOffer deals three distinct cards, avoids recent, and honors pity', () => {
    const recent = ['echo', 'secret'];
    const frozen = recent.slice();
    const dealt = rollOffer(() => 0, { recent, pity: 0 });
    assert.deepEqual(recent, frozen);
    assert.equal(dealt.length, 3);
    assert.deepEqual(dealt.map(card => card.category), ['encounter', 'turn', 'gift']);
    assert.deepEqual(dealt.map(card => card.rarity), ['common', 'common', 'common']);
    assert.deepEqual(dealt.map(card => card.title), ['不期而遇', '悄然转向', '命运的馈赠']);
    const upgraded = rollOffer(() => 0, { recent: [], pity: 8 });
    assert.deepEqual(upgraded.map(card => card.rarity), ['rare', 'common', 'common']);
    assert.deepEqual(rollOffer(() => 0, { pity: 7 }).map(card => card.rarity), ['common', 'common', 'common']);
    const high = rollOffer(() => 0.999, { pity: 8 });
    assert.deepEqual(high.map(card => card.rarity), ['legendary', 'legendary', 'legendary']);
});

test('a seeded 10000-deal sample stays inside the rarity weights', () => {
    const counts = { common: 0, rare: 0, legendary: 0 };
    const random = lcg(20261031);
    for (let index = 0; index < 10000; index++) {
        const recent = index % 2 === 0 ? ['echo', 'deadline'] : [];
        const cards = rollOffer(random, { recent, pity: 0 });
        const ids = cards.map(card => card.category);
        assert.equal(new Set(ids).size, 3);
        for (const id of recent) assert.equal(ids.includes(id), false);
        for (const card of cards) {
            counts[card.rarity]++;
            assert.equal(findCategoryByTitle(card.title)?.id, card.category);
        }
    }
    const total = 30000;
    assert.ok(Math.abs(counts.common / total - 0.70) <= 0.02, JSON.stringify(counts));
    assert.ok(Math.abs(counts.rare / total - 0.25) <= 0.02, JSON.stringify(counts));
    assert.ok(Math.abs(counts.legendary / total - 0.05) <= 0.02, JSON.stringify(counts));
    for (let index = 0; index < 10000; index++) {
        const cards = rollOffer(lcg(index + 1), { recent: ['gift'], pity: 8 });
        assert.equal(cards.some(card => card.rarity === 'rare' || card.rarity === 'legendary'), true);
        assert.equal(cards.some(card => card.category === 'gift'), false);
    }
});
