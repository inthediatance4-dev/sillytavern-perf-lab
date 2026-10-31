import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../public/scripts/group-chats.js', import.meta.url), 'utf8');
const begin = source.indexOf('async function regenerateGroup() {');
const fn = source.slice(begin, source.indexOf('\n}\n', begin) + 2);

function fixture(onStart = () => {}) {
    let resolve;
    let reject;
    const gate = new Promise((yes, no) => { resolve = yes; reject = no; });
    let entered;
    const started = new Promise(yes => { entered = yes; });
    const events = [];
    const deps = {
        selected_group:'group', chat_metadata:{}, chat:[{is_user:true,extra:{gen_id:100}}],
        getCurrentChatId:() => 'chat', getLastMessageGenerationId:() => 100,
        event_types:{GROUP_REGENERATION_STARTED:'start',GROUP_REGENERATION_FINISHED:'finish'},
        eventSource:{emit:async name => { events.push(name); if(name === 'start') onStart(deps); }},
        deleteLastMessage:async () => { throw new Error('must not delete the user message'); },
        setExternalAbortController:() => {}, setSendButtonState:() => {},
        generateGroupWrapper:() => { entered(); return gate; },
    };
    const names = Object.keys(deps);
    const regenerate = new Function(...names, 'return (' + fn + ');')(...names.map(name => deps[name]));
    return {regenerate,events,resolve,reject,started,deps};
}

test('real group regeneration keeps its scope until asynchronous generation completes', async () => {
    const lab = fixture();
    const pending = lab.regenerate();
    await lab.started;
    assert.deepEqual(lab.events,['start']);
    lab.resolve('done');
    assert.equal(await pending,'done');
    assert.deepEqual(lab.events,['start','finish']);
});

test('real group regeneration always finishes its scope on a rejected generation', async () => {
    const lab = fixture();
    const pending = lab.regenerate();
    await lab.started;
    lab.reject(new Error('synthetic failure'));
    await assert.rejects(pending,/synthetic failure/);
    assert.deepEqual(lab.events,['start','finish']);
});

test('an extension can cancel regeneration before the old batch is deleted', async () => {
    const lab = fixture();
    let generated=false;lab.started.then(()=>{generated=true;});lab.resolve('unused');
    lab.deps.eventSource.emit = async (name,operation) => {
        lab.events.push(name);
        if(name === 'start') operation.cancelled=true;
    };
    // fixture closes over the same eventSource object, not its emit function.
    await lab.regenerate();
    assert.equal(generated,false);
    assert.deepEqual(lab.events,['start','finish']);
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
