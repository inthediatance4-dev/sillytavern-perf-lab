import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { EventEmitter } from '../public/lib/eventemitter.js';
import { event_types as eventTypes } from '../public/scripts/events.js';
import { AFFINITY_PROMPT_KEY, createAffinityController, affinityOwners } from '../public/scripts/extensions/director/affinity.js';
import { affinityScores } from '../public/scripts/extensions/director/affinity-state.js';

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

function fixture({ interval = 10, group = false, reply, initial } = {}) {
    const eventSource = new EventEmitter();
    const calls = [];
    const saves = [];
    const prompts = [];
    let sequence = 0;
    const id = ++fixtureId;
    let generating = false;
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
    });
    const emit = (name, ...args) => eventSource.emit(eventTypes[name], ...args);
    const state = () => context.chatMetadata.director?.__affinity;
    const marker = message => message?.extra?.__affinity;

    async function begin(type = 'normal', { dry = false, params = {}, prepare = true } = {}) {
        generating = true;
        await emit('GENERATION_STARTED', type, params, dry);
        if (prepare) controller.prepare(type);
        const data = { prompt: `assembled ${type} request` };
        await emit('GENERATE_AFTER_DATA', data, dry);
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
        generating = false;
        await emit('CHAT_CHANGED', chatId);
        controller.refresh();
    }

    return {
        controller, eventSource, calls, saves, prompts, emit, state, marker, begin, receive, finalize, end, generate, switchChat,
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
    lab.controller.prepare('normal');
    const token = lab.context.extensionPrompts[AFFINITY_PROMPT_KEY]?.value;
    assert.ok(token.startsWith('AFFINITY_LITERAL_'));
    const data = { prompt: token, negative_prompt: token, nested: { input: token }, messages: [{ content: token }] };
    await lab.emit('GENERATE_AFTER_DATA', data);
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
        lab.controller.prepare('normal');
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
    lab.controller.prepare('normal');
    lab.controller.prepare('normal');
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
    lab.controller.prepare('regenerate');
    const data = { prompt: 'regenerate assembled request' };
    await lab.emit('GENERATE_AFTER_DATA', data, false);
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
    lab.controller.prepare('normal');
    assert.equal(lab.context.extensionPrompts[AFFINITY_PROMPT_KEY], undefined);
    lab.context.characterId = 1;
    lab.controller.prepare('normal');
    const token = lab.context.extensionPrompts[AFFINITY_PROMPT_KEY].value;
    const data = { prompt: token };
    await lab.emit('GENERATE_AFTER_DATA', data, false);
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
    assert.equal(lab.context.extensionPrompts[AFFINITY_PROMPT_KEY], undefined);
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
    lab.controller.prepare('normal');
    assert.equal(lab.context.extensionPrompts[AFFINITY_PROMPT_KEY], undefined);
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
    reloaded.controller.prepare('normal');
    const token = reloaded.context.extensionPrompts[AFFINITY_PROMPT_KEY]?.value;
    assert.equal(typeof token, 'string');
    const data = { prompt: token };
    await reloaded.emit('GENERATE_AFTER_DATA', data, false);
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
        lab.controller.prepare('normal');
        assert.equal(lab.context.extensionPrompts[AFFINITY_PROMPT_KEY], undefined);
    });
}
test('prepare installs literal hidden memory before assembly and restores macros only in generated data', async () => {
    const fact = '角色记得玩家写下 {{user}}，并尊重个人边界。';
    const lab = fixture({ interval: 5, reply: ({ context }) => JSON.stringify({ events: [factFor(context.chat.at(-1), { fact })] }) });
    await settleMany(lab, 5);
    assert.equal(lab.state().events.length, 1);
    lab.controller.prepare('normal');
    const token = lab.context.extensionPrompts[AFFINITY_PROMPT_KEY]?.value;
    assert.equal(typeof token, 'string');
    assert.ok(token.length > 0);
    assert.equal(token.includes('{{'), false, 'prompt assembly must see an opaque token');
    assert.equal(token.includes(fact), false);
    const data = { prompt: [{ role: 'system', content: [{ type: 'text', text: `prefix ${token}` }] }], input: token };
    await lab.emit('GENERATE_AFTER_DATA', data, false);
    assert.ok(data.prompt[0].content[0].text.includes(fact));
    assert.ok(data.input.includes('{{user}}'));
    assert.equal(data.input.includes('好感度：'), false);
    assert.equal(/[-+]\d+\s*(分|points)/i.test(data.input), false);
    lab.controller.prepare('quiet');
    assert.equal(lab.context.extensionPrompts[AFFINITY_PROMPT_KEY], undefined);
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
    lab.controller.prepare('normal');
    assert.ok(lab.context.extensionPrompts[AFFINITY_PROMPT_KEY]);
    lab.context.extensionSettings.director.affinity.enabled = false;
    lab.controller.refresh();
    assert.equal(lab.context.extensionPrompts[AFFINITY_PROMPT_KEY], undefined);
    await settleMany(lab, 5);
    assert.equal(lab.calls.length, 1);
});
test('a disabled Director extension also gates affinity generation and injection', async () => {
    const lab = fixture({ interval: 5 });
    lab.context.extensionSettings.disabledExtensions.push('director');
    lab.controller.refresh();
    await settleMany(lab, 6);
    assert.equal(lab.calls.length, 0);
    assert.equal(lab.context.extensionPrompts[AFFINITY_PROMPT_KEY], undefined);
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
    lab.controller.prepare('normal');
    assert.equal(lab.context.extensionPrompts[AFFINITY_PROMPT_KEY], undefined);
    assert.equal(lab.calls.length, 1);
    lab.context.groups[0].members = ['a.png', 'b.png'];
    await lab.emit('GROUP_UPDATED');
    await lab.controller.settle();
    assert.equal(affinityScores(lab.state())['b.png'], 2);
    lab.controller.prepare('normal');
    assert.ok(lab.context.extensionPrompts[AFFINITY_PROMPT_KEY]?.value);
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
    lab.controller.prepare('normal');
    assert.equal(lab.context.extensionPrompts[AFFINITY_PROMPT_KEY], undefined);
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
