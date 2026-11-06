"""Hidden relationship memory through native UI, saves, and synthetic provider I/O.

These fixtures describe explicit synthetic evidence. They do not establish real
model extraction quality, use a real account, or replace product functions.
"""
import gzip
import json
import re
import time
import urllib.request
import uuid
from pathlib import Path

AFFINITY_CASE_KEYS = ('cadence', 'persistence', 'overlap', 'budget', 'reloadRace',
    'majorAndMobile', 'sidecarBudget', 'cancellation', 'group')


def run_affinity_checks(page, sample, fake_url, result, connect_api, swipe_message, open_manager, selected_cases=None):
    if selected_cases is not None and (not selected_cases or len(set(selected_cases)) != len(selected_cases)
            or any(key not in AFFINITY_CASE_KEYS for key in selected_cases)):
        raise ValueError('Invalid affinity browser case selection')
    selection = [key for key in AFFINITY_CASE_KEYS if selected_cases is None or key in selected_cases]
    result['selectedCases'] = selection
    connect_api(page)
    endpoint = fake_url.removesuffix('/v1')
    audit = result.setdefault('affinityReview', {})
    failures = []
    state = {'serial': 0, 'mode': 'fact', 'hold': False, 'holdStory': False, 'failStory': False,
        'held': [], 'heldStory': [], 'calls': [], 'saves': [], 'fixtureErrors': [], 'verify': True}
    literal = 'AFF_MEMORY_PRIVATE {{char}}: The character remembers the river promise.'
    marker = re.compile(r'AFFINITY_LITERAL_|directoraffinity', re.IGNORECASE)

    def configure(text, **extra):
        payload = {'reply': text, 'tokens': 8, 'rate': 10000, 'jitter': 0, **extra}
        req = urllib.request.Request(endpoint + '/__configure', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as response:
            assert response.status == 200

    def requests():
        with urllib.request.urlopen(endpoint + '/__requests', timeout=10) as response:
            return json.load(response)

    def serialized(value):
        return json.dumps(value, ensure_ascii=False)

    def fixture_event(ref, fact=literal, impact='minor'):
        return {'owner': ref['owner'], 'kind': 'fact', 'fact': fact, 'actor': 'character', 'recipient': 'user',
            'status': 'observed', 'valence': 'none', 'impact': impact, 'confidence': 'high',
            'attitudeExplicit': False, 'outcomeKnown': True, 'knownToCharacter': 'yes',
            'source': {'slot': ref['slot'], 'quote': ref['text'].split('\n[…]')[0][:150]}}

    def generation_route(route):
        payload = route.request.post_data_json
        text = '\n'.join(str(message.get('content', '')) for message in payload.get('messages', []))
        schema = payload.get('json_schema') or {}
        kind = schema.get('name', '')
        record = {'kind': kind or ('externalQuiet' if 'AFF_EXTERNAL_QUIET' in text else 'story'), 'payload': payload}
        state['calls'].append(record)
        if kind == 'relationship_evidence':
            record['groupStages'] = page.evaluate('window.__affinityBrowser.groups.slice()')
            if state['hold']:
                state['held'].append(route)
                return
            try:
                refs = json.loads(text.rsplit('消息：', 1)[1])
                characters = [ref for ref in refs if ref['owner'] != 'player']
                if state['mode'] == 'budget':
                    events = [fixture_event(ref, (f'AFF_BUDGET_{i} {{' + '{char}} ' + '角色记住了河岸旅程中已经发生的约定与同行经历。' * 12)[:160])
                        for i, ref in enumerate(characters[-5:])]
                elif state['mode'] == 'empty':
                    events = []
                elif state['mode'] == 'group':
                    owners = {ref['owner']: ref for ref in characters}
                    events = [fixture_event(ref, 'AFF_GROUP_PRIVATE_' + owner + ': remembers the shared river journey.')
                        for owner, ref in owners.items()]
                elif state['mode'] == 'major':
                    event = fixture_event(characters[-1], 'The character explicitly expresses new trust.', 'major')
                    event.update({'kind': 'attitude', 'valence': 'positive', 'attitudeExplicit': True})
                    events = [event]
                else:
                    events = [fixture_event(characters[-1])] if characters else []
                record['eventCount'] = len(events)
                configure(json.dumps({'events': events}, ensure_ascii=False))
            except Exception as error:
                state['fixtureErrors'].append(type(error).__name__ + ': ' + str(error))
                configure('{"events":[]}')
        elif kind == 'relationship_verification':
            try:
                candidates = json.loads(text[text.index('{"candidates"'):])['candidates']
                configure(json.dumps({'confirmed': [item['key'] for item in candidates] if state['verify'] else []}))
            except Exception as error:
                state['fixtureErrors'].append('Verification fixture: ' + str(error))
                configure('{"confirmed":[]}')
        elif 'AFF_EXTERNAL_QUIET' in text:
            configure('AFF_EXTERNAL_QUIET_DONE')
        else:
            if state['holdStory']:
                state['heldStory'].append(route)
                return
            state['serial'] += 1
            prose = 'I now trust you deeply because you protected our companions.' if state['mode'] == 'major' else 'I remember the river promise and respect your boundary.'
            configure(f'AFF_REPLY_{state["serial"]:03}: {prose}', nextStatus=500 if state['failStory'] else 0)
            state['failStory'] = False
        route.continue_()

    def observe_save(request):
        if request.method != 'POST' or not request.url.endswith(('/api/chats/save', '/api/chats/group/save')):
            return
        raw = request.post_data_buffer or b''
        if raw.startswith(b'\x1f\x8b'):
            raw = gzip.decompress(raw)
        try:
            payload = json.loads(raw)
            state['saves'].append({'fileName': payload.get('file_name', payload.get('id')), 'messages': len(payload.get('chat', []))})
        except (ValueError, UnicodeDecodeError):
            state['fixtureErrors'].append('Could not decode a native save observation')

    page.route('**/api/backends/chat-completions/generate', generation_route)
    page.on('request', observe_save)
    page.evaluate("""async () => {
        window.__affinityMain=await import('/script.js');
        const c=SillyTavern.getContext();
        const observation=window.__affinityBrowser={completed:[],groups:[],reloadStarted:false};
        c.eventSource.on(c.eventTypes.GENERATION_COMPLETED,payload=>{
            observation.completed.push({type:payload.type,chatId:payload.chatId});
            if(observation.armReload && payload.type==='normal') {
                observation.armReload=false; observation.reloadStarted=true;
                const current=SillyTavern.getContext();
                observation.oldMetadata=current.chatMetadata;
                observation.reload=current.reloadCurrentChat().then(()=>{observation.reloadFinished=true;});
            }
        });
        c.eventSource.on(c.eventTypes.GROUP_WRAPPER_STARTED,()=>observation.groups.push('start'));
        c.eventSource.on(c.eventTypes.GROUP_WRAPPER_FINISHED,()=>observation.groups.push('finish'));
    }""")

    def ledger():
        return page.evaluate('structuredClone(SillyTavern.getContext().chatMetadata.director?.__affinity ?? {})')

    def idle():
        page.wait_for_function('!window.__affinityMain.isGenerating() && !window.__affinityMain.isChatSaving', timeout=30000)

    def close_settings():
        page.locator('#extensions-settings-button .drawer-toggle').click()

    def settings(enabled=True, interval=5):
        open_manager(page)
        page.locator('#director_affinity_enabled').set_checked(enabled)
        page.locator('#director_affinity_interval').select_option(str(interval))
        close_settings()

    def reset(rows=None, interval=5):
        idle()
        settings(False, interval)
        page.evaluate("""async()=>{
            const o=await import('/scripts/openai.js');
            Object.assign(o.oai_settings,{custom_model:'gpt-4o',openai_max_context:8192,openai_max_tokens:256,stream_openai:false});
        }""")
        page.evaluate("""async rows=>{
            const c=SillyTavern.getContext();
            const group=await import('/scripts/group-chats.js');
            if(c.groupId) throw new Error('Single-chat fixture reset still in group');
            c.chat.splice(0,c.chat.length,...rows);
            window.__affinityMain.updateChatMetadata({integrity:c.chatMetadata.integrity},true);
            if(await c.saveChat()===false) throw new Error('Synthetic history save failed');
            await c.reloadCurrentChat();
        }""", rows or [dict(name='Synthetic Tester', is_user=True, is_system=False, mes='A synthetic river scene.', extra={}),
            dict(name='Director Synthetic', is_user=False, is_system=False, mes='Ready.', extra={})])
        settings(True, interval)
        page.locator('#send_textarea').fill('')
        state['mode'] = 'fact'

    def send(speakers=1, text=None):
        idle()
        text = text or 'AFF_USER_' + uuid.uuid4().hex
        before = page.evaluate('window.__affinityBrowser.completed.length')
        page.locator('#send_textarea').fill(text)
        page.locator('#send_but').click()
        page.wait_for_function("""({before,text,speakers})=>{
            const c=SillyTavern.getContext();
            const index=c.chat.findLastIndex(m=>m.is_user && m.mes===text);
            const replies=c.chat.slice(index+1).filter(m=>m.is_user===false&&!m.is_system);
            return index>=0 && replies.length===speakers && replies.every(m=>m.mes.startsWith('AFF_REPLY_'))
                && window.__affinityBrowser.completed.slice(before).filter(x=>x.type==='normal').length===speakers
                && !window.__affinityMain.isGenerating() && !window.__affinityMain.isChatSaving;
        }""", arg={'before': before, 'text': text, 'speakers': speakers}, timeout=30000)
        return text

    def evaluated(receipt, events=1):
        page.wait_for_function("""({receipt,events})=>{
            const value=SillyTavern.getContext().chatMetadata.director?.__affinity;
            return value?.issued===receipt && value.cursor===receipt && value.events.length>=events
                && !window.__affinityMain.isChatSaving;
        }""", arg={'receipt': receipt, 'events': events}, timeout=30000)

    def read_disk():
        return page.evaluate("""async () => {
            const c=SillyTavern.getContext();
            const character=c.characters[c.characterId];
            const url=c.groupId ? '/api/chats/group/get' : '/api/chats/get';
            const data=c.groupId ? {id:c.chatId} : {avatar_url:character.avatar,ch_name:character.name,file_name:character.chat};
            const response=await fetch(url,{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify(data)});
            if(!response.ok) throw new Error('Synthetic disk read failed '+response.status);
            return response.json();
        }""")

    def wait_disk(receipt, events=1):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            data = read_disk()
            value = (data[0].get('chat_metadata', {}).get('director', {}).get('__affinity') or {}) if data else {}
            if value.get('issued') == receipt and value.get('cursor') == receipt and len(value.get('events', [])) >= events:
                return data
            page.wait_for_timeout(50)
        raise AssertionError({'diskDidNotPersist': receipt, 'ledger': value})

    def call_count(kind):
        return sum(call['kind'] == kind for call in state['calls'])

    def no_frames(batch):
        assert not marker.search(serialized(batch)), 'Affinity assembly marker reached a model request'

    def cadence():
        open_manager(page)
        defaults = page.evaluate("""()=>({enabled:document.querySelector('#director_affinity_enabled').checked,
            interval:document.querySelector('#director_affinity_interval').value})""")
        close_settings()
        assert defaults == {'enabled': True, 'interval': '10'}, defaults
        reset(interval=10)
        before = call_count('relationship_evidence')
        for i in range(9):
            send()
            assert ledger()['issued'] == i + 1
        assert call_count('relationship_evidence') == before
        send()
        evaluated(10)
        wait_disk(10)
        assert call_count('relationship_evidence') == before + 1
        replay = []
        for kind in ['swipe', 'regenerate', 'continue']:
            if kind == 'swipe':
                slot = page.evaluate('SillyTavern.getContext().chat.length-1')
                alternatives = page.evaluate('SillyTavern.getContext().chat.at(-1).swipes.length')
                swipe_message(page, slot, alternatives)
            else:
                page.evaluate('async type=>{await SillyTavern.getContext().generate(type);}', kind)
            idle()
            assert ledger()['issued'] == 10, {'type': kind, 'issued': ledger()['issued']}
            replay.append(kind)
        assert call_count('relationship_evidence') == before + 1
        audit['cadence'] = {'defaults': defaults, 'tenthReplyEvaluations': 1, 'replayIssued': 10, 'nativeReplays': replay}
        result['checks']['affinityNativeTenthCompletionAndReplayIdempotence'] = True
        reset(interval=5)
        before = call_count('relationship_evidence')
        for _ in range(4):
            send()
        assert call_count('relationship_evidence') == before
        send()
        evaluated(5)
        wait_disk(5)
        assert call_count('relationship_evidence') == before + 1
        result['checks']['affinityNativeFifthCompletionAndAutomaticPersistence'] = True

    def persistence_and_edit():
        reset()
        for _ in range(5):
            send()
        evaluated(5)
        wait_disk(5)
        before = ledger()
        source = before['events'][-1]['source']['slot']
        page.evaluate('async()=>{await SillyTavern.getContext().reloadCurrentChat();}')
        assert ledger()['issued'] == before['issued'] and ledger()['events'] == before['events']
        start = len(requests())
        send()
        batch = requests()[start:]
        assert len(batch) == 1 and serialized(batch).count(literal) == 1
        no_frames(batch)
        assert literal not in page.locator('body').inner_text()
        index = page.evaluate('slot=>SillyTavern.getContext().chat.findIndex(m=>m.extra?.__affinity?.id===slot)', source)
        assert index >= 0
        row = page.locator(f'#chat .mes[mesid="{index}"]')
        row.locator('.mes_edit').click()
        row.locator('.edit_textarea').fill('AFF_EDITED_SOURCE: The original evidence is no longer present.')
        row.locator('.mes_edit_done').click()
        page.wait_for_function('source=>!SillyTavern.getContext().chatMetadata.director.__affinity.events.some(e=>e.source.slot===source)', arg=source)
        start = len(requests())
        send()
        assert literal not in serialized(requests()[start:])
        audit['persistence'] = {'issuedAfterReload': before['issued'], 'literalInRequestExactlyOnce': True,
            'sourceEditedThroughUI': True, 'withdrawnBeforeNextRequest': True}
        result['checks']['affinityReloadLiteralMemoryAndNativeEditWithdrawal'] = True

    def major_and_ui():
        reset()
        state['mode'] = 'major'
        state['verify'] = True
        before = len(state['calls'])
        completed = page.evaluate('window.__affinityBrowser.completed.length')
        for _ in range(5):
            send()
        evaluated(5)
        wait_disk(5)
        calls = state['calls'][before:]
        kinds = [call['kind'] for call in calls]
        score = page.evaluate("""async()=>{
            const module=await import('/scripts/extensions/director/affinity-state.js');
            const c=SillyTavern.getContext();return module.affinityScores(c.chatMetadata.director.__affinity)[c.characters[c.characterId].avatar];
        }""")
        assert kinds.count('relationship_evidence') == kinds.count('relationship_verification') == 1, kinds
        assert score == 5 and ledger()['events'][0]['verified'] is True, {'score': score, 'events': ledger()['events']}
        assert page.evaluate('offset=>window.__affinityBrowser.completed.slice(offset).map(item=>item.type)', completed) == ['normal'] * 5
        page.set_viewport_size({'width': 390, 'height': 844})
        open_manager(page)
        enabled = page.locator('#director_affinity_enabled')
        interval = page.locator('#director_affinity_interval')
        assert enabled.is_visible() and interval.is_visible()
        bounds = interval.evaluate("""node=>{
            const box=node.getBoundingClientRect();const holder=node.closest('.inline-drawer-content');
            return {left:box.left,right:box.right,width:box.width,viewport:innerWidth,overflow:holder.scrollWidth-holder.clientWidth};
        }""")
        assert bounds['width'] > 0 and bounds['left'] >= 0 and bounds['right'] <= 391 and bounds['overflow'] <= 1, bounds
        text = page.locator('#director_settings').inner_text()
        assert not re.search(r'分数|关系等级|好感度[：:]|score|level', text, re.IGNORECASE), text
        enabled.uncheck()
        interval.select_option('10')
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            stored = page.evaluate("""async()=>{
                const r=await fetch('/api/settings/get',{method:'POST',headers:SillyTavern.getContext().getRequestHeaders(),body:'{}'});
                if(!r.ok)throw new Error('Synthetic settings read failed');
                return JSON.parse((await r.json()).settings).extension_settings.director.affinity;
            }""")
            if stored == {'enabled': False, 'interval': 10}:
                break
            page.wait_for_timeout(50)
        assert stored == {'enabled': False, 'interval': 10}, stored
        close_settings()
        page.evaluate('async()=>{await SillyTavern.getContext().reloadCurrentChat();}')
        open_manager(page)
        assert not enabled.is_checked() and interval.input_value() == '10'
        enabled.check()
        evidence = Path(__file__).resolve().parents[1] / '.evidence' / 'affinity-review'
        evidence.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(evidence / 'affinity-mobile.png'))
        close_settings()
        page.set_viewport_size({'width': 1440, 'height': 1000})
        audit['majorAndMobile'] = {'majorScore': score, 'evaluatorRequests': 1, 'independentVerificationRequests': 1,
            'extraGenerationLifecycleEvents': 0, 'viewport': {'width': 390, 'height': 844}, 'controlBounds': bounds,
            'settingsPersisted': True, 'scoreControlsVisible': False, 'physicalPhoneTested': False,
            'screenshot': 'affinity-mobile.png'}
        result['checks']['affinityMajorUsesIndependentNativeProviderRequest'] = True
        result['checks']['affinity390pxControlsPersistAndExposeNoScore'] = True

    def cancellation_and_failures():
        reset()
        state['hold'] = True
        held_before = len(state['held'])
        try:
            for _ in range(5):
                send()
            deadline = time.monotonic() + 15
            while len(state['held']) == held_before and time.monotonic() < deadline:
                page.wait_for_timeout(20)
            assert len(state['held']) == held_before + 1, 'Fifth reply did not start the held sidecar'
            old = state['held'][-1]
            assert old.request.failure is None
            send()
            deadline = time.monotonic() + 10
            while old.request.failure is None and time.monotonic() < deadline:
                page.wait_for_timeout(20)
            assert old.request.failure and 'ABORTED' in old.request.failure, old.request.failure
            assert ledger()['issued'] == 6 and not ledger()['events']
            audit['cancellation'] = {'heldSidecarFailure': old.request.failure, 'mainCompletedWhileSidecarPending': True,
                'issuedAfterNewMain': ledger()['issued'], 'staleEvents': len(ledger()['events'])}
            result['checks']['affinityNewMainCancelsOnlySidecarAndStillCompletes'] = True
        finally:
            state['hold'] = False
            for route in state['held'][held_before:]:
                try:
                    route.abort('aborted')
                except Exception:
                    pass
        reset()
        state['failStory'] = True

        def start_expected_rejection():
            # Generate deliberately rejects failed/stopped requests. Observe its
            # real public promise here rather than letting a DOM async handler
            # leave an expected rejection unhandled. No pageerror is filtered.
            page.evaluate("""()=>{
                const s=window.__affinityBrowser;
                s.expectedFailure=null;s.expectedFailureFinished=false;
                s.expectedFailurePromise=SillyTavern.getContext().generate('normal').then(
                    ()=>{s.expectedFailure={rejected:false};},
                    error=>{s.expectedFailure={rejected:true,message:String(error?.message??error)};}
                ).finally(()=>{s.expectedFailureFinished=true;});
            }""")

        with page.expect_response(lambda response: response.url.endswith('/api/backends/chat-completions/generate')) as response:
            page.locator('#send_textarea').fill('AFF_FAILED_STORY')
            start_expected_rejection()
        assert response.value.json().get('error')
        page.wait_for_function('window.__affinityBrowser.expectedFailureFinished')
        rejected_error = page.evaluate('window.__affinityBrowser.expectedFailure')
        assert rejected_error['rejected'] is True and rejected_error['message'], rejected_error
        idle()
        assert ledger()['issued'] == 0
        state['holdStory'] = True
        held_before = len(state['heldStory'])
        try:
            page.locator('#send_textarea').fill('AFF_STOPPED_STORY')
            start_expected_rejection()
            deadline = time.monotonic() + 15
            while len(state['heldStory']) == held_before and time.monotonic() < deadline:
                page.wait_for_timeout(20)
            assert len(state['heldStory']) == held_before + 1
            page.locator('#mes_stop').click()
            page.wait_for_function('window.__affinityBrowser.expectedFailureFinished')
            rejected_stop = page.evaluate('window.__affinityBrowser.expectedFailure')
            assert rejected_stop['rejected'] is True and rejected_stop['message'], rejected_stop
            idle()
            assert ledger()['issued'] == 0
        finally:
            state['holdStory'] = False
            for route in state['heldStory'][held_before:]:
                try:
                    route.abort('aborted')
                except Exception:
                    pass
        send()
        assert ledger()['issued'] == 1
        audit['cancellation']['expectedMainRejections'] = {'apiFailure': rejected_error, 'stop': rejected_stop}
        result['checks']['affinityNativeFailureAndStopDoNotCountAndRetryWorks'] = True

    def sidecar_budget():
        reset()
        state['mode'] = 'empty'
        page.evaluate("""async()=>{
            const o=await import('/scripts/openai.js');
            Object.assign(o.oai_settings,{custom_model:'gpt-4o',openai_max_context:4096,openai_max_tokens:64,stream_openai:false});
        }""")
        before = len(state['calls'])
        original_characters = 0
        for index in range(5):
            text = f'AFF_LONG_USER_{index}: ' + '旅人将河畔已经发生的旅程与清楚约定逐一告诉同行角色。' * 40
            original_characters += len(text)
            send(text=text)
        evaluated(5, 0)
        jobs = [call for call in state['calls'][before:] if call['kind'] == 'relationship_evidence']
        assert len(jobs) == 1
        payload = jobs[0]['payload']
        output = payload.get('max_tokens')
        assert isinstance(output, int) and 64 < output < 4096, output
        tokens = page.evaluate("""async messages=>{
            const r=await fetch('/api/tokenizers/openai/count?model=gpt-4o',{
                method:'POST',headers:SillyTavern.getContext().getRequestHeaders(),body:JSON.stringify(messages)});
            if(!r.ok)throw new Error('Sidecar configured tokenizer failed');return (await r.json()).token_count;
        }""", payload['messages'])
        shown = json.loads('\n'.join(str(m.get('content', '')) for m in payload['messages']).rsplit('消息：', 1)[1])
        shown_characters = sum(len(ref['text']) for ref in shown if ref['owner'] == 'player')
        assert shown_characters < original_characters, {'originalCharacters': original_characters, 'shownCharacters': shown_characters}
        assert tokens <= 4096 - output, {'inputTokens': tokens, 'outputTokens': output, 'context': 4096}
        current = page.evaluate("async()=>{const o=await import('/scripts/openai.js');return {reply:o.oai_settings.openai_max_tokens,context:o.oai_settings.openai_max_context};}")
        assert current == {'reply': 64, 'context': 4096}, current
        before = len(state['calls'])
        send()
        normal = [call for call in state['calls'][before:] if call['kind'] == 'story']
        assert len(normal) == 1 and normal[0]['payload']['max_tokens'] == 64
        audit['sidecarBudget'] = {'context': 4096, 'mainReplyTokensBeforeAndAfter': 64, 'sidecarOutputTokens': output,
            'sidecarInputTokens': tokens, 'originalUserCharacters': original_characters, 'shownUserCharacters': shown_characters,
            'followingMainRequestTokens': normal[0]['payload']['max_tokens']}
        result['checks']['affinitySidecarInputAndOutputBudgetNeverMutatesMainSettings'] = True

    def group_freeze():
        reset()
        fixture = page.evaluate("""async({sample,suffix})=>{
            const c=SillyTavern.getContext();
            const post=async(url,data)=>{
                const r=await fetch(url,{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify(data)});
                if(!r.ok)throw new Error('Group fixture API '+r.status);return r.json();
            };
            const form=new FormData();form.set('ch_name','Director Synthetic');
            form.set('file_name','AffinityTwin-'+suffix);form.set('first_mes','Ready.');
            const r=await fetch('/api/characters/create',{method:'POST',headers:{'X-CSRF-Token':c.getRequestHeaders()['X-CSRF-Token']},body:form});
            if(!r.ok)throw new Error('Second avatar creation failed');const avatar=await r.text();
            await c.getCharacters();
            if(![avatar,sample.avatar].every(id=>SillyTavern.getContext().characters.some(character=>character.avatar===id)))throw new Error('Real group avatars missing');
            const chatId='AffinityGroup-'+suffix;
            const group=await post('/api/groups/create',{name:'Affinity Synthetic Group',members:[sample.avatar,avatar],
                chat_id:chatId,chats:[chatId],activation_strategy:1,generation_mode:0});
            await post('/api/chats/group/save',{id:chatId,chat:[
                {user_name:'Synthetic Tester',character_name:'Group',chat_metadata:{integrity:chatId}},
                {name:'Synthetic Tester',is_user:true,is_system:false,mes:'A synthetic group river scene.',extra:{}}
            ]});
            const g=await import('/scripts/group-chats.js');await g.getGroups();
            if(!await g.openGroupById(group.id))throw new Error('Native group open refused');
            return {groupId:group.id,avatar,members:[sample.avatar,avatar]};
        }""", {'sample': sample, 'suffix': uuid.uuid4().hex[:10]})
        state['mode'] = 'group'
        calls_before = len(state['calls'])
        for _ in range(3):
            send(2)
        page.wait_for_function('SillyTavern.getContext().chatMetadata.director.__affinity.cursor===5')
        value = ledger()
        assert value['issued'] == 6
        expected = set(fixture['members'])
        assert set(event['owner'] for event in value['events']) == expected, {'ledger': value,
            'evaluatorCalls': [call.get('eventCount') for call in state['calls'][calls_before:] if call['kind'] == 'relationship_evidence']}
        avatars = page.evaluate('SillyTavern.getContext().chat.filter(m=>m.is_user===false&&!m.is_system).map(m=>m.original_avatar)')
        assert len(avatars) == 6 and all(avatar in expected for avatar in avatars)
        assert all(avatars[index:index + 2] == fixture['members'] for index in range(0, 6, 2)), avatars
        # Read-only observation at the real provider boundary; no lifecycle event
        # is synthesized to pretend that the wrapper has ended.
        group_calls = state['calls'][calls_before:]
        evidence_calls = [call for call in group_calls if call['kind'] == 'relationship_evidence']
        assert len(evidence_calls) == 1
        assert evidence_calls[0]['groupStages'][-1] == 'finish', evidence_calls[0]['groupStages']
        before = len(requests())
        send(2)
        own_requests = requests()[before:]
        for index, owner in enumerate(fixture['members']):
            assert serialized(own_requests[index]).count('AFF_GROUP_PRIVATE_' + owner) == 1
            assert all('AFF_GROUP_PRIVATE_' + other not in serialized(own_requests[index]) for other in expected - {owner})
        saved = {event['id']: event for event in ledger()['events'] if event['owner'] == fixture['avatar']}
        assert saved
        page.evaluate("""async({groupId,members})=>{
            const g=await import('/scripts/group-chats.js');
            g.groups.find(group=>group.id===groupId).members=members;
            await g.editGroup(groupId,true,true);
            await SillyTavern.getContext().reloadCurrentChat();
        }""", {'groupId': fixture['groupId'], 'members': [sample['avatar']]})
        offline = [event for event in ledger()['events'] if event['owner'] == fixture['avatar']]
        assert {event['id'] for event in offline} == set(saved) and all(event.get('offline') is True for event in offline), offline
        before = len(requests())
        send(1)
        assert all('AFF_GROUP_PRIVATE_' + fixture['avatar'] not in serialized(item) for item in requests()[before:])
        page.evaluate("""async({groupId,members})=>{
            const g=await import('/scripts/group-chats.js');g.groups.find(group=>group.id===groupId).members=members;
            await g.editGroup(groupId,true,true);await SillyTavern.getContext().reloadCurrentChat();
        }""", {'groupId': fixture['groupId'], 'members': fixture['members']})
        restored = [event for event in ledger()['events'] if event['owner'] == fixture['avatar']]
        assert {event['id'] for event in restored} == set(saved) and all(event.get('offline') is not True for event in restored), restored
        audit['group'] = {'actualAvatars': avatars, 'members': fixture['members'], 'initialIssued': 6,
            'initialEvaluatorRequests': 1, 'offlineEvidenceIds': sorted(saved), 'restoredSameEvidence': True}
        result['checks']['affinityActualGroupAvatarsAndWholeBatchCadence'] = True
        result['checks']['affinityGroupOwnerRemovalFreezesAndRejoinRestoresMemory'] = True

    def overlap():
        reset()
        for _ in range(5):
            send()
        evaluated(5)
        page.evaluate("""()=>{
            const c=SillyTavern.getContext();
            const s=window.__affinityOverlap={paused:false,completed:[],gate:null};
            s.ready=data=>{if(s.paused || data.dryRun)return;s.paused=true;return new Promise(resolve=>s.gate=resolve);};
            s.completedListener=data=>s.completed.push(data.type);
            c.eventSource.on(c.eventTypes.CHAT_COMPLETION_PROMPT_READY,s.ready);
            c.eventSource.on(c.eventTypes.GENERATION_COMPLETED,s.completedListener);
        }""")
        start = len(requests())
        try:
            page.locator('#send_textarea').fill('AFF_OVERLAP_USER')
            page.locator('#send_but').click()
            page.wait_for_function('window.__affinityOverlap.paused && !!window.__affinityOverlap.gate')
            quiet = page.evaluate("""async()=>{
                const s=window.__affinityOverlap;
                const reply=await SillyTavern.getContext().generateQuietPrompt({quietPrompt:'AFF_EXTERNAL_QUIET'});
                return {reply,completed:s.completed.slice(),normalStillPaused:!!s.gate};
            }""")
            assert quiet == {'reply': 'AFF_EXTERNAL_QUIET_DONE', 'completed': ['quiet'], 'normalStillPaused': True}, quiet
            page.evaluate('()=>{window.__affinityOverlap.gate();window.__affinityOverlap.gate=null;}')
            page.wait_for_function("window.__affinityOverlap.completed.includes('normal')")
            idle()
            batch = requests()[start:]
            observation = {'requests': len(batch), 'memoryOccurrences': [serialized(item).count(literal) for item in batch],
                'markerOccurrences': [len(marker.findall(serialized(item))) for item in batch], 'issuedAfter': ledger()['issued'], 'quiet': quiet}
            audit['overlap'] = observation
            assert len(batch) == 2 and observation['memoryOccurrences'] == [0, 1], observation
            no_frames(batch)
            assert observation['issuedAfter'] == 6, observation
            result['checks']['affinityConcurrentQuietKeepsLiteralMemoryAndCompletionReceipt'] = True
        finally:
            page.evaluate("""()=>{
                const c=SillyTavern.getContext(),s=window.__affinityOverlap;
                if(s.gate)s.gate();
                c.eventSource.removeListener(c.eventTypes.CHAT_COMPLETION_PROMPT_READY,s.ready);
                c.eventSource.removeListener(c.eventTypes.GENERATION_COMPLETED,s.completedListener);
            }""")

    def budget():
        rows = [dict(name='Synthetic Tester' if i % 2 == 0 else 'Director Synthetic', is_user=i % 2 == 0,
            is_system=False, mes=f'AFF_HISTORY_{i:03} ' + 'The synthetic traveller records a calm journey beside the river. ' * 5, extra={}) for i in range(100)]
        reset(rows)
        state['mode'] = 'budget'
        for _ in range(5):
            send()
        evaluated(5, 5)
        snapshot = page.evaluate('structuredClone({chat:SillyTavern.getContext().chat,metadata:SillyTavern.getContext().chatMetadata})')
        facts = [event['fact'] for event in ledger()['events']]

        def small_context():
            page.evaluate("""async()=>{
                const o=await import('/scripts/openai.js');
                Object.assign(o.oai_settings,{custom_model:'gpt-4o',openai_max_context:2048,openai_max_tokens:256,stream_openai:false});
            }""")

        def token_count(messages):
            return page.evaluate("""async messages=>{
                const c=SillyTavern.getContext();
                const r=await fetch('/api/tokenizers/openai/count?model=gpt-4o',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify(messages)});
                if(!r.ok)throw new Error('Configured tokenizer failed');return (await r.json()).token_count;
            }""", messages)

        settings(False)
        small_context()
        start = len(requests())
        send()
        baseline = requests()[start:]
        assert len(baseline) == 1
        page.evaluate("""async snapshot=>{
            const c=SillyTavern.getContext();
            c.chat.splice(0,c.chat.length,...snapshot.chat);
            window.__affinityMain.updateChatMetadata(snapshot.metadata,true);
            await c.saveChat();await c.reloadCurrentChat();
        }""", snapshot)
        settings(True)
        small_context()
        start = len(requests())
        send()
        with_memory = requests()[start:]
        assert len(with_memory) == 1
        baseline_tokens = token_count(baseline[0]['messages'])
        memory_tokens = token_count(with_memory[0]['messages'])
        old_ids = re.findall(r'AFF_HISTORY_\d{3}', serialized(baseline))
        new_ids = re.findall(r'AFF_HISTORY_\d{3}', serialized(with_memory))
        observation = {'context': 2048, 'reply': 256, 'budget': 1792, 'withoutMemoryTokens': baseline_tokens,
            'withMemoryTokens': memory_tokens, 'withoutMemoryHistory': len(old_ids), 'withMemoryHistory': len(new_ids), 'facts': len(facts)}
        audit['budget'] = observation
        assert 0 < len(old_ids) < len(rows) and len(new_ids) < len(old_ids), observation
        assert baseline_tokens <= 1792 and memory_tokens <= 1792, observation
        assert len(facts) == 5 and all(serialized(with_memory).count(fact) == 1 for fact in facts)
        no_frames(with_memory)
        result['checks']['affinityFullMemoryBudgetAndHistoryTrim'] = True

    def reload_race():
        reset()
        for _ in range(4):
            send()
        held = []

        def hold_get(route):
            held.append(route)

        page.route('**/api/chats/get', hold_get)
        saves_before = len(state['saves'])
        try:
            page.evaluate('()=>{window.__affinityBrowser.armReload=true;window.__affinityBrowser.reloadFinished=false;}')
            page.locator('#send_textarea').fill('AFF_RELOAD_IMMEDIATELY_AFTER_SUCCESS')
            page.locator('#send_but').click()
            deadline = time.monotonic() + 20
            while not held and time.monotonic() < deadline:
                page.wait_for_timeout(20)
            assert held, 'Native reload did not reach the held chat load'
            page.wait_for_timeout(150)
            paused = page.evaluate("""()=>({length:SillyTavern.getContext().chat.length,
                oldIssued:window.__affinityBrowser.oldMetadata?.director?.__affinity?.issued})""")
            empty_saves = [item for item in state['saves'][saves_before:] if item['messages'] <= 1]
            audit['reloadRace'] = {'paused': paused, 'emptySaves': empty_saves}
            assert not empty_saves, audit['reloadRace']
            for route in held:
                route.continue_()
            page.unroute('**/api/chats/get', hold_get)
            page.wait_for_function('window.__affinityBrowser.reloadFinished', timeout=30000)
            assert ledger().get('issued') == 5, {'afterNativeReload': ledger()}
            evaluated(5)
            wait_disk(5)
            page.evaluate('async()=>{await SillyTavern.getContext().reloadCurrentChat();}')
            assert ledger()['issued'] == 5
            result['checks']['affinityImmediateNativeReloadPreservesReceiptAndNeverSavesEmptyChat'] = True
        finally:
            page.unroute('**/api/chats/get', hold_get)
            for route in held:
                try:
                    route.continue_()
                except Exception:
                    pass

    try:
        cases = {'cadence': cadence, 'persistence': persistence_and_edit, 'overlap': overlap, 'budget': budget,
            'reloadRace': reload_race, 'majorAndMobile': major_and_ui, 'sidecarBudget': sidecar_budget,
            'cancellation': cancellation_and_failures, 'group': group_freeze}
        for name in selection:
            print('Affinity browser ' + name + ' starting', flush=True)
            try:
                cases[name]()
                audit.setdefault(name, {})['passed'] = True
                print('Affinity browser ' + name + ' passed', flush=True)
            except Exception as error:
                detail = type(error).__name__ + ': ' + str(error)
                audit.setdefault(name, {}).update({'passed': False, 'failure': detail})
                failures.append(name + ': ' + detail)
                print('Affinity browser ' + name + ' FAILED: ' + detail[:800], flush=True)
        assert not state['fixtureErrors'], state['fixtureErrors']
        assert not failures, 'Affinity browser regressions failed:\n' + '\n'.join(failures)
    finally:
        page.unroute('**/api/backends/chat-completions/generate', generation_route)
        page.remove_listener('request', observe_save)
