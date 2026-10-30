import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from '../public/lib/eventemitter.js';
import {
    BOUND_INSTRUCT_PROMPT_KEY,
    activeInstruct,
    applyBoundReinject,
    applyCommittedMessageClear,
    applyDeletionClear,
    applyUserSentClear,
    cancelPendingInstruct,
    clearTemporaryInstruct,
    createBoundInstruct,
    initInstructLifecycle,
    instructChipLabel,
    instructPreview,
    messageFingerprint,
    readBoundInstruct,
    shouldClearBoundForFingerprint,
    shouldReinject,
} from '../public/scripts/extensions/director/instruct.js';

globalThis.localStorage = { getItem: () => null };

const user = { is_user: true, name: 'User', mes: 'hello', send_date: 'stamp-a' };
const reply = { is_user: false, name: 'Bot', mes: 'reply', send_date: 'stamp-b' };

function bindingFrom(message, slotIndex = 1, text = 'INSTR') {
    return {
        id: 'director-1',
        text,
        slotIndex,
        prevFingerprint: messageFingerprint(message),
        boundAt: 10,
    };
}

function withBinding(binding = bindingFrom(user)) {
    return { director: { boundInstruct: { ...binding } } };
}

function promptContext(chat, metadata) {
    const extensionPrompts = {};
    return {
        chat,
        chatMetadata: metadata,
        extensionPrompts,
        setExtensionPrompt(key, value, position, depth, scan, role) {
            extensionPrompts[key] = { value, position, depth, scan, role };
        },
    };
}

function harness({ chat = [user, reply], injects = {}, chatId = 'chat-a' } = {}) {
    const eventSource = new EventEmitter();
    const eventTypes = { GENERATE_AFTER_DATA: 'prompt', GENERATION_COMPLETED: 'completed' };
    const metadata = { script_injects: { ...injects } };
    const prompts = [];
    let saves = 0;
    let refreshes = 0;
    const context = {
        eventSource,
        eventTypes,
        chatId,
        chat,
        chatMetadata: metadata,
        extensionPrompts: {},
        setExtensionPrompt: (...args) => {
            prompts.push(args);
            context.extensionPrompts[args[0]] = { value: args[1] };
        },
        saveMetadata: async () => { saves += 1; },
    };
    initInstructLifecycle(() => context, () => { refreshes += 1; });
    return {
        context,
        metadata,
        prompts,
        get saves() { return saves; },
        get refreshes() { return refreshes; },
        prompt: (data, dryRun = false) => eventSource.emit('prompt', data, dryRun),
        complete: (data, type) => eventSource.emit('completed', { data, chatMetadata: metadata, chatId, type }),
        stop: () => eventSource.emit('generation_stopped'),
        end: () => eventSource.emit('generation_ended'),
    };
}

test('shouldReinject is true only for swipe, regenerate, and continue at the bound slot with the same fingerprint and no pending', () => {
    for (const type of ['swipe', 'regenerate', 'continue']) {
        for (const position of [true, false]) {
            for (const fingerprint of [true, false]) {
                for (const hasPending of [true, false]) {
                    const source = { ...user };
                    const chat = type === 'regenerate'
                        ? (position ? [source] : [source, { ...reply }])
                        : (position ? [source, { ...reply }] : [source]);
                    if (!fingerprint) chat[0] = { ...chat[0], mes: 'edited' };
                    const binding = bindingFrom(user);
                    const state = { type, chat, binding, hasPending };
                    const label = `${type} position=${position} fingerprint=${fingerprint} pending=${hasPending}`;
                    assert.equal(shouldReinject(state), !hasPending && position && fingerprint, label);
                    assert.equal(shouldClearBoundForFingerprint(state), !hasPending && position && !fingerprint, `clear ${label}`);
                }
            }
        }
    }
    const matching = { type: 'swipe', chat: [{ ...user }, { ...reply }], binding: bindingFrom(user), hasPending: false };
    for (const type of ['impersonate', 'quiet', 'normal', undefined, '']) {
        assert.equal(shouldReinject({ ...matching, type }), false, `reinject ${String(type)}`);
        assert.equal(shouldClearBoundForFingerprint({ ...matching, type }), false, `clear ${String(type)}`);
    }
    assert.equal(shouldReinject({ ...matching, binding: null }), false);
});

