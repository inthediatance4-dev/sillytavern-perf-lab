import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { get_encoding } from 'tiktoken';
import { EventEmitter } from '../public/lib/eventemitter.js';
import { event_types as eventTypes } from '../public/scripts/events.js';
import { AFFINITY_PROMPT_KEY, AFFINITY_SCHEMA, createAffinityController, affinityOwners } from '../public/scripts/extensions/director/affinity.js';
import { affinityScores, applyAffinityEvaluation, createAffinityState } from '../public/scripts/extensions/director/affinity-state.js';
import { messageFingerprint } from '../public/scripts/extensions/director/instruct.js';
import { fitAffinityPrompt } from '../public/scripts/extensions/director/affinity-prompt-budget.js';

globalThis.localStorage = { getItem: () => null };
const originalDebug = console.debug;
console.debug = () => {};
after(() => { console.debug = originalDebug; });

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
let fixtureId = 0;

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function until(predicate, label) {
    for (let index = 0; index < 30 && !predicate(); index++) await turn();
    assert.ok(predicate(), label);
}

function fixture({ interval = 10, group = false, reply, initial, controllerOptions = {} } = {}) {
    const eventSource = new EventEmitter();
    const calls = [];
    const saves = [];
    const prompts = [];
    let sequence = 0;
    const id = ++fixtureId;
    let generating = false;
    let requestChat = [];
    let context;
    const extensionSettings = { director: { affinity: { enabled: true, interval } }, disabledExtensions: [] };
    const makeContext = (chatId = 'first', data = {}) => ({
        eventSource, eventTypes, chatId,
        getCurrentChatId: () => context.chatId,
        chatMetadata: data.chatMetadata ?? {},
        chat: data.chat ?? [{ is_user: true, name: '玩家', mes: '你好。', extra: {} }],
        groupId: group ? 'group' : undefined,
        characterId: 0,
        characters: [{ name: '相同名字', avatar: 'a.png' }, { name: '相同名字', avatar: 'b.png' }],
        groups: [{ id: 'group', members: ['a.png', 'b.png'] }],
        extensionSettings,
        disabledExtensions: extensionSettings.disabledExtensions,
        extensionPrompts: {},
        generateQuietPrompt: async (...args) => {
            calls.push(args);
            return reply ? reply({ args, context, calls }) : '{"events":[]}';
        },
        saveChat: async options => {
            saves.push({ chatId: context.chatId, options });
            return options?.shouldSave ? options.shouldSave() : true;
        },
        setExtensionPrompt: (key, value, position, depth, scan, role) => {
            prompts.push([key, value, position, depth, scan, role]);
            if (value) context.extensionPrompts[key] = { value, position, depth, scan, role };
            else delete context.extensionPrompts[key];
        },
    });
    context = makeContext('first', initial);
    const controller = createAffinityController(() => context, {
        uuid: () => `host-${id}-${++sequence}`,
        isGenerating: () => generating,
        ...controllerOptions,
    });
    const emit = (name, ...args) => eventSource.emit(eventTypes[name], ...args);
    const state = () => context.chatMetadata.director?.__affinity;
    const marker = message => message?.extra?.__affinity;

    function prepare(type) {
        requestChat = [];
        controller.prepare(type, requestChat);
    }

    async function begin(type = 'normal', { dry = false, params = {}, prepare = true } = {}) {
        generating = true;
        await emit('GENERATION_STARTED', type, params, dry);
        if (prepare) {
            requestChat = [];
            controller.prepare(type, requestChat);
        }
        const data = { prompt: `assembled ${type} request ` + requestChat.map(item => item.mes).join('\n') };
        await emit('GENERATE_AFTER_DATA', data, dry, { type });
        return { data, type, chatId: context.chatId, chatMetadata: context.chatMetadata };
    }

    async function receive({ type = 'normal', text = `实际回复 ${context.chat.length}`, avatar = 'a.png', completeSwipe = true, message } = {}) {
        const item = message ?? { is_user: false, name: '相同名字', mes: text, extra: {} };
        if (group) {
            item.original_avatar = avatar;
            item.force_avatar = `/thumbnail?type=avatar&file=${avatar}`;
        }
        if (!message) context.chat.push(item);
        const index = context.chat.indexOf(item);
        await emit('MESSAGE_RECEIVED', index, type);
        if (completeSwipe) finalize(item);
        return item;
    }

    function finalize(message) {
        message.swipe_id ??= 0;
        message.swipes ??= [];
        message.swipe_info ??= [];
        message.swipes[message.swipe_id] = message.mes;
        message.swipe_info[message.swipe_id] = { extra: structuredClone(message.extra) };
    }

    async function end() {
        generating = false;
        await emit('GENERATION_ENDED', context.chat.length);
    }

    async function generate(options = {}) {
        const completion = await begin(options.type ?? 'normal', options);
        const message = await receive(options);
        await end();
        await emit('GENERATION_COMPLETED', completion);
        return message;
    }

    async function switchChat(chatId = 'second', data) {
        context = makeContext(chatId, data);
        requestChat = [];
        generating = false;
        await emit('CHAT_CHANGED', chatId);
        controller.refresh();
    }

    return {
        controller, eventSource, calls, saves, prompts, emit, state, marker, begin, receive, finalize, end, generate, switchChat,
        prepare,
        get requestChat() { return requestChat; },
        get preparedMemory() { return requestChat.find(message => message.extra?.directorAffinityPrompt)?.mes; },
        get context() { return context; },
        get generating() { return generating; },
        set generating(value) { generating = value; },
    };
}

async function generateMany(lab, amount, options = {}) {
    for (let index = 0; index < amount; index++) await lab.generate(options);
}

async function settleMany(lab, amount, options = {}) {
    await generateMany(lab, amount, options);
    await lab.controller.settle();
}

function factFor(message, { owner = 'a.png', fact = '角色记得玩家明确说出的边界。' } = {}) {
    return {
        owner, kind: 'fact', fact, actor: 'character', recipient: 'user', status: 'observed',
        valence: 'none', impact: 'minor', confidence: 'high', attitudeExplicit: false, outcomeKnown: true, knownToCharacter: 'yes',
        source: { slot: message.extra.__affinity.id, quote: message.mes },
    };
}
test('all prompt fields restore affinity facts literally, including CFG and chat-message payloads', async () => {
    const lab = fixture();
    lab.context.generateQuietPrompt = async () => JSON.stringify({ events: [factFor(lab.context.chat.at(-1), { fact: '记住 {{random::甲::乙}} 和 [[输入]]' })] });
    await settleMany(lab, 10);
    assert.equal(lab.state().events.length, 1);
    await lab.begin('normal', { prepare: false });
    lab.prepare('normal');
    const token = lab.preparedMemory;
    assert.ok(token.includes('directoraffinity'));
    assert.equal(lab.context.extensionPrompts[AFFINITY_PROMPT_KEY], undefined);
    const data = { prompt: token, negative_prompt: token, nested: { input: token }, messages: [{ content: token }] };
    await lab.emit('GENERATE_AFTER_DATA', data, false, { type: 'normal' });
    assert.ok(data.prompt.includes('{{random::甲::乙}}') && data.negative_prompt.includes('[[输入]]'));
    assert.ok(data.nested.input.includes('记住') && data.messages[0].content.includes('[[输入]]'));
    for (const value of [data.prompt, data.negative_prompt, data.nested.input, data.messages[0].content]) assert.ok(!value.includes('AFFINITY_LITERAL_'));
});

