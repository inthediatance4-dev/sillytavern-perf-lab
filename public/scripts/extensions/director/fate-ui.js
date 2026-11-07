import { createFateEmblem } from './fate-marks.js';

// A view that predates the allowance, or a mock that omits it, still has the one free swap.
function rerollsLeft(view) {
    return Number.isInteger(view?.rerolls) ? Math.max(0, view.rerolls) : 1;
}

/** Events cross into the face only after completion and the user's reveal policy. */
export function createFatePanel(controller, { Popup, POPUP_TYPE, POPUP_RESULT, hasDraft, warn,
    settings = { reveal: 'tap', sound: false, motion: 'system' }, sound = { play() {} },
    saveSettings = () => {}, restoreFocus = () => document.getElementById('director_fate_open')?.focus(), jumpToMessage }) {
    let panel = null;
    let popup = null;
    let error = '';
    let activeTab = 'current';
    let logPresentation = 0;
    const flipped = new Set();
    const labels = { light: '轻微波澜', medium: '明显转折', strong: '重大变故' };
    const rarities = { common: '寻常', rare: '稀有', legendary: '传说' };

    function focusReveal() {
        const flip = panel?.querySelector('#director_fate_flip');
        const jump = panel?.querySelector('#director_fate_jump');
        if (flip && !flip.hidden) flip.focus();
        else if (jump && !jump.hidden) jump.focus();
        else panel?.querySelector('.director_fate_card').focus();
    }

    let choosing = false;
    let endPickMotion = () => {};

    function rarityLabel(id) {
        return rarities[id] ?? rarities.common;
    }

    function selectTab(tab, focus = false) {
        const next = tab === 'log' ? 'log' : 'current';
        const changed = next !== activeTab;
        activeTab = next;
        for (const name of ['current', 'log']) {
            const selected = name === activeTab;
            const control = panel.querySelector(`#director_fate_tab_${name}`);
            control.setAttribute('aria-selected', String(selected));
            control.tabIndex = selected ? 0 : -1;
            panel.querySelector(`#director_fate_${name}`).hidden = !selected;
            if (selected && focus) control.focus();
        }
        if (changed) syncLog(controller.view());
        if (changed && next === 'log') queueLogRecovery();
    }

    // log() does not search the chat. Repair shifted indexes when the log is shown.
    function queueLogRecovery() {
        if (typeof controller.recoverLog !== 'function' || !panel || activeTab !== 'log') return;
        const generation = ++logPresentation;
        Promise.resolve(controller.recoverLog()).then(changed => {
            if (!changed || !panel || activeTab !== 'log' || generation !== logPresentation) return;
            syncLog(controller.view());
        }, () => { /* A failed save rolls back, so the list already shows the stored indexes. */ });
    }

    function focusEntry(id) {
        const entry = [...panel.querySelectorAll('.director_fate_log_entry')].find(item => item.dataset.entryId === id);
        if (entry) {
            entry.focus();
            entry.scrollIntoView({ block: 'nearest' });
        } else panel.querySelector('#director_fate_tab_log').focus();
    }

    async function jumpToLogEntry(entry) {
        let target = entry;
        if (typeof controller.recoverLog === 'function') {
            try { await controller.recoverLog(); } catch { /* Rolled back; the status check keeps a stale index. */ }
            const updated = controller.log().find(item => item.id === entry.id);
            if (!updated || updated.status !== 'ok') throw new Error();
            target = updated;
            if (panel && activeTab === 'log' && target.slotIndex !== entry.slotIndex) syncLog(controller.view());
        }
        await jumpToEntry(target);
    }

    async function jumpToEntry(entry) {
        // Resolve the destination while the dialog is open so a cancelled long
        // jump keeps the log available. The helper also loads older messages.
        if (jumpToMessage) {
            const activePopup = popup;
            await jumpToMessage(entry.slotIndex, 'director-fate-highlight', () => activePopup?.complete(POPUP_RESULT.AFFIRMATIVE), { warnMissing: true });
            return;
        }
        const message = document.querySelector(`#chat [mesid="${entry.slotIndex}"]`);
        if (!message) { warn('该消息未加载，请向上滚动'); return; }
        await popup?.complete(POPUP_RESULT.AFFIRMATIVE);
        message.scrollIntoView({ block: 'center' });
    }

    function syncLog(view) {
        const list = panel.querySelector('#director_fate_log_list');
        const entries = controller.log();
        const focused = document.activeElement;
        const focusedEntry = focused?.closest?.('.director_fate_log_entry');
        const focusedId = focusedEntry?.dataset.entryId;
        const focusedAction = focused?.dataset.fateAction;
        list.replaceChildren();
        for (const entry of entries) {
            const item = document.createElement('li');
            item.className = 'director_fate_log_entry';
            item.dataset.entryId = entry.id;
            item.dataset.rarity = entry.rarity;
            item.tabIndex = -1;
            const heading = document.createElement('div');
            heading.className = 'director_fate_log_heading';
            const dot = document.createElement('span');
            dot.className = 'director_fate_rarity_dot';
            dot.dataset.rarity = entry.rarity;
            dot.setAttribute('aria-label', rarityLabel(entry.rarity));
            dot.append(createFateEmblem(entry.rarity));
            const title = document.createElement('strong');
            title.textContent = entry.title;
            heading.append(dot, title);
            const details = document.createElement('div');
            details.className = 'director_fate_log_details';
            const strength = document.createElement('span');
            strength.textContent = labels[entry.strength];
            const position = document.createElement('span');
            position.textContent = `第 ${entry.slotIndex + 1} 条`;
            details.append(strength, position);
            if (entry.status !== 'ok') {
                const status = document.createElement('span');
                status.className = 'director_fate_log_status';
                status.textContent = entry.status === 'missing' ? '消息已删除' : '消息已改写';
                details.append(status);
            }
            const event = document.createElement('p');
            event.className = 'director_fate_log_event';
            const revealed = settings.reveal === 'auto' || (settings.reveal === 'tap' && flipped.has(entry.id));
            const shown = activeTab === 'log' && revealed;
            // Leave hidden tabs empty, including when the current anchor has
            // changed. The current card and visible log share flip memory.
            event.textContent = shown ? entry.event : '';
            event.hidden = !shown;
            const actions = document.createElement('div');
            actions.className = 'director_fate_log_actions';
            const flip = button('', '翻开', () => {
                if (settings.reveal !== 'tap' || flipped.has(entry.id)) return;
                flipped.add(entry.id);
                sound.play('flip');
                refresh();
                focusEntry(entry.id);
            });
            flip.classList.add('director_fate_log_flip');
            flip.dataset.fateAction = 'flip';
            flip.hidden = settings.reveal !== 'tap' || revealed;
            actions.append(flip);
            const jump = button('', '跳转', () => action(() => jumpToLogEntry(entry), '未能跳转到该消息。'));
            jump.classList.add('director_fate_log_jump');
            jump.dataset.fateAction = 'jump';
            jump.disabled = entry.status !== 'ok';
            actions.append(jump);
            item.append(heading, details, event, actions);
            list.append(item);
        }
        panel.querySelector('#director_fate_log_empty').hidden = entries.length > 0;
        panel.querySelector('#director_fate_clear_log').disabled = view.busy || !entries.length;
        panel.querySelector('#director_fate_tab_log').textContent = `本局命运（${view.logCount}）`;
        if (focusedId && activeTab === 'log') {
            const item = [...list.querySelectorAll('.director_fate_log_entry')].find(node => node.dataset.entryId === focusedId);
            const control = item && [...item.querySelectorAll('button')].find(node => node.dataset.fateAction === focusedAction);
            (control ?? item)?.focus();
        }
    }

    function syncOffer(view) {
        const box = panel.querySelector('.director_fate_offer');
        const offer = view.offer;
        const show = Boolean(offer) && view.phase !== 'applying';
        if (!show) {
            box.hidden = true;
            endPickMotion();
            box.replaceChildren();
            delete box.dataset.offerId;
            delete box.dataset.picking;
            box.classList.remove('is_picking');
            return;
        }
        box.hidden = false;
        if (box.dataset.offerId === offer.id && box.childElementCount === offer.cards.length) {
            // Keep the in-flight pick animation. A finished draw clears it without rebuilding.
            if (!view.busy && !choosing) {
                endPickMotion();
                box.classList.remove('is_picking');
                delete box.dataset.picking;
                for (const choice of box.querySelectorAll('.director_fate_choice')) choice.classList.remove('is_picked', 'is_drawing');
            }
            return;
        }
        endPickMotion();
        box.classList.remove('is_picking');
        delete box.dataset.picking;
        box.dataset.offerId = offer.id;
        box.replaceChildren();
        offer.cards.forEach((card, index) => {
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.className = 'director_fate_choice';
            choice.dataset.rarity = card.rarity;
            choice.setAttribute('aria-label', `第 ${index + 1} 张：〈${card.title}〉，〈${rarityLabel(card.rarity)}〉`);
            const seal = document.createElement('span');
            seal.className = 'director_fate_choice_seal';
            seal.textContent = '◇';
            seal.setAttribute('aria-hidden', 'true');
            const title = document.createElement('span');
            title.className = 'director_fate_choice_title';
            title.textContent = card.title;
            const rarity = document.createElement('span');
            rarity.className = 'director_fate_choice_rarity';
            rarity.textContent = rarityLabel(card.rarity);
            choice.append(seal, title, rarity);
            choice.addEventListener('click', () => choose(index));
            box.append(choice);
        });
    }

    function choose(index) {
        if (choosing || !panel) return;
        const view = controller.view();
        if (view.busy || !view.offer || !Number.isInteger(index) || index < 0 || index > 2) return;
        choosing = true;
        const box = panel.querySelector('.director_fate_offer');
        const choices = [...box.querySelectorAll('.director_fate_choice')];
        choices.forEach((choice, choiceIndex) => {
            choice.classList.toggle('is_picked', choiceIndex === index);
            choice.disabled = true;
        });
        box.classList.add('is_picking');
        box.dataset.picking = String(index);
        const picked = choices[index];
        // The center card does not move. A sibling fade (or the picked card's
        // own move) is what starts the seal crack. No timer.
        endPickMotion();
        const onEnd = event => {
            if (event.type === 'transitionend' && event.propertyName !== 'transform' && event.propertyName !== 'opacity') return;
            if (box.classList.contains('is_picking') && picked.isConnected) picked.classList.add('is_drawing');
            endPickMotion();
        };
        endPickMotion = () => {
            box.removeEventListener('transitionend', onEnd);
            box.removeEventListener('animationend', onEnd);
            endPickMotion = () => {};
        };
        box.addEventListener('transitionend', onEnd);
        box.addEventListener('animationend', onEnd);
        const strength = panel.querySelector('#director_fate_strength').value;
        action(async () => {
            try {
                if (await controller.pick(index, strength)) sound.play('seal');
            } finally {
                choosing = false;
            }
        }, '未抽到有效事件，请重试。');
    }

    function syncDraw(view) {
        const draw = panel.querySelector('#director_fate_draw');
        const remaining = rerollsLeft(view);
        const open = Boolean(view.offer);
        const spent = open && remaining < 1;
        draw.textContent = open ? `换一组 (${remaining})` : '发牌';
        if (spent) {
            draw.disabled = true;
            draw.setAttribute('title', '本次已换过一组');
            draw.setAttribute('aria-label', `换一组 (${remaining})，本次已换过一组`);
        } else {
            draw.removeAttribute('title');
            draw.removeAttribute('aria-label');
        }
    }

    function refresh() {
        if (!panel) return;
        const view = controller.view();
        const applying = view.phase === 'applying';
        const showOffer = Boolean(view.offer) && !applying;
        const rerollSpent = showOffer && rerollsLeft(view) < 1;
        // An open offer is the choice being made. Do not show a previous reveal behind it.
        const card = view.held ?? (showOffer ? null : view.bound);
        const reveal = !view.held && !applying && !showOffer && view.reveal?.id === card?.id ? view.reveal : null;
        const shown = Boolean(reveal && (settings.reveal === 'auto' || (settings.reveal === 'tap' && flipped.has(reveal.id))));
        const state = applying ? 'applying' : view.held ? 'sealed' : reveal ? 'revealed' : view.bound && !showOffer ? 'stale' : 'empty';
        const element = panel.querySelector('.director_fate_card');
        element.hidden = showOffer && !view.held;
        element.dataset.state = state;
        // Card stock follows the rarity already printed on the back. No event text.
        if (card) element.dataset.rarity = reveal?.rarity ?? card.rarity;
        else delete element.dataset.rarity;
        element.classList.toggle('director_fate_flipped', shown);
        panel.classList.toggle('director_fate_nomotion', settings.motion === 'off');
        document.documentElement?.classList.toggle('director_fate_nomotion', settings.motion === 'off');
        panel.querySelector('.director_fate_back').setAttribute('aria-hidden', String(shown));
        const face = panel.querySelector('.director_fate_face');
        // Do not prefill hidden text, attributes, accessibility names or tooltips.
        face.textContent = shown ? reveal.event : '';
        face.setAttribute('aria-hidden', String(!shown));
        panel.querySelector('#director_fate_title').textContent = card?.title ?? '故事的下一次转折';
        panel.querySelector('#director_fate_strength_label').textContent = card ? labels[card.strength] : '尚未抽牌';
        panel.querySelector('#director_fate_rarity').textContent = card ? rarityLabel(reveal?.rarity ?? card.rarity) : '';
        syncOffer(view);
        panel.querySelector('#director_fate_status').textContent = error || (view.busy
            ? applying ? '命运在转动…' : '正在为当前剧情抽牌…'
            : showOffer ? (rerollSpent ? '三张牌已备好，请选择一张。本次已换过一组。' : '三张牌已备好，请选择一张。')
                : state === 'sealed' ? '牌已封存。'
                    : state === 'revealed' ? shown ? '命运已揭晓。' : settings.reveal === 'off' ? '命运已降临，翻牌已关闭。' : '命运已降临，点击翻牌。'
                        : state === 'stale' ? '这张牌的消息已变化，无法翻牌。' : '抽取一张牌，让故事迎来转折。');
        panel.querySelector('#director_fate_apply').hidden = !view.held;
        panel.querySelector('#director_fate_discard').hidden = !view.held;
        panel.querySelector('#director_fate_flip').hidden = !reveal || settings.reveal !== 'tap' || shown;
        panel.querySelector('#director_fate_jump').hidden = !shown;
        for (const control of panel.querySelectorAll('.director_fate_actions button, #director_fate_strength, .director_fate_choice')) control.disabled = view.busy;
        // After the busy pass, so a spent swap stays disabled once the deal settles.
        syncDraw(view);
        panel.setAttribute('aria-busy', String(view.busy));
        syncLog(view);
        selectTab(activeTab);
        if (activeTab === 'log') queueLogRecovery();
    }

    function action(operation, failure) {
        error = '';
        Promise.resolve().then(operation).catch(() => {
            error = failure;
            if (!panel) warn(failure);
        }).finally(refresh);
    }

    function button(id, text, click) {
        const element = document.createElement('button');
        element.id = id;
        element.type = 'button';
        element.className = 'menu_button';
        element.textContent = text;
        element.addEventListener('click', click);
        return element;
    }

    function select(id, values, selected) {
        const element = document.createElement('select');
        element.id = id;
        element.className = 'text_pole';
        for (const [value, text] of Object.entries(values)) element.add(new Option(text, value));
        element.value = selected;
        return element;
    }

    function labelFor(control, text) {
        const label = document.createElement('label');
        label.htmlFor = control.id;
        label.textContent = text;
        return label;
    }

    async function open({ focusReveal: shouldFocusReveal = false, tab = 'current', entryId } = {}) {
        if (popup) {
            selectTab(tab);
            if (tab === 'log') focusEntry(entryId);
            if (shouldFocusReveal) focusReveal();
            return;
        }
        error = '';
        activeTab = tab === 'log' ? 'log' : 'current';
        panel = document.createElement('div');
        panel.id = 'director_fate_panel';
        const heading = document.createElement('h3');
        heading.textContent = '🎴 盲抽命运牌';
        const tabs = document.createElement('div');
        tabs.className = 'director_fate_tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', '命运牌');
        for (const [name, text] of [['current', '当前'], ['log', '本局命运（0）']]) {
            const control = button(`director_fate_tab_${name}`, text, () => selectTab(name));
            // Core a11y turns .menu_button into role="button"; tabs keep their own styling.
            control.className = 'director_fate_tab';
            control.setAttribute('role', 'tab');
            control.setAttribute('aria-controls', `director_fate_${name}`);
            control.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 'current' : event.key === 'End' ? 'log' : name === 'current' ? 'log' : 'current';
                selectTab(next, true);
            });
            tabs.append(control);
        }
        const current = document.createElement('div');
        current.id = 'director_fate_current';
        current.setAttribute('role', 'tabpanel');
        current.setAttribute('aria-labelledby', 'director_fate_tab_current');
        const card = document.createElement('div');
        card.className = 'director_fate_card';
        card.tabIndex = -1;
        const back = document.createElement('div');
        back.className = 'director_fate_back';
        const ornament = document.createElement('span');
        ornament.className = 'director_fate_seal';
        ornament.textContent = '◇';
        ornament.setAttribute('aria-hidden', 'true');
        const title = document.createElement('strong');
        title.id = 'director_fate_title';
        const strengthLabel = document.createElement('span');
        strengthLabel.id = 'director_fate_strength_label';
        const rarity = document.createElement('span');
        rarity.id = 'director_fate_rarity';
        back.append(ornament, title, strengthLabel, rarity);
        const face = document.createElement('div');
        face.className = 'director_fate_face';
        back.setAttribute('aria-hidden', 'false');
        face.setAttribute('aria-hidden', 'true');
        card.append(back, face);
        const offer = document.createElement('div');
        offer.className = 'director_fate_offer';
        offer.hidden = true;
        offer.setAttribute('role', 'group');
        offer.setAttribute('aria-label', '三张命运牌');
        const strength = select('director_fate_strength', labels, 'medium');
        const status = document.createElement('p');
        status.id = 'director_fate_status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const controls = document.createElement('div');
        controls.className = 'director_fate_actions';
        const draw = button('director_fate_draw', '发牌', () => {
            const currentView = controller.view();
            if (currentView.offer && rerollsLeft(currentView) < 1) return;
            // play() has to run inside the click, before the deal save yields.
            sound.play('draw');
            action(async () => {
                try {
                    await controller.deal();
                } catch (reason) {
                    // The view refresh shows the spent hint. Do not replace it with the generic failure.
                    if (reason?.message === '本次已换过一组') return;
                    throw reason;
                }
            }, '未能发牌，请重试。');
        });
        const apply = button('director_fate_apply', '让意外发生', () => {
            if (hasDraft()) {
                error = '请先发送或清空草稿及待发送的附件，再让意外发生。';
                refresh();
                return;
            }
            action(async () => {
                // Capture the operation before closing the modal can yield to a chat switch.
                const generation = controller.apply();
                const settled = generation.then(ok => ok ? null : '剧情未完成，牌仍保留，可重新打开重试。', () => '剧情未完成，牌仍保留，可重新打开重试。');
                await popup?.complete(POPUP_RESULT.AFFIRMATIVE);
                const failure = await settled;
                if (failure) warn(failure);
            }, '剧情未完成，牌仍保留，可重试。');
        });
        const discard = button('director_fate_discard', '弃牌', () => action(() => controller.discard(), '未能弃牌，请重试。'));
        const flip = button('director_fate_flip', '翻牌', () => {
            const view = controller.view();
            if (settings.reveal !== 'tap' || view.held || view.phase === 'applying' || !view.reveal) return;
            flipped.add(view.reveal.id);
            sound.play('flip');
            refresh();
            panel.querySelector('#director_fate_jump').focus();
        });
        const jump = button('director_fate_jump', '跳到该消息', () => {
            const reveal = controller.view().reveal;
            if (!reveal) return;
            action(() => jumpToEntry(reveal), '未能跳转到该消息。');
        });
        controls.append(draw, apply, discard, flip, jump);
        const cost = document.createElement('small');
        cost.textContent = '发牌在这台设备上完成，不连模型。选定一张后，会再用当前的模型连接生成一次，把牌面写出来；点「让意外发生」就立刻续写剧情。';
        current.append(card, offer, labelFor(strength, '下一张的强度'), strength, status, controls, cost);
        const log = document.createElement('div');
        log.id = 'director_fate_log';
        log.setAttribute('role', 'tabpanel');
        log.setAttribute('aria-labelledby', 'director_fate_tab_log');
        const logList = document.createElement('ol');
        logList.id = 'director_fate_log_list';
        const empty = document.createElement('p');
        empty.id = 'director_fate_log_empty';
        empty.textContent = '本局尚无已降临的命运。';
        const clear = button('director_fate_clear_log', '清空记录', () => action(async () => {
            const result = await Popup.show.confirm('清空本局的命运记录？', '记下的命运会清掉，当前的牌和剧情消息都留着。');
            if (result !== POPUP_RESULT.AFFIRMATIVE) return;
            await controller.clearLog();
        }, '未能清空记录，请重试。'));
        log.append(logList, empty, clear);
        const preferences = document.createElement('div');
        preferences.id = 'director_fate_settings';
        preferences.hidden = true;
        const gear = button('director_fate_settings_toggle', '⚙ 命运牌设置', () => {
            preferences.hidden = !preferences.hidden;
            gear.setAttribute('aria-expanded', String(!preferences.hidden));
        });
        gear.setAttribute('aria-controls', preferences.id);
        gear.setAttribute('aria-expanded', 'false');
        const revealMode = select('director_fate_reveal', { tap: '点击翻牌', auto: '自动揭晓', off: '不揭晓' }, settings.reveal);
        const audio = document.createElement('input');
        audio.id = 'director_fate_sound';
        audio.type = 'checkbox';
        audio.checked = settings.sound;
        const motion = select('director_fate_motion', { system: '跟随系统', off: '关闭动效' }, settings.motion);
        for (const [control, key, text] of [[revealMode, 'reveal', '揭晓方式'], [audio, 'sound', '播放音效'], [motion, 'motion', '动效']]) {
            control.addEventListener('change', () => {
                settings[key] = control.type === 'checkbox' ? control.checked : control.value;
                saveSettings();
                refresh();
            });
            preferences.append(labelFor(control, text), control);
        }
        panel.append(heading, tabs, current, log, gear, preferences);
        // The dialog focuses its autofocus control inside showModal. onOpen runs
        // only after the opening animation, which is too late for a caller that
        // reads document.activeElement as soon as the panel is visible.
        function openedFocusTarget() {
            if (activeTab === 'log') {
                const entry = [...panel.querySelectorAll('.director_fate_log_entry')].find(item => item.dataset.entryId === entryId);
                return entry ?? panel.querySelector('#director_fate_tab_log');
            }
            if (!shouldFocusReveal) return null;
            const flip = panel.querySelector('#director_fate_flip');
            const jump = panel.querySelector('#director_fate_jump');
            if (flip && !flip.hidden) return flip;
            if (jump && !jump.hidden) return jump;
            return panel.querySelector('.director_fate_card');
        }
        function focusOpened() {
            const target = openedFocusTarget();
            if (!target || typeof target.focus !== 'function') return;
            target.focus();
            if (target.classList.contains('director_fate_log_entry') && typeof target.scrollIntoView === 'function') {
                target.scrollIntoView({ block: 'nearest' });
            }
        }
        popup = new Popup(panel, POPUP_TYPE.TEXT, '', {
            okButton: false, cancelButton: '关闭', onOpen: () => {
                const target = openedFocusTarget();
                if (!target) return;
                const active = document.activeElement;
                if (active === target) return;
                // Leave a tab or control the user already reached during the animation.
                if (active && panel.contains(active)) return;
                focusOpened();
            },
        });
        let escaped = false;
        popup.dlg.addEventListener('cancel', () => { escaped = true; });
        refresh();
        const initialTarget = openedFocusTarget();
        if (initialTarget && typeof popup.dlg.querySelectorAll === 'function') {
            for (const node of popup.dlg.querySelectorAll('[autofocus]')) node.removeAttribute('autofocus');
            initialTarget.setAttribute('autofocus', '');
        }
        try {
            const shown = popup.show();
            focusOpened();
            await shown;
        }
        finally {
            popup = null;
            panel = null;
            if (escaped) restoreFocus();
        }
    }
    return { open, refresh };
}
