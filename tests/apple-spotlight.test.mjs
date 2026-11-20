import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSpotlightItems, scoreSpotlightItem } from '../public/scripts/apple-spotlight.js';

test('scoreSpotlightItem prioritizes exact, prefix, substring, keyword, and CJK subsequence matches', () => {
    const item = {
        title: '💕 好感度记忆',
        subtitle: '扩展程序',
        keywords: 'affinity memory 设置 扩展',
    };
    assert.equal(scoreSpotlightItem(item, '') > 0, true);
    assert.equal(scoreSpotlightItem(item, '💕 好感度记忆') > scoreSpotlightItem(item, '好感度'), true);
    assert.equal(scoreSpotlightItem(item, 'affinity') > 0, true);
    assert.equal(scoreSpotlightItem(item, '好记') > 0, true);
    assert.equal(scoreSpotlightItem(item, '完全无关词xyz'), 0);
});

test('collectSpotlightItems indexes drawers, inline settings sections, quick actions, and characters on demand', t => {
    const prevST = globalThis.SillyTavern;
    const prevComputed = globalThis.getComputedStyle;
    const actions = [];

    globalThis.getComputedStyle = () => ({ display: 'none' });
    globalThis.SillyTavern = {
        getContext: () => ({
            characters: [{ name: 'Seraphina', avatar: 'seraphina.png' }],
            selectCharacterById: id => actions.push(['char', id]),
        }),
    };
    t.after(() => {
        if (prevST === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = prevST;
        globalThis.getComputedStyle = prevComputed;
    });

    const drawerContent = {
        classList: { contains: () => false },
        parentElement: {
            querySelector: sel => sel === '.drawer-toggle' ? { click: () => actions.push(['open-drawer']) } : null,
        },
        querySelector: () => ({ textContent: '扩展程序' }),
    };
    const inlineBody = {};
    const inlineDrawer = {
        classList: { add() {}, remove() {} },
        querySelector: () => inlineBody,
        scrollIntoView: () => actions.push(['scroll-inline']),
    };
    const inlineHeader = {
        textContent: '🎬 命运之牌',
        click: () => actions.push(['expand-inline']),
        closest: sel => sel === '.drawer-content' ? drawerContent : inlineDrawer,
    };

    const fakeDoc = {
        documentElement: { dataset: { appleAppearance: 'dark' } },
        getElementById: id => {
            if (id === 'apple_appearance_toggle') return { click: () => actions.push(['toggle-theme']) };
            if (id === 'apple_exit_chat_btn') return { click: () => actions.push(['exit-chat']) };
            if (id === 'directorButton') return { click: () => actions.push(['director']) };
            if (id === 'chat') return { scrollTop: 0, scrollHeight: 1000 };
            return null;
        },
        querySelector: () => null,
        querySelectorAll: sel => {
            if (sel === '#top-settings-holder > .drawer') {
                return [{
                    id: 'extensions-settings-button',
                    querySelector: s => {
                        if (s === '.drawer-toggle') return { click: () => actions.push(['drawer-toggle']) };
                        if (s === '.drawer-icon') return { getAttribute: () => '扩展程序' };
                        if (s === '.drawer-content') return drawerContent;
                        return null;
                    },
                }];
            }
            if (sel === '#top-settings-holder .inline-drawer > .inline-drawer-header') {
                return [inlineHeader];
            }
            return [];
        },
    };

    const items = collectSpotlightItems(fakeDoc);
    const titles = items.map(i => i.title);
    assert.equal(titles.some(x => x.includes('Apple Light')), true);
    assert.equal(titles.includes('打开盲抽命运牌'), true);
    assert.equal(titles.includes('退出当前聊天'), true);
    assert.equal(titles.includes('扩展程序'), true);
    assert.equal(titles.includes('🎬 命运之牌'), true);
    assert.equal(titles.includes('Seraphina'), true);

    // Executing an inline setting opens its parent drawer, expands the collapsed section, and scrolls into view
    const fateSetting = items.find(i => i.title === '🎬 命运之牌');
    fateSetting.run();
    assert.deepEqual(actions, [['open-drawer'], ['expand-inline'], ['scroll-inline']]);

    // Executing character item delegates to official selectCharacterById
    const charItem = items.find(i => i.title === 'Seraphina');
    charItem.run();
    assert.deepEqual(actions.at(-1), ['char', 0]);
});
