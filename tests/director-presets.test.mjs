import assert from 'node:assert/strict';
import test from 'node:test';
import {
    PRESET_LIMITS,
    createDefaultPresets,
    exportPresetConfig,
    presetForDigit,
    resolvePresetArgument,
    validatePresetConfig,
} from '../public/scripts/extensions/director/presets.js';
import { collectPresetInputs, renderDirectorTemplate } from '../public/scripts/extensions/director/template.js';

const config = presets => ({ version: 1, presets });
const preset = overrides => ({ ...createDefaultPresets()[0], ...overrides });

test('versioned JSON export/import round-trips every preset field without shared references', () => {
    const presets = [preset({ icon: '🎭', name: 'Custom scene', mode: 'comment', template: '{{user}}: {{input:内容|默认}}', isChapter: true, autoGenerate: true })];
    const exported = JSON.parse(exportPresetConfig(presets));
    assert.equal(exported.version, 1);
    assert.deepEqual(exported.presets, presets);
    const imported = validatePresetConfig(exported);
    assert.deepEqual(imported, presets);
    assert.notEqual(imported, exported.presets);
    assert.notEqual(imported[0], exported.presets[0]);
    imported[0].name = 'Edited';
    assert.equal(presets[0].name, 'Custom scene');
    assert.deepEqual(validatePresetConfig(config([])), []);
});

test('restoring defaults returns fresh exact defaults after custom edits and reordering', () => {
    const original = createDefaultPresets();
    const edited = createDefaultPresets();
    edited.reverse();
    edited[0].name = 'Changed';
    edited.splice(1, 2);
    const restored = createDefaultPresets();
    assert.deepEqual(restored, original);
    assert.equal(restored.length, 8);
    assert.equal(restored[0].template, '——{{input:过了多久？|一段时间}}后——');
    assert.equal(restored.filter(item => item.isChapter).length, 1);
    assert.ok(restored.every(item => item.autoGenerate === false));
    assert.deepEqual(validatePresetConfig(config(restored)), restored);
    assert.notEqual(restored[0], original[0]);
});

test('root values must be objects with version 1 and a presets array', () => {
    for (const invalid of [undefined, null, true, 1, 'presets', [], new Date(), {}, { presets: [] }, { version: 1 }, { version: '1', presets: [] }, { version: 2, presets: [] }, { version: 1, presets: {} }, { version: 1, presets: null }, { version: 1, presets: [], other: true }]) {
        assert.throws(() => validatePresetConfig(invalid), Error);
    }
});

test('every preset field is required, with exact string and boolean types', () => {
    const valid = preset();
    for (const field of Object.keys(valid)) {
        const missing = { ...valid };
        delete missing[field];
        assert.throws(() => validatePresetConfig(config([missing])), Error, `missing ${field}`);
        for (const wrong of [null, undefined, [], {}, 1]) {
            assert.throws(() => validatePresetConfig(config([{ ...valid, [field]: wrong }])), Error, `${field}: ${String(wrong)}`);
        }
    }
    for (const field of ['id', 'icon', 'name', 'template']) {
        assert.throws(() => validatePresetConfig(config([{ ...valid, [field]: false }])), Error);
    }
    for (const field of ['isChapter', 'autoGenerate']) {
        for (const wrong of ['true', 'false', '']) {
            assert.throws(() => validatePresetConfig(config([{ ...valid, [field]: wrong }])), Error);
        }
    }
    for (const invalid of [null, false, '', 5, [], new Date()]) {
        assert.throws(() => validatePresetConfig(config([invalid])), Error);
    }
    assert.throws(() => validatePresetConfig(config(Array(1))), Error);
    assert.throws(() => validatePresetConfig(config([preset({ other: true })])), Error);
});

test('unknown modes, empty names and empty IDs are rejected', () => {
    for (const mode of ['', 'system', 'Narrator', true]) {
        assert.throws(() => validatePresetConfig(config([preset({ mode })])), /mode/);
    }
    for (const field of ['name', 'id']) {
        for (const value of ['', ' \t\n ']) {
            assert.throws(() => validatePresetConfig(config([preset({ [field]: value })])), /empty/);
        }
    }
    assert.deepEqual(validatePresetConfig(config([preset({ icon: '', template: '' })])), [preset({ icon: '', template: '' })]);
});

test('string size limits and the preset count limit accept the boundary and reject overflow', () => {
    for (const field of ['id', 'icon', 'name', 'template']) {
        const boundary = preset({ [field]: 'x'.repeat(PRESET_LIMITS[field]) });
        assert.deepEqual(validatePresetConfig(config([boundary])), [boundary]);
        assert.throws(() => validatePresetConfig(config([preset({ [field]: 'x'.repeat(PRESET_LIMITS[field] + 1) })])), Error, field);
    }
    const maximum = Array.from({ length: PRESET_LIMITS.maxPresets }, (_, index) => preset({ id: `preset-${index}` }));
    assert.equal(validatePresetConfig(config(maximum)).length, PRESET_LIMITS.maxPresets);
    assert.throws(() => validatePresetConfig(config([...maximum, preset({ id: 'overflow' })])), /at most/);
});

test('duplicate IDs reject the complete import without changing the source', () => {
    const source = config([preset(), preset({ name: 'Duplicate' })]);
    const before = structuredClone(source);
    source.presets.forEach(Object.freeze);
    Object.freeze(source.presets);
    Object.freeze(source);
    assert.throws(() => validatePresetConfig(source), /duplicate id/);
    assert.deepEqual(source, before);
    assert.throws(() => exportPresetConfig(source.presets), /duplicate id/);
    const invalidLater = config([preset(), preset({ id: 'different', template: 3 })]);
    const invalidBefore = structuredClone(invalidLater);
    assert.throws(() => validatePresetConfig(invalidLater), /template/);
    assert.deepEqual(invalidLater, invalidBefore);
});

