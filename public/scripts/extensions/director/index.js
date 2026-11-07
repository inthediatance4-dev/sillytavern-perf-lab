import { Popper } from '../../../lib.js';
import { activateSendButtons, deactivateSendButtons, doNavbarIconClick, is_send_press, isGenerating, setSendButtonState, showMoreMessages } from '../../../script.js';
import { extension_settings, getContext as nativeGetContext, renderExtensionTemplateAsync } from '../../extensions.js';
import { hasPendingFileAttachment } from '../../chats.js';
import { POPUP_RESULT, POPUP_TYPE, Popup } from '../../popup.js';
import { uuidv4 } from '../../utils.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../slash-commands/SlashCommandArgument.js';
import { SlashCommandEnumValue } from '../../slash-commands/SlashCommandEnumValue.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import {
    chapterLabel,
    chapterTitleFromValues,
    listChapters,
    loadConfirmMessage,
    markChapter,
    messagesBeforeLoadedRange,
    needsLoadConfirm,
    prefillChapterTitle,
    syncChapterToSwipes,
    unmarkChapter,
} from './chapters.js';
import { initPresetManager } from './manager.js';
import { createFateController } from './fate.js';
import { createFatePanel } from './fate-ui.js';
import { createFateSound } from './fate-sound.js';
import { createFateMarks } from './fate-marks.js';
import {
    activeInstruct,
    applyBoundReinject,
    applyCommittedMessageClear,
    applyDeletionClear,
    applyUserSentClear,
    cancelPendingInstruct,
    clearTemporaryInstruct,
    discardDirectorPromptMask,
    initInstructLifecycle,
    instructStatusText,
    maskDirectorPrompts,
    matchesRegenerateDelete,
    readBoundInstruct,
    restoreDirectorPrompts,
    shieldDirectorPromptValues,
} from './instruct.js';
import { createDefaultPresets, presetForDigit, resolvePresetArgument } from './presets.js';
import { collectPresetInputs, containsExpandableMacro, renderDirectorTemplate } from './template.js';
import { createPluginRuntime } from '../../plugin-runtime/runtime.js';

let runtime;
const getContext = () => runtime ? runtime.getContext() : nativeGetContext();

const PRESET_MODE_LABELS = { narrator: '写入正文', comment: '只留给自己', instruct: '嘱咐下一笔' };

let button;
let popover;
let popper;
let instructChip;
let fatePanel;
let executing = false;
let chatRevision = 0;
/** One regenerate's pre-interceptor delete. Not a sticky boolean. */
let boundDeleteSkip = null;
function clearBoundDeleteSkip() {
    boundDeleteSkip = null;
}

/**
 * Arm the skip only for this chat's current binding. The next generation,
 * a chat switch, or generation end/stop drops it if the delete never came.
 * @param {string} generationType
 * @param {boolean} dryRun
 */
function armBoundDeleteSkip(generationType, dryRun) {
    if (dryRun) return;
    clearBoundDeleteSkip();
    if (generationType !== 'regenerate') return;
    const context = getContext();
    const binding = readBoundInstruct(context.chatMetadata);
    if (!binding) return;
    // The native regenerate button already sets this before Generate. Direct
    // extension calls do not, so mirror that public entry point for a binding.
    // Generate's preflight exits/unblockGeneration reset it on failure/abort.
    setSendButtonState(true);
    boundDeleteSkip = {
        chatId: context.chatId,
        metadata: context.chatMetadata,
        slotIndex: binding.slotIndex,
    };
}

function closePopover(restoreFocus = false) {
    popover.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
}

