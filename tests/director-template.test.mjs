import assert from 'node:assert/strict';
import test from 'node:test';
import { countChapters, parseInputs, renderDirectorTemplate } from '../public/scripts/extensions/director/template.js';

test('all inputs are collected once in template order, with Chinese punctuation and defaults', async () => {
    const template = '{{input:过了多久？|一段时间}}后，{{input:新的地点}}：{{input:事件|风|雨}}';
    const expectedInputs = [
        { prompt: '过了多久？', defaultValue: '一段时间' },
        { prompt: '新的地点', defaultValue: '' },
        { prompt: '事件', defaultValue: '风|雨' },
    ];
    assert.deepEqual(parseInputs(template), expectedInputs);
    let calls = 0;
    const rendered = await renderDirectorTemplate(template, {
        collectInputs: async inputs => {
            calls++;
            assert.deepEqual(inputs, expectedInputs);
            return ['三天', '河畔', '下雨了'];
        },
    });
    assert.equal(calls, 1);
    assert.equal(rendered, '三天后，河畔：下雨了');
});

test('prefilled defaults and explicit empty values, including fields with no default, are preserved', async () => {
    assert.equal(await renderDirectorTemplate('——{{input:过了多久？|一段时间}}后——', {
        collectInputs: inputs => inputs.map(input => input.defaultValue),
    }), '——一段时间后——');
    assert.equal(await renderDirectorTemplate('[{{input:地点}}]/[{{input:时间|明天}}]', {
        collectInputs: () => ['', ''],
    }), '[]/[]');
    assert.equal(await renderDirectorTemplate('{{input:时间|一段时间}}', {
        collectInputs: () => [],
    }), '一段时间');
});

test('cancelling returns null without expanding macros or producing insertion text', async () => {
    let macroCalls = 0;
    const result = await renderDirectorTemplate('{{char}}：{{input:内容}}，{{input:地点}}', {
        collectInputs: async () => null,
        substituteParams: text => { macroCalls++; return text; },
    });
    assert.equal(result, null);
    assert.equal(macroCalls, 0);
});

test('chapter counts are derived live, including after deleting a middle chapter', async () => {
    const chapter = title => ({ extra: { director: { chapter: { title } } } });
    const chat = [chapter('开端'), { mes: '普通消息' }, chapter('途中'), chapter('抵达'), { extra: { director: { preset: 'note' } } }];
    assert.equal(countChapters(chat), 3);
    assert.equal(await renderDirectorTemplate('第{{chapter}}章', { chat }), '第4章');
    chat.splice(2, 1);
    assert.equal(countChapters(chat), 2);
    assert.equal(await renderDirectorTemplate('第{{chapter}}章', { chat }), '第3章');
    assert.equal(countChapters([]), 0);
    assert.equal(await renderDirectorTemplate('第{{chapter}}章'), '第1章');
});

test('chapter counting observes chat changes while the input dialog is open', async () => {
    const chat = [];
    const result = await renderDirectorTemplate('第{{chapter}}章 {{input:标题}}', {
        chat,
        collectInputs: async () => {
            chat.push({ extra: { director: { chapter: { title: '之前的章节' } } } });
            return ['新的章节'];
        },
    });
    assert.equal(result, '第2章 新的章节');
});

test('standard macros expand once after inputs and chapter tokens have been resolved', async () => {
    const seen = [];
    const result = await renderDirectorTemplate('{{char}}对{{user}}：第{{chapter}}章 {{input:标题}}', {
        collectInputs: () => ['{{char}}回来了'],
        substituteParams: text => {
            seen.push(text);
            return text.replaceAll('{{char}}', '角色').replaceAll('{{user}}', '用户');
        },
    });
    assert.deepEqual(seen, ['{{char}}对{{user}}：第1章 {{char}}回来了']);
    assert.equal(result, '角色对用户：第1章 角色回来了');
});

test('Director tokens entered as input stay literal and replacement strings retain dollar signs', async () => {
    const result = await renderDirectorTemplate('{{input:内容}} / {{chapter}}', {
        collectInputs: () => ['{{chapter}} {{input:另一个}} $& $1'],
    });
    assert.equal(result, '{{chapter}} {{input:另一个}} $& $1 / 1');
});

test('templates without inputs do not open a dialog and still expand standard macros', async () => {
    let inputCalls = 0;
    const result = await renderDirectorTemplate('{{user}}继续前进。', {
        collectInputs: () => { inputCalls++; return []; },
        substituteParams: text => text.replaceAll('{{user}}', '用户'),
    });
    assert.equal(inputCalls, 0);
    assert.equal(result, '用户继续前进。');
    assert.equal(await renderDirectorTemplate(''), '');
    assert.equal(await renderDirectorTemplate('固定旁白。'), '固定旁白。');
});
