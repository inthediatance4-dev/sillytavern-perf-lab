/** Blind presentation only: the controller's public view never contains events. */
export function createFatePanel(controller, { Popup, POPUP_TYPE, POPUP_RESULT, hasDraft, warn }) {
    let panel = null;
    let popup = null;
    let error = '';
    const labels = { light: '轻微波澜', medium: '明显转折', strong: '重大变故' };

    function refresh() {
        if (!panel) return;
        const view = controller.view();
        const card = view.held ?? view.bound;
        panel.querySelector('#director_fate_title').textContent = card?.title ?? '故事的下一次转折';
        panel.querySelector('#director_fate_strength_label').textContent = card ? labels[card.strength] : '尚未抽牌';
        panel.querySelector('#director_fate_status').textContent = error || (view.busy
            ? view.phase === 'drawing' ? '正在为当前剧情抽牌…' : '意外正在发生…'
            : view.held ? '牌已封存。让下一条剧情揭晓它。' : view.bound ? '这张牌已发生，重新生成时沿用同一事件。' : '只展示牌名和强度，具体事件留给正文。');
        panel.querySelector('#director_fate_draw').textContent = view.held ? '换一张' : '抽一张';
        panel.querySelector('#director_fate_apply').hidden = !view.held;
        panel.querySelector('#director_fate_discard').hidden = !view.held;
        for (const control of panel.querySelectorAll('button, select')) control.disabled = view.busy;
        panel.setAttribute('aria-busy', String(view.busy));
    }

    function action(operation, failure) {
        error = '';
        Promise.resolve().then(operation).catch(() => {
            error = failure;
            if (!panel) warn(failure);
        }).finally(refresh);
    }

    async function open() {
        if (popup) return;
        error = '';
        panel = document.createElement('div');
        panel.id = 'director_fate_panel';
        const heading = document.createElement('h3');
        heading.textContent = '🎴 盲抽命运牌';
        const card = document.createElement('div');
        card.className = 'director_fate_card';
        const ornament = document.createElement('span');
        ornament.className = 'director_fate_seal';
        ornament.textContent = '◇';
        ornament.setAttribute('aria-hidden', 'true');
        const title = document.createElement('strong');
        title.id = 'director_fate_title';
        const strengthLabel = document.createElement('span');
        strengthLabel.id = 'director_fate_strength_label';
        card.append(ornament, title, strengthLabel);
        const label = document.createElement('label');
        label.htmlFor = 'director_fate_strength';
        label.textContent = '下一张的强度';
        const strength = document.createElement('select');
        strength.id = 'director_fate_strength';
        strength.className = 'text_pole';
        for (const [value, text] of Object.entries(labels)) strength.add(new Option(text, value));
        strength.value = 'medium';
        const status = document.createElement('p');
        status.id = 'director_fate_status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const controls = document.createElement('div');
        controls.className = 'director_fate_actions';
        const draw = document.createElement('button');
        draw.id = 'director_fate_draw';
        draw.addEventListener('click', () => action(() => controller.draw(strength.value), '未抽到有效事件，请重试。'));
        const apply = document.createElement('button');
        apply.id = 'director_fate_apply';
        apply.textContent = '让意外发生';
        apply.addEventListener('click', () => {
            if (hasDraft()) {
                error = '请先发送或清空输入框中的草稿，再让意外发生。';
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
        const discard = document.createElement('button');
        discard.id = 'director_fate_discard';
        discard.textContent = '弃牌';
        discard.addEventListener('click', () => action(() => controller.discard(), '未能弃牌，请重试。'));
        for (const button of [draw, apply, discard]) {
            button.type = 'button';
            button.className = 'menu_button';
        }
        controls.append(draw, apply, discard);
        const cost = document.createElement('small');
        cost.textContent = '每次抽牌使用当前连接，额外生成一次；采用后立即生成剧情。';
        panel.append(heading, card, label, strength, status, controls, cost);
        popup = new Popup(panel, POPUP_TYPE.TEXT, '', { okButton:false, cancelButton:'关闭' });
        refresh();
        try { await popup.show(); }
        finally { popup = null; panel = null; }
    }
    return { open, refresh };
}