function isTyping(target) {
    return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

function matchesHotkey(event) {
    const parts = extension_settings.director.hotkey.toLowerCase().split('+').map(part => part.trim());
    const key = parts.pop();
    return key && key === event.key.toLowerCase()
        && event.ctrlKey === parts.includes('ctrl')
        && event.altKey === parts.includes('alt')
        && event.shiftKey === parts.includes('shift')
        && event.metaKey === parts.includes('meta')
        && parts.every(part => ['ctrl', 'alt', 'shift', 'meta'].includes(part));
}

function refreshInstructChip() {
    if (!instructChip) return;
    const active = activeInstruct(getContext().chatMetadata);
    const label = instructChip.querySelector('.director_instruct_text');
    if (!active) {
        instructChip.hidden = true;
        instructChip.removeAttribute('data-state');
        instructChip.removeAttribute('title');
        instructChip.removeAttribute('aria-label');
        if (label) label.textContent = '';
        return;
    }
    instructChip.hidden = false;
    instructChip.dataset.state = active.state;
    instructChip.title = active.text;
    const status = active.state === 'pending' ? '待落笔' : '重写沿用';
    instructChip.setAttribute('aria-label', `${status}：${active.text}`);
    if (label) label.textContent = instructStatusText(active.state, active.text);
}

async function clearDisplayedInstruct(active) {
    const context = getContext();
    const current = activeInstruct(context.chatMetadata);
    if (!current || current.state !== active.state || current.id !== active.id || current.text !== active.text) {
        refreshInstructChip();
        return;
    }
    const changed = current.state === 'pending'
        ? cancelPendingInstruct(context, current.id)
        : applyUserSentClear(context.chatMetadata);
    // Update the chip before the save so the click handler's synchronous prefix is visible.
    refreshInstructChip();
    if (changed) await context.saveMetadata();
}

async function dismissInstructChip() {
    const active = activeInstruct(getContext().chatMetadata);
    if (active) await clearDisplayedInstruct(active);
}

async function showInstructPopup() {
    const active = activeInstruct(getContext().chatMetadata);
    if (!active) return;
    const body = document.createElement('div');
    body.className = 'director_instruct_full';
    body.textContent = active.text;
    const popup = new Popup(body, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: '关闭',
        customButtons: [{ text: '清除', result: POPUP_RESULT.CUSTOM1 }],
    });
    const result = await popup.show();
    if (result === POPUP_RESULT.CUSTOM1) await clearDisplayedInstruct(active);
}

function createInstructChip() {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.id = 'director_instruct_chip';
    chip.hidden = true;
    const label = document.createElement('span');
    label.className = 'director_instruct_text';
    const dismiss = document.createElement('span');
    dismiss.className = 'director_instruct_dismiss';
    dismiss.textContent = ' ✕';
    dismiss.setAttribute('aria-hidden', 'true');
    chip.append(label, dismiss);
    chip.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        const dismissClick = target instanceof Element && target.closest('.director_instruct_dismiss');
        if (dismissClick) {
            event.preventDefault();
            event.stopPropagation();
            dismissInstructChip().catch(error => console.error('Director instruct dismiss failed', error));
            return;
        }
        showInstructPopup().catch(error => console.error('Director instruct popup failed', error));
    });
    return chip;
}

function isCurrentChat(context, revision) {
    const current = getContext();
    return chatRevision === revision && current.chatId === context.chatId
        && current.characterId === context.characterId && current.groupId === context.groupId;
}

async function collectInputs(inputs, name) {
    const heading = document.createElement('h3');
    heading.textContent = name;
    const popup = new Popup(heading, POPUP_TYPE.CONFIRM, '', {
        okButton: '插入',
        cancelButton: '取消',
        customInputs: inputs.map((input, index) => ({
            id: `director-input-${index}`,
            label: input.prompt,
            defaultState: input.defaultValue,
            type: 'text',
            autoFocus: index === 0,
        })),
    });
    const result = await popup.show();
    return result === POPUP_RESULT.AFFIRMATIVE
        ? inputs.map((_, index) => String(popup.inputResults.get(`director-input-${index}`)))
        : null;
}

/**
 * /sys and /comment run substituteParams, then emit MESSAGE_SENT, then render
 * and save. Literals were already expanded. Restore during that event so the
 * upstream save stores the rendered text. Macro-free text is left untouched,
 * which keeps the saved message identical to the slash command.
 * @param {'narrator'|'comment'} mode
 * @param {string} text Rendered template
 */
async function insertLiteralMessage(mode, text) {
    const context = getContext();
    const insertAt = context.chat.length;
    const literal = String(text ?? '').trim();
    const restore = messageId => {
        if (messageId !== insertAt) return;
        const message = getContext().chat[messageId];
        if (!message || message.mes === literal || !containsExpandableMacro(literal)) return;
        message.mes = literal;
    };
    context.eventSource.on(context.eventTypes.MESSAGE_SENT, restore);
    try {
        const commands = context.SlashCommandParser.commands;
        const command = mode === 'comment' ? commands.comment : commands.sys;
        await command.callback({}, text);
    } finally {
        context.eventSource.removeListener(context.eventTypes.MESSAGE_SENT, restore);
    }
}

