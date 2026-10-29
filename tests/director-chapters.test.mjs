import assert from 'node:assert/strict';
import test from 'node:test';
import {
    chapterLabel,
    chapterTitleFromValues,
    listChapters,
    loadConfirmMessage,
    markChapter,
    messagesBeforeLoadedRange,
    needsLoadConfirm,
    prefillChapterTitle,
    unmarkChapter,
} from '../public/scripts/extensions/director/chapters.js';
import { countChapters, renderDirectorTemplate } from '../public/scripts/extensions/director/template.js';

test('chapter titles use the first input and never a stored number', () => {
    assert.equal(chapterTitleFromValues(['河岸夜话', '被忽略的正文'], '新章节'), '河岸夜话');
    assert.equal(chapterTitleFromValues([''], '新章节'), '');
    assert.equal(chapterTitleFromValues([], '新章节'), '新章节');
    assert.equal(chapterTitleFromValues(undefined, '新章节'), '新章节');
    const message = { mes: '第4章　不应被存成标题', extra: {} };
    const director = markChapter(message, chapterTitleFromValues(['河岸夜话']), '11111111-1111-4111-8111-111111111111');
    assert.deepEqual(director, {
        id: '11111111-1111-4111-8111-111111111111',
        preset: 'chapter',
        chapter: { title: '河岸夜话' },
    });
    assert.equal('number' in director, false);
    assert.equal('number' in director.chapter, false);
});

test('live numbering survives deleting a middle chapter and does not renumber stored data', () => {
    const chapter = title => ({ extra: { director: { id: title, preset: 'chapter', chapter: { title } } } });
    const chat = [chapter('开端'), { mes: '普通' }, chapter('途中'), chapter('抵达')];
    assert.deepEqual(listChapters(chat).map(item => item.number + ':' + item.title), ['1:开端', '2:途中', '3:抵达']);
    assert.equal(countChapters(chat), 3);
    chat.splice(2, 1);
    assert.deepEqual(listChapters(chat).map(item => [item.index, item.number, item.title]), [[0, 1, '开端'], [2, 2, '抵达']]);
    assert.equal(chat[2].extra.director.chapter.title, '抵达');
    assert.equal(chat[2].extra.director.number, undefined);
    assert.equal(chapterLabel(2, '抵达'), '第2章 抵达');
});

test('mark and unmark keep foreign director metadata and drop an empty chapter shell', () => {
    const plain = { mes: '第一行\n第二行', extra: {} };
    assert.equal(prefillChapterTitle(plain), '第一行');
    markChapter(plain, '第一行', '22222222-2222-4222-8222-222222222222');
    assert.equal(unmarkChapter(plain), true);
    assert.equal(plain.extra.director, undefined);
    assert.deepEqual(plain.extra, {});

    const noted = { extra: { director: { id: 'keep-me', preset: 'time-skip', api: 'manual' } } };
    markChapter(noted, '插入的章节', 'ignored-because-id-exists');
    assert.equal(noted.extra.director.preset, 'time-skip');
    assert.equal(noted.extra.director.id, 'keep-me');
    assert.deepEqual(noted.extra.director.chapter, { title: '插入的章节' });
    unmarkChapter(noted);
    assert.deepEqual(noted.extra.director, { id: 'keep-me', preset: 'time-skip', api: 'manual' });
    assert.equal(unmarkChapter(noted), false);
});

test('loading confirm starts only past 500 messages and names the exact gap', () => {
    assert.equal(messagesBeforeLoadedRange(1900, 0), 1900);
    assert.equal(needsLoadConfirm(1900), true);
    assert.equal(loadConfirmMessage(1900), '需要加载约 1900 条消息');
    assert.equal(messagesBeforeLoadedRange(1900, 1400), 500);
    assert.equal(needsLoadConfirm(500), false);
    assert.equal(needsLoadConfirm(501), true);
    assert.equal(messagesBeforeLoadedRange(1900, 1990), 0);
    assert.equal(messagesBeforeLoadedRange(Number.NaN, 0), 0);
});

test('template chapter counts use the same title rule after a middle deletion', async () => {
    const chat = [
        { extra: { director: { chapter: { title: '开端' } } } },
        { extra: { director: { chapter: {} } } },
        { extra: { director: { chapter: { title: '抵达' } } } },
    ];
    assert.equal(countChapters(chat), 2);
    assert.equal(await renderDirectorTemplate('第{{chapter}}章', { chat }), '第3章');
    chat.splice(0, 1);
    assert.equal(await renderDirectorTemplate('第{{chapter}}章', { chat }), '第2章');
});
