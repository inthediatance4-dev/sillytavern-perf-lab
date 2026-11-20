const STORAGE_KEY = 'st_apple_appearance';
const DARK = 'dark';
const LIGHT = 'light';

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

export function applyAppleAppearance(mode, { persist = true } = {}) {
    const next = mode === LIGHT ? LIGHT : DARK;
    document.documentElement.dataset.appleAppearance = next;
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
        applyAppleAppearance(current === LIGHT ? DARK : LIGHT);
    });

    drawer.append(button);
    holder.append(drawer);
    updateToggleButton(button, document.documentElement.dataset.appleAppearance || DARK);
}

function bindThemeSelectorSync() {
    const select = document.getElementById('themes');
    if (!select) return;
    select.addEventListener('change', () => {
        const name = String(select.value || '').trim();
        if (name === 'Apple Light') applyAppleAppearance(LIGHT);
        else if (name === 'Apple Dark') applyAppleAppearance(DARK);
    });
}

function initAppleUi() {
    applyAppleAppearance(readStoredAppearance(), { persist: false });
    mountAppearanceToggle();
    bindThemeSelectorSync();
}

if (typeof document !== 'undefined') {
    applyAppleAppearance(readStoredAppearance(), { persist: false });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAppleUi, { once: true });
    } else {
        initAppleUi();
    }
}