async function usePreset(preset, inputText) {
    if (executing) return;
    preset = { ...preset };
    const context = getContext();
    const revision = chatRevision;
    if (!context.groupId && context.characterId === undefined) {
        toastr.warning('请先选择聊天。');
        return;
    }

    executing = true;
    button?.setAttribute('data-director-busy', 'true');
    closePopover(true);
    try {
        let values = [];
        const text = await renderDirectorTemplate(preset.template, {
            chat: context.chat,
            substituteParams: context.substituteParams,
            collectInputs: async () => {
                values = await collectPresetInputs(preset.template, inputText, pending => collectInputs(pending, preset.name));
                return values;
            },
        });
        if (text === null) return;
        if (!isCurrentChat(context, revision)) {
            toastr.warning('聊天已切换，请重新选择预设。');
            return;
        }

        const id = uuidv4();
        // Use the registered upstream callbacks (as connection-manager does), so
        // input containing pipes or named-argument syntax remains literal text.
        const commands = context.SlashCommandParser.commands;
        if (preset.mode === 'instruct') {
            const injectId = `director-${id}`;
            await commands.inject.callback({ id: injectId, ephemeral: 'false', position: 'chat', depth: '0', role: 'system', scan: 'false' }, text);
            if (context.chatMetadata.script_injects[injectId]) {
                context.chatMetadata.script_injects[injectId].directorEphemeral = true;
                context.saveMetadataDebounced();
                refreshInstructChip();
            }
        } else {
            const metadata = { id, preset: preset.isChapter ? 'chapter' : preset.id };
            if (preset.isChapter) {
                // Title rule: the first {{input}} value (默认预设的「章节标题」).
                // Do not store the expanded 第N章 text or a chapter number.
                metadata.chapter = { title: chapterTitleFromValues(values, preset.name) };
            }
            await runtime.ensureStart(true);
            if (!isCurrentChat(context, revision)) return;
            const index = context.chat.length;
            const attachMetadata = messageId => {
                if (messageId === index && context.chat[index]) {
                    context.chat[index].extra.director = metadata;
                    if (preset.isChapter) syncChapterToSwipes(context.chat[index]);
                }
            };
            // MESSAGE_SENT runs before rendering and the command's JSONL save.
            context.eventSource.makeFirst(context.eventTypes.MESSAGE_SENT, attachMetadata);
            try {
                await insertLiteralMessage(preset.mode === 'comment' ? 'comment' : 'narrator', text);
            } finally {
                context.eventSource.removeListener(context.eventTypes.MESSAGE_SENT, attachMetadata);
            }
        }
        if (preset.autoGenerate && isCurrentChat(context, revision)) {
            // /trigger uses Generate's group-aware path and waits for its lock.
            await commands.trigger.callback({ await: 'true' }, '');
        }
    } catch (error) {
        console.error('Director preset failed', error);
        toastr.error('无法用上这则命运之牌预设。');
    } finally {
        executing = false;
        button?.removeAttribute('data-director-busy');
    }
}

async function openSettings() {
    closePopover();
    if (!$('#rm_extensions_block').hasClass('openDrawer')) {
        await doNavbarIconClick.call(document.querySelector('#extensions-settings-button .drawer-toggle'));
    }
    if (!$('#director_settings .inline-drawer-content').is(':visible')) {
        $('#director_settings .inline-drawer-toggle').trigger('click');
    }
    await $('#director_settings .inline-drawer-content').promise();
    document.getElementById('director_settings').scrollIntoView({ block: 'center' });
    document.getElementById('director_hotkey').focus({ preventScroll: true });
}

let highlightToken = 0;

function createChapterMenuItem() {
    const item = document.createElement('div');
    item.title = '设为章节起点';
    item.className = 'mes_button mes_director_chapter';
    item.textContent = '设为章节起点';
    return item;
}

function ensureChapterMenu(root = document) {
    for (const container of root.querySelectorAll('.extraMesButtons')) {
        if (!container.querySelector(':scope > .mes_director_chapter')) container.append(createChapterMenuItem());
    }
}