test('an unknown group avatar cannot increment issued or trigger an evaluation', async () => {
    const lab = fixture({ interval: 5, group: true });
    await settleMany(lab, 4);
    const issued = lab.state().issued;
    await lab.generate({ avatar: 'unknown.png' });
    await lab.controller.settle();
    assert.equal(lab.state().issued, issued);
    assert.equal(lab.calls.length, 0);
});
test('a player marker cannot forge an accepted character receipt', async () => {
    const lab = fixture({ interval: 5 });
    await settleMany(lab, 4);
    const player = lab.context.chat[0];
    player.extra.__affinity = { ...lab.marker(player), receipt: 4 };
    lab.controller.refresh();
    await lab.controller.settle();
    assert.equal(lab.calls.length, 0);
    assert.equal(lab.marker(player)?.receipt ?? 0, 0);
});
for (const broken of [
    { version: 2, id: 'future', nextId: 1, issued: 0, cursor: 0, events: [], archives: [] },
    { version: 1, id: 'invalid', nextId: 1, issued: -1, cursor: 0, events: [], archives: [] },
    { version: 1, id: 'corrupt', nextId: 1, issued: 0, cursor: 0, events: [{ unexpected: true }], archives: [] },
]) {
    test(`unsupported or corrupt ledger ${broken.id} preserves metadata and original message markers`, async () => {
        const lab = fixture({ interval: 5, initial: { chatMetadata: { director: { __affinity: broken } } } });
        const metadata = structuredClone(lab.context.chatMetadata);
        const extra = structuredClone(lab.context.chat[0].extra);
        lab.controller.refresh();
        lab.prepare('normal');
        await settleMany(lab, 5);
        assert.deepEqual(lab.context.chatMetadata, metadata);
        assert.deepEqual(lab.context.chat[0].extra, extra);
        assert.equal(lab.calls.length, 0);
    });
}
test('opening 2000 old messages does not scan or stamp the entire transcript, and repeated prepare reuses the projection', async () => {
    let reads = 0;
    const chat = Array.from({ length: 2000 }, (_, index) => ({
        is_user: index % 2 === 0, name: index % 2 === 0 ? '玩家' : '相同名字', extra: {},
        get mes() { reads++; return `旧消息 ${index}`; },
    }));
    const lab = fixture({ initial: { chat, chatMetadata: {} } });
    lab.controller.refresh();
    await lab.controller.settle();
    assert.equal(lab.calls.length, 0);
    assert.ok(chat.filter(item => item.extra.__affinity).length <= 32, 'opening must not stamp all historical messages');
    assert.ok(reads < 200, `opening read ${reads} historical message values`);
    const before = reads;
    lab.prepare('normal');
    lab.prepare('normal');
    assert.ok(reads - before < 20, 'unchanged prepare calls must reuse their projection');
});
test('only the tenth accepted reply starts a default evaluation and repeated completion is idempotent', async () => {
    const lab = fixture();
    await settleMany(lab, 9);
    assert.equal(lab.calls.length, 0);
    const completion = await lab.begin();
    const item = await lab.receive();
    await lab.end();
    await lab.emit('GENERATION_COMPLETED', completion);
    await lab.controller.settle();
    assert.equal(lab.calls.length, 1);
    assert.ok(lab.marker(item).id.startsWith('host-'));
    const saved = structuredClone(lab.state());
    await lab.emit('MESSAGE_RECEIVED', lab.context.chat.length - 1, 'normal');
    await lab.emit('GENERATION_COMPLETED', completion);
    await lab.emit('GENERATION_ENDED', lab.context.chat.length);
    await lab.controller.settle();
    assert.deepEqual(lab.state(), saved);
    assert.equal(lab.calls.length, 1);
    assert.ok(lab.saves.length > 0, 'accepted receipt and evaluation cursor must persist');
});
test('the optional five reply interval uses the same accepted generation boundary', async () => {
    const lab = fixture({ interval: 5 });
    await settleMany(lab, 4);
    assert.equal(lab.calls.length, 0);
    await lab.generate();
    await lab.controller.settle();
    assert.equal(lab.calls.length, 1);
});
test('MESSAGE_RECEIVED and UI unlock cannot count a reply before saveReply has finalized its selected swipe', async () => {
    const lab = fixture({ interval: 5 });
    await generateMany(lab, 4);
    const completion = await lab.begin();
    await lab.end();
    const item = await lab.receive({ completeSwipe: false });
    await lab.controller.settle();
    assert.equal(lab.calls.length, 0);
    assert.equal(lab.marker(item)?.receipt ?? 0, 0);
    lab.finalize(item);
    await lab.emit('GENERATION_COMPLETED', completion);
    await lab.controller.settle();
    assert.equal(lab.calls.length, 1);
    assert.ok(lab.marker(item).receipt);
});
test('a completion cannot accept text that differs from the selected physical swipe', async () => {
    const lab = fixture({ interval: 5 });
    await generateMany(lab, 4);
    const completion = await lab.begin();
    const item = await lab.receive();
    item.swipes[item.swipe_id] = '另一个尚未保存完整的回复';
    await lab.end();
    await lab.emit('GENERATION_COMPLETED', completion);
    await lab.controller.settle();
    assert.equal(lab.calls.length, 0);
    assert.equal(lab.marker(item)?.receipt ?? 0, 0);
});
test('stopped, quiet, impersonated, and dry generations never advance accepted reply cadence', async () => {
    const lab = fixture({ interval: 5 });
    await generateMany(lab, 4);
    for (const type of ['quiet', 'impersonate']) await lab.generate({ type });
    await lab.generate({ dry: true });
    const stopped = await lab.begin();
    await lab.receive();
    await lab.emit('GENERATION_STOPPED');
    await lab.end();
    await lab.emit('GENERATION_COMPLETED', stopped);
    await lab.controller.settle();
    assert.equal(lab.calls.length, 0);
    await lab.generate();
    await lab.controller.settle();
    assert.equal(lab.calls.length, 1);
});
test('continue and appendFinal refresh their logical slot without adding a reply', async () => {
    const lab = fixture({ interval: 5 });
    await generateMany(lab, 4);
    const message = lab.context.chat.at(-1);
    const originalId = lab.marker(message).id;
    for (const type of ['continue', 'appendFinal']) {
        const completion = await lab.begin(type);
        message.mes += `，${type} 补完`;
        await lab.receive({ type, message });
        await lab.end();
        await lab.emit('GENERATION_COMPLETED', completion);
    }
    await lab.controller.settle();
    assert.equal(lab.calls.length, 0);
    assert.equal(lab.marker(message).id, originalId);
    await lab.generate();
    await lab.controller.settle();
    assert.equal(lab.calls.length, 1);
});
test('regenerate carries the replaced logical slot receipt across its physical deletion', async () => {
    const lab = fixture({ interval: 5 });
    await generateMany(lab, 4);
    const previous = lab.context.chat.at(-1);
    const originalMarker = structuredClone(lab.marker(previous));
    lab.generating = true;
    await lab.emit('GENERATION_STARTED', 'regenerate', {}, false);
    lab.context.chat.pop();
    await lab.emit('MESSAGE_DELETED', lab.context.chat.length);
    lab.prepare('regenerate');
    const data = { prompt: 'regenerate assembled request' };
    await lab.emit('GENERATE_AFTER_DATA', data, false, { type: 'normal' });
    const replacement = await lab.receive({ type: 'regenerate', text: '这是替代回复。' });
    await lab.end();
    await lab.emit('GENERATION_COMPLETED', { data, type: 'regenerate', chatId: lab.context.chatId, chatMetadata: lab.context.chatMetadata });
    await lab.controller.settle();
    assert.equal(lab.calls.length, 0);
    assert.equal(lab.marker(replacement).id, originalMarker.id);
    assert.equal(lab.marker(replacement).receipt, originalMarker.receipt);
    await lab.generate();
    await lab.controller.settle();
    assert.equal(lab.calls.length, 1);
});
test('group regeneration replaces its original logical receipts without counting the batch twice', async () => {
    const lab = fixture({ interval: 5, group: true });
    await lab.emit('GROUP_WRAPPER_STARTED', { selected_group: 'group', type: 'normal' });
    for (const avatar of ['a.png', 'b.png', 'a.png', 'b.png']) await lab.generate({ avatar });
    await lab.emit('GROUP_WRAPPER_FINISHED', { selected_group: 'group', type: 'normal' });
    await lab.controller.settle();
    const original = lab.context.chat.slice(1).map(item => structuredClone(lab.marker(item)));
    await lab.emit('GROUP_REGENERATION_STARTED', { generationId: 10 });
    lab.context.chat.splice(1);
    await lab.emit('MESSAGE_DELETED', lab.context.chat.length);
    await lab.emit('GROUP_WRAPPER_STARTED', { selected_group: 'group', type: 'normal' });
    for (const avatar of ['a.png', 'b.png', 'a.png', 'b.png']) await lab.generate({ avatar, text: `替代角色回复 ${lab.context.chat.length}` });
    await lab.emit('GROUP_WRAPPER_FINISHED', { selected_group: 'group', type: 'normal' });
    await lab.emit('GROUP_REGENERATION_FINISHED', { generationId: 10 });
    await lab.controller.settle();
    assert.equal(lab.calls.length, 0);
    assert.deepEqual(lab.context.chat.slice(1).map(item => lab.marker(item).id), original.map(item => item.id));
    assert.deepEqual(lab.context.chat.slice(1).map(item => lab.marker(item).receipt), original.map(item => item.receipt));
    await lab.generate({ avatar: 'a.png' });
    await lab.controller.settle();
    assert.equal(lab.calls.length, 1);
});
test('Director system insertions and uncorrelated ordinary NPC text never count as generated replies', async () => {
    const lab = fixture({ interval: 5 });
    await generateMany(lab, 4);
    for (const isSystem of [true, false]) {
        const item = { is_user: false, is_system: isSystem, name: '相同名字', mes: '导演插入或手写的正文。', extra: {} };
        lab.context.chat.push(item);
        lab.finalize(item);
        await lab.emit('MESSAGE_RECEIVED', lab.context.chat.length - 1, 'normal');
    }
    const completion = await lab.begin();
    const systemMessage = { is_user: false, is_system: true, name: '系统', mes: '系统生成完成提示。', extra: {} };
    lab.context.chat.push(systemMessage);
    await lab.receive({ message: systemMessage });
    await lab.end();
    await lab.emit('GENERATION_COMPLETED', completion);
    await lab.controller.settle();
    assert.equal(lab.calls.length, 0);
    await lab.generate();
    await lab.controller.settle();
    assert.equal(lab.calls.length, 1);
});
test('one evaluator request stays in flight while later complete batches remain queued', async () => {
    const pending = [];
    const lab = fixture({ reply: () => {
        const gate = deferred();
        pending.push(gate);
        return gate.promise;
    } });
    await generateMany(lab, 10);
    await until(() => lab.calls.length === 1, 'first batch must start');
    let hostFinished = false;
    const later = generateMany(lab, 20).then(() => { hostFinished = true; });
    await until(() => hostFinished, 'sidecar must not block host generation events');
    await later;
    assert.equal(lab.calls.length, 1, 'parallel evaluations are forbidden');
    pending[0].resolve('{"events":[]}');
    await until(() => lab.calls.length === 2, 'second complete batch must remain queued');
    assert.equal(pending.length, 2);
    pending[1].resolve('{"events":[]}');
    await until(() => lab.calls.length === 3, 'third complete batch must remain queued');
    pending[2].resolve('{"events":[]}');
    await lab.controller.settle();
    assert.equal(lab.calls.length, 3);
});
test('group replies accumulate across actual avatars and evaluate after the entire wrapper finishes', async () => {
    const lab = fixture({ interval: 5, group: true });
    await settleMany(lab, 4);
    await lab.emit('GROUP_WRAPPER_STARTED', { selected_group: 'group', type: 'normal' });
    await lab.generate({ avatar: 'a.png', text: '甲角色完成的回复。' });
    await lab.generate({ avatar: 'b.png', text: '乙角色完成的回复。' });
    await turn();
    assert.equal(lab.calls.length, 0, 'a group member cannot trigger evaluation mid wrapper');
    await lab.emit('GROUP_WRAPPER_FINISHED', { selected_group: 'group', type: 'normal' });
    await lab.controller.settle();
    assert.equal(lab.calls.length, 1, 'one group batch must use one evaluator request');
    const request = JSON.stringify(lab.calls[0]);
    assert.ok(request.includes('a.png'));
    assert.ok(request.includes('b.png'));
    assert.equal(lab.context.chat.at(-2).name, lab.context.chat.at(-1).name);
});
test('a group fact belongs to the source avatar even when character display names are equal', async () => {
    const fact = '乙角色记得玩家希望先敲门。';
    const lab = fixture({ interval: 5, group: true, reply: ({ context }) => JSON.stringify({
        events: [factFor(context.chat.at(-1), { owner: 'b.png', fact })],
    }) });
    await lab.emit('GROUP_WRAPPER_STARTED', { selected_group: 'group', type: 'normal' });
    await generateMany(lab, 4, { avatar: 'a.png' });
    await lab.generate({ avatar: 'b.png', text: '乙角色答应尊重玩家希望先敲门的边界。' });
    await lab.emit('GROUP_WRAPPER_FINISHED', { selected_group: 'group', type: 'normal' });
    await lab.controller.settle();
    assert.equal(lab.state().events.length, 1);
    assert.equal(lab.state().events[0].owner, 'b.png');
    lab.context.characterId = 0;
    lab.prepare('normal');
    assert.equal(lab.preparedMemory, undefined);
    lab.context.characterId = 1;
    lab.prepare('normal');
    const token = lab.preparedMemory;
    const data = { prompt: token };
    await lab.emit('GENERATE_AFTER_DATA', data, false, { type: 'normal' });
    assert.ok(data.prompt.includes(fact));
});
test('a new main generation cancels only the current sidecar and ignores its late result', async () => {
    const gate = deferred();
    let proposal;
    const lab = fixture({ interval: 5, reply: ({ context }) => {
        proposal = factFor(context.chat.at(-1));
        return gate.promise;
    } });
    await generateMany(lab, 5);
    await until(() => lab.calls.length === 1, 'evaluation must be awaiting');
    const signal = lab.calls[0][0].signal;
    assert.equal(signal.aborted, false);
    const completion = await lab.begin();
    assert.equal(signal.aborted, true, 'main generation must cancel the sidecar request');
    gate.resolve(JSON.stringify({ events: [proposal] }));
    await turn();
    assert.equal(lab.state().events.length, 0);
    await lab.receive();
    await lab.end();
    await lab.emit('GENERATION_COMPLETED', completion);
    await lab.controller.settle();
    assert.equal(lab.calls.length, 1);
    assert.equal(lab.state().events.length, 0);
});
test('scope changes discard a late evaluator answer without writing into either chat', async () => {
    const gate = deferred();
    let proposal;
    const lab = fixture({ interval: 5, reply: ({ context }) => {
        proposal = factFor(context.chat.at(-1));
        return gate.promise;
    } });
    await generateMany(lab, 5);
    await until(() => lab.calls.length === 1, 'evaluation must be awaiting');
    const originalMetadata = lab.context.chatMetadata;
    await lab.switchChat();
    const currentMetadata = lab.context.chatMetadata;
    gate.resolve(JSON.stringify({ events: [proposal] }));
    await lab.controller.settle();
    assert.equal(originalMetadata.director.__affinity.events.length, 0);
    assert.equal(currentMetadata.director?.__affinity?.events?.length ?? 0, 0);
    assert.equal(lab.preparedMemory, undefined);
});
test('switching to a chat with a complete pending batch resumes it after stale work finishes', async () => {
    const gate = deferred();
    const lab = fixture({ interval: 5, reply: ({ calls }) => calls.length === 1 ? gate.promise : '{"events":[]}' });
    await generateMany(lab, 5);
    await until(() => lab.calls.length === 1, 'old chat evaluation must be awaiting');
    const pendingChat = structuredClone({ chat: lab.context.chat, chatMetadata: lab.context.chatMetadata });
    await lab.switchChat('second', pendingChat);
    gate.resolve('{"events":[]}');
    await lab.controller.settle();
    assert.equal(lab.calls.length, 2, 'chat refresh must survive an unrelated in-flight worker');
});
test('editing a source while evaluation waits invalidates its answer before commit', async () => {
    const gate = deferred();
    let proposal;
    const lab = fixture({ interval: 5, reply: ({ context }) => {
        proposal = factFor(context.chat.at(-1));
        return gate.promise;
    } });
    await generateMany(lab, 5);
    await until(() => lab.calls.length === 1, 'evaluation must be awaiting');
    const source = lab.context.chat.at(-1);
    source.mes = '玩家编辑后的不同事实。';
    lab.finalize(source);
    await lab.emit('MESSAGE_UPDATED', lab.context.chat.length - 1);
    gate.resolve(JSON.stringify({ events: [proposal] }));
    await lab.controller.settle();
    assert.equal(lab.state().events.length, 0);
    lab.prepare('normal');
    assert.equal(lab.preparedMemory, undefined);
});
test('persistent receipts survive structuredClone reload and do not re-evaluate the old batch', async () => {
    const first = fixture({ interval: 5 });
    await settleMany(first, 5);
    assert.equal(first.calls.length, 1);
    const persisted = structuredClone({ chat: first.context.chat, chatMetadata: first.context.chatMetadata });
    const reloaded = fixture({ interval: 5, initial: persisted });
    reloaded.controller.refresh();
    await reloaded.controller.settle();
    assert.equal(reloaded.calls.length, 0);
    await settleMany(reloaded, 4);
    assert.equal(reloaded.calls.length, 0);
    await reloaded.generate();
    await reloaded.controller.settle();
    assert.equal(reloaded.calls.length, 1);
});
test('a persisted completed fact is injected after reload before any further evaluation', async () => {
    const fact = '角色记得玩家不愿被公开叫小名。';
    const first = fixture({ interval: 5, reply: ({ context }) => JSON.stringify({
        events: [factFor(context.chat.at(-1), { fact })],
    }) });
    await settleMany(first, 5);
    const reloaded = fixture({ interval: 5, initial: structuredClone({
        chat: first.context.chat, chatMetadata: first.context.chatMetadata,
    }) });
    reloaded.prepare('normal');
    const token = reloaded.preparedMemory;
    assert.equal(typeof token, 'string');
    const data = { prompt: token };
    await reloaded.emit('GENERATE_AFTER_DATA', data, false, { type: 'normal' });
    assert.ok(data.prompt.includes(fact));
    assert.equal(reloaded.calls.length, 0);
});
for (const mutation of ['MESSAGE_UPDATED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED', 'MESSAGE_DELETED']) {
    test(`${mutation} removes facts whose live source no longer matches`, async () => {
        const lab = fixture({ interval: 5, reply: ({ context }) => JSON.stringify({ events: [factFor(context.chat.at(-1))] }) });
        await settleMany(lab, 5);
        assert.equal(lab.state().events.length, 1, 'a grounded fact must commit before mutation');
        const index = lab.context.chat.length - 1;
        if (mutation === 'MESSAGE_DELETED') lab.context.chat.pop();
        else {
            const message = lab.context.chat[index];
            message.mes = '完全不同的替代正文。';
            if (mutation === 'MESSAGE_SWIPED') message.swipe_id = 1;
            lab.finalize(message);
        }
        await lab.emit(mutation, mutation === 'MESSAGE_DELETED' ? lab.context.chat.length : index);
        await lab.controller.settle();
        assert.equal(lab.state().events.length, 0);
        lab.prepare('normal');
        assert.equal(lab.preparedMemory, undefined);
    });
}
test('prepare installs literal hidden memory before assembly and restores macros only in generated data', async () => {
    const fact = '角色记得玩家写下 {{user}}，并尊重个人边界。';
    const lab = fixture({ interval: 5, reply: ({ context }) => JSON.stringify({ events: [factFor(context.chat.at(-1), { fact })] }) });
    await settleMany(lab, 5);
    assert.equal(lab.state().events.length, 1);
    lab.prepare('normal');
    const token = lab.preparedMemory;
    assert.equal(typeof token, 'string');
    assert.ok(token.length > 0);
    assert.equal(token.includes('{{'), false, 'prompt assembly must see protected macro delimiters');
    assert.ok(token.length >= fact.length, 'assembly must reserve the complete memory text');
    assert.equal(token.includes(fact), false);
    const data = { prompt: [{ role: 'system', content: [{ type: 'text', text: `prefix ${token}` }] }], input: token };
    await lab.emit('GENERATE_AFTER_DATA', data, false, { type: 'normal' });
    assert.ok(data.prompt[0].content[0].text.includes(fact));
    assert.ok(data.input.includes('{{user}}'));
    assert.equal(data.input.includes('好感度：'), false);
    assert.equal(/[-+]\d+\s*(分|points)/i.test(data.input), false);
    lab.prepare('quiet');
    assert.equal(lab.preparedMemory, undefined);
});
for (const verification of ['confirm', 'defer', 'reject']) {
    test(`major attitude evidence receives one isolated verification (${verification}) with no minor fallback`, async () => {
        let proposal;
        const lab = fixture({ interval: 5, reply: ({ context, args }) => {
            if (args[0].jsonSchema.name === 'relationship_verification') {
                if (verification === 'reject') throw new Error('synthetic verifier failure');
                const prompt = args[0].quietPrompt;
                const packet = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
                return JSON.stringify({ confirmed: verification === 'confirm' ? packet.candidates.map(candidate => candidate.key) : [] });
            }
            proposal ??= {
                ...factFor(context.chat.at(-1)), kind: 'attitude', valence: 'positive', impact: 'major',
                attitudeExplicit: true, fact: '角色明确表示现在完全信任玩家。',
            };
            return JSON.stringify({ events: [proposal] });
        } });
        await settleMany(lab, 5);
        assert.equal(lab.calls.length, 2);
        assert.ok(lab.calls.every(call => call[0].isolated === true && call[0].jsonSchema));
        assert.equal(lab.state().events.length, 1);
        assert.equal(lab.state().events[0].delta, verification === 'confirm' ? 5 : 0);
        assert.equal(lab.state().events[0].verified, verification === 'confirm');
        await settleMany(lab, 5);
        assert.equal(lab.calls.length, 3, 'the same candidate cannot trigger another verification');
        assert.equal(lab.state().events.length, 1);
    });
}
for (const [label, fields] of [['secret player action', { knownToCharacter: 'no' }], ['implicit attitude', { attitudeExplicit: false }], ['neutral fact', { kind: 'fact', valence: 'none' }]]) {
    test(`ineligible major evidence (${label}) never reaches the verifier`, async () => {
        const lab = fixture({ interval: 5, reply: ({ context, args }) => {
            assert.notEqual(args[0].jsonSchema.name, 'relationship_verification');
            return JSON.stringify({ events: [{ ...factFor(context.chat.at(-1)), kind: 'attitude', valence: 'positive', impact: 'major',
                attitudeExplicit: true, fact: '角色明确表示现在完全信任玩家。', ...fields }] });
        } });
        await settleMany(lab, 5);
        assert.equal(lab.calls.length, 1);
        assert.equal(lab.calls.some(call => call[0].jsonSchema.name === 'relationship_verification'), false);
        assert.ok(lab.state().events.every(event => event.verified === false));
    });
}
test('a future promise stays an unresolved zero point anchor even if proposed with major impact', async () => {
    const lab = fixture({ interval: 5, reply: ({ context }) => JSON.stringify({ events: [{
        ...factFor(context.chat.at(-1)), kind: 'promise', status: 'agreed', outcomeKnown: false,
        valence: 'positive', impact: 'major', fact: '角色约定明天归还玩家的书。',
    }] }) });
    await settleMany(lab, 5, { text: '我明天把你的书还给你。' });
    assert.equal(lab.calls.length, 1);
    assert.equal(lab.state().events.length, 1);
    assert.equal(lab.state().events[0].kind, 'promise');
    assert.equal(lab.state().events[0].delta, 0);
    assert.ok(lab.state().events[0].id.includes(':p:'));
});
test('save rejection does not reject host completion and a later receipt retries persistence', async () => {
    const lab = fixture({ interval: 5 });
    let saveCalls = 0;
    lab.context.saveChat = async () => {
        saveCalls++;
        if (saveCalls === 1) throw new Error('synthetic save failure');
        return true;
    };
    await settleMany(lab, 5);
    assert.equal(lab.calls.length, 1);
    assert.ok(saveCalls >= 2);
    assert.equal(lab.context.chat.filter(message => !message.is_user).length, 5);
});
test('a deferred metadata save receives a scope guard that closes after a chat switch', async () => {
    const gate = deferred();
    const lab = fixture();
    let shouldSave;
    lab.context.saveChat = async options => {
        shouldSave = options.shouldSave;
        return gate.promise;
    };
    await lab.generate();
    await until(() => !!shouldSave, 'accepted receipt must request a guarded save');
    assert.equal(shouldSave(), true);
    await lab.switchChat();
    assert.equal(shouldSave(), false);
    gate.resolve(false);
    await lab.controller.settle();
    assert.equal(lab.calls.length, 0);
});
test('evaluation uses an isolated JSON quiet request and disabling affinity clears injection immediately', async () => {
    const lab = fixture({ interval: 5, reply: ({ context }) => JSON.stringify({ events: [factFor(context.chat.at(-1))] }) });
    await settleMany(lab, 5);
    assert.equal(lab.calls.length, 1);
    const options = lab.calls[0].find(value => value && typeof value === 'object' && !Array.isArray(value));
    assert.equal(options?.isolated, true);
    assert.ok(options?.jsonSchema, 'the current provider adapter must request structured JSON');
    lab.prepare('normal');
    assert.ok(lab.preparedMemory);
    lab.context.extensionSettings.director.affinity.enabled = false;
    lab.controller.refresh();
    lab.prepare('normal');
    assert.equal(lab.preparedMemory, undefined);
    await settleMany(lab, 5);
    assert.equal(lab.calls.length, 1);
});
test('a disabled Director extension also gates affinity generation and injection', async () => {
    const lab = fixture({ interval: 5 });
    lab.context.extensionSettings.disabledExtensions.push('director');
    lab.controller.refresh();
    await settleMany(lab, 6);
    assert.equal(lab.calls.length, 0);
    assert.equal(lab.preparedMemory, undefined);
});
test('evaluator rejection and malformed JSON are contained and the next complete batch still evaluates', async () => {
    for (const failure of ['reject', 'json']) {
        const errors = [];
        const originalError = console.error;
        console.error = (...args) => errors.push(args);
        try {
            const lab = fixture({ interval: 5, reply: ({ calls }) => {
                if (calls.length === 1) {
                    if (failure === 'reject') throw new Error('synthetic evaluator failure');
                    return 'assistant: {"events":[]}';
                }
                return '{"events":[]}';
            } });
            await settleMany(lab, 5);
            assert.equal(lab.calls.length, 1);
            assert.equal(lab.state().events.length, 0);
            await settleMany(lab, 5);
            assert.equal(lab.calls.length, 2);
            assert.equal(errors.length, 0, 'a rejected event listener would be logged by the real EventEmitter');
        } finally {
            console.error = originalError;
        }
    }
});

