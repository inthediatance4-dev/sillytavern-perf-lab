import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse as parseCss } from '@adobe/css-tools';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');

const FORBIDDEN_LAYOUT_TRANSITION_PROPS = new Set([
    'all',
    'height',
    'max-height',
    'min-height',
    'width',
    'max-width',
    'min-width',
    'top',
    'left',
    'right',
    'bottom',
    'margin',
    'padding',
]);

/**
 * Strip modern @starting-style nested blocks before @adobe/css-tools AST parsing,
 * since @adobe/css-tools v4 targets flat CSS2/CSS3 rule blocks.
 * @param {string} css
 */
function stripStartingStyleBlocks(css) {
    return css.replace(/@starting-style\s*\{[^{}]*\}/g, '');
}

function collectRules(nodes, out = []) {
    for (const node of nodes ?? []) {
        if (node.type === 'rule') out.push(node);
        else if (node.rules) collectRules(node.rules, out);
    }
    return out;
}

test('apple-ui.css AST contains zero layout-thrashing transitions and keeps #sheld free of backdrop-filter', () => {
    const rawCss = read('../public/css/apple-ui.css');
    const ast = parseCss(stripStartingStyleBlocks(rawCss));
    const rules = collectRules(ast.stylesheet.rules);
    assert.ok(rules.length > 40, 'expected parsed rules from apple-ui.css');

    for (const rule of rules) {
        const selectorText = (rule.selectors ?? []).join(', ');
        for (const decl of rule.declarations ?? []) {
            if (decl.type !== 'declaration') continue;
            if (decl.property === 'transition' || decl.property === 'transition-property') {
                const tokens = decl.value
                    .split(/[,/\s]+/)
                    .map(t => t.trim().toLowerCase())
                    .filter(Boolean);
                for (const token of tokens) {
                    assert.equal(
                        FORBIDDEN_LAYOUT_TRANSITION_PROPS.has(token),
                        false,
                        `Forbidden layout-reflow transition property "${token}" in selector: ${selectorText}`,
                    );
                }
            }
        }
    }

    const sheldRule = rules.find(r => (r.selectors ?? []).some(s => s.endsWith('#sheld') && s.includes(':not(.movingUI)')));
    assert.ok(sheldRule, 'expected main #sheld layout rule');
    const backdropDecl = (sheldRule.declarations ?? []).find(d => d.property === 'backdrop-filter');
    assert.equal(backdropDecl?.value, 'none', '#sheld must not carry full-viewport backdrop-filter');

    const popupRule = rules.find(r => (r.selectors ?? []).includes('dialog.popup'));
    assert.ok(popupRule, 'expected dialog.popup rule');
    const speedDecl = (popupRule.declarations ?? []).find(d => d.property === '--popup-animation-speed');
    assert.ok(speedDecl, 'expected --popup-animation-speed token on dialog.popup');
    const speedMs = Number.parseFloat(speedDecl.value);
    assert.ok(Number.isFinite(speedMs) && speedMs > 0 && speedMs <= 200, `popup speed ${speedDecl.value} exceeds 200ms budget`);
});

test('apple-ui.js scroll & mutation observers remain passive and non-subtree to protect streaming FPS', () => {
    const source = read('../public/scripts/apple-ui.js');
    // Streaming mutates text deep inside .mes_text; observing subtree: true on #chat would fire per token.
    assert.equal(/chatObserver\.observe\(\s*chat\s*,\s*\{\s*childList:\s*true\s*\}\s*\)/.test(source), true);
    assert.equal(source.includes('subtree: true'), false, 'apple-ui.js must never attach a subtree MutationObserver');

    // High-frequency scroll/wheel/touch listeners on #chat must stay passive.
    for (const evt of ['scroll', 'wheel', 'touchstart']) {
        assert.match(
            source,
            new RegExp(`chat\\.addEventListener\\(\\s*'${evt}'[\\s\\S]{0,90}?\\{\\s*passive:\\s*true\\s*\\}`),
            `expected passive: true on #chat ${evt} listener`,
        );
    }

    // Theme cross-fade transitions must only activate under transient data-apple-transitioning, never permanently on body.
    const css = read('../public/css/apple-ui.css');
    assert.equal(css.includes('html[data-apple-transitioning="true"]'), true);
});
