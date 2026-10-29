import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const probe = await fs.readFile(new URL('../scripts/startup-browser-probe.js', import.meta.url), 'utf8');
test('startup probe retries an early context without emitting a page error, and APP_READY stays sticky', () => {
    const context = vm.createContext({});
    vm.runInContext(`
        globalThis.window = globalThis;
        globalThis.location = {href: 'http://localhost/'};
        globalThis.document = { addEventListener() {} };
        globalThis.performance = { now: () => 17, setResourceTimingBufferSize() {}, getEntriesByType: () => [] };
        globalThis.PerformanceObserver = { supportedEntryTypes: [] };
        globalThis.setInterval = callback => { globalThis.poll = callback; return 1; };
        globalThis.clearInterval = () => { globalThis.cleared = true; };
        globalThis.initialized = false;
        globalThis.listeners = {};
    `, context);
    vm.runInContext(probe, context);
    assert.doesNotThrow(() => vm.runInContext(`
        SillyTavern = { getContext() {
            if (!initialized) throw new ReferenceError("Cannot access 'chat' before initialization");
            return { eventSource: { once: (name, fn) => { listeners[name] = fn; } },
                eventTypes: { APP_READY: 'ready', EXTENSIONS_FIRST_LOAD: 'extensions' } };
        } };
        poll(); poll();
    `, context));
    assert.equal(vm.runInContext('window.__startupProbe.appReadyMs', context), null);
    vm.runInContext('initialized = true; poll(); listeners.ready(); poll();', context);
    assert.equal(vm.runInContext('window.__startupProbe.appReadyMs', context), 17);
    assert.equal(vm.runInContext('cleared', context), true);
    assert.equal(vm.runInContext('window.__startupProbe.snapshot().appReadyMs', context), 17);
});
