/**
 * Apple Spotlight Command & Settings Palette (Cmd/Ctrl + K)
 * Lazy-mounted native <dialog>: zero startup DOM nodes, zero extra top-bar icons,
 * and zero duplicated state — indexes existing drawers, inline settings sections,
 * characters, and quick actions on demand, and hands off '/...' queries to #send_textarea.
 */

const MAX_RESULTS = 18;

let dialogEl = null;
let inputEl = null;
let listEl = null;
let emptyEl = null;
let currentItems = [];
let filteredItems = [];
let activeIndex = 0;
let previousFocus = null;
let highlightTimer = null;

function normalizeText(value) {
    return String(value ?? '').trim().toLowerCase();
}

/**
 * Scores a candidate item against a query string (higher = better match, 0 = no match).
 * Empty query returns base rank > 0 so default top suggestions appear immediately.
 * @param {{ title: string, subtitle?: string, keywords?: string }} item
 * @param {string} rawQuery
 * @returns {number}
 */
export function scoreSpotlightItem(item, rawQuery) {
    const q = normalizeText(rawQuery);
    if (!q) return 1;
    const title = normalizeText(item.title);
    const subtitle = normalizeText(item.subtitle);
    const keywords = normalizeText(item.keywords);
    const haystack = `${title} ${subtitle} ${keywords}`;

    if (title === q) return 120;
    if (title.startsWith(q)) return 95;
    if (title.includes(q)) return 75;
    if (haystack.includes(q)) return 50;

    // Subsequence match on title for compact CJK / acronym queries (e.g. "hgd" or "好感")
    let qi = 0;
    for (let i = 0; i < title.length && qi < q.length; i++) {
        if (title[i] === q[qi]) qi++;
    }
    if (qi === q.length) return 30;
    return 0;
}

function openParentDrawerIfNeeded(element) {
    const drawerContent = element?.closest?.('.drawer-content');
    if (!drawerContent || drawerContent.classList.contains('openDrawer')) return;
    const toggle = drawerContent.parentElement?.querySelector?.('.drawer-toggle');
    if (toggle) toggle.click();
}

function highlightSettingTarget(target) {
    if (!target?.classList) return;
    target.classList.add('apple-spotlight-flash');
    if (highlightTimer !== null) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
        target.classList.remove('apple-spotlight-flash');
        highlightTimer = null;
    }, 950);
}

/**
 * Builds the live searchable index from existing DOM drawers, inline sections,
 * characters, and quick actions without maintaining any parallel state store.
 * @param {Document} [doc]
 */
