import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../public/scripts/group-chats.js', import.meta.url), 'utf8');
const begin = source.indexOf('async function regenerateGroup() {');
const fn = source.slice(begin, source.indexOf('\n}\n', begin) + 2);

function fixture(onStart = () => {}, onFinish = () => {}) {
    let resolve;
    let reject;
    const gate = new Promise((yes, no) => { resolve = yes; reject = no; });
    let entered;
    const started = new Promise(yes => { entered = yes; });
    const events = [];
    const sendButtonStates = [];
    let generationCalls = 0;
    const deps = {
        selected_group:'group', chat_metadata:{}, chat:[{is_user:true,extra:{gen_id:100}}],
        is_send_press:false, is_group_generating:false,
        document: { body: { dataset: {} } },
        chatId:'chat', getCurrentChatId:() => deps.chatId,
        getLastMessageGenerationId:() => {
            const message = deps.chat.at(-1);
            return message && !message.is_user && !message.is_system && message.extra ? message.extra.gen_id : null;
        },
        event_types:{GROUP_REGENERATION_STARTED:'start',GROUP_REGENERATION_FINISHED:'finish'},
        eventSource:{emit:async (name,operation) => {
            events.push(name);
            if(name === 'start') await onStart(deps,operation);
            if(name === 'finish') await onFinish(deps,operation);
        }},
        deleteLastMessage:async () => { throw new Error('must not delete the user message'); },
        setExternalAbortController:() => {},
        setSendButtonState:value => { deps.is_send_press = value; sendButtonStates.push(value); },
        generateGroupWrapper:async () => {
            generationCalls++;
            entered();
            try {
                return await gate;
            } finally {
                deps.setSendButtonState(false);
            }
        },
    };
    // Module bindings can change while emit is awaited; resolve them from the mutable environment.
    const regenerate = new Function('environment', 'with (environment) { return (' + fn + '); }')(deps);
    return {regenerate,events,resolve,reject,started,deps,sendButtonStates,
        get sendInProgress() { return deps.is_send_press; },
        get generationCalls() { return generationCalls; },
    };
}

test('real group regeneration keeps its scope until asynchronous generation completes', async () => {
    const lab = fixture();
    const pending = lab.regenerate();
    await lab.started;
    assert.deepEqual(lab.events,['start']);
    assert.equal(lab.sendInProgress,true);
    lab.resolve('done');
    assert.equal(await pending,'done');
    assert.deepEqual(lab.events,['start','finish']);
    assert.deepEqual(lab.sendButtonStates,[true,false]);
});

test('real group regeneration always finishes its scope on a rejected generation', async () => {
    const lab = fixture();
    const pending = lab.regenerate();
    await lab.started;
    lab.reject(new Error('synthetic failure'));
    await assert.rejects(pending,/synthetic failure/);
    assert.deepEqual(lab.events,['start','finish']);
    assert.deepEqual(lab.sendButtonStates,[true,false]);
});

for (const rejected of [false,true]) {
    test(`regeneration preserves a new same-chat generation lock while its finish listener waits after ${rejected ? 'failure' : 'success'}`, async () => {
        let finishListener;
        const waiting = new Promise(resolve => { finishListener = resolve; });
        let enteredFinish;
        const finishing = new Promise(resolve => { enteredFinish = resolve; });
        const lab = fixture(undefined, async () => { enteredFinish(); await waiting; });
        const pending = lab.regenerate();
        await lab.started;
        if (rejected) lab.reject(new Error('synthetic failure'));
        else lab.resolve('done');
        await finishing;

        assert.deepEqual(lab.sendButtonStates,[true,false]);
        assert.equal(lab.sendInProgress,false);
        lab.deps.setSendButtonState(true);
        lab.deps.is_group_generating = true;
        finishListener();
        if (rejected) await assert.rejects(pending,/synthetic failure/);
        else assert.equal(await pending,'done');

        assert.deepEqual(lab.events,['start','finish']);
        assert.deepEqual(lab.sendButtonStates,[true,false,true]);
        assert.equal(lab.sendInProgress,true);
        assert.equal(lab.deps.is_group_generating,true);
    });
}