function clearChapterElement(mes) {
    mes.classList.remove('director-chapter');
    mes.removeAttribute('data-director-chapter');
    mes.querySelector(':scope > .mes_block > .director-chapter-divider')?.remove();
}

function paintChapterElement(mes, label) {
    mes.classList.add('director-chapter');
    if (mes.getAttribute('data-director-chapter') !== label) mes.setAttribute('data-director-chapter', label);
    const block = mes.querySelector(':scope > .mes_block');
    if (!block) return;
    let divider = block.querySelector(':scope > .director-chapter-divider');
    if (!divider) {
        divider = document.createElement('div');
        divider.className = 'director-chapter-divider';
        block.prepend(divider);
    }
    if (divider.textContent !== label) divider.textContent = label;
}

/** Class and divider only. .mes_text is left untouched. DOM work stays on loaded chapter nodes. */
function applyChapterDividers() {
    const chat = getContext().chat;
    if (!Array.isArray(chat)) return;
    const labels = new Map();
    let number = 0;
    for (let index = 0; index < chat.length; index++) {
        const title = chat[index]?.extra?.director?.chapter?.title;
        if (typeof title !== 'string') continue;
        labels.set(index, chapterLabel(++number, title));
    }
    const chatRoot = document.getElementById('chat');
    if (!chatRoot) return;
    for (const mes of chatRoot.querySelectorAll('.mes.director-chapter')) {
        if (!labels.has(Number(mes.getAttribute('mesid')))) clearChapterElement(mes);
    }
    for (const [index, label] of labels) {
        const mes = chatRoot.querySelector(`.mes[mesid="${index}"]`);
        if (mes instanceof HTMLElement) paintChapterElement(mes, label);
    }
}

function loadedMessageRange() {
    const nodes = document.querySelectorAll('#chat .mes');
    if (!nodes.length) return null;
    const first = Number(nodes[0].getAttribute('mesid'));
    return Number.isInteger(first) ? first : null;
}

async function jumpToMessage(index, highlightClass = 'director-fate-highlight', beforeScroll = () => {}, { warnMissing = false } = {}) {
    closePopover();
    const context = getContext();
    const revision = chatRevision;
    if (!Number.isInteger(index) || index < 0 || index >= context.chat.length) return false;
    const distance = messagesBeforeLoadedRange(loadedMessageRange() ?? index, index);
    if (needsLoadConfirm(distance)) {
        const result = await context.callGenericPopup(loadConfirmMessage(distance), POPUP_TYPE.CONFIRM, '', {
            okButton: '加载',
            cancelButton: '取消',
        });
        if (result !== POPUP_RESULT.AFFIRMATIVE || !isCurrentChat(context, revision)) return false;
    }
    let guard = 0;
    while (!document.querySelector(`#chat .mes[mesid="${index}"]`) && guard++ < 10000) {
        const first = loadedMessageRange();
        if (first === null || first <= index) break;
        const before = first;
        await showMoreMessages(before - index);
        if (!isCurrentChat(context, revision)) return false;
        const after = loadedMessageRange();
        if (after === null || after >= before) break;
    }
    const mes = document.querySelector(`#chat .mes[mesid="${index}"]`);
    if (!(mes instanceof HTMLElement)) {
        if (warnMissing) toastr.warning('该消息未加载，请向上滚动');
        return false;
    }
    await beforeScroll();
    if (!isCurrentChat(context, revision)) return false;
    mes.scrollIntoView({ block: 'center', inline: 'nearest' });
    mes.classList.add(highlightClass);
    const token = ++highlightToken;
    // Moved from jumpToChapter: its existing timer also works when reduced motion suppresses animation events.
    setTimeout(() => {
        if (highlightToken === token) mes.classList.remove(highlightClass);
    }, 1500);
    return true;
}

async function jumpToChapter(index) {
    // Chapters keep their divider refresh and visual treatment. Fate jumps do
    // not enter this pre-existing full-chat chapter rendering path.
    return jumpToMessage(index, 'director-chapter-highlight', applyChapterDividers);
}

