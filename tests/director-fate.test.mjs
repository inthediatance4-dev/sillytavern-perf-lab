import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from '../public/lib/eventemitter.js';
import { createFateController, FATE_PROMPT_KEY } from '../public/scripts/extensions/director/fate.js';
import { initInstructLifecycle } from '../public/scripts/extensions/director/instruct.js';

globalThis.localStorage = { getItem: () => null };

const events = Object.fromEntries([
    'CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED',
    'GENERATE_AFTER_DATA', 'GENERATION_COMPLETED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED',
    'MESSAGE_DELETED', 'GROUP_REGENERATION_STARTED', 'GROUP_REGENERATION_FINISHED',
].map(name => [name, name]));
const privateEvent = 'A sealed letter reveals {{char}} owes {{user}} a favor: {{random::a,b}}.';

test('a false save result rolls back held state just like a thrown persistence failure', async () => {
    const fixture = lab();
    fixture.context.saveMetadata = async () => false;
    await assert.rejects(fixture.controller.draw());
    assert.equal(fixture.controller.view().held, null);
});

test('native replay error unlocks actions and late success preserves a newly drawn card', async () => {
    for (const complete of [false,true]) {
        const fixture = lab();
        await fixture.adopt();
        const request = await fixture.request('swipe');
        await fixture.emit('GENERATION_ENDED');
        assert.equal(await fixture.controller.draw(),true);
        const held=fixture.metadata.director.fate.held;
        if (complete) await fixture.complete(request.data,'swipe',{append:false});
        assert.equal(fixture.metadata.director.fate.held,held);
        assert.ok(fixture.controller.view().bound);
    }
});

test('an early-return regenerate cannot shield a later manual deletion', async () => {
    const fixture = lab();
    await fixture.adopt();
    await fixture.start('regenerate');
    fixture.setGenerating(false);
    fixture.context.chat.pop();
    await fixture.emit('MESSAGE_DELETED');
    assert.equal(fixture.controller.view().bound, null);
});