test('digit shortcuts follow the current order and stop at nine', () => {
    const presets = Array.from({ length: 10 }, (_, index) => preset({ id: String(index) }));
    assert.equal(presetForDigit(presets, '1'), presets[0]);
    assert.equal(presetForDigit(presets, 9), presets[8]);
    presets.unshift(presets.pop());
    assert.equal(presetForDigit(presets, '1').id, '9');
    assert.equal(presetForDigit(presets, '9').id, '7');
    for (const invalid of [0, 10, '0', '10', '01', '1.0', '-1', '', undefined]) {
        assert.equal(presetForDigit(presets, invalid), undefined);
    }
    assert.equal(presetForDigit([], 1), undefined);
});

test('slash arguments resolve 1-based positions and preserve optional text', () => {
    const presets = createDefaultPresets();
    assert.deepEqual(resolvePresetArgument(presets, '1 三天'), { preset: presets[0], text: '三天' });
    assert.deepEqual(resolvePresetArgument(presets, ' 8 '), { preset: presets[7], text: undefined });
    assert.deepEqual(resolvePresetArgument(presets, ['1', '三天']), { preset: presets[0], text: '三天' });
    assert.deepEqual(resolvePresetArgument(presets, ['1', '']), { preset: presets[0], text: '' });
    assert.deepEqual(resolvePresetArgument(presets, ['1']), { preset: presets[0], text: undefined });
    presets.reverse();
    assert.equal(resolvePresetArgument(presets, '1').preset.id, 'note');
    for (const invalid of ['', '0', '9', '999999999999999999999', 'Missing', null, undefined, {}, [], ['1', {}], [{}, 'text'], ['1', 'text', 'extra']]) {
        assert.equal(resolvePresetArgument(presets, invalid), null);
    }
});

test('slash names match exact case first, then case-insensitively, using longest prefixes', () => {
    const presets = [preset({ id: 'lower', name: 'scene' }), preset({ id: 'upper', name: 'Scene' }), preset({ id: 'long', name: 'Scene change' })];
    assert.equal(resolvePresetArgument(presets, 'Scene').preset.id, 'upper');
    assert.equal(resolvePresetArgument(presets, 'SCENE').preset.id, 'lower');
    assert.deepEqual(resolvePresetArgument(presets, 'Scene change 河边'), { preset: presets[2], text: '河边' });
    assert.deepEqual(resolvePresetArgument(presets, 'SCENE CHANGE 河边'), { preset: presets[2], text: '河边' });
    assert.deepEqual(resolvePresetArgument(presets, ['Scene change', '河边']), { preset: presets[2], text: '河边' });
    assert.equal(resolvePresetArgument(presets, 'Scenery'), null);
    const multiword = [preset({ name: 'A long name' })];
    assert.deepEqual(resolvePresetArgument(multiword, ['A', 'long name text']), { preset: multiword[0], text: 'text' });
    const padded = [preset({ name: ' Scene ' })];
    assert.deepEqual(resolvePresetArgument(padded, [' Scene ', 'text']), { preset: padded[0], text: 'text' });
    assert.equal(resolvePresetArgument([preset({ name: '2' })], '2'), null, 'numeric-looking names use position semantics');
});

test('provided slash text fills the first input and uses later defaults without a dialog', async () => {
    let calls = 0;
    const template = '{{input:First|default}} / {{input:Later|value}} / [{{input:Empty|}}]';
    const values = await collectPresetInputs(template, 'first text', () => { calls++; return []; });
    assert.deepEqual(values, ['first text', 'value', '']);
    assert.equal(calls, 0);
    assert.equal(await renderDirectorTemplate(template, { collectInputs: () => values }), 'first text / value / []');
    const timeSkip = createDefaultPresets()[0].template;
    assert.equal(await renderDirectorTemplate(timeSkip, {
        collectInputs: () => collectPresetInputs(timeSkip, '三天', () => { throw new Error('unexpected dialog'); }),
    }), '——三天后——');
});

test('slash inputs ask only remaining fields without defaults and retain complete value order', async () => {
    const template = '{{input:First}} {{input:Default|keep}} {{input:Ask}} {{input:Empty|}} {{input:Ask again}}';
    const values = await collectPresetInputs(template, 'title', inputs => {
        assert.deepEqual(inputs, [{ prompt: 'Ask', defaultValue: '' }, { prompt: 'Ask again', defaultValue: '' }]);
        return ['answer', ''];
    });
    assert.deepEqual(values, ['title', 'keep', 'answer', '', '']);
    assert.equal(await collectPresetInputs(template, 'title', () => null), null);
    assert.deepEqual(await collectPresetInputs('{{input:First}}', '', () => { throw new Error('unexpected dialog'); }), ['']);
});

test('ordinary presets still collect all inputs and templates without inputs never ask', async () => {
    assert.deepEqual(await collectPresetInputs('{{input:First|default}} {{input:Second}}', undefined, inputs => {
        assert.deepEqual(inputs, [{ prompt: 'First', defaultValue: 'default' }, { prompt: 'Second', defaultValue: '' }]);
        return ['changed', 'second'];
    }), ['changed', 'second']);
    assert.equal(await collectPresetInputs('{{input:First}}', undefined, () => null), null);
    assert.deepEqual(await collectPresetInputs('No inputs', 'unused', () => { throw new Error('unexpected dialog'); }), []);
});