test('message fingerprint ignores send_date and changes with mes, name, or is_user', () => {
    const base = messageFingerprint(user);
    assert.equal(base, messageFingerprint({ ...user, send_date: 'stamp-z' }));
    assert.equal(base, messageFingerprint(user));
    assert.notEqual(base, messageFingerprint({ ...user, mes: 'edited' }));
    assert.notEqual(base, messageFingerprint({ ...user, name: 'Other' }));
    assert.notEqual(base, messageFingerprint({ ...user, is_user: false }));
    assert.equal(messageFingerprint(undefined), messageFingerprint(undefined));
    assert.notEqual(messageFingerprint(undefined), base);
    const emoji = '🙂'.repeat(17);
    assert.equal(instructPreview('1234567890123456'), '1234567890123456');
    assert.equal(instructPreview('12345678901234567'), '1234567890123456…');
    assert.equal(instructPreview(emoji), `${'🙂'.repeat(16)}…`);
    assert.equal(instructChipLabel('pending', 'short'), '🎭 待生效：short ✕');
    assert.equal(instructChipLabel('bound', 'x'.repeat(20)), `🎭 重生沿用：${'x'.repeat(16)}… ✕`);
});

test('bound instructions are created from the chat present at completion and cleared by every release rule', () => {
    const made = createBoundInstruct([{ ...user, send_date: 'later' }, reply], { id: 'director-9', value: 'TEXT' });
    assert.equal(made.slotIndex, 1);
    assert.equal(made.text, 'TEXT');
    assert.equal(made.id, 'director-9');
    assert.equal(made.prevFingerprint, messageFingerprint(user));
    assert.equal(typeof made.boundAt, 'number');
    assert.equal(createBoundInstruct([], { id: 'x', value: 'y' }), null);
    assert.equal(createBoundInstruct(undefined, { id: 'x', value: 'y' }), null);

    const kept = withBinding();
    assert.equal(applyCommittedMessageClear(kept, 1), false);
    assert.ok(readBoundInstruct(kept));
    assert.equal(applyCommittedMessageClear(kept, 2), true);
    assert.equal(readBoundInstruct(kept), null);

    const sent = withBinding();
    assert.equal(applyUserSentClear(sent), true);
    assert.equal(sent.director, undefined);
    assert.equal(applyUserSentClear(sent), false);

    const slot = bindingFrom(user, 1);
    assert.equal(applyDeletionClear(withBinding(slot), [user, reply], false), false);
    assert.equal(applyDeletionClear(withBinding(slot), [user], false), true);
    assert.equal(applyDeletionClear(withBinding(slot), [user], true), false);
    assert.equal(applyDeletionClear(withBinding(slot), [], true), true);
    assert.equal(applyDeletionClear(withBinding(slot), [{ ...user, name: 'Renamed' }], true), true);

    const pending = {
        value: 'PENDING',
        directorEphemeral: true,
        position: 1,
        depth: 0,
        scan: false,
        role: 0,
    };
    const mixed = promptContext([user, reply], {
        script_injects: { fresh: { ...pending }, ordinary: { value: 'ordinary' } },
        ...withBinding(),
    });
    assert.equal(activeInstruct(mixed.chatMetadata).state, 'pending');
    assert.equal(activeInstruct(mixed.chatMetadata).text, 'PENDING');
    assert.equal(cancelPendingInstruct(mixed, 'fresh'), true);
    assert.equal(mixed.chatMetadata.script_injects.fresh, undefined);
    assert.equal(mixed.chatMetadata.script_injects.ordinary.value, 'ordinary');
    assert.equal(mixed.extensionPrompts.script_inject_fresh.value, '');
    assert.equal(readBoundInstruct(mixed.chatMetadata).text, 'INSTR');
    assert.equal(cancelPendingInstruct(mixed, 'ordinary'), false);
    assert.equal(activeInstruct(mixed.chatMetadata).state, 'bound');
});

test('reinject copies binding text through the in-chat prompt and leaves the binding in place', () => {
    const metadata = withBinding();
    const context = promptContext([user, reply], metadata);
    const applied = applyBoundReinject(context, 'swipe');
    assert.deepEqual(applied, { reinjected: true, cleared: false });
    assert.equal(context.extensionPrompts[BOUND_INSTRUCT_PROMPT_KEY].value, 'INSTR');
    assert.equal(context.extensionPrompts[BOUND_INSTRUCT_PROMPT_KEY].position, 1);
    assert.equal(context.extensionPrompts[BOUND_INSTRUCT_PROMPT_KEY].depth, 0);
    assert.equal(context.extensionPrompts[BOUND_INSTRUCT_PROMPT_KEY].scan, false);
    assert.equal(context.extensionPrompts[BOUND_INSTRUCT_PROMPT_KEY].role, 0);
    assert.equal(context.chatMetadata.script_injects, undefined);
    assert.equal(readBoundInstruct(metadata).text, 'INSTR');
    clearTemporaryInstruct(context);
    assert.equal(context.extensionPrompts[BOUND_INSTRUCT_PROMPT_KEY], undefined);

    const blocked = promptContext([user, reply], {
        ...withBinding(),
        script_injects: { fresh: { value: 'PENDING', directorEphemeral: true } },
    });
    assert.deepEqual(applyBoundReinject(blocked, 'continue'), { reinjected: false, cleared: false });
    assert.equal(blocked.extensionPrompts[BOUND_INSTRUCT_PROMPT_KEY], undefined);
    assert.equal(readBoundInstruct(blocked.chatMetadata).text, 'INSTR');

    const drifted = promptContext([{ ...user, mes: 'edited' }], withBinding());
    assert.deepEqual(applyBoundReinject(drifted, 'regenerate'), { reinjected: false, cleared: true });
    assert.equal(readBoundInstruct(drifted.chatMetadata), null);
    assert.equal(drifted.extensionPrompts[BOUND_INSTRUCT_PROMPT_KEY], undefined);
});

