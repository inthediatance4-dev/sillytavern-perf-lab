const STORAGE_KEY = 'st_apple_appearance';
const DARK = 'dark';
const LIGHT = 'light';
const SCROLL_PILL_THRESHOLD_PX = 220;
const GLIDE_DURATION_MS = 180;

let transitionTimer = null;
let activeGlideFrame = null;

function isReducedMotion() {
    if (typeof document !== 'undefined' && document.body?.classList?.contains('reduced-motion')) {
        return true;
    }
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

function readStoredAppearance() {
    try {
        const value = globalThis.localStorage?.getItem(STORAGE_KEY);
        return value === LIGHT ? LIGHT : DARK;
    } catch {
        return DARK;
    }
}

function writeStoredAppearance(mode) {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, mode);
    } catch {
        // Ignore private browsing or storage quota restrictions.
    }
}

function updateToggleButton(button, mode) {
    if (!button) return;
    const isLight = mode === LIGHT;
    const label = isLight ? '切换到深色外观 (Apple Dark)' : '切换到浅色外观 (Apple Light)';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.setAttribute('aria-pressed', String(isLight));
    const icon = button.querySelector('i');
    if (icon) {
        icon.className = isLight ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    }
}

export function applyAppleAppearance(mode, { persist = true, animate = false } = {}) {
    const next = mode === LIGHT ? LIGHT : DARK;
    const root = document.documentElement;
    if (animate && !isReducedMotion() && root.dataset.appleAppearance && root.dataset.appleAppearance !== next) {
        root.dataset.appleTransitioning = 'true';
        if (transitionTimer !== null) {
            clearTimeout(transitionTimer);
        }
        transitionTimer = setTimeout(() => {
            delete root.dataset.appleTransitioning;
            transitionTimer = null;
        }, 220);
    }
    root.dataset.appleAppearance = next;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
        themeMeta.setAttribute('content', next === LIGHT ? '#f2f2f7' : '#000000');
    }
    if (persist) {
        writeStoredAppearance(next);
    }
    updateToggleButton(document.getElementById('apple_appearance_toggle'), next);
    return next;
}

function cancelActiveGlide() {
    if (activeGlideFrame !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(activeGlideFrame);
        activeGlideFrame = null;
    }
}

/**
 * Scrolls #chat to the latest message using an iOS Messages-style bounded
 * 180ms cubic-out glide (or instant jump when reduced motion is enabled).
 * @param {HTMLElement | null} chat
 * @param {{ instant?: boolean }} [options]
 */
export function scrollChatToLatest(chat, { instant = false } = {}) {
    if (!chat) return;
    cancelActiveGlide();
    const targetTop = Math.max(0, chat.scrollHeight - chat.clientHeight);
    if (instant || isReducedMotion() || typeof requestAnimationFrame !== 'function' || targetTop - chat.scrollTop <= 2) {
        chat.scrollTop = chat.scrollHeight;
        return;
    }

    const maxGlideSpan = Math.max((chat.clientHeight || 600) * 2.2, 900);
    const startTop = Math.max(chat.scrollTop, targetTop - maxGlideSpan);
    if (startTop !== chat.scrollTop) {
        chat.scrollTop = startTop;
    }
    const startTime = (globalThis.performance?.now?.() ?? Date.now());

    const step = (now) => {
        const currentTime = typeof now === 'number' ? now : (globalThis.performance?.now?.() ?? Date.now());
        const progress = Math.min(1, Math.max(0, (currentTime - startTime) / GLIDE_DURATION_MS));
        const eased = 1 - Math.pow(1 - progress, 3);
        const liveTarget = Math.max(0, chat.scrollHeight - chat.clientHeight);
        chat.scrollTop = startTop + (liveTarget - startTop) * eased;
        if (progress < 1) {
            activeGlideFrame = requestAnimationFrame(step);
        } else {
            chat.scrollTop = chat.scrollHeight;
            activeGlideFrame = null;
        }
    };

    activeGlideFrame = requestAnimationFrame(step);
}