test('a stopped group-regenerate partial batch can explicitly replay the same card', async () => {
    const fixture = lab({group:true});
    await fixture.adopt({generationId:100});
    const scope = {groupId:'group-one',chatId:'chat-one',generationId:100};
    await fixture.emit('GROUP_REGENERATION_STARTED', scope);
    fixture.context.chat.pop();
    await fixture.emit('MESSAGE_DELETED');
    await fixture.request();
    fixture.context.chat.push({is_user:false,name:'Bot',mes:'partial',extra:{gen_id:200}});
    await fixture.emit('MESSAGE_RECEIVED',1);
    await fixture.emit('GENERATION_STOPPED');
    await fixture.emit('GROUP_REGENERATION_FINISHED',scope);
    const retry = {...scope,generationId:200};
    await fixture.emit('GROUP_REGENERATION_STARTED',retry);
    fixture.context.chat.pop();
    await fixture.emit('MESSAGE_DELETED');
    assert.ok((await fixture.request()).token);
});

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function lab({ group = false, save } = {}) {
    const eventSource = new EventEmitter();
    let context;
    let generating = false;
    let draft = false;
    let saves = 0;
    let changes = 0;
    let serial = 0;
    let response = JSON.stringify({ event: privateEvent });
    let generator = async () => {};
    const quietCalls = [];
    const metadata = { director: { boundInstruct: { text: 'existing binding' } }, script_injects: {} };
    context = {
        eventSource, eventTypes: events, chatId: 'chat-one', chatMetadata: metadata,
        groupId: group ? 'group-one' : null, characterId: group ? undefined : 0,
        chat: [{ is_user: true, name: 'User', mes: 'Tell me what happens.' }],
        extensionPrompts: {},
        generateQuietPrompt: async options => { quietCalls.push(options); return typeof response === 'function' ? response() : response; },
        setExtensionPrompt(key, value, position, depth, scan, role) { this.extensionPrompts[key] = { value, position, depth, scan, role }; },
        saveMetadata: async () => { saves++; },
        saveMetadataDebounced: () => { saves++; },
    };
    const controller = createFateController(() => context, {
        isGenerating: () => generating, hasDraft: () => draft, save, onRegenerateStart:() => { generating=true; },
        uuid: () => `fate-${++serial}`, random: () => 0,
        generate: async capture => generator(capture), onChange: () => { changes++; },
    });
    const emit = (name, ...args) => eventSource.emit(events[name], ...args);
    const api = {
        controller, metadata, quietCalls, eventSource, emit,
        get context() { return context; }, get saves() { return saves; }, get changes() { return changes; },
        setResponse(value) { response = value; }, setGenerator(value) { generator = value; },
        setGenerating(value) { generating = value; }, setDraft(value) { draft = value; },
        switchChat(overrides = {}) { context = { ...context, chatId: 'chat-two', chatMetadata: {}, ...overrides }; return context; },
        async start(type = 'normal', dryRun = false) { await emit('GENERATION_STARTED', type, {}, dryRun); return controller.prepare(type); },
        async request(type = 'normal', { omit = false, dryRun = false } = {}) {
            await api.start(type, dryRun);
            const token = context.extensionPrompts[FATE_PROMPT_KEY]?.value;
            const data = { prompt: [{ role: 'system', content: [{ type: 'text', text: omit ? 'ordinary' : token ?? 'ordinary' }] }], input: omit ? 'ordinary' : token ?? 'ordinary' };
            await emit('GENERATE_AFTER_DATA', data, dryRun);
            return { data, token };
        },
        async complete(data, type = 'normal', { append = true, generationId = null } = {}) {
            if (append) context.chat.push({ is_user: false, name: 'Bot', mes: 'A reply.', extra: generationId === null ? {} : { gen_id: generationId } });
            await emit('MESSAGE_RECEIVED', context.chat.length - 1);
            await emit('GENERATION_ENDED');
            await emit('GENERATION_COMPLETED', { data, type, chatId: context.chatId, chatMetadata: context.chatMetadata });
        },
        async adopt({ generationId = null } = {}) {
            await controller.draw();
            let request;
            api.setGenerator(async () => { request = await api.request(); await api.complete(request.data, 'normal', { generationId }); });
            assert.equal(await controller.apply(), true);
            return request;
        },
    };
    return api;
}

test('draw persists a private event but exposes only curated title, strength and id', async () => {
    const fixture = lab();
    assert.equal(await fixture.controller.draw(), true);
    const view = fixture.controller.view();
    assert.deepEqual(Object.keys(view).sort(), ['bound', 'busy', 'held', 'phase']);
    assert.deepEqual(Object.keys(view.held).sort(), ['id', 'strength', 'title']);
    assert.equal(view.held.strength, 'medium');
    assert.equal(view.busy, false);
    assert.equal(view.phase, 'idle');
    assert.equal(JSON.stringify(view).includes(privateEvent), false);
    assert.equal(fixture.metadata.director.fate.version, 1);
    assert.equal(fixture.metadata.director.fate.held.event, privateEvent);
    assert.deepEqual(fixture.metadata.director.boundInstruct, { text: 'existing binding' });
    assert.equal(fixture.context.chat.length, 1);
    assert.equal(fixture.quietCalls[0].responseLength, 500);
    assert.match(fixture.quietCalls[0].quietPrompt, /JSON/);
    view.held.title = 'spoiler';
    assert.notEqual(fixture.controller.view().held.title, 'spoiler');
});