export function collectSpotlightItems(doc = document) {
    const items = [];

    // 1. High-frequency quick actions & shortcut hints
    const appearanceToggle = doc.getElementById?.('apple_appearance_toggle');
    if (appearanceToggle) {
        const isLight = doc.documentElement?.dataset?.appleAppearance === 'light';
        items.push({
            id: 'action:appearance',
            group: '快捷操作',
            icon: isLight ? 'fa-moon' : 'fa-sun',
            title: isLight ? '切换到深色外观 (Apple Dark)' : '切换到浅色外观 (Apple Light)',
            subtitle: '全局外观',
            keywords: 'dark light theme 深色 浅色 暗色 亮色 主题 外观',
            run: () => appearanceToggle.click(),
        });
    }

    const directorBtn = doc.getElementById?.('directorButton');
    if (directorBtn) {
        items.push({
            id: 'action:fate',
            group: '快捷操作',
            icon: 'fa-clapperboard',
            title: '打开盲抽命运牌',
            subtitle: '命运之牌',
            keywords: 'fate card director 命运 抽牌 导演',
            run: () => {
                const openBtn = doc.getElementById?.('director_fate_open');
                if (openBtn) {
                    openBtn.click();
                    return;
                }
                directorBtn.click();
                doc.getElementById?.('director_fate_open')?.click();
            },
        });
        items.push({
            id: 'action:director-menu',
            group: '快捷操作',
            icon: 'fa-wand-magic-sparkles',
            title: '打开剧情导演预设菜单',
            subtitle: '快捷键 1–9 选预设',
            keywords: 'director preset chapter 预设 章节 旁白 时间跳跃',
            run: () => directorBtn.click(),
        });
    }

    const chatEl = doc.getElementById?.('chat');
    if (chatEl && !doc.querySelector?.('#chat .welcomePanel')) {
        items.push({
            id: 'action:scroll-bottom',
            group: '快捷操作',
            icon: 'fa-arrow-down',
            title: '滚动到对话底部',
            subtitle: '对话导航',
            keywords: 'scroll bottom latest 底部 最新',
            run: () => {
                const pill = doc.getElementById?.('apple_scroll_bottom');
                if (pill) pill.click();
                else chatEl.scrollTop = chatEl.scrollHeight;
            },
        });
    }

    const newChatBtn = doc.getElementById?.('option_start_new_chat');
    if (newChatBtn) {
        items.push({
            id: 'action:new-chat',
            group: '快捷操作',
            icon: 'fa-plus',
            title: '开始新对话',
            subtitle: '对话管理',
            keywords: 'new chat 新建 开始 新对话',
            run: () => newChatBtn.click(),
        });
    }

    // 2. Top-bar settings drawers
    const drawers = doc.querySelectorAll?.('#top-settings-holder > .drawer') ?? [];
    for (const drawer of drawers) {
        if (drawer.id === 'apple_appearance_drawer') continue;
        const toggle = drawer.querySelector?.('.drawer-toggle');
        const iconEl = drawer.querySelector?.('.drawer-icon');
        const content = drawer.querySelector?.('.drawer-content');
        if (!toggle || !content) continue;
        const heading = iconEl?.getAttribute?.('title')?.trim()
            || content.querySelector?.('h3, h4')?.textContent?.trim();
        if (!heading) continue;
        items.push({
            id: `drawer:${drawer.id || heading}`,
            group: '顶栏面板',
            icon: 'fa-sliders',
            title: heading,
            subtitle: '打开顶栏设置抽屉',
            keywords: `drawer panel settings 面板 设置 ${drawer.id || ''}`,
            run: () => {
                if (!content.classList.contains('openDrawer')) toggle.click();
            },
        });
    }

    // 3. Inline settings sections across all drawers (unified settings search!)
    const inlineHeaders = doc.querySelectorAll?.('#top-settings-holder .inline-drawer > .inline-drawer-header') ?? [];
    let inlineSeq = 0;
    for (const header of inlineHeaders) {
        const label = header.textContent?.replace(/\s+/g, ' ').trim();
        if (!label || label.length > 60) continue;
        const parentDrawer = header.closest?.('.drawer-content');
        const parentIcon = parentDrawer?.parentElement?.querySelector?.('.drawer-icon');
        const parentTitle = parentIcon?.getAttribute?.('title')?.trim()
            || parentDrawer?.querySelector?.('h3, h4')?.textContent?.trim()
            || '设置';
        const inlineDrawer = header.closest?.('.inline-drawer');
        items.push({
            id: `inline:${++inlineSeq}:${label}`,
            group: '设置项直达',
            icon: 'fa-gear',
            title: label,
            subtitle: parentTitle,
            keywords: `setting config 设置 扩展 ${parentTitle}`,
            run: () => {
                openParentDrawerIfNeeded(header);
                const body = inlineDrawer?.querySelector?.(':scope > .inline-drawer-content');
                const bodyHidden = body && globalThis.getComputedStyle?.(body)?.display === 'none';
                if (bodyHidden) header.click();
                const focusTarget = inlineDrawer || header;
                focusTarget.scrollIntoView?.({ block: 'center', behavior: 'instant' });
                highlightSettingTarget(focusTarget);
            },
        });
    }

    // 4. Characters via official SillyTavern context
    const ctx = globalThis.SillyTavern?.getContext?.();
    const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
    characters.forEach((char, index) => {
        const name = String(char?.name ?? '').trim();
        if (!name) return;
        items.push({
            id: `char:${index}:${char.avatar || name}`,
            group: '角色切换',
            icon: 'fa-user',
            title: name,
            subtitle: '切换到该角色对话',
            keywords: `character 角色 ${char.avatar || ''}`,
            run: () => {
                ctx.selectCharacterById?.(index);
            },
        });
    });

    return items;
}