function isElementVisible(el) {
    if (!el || el.hidden) return false;
    const style = globalThis.getComputedStyle?.(el);
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
        return false;
    }
    if ('offsetParent' in el && el.offsetParent === null && style?.position !== 'fixed') {
        return false;
    }
    return true;
}

export function syncDrawerAria(root = document) {
    const toggles = root.querySelectorAll?.('#top-settings-holder .drawer-toggle') ?? [];
    for (const toggle of toggles) {
        const content = toggle.parentElement?.querySelector?.('.drawer-content');
        if (!content) continue;
        const isOpen = content.classList.contains('openDrawer');
        toggle.setAttribute('aria-expanded', String(isOpen));
    }
}

/**
 * Global Apple keyboard ergonomics:
 * - Escape closes floating menus (#options, #extensionsMenu) or unpinned top drawers
 *   when no modal dialog, popover, message editor, or active generation owns Escape.
 * - Ctrl/Cmd + / (or bare / on document.body) focuses #send_textarea immediately.
 * @param {KeyboardEvent} event
 * @returns {boolean} Whether the shortcut was handled
 */
export function handleAppleKeydown(event) {
    if (!event || event.defaultPrevented || event.isComposing) return false;

    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (document.querySelector('dialog[open]')) return false;
        const directorPopover = document.getElementById('directorPopover');
        if (directorPopover && !directorPopover.hidden) return false;
        const higherPriorityIds = [
            'curEditTextarea',
            'mes_stop',
            'dialogue_popup',
            'select_chat_popup',
            'character_popup',
            'dialogue_del_mes_cancel',
            'logprobsViewer',
            'cfgConfig',
            'floatingPrompt',
        ];
        for (const id of higherPriorityIds) {
            if (isElementVisible(document.getElementById(id))) return false;
        }
        if (document.querySelector('.reasoning_edit_textarea')) return false;

        const optionsMenu = document.getElementById('options');
        if (isElementVisible(optionsMenu)) {
            const optionsBtn = document.getElementById('options_button');
            if (optionsBtn) optionsBtn.click();
            else optionsMenu.style.display = 'none';
            event.preventDefault();
            event.stopImmediatePropagation?.();
            return true;
        }

        const extMenu = document.getElementById('extensionsMenu');
        if (isElementVisible(extMenu)) {
            const extBtn = document.getElementById('extensionsMenuButton');
            if (extBtn) extBtn.click();
            else extMenu.style.display = 'none';
            event.preventDefault();
            event.stopImmediatePropagation?.();
            return true;
        }

        const openUnpinned = document.querySelector('.drawer-content.openDrawer:not(.pinnedOpen)');
        if (openUnpinned) {
            const toggle = openUnpinned.parentElement?.querySelector?.('.drawer-toggle');
            if (toggle) {
                toggle.click();
            } else {
                openUnpinned.classList.remove('openDrawer');
                openUnpinned.classList.add('closedDrawer');
            }
            syncDrawerAria();
            event.preventDefault();
            event.stopImmediatePropagation?.();
            return true;
        }
        return false;
    }

    const isModSlash = event.key === '/' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    const isBodySlash = event.key === '/'
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
        && !event.shiftKey
        && (event.target === document.body || event.target === document.documentElement);

    if (isModSlash || isBodySlash) {
        if (document.querySelector('dialog[open]')) return false;
        if (document.querySelector('.drawer-content.openDrawer:not(.pinnedOpen)')) return false;
        const textarea = document.getElementById('send_textarea');
        if (!textarea || textarea.disabled || !isElementVisible(textarea)) return false;

        event.preventDefault();
        textarea.focus();
        if (isBodySlash && textarea.value === '') {
            textarea.value = '/';
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
    }

    return false;
}