function showChapterList() {
    popover.replaceChildren();
    popover.dataset.view = 'chapters';
    const chapters = listChapters(getContext().chat);
    if (!chapters.length) {
        const empty = document.createElement('p');
        empty.className = 'director_empty';
        empty.textContent = '还没有章节';
        popover.append(empty);
    }
    for (const chapter of chapters) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'director_chapter_jump';
        item.dataset.mesid = String(chapter.index);
        item.textContent = chapterLabel(chapter.number, chapter.title);
        item.addEventListener('click', () => jumpToChapter(chapter.index));
        popover.append(item);
    }
    popper.update();
    popover.focus();
}

async function toggleChapterMark(messageId) {
    const context = getContext();
    const revision = chatRevision;
    const message = context.chat[messageId];
    if (!message) return;
    try {
        if (message.extra?.director?.chapter) {
            if (!isCurrentChat(context, revision)) return;
            unmarkChapter(message);
        } else {
            const title = await Popup.show.input('设为章节起点', '标题显示在分隔线上。章节序号按聊天顺序现算，不会保存。', prefillChapterTitle(message), {
                okButton: '确定',
                cancelButton: '取消',
            });
            if (title === null) return;
            const trimmed = String(title).trim();
            if (!trimmed) return;
            if (!isCurrentChat(context, revision)) {
                toastr.warning('聊天已切换，未修改章节。');
                return;
            }
            const current = getContext().chat[messageId];
            if (!current) return;
            markChapter(current, trimmed, uuidv4());
        }
        applyChapterDividers();
        await getContext().saveChat();
    } catch (error) {
        console.error('Director chapter update failed', error);
        toastr.error('无法更新章节。');
    }
}

function togglePopover() {
    if (!popover.hidden) {
        closePopover(true);
        return;
    }
    if (executing) return;
    popover.replaceChildren();
    popover.dataset.view = 'presets';
    extension_settings.director.presets.forEach((preset, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.dataset.presetId = preset.id;
        const icon = document.createElement('span');
        icon.textContent = preset.icon;
        const name = document.createElement('span');
        name.textContent = preset.name;
        item.append(icon, name);
        if (index < 9) {
            const digit = document.createElement('kbd');
            digit.textContent = String(index + 1);
            item.append(digit);
        }
        item.addEventListener('click', () => usePreset(preset));
        popover.append(item);
    });
    const footer = document.createElement('div');
    footer.className = 'director_footer';
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.textContent = '⚙ 管理预设';
    manage.addEventListener('click', openSettings);
    const chapters = document.createElement('button');
    chapters.type = 'button';
    chapters.textContent = '📖 章节';
    chapters.title = '章节列表';
    chapters.addEventListener('click', showChapterList);
    const fate = document.createElement('button');
    fate.type = 'button';
    fate.id = 'director_fate_open';
    fate.textContent = '🎴 命运牌';
    fate.addEventListener('click', () => {
        closePopover();
        fatePanel.open().catch(() => toastr.error('无法打开命运牌。'));
    });
    footer.append(manage, chapters, fate);
    popover.append(footer);
    popover.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    popper.update();
    popover.focus();
}