function buildSlashHandoffItem(query, doc = document) {
    const trimmed = String(query ?? '').trim();
    if (!trimmed.startsWith('/')) return null;
    const textarea = doc.getElementById?.('send_textarea');
    if (!textarea || textarea.disabled) return null;
    return {
        id: 'slash:handoff',
        group: '斜杠命令',
        icon: 'fa-terminal',
        title: `填入斜杠命令：${trimmed}`,
        subtitle: '回车转入输入框并唤起自动补全',
        hotkey: '↵',
        run: () => {
            textarea.value = trimmed;
            textarea.focus();
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        },
    };
}

function renderList() {
    if (!listEl || !emptyEl || !inputEl) return;
    listEl.replaceChildren();
    if (filteredItems.length === 0) {
        emptyEl.hidden = false;
        inputEl.removeAttribute('aria-activedescendant');
        return;
    }
    emptyEl.hidden = true;
    filteredItems.forEach((item, index) => {
        const li = document.createElement('li');
        li.id = `apple_spotlight_opt_${index}`;
        li.className = 'apple-spotlight-item';
        if (index === activeIndex) li.classList.add('is-active');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(index === activeIndex));

        const icon = document.createElement('i');
        icon.className = `fa-solid ${item.icon?.toLowerCase?.() || 'fa-magnifying-glass'} apple-spotlight-item-icon`;
        icon.setAttribute('aria-hidden', 'true');

        const body = document.createElement('div');
        body.className = 'apple-spotlight-item-body';
        const title = document.createElement('span');
        title.className = 'apple-spotlight-item-title';
        title.textContent = item.title;
        body.append(title);

        if (item.subtitle) {
            const sub = document.createElement('span');
            sub.className = 'apple-spotlight-item-sub';
            sub.textContent = item.subtitle;
            body.append(sub);
        }

        const badge = document.createElement('span');
        badge.className = 'apple-spotlight-item-group';
        badge.textContent = item.hotkey || item.group || '';

        li.append(icon, body, badge);
        li.addEventListener('mouseenter', () => {
            if (activeIndex === index) return;
            activeIndex = index;
            syncActiveVisuals();
        });
        li.addEventListener('click', () => executeItem(index));
        listEl.append(li);
    });
    inputEl.setAttribute('aria-activedescendant', `apple_spotlight_opt_${activeIndex}`);
}

function syncActiveVisuals() {
    if (!listEl || !inputEl) return;
    const children = [...listEl.children];
    children.forEach((node, idx) => {
        const active = idx === activeIndex;
        node.classList.toggle('is-active', active);
        node.setAttribute('aria-selected', String(active));
        if (active) node.scrollIntoView?.({ block: 'nearest' });
    });
    if (children[activeIndex]) {
        inputEl.setAttribute('aria-activedescendant', children[activeIndex].id);
    }
}

function updateFilter() {
    const q = inputEl ? inputEl.value : '';
    const slashItem = buildSlashHandoffItem(q);
    const ranked = [];
    for (const item of currentItems) {
        const score = scoreSpotlightItem(item, q);
        if (score > 0) ranked.push({ item, score });
    }
    ranked.sort((a, b) => b.score - a.score);
    filteredItems = ranked.slice(0, MAX_RESULTS).map(entry => entry.item);
    if (slashItem) {
        filteredItems.unshift(slashItem);
        filteredItems = filteredItems.slice(0, MAX_RESULTS);
    }
    activeIndex = 0;
    renderList();
}

function executeItem(index) {
    const chosen = filteredItems[index];
    if (!chosen) return;
    closeAppleSpotlight({ restoreFocus: false });
    chosen.run?.();
}

