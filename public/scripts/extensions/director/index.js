import { Popper } from '../../../lib.js';
import { doNavbarIconClick } from '../../../script.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../extensions.js';
import { POPUP_RESULT, POPUP_TYPE, Popup } from '../../popup.js';
import { uuidv4 } from '../../utils.js';
import { renderDirectorTemplate } from './template.js';

const defaultPresets = [
    { id: 'time-skip', icon: '⏩', name: '时间跳跃', mode: 'narrator', template: '——{{input:过了多久？|一段时间}}后——' },
    { id: 'scene', icon: '🎬', name: '场景切换', mode: 'narrator', template: '【场景：{{input:新的地点}}】' },
    { id: 'narration', icon: '📖', name: '旁白', mode: 'narrator', template: '{{input:旁白内容}}' },
    { id: 'chapter', icon: '🌙', name: '新章节', mode: 'narrator', template: '第{{chapter}}章　{{input:章节标题}}', isChapter: true },
    { id: 'event', icon: '⚡', name: '突发事件', mode: 'narrator', template: '（突然，{{input:发生了什么}}）' },
    { id: 'direct', icon: '🎭', name: '导演指令', mode: 'instruct', template: '[导演指令：{{input:你希望接下来怎么发展}}]' },
    { id: 'advance', icon: '🔁', name: '推进剧情', mode: 'instruct', template: '[导演指令：推动剧情向前发展，引入一个新的变化，不要重复之前的情节。]' },
    { id: 'note', icon: '📝', name: '备注', mode: 'comment', template: '{{input:写给自己的备注}}' },
];

let button;
let popover;
let popper;
let executing = false;
let chatRevision = 0;

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

async function usePreset(preset) {
    if (executing) return;
    const context = getContext();
    const revision = chatRevision;
    if (!context.groupId && context.characterId === undefined) {
        toastr.warning('请先选择聊天。');
        return;
    }

    executing = true;
    closePopover(true);
    try {
        let values = [];
        const text = await renderDirectorTemplate(preset.template, {
            chat: context.chat,
            substituteParams: context.substituteParams,
            collectInputs: async inputs => {
                values = await collectInputs(inputs, preset.name);
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
            await commands.inject.callback({ id: `director-${id}`, ephemeral: 'true', position: 'chat', depth: '0', role: 'system', scan: 'false' }, text);
        } else {
            const metadata = { id, preset: preset.isChapter ? 'chapter' : preset.id };
            if (preset.isChapter) {
                // Keep the entered title; expanding it again could run stateful
                // macros twice, after they already ran in the message template.
                metadata.chapter = { title: values[0] ?? preset.name };
            }
            const index = context.chat.length;
            const attachMetadata = messageId => {
                if (messageId === index && context.chat[index]) {
                    context.chat[index].extra.director = metadata;
                }
            };
            // MESSAGE_SENT runs before rendering and the command's JSONL save.
            context.eventSource.makeFirst(context.eventTypes.MESSAGE_SENT, attachMetadata);
            try {
                const command = preset.mode === 'comment' ? commands.comment : commands.sys;
                await command.callback({}, text);
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
        toastr.error('无法应用 Director 预设。');
    } finally {
        executing = false;
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

function togglePopover() {
    if (!popover.hidden) {
        closePopover(true);
        return;
    }
    if (executing) return;
    popover.replaceChildren();
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
    chapters.disabled = true;
    chapters.title = '章节列表即将推出';
    footer.append(manage, chapters);
    popover.append(footer);
    popover.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    popper.update();
    popover.focus();
}

export async function init() {
    if (extension_settings.disabledExtensions.includes('director') || document.getElementById('directorButton')) return;
    const settings = extension_settings.director ??= {};
    let seeded = false;
    if (!Array.isArray(settings.presets)) {
        settings.presets = defaultPresets.map(preset => ({ isChapter: false, autoGenerate: false, ...preset }));
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
    const context = getContext();
    if (seeded) context.saveSettingsDebounced();
    $('#extensions_settings').append(await renderExtensionTemplateAsync('director', 'settings'));
    $('#director_hotkey').val(settings.hotkey).on('input', function () {
        settings.hotkey = String($(this).val()).trim();
        context.saveSettingsDebounced();
    });

    button = document.createElement('div');
    button.id = 'directorButton';
    button.className = 'interactable';
    button.textContent = '🎬';
    button.title = 'Director';
    button.tabIndex = 0;
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', 'Director');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'directorPopover');
    button.setAttribute('aria-expanded', 'false');
    document.getElementById('extensionsMenuButton').after(button);

    popover = document.createElement('div');
    popover.id = 'directorPopover';
    popover.hidden = true;
    popover.tabIndex = -1;
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Director 预设');
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
        } else if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
            const preset = settings.presets[Number(event.key) - 1];
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
    context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => {
        chatRevision++;
        closePopover();
    });
}
