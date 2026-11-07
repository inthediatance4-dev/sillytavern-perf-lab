import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await fs.readFile(new URL('../public/script.js', import.meta.url), 'utf8');
const start = source.indexOf('export function refreshSwipeButtons(');
const end = source.indexOf('\n/**', start);
const refreshSource = source.slice(start, end).replace('export ', '');

function fixture({ allowed = true, empty = false } = {}) {
    let dirty = false;
    let flushes = 0;
    const counters = [];
    const chat = empty ? [] : [
        { is_user: false, swipes: ['a', 'b'], swipe_id: 0 },
        { is_user: true, swipes: ['a'], swipe_id: 0 },
        { is_user: false, swipes: ['a', 'b', 'c'], swipe_id: 2 },
    ];
    const messages = chat.map((message, id) => ({
        id, pickers: [{ visible: null }, { visible: null }], classes: new Set(),
        classList: {
            toggle(name, value) {
                dirty = true;
                if (value) messages[id].classes.add(name);
                else messages[id].classes.delete(name);
            },
            remove(...names) {
                dirty = true;
                for (const name of names) messages[id].classes.delete(name);
            },
        },
    }));
    function $(value) {
        if (Array.isArray(value)) {
            return {
                toggle(visible) {
                    if (visible && dirty) { flushes++; dirty = false; }
                    for (const picker of value) picker.visible = visible;
                },
            };
        }
        if (value === 'body') return { addClass() {}, removeClass() {} };
        return { find(selector) {
            assert.equal(selector, '.mes_swipe_picker');
            return value.pickers;
        } };
    }
    const context = vm.createContext({
        $, chat,
        chatElement: { children(selector) {
            assert.equal(selector, '.mes[mesid]');
            return { first: () => ({ attr: () => '0' }), each: callback => messages.forEach((div, i) => callback(i, div)) };
        } },
        isSwipingAllowed: () => allowed,
        isMessageSwipeable: id => id === chat.length - 1,
        canOpenSwipePickerForMessage: id => !chat[id].is_user && chat[id].swipes.length > 1,
        getOverswipeBehavior: () => 'regenerate',
        OVERSWIPE_BEHAVIOR: { REGENERATE: 'regenerate', EDIT_GENERATE: 'edit', PRISTINE_GREETING: 'greeting' },
        updateSwipeCounter: id => counters.push(id),
    });
    vm.runInContext(refreshSource, context);
    return { run: (...args) => context.refreshSwipeButtons(...args), messages, counters, flushes: () => flushes };
}

test('swipe refresh avoids a layout flush per historical message and retains all picker matches', () => {
    const f = fixture();
    f.run(false, false);
    assert.equal(f.flushes(), 1);
    assert.deepEqual(f.messages.map(m => m.pickers.map(p => p.visible)), [[true, true], [false, false], [true, true]]);
    assert.deepEqual(f.messages.map(m => [...m.classes]), [[], [], ['last_swipe', 'swipes_visible']]);
});

test('swipe refresh retains fade and opt-in counter updates for the swipeable message', () => {
    const f = fixture();
    f.run(true);
    assert.deepEqual(f.counters, [2]);
    assert.ok(f.messages.every(m => m.classes.has('fade')));
    assert.ok(f.messages[2].classes.has('swipes_visible'));
});

test('empty and globally disabled swipe paths do not touch message controls', () => {
    assert.equal(fixture({ empty: true }).run(), false);
    const f = fixture({ allowed: false });
    f.run(true);
    assert.equal(f.flushes(), 0);
    assert.deepEqual(f.counters, []);
    assert.ok(f.messages.every(m => m.pickers.every(p => p.visible === null)));
});