test('roster unavailability freezes history without evaluation or injection and live evidence restores it', async () => {
    const lab = fixture({ interval: 5, group: true, reply: ({ context }) => JSON.stringify({ events: [{
        ...factFor(context.chat.at(-1), { owner: 'b.png' }), kind: 'attitude', valence: 'positive', attitudeExplicit: true,
    }] }) });
    await settleMany(lab, 5, { avatar: 'b.png' });
    assert.equal(affinityScores(lab.state())['b.png'], 2);
    lab.context.characterId = 1;
    lab.context.groups[0].members = [];
    await lab.emit('GROUP_UPDATED');
    await lab.controller.settle();
    assert.equal(lab.state().events.length, 1);
    assert.equal(lab.state().events[0].offline, true);
    assert.equal(lab.state().events[0].delta, 0);
    assert.equal(affinityScores(lab.state())['b.png'], 0);
    lab.prepare('normal');
    assert.equal(lab.preparedMemory, undefined);
    assert.equal(lab.calls.length, 1);
    lab.context.groups[0].members = ['a.png', 'b.png'];
    await lab.emit('GROUP_UPDATED');
    await lab.controller.settle();
    assert.equal(affinityScores(lab.state())['b.png'], 2);
    lab.prepare('normal');
    assert.ok(lab.preparedMemory);
    assert.equal(lab.calls.length, 1);
    lab.context.groups[0].members = [];
    await lab.emit('GROUP_UPDATED');
    lab.context.chat.at(-1).mes = '乙的原话已被真实修改。';
    await lab.emit('MESSAGE_EDITED', lab.context.chat.length - 1);
    await lab.controller.settle();
    assert.equal(lab.state().events.length, 0, 'offline status cannot protect a real edit');
});