test('strict JSON validation never exposes invalid model text and failed redraw retains both cards', async () => {
    const fixture = lab();
    await fixture.adopt();
    await fixture.controller.draw('light');
    const before = structuredClone(fixture.metadata.director.fate);
    for (const value of ['', 'secret broken JSON', '{}', '[]', 'null', '{"event":1}', '{"event":"   "}', '{"event":"ok","title":"spoiler"}', JSON.stringify({ event: 'x'.repeat(1201) }), JSON.stringify({ event: 'bad\u0000text' })]) {
        fixture.setResponse(value);
        await assert.rejects(fixture.controller.draw(), error => !String(error).includes(value || 'secret') && /抽取失败/.test(error.message));
        assert.deepEqual(fixture.metadata.director.fate, before);
    }
    fixture.setResponse(`\`\`\`json\n${JSON.stringify({ event: '  genre-adapted twist  ' })}\n\`\`\``);
    assert.equal(await fixture.controller.draw('strong'), true);
    assert.equal(fixture.metadata.director.fate.held.event, 'genre-adapted twist');
    assert.equal(fixture.metadata.director.fate.bound.event, before.bound.event);
    await assert.rejects(fixture.controller.draw('invalid'));
});

test('draw is blocked during generation and late draw results cannot cross chat, owner or revision changes', async () => {
    for (const kind of ['chat', 'metadata', 'character', 'group', 'revision']) {
        const fixture = lab();
        const waiting = deferred();
        fixture.setResponse(() => waiting.promise);
        const drawing = fixture.controller.draw();
        assert.equal(fixture.controller.view().phase, 'drawing');
        const original = fixture.context;
        if (kind === 'chat') fixture.switchChat();
        if (kind === 'metadata') fixture.switchChat({ chatId: original.chatId });
        if (kind === 'character') original.characterId = 1;
        if (kind === 'group') original.groupId = 'other-group';
        if (kind === 'revision') await fixture.emit('CHAT_CHANGED');
        waiting.resolve(JSON.stringify({ event: privateEvent }));
        assert.equal(await drawing, false, kind);
        assert.equal(fixture.metadata.director.fate, undefined, kind);
        assert.equal(fixture.saves, 0, kind);
    }
    const fixture = lab();
    fixture.setGenerating(true);
    await assert.rejects(fixture.controller.draw());
    assert.equal(fixture.quietCalls.length, 0);
});

test('stopping a quiet draw preserves the old held card even when a valid partial response resolves', async () => {
    const fixture = lab();
    await fixture.controller.draw();
    const held = fixture.metadata.director.fate.held;
    const waiting = deferred();
    fixture.setResponse(() => waiting.promise);
    const drawing = fixture.controller.draw();
    await fixture.emit('GENERATION_STOPPED');
    waiting.resolve(JSON.stringify({ event: 'A different event.' }));
    assert.equal(await drawing, false);
    assert.equal(fixture.metadata.director.fate.held, held);
});

test('discard changes only held and a failed save restores the previous held card', async () => {
    const fixture = lab();
    await fixture.adopt();
    await fixture.controller.draw();
    const before = structuredClone(fixture.metadata.director.fate);
    fixture.context.saveMetadata = async () => { throw new Error(privateEvent); };
    await assert.rejects(fixture.controller.draw(), error => !error.message.includes(privateEvent));
    assert.deepEqual(fixture.metadata.director.fate, before);
    fixture.context.saveMetadata = async () => {};
    assert.equal(await fixture.controller.discard(), true);
    assert.equal(fixture.controller.view().held, null);
    assert.deepEqual(fixture.metadata.director.fate.bound, before.bound);
});

test('adopt rejects a draft and failed, stopped or early requests retain held without activating later Send', async () => {
    for (const kind of ['draft', 'failed', 'stopped', 'early']) {
        const fixture = lab();
        await fixture.controller.draw();
        const held = fixture.metadata.director.fate.held;
        let calls = 0;
        fixture.setDraft(kind === 'draft');
        fixture.setGenerator(async () => {
            calls++;
            if (kind === 'early') return;
            const { data } = await fixture.request();
            if (kind === 'stopped') { await fixture.emit('GENERATION_STOPPED'); await fixture.complete(data); }
            if (kind === 'failed') { await fixture.emit('GENERATION_ENDED'); throw new Error(privateEvent); }
        });
        if (kind === 'draft' || kind === 'failed') await assert.rejects(fixture.controller.apply(), error => !error.message.includes(privateEvent));
        else assert.equal(await fixture.controller.apply(), false);
        assert.equal(calls, kind === 'draft' ? 0 : 1);
        assert.equal(fixture.metadata.director.fate.held, held, kind);
        assert.equal(fixture.controller.view().bound, null, kind);
        assert.equal(fixture.context.extensionPrompts[FATE_PROMPT_KEY], undefined, kind);
        const ordinary = await fixture.request();
        assert.equal(ordinary.token, undefined, kind);
    }
});

