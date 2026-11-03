/** Events cross into the face only after completion and the user's reveal policy. */
export function createFatePanel(controller, { Popup, POPUP_TYPE, POPUP_RESULT, hasDraft, warn,
    settings = { reveal: 'tap', sound: false, motion: 'system' }, sound = { play() {} },
    saveSettings = () => {}, restoreFocus = () => document.getElementById('director_fate_open')?.focus() }) {
    let panel = null;
    let popup = null;
    let error = '';
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

    function refresh() {
        if (!panel) return;
        const view = controller.view();
        const applying = view.phase === 'applying';
        const showOffer = Boolean(view.offer) && !applying;
        // An open offer is the choice being made. Do not show a previous reveal behind it.
        const card = view.held ?? (showOffer ? null : view.bound);
        const reveal = !view.held && !applying && !showOffer && view.reveal?.id === card?.id ? view.reveal : null;
        const shown = Boolean(reveal && (settings.reveal === 'auto' || (settings.reveal === 'tap' && flipped.has(reveal.id))));
        const state = applying ? 'applying' : view.held ? 'sealed' : reveal ? 'revealed' : view.bound && !showOffer ? 'stale' : 'empty';
        const element = panel.querySelector('.director_fate_card');
        element.hidden = showOffer && !view.held;
        element.dataset.state = state;
        element.classList.toggle('director_fate_flipped', shown);
        panel.classList.toggle('director_fate_nomotion', settings.motion === 'off');
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
            : showOffer ? '三张牌已备好，请选择一张。'
                : state === 'sealed' ? '牌已封存。'
                    : state === 'revealed' ? shown ? '命运已揭晓。' : settings.reveal === 'off' ? '命运已降临，翻牌已关闭。' : '命运已降临，点击翻牌。'
                        : state === 'stale' ? '这张牌的消息已变化，无法翻牌。' : '抽取一张牌，让故事迎来转折。');
        panel.querySelector('#director_fate_draw').textContent = view.offer ? '换一组' : '发牌';
        panel.querySelector('#director_fate_apply').hidden = !view.held;
        panel.querySelector('#director_fate_discard').hidden = !view.held;
        panel.querySelector('#director_fate_flip').hidden = !reveal || settings.reveal !== 'tap' || shown;
        panel.querySelector('#director_fate_jump').hidden = !shown;
        for (const control of panel.querySelectorAll('.director_fate_actions button, #director_fate_strength, .director_fate_choice')) control.disabled = view.busy;
        panel.setAttribute('aria-busy', String(view.busy));
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

    async function open({ focusReveal: shouldFocusReveal = false } = {}) {
        if (popup) {
            if (shouldFocusReveal) focusReveal();
            return;
        }
        error = '';
        panel = document.createElement('div');
        panel.id = 'director_fate_panel';
        const heading = document.createElement('h3');
        heading.textContent = '🎴 盲抽命运牌';
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
            // play() has to run inside the click, before the deal save yields.
            sound.play('draw');
            action(() => controller.deal(), '未能发牌，请重试。');
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
            const message = document.querySelector(`#chat [mesid="${reveal.slotIndex}"]`);
            if (!message) { warn('该消息未加载，请向上滚动'); return; }
            // Close the modal so the message being scrolled to is visible.
            const closing = popup?.complete(POPUP_RESULT.AFFIRMATIVE);
            Promise.resolve(closing).then(() => message.scrollIntoView({ block: 'center' }));
        });
        controls.append(draw, apply, discard, flip, jump);
        const cost = document.createElement('small');
        cost.textContent = '发牌在本地完成。选定一张后使用当前连接，额外生成一次；采用后立即生成剧情。';
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
        panel.append(heading, card, offer, labelFor(strength, '下一张的强度'), strength, status, controls, cost, gear, preferences);
        popup = new Popup(panel, POPUP_TYPE.TEXT, '', {
            okButton: false, cancelButton: '关闭', onOpen: () => { if (shouldFocusReveal) focusReveal(); },
        });
        let escaped = false;
        popup.dlg.addEventListener('cancel', () => { escaped = true; });
        refresh();
        try { await popup.show(); }
        finally {
            popup = null;
            panel = null;
            if (escaped) restoreFocus();
        }
    }
    return { open, refresh };
}