for (const order of ['neutral-first', 'positive-first']) {
    test(`major verification follows only the candidate that survives evidence dedupe (${order})`, async () => {
        const lab = fixture({ interval: 5, reply: ({ context, args }) => {
            if (args[0].jsonSchema.name === 'relationship_verification') {
                assert.equal(order, 'neutral-first');
                const packet = JSON.parse(args[0].quietPrompt.split('\n').slice(1).join('\n'));
                assert.equal(packet.candidates.length, 1);
                assert.equal(packet.candidates[0].proposal.valence, 'positive');
                assert.equal(packet.candidates[0].proposal.impact, 'major');
                return JSON.stringify({ confirmed: [packet.candidates[0].key] });
            }
            const base = { ...factFor(context.chat.at(-1)), kind: 'attitude', attitudeExplicit: true };
            const positive = { ...base, valence: 'positive', impact: order === 'neutral-first' ? 'major' : 'minor' };
            const other = { ...base, valence: order === 'neutral-first' ? 'none' : 'negative', impact: 'major' };
            return JSON.stringify({ events: order === 'neutral-first' ? [other, positive, positive] : [positive, other] });
        } });
        await settleMany(lab, 5);
        assert.equal(lab.calls.length, order === 'neutral-first' ? 2 : 1);
        assert.equal(lab.state().events.length, 1);
        assert.equal(affinityScores(lab.state())['a.png'], order === 'neutral-first' ? 5 : 2);
    });
}

for (const invalid of ['unknown owner', 'unknown source']) {
    test(`major verification rejects ${invalid} before another provider request`, async () => {
        const lab = fixture({ interval: 5, reply: ({ context, args }) => {
            assert.equal(args[0].jsonSchema.name, 'relationship_evidence');
            const item = { ...factFor(context.chat.at(-1)), kind: 'attitude', valence: 'positive', impact: 'major', attitudeExplicit: true };
            if (invalid === 'unknown owner') item.owner = 'invented.png';
            else item.source.slot = 'never-projected';
            return JSON.stringify({ events: [item] });
        } });
        await settleMany(lab, 5);
        assert.equal(lab.calls.length, 1);
        assert.equal(lab.state().events.length, 0);
    });
}

for (const verification of ['confirm', 'defer']) {
    test(`a stored zero outcome receives its later major verification once with its old result outside the new batch (${verification})`, async () => {
        let evaluations = 0;
        let later;
        const lab = fixture({ interval: 5, reply: ({ context, args }) => {
            if (args[0].jsonSchema.name === 'relationship_verification') {
                const packet = JSON.parse(args[0].quietPrompt.split('\n').slice(1).join('\n'));
                assert.equal(packet.candidates.length, 1);
                assert.equal(packet.candidates[0].proposal.valence, 'positive');
                assert.ok(packet.messages.some(message => message.slot === context.chat[1].extra.__affinity.id), 'the earlier completed result reaches the verifier');
                return JSON.stringify({ confirmed: verification === 'confirm' ? [packet.candidates[0].key] : [] });
            }
            evaluations++;
            const source = context.chat[0];
            const result = context.chat[1];
            const anchor = { ...factFor(source), actor: 'user', recipient: 'character', kind: 'promise', status: 'agreed', outcomeKnown: null };
            const silent = { ...anchor, kind: 'outcome', status: 'completed', outcomeKnown: true,
                anchorId: `${context.chatMetadata.director.__affinity.id}:p:1`, result: { slot: result.extra.__affinity.id, quote: result.mes }, valence: 'none', impact: 'major' };
            if (evaluations === 1) return JSON.stringify({ events: [anchor, silent] });
            later ??= { ...silent, valence: 'positive', acknowledgement: { slot: context.chat.at(-1).extra.__affinity.id, quote: context.chat.at(-1).mes } };
            return JSON.stringify({ events: [later] });
        } });
        await settleMany(lab, 5);
        const id = lab.state().events.find(event => event.kind === 'outcome').id;
        assert.equal(affinityScores(lab.state())['a.png'], 0);
        await settleMany(lab, 5);
        assert.equal(lab.calls.length, 3, 'the later acknowledged major gets one verification');
        assert.equal(affinityScores(lab.state())['a.png'], verification === 'confirm' ? 5 : 0);
        assert.equal(lab.state().events.find(event => event.kind === 'outcome').id, id);
        assert.equal(lab.state().events.length, 2);
        await settleMany(lab, 5);
        assert.equal(lab.calls.length, 4, 'the same verified candidate cannot request verification again');
        assert.equal(affinityScores(lab.state())['a.png'], verification === 'confirm' ? 5 : 0);
    });
}

test('only canonical character avatars from the project can own relationships', () => {
    const characters = [{ avatar: 'character' }, { avatar: '__proto__' }, { avatar: ' a.png' }];
    assert.deepEqual(affinityOwners({ characters, groupId: 'g', groups: [{ id: 'g', members: ['character', 'missing.png', '__proto__', ' a.png'] }] }), [{ id: 'character', name: 'character' }]);
    assert.deepEqual(affinityOwners({ characters: {}, groups: null, groupId: 'g' }), []);
});

for (const type of ['quiet', 'impersonate']) {
    test(`concurrent ${type} cannot inherit memory or invalidate an accepted normal reply`, async () => {
        const fact = '先问候再提问，保留 {{user}} 和 <uSeR>\r\n原样。';
        const lab = fixture({ interval: 5, reply: ({ context }) => JSON.stringify({ events: [factFor(context.chat.at(-1), { fact })] }) });
        await settleMany(lab, 5);
        const issued = lab.state().issued;
        await lab.emit('GENERATION_STARTED', 'normal', {}, false);
        lab.prepare('normal');
        const memory = lab.preparedMemory;
        assert.ok(memory);
        assert.ok(memory.length > fact.length);
        assert.equal(lab.context.extensionPrompts[AFFINITY_PROMPT_KEY], undefined);
        await lab.emit('GENERATION_STARTED', type, {}, false);
        const sideChat = [];
        lab.controller.prepare(type, sideChat);
        assert.equal(sideChat.length, 0);
        // Even an accidentally copied frame must not disclose private evidence.
        const sideData = { prompt: memory };
        await lab.emit('GENERATE_AFTER_DATA', sideData, false, { type });
        assert.equal(sideData.prompt, '');
        await lab.emit('GENERATION_ENDED');
        await lab.emit('GENERATION_COMPLETED', { data: sideData, type, chatId: lab.context.chatId, chatMetadata: lab.context.chatMetadata });
        const data = { prompt: memory, negative_prompt: memory };
        await lab.emit('GENERATE_AFTER_DATA', data, false, { type: 'normal' });
        assert.ok(data.prompt.includes(fact));
        assert.ok(data.negative_prompt.includes(fact));
        assert.equal(data.prompt.includes('directoraffinity'), false);
        const message = await lab.receive({ text: 'A completed normal reply after the other request.' });
        await lab.end();
        await lab.emit('GENERATION_COMPLETED', { data, type: 'normal', chatId: lab.context.chatId, chatMetadata: lab.context.chatMetadata });
        await lab.controller.settle();
        assert.equal(lab.state().issued, issued + 1);
        assert.equal(lab.marker(message).receipt, issued + 1);
    });
}

test('unknown complete memory frames fail closed while ordinary legacy-looking text stays literal', async () => {
    const lab = fixture();
    const unknown = '\uE010directoraffinity999xunknown\uE011PRIVATE_UNKNOWN_BODY\uE012directoraffinity999xunknown\uE013';
    const data = { prompt: unknown + ' / AFFINITY_LITERAL_old_marker_END', negative_prompt: unknown };
    await lab.emit('GENERATE_AFTER_DATA', data, false, { type: 'normal' });
    assert.equal(data.prompt, ' / AFFINITY_LITERAL_old_marker_END');
    assert.equal(data.negative_prompt, '');
});

test('an overlapping dry run restores its own frame without taking the normal reply receipt', async () => {
    const lab = fixture({ interval: 5, reply: ({ context }) => JSON.stringify({ events: [factFor(context.chat.at(-1))] }) });
    await settleMany(lab, 5);
    const issued = lab.state().issued;
    await lab.emit('GENERATION_STARTED', 'normal', {}, false);
    lab.prepare('normal');
    const normalFrame = lab.preparedMemory;
    await lab.emit('GENERATION_STARTED', 'normal', {}, true);
    lab.prepare('normal');
    const dryFrame = lab.preparedMemory;
    const dryData = { prompt: dryFrame };
    await lab.emit('GENERATE_AFTER_DATA', dryData, true, { type: 'normal' });
    assert.equal(dryData.prompt.includes('directoraffinity'), false);
    const data = { prompt: normalFrame };
    await lab.emit('GENERATE_AFTER_DATA', data, false, { type: 'normal' });
    assert.equal(data.prompt, dryData.prompt);
    await lab.receive();
    await lab.end();
    await lab.emit('GENERATION_COMPLETED', { data, type: 'normal', chatId: lab.context.chatId, chatMetadata: lab.context.chatMetadata });
    await lab.controller.settle();
    assert.equal(lab.state().issued, issued + 1);
});

test('a removed owner cancels pending extraction before a new major verification can start', async () => {
    const gate = deferred();
    let proposal;
    const lab = fixture({ interval: 5, group: true, reply: ({ context, args }) => {
        assert.equal(args[0].jsonSchema.name, 'relationship_evidence', 'absent owners cannot trigger verification');
        proposal = { ...factFor(context.chat.at(-1), { owner: 'b.png' }), kind: 'attitude', valence: 'positive', impact: 'major', attitudeExplicit: true };
        return gate.promise;
    } });
    await generateMany(lab, 5, { avatar: 'b.png' });
    await until(() => lab.calls.length === 1, 'extraction starts');
    const signal = lab.calls[0][0].signal;
    lab.context.groups[0].members = ['a.png'];
    await lab.emit('GROUP_UPDATED');
    assert.equal(signal.aborted, true);
    gate.resolve(JSON.stringify({ events: [proposal] }));
    await lab.controller.settle();
    assert.equal(lab.calls.length, 1);
    assert.equal(lab.state().events.length, 0);
});

test('major verification includes actual tail quote context instead of only the first 2000 characters', async () => {
    const quote = '经历这件大事后，我现在完全信任你。';
    let checked = false;
    const lab = fixture({ interval: 5, reply: ({ context, args }) => {
        if (args[0].jsonSchema.name === 'relationship_verification') {
            const packet = JSON.parse(args[0].quietPrompt.split('\n').slice(1).join('\n'));
            assert.ok(packet.messages.some(message => message.text.includes(quote)));
            assert.ok(packet.messages.every(message => message.text.length <= 2400));
            checked = true;
            return JSON.stringify({ confirmed: packet.candidates.map(item => item.key) });
        }
        const proposal = { ...factFor(context.chat.at(-1)), kind: 'attitude', valence: 'positive', impact: 'major', attitudeExplicit: true };
        proposal.source.quote = quote;
        return JSON.stringify({ events: [proposal] });
    } });
    await generateMany(lab, 4);
    await lab.generate({ text: '长'.repeat(4000) + quote });
    await lab.controller.settle();
    assert.equal(checked, true);
    assert.equal(affinityScores(lab.state())['a.png'], 5);
});

test('a queued worker cannot save an empty reload gap or clear its ledger', async () => {
    const lab = fixture({ interval: 5, reply: ({ context }) => JSON.stringify({ events: [factFor(context.chat.at(-1))] }) });
    await settleMany(lab, 5);
    const saves = [];
    lab.context.saveChat = async options => { saves.push({ length: lab.context.chat.length, accepted: options.shouldSave() }); return true; };
    await lab.generate();
    const events = structuredClone(lab.state().events);
    lab.context.chat.splice(0); // Native clearChat before its GET/CHAT_CHANGED boundary.
    await lab.controller.settle();
    assert.equal(saves.length, 0);
    assert.deepEqual(lab.state().events, events);
});

test('a queued worker cannot reconcile a replaced transcript under the old metadata', async () => {
    const lab = fixture({ interval: 5, reply: ({ context }) => JSON.stringify({ events: [factFor(context.chat.at(-1))] }) });
    await settleMany(lab, 5);
    const saves = [];
    lab.context.saveChat = async () => { saves.push(true); return true; };
    await lab.generate();
    const events = structuredClone(lab.state().events);
    lab.context.chat.splice(0, lab.context.chat.length, { is_user: true, name: '玩家', mes: 'The newly loading transcript.', extra: {} });
    await lab.controller.settle();
    assert.equal(saves.length, 0);
    assert.deepEqual(lab.state().events, events);
});