test('adopt shields literal macros and binds only the exact assembled completed request after UI end', async () => {
    const fixture = lab();
    await fixture.controller.draw();
    const held = fixture.metadata.director.fate.held;
    fixture.setGenerator(async capture => {
        assert.equal(capture, fixture.context);
        const { data, token } = await fixture.request();
        assert.ok(token);
        assert.equal(token.includes('{{'), false);
        assert.equal(token.includes(privateEvent), false);
        assert.ok(data.prompt[0].content[0].text.includes(privateEvent));
        assert.ok(data.input.includes(privateEvent));
        assert.equal(fixture.context.extensionPrompts[FATE_PROMPT_KEY], undefined);
        await fixture.complete(structuredClone(data));
        assert.equal(fixture.metadata.director.fate.held, held);
        await fixture.complete(data, 'normal', { append: false });
    });
    assert.equal(await fixture.controller.apply(), true);
    assert.equal(fixture.controller.view().held, null);
    assert.equal(fixture.metadata.director.fate.bound.event, privateEvent);
    assert.equal(fixture.metadata.director.fate.bound.slotIndex, 1);
});

test('dry, excluded, changed-owner, missing-target and modified assembled data cannot consume held', async () => {
    for (const kind of ['dry', 'excluded', 'owner', 'anchor', 'target', 'removed', 'quiet', 'impersonate']) {
        const fixture = lab();
        await fixture.controller.draw();
        const held = fixture.metadata.director.fate.held;
        fixture.setGenerator(async () => {
            const { data } = await fixture.request('normal', { dryRun: kind === 'dry', omit: kind === 'excluded' });
            if (kind === 'owner') fixture.context.characterId = 4;
            if (kind === 'anchor') fixture.context.chat[0].mes = 'The story anchor changed during generation.';
            if (kind === 'removed') { data.prompt = 'ordinary'; data.input = 'ordinary'; }
            await fixture.complete(data, ['quiet', 'impersonate'].includes(kind) ? kind : 'normal', { append: kind !== 'target' });
        });
        assert.equal(await fixture.controller.apply(), false, kind);
        assert.equal(fixture.metadata.director.fate.held, held, kind);
    }
});

test('a stop between preparation and assembled data cannot consume held', async () => {
    const fixture = lab();
    await fixture.controller.draw();
    const held = fixture.metadata.director.fate.held;
    fixture.setGenerator(async () => {
        await fixture.start();
        const token = fixture.context.extensionPrompts[FATE_PROMPT_KEY].value;
        await fixture.emit('GENERATION_STOPPED');
        const data = { prompt: token };
        await fixture.emit('GENERATE_AFTER_DATA', data, false);
        await fixture.complete(data);
    });
    assert.equal(await fixture.controller.apply(), false);
    assert.equal(fixture.metadata.director.fate.held, held);
});

