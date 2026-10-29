import { extension_settings, getContext } from '../../extensions.js';
import { POPUP_RESULT, Popup } from '../../popup.js';
import { download, getSortableDelay, uuidv4 } from '../../utils.js';
import { createDefaultPresets, exportPresetConfig, PRESET_LIMITS, validatePresetConfig } from './presets.js';

export function initPresetManager() {
    const settings = extension_settings.director;
    const list = document.getElementById('director_presets');
    const template = document.getElementById('director_preset_template');
    const status = document.getElementById('director_preset_status');
    const add = document.getElementById('director_preset_add');
    const fileInput = document.getElementById('director_import_file');
    const save = () => getContext().saveSettingsDebounced();
    document.getElementById('director_settings').addEventListener('keydown', event => {
        // Upstream also synthesizes Enter clicks on .menu_button controls.
        // Native buttons already activate, so keep this event local.
        if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) event.stopPropagation();
    });

    function updateOrder() {
        [...list.children].forEach((row, index) => {
            const preset = settings.presets[index];
            row.querySelector('.director_preset_heading').textContent = `${index + 1}. ${preset.icon} ${preset.name}`;
            row.querySelector('[data-action="up"]').disabled = index === 0;
            row.querySelector('[data-action="down"]').disabled = index === settings.presets.length - 1;
        });
        add.disabled = settings.presets.length >= PRESET_LIMITS.maxPresets;
    }

    function reorder() {
        const byId = new Map(settings.presets.map(preset => [preset.id, preset]));
        settings.presets = [...list.children].map(row => byId.get(row.dataset.presetId));
        updateOrder();
        save();
    }

    function render() {
        list.replaceChildren();
        settings.presets.forEach(preset => {
            const row = template.content.firstElementChild.cloneNode(true);
            row.dataset.presetId = preset.id;
            row.querySelectorAll('[data-field]').forEach(field => {
                const key = field.dataset.field;
                if (field.type === 'checkbox') field.checked = preset[key];
                else field.value = preset[key];
                if (PRESET_LIMITS[key]) field.maxLength = PRESET_LIMITS[key];
                field.addEventListener('input', () => {
                    const candidate = { ...preset, [key]: field.type === 'checkbox' ? field.checked : field.value };
                    try {
                        // Validate a draft first; an empty name while editing never
                        // replaces the last valid saved preset.
                        const presets = settings.presets.map(item => item.id === preset.id ? candidate : item);
                        const validated = validatePresetConfig({ version: 1, presets });
                        Object.assign(preset, validated.find(item => item.id === preset.id));
                        field.setCustomValidity('');
                        updateOrder();
                        save();
                    } catch (error) {
                        field.setCustomValidity(error.message);
                    }
                });
                field.addEventListener('change', () => field.reportValidity());
            });
            row.querySelectorAll('[data-action]').forEach(control => {
                control.addEventListener('click', () => {
                    const action = control.dataset.action;
                    const index = settings.presets.indexOf(preset);
                    if (action === 'delete') {
                        settings.presets.splice(index, 1);
                        row.remove();
                        updateOrder();
                        // Keyboard moves and deletion bypass the sortable drag path.
                        $(list).sortable('refresh');
                        save();
                        const next = list.children[Math.min(index, list.children.length - 1)];
                        (next?.querySelector('[data-field="name"]') ?? add).focus();
                        status.textContent = '已删除预设。';
                        return;
                    }
                    const target = list.children[index + (action === 'up' ? -1 : 1)];
                    if (!target) return;
                    if (action === 'up') target.before(row);
                    else target.after(row);
                    reorder();
                    $(list).sortable('refresh');
                    (control.disabled ? row.querySelector('[data-field="name"]') : control).focus();
                    status.textContent = `${preset.name}，序号 ${settings.presets.indexOf(preset) + 1}。`;
                });
            });
            list.append(row);
        });
        updateOrder();
        $(list).sortable('refresh');
    }

    $(list).sortable({
        items: '> .director_preset',
        handle: '.drag-handle',
        delay: getSortableDelay(),
        stop: () => {
            reorder();
            status.textContent = '已保存预设顺序。';
        },
    });
    add.addEventListener('click', () => {
        if (settings.presets.length >= PRESET_LIMITS.maxPresets) return;
        settings.presets.push({ id: uuidv4(), icon: '🎬', name: '新预设', mode: 'narrator', template: '{{input:内容}}', isChapter: false, autoGenerate: false });
        render();
        save();
        list.lastElementChild.querySelector('[data-field="name"]').focus();
    });
    document.getElementById('director_restore_defaults').addEventListener('click', async () => {
        const result = await Popup.show.confirm('恢复 Director 默认预设？', '当前预设将被替换。建议先导出备份。');
        if (result !== POPUP_RESULT.AFFIRMATIVE) return;
        settings.presets = createDefaultPresets();
        render();
        save();
        status.textContent = '已恢复默认预设。';
    });
    document.getElementById('director_export').addEventListener('click', () => {
        download(exportPresetConfig(settings.presets), 'director-presets.json', 'application/json');
    });
    document.getElementById('director_import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        try {
            // Covers the largest valid config even with JSON Unicode escaping.
            if (file.size > 8 * 1024 * 1024) throw new Error('文件不能超过 8 MiB。');
            const presets = validatePresetConfig(JSON.parse(await file.text()));
            settings.presets = presets;
            render();
            save();
            status.textContent = `已导入 ${presets.length} 个预设。`;
        } catch (error) {
            toastr.error(`无法导入 Director 预设：${error.message}`, '', { escapeHtml: true });
        } finally {
            fileInput.value = '';
        }
    });
    render();
}