test('the first generated logical slot survives regeneration and persists its receipt', async () => {
    const lab = fixture({ initial: { chat: [] } });
    const first = await lab.generate();
    await lab.controller.settle();
    const marker = structuredClone(lab.marker(first));
    assert.equal(marker.receipt, 1);
    lab.saves.length = 0;
    await lab.emit('GENERATION_STARTED', 'regenerate', {}, false);
    lab.context.chat.pop();
    await lab.emit('MESSAGE_DELETED', 0);
    lab.prepare('regenerate');
    const data = { prompt: 'The first-slot regenerate request.' };
    await lab.emit('GENERATE_AFTER_DATA', data, false, { type: 'normal' });
    const replacement = await lab.receive({ type: 'regenerate', text: 'A replacement first logical reply.' });
    await lab.end();
    await lab.emit('GENERATION_COMPLETED', { data, type: 'normal', chatId: lab.context.chatId, chatMetadata: lab.context.chatMetadata });
    await lab.controller.settle();
    assert.equal(lab.marker(replacement).id, marker.id);
    assert.equal(lab.marker(replacement).receipt, marker.receipt);
    assert.equal(lab.state().issued, 1);
    assert.ok(lab.saves.length > 0, 'the coalesced task must use the completed replacement snapshot');
});

async function completeWithOlderDiskSnapshot(lab, fields = {}) {
    const completion = await lab.begin();
    const message = await lab.receive(fields);
    // Native Generate saves the physical reply before GENERATION_COMPLETED.
    const disk = structuredClone({ chat: lab.context.chat, chatMetadata: lab.context.chatMetadata });
    await lab.end();
    await lab.emit('GENERATION_COMPLETED', completion);
    return { disk, message };
}

for (const group of [false, true]) {
    test(`an immediate ${group ? 'group' : 'single-chat'} reload restores the unsaved successful receipt exactly once`, async () => {
        const lab = fixture({ interval: 5, group });
        await settleMany(lab, 4);
        const { disk } = await completeWithOlderDiskSnapshot(lab, { avatar: group ? 'b.png' : 'a.png' });
        assert.equal(lab.state().issued, 5);
        assert.equal(disk.chatMetadata.director.__affinity.issued, 4);
        await lab.switchChat('first', disk);
        await lab.controller.settle();
        assert.equal(lab.state().issued, 5);
        assert.equal(lab.marker(lab.context.chat.at(-1)).receipt, 5);
        assert.equal(lab.calls.length, 1);
        const persisted = structuredClone({ chat: lab.context.chat, chatMetadata: lab.context.chatMetadata });
        await lab.switchChat('first', persisted);
        await lab.controller.settle();
        assert.equal(lab.calls.length, 1);
    });
}

for (const mutation of ['text', 'swipe', 'owner', 'logical marker']) {
    test(`pending receipt recovery rejects a changed ${mutation} and cannot resurrect it later`, async () => {
        const lab = fixture({ interval: 5, group: true });
        await settleMany(lab, 4);
        const { disk } = await completeWithOlderDiskSnapshot(lab, { avatar: 'a.png' });
        const original = structuredClone(disk);
        const message = disk.chat.at(-1);
        if (mutation === 'text') { message.mes = 'Edited after the physical save.'; message.swipes[message.swipe_id] = message.mes; }
        if (mutation === 'swipe') { message.swipe_id = 1; message.swipes[1] = message.mes; message.swipe_info[1] = { extra: {} }; }
        if (mutation === 'owner') message.original_avatar = 'b.png';
        if (mutation === 'logical marker') message.extra.__affinity = { version: 1, scope: disk.chatMetadata.director.__affinity.id, id: 'another-logical-slot', receipt: 0 };
        await lab.switchChat('first', disk);
        await lab.controller.settle();
        assert.equal(lab.state().issued, 4);
        assert.equal(lab.marker(lab.context.chat.at(-1))?.receipt ?? 0, 0);
        await lab.switchChat('first', original);
        await lab.controller.settle();
        assert.equal(lab.state().issued, 4, 'a rejected branch must not recover on a later return');
        assert.equal(lab.calls.length, 0);
    });
}

test('an unsaved successful receipt belongs only to its exact chat scope', async () => {
    const lab = fixture({ interval: 5 });
    await settleMany(lab, 4);
    const { disk } = await completeWithOlderDiskSnapshot(lab);
    await lab.switchChat('different-chat', structuredClone(disk));
    await lab.controller.settle();
    assert.equal(lab.state().issued, 4);
    assert.equal(lab.calls.length, 0);
    await lab.switchChat('first', disk);
    await lab.controller.settle();
    assert.equal(lab.state().issued, 5);
    assert.equal(lab.calls.length, 1);
});

test('a confirmed save retires receipt recovery instead of overriding a later explicit disk rollback', async () => {
    const lab = fixture({ interval: 5 });
    await settleMany(lab, 4);
    const { disk } = await completeWithOlderDiskSnapshot(lab);
    await lab.controller.settle();
    assert.equal(lab.state().issued, 5);
    await lab.switchChat('first', disk);
    await lab.controller.settle();
    assert.equal(lab.state().issued, 4);
    assert.equal(lab.marker(lab.context.chat.at(-1))?.receipt ?? 0, 0);
});

test('a save only confirms its starting receipt watermark, leaving a newer completion recoverable', async () => {
    const lab = fixture();
    await settleMany(lab, 4);
    const firstSave = deferred();
    const secondSave = deferred();
    let saves = 0;
    lab.context.saveChat = async () => {
        saves++;
        if (saves === 1) return firstSave.promise;
        if (saves === 2) return secondSave.promise;
        return true;
    };
    await completeWithOlderDiskSnapshot(lab);
    await until(() => saves === 1, 'the fifth receipt save starts');
    const { disk } = await completeWithOlderDiskSnapshot(lab);
    assert.equal(disk.chatMetadata.director.__affinity.issued, 5);
    firstSave.resolve(true);
    await until(() => saves === 2, 'the sixth receipt save starts separately');
    await lab.switchChat('first', disk);
    secondSave.resolve(false);
    await lab.controller.settle();
    assert.equal(lab.state().issued, 6);
    assert.equal(lab.marker(lab.context.chat.at(-1)).receipt, 6);
    assert.equal(lab.calls.length, 0);
});

test('a save finishing across reload cannot confirm a receipt for the new load', async () => {
    const lab = fixture();
    await settleMany(lab, 4);
    const gate = deferred();
    let started = false;
    lab.context.saveChat = async () => { started = true; return gate.promise; };
    const { disk } = await completeWithOlderDiskSnapshot(lab);
    await until(() => started, 'the old load save starts');
    await lab.switchChat('first', structuredClone(disk));
    lab.context.saveChat = async () => false;
    gate.resolve(true);
    await lab.controller.settle();
    assert.equal(lab.state().issued, 5);
    // The new load's save failed. A second reload must still recover the receipt.
    await lab.switchChat('first', disk);
    await lab.controller.settle();
    assert.equal(lab.state().issued, 5);
    assert.equal(lab.marker(lab.context.chat.at(-1)).receipt, 5);
    assert.equal(lab.calls.length, 0);
});

test('receipt recovery preserves evaluated evidence that a newer native save already persisted', async () => {
    const lab = fixture({ interval: 5, reply: ({ context }) => JSON.stringify({ events: [factFor(context.chat.at(-1))] }) });
    await settleMany(lab, 4);
    lab.context.saveChat = async () => false;
    await lab.generate();
    await lab.controller.settle();
    const marker = structuredClone(lab.marker(lab.context.chat.at(-1)));
    assert.equal(typeof marker.evaluated, 'string');
    const disk = structuredClone({ chat: lab.context.chat, chatMetadata: lab.context.chatMetadata });
    await lab.switchChat('first', disk);
    await lab.controller.settle();
    assert.equal(lab.marker(lab.context.chat.at(-1)).evaluated, marker.evaluated);
    assert.equal(lab.marker(lab.context.chat.at(-1)).receipt, marker.receipt);
    assert.equal(lab.state().cursor, 5);
    assert.equal(lab.calls.length, 1);
});

for (const disabled of ['affinity setting', 'Director extension']) {
    test(`pending receipt survives reload while the ${disabled} is disabled and recovers before projection on enable`, async () => {
        const lab = fixture({ interval: 5 });
        await settleMany(lab, 4);
        const { disk } = await completeWithOlderDiskSnapshot(lab);
        if (disabled === 'affinity setting') lab.context.extensionSettings.director.affinity.enabled = false;
        else lab.context.extensionSettings.disabledExtensions.push('director');
        await lab.emit('SETTINGS_UPDATED');
        await lab.switchChat('first', disk);
        await lab.controller.settle();
        assert.equal(lab.state().issued, 4);
        assert.equal(lab.calls.length, 0);
        if (disabled === 'affinity setting') lab.context.extensionSettings.director.affinity.enabled = true;
        else lab.context.extensionSettings.disabledExtensions.splice(0);
        await lab.emit('SETTINGS_UPDATED');
        await lab.controller.settle();
        assert.equal(lab.state().issued, 5);
        assert.equal(lab.marker(lab.context.chat.at(-1)).receipt, 5);
        assert.equal(lab.state().cursor, 5);
        assert.equal(lab.calls.length, 1);
        await lab.emit('SETTINGS_UPDATED');
        await lab.controller.settle();
        assert.equal(lab.calls.length, 1);
    });
}

test('an awaited prompt fitter cannot dispatch after a new foreground generation cancels it', async () => {
    const gate = deferred();
    let fitting;
    const lab = fixture({ interval: 5, controllerOptions: {
        fitPrompt: async (_render, refs, _value, _owners, signal) => { fitting = { refs, signal }; await gate.promise; return { prompt: 'fitted prompt', refs }; },
    } });
    await generateMany(lab, 5);
    await until(() => !!fitting, 'the dynamic prompt fit starts');
    const completion = await lab.begin();
    assert.equal(fitting.signal.aborted, true);
    gate.resolve();
    await lab.receive();
    await lab.end();
    await lab.emit('GENERATION_COMPLETED', completion);
    await lab.controller.settle();
    assert.equal(lab.calls.length, 0);
});

test('a prompt fitter only marks evidence it actually included as evaluated', async () => {
    const lab = fixture({ interval: 5, controllerOptions: {
        fitPrompt: async (_render, refs) => ({ prompt: 'Only generated reply evidence is included.', refs: refs.filter(ref => ref.receipt > 0) }),
    } });
    await settleMany(lab, 5);
    assert.equal(lab.calls.length, 1);
    assert.equal(lab.marker(lab.context.chat[0]).evaluated, undefined);
    assert.ok(lab.context.chat.slice(1).every(message => typeof lab.marker(message).evaluated === 'string'));
});

test('a temporarily unavailable single-chat character project retains frozen history and still revokes edits', async () => {
    const lab = fixture({ interval: 5, reply: ({ context }) => JSON.stringify({ events: [{
        ...factFor(context.chat.at(-1)), kind: 'attitude', valence: 'positive', attitudeExplicit: true,
    }] }) });
    await settleMany(lab, 5);
    const characters = lab.context.characters;
    lab.context.characters = [];
    lab.controller.refresh();
    await lab.controller.settle();
    assert.equal(lab.state().events.length, 1);
    assert.equal(affinityScores(lab.state())['a.png'], 0);
    assert.equal(lab.state().events[0].offline, true);
    lab.prepare('normal');
    assert.equal(lab.preparedMemory, undefined);
    assert.equal(lab.calls.length, 1);
    lab.context.characters = characters;
    lab.controller.refresh();
    await lab.controller.settle();
    assert.equal(affinityScores(lab.state())['a.png'], 2);
    lab.context.characters = [];
    lab.controller.refresh();
    lab.context.chat.at(-1).mes = '原文已经真实改变。';
    await lab.emit('MESSAGE_EDITED', lab.context.chat.length - 1);
    await lab.controller.settle();
    assert.equal(lab.state().events.length, 0);
});

