"""Real-browser Fate Card checks on the existing synthetic lab."""
import json
from pathlib import Path
import urllib.request
import uuid


def run_fate_checks(page, sample, fake_url, result, connect_api, swipe_message):
    connect_api(page)
    endpoint = fake_url.removesuffix('/v1')
    secret = 'FATE_PRIVATE_01: A stranger brings a sealed map bearing {{char}} and {{random::a,b}}.'
    reply = 'A stranger arrives with a sealed map. Synthetic Fate reply.'

    def configure(text=reply, **extra):
        payload = {'reply':text, 'tokens':8, 'rate':10000, 'jitter':0, **extra}
        request = urllib.request.Request(endpoint + '/__configure', data=json.dumps(payload).encode(),
                                         headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request) as response:
            assert response.status == 200

    def requests():
        with urllib.request.urlopen(endpoint + '/__requests') as response:
            return json.load(response)

    def body(index=-1):
        return json.dumps(requests()[index], ensure_ascii=False)

    def generation_response(response):
        return response.url.endswith('/api/backends/chat-completions/generate') and response.request.method == 'POST'

    def assert_provider_failure(response, name):
        # Non-streaming upstream errors are wrapped by the native proxy in an
        # HTTP 200 error envelope. Verify the actual provider's HTTP failure too.
        assert response.json().get('error')
        with urllib.request.urlopen(endpoint + '/__timings') as timing_response:
            status = json.load(timing_response)[-1]['status']
        assert status == 500
        result.setdefault('fateProviderFailures', {})[name] = {'providerStatus':status,'proxyStatus':response.status}

    def fate():
        return page.evaluate('structuredClone(SillyTavern.getContext().chatMetadata.director?.fate ?? {})')

    def open_panel():
        if page.locator('#director_fate_panel').is_visible():
            return
        page.locator('#directorButton').click()
        assert page.locator('#director_fate_open').count() == 1, 'Fate Cards entry missing'
        page.locator('#director_fate_open').click()
        page.locator('#director_fate_panel').wait_for(state='visible')

    def close_panel():
        page.locator('dialog[open] .popup-button-cancel').click()
        page.locator('#director_fate_panel').wait_for(state='hidden')

    def idle():
        page.wait_for_function("async () => !(await import('/script.js')).isGenerating()", timeout=30000)

    def hidden(text):
        assert text not in page.locator('body').evaluate('(node) => node.outerHTML')

    def draw(text=secret):
        configure(json.dumps({'event':text}))
        open_panel()
        previous = (fate().get('held') or {}).get('id')
        page.locator('#director_fate_draw').click()
        page.wait_for_function("id => { const h=SillyTavern.getContext().chatMetadata.director?.fate?.held; return h && h.id !== id; }", arg=previous)
        page.wait_for_function("!document.querySelector('#director_fate_draw').disabled")
        held = fate()['held']
        assert held['event'] == text
        hidden(text)
        return held

    def apply(held):
        configure()
        assert page.locator('#send_textarea').input_value() == ''
        before = len(requests())
        page.locator('#director_fate_apply').click()
        page.locator('#director_fate_panel').wait_for(state='hidden')
        page.wait_for_function("id => { const f=SillyTavern.getContext().chatMetadata.director?.fate; return !f?.held && f?.bound?.id === id; }", arg=held['id'], timeout=30000)
        idle()
        open_panel()
        page.wait_for_function("!document.querySelector('#director_fate_draw').disabled")
        close_panel()
        assert len(requests()) > before
        assert body(before).count(held['event']) == 1

    # A normal pending instruction must survive the quiet draw and coexist
    # with the Fate prompt during the eventual real story generation.
    page.locator('#directorButton').click()
    page.locator('#directorPopover [data-preset-id="direct"]').click()
    page.locator('dialog[open] #director-input-0').fill('ORDINARY_DIRECTOR_FATE_COEXIST')
    page.locator('dialog[open] .popup-button-ok').click()
    page.wait_for_function("Object.values(SillyTavern.getContext().chatMetadata.script_injects ?? {}).some(x => x.directorEphemeral)")
    before = page.evaluate('SillyTavern.getContext().chat.length')
    held = draw()
    assert page.evaluate('SillyTavern.getContext().chat.length') == before
    assert 'ORDINARY_DIRECTOR_FATE_COEXIST' not in body()
    assert page.evaluate("Object.values(SillyTavern.getContext().chatMetadata.script_injects).some(x => x.value.includes('ORDINARY_DIRECTOR_FATE_COEXIST'))")
    assert len(page.locator('#director_fate_title').inner_text()) > 0
    result['checks']['fateDrawSealedAndExistingInstructionPreserved'] = True

    page.set_viewport_size({'width':390,'height':844})
    assert page.locator('#director_fate_panel').evaluate('n => n.scrollWidth <= n.clientWidth')
    hidden(secret)
    screenshots=Path(__file__).resolve().parents[1] / '.evidence' / 'fate'
    screenshots.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(screenshots / 'mobile.png'))
    page.set_viewport_size({'width':1440,'height':1000})
    page.screenshot(path=str(screenshots / 'desktop.png'))
    close_panel()
    page.locator('#send_textarea').fill('Unsent draft stays here.')
    open_panel()
    assert page.locator('#send_textarea').input_value() == 'Unsent draft stays here.'
    attempts = len(requests())
    page.locator('#director_fate_apply').click()
    page.wait_for_function("document.querySelector('#director_fate_status')?.textContent.includes('草稿')")
    assert len(requests()) == attempts
    assert page.locator('#send_textarea').input_value() == 'Unsent draft stays here.'
    close_panel()
    page.locator('#send_textarea').fill('')
    page.evaluate('async () => { await SillyTavern.getContext().reloadCurrentChat(); }')
    assert fate()['held']['id'] == held['id']
    open_panel()
    hidden(secret)
    result['checks']['fateMobileDraftAndReload'] = True

    apply(held)
    assert 'ORDINARY_DIRECTOR_FATE_COEXIST' in body()
    result['fateInstructionState'] = page.evaluate('structuredClone(SillyTavern.getContext().chatMetadata)')
    assert page.evaluate('SillyTavern.getContext().chatMetadata.director.boundInstruct.text') == 'ORDINARY_DIRECTOR_FATE_COEXIST' or page.evaluate("SillyTavern.getContext().chatMetadata.director.boundInstruct.text.includes('ORDINARY_DIRECTOR_FATE_COEXIST')")
    assert page.evaluate('SillyTavern.getContext().chat.at(-1).mes') == reply
    target = page.evaluate('SillyTavern.getContext().chat.length - 1')
    swipe_count = page.evaluate('SillyTavern.getContext().chat.at(-1).swipes.length')
    swipe_message(page, target, swipe_count)
    assert body().count(secret) == 1
    page.evaluate("async () => { await SillyTavern.getContext().generate('regenerate'); }")
    assert body().count(secret) == 1
    assert fate()['bound']['id'] == held['id']
    page.evaluate("async () => { await SillyTavern.getContext().generate('normal'); }")
    assert secret not in body()
    result['checks']['fateAdoptAndExactSwipeRegenerateWithoutNormalRetrigger'] = True

    held = draw('FATE_PRIVATE_02: An unexpected invitation offers a new route.')
    configure('MALFORMED_PRIVATE_BODY not valid JSON')
    page.locator('#director_fate_draw').click()
    page.wait_for_function("document.querySelector('#director_fate_status').textContent.includes('未抽到')")
    assert fate()['held']['id'] == held['id']
    hidden('MALFORMED_PRIVATE_BODY')
    configure(nextStatus=500)
    with page.expect_response(generation_response) as failed_apply:
        page.locator('#director_fate_apply').click()
    assert_provider_failure(failed_apply.value, 'apply')
    page.locator('#director_fate_panel').wait_for(state='hidden')
    idle()
    open_panel()
    page.wait_for_function("!document.querySelector('#director_fate_apply').disabled")
    assert fate()['held']['id'] == held['id']
    apply(held)
    result['checks']['fateMalformedDrawAndFailedApplyKeepSameCardForRetry'] = True
    assert not page.evaluate('SillyTavern.getContext().chatMetadata.director.boundInstruct')
    page.evaluate("async () => { await SillyTavern.getContext().generate('regenerate'); }")
    assert body().count(held['event']) == 1
    configure(nextStatus=500)
    target=page.evaluate('SillyTavern.getContext().chat.length - 1')
    swipe_count=page.evaluate('SillyTavern.getContext().chat.at(-1).swipes.length')
    with page.expect_response(generation_response) as failed_swipe:
        swipe_message(page,target,swipe_count)
    assert_provider_failure(failed_swipe.value, 'nativeSwipe')
    idle()
    result['checks']['fateOnlyDirectRegenerateAndNativeFailureUnlock'] = True

    held = draw('FATE_PRIVATE_03: A distant signal interrupts the quiet scene.')
    configure('Slow synthetic Fate reply. ' * 50, rate=5)
    page.evaluate("async () => { (await import('/scripts/openai.js')).oai_settings.stream_openai = true; }")
    page.locator('#director_fate_apply').click()
    page.locator('#director_fate_panel').wait_for(state='hidden')
    page.wait_for_function("async () => (await import('/script.js')).is_send_press && !!SillyTavern.getContext().streamingProcessor", timeout=30000)
    page.wait_for_function("SillyTavern.getContext().chat.at(-1)?.mes?.includes('Slow synthetic')", timeout=30000)
    page.evaluate('() => SillyTavern.getContext().stopGeneration()')
    idle()
    open_panel()
    page.wait_for_function("!document.querySelector('#director_fate_apply').disabled")
    assert fate()['held']['id'] == held['id']
    page.locator('#director_fate_discard').click()
    page.wait_for_function('!SillyTavern.getContext().chatMetadata.director.fate?.held')
    close_panel()
    page.evaluate("async () => { (await import('/scripts/openai.js')).oai_settings.stream_openai = false; }")
    configure()
    page.evaluate("async () => { await SillyTavern.getContext().generate('normal'); }")
    assert held['event'] not in body()
    result['checks']['fateStopRetainsCardAndDiscardDisarmsOrdinarySend'] = True

    # A real two-member group: the private event appears only in the first
    # member's request; native regenerate must replay the same entire batch.
    second_avatar = page.evaluate("""async ({sample,suffix}) => {
        const c=SillyTavern.getContext();
        const post=async (url,data) => {
            const r=await fetch(url,{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify(data)});
            if(!r.ok) throw new Error('group fixture request failed');
            return r.json();
        };
        const form=new FormData();
        form.set('ch_name','Fate Synthetic Two');form.set('file_name','FateTwo-'+suffix);form.set('first_mes','Ready');
        const response=await fetch('/api/characters/create',{method:'POST',headers:{'X-CSRF-Token':c.getRequestHeaders()['X-CSRF-Token']},body:form});
        if(!response.ok) throw new Error('second Fate character failed');
        const avatar=await response.text();
        await c.getCharacters();
        if(!SillyTavern.getContext().characters.some(x=>x.avatar===avatar)) throw new Error('second member not loaded');
        const chatId='FateGroup-'+suffix;
        const group=await post('/api/groups/create',{name:'Fate Synthetic Group',members:[sample.avatar,avatar],
            chat_id:chatId,chats:[chatId],activation_strategy:1,generation_mode:0});
        await post('/api/chats/group/save',{id:chatId,chat:[
            {user_name:'Synthetic Tester',character_name:'Group',chat_metadata:{integrity:chatId}},
            {name:'Synthetic Tester',is_user:true,is_system:false,mes:'A new group scene.',extra:{},send_date:'2026-01-01T00:00:00.000Z'},
        ]});
        const g=await import('/scripts/group-chats.js');await g.getGroups();
        if(!await g.openGroupById(group.id)) throw new Error('Fate group did not open');
        return avatar;
    }""", {'sample':sample,'suffix':uuid.uuid4().hex[:10]})
    page.wait_for_function('!!SillyTavern.getContext().groupId && SillyTavern.getContext().chat.length === 1')
    held = draw('FATE_GROUP_PRIVATE: A courier arrives asking for the party.')
    apply(held)
    batch = requests()[-2:]
    assert [json.dumps(r).count(held['event']) for r in batch] == [1,0]
    names = page.evaluate('SillyTavern.getContext().chat.filter(m=>!m.is_user&&!m.is_system).map(m=>m.name)')
    assert set(names) == {'Director Synthetic','Fate Synthetic Two'}, names
    page.evaluate("async () => { await (await import('/scripts/group-chats.js')).regenerateGroup(); }")
    assert [json.dumps(r).count(held['event']) for r in requests()[-2:]] == [1,0]
    assert fate()['bound']['id'] == held['id']
    page.evaluate("async () => { const m=await import('/script.js');await m.deleteLastMessage();await m.deleteLastMessage();await m.Generate('normal'); }")
    assert all(held['event'] not in json.dumps(r) for r in requests()[-2:])
    result['checks']['fateRealGroupBatchReplayAndManualDeletionDoesNotRetrigger'] = True

    # Switch chats through the native API during the awaited generation-start
    # hook. The real quiet request finishes after ownership has changed.
    page.evaluate("""async avatar => {
        const c=SillyTavern.getContext();
        await c.selectCharacterById(c.characters.findIndex(x=>x.avatar===avatar));
    }""", sample['avatar'])
    kept = draw('FATE_STALE_KEEP: An unopened letter awaits its moment.')
    configure(json.dumps({'event':'FATE_STALE_DROP: This response belongs to the old chat.'}))
    page.evaluate("""avatar => {
        const c=SillyTavern.getContext();
        window.__fateOldMetadata=c.chatMetadata;
        const switchDuringDraw=async type => {
            if(type!=='quiet') return;
            c.eventSource.removeListener(c.eventTypes.GENERATION_STARTED,switchDuringDraw);
            const current=SillyTavern.getContext();
            await current.selectCharacterById(current.characters.findIndex(x=>x.avatar===avatar));
        };
        c.eventSource.on(c.eventTypes.GENERATION_STARTED,switchDuringDraw);
    }""", second_avatar)
    with page.expect_response(generation_response) as stale_reply:
        page.locator('#director_fate_draw').click()
    assert stale_reply.value.status == 200
    stale_reply.value.body()
    idle()
    page.evaluate('() => new Promise(requestAnimationFrame)')
    assert page.evaluate('SillyTavern.getContext().characters[SillyTavern.getContext().characterId].avatar') == second_avatar
    assert not fate().get('held')
    assert page.evaluate('window.__fateOldMetadata.director.fate.held.id') == kept['id']
    hidden('FATE_STALE_DROP')
    close_panel()
    page.evaluate("""async avatar => {
        const c=SillyTavern.getContext();
        await c.reloadCurrentChat();
        if(SillyTavern.getContext().chatMetadata.director?.fate?.held) throw new Error('stale draw saved into destination chat');
        const current=SillyTavern.getContext();
        await current.selectCharacterById(current.characters.findIndex(x=>x.avatar===avatar));
    }""", sample['avatar'])
    assert fate()['held']['id'] == kept['id']
    result['checks']['fateStaleDrawDoesNotReplaceOrSaveIntoAnotherChat'] = True
    print('Fate sealed draw, adoption, replay, failure/stop, real group and stale-chat checks passed', flush=True)