test('an extension can cancel regeneration before the old batch is deleted', async () => {
    const lab = fixture((_deps,operation) => { operation.cancelled = true; });
    await lab.regenerate();
    assert.equal(lab.generationCalls,0);
    assert.deepEqual(lab.events,['start','finish']);
    assert.deepEqual(lab.sendButtonStates,[true,false]);
    assert.equal(lab.sendInProgress,false);
});

test('rapid regenerations lock before the start listener saves and delete only the captured batch', async () => {
    let finishStart;
    const saving = new Promise(resolve => { finishStart = resolve; });
    let operation;
    const lab = fixture(async (_deps,marker) => { operation = marker; await saving; });
    const previousBatch = [
        {is_user:true,mes:'user message'},
        {is_user:false,mes:'previous first response',extra:{gen_id:50}},
        {is_user:false,mes:'previous second response',extra:{gen_id:50}},
    ];
    const targetBatch = [
        {is_user:false,mes:'target first response',extra:{gen_id:100}},
        {is_user:false,mes:'target second response',extra:{gen_id:100}},
    ];
    lab.deps.chat = structuredClone([...previousBatch,...targetBatch]);
    const deleted = [];
    lab.deps.deleteLastMessage = async () => { deleted.push(lab.deps.chat.pop()); };

    const first = lab.regenerate();
    assert.equal(lab.sendInProgress,true);
    assert.equal(operation.generationId,100);
    assert.equal(await lab.regenerate(),undefined);
    assert.equal(lab.generationCalls,0);
    assert.deepEqual(lab.events,['start']);
    assert.deepEqual(lab.sendButtonStates,[true]);
    assert.deepEqual(deleted,[]);

    finishStart();
    await lab.started;
    assert.equal(lab.generationCalls,1);
    assert.deepEqual(lab.deps.chat,previousBatch);
    assert.deepEqual(deleted,targetBatch.toReversed());
    lab.resolve('done');
    assert.equal(await first,'done');
    assert.deepEqual(lab.events,['start','finish']);
    assert.deepEqual(lab.sendButtonStates,[true,false]);
});

for (const flag of ['is_send_press','is_group_generating']) {
    test(`regeneration does not acquire or release a pre-existing ${flag} lock`, async () => {
        const lab = fixture();
        lab.deps[flag] = true;

        assert.equal(await lab.regenerate(),undefined);
        assert.equal(lab.deps[flag],true);
        assert.equal(lab.generationCalls,0);
        assert.deepEqual(lab.events,[]);
        assert.deepEqual(lab.sendButtonStates,[]);
    });
}

for (const [name, changeOwner] of [
    ['group', deps => { deps.selected_group = 'other-group'; }],
    ['chat ID', deps => { deps.chatId = 'other-chat'; }],
    ['metadata', deps => { deps.chat_metadata = {}; }],
]) {
    for (const sending of [true,false]) {
        test(`regeneration preserves the new owner's sending=${sending} when ${name} changes during its start event`, async () => {
            const lab = fixture(deps => {
                changeOwner(deps);
                deps.is_send_press = sending;
                deps.is_group_generating = sending;
                if (sending) deps.document.body.dataset.generating = 'true';
            });
            const originalMessages = [
                {is_user:true,mes:'original user message'},
                {is_user:false,mes:'original response',extra:{gen_id:100}},
            ];
            lab.deps.chat = structuredClone(originalMessages);
            let deletions = 0;
            lab.deps.deleteLastMessage = async () => { deletions++; lab.deps.chat.pop(); };

            assert.equal(await lab.regenerate(),undefined);
            assert.equal(deletions,0);
            assert.equal(lab.generationCalls,0);
            assert.deepEqual(lab.deps.chat,originalMessages);
            assert.deepEqual(lab.events,['start','finish']);
            assert.deepEqual(lab.sendButtonStates,sending ? [true] : [true,false]);
            assert.equal(lab.sendInProgress,sending);
            assert.equal(lab.deps.is_group_generating,sending);
        });
    }
}