for (const nextType of ['normal', 'continue']) {
    test(`cross-review: a finalized stream waiting for save keeps its receipt when ${nextType} starts`, async () => {
        const lab = fixture({ interval: 5 });
        await settleMany(lab, 3);
        const first = await lab.begin();
        const firstMessage = await lab.receive({ text: 'A finished stream awaiting its native save.' });
        await lab.end(); // Native streaming unlocks before saveChatConditional/COMPLETED.
        const next = await lab.begin(nextType);
        await lab.emit('GENERATION_COMPLETED', first);
        assert.equal(lab.marker(firstMessage).receipt, 4, 'the exact old successful request still owns its reply');
        if (nextType === 'continue') firstMessage.mes += ' A continued tail.';
        const nextMessage = await lab.receive(nextType === 'continue'
            ? { type: nextType, message: firstMessage } : { text: 'The next successful ordinary reply.' });
        await lab.end();
        await lab.emit('GENERATION_COMPLETED', next);
        await lab.controller.settle();
        assert.equal(lab.state().issued, nextType === 'normal' ? 5 : 4);
        assert.equal(lab.marker(nextMessage).receipt, nextType === 'normal' ? 5 : 4);
        assert.equal(lab.calls.length, nextType === 'normal' ? 1 : 0);
    });
}

test('cross-review: a late previous stream callback cannot become the next normal request reply', async () => {
    const lab = fixture({ interval: 5 });
    await settleMany(lab, 3);
    const first = await lab.begin();
    const oldMessage = { is_user: false, name: '相同名字', mes: 'The previous stream placeholder.', extra: {} };
    lab.context.chat.push(oldMessage);
    lab.finalize(oldMessage);
    await lab.end();
    const next = await lab.begin();
    await lab.receive({ message: oldMessage });
    const nextMessage = await lab.receive({ text: 'The actual next request response.' });
    await lab.end();
    await lab.emit('GENERATION_COMPLETED', next);
    await lab.emit('GENERATION_COMPLETED', first);
    await lab.controller.settle();
    assert.equal(lab.marker(oldMessage).receipt, 0);
    assert.equal(lab.marker(nextMessage).receipt, 4);
    assert.equal(lab.state().issued, 4);
    assert.equal(lab.calls.length, 0);
});

for (const boundary of ['GENERATION_STOPPED', 'CHAT_CHANGED']) {
    test(`cross-review: ${boundary} still rejects a retained old successful completion`, async () => {
        const lab = fixture();
        const first = await lab.begin();
        const message = await lab.receive();
        await lab.end();
        if (boundary === 'GENERATION_STOPPED') {
            await lab.emit(boundary, lab.context.chatId);
            await lab.begin();
        } else {
            await lab.begin();
            await lab.emit(boundary, lab.context.chatId);
        }
        await lab.emit('GENERATION_COMPLETED', first);
        lab.generating = false;
        await lab.controller.settle();
        assert.equal(lab.marker(message).receipt, 0);
        assert.equal(lab.state().issued, 0);
    });
}

test('cross-review: stopping the new request cannot revoke the finalized previous request', async () => {
    const lab = fixture();
    const first = await lab.begin();
    const message = await lab.receive();
    await lab.end();
    await lab.begin();
    await lab.emit('GENERATION_STOPPED');
    await lab.emit('GENERATION_COMPLETED', first);
    lab.generating = false;
    await lab.controller.settle();
    assert.equal(lab.marker(message).receipt, 1);
    assert.equal(lab.state().issued, 1);
});

test('cross-review: ordinary affinity-like literals survive while unknown complete frames are scrubbed', async () => {
    const lab = fixture();
    const literal = 'directoraffinity123xnormal AFFINITY_LITERAL_user_text_END directoraffinity';
    const frame = '\uE010directoraffinity999xunknown\uE011PRIVATE_UNKNOWN_BODY\uE012directoraffinity999xunknown\uE013';
    const incomplete = '\uE010directoraffinity77xincomplete\uE011literal without a closing frame';
    const data = { prompt: `${literal} | ${frame} | ${incomplete}`, messages: [{ content: literal }] };
    await lab.emit('GENERATE_AFTER_DATA', data, false, { type: 'normal' });
    assert.equal(data.prompt, `${literal} |  | ${incomplete}`);
    assert.equal(data.messages[0].content, literal);
});

function seededHistory(amount) {
    let ledger = createAffinityState('cross-review-scope');
    ledger.issued = ledger.cursor = amount;
    const chat = Array.from({ length: amount }, (_, index) => {
        const marker = { version: 1, scope: ledger.id, id: `history-${index}`, receipt: index + 1 };
        return { is_user: false, name: '相同名字', mes: `Independent literal evidence ${index}.`, extra: { __affinity: marker },
            swipe_id: 0, swipes: [`Independent literal evidence ${index}.`], swipe_info: [{ extra: { __affinity: structuredClone(marker) } }] };
    });
    const refs = chat.map((message, index) => ({ slot: message.extra.__affinity.id, index, swipe: 0, owner: 'a.png',
        fingerprint: messageFingerprint({ ...message, name: 'a.png' }), text: message.mes }));
    for (let offset = 0; offset < amount; offset += 24) {
        ledger = applyAffinityEvaluation(ledger, chat.slice(offset, offset + 24).map(message => factFor(message)), refs, [{ id: 'a.png' }]);
    }
    return { ledger, chat, refs };
}

function priorIn(prompt) {
    return JSON.parse(prompt.split('已有记忆（避免重复；只有新结果可回指承诺）：')[1].split('\n消息：')[0]);
}

test('cross-review: archived placement cannot replace the most recent forty prior facts', async () => {
    const { ledger, chat } = seededHistory(180);
    assert.ok(ledger.archives.length > 0);
    const lab = fixture({ interval: 5, initial: { chat, chatMetadata: { director: { __affinity: ledger } } } });
    await settleMany(lab, 5);
    const prior = priorIn(lab.calls[0][0].quietPrompt);
    assert.equal(prior.length, 40);
    assert.deepEqual(prior.map(event => event.source.slot), Array.from({ length: 40 }, (_, index) => `history-${140 + index}`));
});

test('cross-review: prior outcomes expose their already consumed acknowledgement verbatim', async () => {
    const { ledger, chat, refs } = seededHistory(3);
    const promise = { ...factFor(chat[0]), kind: 'promise', actor: 'user', recipient: 'character', status: 'agreed' };
    chat[0].is_user = true;
    refs[0].owner = 'player';
    refs[0].fingerprint = messageFingerprint({ ...chat[0], name: 'player' });
    let state = applyAffinityEvaluation({ ...ledger, events: [], archives: [] }, [promise], refs, [{ id: 'a.png' }]);
    const anchor = state.events[0];
    const outcome = { ...promise, kind: 'outcome', status: 'completed', valence: 'positive', attitudeExplicit: true,
        anchorId: anchor.id, result: { slot: refs[1].slot, quote: refs[1].text }, acknowledgement: { slot: refs[2].slot, quote: refs[2].text } };
    state = applyAffinityEvaluation(state, [outcome], refs, [{ id: 'a.png' }]);
    assert.equal(state.events.length, 2);
    const lab = fixture({ interval: 5, initial: { chat, chatMetadata: { director: { __affinity: state } } } });
    await settleMany(lab, 5);
    const prior = priorIn(lab.calls[0][0].quietPrompt);
    const shown = prior.find(event => event.kind === 'outcome');
    assert.deepEqual(shown.acknowledgement, { ...outcome.acknowledgement, offset: 0 });
    assert.equal(prior.filter(event => event.id === anchor.id).length, 1);
});

for (const failure of ['extraction_failed', 'parse_envelope', 'parse_unsafe', 'parse_schema', 'persistence_failed', 'budget_failed', 'verification_failed']) {
    test(`cross-review: ${failure} has a private local counter and cannot expose evidence`, async () => {
        const diagnosticEvents = [];
        const privateText = 'PRIVATE_RESPONSE_SECRET_CHAT_TEXT';
        const lab = fixture({ interval: 5, controllerOptions: { onDiagnostic: event => { diagnosticEvents.push(event); throw new Error(privateText); },
            ...(failure === 'budget_failed' ? { fitPrompt: async () => { throw new Error(privateText); } } : {}) }, reply: ({ context, args }) => {
            if (failure === 'extraction_failed') throw new Error(privateText);
            if (failure === 'parse_envelope') return privateText;
            if (failure === 'parse_unsafe') return '{"events":[{"constructor":{"privateText":"PRIVATE_RESPONSE_SECRET_CHAT_TEXT"}}]}';
            if (failure === 'parse_schema') return JSON.stringify({ events: [{ privateText }] });
            if (failure === 'verification_failed') {
                if (args[0].jsonSchema.name === 'relationship_verification') return JSON.stringify({ confirmed: [privateText] });
                return JSON.stringify({ events: [{ ...factFor(context.chat.at(-1)), kind: 'attitude', valence: 'positive', impact: 'major', attitudeExplicit: true }] });
            }
            return '{"events":[]}';
        } });
        if (failure === 'persistence_failed') lab.context.saveChat = async () => false;
        await settleMany(lab, 5);
        assert.equal(typeof lab.controller.getDiagnostics, 'function');
        const diagnostics = lab.controller.getDiagnostics();
        assert.ok(diagnostics.counts[failure] > 0);
        assert.ok(diagnostics.total > 0);
        assert.ok(diagnosticEvents.some(event => event.category === failure));
        assert.ok(!JSON.stringify({ diagnostics, diagnosticEvents }).includes(privateText));
        for (const event of diagnosticEvents) {
            assert.deepEqual(Object.keys(event).sort(), ['category', 'count', 'counts', 'total']);
            event.counts[failure] = 99999;
        }
        diagnostics.counts[failure] = 99999;
        assert.notEqual(lab.controller.getDiagnostics().counts[failure], 99999);
        const before = lab.calls.length;
        await lab.controller.settle();
        assert.equal(lab.calls.length, before, 'diagnosis does not retry a failed batch');
    });
}

test('cross-review: each major verifier batch validates its current budget before dispatch', async () => {
    let validation = 0;
    const lab = fixture({ interval: 5, controllerOptions: { fitVerificationPrompt: async (render, candidates) => [
        { candidates, prompt: render(candidates), validate: async () => ++validation === 1 },
        { candidates, prompt: render(candidates), validate: async () => ++validation === 1 },
    ] }, reply: ({ context, args }) => {
        if (args[0].jsonSchema.name === 'relationship_verification') return '{"confirmed":[]}';
        return JSON.stringify({ events: [{ ...factFor(context.chat.at(-1)), kind: 'attitude', valence: 'positive', impact: 'major', attitudeExplicit: true }] });
    } });
    await settleMany(lab, 5);
    assert.equal(validation, 2);
    assert.equal(lab.calls.length, 2, 'the second, newly oversized verifier request is not dispatched');
    assert.equal(lab.controller.getDiagnostics().counts.budget_failed, 1);
});

test('cross-review: an omitted oversized verifier candidate has a budget diagnostic', async () => {
    const lab = fixture({ interval: 5, controllerOptions: { fitVerificationPrompt: async () => [] }, reply: ({ context }) =>
        JSON.stringify({ events: [{ ...factFor(context.chat.at(-1)), kind: 'attitude', valence: 'positive', impact: 'major', attitudeExplicit: true }] }) });
    await settleMany(lab, 5);
    assert.equal(lab.calls.length, 1);
    assert.equal(lab.controller.getDiagnostics().counts.budget_failed, 1);
    assert.equal(affinityScores(lab.state())['a.png'] ?? 0, 0);
});

test('cross-review: cancellation during verifier budget validation neither dispatches nor diagnoses a failure', async () => {
    const gate = deferred();
    let validating = false;
    const lab = fixture({ interval: 5, controllerOptions: { fitVerificationPrompt: async (render, candidates) => [{
        candidates, prompt: render(candidates), validate: async () => { validating = true; return gate.promise; },
    }] }, reply: ({ context }) => JSON.stringify({ events: [{ ...factFor(context.chat.at(-1)), kind: 'attitude', valence: 'positive', impact: 'major', attitudeExplicit: true }] }) });
    await generateMany(lab, 5);
    await until(() => validating, 'budget validation starts');
    await lab.begin();
    gate.resolve(false);
    await lab.emit('GENERATION_STOPPED');
    lab.generating = false;
    await lab.controller.settle();
    assert.equal(lab.calls.length, 1);
    assert.equal(lab.controller.getDiagnostics().total, 0);
});