test('only exact swipe/regenerate replay a bound event, with fingerprint and target checks', async () => {
    for (const type of ['normal', 'continue', 'quiet', 'impersonate', 'swipe', 'regenerate']) {
        const fixture = lab();
        await fixture.adopt();
        await fixture.emit('GENERATION_STARTED', type, {}, false);
        if (type === 'regenerate') { fixture.setGenerating(true); fixture.context.chat.pop(); await fixture.emit('MESSAGE_DELETED'); }
        fixture.controller.prepare(type);
        const token = fixture.context.extensionPrompts[FATE_PROMPT_KEY]?.value;
        assert.equal(Boolean(token), ['swipe', 'regenerate'].includes(type), type);
        if (token) {
            const data = { prompt: token };
            await fixture.emit('GENERATE_AFTER_DATA', data, false);
            assert.ok(data.prompt.includes(privateEvent));
            await fixture.complete(data, type, { append: type === 'regenerate' });
            assert.equal(fixture.metadata.director.fate.bound.event, privateEvent);
        }
    }
    const fixture = lab();
    await fixture.adopt();
    fixture.context.chat[0].mes = 'changed anchor';
    await fixture.start('swipe');
    assert.equal(fixture.context.extensionPrompts[FATE_PROMPT_KEY], undefined);
    assert.equal(fixture.controller.view().bound, null);
});

test('draw and Fate adoption coexist with pending and bound Director instructions', async () => {
    const fixture = lab();
    const inject = { value: 'A pending director instruction', directorEphemeral: true, position: 1, depth: 0, scan: false, role: 0 };
    fixture.metadata.script_injects.pending = inject;
    fixture.context.setExtensionPrompt('script_inject_pending', inject.value, 1, 0, false, 0);
    initInstructLifecycle(() => fixture.context);
    await fixture.controller.draw();
    assert.equal(fixture.metadata.script_injects.pending, inject);
    fixture.setGenerator(async () => {
        const { data } = await fixture.request();
        data.prompt.push({ role: 'system', content: inject.value });
        // The instruction listener records inclusion on the actual data object.
        await fixture.emit('GENERATE_AFTER_DATA', data, false);
        await fixture.complete(data);
    });
    assert.equal(await fixture.controller.apply(), true);
    assert.equal(fixture.metadata.script_injects.pending, undefined);
    assert.equal(fixture.metadata.director.boundInstruct.text, inject.value);
    assert.equal(fixture.metadata.director.fate.bound.event, privateEvent);
});

test('ordinary later replies and user messages clear old bound while preserving held', async () => {
    for (const kind of ['user', 'reply']) {
        const fixture = lab();
        await fixture.adopt();
        await fixture.controller.draw();
        const held = fixture.metadata.director.fate.held;
        if (kind === 'user') await fixture.emit('MESSAGE_SENT');
        else {
            const { data, token } = await fixture.request();
            assert.equal(token, undefined);
            await fixture.complete(data);
        }
        assert.equal(fixture.controller.view().bound, null, kind);
        assert.equal(fixture.metadata.director.fate.held, held, kind);
    }
});

test('same-batch group speakers preserve binding and never activate another normal Fate request', async () => {
    const fixture = lab({ group: true });
    await fixture.controller.draw();
    fixture.setGenerator(async () => {
        fixture.context.characterId = 1;
        const first = await fixture.request();
        await fixture.complete(first.data, 'normal', { generationId: 100 });
        fixture.context.characterId = 2;
        const second = await fixture.request();
        assert.equal(second.token, undefined);
        await fixture.complete(second.data, 'normal', { generationId: 100 });
        fixture.context.characterId = undefined;
    });
    assert.equal(await fixture.controller.apply(), true);
    assert.equal(fixture.metadata.director.fate.bound.slotIndex, 1);
    assert.equal(fixture.metadata.director.fate.bound.generationId, 100);
    assert.equal(fixture.controller.view().bound.id, fixture.metadata.director.fate.bound.id);
});

test('explicit scoped group regeneration survives batch deletion and injects exactly once', async () => {
    const fixture = lab({ group: true });
    await fixture.adopt({ generationId: 100 });
    fixture.context.chat.push({ is_user: false, name: 'Other', mes: 'second', extra: { gen_id: 100 } });
    await fixture.emit('MESSAGE_RECEIVED', 2);
    const scope = { groupId: 'group-one', chatId: 'chat-one', generationId: 100 };
    await fixture.emit('GROUP_REGENERATION_STARTED', scope);
    while (fixture.context.chat.length > 1) { fixture.context.chat.pop(); await fixture.emit('MESSAGE_DELETED'); }
    const first = await fixture.request();
    assert.ok(first.token);
    await fixture.complete(first.data, 'normal', { generationId: 200 });
    const second = await fixture.request();
    assert.equal(second.token, undefined);
    await fixture.complete(second.data, 'normal', { generationId: 200 });
    await fixture.emit('GROUP_REGENERATION_FINISHED', scope);
    assert.equal(fixture.metadata.director.fate.bound.event, privateEvent);
    assert.equal(fixture.metadata.director.fate.bound.generationId, 200);
});

