import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse as parseCss } from '@adobe/css-tools';
import { parseFragment } from 'parse5';

const read = filename => readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
const extension = (name, filename) => read(`public/scripts/extensions/${name}/${filename}`);

function nodes(root) {
    return (root.childNodes ?? []).flatMap(child => [child, ...nodes(child)]);
}
function hasClass(node, name) {
    return node.attrs?.some(attribute => attribute.name === 'class' && attribute.value.split(/\s+/).includes(name));
}
function classSelectorMatches(node, selector) {
    const selectors = selector.trim().split(/\s+/).reverse();
    if (!selectors.every(part => /^\.[\w-]+$/.test(part))) return false;
    if (!hasClass(node, selectors.shift().slice(1))) return false;
    for (const ancestorClass of selectors) {
        do { node = node.parentNode; } while (node && !hasClass(node, ancestorClass.slice(1)));
        if (!node) return false;
    }
    return true;
}

test('settings drawers start collapsed and the native toggle can expand and collapse them', () => {
    // The host also uses CSS nesting, which this small declaration parser does
    // not support. Read its standalone native drawer default rule directly.
    const hostDrawerRule = read('public/style.css').match(/(?:^|\n)\.inline-drawer-content\s*\{[^{}]*\}/);
    assert.ok(hostDrawerRule, 'the host defines the native drawer default');
    const hostCss = parseCss(hostDrawerRule[0]).stylesheet.rules;
    const utils = read('public/scripts/utils.js');
    const start = utils.indexOf('export function toggleDrawer(');
    const end = utils.indexOf('\n}', start) + 2;
    assert.ok(start >= 0 && end > start, 'the native drawer toggle is present');
    const sandbox = vm.createContext({ CSS: { supports: () => true }, CustomEvent: class { constructor(type) { this.type = type; } } });
    vm.runInContext(`${utils.slice(start, end).replace(/^export /, '')}; globalThis.nativeToggle = toggleDrawer;`, sandbox);
    for (const name of ['affinity', 'director']) {
        const tree = parseFragment(extension(name, 'settings.html'));
        const content = nodes(tree).find(node => hasClass(node, 'inline-drawer-content'));
        assert.ok(content, `${name} has a native drawer body`);
        let display;
        const rules = [...hostCss, ...parseCss(extension(name, 'style.css')).stylesheet.rules];
        for (const rule of rules) {
            if (rule.type !== 'rule' || !rule.selectors.some(selector => classSelectorMatches(content, selector))) continue;
            for (const declaration of rule.declarations) if (declaration.property === 'display') display = declaration.value;
        }
        assert.equal(display, 'none', `${name} must not override the collapsed host drawer with a visible layout`);
        const icon = nodes(content.parentNode).find(node => hasClass(node, 'inline-drawer-icon'));
        const classes = new Set(icon.attrs.find(attribute => attribute.name === 'class').value.split(/\s+/));
        const nativeIcon = { classList: { add: (...names) => names.forEach(value => classes.add(value)), remove: (...names) => names.forEach(value => classes.delete(value)) } };
        const body = { style: {}, querySelectorAll: () => [] };
        const events = [];
        const drawer = {
            querySelector: selector => selector.includes('inline-drawer-icon') ? nativeIcon : body,
            dispatchEvent: event => events.push(event.type),
        };
        assert.equal(classes.has('down'), true);
        sandbox.nativeToggle(drawer, true);
        assert.equal(body.style.display, 'block');
        assert.equal(classes.has('up'), true);
        assert.equal(classes.has('down'), false);
        sandbox.nativeToggle(drawer, false);
        assert.equal(body.style.display, 'none');
        assert.equal(classes.has('down'), true);
        assert.deepEqual(events, ['inline-drawer-toggle', 'inline-drawer-toggle']);
    }
});

test('visible settings and manifest use the renamed fate-card brand', () => {
    const director = extension('director', 'settings.html');
    const affinity = extension('affinity', 'settings.html');
    const manifest = JSON.parse(extension('director', 'manifest.json'));
    assert.equal(manifest.display_name, '命运之牌');
    assert.doesNotMatch(director + affinity, /命运之笔/);
    assert.match(director, /命运之牌预设/);
    assert.match(affinity, /独立于命运之牌运行/);
    assert.equal(manifest.generate_interceptor, 'director_rebind_interceptor');
    assert.match(director, /id="director_presets"/);
    for (const id of ['director_fate_reveal', 'director_fate_sound', 'director_fate_motion']) {
        assert.match(director, new RegExp(`id="${id}"`));
        assert.match(director, new RegExp(`for="${id}"`));
    }
    assert.doesNotMatch(director, /director_fate_settings_toggle/);
});