for (const order of ['normal-first', 'continue-first']) {
    test(`cross-review lineage: a continued finished stream owns one receipt after either save order (${order})`, async () => {
        const lab = fixture();
        const original = await lab.begin();
        const message = await lab.receive({ text: 'The original completed reply.' });
        await lab.end();
        const continuation = await lab.begin('continue');
        message.mes += ' A successful continued tail.';
        await lab.receive({ type: 'continue', message });
        await lab.end();
        for (const completion of order === 'normal-first' ? [original, continuation] : [continuation, original]) {
            await lab.emit('GENERATION_COMPLETED', completion);
        }
        await lab.controller.settle();
        assert.equal(lab.state().issued, 1);
        assert.equal(lab.marker(message).receipt, 1);
        await lab.emit('GENERATION_COMPLETED', original);
        await lab.emit('GENERATION_COMPLETED', continuation);
        assert.equal(lab.state().issued, 1, 'duplicate callbacks do not add another receipt');
    });
}

test('cross-review lineage: a stopped partial continuation preserves its later-confirmed original reply', async () => {
    const lab = fixture();
    const original = await lab.begin();
    const message = await lab.receive({ text: 'A complete original reply.' });
    await lab.end();
    const continuation = await lab.begin('continue');
    message.mes += ' An unfinished appended tail';
    lab.finalize(message);
    await lab.emit('GENERATION_STOPPED');
    await lab.end();
    await lab.emit('GENERATION_COMPLETED', original);
    await lab.emit('GENERATION_COMPLETED', continuation);
    await lab.controller.settle();
    assert.equal(lab.state().issued, 1);
    assert.equal(lab.marker(message).receipt, 1);
});

test('cross-review lineage: original completion during a continuation reasoning await survives its later stop', async () => {
    const lab = fixture();
    const original = await lab.begin();
    const message = await lab.receive({ text: 'A complete original reply.' });
    await lab.end();
    await lab.begin('continue');
    // Native progress writes mes before awaiting reasoning, then syncs the swipe.
    message.mes += ' An unfinished appended tail';
    assert.notEqual(message.mes, message.swipes[message.swipe_id]);
    await lab.emit('GENERATION_COMPLETED', original);
    assert.equal(lab.state().issued, 0, 'an unfinished swipe cannot mint a receipt');
    lab.finalize(message);
    await lab.emit('GENERATION_STOPPED');
    await lab.end();
    await lab.controller.settle();
    assert.equal(lab.state().issued, 1, 'the successful original retains its receipt authority');
    assert.equal(lab.marker(message).receipt, 1);
    await lab.emit('GENERATION_COMPLETED', original);
    await lab.end();
    assert.equal(lab.state().issued, 1, 'repeated completion and end callbacks cannot add a receipt');
});

test('cross-review lineage: stopping during reasoning retains the confirmed original until late swipe finalization', async () => {
    const lab = fixture();
    const original = await lab.begin();
    const message = await lab.receive({ text: 'A complete original reply.' });
    await lab.end();
    await lab.begin('continue');
    message.mes += ' An unfinished appended tail';
    await lab.emit('GENERATION_COMPLETED', original);
    // Native stopGeneration unlocks first, while progress can still await reasoning.
    await lab.end();
    await lab.emit('GENERATION_STOPPED');
    assert.equal(lab.state().issued, 0);
    // Aborted native onFinishStreaming still syncs its swipe and emits RECEIVED.
    lab.finalize(message);
    await lab.emit('MESSAGE_RECEIVED', lab.context.chat.indexOf(message), 'continue');
    await lab.controller.settle();
    assert.equal(lab.state().issued, 1);
    assert.equal(lab.marker(message).receipt, 1);
});

for (const boundary of ['MESSAGE_EDITED', 'owner', 'marker', 'nonappend', 'disable-enable', 'CHAT_CHANGED']) {
    test(`cross-review lineage: ${boundary} rejects an original completion deferred during continuation progress`, async () => {
        const lab = fixture({ group: boundary === 'owner' });
        const original = await lab.begin();
        const message = await lab.receive({ text: 'A complete original reply.' });
        await lab.end();
        await lab.begin('continue');
        message.mes += ' An unfinished appended tail';
        await lab.emit('GENERATION_COMPLETED', original);
        if (boundary === 'MESSAGE_EDITED') await lab.emit(boundary, lab.context.chat.length - 1);
        if (boundary === 'owner') message.original_avatar = 'b.png';
        if (boundary === 'marker') message.extra.__affinity.id = 'changed-deferred-slot';
        if (boundary === 'nonappend') message.mes = 'An unrelated replacement.';
        if (boundary === 'disable-enable') {
            lab.context.extensionSettings.director.affinity.enabled = false;
            await lab.emit('SETTINGS_UPDATED');
            lab.context.extensionSettings.director.affinity.enabled = true;
            await lab.emit('SETTINGS_UPDATED');
        }
        lab.finalize(message);
        if (boundary === 'CHAT_CHANGED') await lab.switchChat();
        await lab.emit('GENERATION_STOPPED');
        await lab.end();
        await lab.controller.settle();
        assert.equal(lab.state().issued, 0);
        assert.equal(lab.marker(message).receipt, 0);
    });
}

test('cross-review lineage: two continuations retain the same pending original logical receipt', async () => {
    const lab = fixture();
    const original = await lab.begin();
    const message = await lab.receive({ text: 'A finished original reply.' });
    await lab.end();
    const continuations = [];
    for (let index = 0; index < 2; index++) {
        continuations.push(await lab.begin('continue'));
        message.mes += ` Continued segment ${index}.`;
        await lab.receive({ type: 'continue', message });
        await lab.end();
    }
    for (const completion of [...continuations.reverse(), original]) await lab.emit('GENERATION_COMPLETED', completion);
    await lab.controller.settle();
    assert.equal(lab.state().issued, 1);
    assert.equal(lab.marker(message).receipt, 1);
});

