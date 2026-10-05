"""Acceptance on the independent loopback application; synthetic data only."""
import json
import pathlib
import uuid
import os
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(r'F:\SillyTavern-Research\2026-10-05-lifecycle\browser')
out.mkdir(parents=True, exist_ok=True)
errors = []
generation_requests = []
with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get('LAB_BROWSER_EXECUTABLE', 'C:/Program Files/Google/Chrome/Application/chrome.exe'),
        headless=True, args=['--disable-gpu'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, locale='en-US')
    page.on('pageerror', lambda error: errors.append(str(error)))
    def watch(request):
        if '/generate' in request.url and '/api/' in request.url:
            generation_requests.append(request.url)
    page.on('request', watch)
    page.goto('http://127.0.0.1:8771/', wait_until='domcontentloaded')
    page.wait_for_function('window.SillyTavern?.getContext')
    page.evaluate("() => { window.__labApplicationReady = false; const context = SillyTavern.getContext(); context.eventSource.once(context.eventTypes.APP_READY, () => { window.__labApplicationReady = true; }); }")
    page.wait_for_function("window.__labApplicationReady || document.querySelector('dialog[open] .onboarding') || (document.querySelector('.character_select') && !document.querySelector('.splash-screen'))", timeout=60000)
    # Finish first-run onboarding with a synthetic persona, using visible UI.
    welcome = page.locator('dialog[open]:has(.onboarding)')
    if welcome.count():
        inputs = welcome.locator('input[type=text]')
        if inputs.count():
            inputs.last.fill('Synthetic Tester')
        welcome.locator('.popup-button-ok').click()
    page.wait_for_function("window.__labApplicationReady || (document.querySelector('.character_select') && !document.querySelector('.splash-screen'))", timeout=60000)
    print('Browser application ready', flush=True)
    suffix = uuid.uuid4().hex[:10]
    results = page.evaluate(r'''async (suffix) => {
        const token = (await (await fetch('/csrf-token')).json()).token;
        const post = async (endpoint, body) => {
            const r = await fetch(endpoint, { method: 'POST', headers: {
                'X-CSRF-Token': token, 'Content-Type': 'application/json'
            }, body: JSON.stringify(body) });
            if (!r.ok) throw new Error(endpoint + ': ' + r.status + ' ' + await r.text());
            return r.json();
        };
        const form = new FormData();
        form.set('ch_name', 'Synthetic Performance Sample');
        form.set('file_name', 'SyntheticLab-' + suffix);
        form.set('description', 'Artificial test character. No production conversations.');
        form.set('first_mes', 'This is an independent performance lab.');
        const created = await fetch('/api/characters/create', { method: 'POST',
            headers: { 'X-CSRF-Token': token }, body: form });
        if (!created.ok) throw new Error('create: ' + created.status);
        const avatar = await created.text();
        const all = await post('/api/characters/all', {});
        const card = all.find(c => c.avatar === avatar);
        if (!card) throw new Error('Synthetic character missing');
        const rows = [{ user_name: 'Synthetic Tester', character_name: card.name,
            chat_metadata: { integrity: 'synthetic-' + suffix } }];
        for (let i = 0; i < 24; i++) rows.push({ name: i % 2 ? card.name : 'Synthetic Tester',
            is_user: i % 2 === 0, send_date: new Date().toISOString(),
            mes: i === 0 ? 'alpha: Artificial message for search verification.' :
                i === 23 ? 'beta: All sample messages are synthetic; the live service is separate.' :
                'Synthetic performance message ' + i, extra: {} });
        const body = { avatar_url: avatar, file_name: card.chat, chat: rows };
        const saved = await post('/api/chats/save', body);
        const read = await post('/api/chats/get', body);
        if (JSON.stringify(read) !== JSON.stringify(rows)) throw new Error('Save/read mismatch');
        const hits = await post('/api/chats/search', { avatar_url: avatar, query: 'alpha beta' });
        if (hits.length !== 1 || hits[0].message_count !== 24) throw new Error('Cross-message search failed: ' + JSON.stringify(hits));
        const absent = await post('/api/chats/search', { avatar_url: avatar, query: 'absent-' + suffix });
        if (absent.length !== 0) throw new Error('Absent keyword matched');
        let backups = [];
        for (let i = 0; i < 30; i++) {
            backups = await post('/api/backups/chat/get', {});
            if (backups.some(b => b.file_name.includes(suffix))) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        const backup = backups.find(b => b.file_name.includes(suffix));
        if (!backup) throw new Error('No backup for synthetic chat');
        const download = await fetch('/api/backups/chat/download', { method: 'POST', headers: {
            'X-CSRF-Token': token, 'Content-Type': 'application/json'
        }, body: JSON.stringify({ name: backup.file_name }) });
        if (!download.ok || await download.text() !== rows.map(r => JSON.stringify(r)).join('\n')) {
            throw new Error('Backup download mismatch');
        }
        await SillyTavern.getContext().getCharacters();
        const index = SillyTavern.getContext().characters.findIndex(c => c.avatar === avatar);
        await SillyTavern.getContext().selectCharacterById(String(index));
        return { avatar, chatName: card.chat, saved, messages: read.length - 1, searchHits: hits.length,
            absentHits: absent.length, backupDownloadExact: true };
    }''', suffix)
    print('Synthetic save/read/search/backup passed', flush=True)
    page.wait_for_function('SillyTavern.getContext().chat.length === 24')
    page.locator('#chat .mes').last.wait_for(state='visible')
    page.screenshot(path=str(out / 'desktop.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(out / 'mobile.png'), full_page=True)

    # Execute actual browser save handlers after a second actor retires their paths.
    page.evaluate(r"""async (sample) => {
        const token = (await (await fetch('/csrf-token')).json()).token;
        const requests = [];
        const getRequests = [];
        const realFetch = window.fetch;
        window.fetch = async (...args) => {
            if (String(args[0]).includes('/api/chats/') && String(args[0]).includes('/get'))
                getRequests.push(String(args[0]));
            const response = await realFetch(...args);
            if (String(args[0]).includes('/api/chats/') && String(args[0]).includes('/save')) {
                const rawBody = typeof args[1].body === 'string' ? args[1].body
                    : await new Response(new Blob([args[1].body]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
                requests.push({url:String(args[0]), status:response.status,
                    jsonl:JSON.parse(rawBody).chat.map(row=>JSON.stringify(row)).join('\n')});
            }
            return response;
        };
        const post = async (endpoint, body) => {
            const r = await realFetch(endpoint, {method:'POST', headers:{'X-CSRF-Token':token,
                'Content-Type':'application/json'}, body:JSON.stringify(body)});
            return {status:r.status, data:await r.json()};
        };
        const main = await import('/script.js');
        const groupModule = await import('/scripts/group-chats.js');
        const freshName = 'Lifecycle-Fresh-' + sample.suffix;
        const movedName = 'Lifecycle-Renamed-' + sample.suffix;
        const moved = await post('/api/chats/rename', {avatar_url:sample.avatar,
            original_file:sample.chatName+'.jsonl', renamed_file:movedName+'.jsonl'});
        if (moved.status !== 200) throw new Error('Rename '+JSON.stringify(moved));
        window.__lifecycleProbe = {main,groupModule,post,requests,getRequests,realFetch,sample,freshName,movedName};
        window.__lifecycleProbe.pending = main.saveChat({force:true});
    }""", {**results, 'suffix': suffix})
    normal_dialog = page.locator('dialog[open]')
    normal_dialog.get_by_text('This chat changed on disk', exact=True).wait_for()
    normal_message = normal_dialog.inner_text()
    assert 'unsaved messages are still in this tab' in normal_message
    assert 'OVERWRITE' not in normal_message
    with page.expect_download() as download_event:
        normal_dialog.get_by_text('Download unsaved chat', exact=True).click()
    unsaved_download = download_event.value
    unsaved_target = out / 'unsaved-synthetic-chat.jsonl'
    unsaved_download.save_as(str(unsaved_target))
    expected_unsaved = page.evaluate('async () => { await window.__lifecycleProbe.pending; return window.__lifecycleProbe.requests[0].jsonl; }')
    assert unsaved_target.read_text(encoding='utf-8') == expected_unsaved
    print('Unsaved JSONL download matched the submitted snapshot', flush=True)
    page.evaluate("() => { window.__lifecycleProbe.getCountBeforeInsert = window.__lifecycleProbe.getRequests.length; window.__lifecycleProbe.pending = window.__lifecycleProbe.main.sendMessageAsUser('Synthetic unsaved insert after retired path', '', 0); }")
    insert_dialog = page.locator('dialog[open]')
    insert_dialog.get_by_text('This chat changed on disk', exact=True).wait_for()
    insert_dialog.get_by_text('Keep this tab', exact=True).click()
    insert_result = page.evaluate("async () => { await window.__lifecycleProbe.pending; const context = SillyTavern.getContext(); return {messageCount:context.chat.length, firstMessage:context.chat[0]?.mes, getRequests:window.__lifecycleProbe.getRequests.length-window.__lifecycleProbe.getCountBeforeInsert}; }")
    assert insert_result == {'messageCount':25, 'firstMessage':'Synthetic unsaved insert after retired path', 'getRequests':0}, insert_result
    print('Insert-at conflict kept all 25 messages without reload', flush=True)
    group = page.evaluate(r"""async () => {
            const {main,groupModule,post,requests,sample,freshName,movedName} = window.__lifecycleProbe;
            await main.saveChat({chatName:freshName});
            const fresh = await post('/api/chats/get', {avatar_url:sample.avatar, file_name:freshName});
            if (fresh.status !== 200 || fresh.data.length !== 26) throw new Error('Fresh name could not preserve 25 messages');

            const chatId = 'Lifecycle-Group-' + sample.suffix;
            const group = await post('/api/groups/create', {name:'Synthetic Lifecycle Group',
                members:[sample.avatar], chat_id:chatId, chats:[chatId]});
            if (group.status !== 200) throw new Error('Create group '+JSON.stringify(group));
            const groupSave = await post('/api/chats/group/save', {id:chatId, chat:fresh.data});
            if (groupSave.status !== 200) throw new Error('Group synthetic save failed');
            await groupModule.getGroups();
            if (!await groupModule.openGroupById(group.data.id)) throw new Error('Synthetic group could not be selected');
            const deleted = await post('/api/chats/group/delete', {id:chatId});
            if (deleted.status !== 200) throw new Error('Group chat deletion failed');
            window.__lifecycleProbe.pending = groupModule.saveGroupChat(group.data.id, false, true);
            window.__lifecycleProbe.freshCount = fresh.data.length-1;
            return {chatId,groupId:group.data.id};
    }""")
    group_dialog = page.locator('dialog[open]')
    group_dialog.get_by_text('This chat changed on disk', exact=True).wait_for()
    group_message = group_dialog.inner_text()
    assert 'unsaved messages are still in this tab' in group_message
    assert 'OVERWRITE' not in group_message
    page.screenshot(path=str(out / 'lifecycle-conflict.png'), full_page=True)
    group_dialog.get_by_text('Keep this tab', exact=True).click()
    lifecycle = page.evaluate(r"""async () => {
            const {requests,sample,movedName,freshName,realFetch} = window.__lifecycleProbe;
            await Promise.race([window.__lifecycleProbe.pending,
                new Promise((_,reject)=>setTimeout(()=>reject(new Error('Group conflict did not settle after Keep this tab')),10000))]);
            const denied = requests.filter(r=>r.status===409);
            if (denied.length !== 3) throw new Error('Expected three blocked saves and no force retries: '+JSON.stringify(requests));
            if (requests.length !== 4 || requests.map(r=>r.status).join(',') !== '409,409,200,409')
                throw new Error('Unexpected automatic save retry: '+JSON.stringify(requests));
            window.fetch = realFetch;
            return {blockedSaves:denied.map(({url,status})=>({url,status})),saveRequests:requests.map(({url,status})=>({url,status})),
                forceRetryCount:requests.filter(r=>r.status===409).length-3,
                freshNameMessages:window.__lifecycleProbe.freshCount, retiredOriginal:sample.chatName,
                movedName,freshName,messagesStillInTab:SillyTavern.getContext().chat.length};
    }""")
    lifecycle.update({'normalDialog':normal_message,'groupDialog':group_message,
                      'downloadMatchesUnsavedRequest':True,'insertAtPreserved':insert_result, **group})
    results['lifecycle'] = lifecycle

    assert not errors, errors
    assert not generation_requests, generation_requests
    results.update({'pageErrors': errors, 'generationRequests': generation_requests,
                    'browser': browser.version, 'origin': 'http://127.0.0.1:8771/'})
    (out / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps(results))
    browser.close()