export async function init() {
    if (document.getElementById('directorButton')) return;
    runtime = await createPluginRuntime(import.meta.url, 'director');
    if (extension_settings.disabledExtensions.includes(runtime.extensionId)) return;
    await runtime.ensureStart();
    const settings = extension_settings.director ??= {};
    let seeded = false;
    if (!Array.isArray(settings.presets)) {
        settings.presets = createDefaultPresets();
        seeded = true;
    }
    if (typeof settings.hotkey !== 'string') {
        settings.hotkey = '';
        seeded = true;
    }
    if (settings.version === undefined) {
        settings.version = 1;
        seeded = true;
    }
    if (!settings.fate || typeof settings.fate !== 'object' || Array.isArray(settings.fate)) {
        settings.fate = { reveal: 'tap', sound: false, motion: 'system' };
        seeded = true;
    }
    for (const [key, fallback, valid] of [
        ['reveal', 'tap', ['tap', 'auto', 'off']],
        ['sound', false, [true, false]],
        ['motion', 'system', ['system', 'off']],
    ]) {
        if (!valid.includes(settings.fate[key])) {
            settings.fate[key] = fallback;
            seeded = true;
        }
    }
    const context = getContext();
    const hasDraft = () => !!String(document.getElementById('send_textarea')?.value ?? '').trim() || hasPendingFileAttachment();
    let fateMarks;
    const fate = createFateController(getContext, {
        isGenerating, hasDraft, setSendButtonState, deactivateSendButtons, activateSendButtons, uuid:uuidv4, random:Math.random,
        generate: current => current.generate('normal'),
        save: (_current, shouldSave) => getContext().saveChat({ shouldSave }),
        onRegenerateStart: () => setSendButtonState(true),
        onError: message => toastr.warning(message),
        onChange: () => {
            fateMarks?.invalidate();
            // clearLog has no message-render event; remove its old marks now.
            fateMarks?.paintAll();
            fatePanel?.refresh();
        },
        onReveal: card => {
            toastr.info(`🎴 命运已降临：〈${card.title}〉`, '', {
                escapeHtml: true,
                onclick: () => fatePanel.open({ focusReveal: true }).catch(() => toastr.error('无法打开命运牌。')),
            });
            // Completion publishes its in-memory log before the save resolves
            // and before onChange can invalidate the previous slot cache.
            fateMarks.invalidate();
            queueMicrotask(() => {
                fateMarks.paintOne(card.slotIndex);
                fateMarks.pulse(card.id);
            });
        },
    });
    fateMarks = createFateMarks({
        getContext, getEntries: fate.log,
        onOpen: entryId => fatePanel.open({ tab: 'log', entryId }).catch(() => toastr.error('无法打开命运牌。')),
    });
    document.documentElement.classList.toggle('director_fate_nomotion', settings.fate.motion === 'off');
    fatePanel = createFatePanel(fate, {
        Popup, POPUP_TYPE, POPUP_RESULT, hasDraft, jumpToMessage, warn: message => toastr.warning(message),
        settings: settings.fate, sound: createFateSound(() => settings.fate.sound),
        saveSettings: () => getContext().saveSettingsDebounced(),
        restoreFocus: () => {
            if (popover.hidden) togglePopover();
            document.getElementById('director_fate_open')?.focus();
        },
    });
    initInstructLifecycle(getContext, refreshInstructChip);
    // The interceptor argument is a filtered copy. Swipe pops the target from
    // that copy before this runs, so reinject reads getContext().chat instead.
    globalThis[runtime.interceptorKey] = async function director_rebind_interceptor(requestChat, _contextSize, abort, type) {
        if (!runtime.claim(requestChat)) return;
        clearBoundDeleteSkip();
        try {
            runtime.prepare(type, requestChat);
            const current = getContext();
            // Quiet and impersonate must not send or consume a pending instruct,
            // and they must not copy boundInstruct back into the prompt.
            if (type === 'quiet' || type === 'impersonate') {
                fate.prepare(type, requestChat);
                clearTemporaryInstruct(current);
                maskDirectorPrompts(current);
                return;
            }
            // Stop arrived before this attempt was claimed. abort(true) makes
            // Generate call unblockGeneration and return before the provider request.
            if (fate.prepare(type, requestChat) === 'abort') {
                abort(true);
                return;
            }
            const result = applyBoundReinject(current, type);
            // Pending prompts were shielded at generation start. Bound text is
            // copied into the extension prompt here, so shield it before assembly.
            shieldDirectorPromptValues(current);
            if (result.cleared) {
                refreshInstructChip();
                await current.saveMetadata();
            }
        } catch (error) {
            console.error('Director rebind interceptor failed', error);
            abort(true);
        } finally {
            try { await runtime.seal(requestChat); } catch { abort(true); }
        }
    };
    if (seeded) context.saveSettingsDebounced();
    $('#extensions_settings').append(await renderExtensionTemplateAsync(runtime.extensionId, 'settings'));
    $('#director_hotkey').val(settings.hotkey).on('input', function () {
        settings.hotkey = String($(this).val()).trim();
        context.saveSettingsDebounced();
    });
    initPresetManager();
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'director',
        splitUnnamedArgument: true,
        splitUnnamedArgumentCount: 1,
        callback: async (_, value) => {
            const resolved = resolvePresetArgument(settings.presets, value);
            if (resolved) await usePreset(resolved.preset, resolved.text);
            else toastr.error('找不到命运之牌的预设，请用名称，或从 1 开始的序号。');
            return '';
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: '预设名称或序号（从 1 开始；含空格的名称请加引号）',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: () => settings.presets.map(preset => new SlashCommandEnumValue(preset.name, PRESET_MODE_LABELS[preset.mode] ?? preset.mode)),
            }),
            SlashCommandArgument.fromProps({ description: '填入第一个输入框的文字', typeList: [ARGUMENT_TYPE.STRING] }),
        ],
        helpString: '<p>用一则命运之牌预设，也可放进快速回复。例如：<code>/director 1 三天</code> 会插入「——三天后——」。文字填进第一个输入框，其余用默认值；没有默认值的会再问你。名称先按原文匹配，再忽略大小写。纯数字始终是从 1 开始的序号；名称里有空格时请加引号。</p>',
        returns: '空字符串',
    }));

    button = document.createElement('div');
    button.id = 'directorButton';
    button.className = 'interactable';
    button.textContent = '🎬';
    button.title = '命运之牌';
    button.tabIndex = 0;
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', '命运之牌');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'directorPopover');
    button.setAttribute('aria-expanded', 'false');
    document.getElementById('extensionsMenuButton').after(button);
    instructChip = createInstructChip();
    button.after(instructChip);

    popover = document.createElement('div');
    popover.id = 'directorPopover';
    popover.hidden = true;
    popover.tabIndex = -1;
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', '命运之牌预设');
    document.body.append(popover);
    popper = Popper.createPopper(button, popover, { placement: 'top-start', modifiers: [{ name: 'offset', options: { offset: [0, 8] } }] });
    button.addEventListener('click', togglePopover);
    button.addEventListener('keydown', event => {
        if (event.key === ' ') {
            event.preventDefault();
            togglePopover();
        }
    });
    popover.addEventListener('keydown', event => {
        if (event.isComposing || isTyping(event.target)) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closePopover(true);
        } else if (popover.dataset.view === 'presets' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
            const preset = presetForDigit(settings.presets, event.key);
            if (preset) {
                event.preventDefault();
                event.stopPropagation();
                usePreset(preset);
            }
        }
    });
    document.addEventListener('pointerdown', event => {
        if (!popover.hidden && !popover.contains(event.target) && !button.contains(event.target)) closePopover();
    });
    document.addEventListener('keydown', event => {
        if (!event.repeat && !event.isComposing && !isTyping(event.target) && matchesHotkey(event)) {
            event.preventDefault();
            togglePopover();
        }
    });
    ensureChapterMenu(document);
    document.addEventListener('click', event => {
        const control = event.target instanceof Element ? event.target.closest('.mes_director_chapter') : null;
        if (!control) return;
        event.preventDefault();
        event.stopPropagation();
        const id = Number(control.closest('.mes')?.getAttribute('mesid'));
        if (Number.isInteger(id)) toggleChapterMark(id);
    });
    // Verified names: user_message_rendered, character_message_rendered,
    // message_updated, message_deleted, chat_id_changed, more_messages_loaded.
    // Narrator and comment messages render on USER_MESSAGE_RENDERED.
    const refreshChapters = () => {
        ensureChapterMenu(document.getElementById('chat') ?? document);
        applyChapterDividers();
    };
    for (const type of [
        context.eventTypes.CHARACTER_MESSAGE_RENDERED,
        context.eventTypes.USER_MESSAGE_RENDERED,
        context.eventTypes.MESSAGE_UPDATED,
        context.eventTypes.MESSAGE_SWIPED,
        context.eventTypes.MESSAGE_DELETED,
        context.eventTypes.MORE_MESSAGES_LOADED,
    ]) context.eventSource.on(type, refreshChapters);
    // Marks have their own bounded work; never attach them to chapter scans.
    context.eventSource.on(context.eventTypes.CHARACTER_MESSAGE_RENDERED, id => fateMarks.paintOne(id));
    for (const type of [context.eventTypes.MESSAGE_UPDATED, context.eventTypes.MESSAGE_SWIPED]) {
        context.eventSource.on(type, id => {
            fateMarks.invalidate();
            fateMarks.paintOne(id);
            // Editing/swiping the predecessor can invalidate the next anchor.
            fateMarks.paintOne(Number(id) + 1);
            fatePanel?.refresh();
        });
    }
    for (const type of [context.eventTypes.CHAT_CHANGED, context.eventTypes.MORE_MESSAGES_LOADED,
        context.eventTypes.MESSAGE_DELETED, context.eventTypes.MESSAGE_EDITED]) {
        context.eventSource.on(type, () => {
            fateMarks.invalidate();
            fateMarks.paintAll();
            fatePanel?.refresh();
        });
    }
    context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => {
        chatRevision++;
        clearBoundDeleteSkip();
        // processChatSlashCommands already rebuilt script_inject_* for the new chat.
        discardDirectorPromptMask();
        closePopover();
        refreshChapters();
        try {
            clearTemporaryInstruct(getContext());
        } catch (error) {
            console.error('Director failed to clear a temporary instruction', error);
        }
        refreshInstructChip();
    });
    const restoreMaskedInstruct = () => {
        try {
            restoreDirectorPrompts(getContext());
        } catch (error) {
            console.error('Director failed to restore a masked instruction', error);
        }
    };
    // hideStopButton emits GENERATION_ENDED without awaiting. First listener runs
    // before that call returns, so a quiet 500 restores before the error settles.
    const releaseRegenerateDeleteSkip = () => clearBoundDeleteSkip();
    context.eventSource.on(context.eventTypes.GENERATION_ENDED, restoreMaskedInstruct);
    context.eventSource.makeFirst(context.eventTypes.GENERATION_ENDED, restoreMaskedInstruct);
    context.eventSource.on(context.eventTypes.GENERATION_ENDED, releaseRegenerateDeleteSkip);
    context.eventSource.on(context.eventTypes.GENERATION_STOPPED, restoreMaskedInstruct);
    context.eventSource.makeFirst(context.eventTypes.GENERATION_STOPPED, restoreMaskedInstruct);
    context.eventSource.on(context.eventTypes.GENERATION_STOPPED, releaseRegenerateDeleteSkip);
    // GENERATION_STARTED is before Generate deletes the last AI message for regenerate.
    context.eventSource.on(context.eventTypes.GENERATION_STARTED, (generationType, _params, dryRun) => {
        // Token-count dry runs must not unmask or reset a real generation.
        if (dryRun) return;
        try {
            // A quiet or impersonate run can return before the stop button exists,
            // so GENERATION_ENDED never fires. Restore before this run shields.
            restoreDirectorPrompts(getContext());
        } catch (error) {
            console.error('Director failed to restore a masked instruction', error);
        }
        try {
            clearTemporaryInstruct(getContext());
        } catch (error) {
            console.error('Director failed to clear a temporary instruction', error);
        }
        try {
            shieldDirectorPromptValues(getContext());
        } catch (error) {
            console.error('Director failed to shield an instruction from macro expansion', error);
        }
        armBoundDeleteSkip(generationType, dryRun);
    });
    context.eventSource.on(context.eventTypes.GENERATE_AFTER_DATA, () => {
        try {
            clearTemporaryInstruct(getContext());
        } catch (error) {
            console.error('Director failed to clear a temporary instruction', error);
        }
    });
    context.eventSource.on(context.eventTypes.MESSAGE_SENT, async () => {
        clearBoundDeleteSkip();
        const current = getContext();
        if (!applyUserSentClear(current.chatMetadata)) return;
        refreshInstructChip();
        await current.saveMetadata();
    });
    // MESSAGE_RECEIVED runs inside saveReply before swipe_info is written.
    // Debounce the clear so that save does not persist the unfinished message.
    context.eventSource.on(context.eventTypes.MESSAGE_RECEIVED, messageId => {
        const current = getContext();
        if (!applyCommittedMessageClear(current.chatMetadata, Number(messageId))) return;
        refreshInstructChip();
        current.saveMetadataDebounced();
    });
    context.eventSource.on(context.eventTypes.MESSAGE_DELETED, async () => {
        const current = getContext();
        const duringRegenerate = matchesRegenerateDelete(boundDeleteSkip, current, is_send_press);
        clearBoundDeleteSkip();
        if (!applyDeletionClear(current.chatMetadata, current.chat, duringRegenerate)) return;
        refreshInstructChip();
        await current.saveMetadata();
    });
    refreshChapters();
    fateMarks.paintAll();
    refreshInstructChip();
}