test('a completed pending instruction becomes bound, reinject does not consume it, and failure leaves both', async () => {
    const inject = { value: 'Director\nretry instruction', directorEphemeral: true, position: 1, depth: 0, scan: false, role: 0 };
    const lab = harness({ injects: { director: inject } });
    const data = { prompt: [{ role: 'system', content: [{ type: 'text', text: inject.value }] }] };
    await lab.prompt(data);
    await lab.stop();
    await lab.end();
    assert.equal(lab.metadata.script_injects.director, inject);
    assert.equal(lab.metadata.director, undefined);
    assert.equal(lab.saves, 0);
    await lab.complete(data, 'normal');
    assert.equal(lab.metadata.script_injects.director, undefined);
    assert.equal(lab.saves, 1);
    assert.equal(lab.refreshes, 1);
    assert.equal(lab.prompts[0][0], 'script_inject_director');
    const bound = readBoundInstruct(lab.metadata);
    assert.equal(bound.text, inject.value);
    assert.equal(bound.id, 'director');
    assert.equal(bound.slotIndex, 1);
    assert.equal(bound.prevFingerprint, messageFingerprint(user));
    await lab.complete(data, 'swipe');
    assert.equal(lab.saves, 1);
    assert.equal(readBoundInstruct(lab.metadata), bound);

    const quiet = harness({
        injects: { director: { ...inject, value: 'quiet only' } },
        chat: [user, reply],
    });
    quiet.metadata.director = { boundInstruct: { ...bound, text: 'keep-me' } };
    const quietData = { prompt: 'quiet only' };
    await quiet.prompt(quietData);
    await quiet.complete(quietData, 'quiet');
    assert.equal(quiet.metadata.script_injects.director, undefined);
    assert.equal(readBoundInstruct(quiet.metadata).text, 'keep-me');
    assert.equal(quiet.saves, 1);

    const impersonated = harness({ injects: { director: { ...inject, value: 'impersonate only' } } });
    const impersonatedData = { prompt: 'impersonate only' };
    await impersonated.prompt(impersonatedData);
    await impersonated.complete(impersonatedData, 'impersonate');
    assert.equal(impersonated.metadata.script_injects.director, undefined);
    assert.equal(impersonated.metadata.director, undefined);

    const replaced = harness({ chat: [user, reply, user, reply] });
    replaced.metadata.director = { boundInstruct: { ...bound, text: 'old-bound' } };
    const next = { ...inject, value: 'new-bound' };
    replaced.metadata.script_injects.director = next;
    const nextData = { prompt: 'new-bound' };
    await replaced.prompt(nextData);
    await replaced.complete(nextData, 'swipe');
    assert.equal(replaced.metadata.script_injects.director, undefined);
    assert.equal(readBoundInstruct(replaced.metadata).text, 'new-bound');
    assert.equal(readBoundInstruct(replaced.metadata).slotIndex, 3);
    assert.equal(replaced.saves, 1);

    const untouched = harness();
    untouched.metadata.director = { boundInstruct: { ...bound } };
    const missed = { prompt: 'no instruction here' };
    await untouched.prompt(missed);
    await untouched.complete(missed, 'swipe');
    assert.equal(readBoundInstruct(untouched.metadata).text, inject.value);
    assert.equal(untouched.saves, 0);

    const legacy = harness({ chat: undefined });
    legacy.context.chat = undefined;
    legacy.metadata.script_injects.director = inject;
    await legacy.prompt(data);
    await legacy.complete(data, undefined);
    assert.equal(legacy.metadata.script_injects.director, undefined);
    assert.equal(legacy.metadata.director, undefined);
    assert.equal(legacy.saves, 1);
    assert.equal(legacy.prompts[0][0], 'script_inject_director');
});
