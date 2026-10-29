import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from '../public/lib/eventemitter.js';
import { initInstructLifecycle } from '../public/scripts/extensions/director/instruct.js';

globalThis.localStorage = { getItem: () => null };

function lifecycle() {
    const eventSource = new EventEmitter();
    const eventTypes = { GENERATE_AFTER_DATA: 'prompt', GENERATION_COMPLETED: 'completed' };
    const inject = { value: 'Director\nretry instruction', directorEphemeral: true, position: 1, depth: 0 };
    const metadata = { script_injects: { director: inject, ordinary: { value: 'ordinary' } } };
    let saves = 0;
    const prompts = [];
    let context = { eventSource, eventTypes, chatId: 'first', chatMetadata: metadata,
        setExtensionPrompt: (...args) => prompts.push(args), saveMetadata: async () => { saves++; } };
    initInstructLifecycle(() => context);
    const data = { prompt: [{ role: 'system', content: [{ type: 'text', text: inject.value }] }] };
    return { eventSource, metadata, inject, data, prompts, get saves() { return saves; },
        switchChat: () => { context = { ...context, chatId: 'second', chatMetadata: { script_injects: {} } }; },
        prompt: (request = data, dryRun = false) => eventSource.emit('prompt', request, dryRun),
        complete: (request = data) => eventSource.emit('completed', { data: request, chatMetadata: metadata, chatId: 'first' }) };
}

test('Director instruction survives failed/stopped attempts and is consumed only by a completed included request', async () => {
    const lab = lifecycle();
    await lab.prompt();
    await lab.eventSource.emit('generation_ended');
    await lab.eventSource.emit('generation_stopped');
    assert.equal(lab.metadata.script_injects.director, lab.inject);
    assert.equal(lab.saves, 0);
    const retry = structuredClone(lab.data);
    await lab.prompt(retry);
    await lab.complete(retry);
    assert.equal(lab.metadata.script_injects.director, undefined);
    assert.deepEqual(lab.metadata.script_injects.ordinary, { value: 'ordinary' });
    assert.equal(lab.saves, 1);
    assert.equal(lab.prompts[0][0], 'script_inject_director');
    await lab.complete(retry);
    assert.equal(lab.saves, 1);
});

test('dry runs, excluded instructions, replaced injections and another chat never consume a pending instruction', async () => {
    for (const kind of ['dry', 'excluded', 'replaced', 'chat', 'removed-late']) {
        const lab = lifecycle();
        if (kind === 'excluded') lab.data.prompt = 'Unrelated prompt';
        await lab.prompt(lab.data, kind === 'dry');
        if (kind === 'replaced') lab.metadata.script_injects.director = { ...lab.inject, value: 'New pending instruction' };
        if (kind === 'chat') lab.switchChat();
        if (kind === 'removed-late') lab.data.prompt = 'An extension removed the instruction';
        await lab.complete();
        assert.ok(lab.metadata.script_injects.director, kind);
        assert.equal(lab.saves, 0, kind);
        assert.equal(lab.prompts.length, 0, kind);
    }
});
