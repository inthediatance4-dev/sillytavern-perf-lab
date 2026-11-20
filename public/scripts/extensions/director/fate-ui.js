import { createFateEmblem } from './fate-marks.js';
import { publicFailureMessage } from '../../plugin-runtime/request-errors.js';

// A view that predates the allowance, or a mock that omits it, still has the one free swap.
function rerollsLeft(view) {
    return Number.isInteger(view?.rerolls) ? Math.max(0, view.rerolls) : 1;
}

/** Prepared cards expose a bounded preview; full reveals follow completion and reveal policy. */
export function createFatePanel(controller, { Popup, POPUP_TYPE, POPUP_RESULT, hasDraft, warn,
    settings = { reveal: 'tap', sound: false, motion: 'system', theme: 'apple' }, sound = { play() {} },
    restoreFocus = () => document.getElementById('director_fate_open')?.focus(), jumpToMessage }) {
    let panel = null;
    let popup = null;
    let error = '';
    let activeTab = 'current';
    let logPresentation = 0;
    let ownsPresentation = null;
    let displayedOffer = null;
    const flipped = new Set();
    const previewed = new Set();
    const attemptedOffers = new Set();
    const labels = { light: '轻微波澜', medium: '明显转折', strong: '重大变故' };
    const rarities = { common: '寻常', rare: '稀有', legendary: '传说' };

    function focusReveal() {
        const flip = panel?.querySelector('#director_fate_flip');
        const jump = panel?.querySelector('#director_fate_jump');
        if (flip && !flip.hidden) flip.focus();
        else if (jump && !jump.hidden) jump.focus();
        else panel?.querySelector('.director_fate_card').focus();
    }

    let choosing = null;
    let endPickMotion = () => {};

    function rarityLabel(id) {
        return rarities[id] ?? rarities.common;
    }

    function selectTab(tab, focus = false) {
        const next = tab === 'log' ? 'log' : 'current';
        const changed = next !== activeTab;
        activeTab = next;
        panel.querySelector('#director_fate_status').hidden = next === 'log' && !error;
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
        if (changed && next === 'current') prepareOnVisit();
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
        const owner = capturePanel();
        let target = entry;
        if (typeof controller.recoverLog === 'function') {
            try { await controller.recoverLog(); } catch { /* Rolled back; the status check keeps a stale index. */ }
            if (!currentPanel(owner)) return;
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
        panel.querySelector('#director_fate_tab_log').textContent = `本局命运（${view.logCount}）`;
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
            [...box.querySelectorAll('.director_fate_choice_preview')].forEach((node, index) => {
                node.textContent = offer.cards[index].preview ?? '事件尚未生成，可补写概述';
            });
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
            const preview = document.createElement('span');
            preview.className = 'director_fate_choice_preview';
            preview.id = `director_fate_choice_preview_${index}`;
            choice.setAttribute('aria-describedby', preview.id);
            preview.textContent = card.preview ?? '事件尚未生成，可补写概述';
            choice.append(seal, title, rarity, preview);
            choice.addEventListener('click', () => choose(index, offer.id));
            box.append(choice);
        });
    }

    function choose(index, offerId) {
        if (choosing || !panel) return;
        const view = controller.view();
        if (view.busy || view.offer?.id !== offerId || !view.offer.cards[index]) return;
        const owner = capturePanel();
        choosing = owner;
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
        action(async () => {
            try {
                const selected = await controller.pick(index, owner.strength);
                if (!owner.ownsChat()) return;
                if (selected) {
                    const held = controller.view().held;
                    if (held?.preview) previewed.add(held.id);
                    sound.play('seal');
                    refresh();
                    if (currentPanel(owner)) {
                        const surface = panel.querySelector('.director_fate_card');
                        surface.focus({ preventScroll: true });
                        surface.scrollIntoView?.({ block: 'nearest' });
                    }
                } else if (controller.view().offer?.id === view.offer.id) {
                    throw new Error('Pick incomplete');
                }
            } finally {
                if (choosing === owner) choosing = null;
            }
        }, '未生成完整事件，原牌已保留。请重试选牌或补写概述。');
    }

    function capturePanel() {
        return { panel, strength: panel?.querySelector('#director_fate_strength')?.value ?? 'medium',
            ownsChat: controller.captureScope?.() ?? (() => true) };
    }

    function currentPanel(owner) {
        return Boolean(owner.panel && owner.panel === panel && owner.ownsChat());
    }

    function prepareOnVisit() {
        const { offer, busy } = controller.view();
        if (offer && !offer.pregenerated && !busy && !attemptedOffers.has(offer.id)) {
            action(prepareCurrentOffer, '补写未完成，原牌已保留。点击「补写概述」可重试。');
        }
    }

    async function prepareCurrentOffer(owner = capturePanel(), offerId = controller.view().offer?.id) {
        if (typeof controller.prepareOffer !== 'function') return;
        const view = controller.view();
        if (!currentPanel(owner) || view.busy || !view.offer || view.offer.id !== offerId || view.offer.pregenerated) return;
        attemptedOffers.add(view.offer.id);
        const ok = await controller.prepareOffer(owner.strength, offerId);
        if (!ok && controller.view().offer?.id === view.offer.id) throw new Error('Preparation incomplete');
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

    function flipCurrentCard() {
        if (!panel) return;
        const view = controller.view();
        if (view.held?.preview && !view.busy) {
            if (previewed.has(view.held.id)) previewed.delete(view.held.id);
            else { previewed.add(view.held.id); sound.play('flip'); }
            refresh();
            return;
        }
        if (settings.reveal !== 'tap' || view.busy || view.held || view.offer || view.phase === 'applying'
            || !view.reveal || view.reveal.id !== view.bound?.id || flipped.has(view.reveal.id)) return;
        flipped.add(view.reveal.id);
        sound.play('flip');
        refresh();
        panel.querySelector('#director_fate_jump').focus();
    }

    function syncCost(view) {
        const cost = panel.querySelector('#director_fate_cost');
        if (!cost) return;
        const offer = view.offer;
        const strength = panel.querySelector('#director_fate_strength')?.value;
        // Piggyback offers arrive pre-written at one strength; only that strength picks for free.
        if (view.held && !offer) {
            cost.textContent = '牌已写好；点击牌面或「查看概述」可先看事件概要。点击「让意外发生」才会采用，正文完成后可翻牌看完整事件。';
        } else if (offer?.pregenerated && strength === offer.strength) {
            cost.textContent = '这批事件已写好，按当前强度选牌不再调用模型；点「让意外发生」才会续写剧情。';
        } else if (offer?.pregenerated) {
            cost.textContent = `这批牌已按「${labels[offer.strength] ?? labels.medium}」预先写好；改用其他强度选牌，会再调用一次模型重写牌面。点「让意外发生」就立刻续写剧情。`;
        } else {
            cost.textContent = '没有提前备好的事件时，将用当前模型一次补写三张概述。补写失败可重试；选定后点击「让意外发生」才会续写剧情。';
        }
    }

    function refresh() {
        if (!panel) return;
        if (!ownsPresentation || !ownsPresentation()) {
            ownsPresentation = controller.captureScope?.() ?? (() => true);
            // Branches inherit stored card IDs. Disclosure, in-flight clicks
            // and retry suppression belong to the chat where they occurred.
            flipped.clear();
            previewed.clear();
            attemptedOffers.clear();
            choosing = null;
            displayedOffer = null;
            error = '';
            panel.querySelector('#director_fate_strength').value = 'medium';
        }
        const view = controller.view();
        const readyId = view.offer?.pregenerated ? view.offer.id : null;
        if (readyId && displayedOffer !== readyId && Object.hasOwn(labels, view.offer.strength)) {
            panel.querySelector('#director_fate_strength').value = view.offer.strength;
        }
        displayedOffer = readyId;
        const applying = view.phase === 'applying';
        const showOffer = Boolean(view.offer) && !applying;
        const rerollSpent = showOffer && rerollsLeft(view) < 1;
        // An open offer is the choice being made. Do not show a previous reveal behind it.
        const card = view.held ?? (showOffer ? null : view.bound);
        const reveal = !view.held && !applying && !showOffer && view.reveal?.id === card?.id ? view.reveal : null;
        const previewShown = Boolean(view.held?.preview && previewed.has(view.held.id));
        const shown = Boolean(reveal && (settings.reveal === 'auto' || (settings.reveal === 'tap' && flipped.has(reveal.id))));
        const state = applying ? 'applying' : view.held ? 'sealed' : reveal ? 'revealed' : view.bound && !showOffer ? 'stale' : 'empty';
        const element = panel.querySelector('.director_fate_card');
        const hand = panel.querySelector('.director_fate_hand');
        hand.hidden = showOffer && !view.held;
        panel.dataset.hasOffer = String(showOffer);
        panel.querySelector('#director_fate_hand_label').textContent = view.held
            ? showOffer ? '保留的手牌' : '你的手牌'
            : view.bound && !showOffer ? '已采用的命运' : '牌组';
        element.hidden = showOffer && !view.held;
        element.dataset.state = state;
        // Card stock follows the rarity already printed on the back. No event text.
        if (card) element.dataset.rarity = reveal?.rarity ?? card.rarity;
        else delete element.dataset.rarity;
        element.classList.toggle('director_fate_flipped', shown || previewShown);
        const canFlip = Boolean(!view.busy && (view.held?.preview || (reveal && settings.reveal === 'tap' && !shown)));
        element.tabIndex = canFlip ? 0 : -1;
        if (canFlip) {
            element.setAttribute('role', 'button');
            element.setAttribute('aria-label', `${view.held ? previewShown ? '返回牌面' : '查看概述' : '翻开命运牌'}：${card.title}`);
            if (view.held) element.setAttribute('aria-pressed', String(previewShown));
            else element.removeAttribute('aria-pressed');
        } else {
            element.removeAttribute('role');
            element.removeAttribute('aria-label');
            element.removeAttribute('aria-pressed');
        }
        panel.classList.toggle('director_fate_nomotion', settings.motion === 'off');
        document.documentElement?.classList.toggle('director_fate_nomotion', settings.motion === 'off');
        panel.querySelector('.director_fate_back').setAttribute('aria-hidden', String(shown || previewShown));
        const face = panel.querySelector('.director_fate_face');
        const fateTheme = settings.theme === 'salon' ? 'salon' : 'apple';
        panel.dataset.fateTheme = fateTheme;
        if (popup?.dlg?.dataset) popup.dlg.dataset.fateTheme = fateTheme;
        // Do not prefill hidden text, attributes, accessibility names or tooltips.
        face.textContent = previewShown ? `事件概述（尚未采用）\n${view.held.preview}` : shown ? reveal.event : '';
        face.setAttribute('aria-hidden', String(!shown && !previewShown));
        panel.querySelector('#director_fate_title').textContent = card?.title ?? '故事的下一次转折';
        panel.querySelector('#director_fate_strength_label').textContent = card ? labels[card.strength] : '尚未抽牌';
        panel.querySelector('#director_fate_rarity').textContent = card ? rarityLabel(reveal?.rarity ?? card.rarity) : '';
        syncOffer(view);
        syncCost(view);
        const status = panel.querySelector('#director_fate_status');
        status.dataset.kind = error ? 'error' : view.busy ? 'busy' : 'idle';
        status.textContent = error || (view.busy
            ? applying ? '命运在转动…' : view.phase === 'preparing' ? '正在补写三张事件概述，请等待模型完成思考…' : '正在为当前剧情抽牌…'
            : showOffer ? (view.offer.pregenerated ? '事件已写好，按原强度选牌无需等待模型。' : '三张牌面已备好，事件尚未生成；请补写概述，或选中一张生成。') + (rerollSpent ? '本次已换过一组。' : '')
                : state === 'sealed' ? previewShown ? '正在查看概述，采用后才会续写。' : '牌已写好，点击牌面查看概述。'
                    : state === 'revealed' ? shown ? '命运已揭晓。' : settings.reveal === 'off' ? '命运已降临，翻牌已关闭。' : '命运已降临，点击翻牌。'
                        : state === 'stale' ? '这张牌的消息已变化，无法翻牌。' : '抽取一张牌，让故事迎来转折。');
        panel.querySelector('#director_fate_prepare').hidden = !showOffer || view.offer.pregenerated;
        const apply = panel.querySelector('#director_fate_apply');
        apply.hidden = !view.held;
        apply.textContent = view.held && showOffer ? `采用「${view.held.title}」` : '让意外发生';
        panel.querySelector('#director_fate_discard').hidden = !view.held;
        const flip = panel.querySelector('#director_fate_flip');
        flip.textContent = view.held?.preview ? previewShown ? '返回牌面' : '查看概述' : '翻牌';
        flip.hidden = view.held?.preview ? false : !reveal || settings.reveal !== 'tap' || shown;
        panel.querySelector('#director_fate_jump').hidden = !shown;
        for (const control of panel.querySelectorAll('#director_fate_current button, #director_fate_strength')) control.disabled = view.busy;
        // After the busy pass, so a spent swap stays disabled once the deal settles.
        syncDraw(view);
        panel.setAttribute('aria-busy', String(view.busy));
        syncLog(view);
        selectTab(activeTab);
        if (activeTab === 'log') queueLogRecovery();
    }

    function action(operation, failure) {
        const owner = capturePanel();
        error = '';
        // Start inside the user event so the controller captures its chat before
        // another queued task can replace it. Late results belong to this panel.
        void (async () => {
            try { await operation(); }
            catch (reason) { if (currentPanel(owner)) error = publicFailureMessage(reason, failure); }
            finally { if (currentPanel(owner)) refresh(); }
        })();
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
        displayedOffer = null;
        activeTab = tab === 'log' ? 'log' : 'current';
        panel = document.createElement('div');
        panel.id = 'director_fate_panel';
        const heading = document.createElement('h3');
        heading.className = 'director_fate_heading';
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
        card.addEventListener('click', flipCurrentCard);
        card.addEventListener('keydown', event => {
            if (card.getAttribute('role') !== 'button' || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            flipCurrentCard();
        });
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
        strength.addEventListener('change', refresh);
        const status = document.createElement('p');
        status.id = 'director_fate_status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const controls = document.createElement('div');
        controls.className = 'director_fate_actions';
        const draw = button('director_fate_draw', '发牌', () => {
            const currentView = controller.view();
            if (currentView.offer && rerollsLeft(currentView) < 1) return;
            const owner = capturePanel();
            // play() has to run inside the click, before the deal save yields.
            sound.play('draw');
            action(async () => {
                try {
                    if (await controller.deal()) await prepareCurrentOffer(owner);
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
        const prepare = button('director_fate_prepare', '补写概述', () => action(prepareCurrentOffer, '补写未完成，原牌已保留。点击「补写概述」可重试。'));
        const discard = button('director_fate_discard', '弃牌', () => action(() => controller.discard(), '未能弃牌，请重试。'));
        const flip = button('director_fate_flip', '翻牌', flipCurrentCard);
        const jump = button('director_fate_jump', '跳到该消息', () => {
            const reveal = controller.view().reveal;
            if (!reveal) return;
            action(() => jumpToEntry(reveal), '未能跳转到该消息。');
        });
        controls.append(draw, prepare, apply, discard, flip, jump);
        const hand = document.createElement('section');
        hand.className = 'director_fate_hand';
        const handTitle = document.createElement('h4');
        handTitle.id = 'director_fate_hand_label';
        hand.setAttribute('aria-labelledby', handTitle.id);
        hand.append(handTitle, card);
        const cost = document.createElement('small');
        cost.id = 'director_fate_cost';
        const tools = document.createElement('div');
        tools.className = 'director_fate_tools';
        tools.append(labelFor(strength, '下一张的强度'), strength);
        strength.setAttribute('aria-describedby', cost.id);
        current.append(status, hand, offer, tools, controls, cost);
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
            const owner = capturePanel();
            const result = await Popup.show.confirm('清空本局的命运记录？', '记下的命运会清掉，当前的牌和剧情消息都留着。');
            if (result !== POPUP_RESULT.AFFIRMATIVE || !currentPanel(owner)) return;
            await controller.clearLog();
        }, '未能清空记录，请重试。'));
        log.append(logList, empty, clear);
        panel.append(heading, tabs, current, log);
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
            okButton: false, cancelButton: '关闭', allowVerticalScrolling: true, onOpen: () => {
                const target = openedFocusTarget();
                if (!target) return;
                const active = document.activeElement;
                if (active === target) return;
                // Leave a tab or control the user already reached during the animation.
                if (active && panel.contains(active)) return;
                focusOpened();
            },
        });
        popup.dlg.classList?.add('director_fate_dialog');
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
            if (activeTab === 'current') prepareOnVisit();
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
