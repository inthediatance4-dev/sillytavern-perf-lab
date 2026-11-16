import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import Handlebars from 'handlebars';

const templateSource = fs.readFileSync(new URL('../public/scripts/templates.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const turn = () => new Promise(resolve => setImmediate(resolve));

function renderer(options = {}) {
    const requests = [], calls = { compile: 0, sanitize: 0, localize: 0, toast: 0 };
    const engine = Handlebars.create();
    const compile = engine.compile.bind(engine);
    engine.compile = html => { calls.compile++; return compile(html); };
    class XHR {
        open(method, url, async) { Object.assign(this, { method, url, async }); }
        send() {
            requests.push(this);
            if (!this.async) this.respond(200, options.syncHtml ?? 'Synchronous {{name}}');
        }
        respond(status, text) { this.status = status; this.statusText = status === 200 ? 'OK' : 'Synthetic failure'; this.responseText = text; this.onload?.(); }
    }
    const context = vm.createContext({ XMLHttpRequest: XHR, Handlebars: engine,
        DOMPurify: { sanitize(text) { calls.sanitize++; return `sanitized:${text}`; } },
        applyLocale(text) { calls.localize++; return `${options.locale ?? 'en'}:${text}`; },
        console: { debug() {}, error() {} }, toastr: { error() { calls.toast++; } },
    });
    new vm.Script(`${templateSource}\nglobalThis.api={renderTemplateAsync,renderTemplate,preloadTemplates:typeof preloadTemplates==='function'?preloadTemplates:undefined};`).runInContext(context);
    return { api: context.api, requests, calls, engine };
}

test('preloading populates the same cache used by synchronous and asynchronous rendering', async () => {
    const h = renderer();
    assert.equal(typeof h.api.preloadTemplates, 'function');
    const warm = h.api.preloadTemplates(['/scripts/templates/panel.html']);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].async, true);
    h.requests[0].respond(200, 'Hello {{name}}');
    await warm;
    assert.equal(h.api.renderTemplate('panel', { name: 'Alice' }, false, false), 'Hello Alice');
    assert.equal(await h.api.renderTemplateAsync('panel', { name: 'Bob' }, false, false), 'Hello Bob');
    assert.equal(h.requests.length, 1, 'No synchronous request after cache preloading');
    assert.equal(h.calls.compile, 1);
});

test('50 cold asynchronous renderers share one request and compiled template while keeping their data', async () => {
    const h = renderer();
    const results = Array.from({ length: 50 }, (_, i) => h.api.renderTemplateAsync('panel', { name: `Synthetic-${i}` }, false, false));
    await turn();
    assert.equal(h.requests.length, 1, 'Cold render callers must share template I/O');
    h.requests[0].respond(200, '{{name}}');
    assert.deepEqual(await Promise.all(results), Array.from({ length: 50 }, (_, i) => `Synthetic-${i}`));
    assert.equal(h.calls.compile, 1);
});

test('a renderer joins preloading and localization and sanitization still run for every caller', async () => {
    const h = renderer({ locale: 'zh' });
    assert.equal(typeof h.api.preloadTemplates, 'function');
    const warm = h.api.preloadTemplates(['/scripts/templates/panel.html', '/scripts/templates/panel.html']);
    const rendered = h.api.renderTemplateAsync('panel', { name: '人工测试' });
    assert.equal(h.requests.length, 1);
    h.requests[0].respond(200, '<b>{{name}}</b>');
    await warm;
    assert.equal(await rendered, 'zh:sanitized:<b>人工测试</b>');
    assert.equal(h.api.renderTemplate('panel', { name: '另一次' }), 'zh:sanitized:<b>另一次</b>');
    assert.equal(h.calls.sanitize, 2);
    assert.equal(h.calls.localize, 2);
});