for (const mutation of ['MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'replacement', 'owner', 'marker', 'nonappend', 'unregistered']) {
    test(`cross-review lineage: a changed ${mutation} cannot inherit a pending original receipt`, async () => {
        const lab = fixture({ group: mutation === 'owner' });
        const original = await lab.begin();
        let message = await lab.receive({ text: 'A completed original reply.', avatar: 'a.png' });
        await lab.end();
        let continuation;
        if (mutation === 'unregistered') {
            await lab.emit('GENERATION_STARTED', 'continue', {}, false);
        } else continuation = await lab.begin('continue');
        message.mes += ' An appended tail.';
        if (mutation === 'nonappend') message.mes = 'Unrelated replacement text.';
        if (mutation === 'owner') message.original_avatar = 'b.png';
        if (mutation === 'marker') message.extra.__affinity.id = 'different-logical-slot';
        if (mutation === 'replacement') {
            message = structuredClone(message);
            lab.context.chat[lab.context.chat.length - 1] = message;
        }
        await lab.receive({ type: 'continue', message, avatar: message.original_avatar ?? 'a.png' });
        if (mutation.startsWith('MESSAGE_')) await lab.emit(mutation, lab.context.chat.length - 1);
        await lab.end();
        await lab.emit('GENERATION_COMPLETED', original);
        if (continuation) await lab.emit('GENERATION_COMPLETED', continuation);
        await lab.controller.settle();
        assert.equal(lab.state().issued, 0);
        assert.equal(lab.marker(message).receipt, 0);
    });
}

for (const origin of ['stopped', 'historical']) {
    test(`cross-review lineage: a continuation cannot authorize a ${origin} original reply`, async () => {
        const lab = fixture();
        let original;
        let message;
        if (origin === 'stopped') {
            original = await lab.begin();
            message = await lab.receive({ text: 'An original whose request was stopped.' });
            await lab.emit('GENERATION_STOPPED');
            await lab.end();
        } else {
            message = { is_user: false, name: '相同名字', mes: 'An ungenerated historical reply.', extra: {} };
            lab.context.chat.push(message);
            lab.finalize(message);
        }
        const continuation = await lab.begin('continue');
        message.mes += ' A successful continued tail.';
        await lab.receive({ type: 'continue', message });
        await lab.end();
        await lab.emit('GENERATION_COMPLETED', continuation);
        if (original) await lab.emit('GENERATION_COMPLETED', original);
        await lab.controller.settle();
        assert.equal(lab.state().issued, 0);
        assert.equal(lab.marker(message).receipt, 0);
    });
}

for (const boundary of ['owner', 'disable-enable']) {
    test(`cross-review lineage: ${boundary} cannot reauthorize an old completed request`, async () => {
        const lab = fixture();
        const original = await lab.begin();
        const message = await lab.receive();
        await lab.end();
        if (boundary === 'owner') lab.context.characters[0].avatar = 'b.png';
        else lab.context.extensionSettings.director.affinity.enabled = false;
        await lab.emit('SETTINGS_UPDATED');
        if (boundary === 'disable-enable') {
            lab.context.extensionSettings.director.affinity.enabled = true;
            await lab.emit('SETTINGS_UPDATED');
        }
        await lab.emit('GENERATION_COMPLETED', original);
        await lab.controller.settle();
        assert.equal(lab.state().issued, 0);
        assert.equal(lab.marker(message).receipt, 0);
    });
}

test('cross-review lineage: a changed provider identity rejects an awaited evaluator without diagnosis', async () => {
    let identity = 'provider-model-one';
    const gate = deferred();
    let proposal;
    const lab = fixture({ interval: 5, controllerOptions: { requestIdentity: () => identity }, reply: ({ context }) => {
        proposal = { ...factFor(context.chat.at(-1)), kind: 'attitude', valence: 'positive', impact: 'major', attitudeExplicit: true };
        return gate.promise;
    } });
    await generateMany(lab, 5);
    await until(() => lab.calls.length === 1, 'extraction starts');
    identity = 'provider-model-two';
    gate.resolve(JSON.stringify({ events: [proposal] }));
    await lab.controller.settle();
    assert.equal(lab.calls.length, 1, 'the old provider result cannot launch a verifier');
    assert.equal(lab.state().events.length, 0);
    assert.equal(lab.controller.getDiagnostics().total, 0);
});

test('round3: historical prepare coalesces a detached save and keeps logical slots across reload', async () => {
    const lab = fixture({ initial: { chat: [
        { is_user: true, name: '玩家', mes: '历史问题。', extra: {} },
        { is_user: false, name: '相同名字', mes: '历史回答。', extra: {} },
    ] } });
    let disk;
    lab.context.saveChat = async options => {
        assert.equal(options.shouldSave(), true);
        lab.saves.push(true);
        disk = structuredClone({ chat: lab.context.chat, chatMetadata: lab.context.chatMetadata });
        return true;
    };
    lab.prepare('normal');
    lab.prepare('normal');
    const ids = lab.context.chat.map(message => lab.marker(message).id);
    assert.equal(lab.saves.length, 0, 'foreground prepare never waits for or starts I/O');
    await lab.controller.settle();
    assert.equal(lab.saves.length, 1, 'repeated reads share one detached save');
    assert.equal(lab.calls.length, 0);
    const reloaded = fixture({ initial: disk });
    reloaded.prepare('normal');
    await reloaded.controller.settle();
    assert.deepEqual(reloaded.context.chat.map(message => reloaded.marker(message).id), ids);
    assert.equal(reloaded.calls.length, 0);
});

test('round3: a dry run persists new source identities without issuing an evaluator request', async () => {
    const lab = fixture();
    await lab.emit('GENERATION_STARTED', 'normal', {}, true);
    lab.prepare('normal');
    await lab.emit('GENERATE_AFTER_DATA', { prompt: 'dry request' }, true, { type: 'normal' });
    await lab.controller.settle();
    assert.equal(lab.saves.length, 1);
    assert.equal(lab.state().issued, 0);
    assert.equal(lab.calls.length, 0);
});

test('round3: save-only prepare cannot dispatch a loaded pending batch', async () => {
    const { ledger, chat } = seededHistory(5);
    ledger.cursor = 0;
    chat.push({ is_user: true, name: '玩家', mes: 'A historical unmarked question.', extra: {} });
    const lab = fixture({ interval: 5, initial: { chat, chatMetadata: { director: { __affinity: ledger } } } });
    lab.prepare('normal');
    await lab.controller.settle();
    assert.equal(lab.saves.length, 1);
    assert.equal(lab.calls.length, 0, 'a projection read cannot authorize pending extraction');
    assert.equal(lab.state().cursor, 0);
});

for (const gap of ['empty', 'replaced']) {
    test(`round3: prepare save cannot write a silently ${gap} native load gap`, async () => {
        const lab = fixture();
        lab.prepare('normal');
        if (gap === 'empty') lab.context.chat.splice(0);
        else lab.context.chat.splice(0, lab.context.chat.length, { is_user: true, name: '玩家', mes: 'New transcript.', extra: {} });
        await lab.controller.settle();
        assert.equal(lab.saves.length, 0);
        assert.equal(lab.calls.length, 0);
    });
}

for (const hint of ['thumbnail', 'name']) {
    test(`round3: a legacy group speaker resolved by ${hint} retains its own evidence after reload`, async () => {
        const legacy = { is_user: false, name: '乙', mes: '我记得玩家希望先敲门。', extra: {},
            ...(hint === 'thumbnail' ? { force_avatar: '/thumbnail?type=avatar&file=b.png&t=123' } : {}) };
        const fact = '只有乙记得玩家的先敲门边界。';
        const lab = fixture({ interval: 5, group: true, initial: { chat: [legacy] }, reply: () => JSON.stringify({ events: [factFor(legacy, { owner: 'b.png', fact })] }) });
        lab.context.characters[1].name = '乙';
        await settleMany(lab, 5);
        assert.equal(lab.state().events.length, 1);
        const evidenceId = lab.state().events[0].id;
        const disk = structuredClone({ chat: lab.context.chat, chatMetadata: lab.context.chatMetadata });
        const reloaded = fixture({ group: true, initial: disk });
        reloaded.context.characters[1].name = '乙';
        reloaded.controller.refresh();
        await reloaded.controller.settle();
        assert.equal(reloaded.state().events[0]?.id, evidenceId);
        reloaded.context.characterId = 1;
        reloaded.prepare('normal');
        const data = { prompt: reloaded.preparedMemory };
        await reloaded.emit('GENERATE_AFTER_DATA', data, false, { type: 'normal' });
        assert.ok(data.prompt.includes(fact));
        reloaded.context.characterId = 0;
        reloaded.prepare('normal');
        assert.equal(reloaded.preparedMemory, undefined);
    });
}

for (const hint of [undefined, '/thumbnail?type=persona&file=b.png', 'https://foreign.invalid/thumbnail?type=avatar&file=b.png',
    '/thumbnail?type=avatar&file=a.png&file=b.png', '/thumbnail?type=avatar&file=missing.png']) {
    test(`round3: ambiguous or unsupported legacy group ownership skips evidence privately (${hint ?? 'same-name'})`, async () => {
        const diagnosticEvents = [];
        const legacy = { is_user: false, name: '相同名字', mes: 'PRIVATE_LEGACY_TEXT', extra: {}, ...(hint ? { force_avatar: hint } : {}) };
        const lab = fixture({ group: true, initial: { chat: [legacy] }, controllerOptions: { onDiagnostic: event => diagnosticEvents.push(event) } });
        lab.context.characterId = 1;
        lab.prepare('normal');
        await lab.controller.settle();
        assert.equal(lab.marker(legacy), undefined);
        assert.equal(lab.state().issued, 0);
        assert.equal(lab.calls.length, 0);
        assert.ok(lab.controller.getDiagnostics().counts.owner_ambiguous > 0);
        assert.ok(!JSON.stringify(diagnosticEvents).includes(legacy.mes));
    });
}

test('round3: an explicit unknown original avatar cannot fall back to a valid legacy thumbnail', async () => {
    const message = { is_user: false, name: '乙', mes: 'Untrusted owner.', original_avatar: 'missing.png',
        force_avatar: '/thumbnail?type=avatar&file=b.png', extra: {} };
    const lab = fixture({ group: true, initial: { chat: [message] } });
    lab.context.characters[1].name = '乙';
    lab.prepare('normal');
    await lab.controller.settle();
    assert.equal(lab.marker(message), undefined);
    assert.equal(lab.state().issued, 0);
});

test('round3: extraction teaches null outcome flags for observations and exact optional source offsets', async () => {
    const source = AFFINITY_SCHEMA.value.properties.events.items.properties.source;
    assert.deepEqual(source.properties.offset, { type: 'integer', minimum: 0 });
    assert.deepEqual(source.required, ['slot', 'quote']);
    const lab = fixture({ interval: 5 });
    await settleMany(lab, 5);
    const prompt = lab.calls[0][0].quietPrompt;
    assert.match(prompt, /fact\/attitude\/promise.*outcomeKnown=null/);
    assert.match(prompt, /fact\/attitude.*outcomeKnown.*门槛/);
    assert.match(prompt, /UTF-16/);
    assert.match(prompt, /摘录.*不能.*猜/);
});

test('round3: a repeated major quote verifies its bound tail occurrence and records that exact offset', async () => {
    const quote = '我现在完全信任你。';
    const head = `${quote}这是演戏台词，并不代表我对你的态度。`;
    const tail = `真实经历之后，我郑重告诉你：${quote}`;
    const text = head + '中'.repeat(4000) + tail;
    let checked = false;
    const lab = fixture({ interval: 5, reply: ({ context, args }) => {
        if (args[0].jsonSchema.name === 'relationship_verification') {
            const packet = JSON.parse(args[0].quietPrompt.split('\n').slice(1).join('\n'));
            assert.equal(packet.messages.length, 1);
            assert.ok(packet.messages[0].text.includes(tail));
            assert.ok(!packet.messages[0].text.includes('演戏台词'));
            assert.equal(packet.messages[0].offset, text.lastIndexOf(quote) - 220);
            checked = true;
            return JSON.stringify({ confirmed: packet.candidates.map(candidate => candidate.key) });
        }
        const proposal = { ...factFor(context.chat.at(-1)), kind: 'attitude', valence: 'positive', impact: 'major', attitudeExplicit: true };
        proposal.source = { slot: proposal.source.slot, quote, offset: text.lastIndexOf(quote) };
        return JSON.stringify({ events: [proposal] });
    } });
    await generateMany(lab, 4);
    await lab.generate({ text });
    await lab.controller.settle();
    assert.equal(checked, true);
    assert.equal(lab.state().events[0]?.source.offset, text.lastIndexOf(quote));
    assert.equal(affinityScores(lab.state())['a.png'], 5);
});

test('round3: the production extraction renderer fits a long source within a 2k model context', async () => {
    const encoder = get_encoding('o200k_base');
    let fittedTokens;
    try {
        const lab = fixture({ interval: 5, controllerOptions: { maxOutputTokens: () => 512,
            fitPrompt: async (render, refs, value, owners) => {
                const wireTokens = encoder.encode(JSON.stringify(AFFINITY_SCHEMA.value)).length + 64;
                const countTokens = async prompt => encoder.encode(prompt).length + wireTokens;
                const fitted = await fitAffinityPrompt((shown, memory) => render(shown, memory, owners),
                    { refs: [refs.at(-1)], state: value }, { maxTokens: 1536, countTokens });
                fittedTokens = await countTokens(fitted.prompt);
                return fitted;
            } } });
        await generateMany(lab, 4);
        await lab.generate({ text: '角色明确表达对玩家的信任。'.repeat(10000) });
        await lab.controller.settle();
        assert.equal(lab.controller.getDiagnostics().counts.budget_failed, 0);
        assert.equal(lab.calls.length, 1);
        assert.ok(fittedTokens <= 1536);
    } finally { encoder.free(); }
});

test('round3: a legacy thumbnail source freezes while its owner is absent and restores on rejoin', async () => {
    const lab = fixture({ interval: 5, group: true, reply: ({ context }) => JSON.stringify({ events: [{
        ...factFor(context.chat.at(-1), { owner: 'b.png' }), kind: 'attitude', valence: 'positive', attitudeExplicit: true,
    }] }) });
    await settleMany(lab, 5, { avatar: 'b.png' });
    for (const message of lab.context.chat.filter(item => !item.is_user)) delete message.original_avatar;
    lab.context.groups[0].members = ['a.png'];
    await lab.emit('GROUP_UPDATED');
    await lab.controller.settle();
    assert.equal(lab.state().events.length, 1);
    assert.equal(lab.state().events[0].offline, true);
    assert.equal(affinityScores(lab.state())['b.png'], 0);
    lab.context.groups[0].members.push('b.png');
    await lab.emit('GROUP_UPDATED');
    await lab.controller.settle();
    assert.equal(affinityScores(lab.state())['b.png'], 2);
    lab.context.groups[0].members = ['a.png'];
    lab.context.chat.at(-1).mes = 'An actual edited legacy source.';
    await lab.emit('MESSAGE_EDITED', lab.context.chat.length - 1);
    await lab.controller.settle();
    assert.equal(lab.state().events.length, 0, 'an offline canonical owner cannot hide a real source edit');
});

for (const valence of ['positive', 'negative']) {
    test(`round3: a ${valence} major with no remaining score contribution cannot request verification`, async () => {
        const { ledger, chat, refs } = seededHistory(valence === 'positive' ? 55 : 50);
        let state = { ...ledger, nextId: 1, events: [], archives: [] };
        for (let index = 0; index < chat.length; index += 24) {
            state = applyAffinityEvaluation(state, chat.slice(index, index + 24).map(message => ({
                ...factFor(message), kind: 'attitude', valence, attitudeExplicit: true,
            })), refs, [{ id: 'a.png' }]);
        }
        const expected = valence === 'positive' ? 80 : -100;
        assert.equal(affinityScores(state)['a.png'], expected);
        const lab = fixture({ interval: 5, initial: { chat, chatMetadata: { director: { __affinity: state } } },
            reply: ({ context }) => JSON.stringify({ events: [{ ...factFor(context.chat.at(-1)),
                kind: 'attitude', valence, attitudeExplicit: true, impact: 'major' }] }) });
        await settleMany(lab, 5);
        assert.equal(lab.calls.length, 1, 'a zero contribution major needs extraction only');
        assert.equal(affinityScores(lab.state())['a.png'], expected);
        assert.equal(lab.state().events.at(-1).delta, 0);
    });
}

test('round3: GENERATION_STOPPED flushes a finalized lineage without needing GENERATION_ENDED', async () => {
    const lab = fixture();
    const original = await lab.begin();
    const message = await lab.receive({ text: 'A complete original reply.' });
    await lab.end();
    await lab.begin('continue');
    message.mes += ' A continued tail.';
    await lab.emit('GENERATION_COMPLETED', original);
    assert.equal(lab.state().issued, 0, 'unfinalized swipe cannot mint a receipt yet');
    lab.finalize(message);
    await lab.emit('GENERATION_STOPPED');
    lab.generating = false;
    await lab.controller.settle();
    assert.equal(lab.state().issued, 1, 'STOPPED alone flushes the finalized lineage');
    assert.equal(lab.marker(message).receipt, 1);
});

test('round3: GENERATION_STOPPED clears a leaked groupReplay so later messages get fresh markers', async () => {
    const lab = fixture({ interval: 5, group: true });
    await lab.emit('GROUP_WRAPPER_STARTED', { selected_group: 'group', type: 'normal' });
    await lab.generate({ avatar: 'a.png', text: 'Original reply.' });
    await lab.emit('GROUP_WRAPPER_FINISHED', { selected_group: 'group', type: 'normal' });
    await lab.controller.settle();
    const originalMarkerId = lab.marker(lab.context.chat.at(-1)).id;
    await lab.emit('GROUP_REGENERATION_STARTED', { generationId: 99 });
    await lab.emit('GENERATION_STOPPED');
    lab.generating = false;
    await lab.controller.settle();
    const fresh = await lab.generate({ avatar: 'a.png', text: 'A completely new message after aborted regen.' });
    await lab.controller.settle();
    assert.notEqual(lab.marker(fresh).id, originalMarkerId, 'a stopped regen cannot leak its replay map into later generations');
});