test('failed scoped group regeneration retains explicit retry but ordinary normal cannot replay empty slot', async () => {
    const fixture = lab({ group: true });
    await fixture.adopt({ generationId: 100 });
    const scope = { groupId: 'group-one', chatId: 'chat-one', generationId: 100 };
    await fixture.emit('GROUP_REGENERATION_STARTED', scope);
    fixture.context.chat.pop();
    await fixture.emit('MESSAGE_DELETED');
    assert.ok((await fixture.request()).token);
    await fixture.emit('GENERATION_ENDED');
    await fixture.emit('GROUP_REGENERATION_FINISHED', scope);
    assert.ok(fixture.controller.view().bound);
    assert.equal((await fixture.request()).token, undefined);
    const retry = { ...scope, generationId: null };
    await fixture.emit('GROUP_REGENERATION_STARTED', retry);
    const request = await fixture.request();
    assert.ok(request.token);
    await fixture.complete(request.data, 'normal', { generationId: 300 });
    await fixture.emit('GROUP_REGENERATION_FINISHED', retry);
    assert.equal(fixture.metadata.director.fate.bound.generationId, 300);
});

test('manual deletion, mismatched group scope and deleted same-batch members clear old bound', async () => {
    for (const kind of ['manual', 'wrong-group', 'wrong-generation', 'member']) {
        const fixture = lab({ group: true });
        await fixture.adopt({ generationId: 100 });
        await fixture.controller.draw();
        const held = fixture.metadata.director.fate.held;
        if (kind === 'wrong-group' || kind === 'wrong-generation') {
            await fixture.emit('GROUP_REGENERATION_STARTED', {
                groupId: kind === 'wrong-group' ? 'other' : 'group-one', chatId: 'chat-one', generationId: kind === 'wrong-generation' ? 999 : 100,
            });
        }
        if (kind === 'member') {
            fixture.context.chat.push({ is_user: false, name: 'Other', mes: 'second', extra: { gen_id: 100 } });
            await fixture.emit('MESSAGE_RECEIVED', 2);
        }
        fixture.context.chat.pop();
        await fixture.emit('MESSAGE_DELETED');
        assert.equal(fixture.controller.view().bound, null, kind);
        assert.equal(fixture.metadata.director.fate.held, held, kind);
        assert.equal((await fixture.request()).token, undefined, kind);
    }
});

test('failed group pre-save cancels the explicit operation and preserves its old binding', async () => {
    const fixture=lab({group:true});await fixture.adopt({generationId:100});
    const bound=fixture.metadata.director.fate.bound;
    fixture.context.saveMetadata=async()=>false;
    const marker={groupId:'group-one',chatId:'chat-one',generationId:100};
    await fixture.emit('GROUP_REGENERATION_STARTED',marker);
    assert.equal(marker.cancelled,true);
    assert.equal(fixture.metadata.director.fate.bound,bound);
});

test('a queued owner-guarded save rolls back after switching chats', async () => {
    const waiting=deferred();let writes=0;
    const fixture=lab({save:async (_context,canSave)=>{await waiting.promise;if(!canSave())return false;writes++;return true;}});
    const drawing=fixture.controller.draw();await Promise.resolve();await Promise.resolve();
    fixture.switchChat();await fixture.emit('CHAT_CHANGED');waiting.resolve();
    assert.equal(await drawing,false);assert.equal(writes,0);
    assert.equal(fixture.metadata.director.fate,undefined);
});