test('failed preloading is nonfatal, has no toast, and a normal renderer can retry', async () => {
    const h = renderer();
    assert.equal(typeof h.api.preloadTemplates, 'function');
    const warm = h.api.preloadTemplates(['/scripts/templates/good.html', '/scripts/templates/bad.html']);
    h.requests[0].respond(200, 'Good {{name}}');
    h.requests[1].respond(503, 'Synthetic unavailable');
    const statuses = await warm;
    assert.deepEqual(Array.from(statuses, x => x.status), ['fulfilled', 'rejected']);
    assert.equal(h.calls.toast, 0);
    const retry = h.api.renderTemplateAsync('bad', { name: 'Recovered' }, false, false);
    assert.equal(h.requests.length, 3);
    h.requests[2].respond(200, '{{name}}');
    assert.equal(await retry, 'Recovered');
});

test('a synchronous fallback is retained and a late asynchronous reply cannot replace its cache', async () => {
    const h = renderer({ syncHtml: 'Current {{name}}' });
    assert.equal(typeof h.api.preloadTemplates, 'function');
    const warm = h.api.preloadTemplates(['/scripts/templates/panel.html']);
    assert.equal(h.api.renderTemplate('panel', { name: 'First' }, false, false), 'Current First');
    assert.equal(h.requests[1].async, false);
    h.requests[0].respond(200, 'Older {{name}}');
    await warm;
    assert.equal(await h.api.renderTemplateAsync('panel', { name: 'Second' }, false, false), 'Current Second');
    assert.equal(h.calls.compile, 1);
});

test('template preloading keeps full-path identity and helpers registered after preloading', async () => {
    const h = renderer();
    assert.equal(typeof h.api.preloadTemplates, 'function');
    const path = '/scripts/extensions/translate/index.html';
    const warm = h.api.preloadTemplates([path]);
    h.requests[0].respond(200, '{{later name}}');
    await warm;
    h.engine.registerHelper('later', value => `Late:${value}`);
    assert.equal(await h.api.renderTemplateAsync(path, { name: 'Helper' }, false, false, true), 'Late:Helper');
    assert.equal(h.requests.length, 1);
});

test('a normal asynchronous rendering failure preserves its toast and undefined return', async () => {
    const h = renderer();
    const first = h.api.renderTemplateAsync('missing');
    h.requests[0].respond(404, 'Synthetic missing');
    assert.equal(await first, undefined);
    assert.equal(h.calls.toast, 1);
    const next = h.api.renderTemplateAsync('missing', { name: 'Retry' }, false, false);
    h.requests[1].respond(200, '{{name}}');
    assert.equal(await next, 'Retry');
});

const activationSource = fs.readFileSync(new URL('../public/scripts/extensions.js', import.meta.url), 'utf8');
const activation = activationSource.slice(activationSource.indexOf('async function activateExtensions() {'), activationSource.indexOf('\nasync function connectClickHandler()'));
function activator(entries, options = {}) {
    const paths = [], scripts = [], events = [], settings = { disabledExtensions: [...(options.disabled ?? [])] };
    const active = new Set(options.active ?? []);
    const context = vm.createContext({ manifests: Object.fromEntries(entries), CLIENT_VERSION: 'SillyTavern:1.18.0:Lab', modules: [],
        extensionLoadErrors: new Set(), activeExtensions: active, extension_settings: settings,
        sortManifestsByOrder: (a, b) => (a.loading_order ?? 0) - (b.loading_order ?? 0),
        versionCompare: (_, required) => required == null || Number(required.split('.')[0]) <= 1,
        isSubsetOf: (available, needed) => needed.every(item => available.includes(item)),
        console: { debug() {}, log() {}, error() {}, warn() {} }, $: () => ({ toggleClass() {} }),
        t: (strings, ...values) => strings.reduce((out, part, i) => out + part + (values[i] ?? ''), ''),
        preloadTemplates(urls) { paths.push(...urls); events.push('preload'); return options.preload ? options.preload() : Promise.resolve(); },
        addExtensionLocale: () => Promise.resolve(), addExtensionStyle: () => Promise.resolve(),
        addExtensionScript(name) { scripts.push(name); events.push(`script:${name}`); return options.script ? options.script(name) : Promise.resolve(); },
        async callExtensionHook(name) { events.push(`hook:${name}`); await options.hook?.(name, settings); },
    });
    new vm.Script(`${activation}\nglobalThis.activate=activateExtensions;`).runInContext(context);
    return { run: () => context.activate(), paths, scripts, events, settings };
}