function mountAppearanceToggle() {
    const holder = document.getElementById('top-settings-holder');
    if (!holder || document.getElementById('apple_appearance_toggle')) return;

    const drawer = document.createElement('div');
    drawer.id = 'apple_appearance_drawer';
    drawer.className = 'drawer';

    const button = document.createElement('button');
    button.id = 'apple_appearance_toggle';
    button.type = 'button';

    const icon = document.createElement('i');
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);

    button.addEventListener('click', () => {
        const current = document.documentElement.dataset.appleAppearance === LIGHT ? LIGHT : DARK;
        applyAppleAppearance(current === LIGHT ? DARK : LIGHT, { animate: true });
    });

    drawer.append(button);
    holder.append(drawer);
    updateToggleButton(button, document.documentElement.dataset.appleAppearance || DARK);
}

function mountScrollBottomButton() {
    const chat = document.getElementById('chat');
    const formSheld = document.getElementById('form_sheld');
    if (!chat || !formSheld || document.getElementById('apple_scroll_bottom')) return;

    const pill = document.createElement('button');
    pill.id = 'apple_scroll_bottom';
    pill.type = 'button';
    pill.tabIndex = -1;
    pill.hidden = true;
    pill.setAttribute('aria-label', '滚动到底部');
    pill.setAttribute('title', '滚动到底部');

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-arrow-down';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = '回到底部';
    pill.append(icon, text);
    formSheld.append(pill);

    let scrollTicking = false;
    const updateVisibility = () => {
        scrollTicking = false;
        const distance = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
        const hasWelcome = Boolean(chat.querySelector('.welcomePanel'));
        const newContent = document.getElementById('chat_new_content');
        const streamingPillVisible = Boolean(newContent && !newContent.hidden);
        const shouldShow = distance > SCROLL_PILL_THRESHOLD_PX && !hasWelcome && !streamingPillVisible;
        if (pill.hidden === shouldShow) {
            pill.hidden = !shouldShow;
        }
    };

    const scheduleCheck = () => {
        if (scrollTicking) return;
        scrollTicking = true;
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(updateVisibility);
        } else {
            updateVisibility();
        }
    };

    pill.addEventListener('click', () => {
        pill.hidden = true;
        scrollChatToLatest(chat);
    });

    chat.addEventListener('scroll', scheduleCheck, { passive: true });
    chat.addEventListener('wheel', (e) => {
        if (e.deltaY < 0) cancelActiveGlide();
    }, { passive: true });
    chat.addEventListener('touchstart', cancelActiveGlide, { passive: true });

    if (typeof MutationObserver === 'function') {
        const chatObserver = new MutationObserver(scheduleCheck);
        chatObserver.observe(chat, { childList: true });
    }
    if (typeof ResizeObserver === 'function') {
        const resizeObserver = new ResizeObserver(scheduleCheck);
        resizeObserver.observe(chat);
    }
    updateVisibility();
}

function bindThemeSelectorSync() {
    const select = document.getElementById('themes');
    if (!select) return;
    select.addEventListener('change', () => {
        const name = String(select.value || '').trim();
        if (name === 'Apple Light') applyAppleAppearance(LIGHT, { animate: true });
        else if (name === 'Apple Dark') applyAppleAppearance(DARK, { animate: true });
    });
}

function bindDrawerAriaSync() {
    syncDrawerAria();
    document.addEventListener?.('click', () => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => syncDrawerAria());
        } else {
            syncDrawerAria();
        }
    }, { passive: true });
}

function initAppleUi() {
    applyAppleAppearance(readStoredAppearance(), { persist: false });
    mountAppearanceToggle();
    mountScrollBottomButton();
    bindThemeSelectorSync();
    bindDrawerAriaSync();
    document.addEventListener?.('keydown', handleAppleKeydown);
}

if (typeof document !== 'undefined') {
    applyAppleAppearance(readStoredAppearance(), { persist: false });
    if (document.readyState === 'loading') {
        document.addEventListener?.('DOMContentLoaded', initAppleUi, { once: true });
    } else {
        initAppleUi();
    }
}