for (const phase of ['start', 'deletion', 'finish']) {
    for (const marker of [undefined, 'true', '']) {
        const generating = marker !== undefined;
        test(`regeneration ${generating ? 'keeps' : 'releases'} its lock after an owner switch during ${phase} with generating=${JSON.stringify(marker)}`, async () => {
            const changeOwner = deps => {
                deps.chatId = 'other-chat';
                if (generating) deps.document.body.dataset.generating = marker;
            };
            const lab = fixture((deps, operation) => {
                if (phase === 'start') changeOwner(deps);
                if (phase === 'finish') operation.cancelled = true;
            }, deps => {
                if (phase === 'finish') changeOwner(deps);
            });
            if (phase === 'deletion') {
                lab.deps.chat.push({ is_user: false, extra: { gen_id: 100 } });
                lab.deps.deleteLastMessage = async () => {
                    lab.deps.chat.pop();
                    changeOwner(lab.deps);
                };
            }

            assert.equal(await lab.regenerate(), undefined);
            assert.equal(lab.generationCalls, 0);
            assert.deepEqual(lab.events, ['start', 'finish']);
            assert.deepEqual(lab.sendButtonStates, generating ? [true] : [true, false]);
            assert.equal(lab.sendInProgress, generating);
            assert.equal(lab.deps.is_group_generating, false);
        });
    }
}

test('regeneration aborts without deleting when the last batch changes during its start event', async () => {
    const replacement = {is_user:false,mes:'new response',extra:{gen_id:200}};
    const lab = fixture(deps => { deps.chat.push(replacement); });
    const originalMessages = [
        {is_user:true,mes:'user message'},
        {is_user:false,mes:'original response',extra:{gen_id:100}},
    ];
    lab.deps.chat = structuredClone(originalMessages);
    let deletions = 0;
    lab.deps.deleteLastMessage = async () => { deletions++; lab.deps.chat.pop(); };

    assert.equal(await lab.regenerate(),undefined);
    assert.equal(deletions,0);
    assert.equal(lab.generationCalls,0);
    assert.deepEqual(lab.deps.chat,[...originalMessages,replacement]);
    assert.deepEqual(lab.events,['start','finish']);
    assert.deepEqual(lab.sendButtonStates,[true,false]);
});

test('regeneration stops deleting and preserves another chat generation when ownership changes during deletion', async () => {
    const lab = fixture();
    lab.deps.chat = [
        {is_user:true,mes:'user message'},
        {is_user:false,mes:'first response',extra:{gen_id:100}},
        {is_user:false,mes:'second response',extra:{gen_id:100}},
    ];
    const otherChat = [{is_user:false,mes:'other chat response',extra:{gen_id:200}}];
    let deletions = 0;
    lab.deps.deleteLastMessage = async () => {
        deletions++;
        lab.deps.chat.pop();
        lab.deps.chatId = 'other-chat';
        lab.deps.chat = structuredClone(otherChat);
        lab.deps.is_send_press = true;
        lab.deps.is_group_generating = true;
        lab.deps.document.body.dataset.generating = 'true';
    };

    assert.equal(await lab.regenerate(),undefined);
    assert.equal(deletions,1);
    assert.equal(lab.generationCalls,0);
    assert.deepEqual(lab.deps.chat,otherChat);
    assert.deepEqual(lab.events,['start','finish']);
    assert.deepEqual(lab.sendButtonStates,[true]);
    assert.equal(lab.sendInProgress,true);
    assert.equal(lab.deps.is_group_generating,true);
});

test('queued conditional save checks ownership at the write boundary', async () => {
    const text=readFileSync(new URL('../public/script.js',import.meta.url),'utf8');
    const start=text.indexOf('async function saveChatConditional(');
    const body=text.slice(start,text.indexOf('\n}\n',start)+2);
    let unlock;
    const waiting=new Promise(resolve=>{unlock=resolve;});
    let owner=true,writes=0;
    const deps={waitUntilCondition:()=>waiting,DEFAULT_SAVE_EDIT_TIMEOUT:100,isChatSaving:false,
        cancelDebouncedChatSave:()=>{},selected_group:null,saveChat:async()=>{writes++;return true;},
        saveGroupChat:async()=>{throw new Error('wrong saver');},saveTokenCache:()=>{},
        saveItemizedPrompts:()=>{},getCurrentChatId:()=> 'chat'};
    const names=Object.keys(deps);
    const save=new Function(...names,'return ('+body+');')(...names.map(name=>deps[name]));
    const pending=save({shouldSave:()=>owner});
    owner=false;unlock();
    assert.equal(await pending,false);
    assert.equal(writes,0);
    assert.equal(await save(null),true);
    assert.equal(writes,1);
});