function ensureDialog() {
    if (dialogEl && dialogEl.isConnected) return dialogEl;
    dialogEl = document.createElement('dialog');
    dialogEl.id = 'apple_spotlight';
    dialogEl.className = 'apple-spotlight';
    dialogEl.setAttribute('aria-label', '全局搜索与快捷跳转');

    const shell = document.createElement('div');
    shell.className = 'apple-spotlight-shell';

    const header = document.createElement('div');
    header.className = 'apple-spotlight-header';
    const searchIcon = document.createElement('i');
    searchIcon.className = 'fa-solid fa-magnifying-glass apple-spotlight-search-icon';
    searchIcon.setAttribute('aria-hidden', 'true');

    inputEl = document.createElement('input');
    inputEl.id = 'apple_spotlight_input';
    inputEl.type = 'text';
    inputEl.autocomplete = 'off';
    inputEl.spellcheck = false;
    inputEl.placeholder = '搜索设置、角色、快捷操作，或输入 / 执行命令…';
    inputEl.setAttribute('role', 'combobox');
    inputEl.setAttribute('aria-expanded', 'true');
    inputEl.setAttribute('aria-controls', 'apple_spotlight_list');
    inputEl.setAttribute('aria-autocomplete', 'list');

    const escHint = document.createElement('kbd');
    escHint.textContent = 'Esc';
    header.append(searchIcon, inputEl, escHint);

    listEl = document.createElement('ul');
    listEl.id = 'apple_spotlight_list';
    listEl.className = 'apple-spotlight-list';
    listEl.setAttribute('role', 'listbox');

    emptyEl = document.createElement('p');
    emptyEl.className = 'apple-spotlight-empty';
    emptyEl.hidden = true;
    emptyEl.textContent = '没有匹配的设置、角色或操作';

    const footer = document.createElement('div');
    footer.className = 'apple-spotlight-footer';
    footer.innerHTML = '<span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 跳转</span><span><kbd>/</kbd> 斜杠命令</span><span><kbd>⌘K</kbd> 随时唤起</span>';

    shell.append(header, listEl, emptyEl, footer);
    dialogEl.append(shell);

    inputEl.addEventListener('input', updateFilter);
    inputEl.addEventListener('keydown', (event) => {
        if (event.isComposing) return;
        if (event.key === 'ArrowDown') {
            if (!filteredItems.length) return;
            event.preventDefault();
            activeIndex = (activeIndex + 1) % filteredItems.length;
            syncActiveVisuals();
        } else if (event.key === 'ArrowUp') {
            if (!filteredItems.length) return;
            event.preventDefault();
            activeIndex = (activeIndex - 1 + filteredItems.length) % filteredItems.length;
            syncActiveVisuals();
        } else if (event.key === 'Enter') {
            if (!filteredItems.length) return;
            event.preventDefault();
            executeItem(activeIndex);
        }
    });

    dialogEl.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeAppleSpotlight({ restoreFocus: true });
    });

    dialogEl.addEventListener('mousedown', (event) => {
        if (event.target === dialogEl) {
            closeAppleSpotlight({ restoreFocus: true });
        }
    });

    document.body.append(dialogEl);
    return dialogEl;
}

export function isAppleSpotlightOpen() {
    return Boolean(dialogEl && dialogEl.open);
}

export function closeAppleSpotlight({ restoreFocus = true } = {}) {
    if (!dialogEl || !dialogEl.open) return;
    dialogEl.close();
    const toFocus = previousFocus;
    previousFocus = null;
    if (restoreFocus && toFocus && typeof toFocus.focus === 'function' && toFocus.isConnected !== false) {
        toFocus.focus();
    }
}

export function openAppleSpotlight(initialQuery = '') {
    const dlg = ensureDialog();
    if (dlg.open) {
        if (initialQuery && inputEl) {
            inputEl.value = initialQuery;
            updateFilter();
        }
        inputEl?.focus();
        return;
    }
    previousFocus = document.activeElement;
    currentItems = collectSpotlightItems(document);
    if (inputEl) inputEl.value = initialQuery;
    updateFilter();
    dlg.showModal();
    inputEl?.focus();
    inputEl?.select?.();
}

export function toggleAppleSpotlight() {
    if (isAppleSpotlightOpen()) {
        closeAppleSpotlight({ restoreFocus: true });
    } else {
        openAppleSpotlight();
    }
}