test('eligible built-in templates preload before ordered script activation without waiting for preloads', async () => {
    const h = activator([['translate', { js: 'index.js', loading_order: 1 }], ['caption', { js: 'index.js', loading_order: 2 }]], {
        preload: () => new Promise(() => {}),
    });
    await h.run();
    assert.ok(h.paths.includes('scripts/extensions/translate/index.html'));
    assert.ok(h.paths.includes('scripts/extensions/caption/settings.html'));
    assert.equal(h.events[0], 'preload');
    assert.deepEqual(h.scripts, ['translate', 'caption']);
    assert.ok(h.events.indexOf('hook:translate') < h.events.indexOf('script:caption'));
});

test('disabled, active, incompatible and missing dependency/module extensions do not preload templates', async () => {
    const h = activator([['translate', { js: 'index.js' }], ['caption', { js: 'index.js' }], ['tts', { js: 'index.js', requires: ['missing'] }],
        ['vectors', { js: 'index.js', minimum_client_version: '99.0.0' }], ['memory', { js: 'index.js', dependencies: ['missing'] }],
        ['regex', { js: 'index.js' }]], { disabled: ['caption'], active: ['regex'] });
    await h.run();
    assert.deepEqual(h.paths, ['scripts/extensions/translate/index.html', 'scripts/extensions/translate/buttons.html']);
});

test('earlier hooks still control later activation after template preloading', async () => {
    const h = activator([['translate', { js: 'index.js', loading_order: 1 }], ['caption', { js: 'index.js', loading_order: 2 }]], {
        hook: (name, settings) => { if (name === 'translate') settings.disabledExtensions.push('caption'); },
    });
    await h.run();
    assert.equal(h.paths.length, 3);
    assert.deepEqual(h.scripts, ['translate']);
});

test('third-party templates are not guessed or downloaded by the built-in template plan', async () => {
    const h = activator([['third-party/Synthetic', { js: 'index.js' }]]);
    await h.run();
    assert.equal(h.paths.length, 0);
    assert.deepEqual(h.scripts, ['third-party/Synthetic']);
});

test('startup preloading feeds the actual extension wrapper cache identity', async () => {
    const plan = activator([['translate', { js: 'index.js' }]]);
    await plan.run();
    const h = renderer();
    const warm = h.api.preloadTemplates(plan.paths);
    for (const request of h.requests) request.respond(200, 'Warm {{name}}');
    await warm;
    const wrapperSource = activationSource.slice(activationSource.indexOf('export function renderExtensionTemplate('),
        activationSource.indexOf('export const extension_settings =')).replace(/^export /gm, '');
    const context = vm.createContext({ renderTemplate: h.api.renderTemplate, renderTemplateAsync: h.api.renderTemplateAsync });
    new vm.Script(`${wrapperSource}\nglobalThis.wrapper=renderExtensionTemplate;`).runInContext(context);
    assert.equal(context.wrapper('translate', 'index', { name: 'Real wrapper' }, false, false), 'Warm Real wrapper');
    assert.equal(h.requests.length, 2, 'Both planned templates serve the real wrapper without an extra synchronous request');
});

test('unknown inherited object keys do not prevent known built-in template warming', async () => {
    const h = activator([['constructor', { js: 'index.js' }], ['translate', { js: 'index.js' }]]);
    await h.run();
    assert.deepEqual(h.paths, ['scripts/extensions/translate/index.html', 'scripts/extensions/translate/buttons.html']);
    assert.deepEqual(h.scripts, ['constructor', 'translate']);
});
