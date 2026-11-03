"""FC1/FC2/FC3 regression checks against real, isolated browser generations.

The fake provider supplies deterministic synthetic replies only. Prompt token
counts come from the application's configured model tokenizer, never fake usage.
No product function is replaced and no fixture or evidence file is deleted.
"""
import json
import re
import time
import urllib.request
import uuid


def run_fate_review_checks(page, sample, fake_url, result, connect_api):
    """Run all three review regressions, retaining each independent failure."""
    connect_api(page)
    # wait_for_function polls a returned Promise as truthy rather than awaiting
    # its boolean result. Cache the live namespace in an awaited evaluate, then
    # use synchronous predicates for every generation-state wait below.
    page.evaluate("async () => { window.__fateReviewMain = await import('/script.js'); }")
    endpoint = fake_url.removesuffix('/v1')
    reply = 'Synthetic Fate review story reply.'
    failures = []
    review = result.setdefault('fateReview', {})
    checks = result.setdefault('checks', {})
    placeholder = re.compile(r'directorfate[0-9a-z]+', re.IGNORECASE)

    def configure(text=reply, **extra):
        data = {'reply': text, 'tokens': 8, 'rate': 10000, 'jitter': 0, **extra}
        request = urllib.request.Request(endpoint + '/__configure',
            data=json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=10) as response:
            assert response.status == 200

    def requests():
        with urllib.request.urlopen(endpoint + '/__requests', timeout=10) as response:
            return json.load(response)

    def serialized(value):
        return json.dumps(value, ensure_ascii=False)

    def idle():
        page.wait_for_function("""() => {
            const main = window.__fateReviewMain;
            return !main.isGenerating() && !main.isChatSaving;
        }""", timeout=30000)

    def fate():
        return page.evaluate('structuredClone(SillyTavern.getContext().chatMetadata.director?.fate ?? {})')

    def open_panel():
        if page.locator('#director_fate_panel').is_visible():
            return
        page.locator('#directorButton').click()
        page.locator('#director_fate_open').click()
        page.locator('#director_fate_panel').wait_for(state='visible')

    def close_panel():
        if page.locator('#director_fate_panel').is_visible():
            page.locator('dialog[open] .popup-button-cancel').click()
            page.locator('#director_fate_panel').wait_for(state='hidden')

    def draw(event):
        configure(json.dumps({'event': event}, ensure_ascii=False))
        open_panel()
        previous = (fate().get('held') or {}).get('id')
        page.locator('#director_fate_draw').click()
        page.wait_for_function("""id => {
            const held = SillyTavern.getContext().chatMetadata.director?.fate?.held;
            return held && held.id !== id;
        }""", arg=previous, timeout=30000)
        page.wait_for_function("!document.querySelector('#director_fate_draw').disabled")
        held = fate()['held']
        assert held['event'] == event
        assert event not in page.locator('body').evaluate('node => node.outerHTML'), 'Sealed event leaked to DOM'
        return held

    def start_apply():
        configure()
        assert page.locator('#send_textarea').input_value() == ''
        page.locator('#director_fate_apply').click()
        page.locator('#director_fate_panel').wait_for(state='hidden')

    def wait_apply_settled():
        idle()
        open_panel()
        page.wait_for_function("!document.querySelector('#director_fate_draw').disabled", timeout=30000)
        close_panel()

    def assert_consumed(held):
        state = fate()
        assert not state.get('held'), state
        assert (state.get('bound') or {}).get('id') == held['id'], state

    def select_sample():
        close_panel()
        idle()
        page.evaluate("""async sample => {
            const c = SillyTavern.getContext();
            await c.selectCharacterById(c.characters.findIndex(x => x.avatar === sample.avatar));
            if (SillyTavern.getContext().groupId) throw new Error('Single-chat selection did not leave group');
        }""", sample)

    def install_history(rows):
        select_sample()
        page.evaluate("""async rows => {
            const main = await import('/script.js');
            const c = SillyTavern.getContext();
            c.chat.splice(0, c.chat.length, ...structuredClone(rows));
            main.updateChatMetadata({integrity:c.chatMetadata.integrity}, true);
            if (await main.saveChat() === false) throw new Error('Review fixture save failed');
            await c.reloadCurrentChat();
        }""", rows)
        page.locator('#send_textarea').fill('')
        assert page.evaluate('SillyTavern.getContext().chat.length') == len(rows)
        return small_context()

    def small_context():
        # Chat-change subscribers may restore a preset during reload. Establish
        # the measured configuration after every reload, and inspect it again
        # after quiet drawing instead of trusting an earlier settings snapshot.
        settings = page.evaluate("""async () => {
            const openai = await import('/scripts/openai.js');
            const tokenizer = await import('/scripts/tokenizers.js');
            Object.assign(openai.oai_settings, {custom_model:'gpt-4o', openai_max_context:2048,
                openai_max_tokens:256, stream_openai:false, send_if_empty:''});
            return {context:openai.oai_settings.openai_max_context,
                reply:openai.oai_settings.openai_max_tokens, model:openai.getChatCompletionModel(),
                tokenizerModel:tokenizer.getTokenizerModel(), source:openai.oai_settings.chat_completion_source};
        }""")
        assert settings == {'context':2048, 'reply':256, 'model':'gpt-4o',
            'tokenizerModel':'gpt-4o', 'source':'custom'}, settings
        return settings

    def no_placeholders(batch):
        assert not placeholder.search(serialized(batch)), 'Opaque Fate placeholder reached provider'

    def tokenizer_measure(batch):
        return page.evaluate("""async messages => {
            const tokenizer = await import('/scripts/tokenizers.js');
            const openai = await import('/scripts/openai.js');
            const model = tokenizer.getTokenizerModel();
            const count = async value => {
                const response = await fetch('/api/tokenizers/openai/count?model=' + encodeURIComponent(model), {
                    method:'POST', headers:SillyTavern.getContext().getRequestHeaders(), body:JSON.stringify(value),
                });
                if (!response.ok) throw new Error('Configured model tokenization failed');
                const valueCount = (await response.json()).token_count;
                if (!Number.isFinite(valueCount)) throw new Error('Tokenizer returned no count');
                return valueCount;
            };
            const historyMessages = messages.filter(message => /FC1_HISTORY_\\d{3}/.test(JSON.stringify(message)));
            return {
                configuredModel:openai.getChatCompletionModel(), tokenizerModel:model,
                configuredContext:openai.oai_settings.openai_max_context,
                configuredReply:openai.oai_settings.openai_max_tokens,
                fullMessagesTokens:await count(messages),
                applicationFullMessagesTokens:await tokenizer.countTokensOpenAIAsync(messages, true),
                historyMessagesTokens:await count(historyMessages),
                requestMessageCount:messages.length,
            };
        }""", batch)

    def history_ids(request):
        return re.findall(r'FC1_HISTORY_\d{3}', serialized(request['messages']))

    def fc1():
        # A recognized model makes the provider model and local tokenizer agree.
        # Only this isolated lab's runtime settings are changed.
        rows = [dict(name='Synthetic Tester' if i % 2 == 0 else 'Director Synthetic',
            is_user=i % 2 == 0, is_system=False, send_date=f'2026-01-01T00:{i // 60:02}:{i % 60:02}.000Z',
            mes=f'FC1_HISTORY_{i:03} ' + 'The synthetic courier records a calm journey beside the river. ' * 5,
            extra={}) for i in range(100)]
        settings = install_history(rows)
        review['FC1'] = {'baselineConfiguration':settings}
        configure()
        before = len(requests())
        page.evaluate("async () => { await SillyTavern.getContext().generate('normal'); }")
        idle()
        baseline_batch = requests()[before:]
        assert len(baseline_batch) == 1, baseline_batch
        baseline = baseline_batch[0]
        baseline_measure = tokenizer_measure(baseline['messages'])
        review['FC1']['withoutCard'] = baseline_measure
        print('FC1 saturated baseline measured', flush=True)

        # Reinstall exactly the same chat rows; drawing does not create history.
        reloaded_settings = install_history(rows)
        seed = 'FC1_EVENT_LITERAL {{char}}: 晨雾散开后，一位陌生旅人带着封存的地图来到河岸，邀请众人查明远处钟声的来源。'
        event = (seed + '古老石桥边的灯火忽然亮起，水面浮出通往旧城的标记，信使耐心等待众人的决定。' * 20)[:400]
        assert len(event) == 400 and '{{char}}' in event
        held = draw(event)
        assert page.evaluate('SillyTavern.getContext().chat.length') == len(rows)
        after_draw_settings = small_context()
        adopted_before = len(requests())
        start_apply()
        wait_apply_settled()
        adopted_batch = requests()[adopted_before:]
        assert len(adopted_batch) == 1, adopted_batch
        adopted = adopted_batch[0]
        adopted_measure = tokenizer_measure(adopted['messages'])
        without_event = json.loads(serialized(adopted['messages']).replace(event, ''))
        without_event_measure = tokenizer_measure(without_event)
        before_ids, after_ids = history_ids(baseline), history_ids(adopted)
        removed_ids = [item for item in before_ids if item not in after_ids]
        budget = settings['context'] - settings['reply']
        event_tokens = adopted_measure['fullMessagesTokens'] - without_event_measure['fullMessagesTokens']
        trimmed_tokens = baseline_measure['historyMessagesTokens'] - adopted_measure['historyMessagesTokens']
        diagnostics = review['FC1'] = {
            'settings': settings, 'promptBudget': budget, 'eventCodePoints': len(event),
            'configurationAfterReload':reloaded_settings, 'configurationAfterDraw':after_draw_settings,
            'withoutCard': baseline_measure, 'withCard': adopted_measure,
            'historyWithoutCard': len(before_ids), 'historyWithCard': len(after_ids),
            'removedHistoryIds': removed_ids, 'removedHistoryTokens': trimmed_tokens,
            'eventTextTokenIncrement': event_tokens,
            'baselineUnusedTokens': budget - baseline_measure['fullMessagesTokens'],
            'literalMacroPreserved': serialized(adopted).count(event) == 1 and '{{char}}' in serialized(adopted),
        }
        no_placeholders(baseline_batch + adopted_batch)
        assert baseline['model'] == adopted['model'] == adopted_measure['configuredModel'] == adopted_measure['tokenizerModel'], diagnostics
        assert all(measure['configuredContext'] == 2048 and measure['configuredReply'] == 256
            and measure['configuredModel'] == measure['tokenizerModel'] == 'gpt-4o'
            for measure in [baseline_measure, adopted_measure]), diagnostics
        assert baseline.get('max_tokens') == adopted.get('max_tokens') == 256, diagnostics
        assert serialized(baseline).count(event) == 0
        assert serialized(adopted).count(event) == 1, diagnostics
        assert 0 < len(before_ids) < len(rows), 'FC1 history failed to saturate context'
        assert len(set(before_ids)) == len(before_ids) and len(set(after_ids)) == len(after_ids)
        assert set(after_ids) < set(before_ids), diagnostics
        assert len(after_ids) < len(before_ids) and removed_ids, diagnostics
        assert baseline_measure['fullMessagesTokens'] <= budget == 1792, diagnostics
        assert adopted_measure['fullMessagesTokens'] <= budget, diagnostics
        # At least the event's actual tokenizer cost beyond the available slack
        # must have been paid for by removing genuine history, not truncating it.
        assert trimmed_tokens >= event_tokens - diagnostics['baselineUnusedTokens'], diagnostics
        for message_id in after_ids:
            source = next(row['mes'] for row in rows if row['mes'].startswith(message_id))
            assert source in serialized(adopted['messages']), 'Retained history was partially truncated'
        assert_consumed(held)
        checks['fateReviewFC1FullTokenizerBudgetAndRealHistoryTrim'] = True

    def fc2():
        install_history([
            dict(name='Synthetic Tester', is_user=True, is_system=False, mes='FC2 synthetic starting scene.', extra={}),
            dict(name='Director Synthetic', is_user=False, is_system=False, mes='FC2 ready.', extra={}),
        ])
        event = 'FC2_PRIVATE_EVENT {{char}}: A silent courier leaves a sealed invitation beside the window.'
        held = draw(event)
        page.evaluate("""() => {
            const {eventSource, eventTypes} = SillyTavern.getContext();
            const state = window.__fateReviewOverlap = {
                stage:'normal', paused:false, afterData:[], completed:[], gate:null,
            };
            state.onReady = data => {
                if (data.dryRun || state.stage !== 'normal' || state.paused) return;
                state.paused = true;
                state.normalBeforeData = structuredClone(data.chat);
                state.afterDataAtPause = state.afterData.length;
                return new Promise(resolve => { state.gate = resolve; });
            };
            state.onAfter = (data, dryRun) => {
                if (!dryRun) state.afterData.push({stage:state.stage, data:structuredClone(data)});
            };
            state.onCompleted = data => state.completed.push(data.type);
            eventSource.on(eventTypes.CHAT_COMPLETION_PROMPT_READY, state.onReady);
            eventSource.on(eventTypes.GENERATE_AFTER_DATA, state.onAfter);
            eventSource.on(eventTypes.GENERATION_COMPLETED, state.onCompleted);
        }""")
        before = len(requests())
        try:
            start_apply()
            page.wait_for_function('window.__fateReviewOverlap.paused && !!window.__fateReviewOverlap.gate')
            paused = page.evaluate("""() => {
                const s=window.__fateReviewOverlap;
                return {beforeData:s.normalBeforeData, afterDataAtPause:s.afterDataAtPause};
            }""")
            assert paused['afterDataAtPause'] == 0, paused
            assert placeholder.search(serialized(paused['beforeData'])), 'Pause did not follow Director Fate prepare'
            assert len(requests()) == before, 'Normal request reached provider before the lifecycle pause'
            quiet_probes = []
            for probe_index in range(2):
                probe = 'FC2_QUIET_PROBE_' + str(probe_index + 1)
                quiet = page.evaluate("""async ({probe,index}) => {
                    const state=window.__fateReviewOverlap;
                    state.stage='quiet-' + index;
                    const text=await SillyTavern.getContext().generateQuietPrompt({quietPrompt:probe});
                    state.quietFinished=(state.quietFinished ?? 0)+1;
                    return {probe,text,completed:state.completed.slice(),afterData:state.afterData.length,
                        normalStillPaused:!!state.gate};
                }""", {'probe':probe, 'index':probe_index + 1})
                quiet_probes.append(quiet)
                assert quiet['text'] == reply and quiet['completed'] == ['quiet'] * (probe_index + 1), quiet
                assert quiet['normalStillPaused'] and quiet['afterData'] == probe_index + 1, quiet
                quiet_batch = requests()[before:]
                assert len(quiet_batch) == probe_index + 1, quiet_batch
                assert probe in serialized(quiet_batch[-1]), quiet_batch[-1]
                assert event not in serialized(quiet_batch[-1])
                no_placeholders(quiet_batch)
            # Both real quiet requests completed while the same normal run
            # remained parked before GENERATE_AFTER_DATA. Release it only now.
            page.evaluate("""() => {
                const state=window.__fateReviewOverlap;
                state.stage='normal-resumed'; state.gate(); state.gate=null;
            }""")
            page.wait_for_function("window.__fateReviewOverlap.completed.includes('normal')", timeout=30000)
            wait_apply_settled()
            batch = requests()[before:]
            diagnostics = review['FC2'] = {
                'pauseEvent':'CHAT_COMPLETION_PROMPT_READY', 'afterDataAtPause':paused['afterDataAtPause'],
                'quietCompletedBeforeNormalRelease':True, 'quietProbeResults':quiet_probes,
                'requests':len(batch), 'eventOccurrences':[serialized(item).count(event) for item in batch],
                'placeholderOccurrences':[len(placeholder.findall(serialized(item))) for item in batch],
                'completed':page.evaluate('window.__fateReviewOverlap.completed'),
                'heldAfter':bool(fate().get('held')), 'boundId':(fate().get('bound') or {}).get('id'),
            }
            assert len(batch) == 3, diagnostics
            assert diagnostics['eventOccurrences'] == [0, 0, 1], diagnostics
            no_placeholders(requests())
            assert_consumed(held)
            checks['fateReviewFC2CompletedQuietInterleaveKeepsNormalOwner'] = True
        finally:
            page.evaluate("""() => {
                const s=window.__fateReviewOverlap;
                if (s.gate) { s.gate(); s.gate=null; }
                const {eventSource,eventTypes}=SillyTavern.getContext();
                eventSource.removeListener(eventTypes.CHAT_COMPLETION_PROMPT_READY,s.onReady);
                eventSource.removeListener(eventTypes.GENERATE_AFTER_DATA,s.onAfter);
                eventSource.removeListener(eventTypes.GENERATION_COMPLETED,s.onCompleted);
            }""")

    def generation_snapshot():
        return page.evaluate("""async () => {
            const main=await import('/script.js');
            const group=await import('/scripts/group-chats.js');
            const c=SillyTavern.getContext();
            const css=id=>{const n=document.getElementById(id);return n ? {
                display:getComputedStyle(n).display,visibility:getComputedStyle(n).visibility,
                visible:!!n.getClientRects().length}:null;};
            const snapshot={busy:main.is_send_press,groupBusy:group.is_group_generating,isGenerating:main.isGenerating(),
                isChatSaving:main.isChatSaving,swipeState:main.swipeState,
                bodyGenerating:document.body.dataset.generating ?? null,
                bodySwiping:document.body.dataset.swiping ?? null,
                onlineStatus:main.online_status,groupId:c.groupId ?? null,chatId:c.chatId,
                characterId:c.characterId ?? null,characterName:main.name2,
                chatLength:c.chat.length,draft:document.querySelector('#send_textarea').value,
                sendButton:css('send_but'),stopButton:css('mes_stop'),
                completed:window.__fateReviewUiSend?.completed ?? [],
                tail:c.chat.slice(-5).map(m=>({name:m.name,isUser:m.is_user,isSystem:m.is_system,
                    text:m.mes,generationId:m.extra?.gen_id ?? null,
                    genStarted:m.gen_started ?? null,genFinished:m.gen_finished ?? null}))};
            // Native generations hold Date objects while reloaded messages use
            // strings. Keep both diagnostics JSON-safe without discarding dates.
            return JSON.parse(JSON.stringify(snapshot));
        }""")

    def send_ui(text, expected_requests, diagnostics):
        # A unique reply and genuine completion events distinguish this send
        # from old history and from the asynchronous gap before Generate sets
        # its busy flag. Merely observing an old identical reply is insufficient.
        unique_reply = 'FC3_NEW_REPLY_' + uuid.uuid4().hex
        configure(unique_reply)
        before = len(requests())
        diagnostics.update({'userText':text, 'uniqueReply':unique_reply,
            'expectedRequests':expected_requests, 'requestsBefore':before,
            'beforeClick':generation_snapshot()})
        page.evaluate("""() => {
            const {eventSource,eventTypes}=SillyTavern.getContext();
            const s=window.__fateReviewUiSend={completed:[]};
            s.onCompleted=data=>s.completed.push(data.type);
            eventSource.on(eventTypes.GENERATION_COMPLETED,s.onCompleted);
        }""")
        try:
            page.locator('#send_textarea').fill(text)
            page.locator('#send_but').click()
            diagnostics['afterClick'] = generation_snapshot()
            deadline = time.monotonic() + 30
            while len(requests()) < before + expected_requests and time.monotonic() < deadline:
                page.wait_for_timeout(50)
            received = len(requests()) - before
            assert received == expected_requests, {'expectedRequests':expected_requests, 'receivedRequests':received,
                'generation':generation_snapshot()}
            page.wait_for_function("""({text,reply,expected}) => {
                const main=window.__fateReviewMain;
                const c=SillyTavern.getContext();
                const start=c.chat.findLastIndex(m=>m.is_user && m.mes===text);
                const generated=start<0 ? [] : c.chat.slice(start+1).filter(m=>!m.is_user&&!m.is_system);
                return window.__fateReviewUiSend.completed.filter(type=>type==='normal').length===expected
                    && generated.length===expected && generated.every(m=>m.mes===reply)
                    && !main.isGenerating() && !main.isChatSaving && !document.body.dataset.generating;
            }""", arg={'text':text, 'reply':unique_reply, 'expected':expected_requests}, timeout=30000)
            batch = requests()[before:]
            assert len(batch) == expected_requests, {'expected':expected_requests, 'actual':len(batch)}
            assert all(text in serialized(item) for item in batch), 'New provider request omitted the new user message'
            no_placeholders(batch)
            names = page.evaluate("""text => {
                const chat=SillyTavern.getContext().chat;
                const start=chat.findLastIndex(m=>m.is_user && m.mes===text);
                return chat.slice(start+1).filter(m=>!m.is_user&&!m.is_system).map(m=>m.name);
            }""", text)
            diagnostics.update({'requestCount':len(batch), 'actualParticipants':names})
            return diagnostics
        finally:
            diagnostics.update({'requestsAfter':len(requests()), 'afterSend':generation_snapshot()})
            page.evaluate("""() => {
                const {eventSource,eventTypes}=SillyTavern.getContext();
                eventSource.removeListener(eventTypes.GENERATION_COMPLETED,window.__fateReviewUiSend.onCompleted);
            }""")

    def fc3():
        select_sample()
        configure()
        fixture = page.evaluate("""async ({sample,suffix}) => {
            const c=SillyTavern.getContext();
            const post=async (url,data) => {
                const r=await fetch(url,{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify(data)});
                if(!r.ok) throw new Error(url+': '+r.status);
                return r.json();
            };
            const form=new FormData();
            form.set('ch_name','Fate Review Two');form.set('file_name','FateReviewTwo-'+suffix);form.set('first_mes','Ready');
            const r=await fetch('/api/characters/create',{method:'POST',headers:{'X-CSRF-Token':c.getRequestHeaders()['X-CSRF-Token']},body:form});
            if(!r.ok) throw new Error('FC3 second character creation failed');
            const avatar=await r.text();
            await c.getCharacters();
            const members=[sample.avatar,avatar];
            if(!members.every(a=>SillyTavern.getContext().characters.some(x=>x.avatar===a))) throw new Error('FC3 actual members missing');
            const chatId='FateReviewGroup-'+suffix;
            const group=await post('/api/groups/create',{name:'Fate Review Group',members,
                chat_id:chatId,chats:[chatId],activation_strategy:1,generation_mode:0});
            await post('/api/chats/group/save',{id:chatId,chat:[
                {user_name:'Synthetic Tester',character_name:'Group',chat_metadata:{integrity:chatId}},
                {name:'Synthetic Tester',is_user:true,is_system:false,mes:'FC3 group starting scene.',extra:{}},
            ]});
            const g=await import('/scripts/group-chats.js');await g.getGroups();
            if(!await g.openGroupById(group.id)) throw new Error('FC3 native group open failed');
            return {groupId:group.id,chatId,secondAvatar:avatar,members};
        }""", {'sample': sample, 'suffix': uuid.uuid4().hex[:10]})
        page.wait_for_function('!!SillyTavern.getContext().groupId && SillyTavern.getContext().chat.length === 1')
        held = draw('FC3_GROUP_PRIVATE: A courier quietly approaches both members of the party.')
        before = len(requests())
        start_apply()
        wait_apply_settled()
        batch = requests()[before:]
        assert len(batch) == 2
        assert [serialized(item).count(held['event']) for item in batch] == [1, 0]
        assert_consumed(held)
        names = page.evaluate('SillyTavern.getContext().chat.filter(m=>!m.is_user&&!m.is_system).map(m=>m.name)')
        expected_names = ['Director Synthetic', 'Fate Review Two']
        assert names == expected_names, {'actualParticipants':names}
        diagnostics = review['FC3'] = {'groupFixture':fixture, 'initialActualParticipants':names, 'interleavings':{}}
        local_failures = []
        for mode in ['chat-switch', 'metadata-replacement']:
            scenario = diagnostics['interleavings'][mode] = {'stage':'before-open'}
            try:
                idle()
                if page.evaluate('SillyTavern.getContext().groupId') != fixture['groupId']:
                    scenario['beforeOpenGroup'] = generation_snapshot()
                    opened = page.evaluate("""async id => (await import('/scripts/group-chats.js')).openGroupById(id)""", fixture['groupId'])
                    scenario.update({'openGroupReturned':opened, 'afterOpenGroup':generation_snapshot()})
                    assert opened is True, {'nativeGroupReopenFailed':scenario}
                scenario['stage'] = 'regenerate'
                before = len(requests())
                before_regenerate = generation_snapshot()
                observation = page.evaluate("""async ({mode,fixture}) => {
                    const main=await import('/script.js');
                    const group=await import('/scripts/group-chats.js');
                    const c=SillyTavern.getContext();
                    const owner=c.chatMetadata;
                    const out={mode,listenerRan:false,requestsExpectedDuringAbort:0,
                        sourceGroup:c.groupId,sourceChat:c.chatId,sourceLength:c.chat.length};
                    const listener=async operation => {
                        out.listenerRan=true;
                        out.markerMatches=operation.groupId===fixture.groupId && operation.chatId===fixture.chatId;
                        if(mode==='chat-switch') {
                            // The destination is loaded through the real selection API.
                            // Reassert the controlled UI lock after navigation unlocks it.
                            await c.selectCharacterById(c.characters.findIndex(x=>x.avatar===fixture.secondAvatar));
                        } else {
                            main.updateChatMetadata({...c.chatMetadata,fc3Replacement:true},true);
                        }
                        const current=SillyTavern.getContext();
                        out.metadataChanged=current.chatMetadata!==owner;
                        out.destinationGroup=current.groupId ?? null;
                        out.destinationChat=current.chatId;
                        main.setSendButtonState(true);
                        out.busyInsideListener=main.is_send_press;
                    };
                    c.eventSource.on(c.eventTypes.GROUP_REGENERATION_STARTED,listener);
                    try { await group.regenerateGroup(); }
                    finally { c.eventSource.removeListener(c.eventTypes.GROUP_REGENERATION_STARTED,listener); }
                    out.busyAfter=main.is_send_press;
                    out.groupBusyAfter=group.is_group_generating;
                    out.destinationLength=SillyTavern.getContext().chat.length;
                    return out;
                }""", {'mode':mode, 'fixture':fixture})
                scenario.update(observation)
                observation = scenario
                observation.update({'requestsBeforeRegenerate':before, 'requestsAfterRegenerate':len(requests()),
                    'beforeRegenerate':before_regenerate, 'afterRegenerate':generation_snapshot()})
                assert observation['listenerRan'] and observation['markerMatches'], observation
                assert observation['metadataChanged'] and observation['busyInsideListener'], observation
                assert len(requests()) == before, 'Owner-aborted regenerate unexpectedly contacted provider'
                if mode == 'chat-switch':
                    assert not observation['destinationGroup'], observation
                else:
                    assert observation['destinationGroup'] == fixture['groupId'], observation
                    assert observation['destinationLength'] == observation['sourceLength'], observation
                assert observation['busyAfter'] is False and observation['groupBusyAfter'] is False, observation
                observation['stage'] = 'subsequent-send'
                observation['subsequentSend'] = {}
                sent = send_ui('FC3_AFTER_' + mode, 1 if mode == 'chat-switch' else 2, observation['subsequentSend'])
                assert sent['actualParticipants'] == (['Fate Review Two'] if mode == 'chat-switch' else expected_names), observation
                observation['stage'] = 'complete'
                checks['fateReviewFC3UnlockAfter' + ('ChatSwitch' if mode == 'chat-switch' else 'MetadataReplacement')] = True
            except Exception as error:
                frame = error.__traceback__
                while frame and frame.tb_next:
                    frame = frame.tb_next
                message = type(error).__name__ + ' at case line ' + str(frame.tb_lineno if frame else '?') + ': ' + str(error)
                local_failures.append(mode + ': ' + message)
                scenario.update({'failure':message, 'failureSnapshot':generation_snapshot()})
                # Cleanup permits the second independently failing scenario to run.
                # The failed unlock assertion above remains a recorded test failure.
                page.evaluate("async () => (await import('/script.js')).setSendButtonState(false)")
        assert not local_failures, '\n'.join(local_failures)

    for name, case in [('FC1', fc1), ('FC2', fc2), ('FC3', fc3)]:
        print('Fate review ' + name + ' starting', flush=True)
        try:
            case()
            review.setdefault(name, {})['passed'] = True
            print('Fate review ' + name + ' passed', flush=True)
        except Exception as error:
            review.setdefault(name, {})['passed'] = False
            review[name]['failure'] = str(error)
            failures.append(name + ': ' + str(error))
            print('Fate review ' + name + ' FAILED: ' + str(error), flush=True)
    review['failures'] = failures
    assert not failures, 'Fate review regressions failed:\n' + '\n'.join(failures)
