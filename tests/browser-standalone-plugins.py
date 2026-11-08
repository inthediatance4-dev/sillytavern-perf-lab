"""Install the actual ZIPs on an unpatched host with disposable synthetic data.

No production data, real model credentials, or host source mutations are used.
Fixtures are retained under ignored evidence; this runner deletes no files.
"""
import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import urllib.request
import uuid
import zipfile

from playwright.sync_api import sync_playwright
from lab_browser import launch_chromium

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('director_browser_helpers', ROOT / 'tests/browser-director-lab.py')
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)


def connect_api(page):
    page.evaluate("document.querySelector('#api_button_openai').click()")
    page.wait_for_function("SillyTavern.getContext().onlineStatus !== 'no_connection'", timeout=20000)


def ready(page, origin):
    helpers.ready(page, origin)
    page.evaluate("""async()=>{window.__standaloneMain=await import('/script.js');
        window.__standaloneGroups=await import('/scripts/group-chats.js')}""")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host-root', type=Path, required=True)
    parser.add_argument('--node', default='node')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    host = args.host_root.resolve()
    out = args.output.resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    fixture = Path(tempfile.mkdtemp(prefix='installed-host-', dir=out.parent))
    result = {'hostCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=host, text=True).strip(),
              'checks': {}, 'realModel': False, 'errors': []}
    fake = server = browser = None
    stage = 'build packages'
    try:
        build = json.loads(subprocess.check_output([args.node, 'scripts/build-standalone-plugins.mjs'], cwd=ROOT, text=True, encoding='utf-8'))
        result['packages'] = build['packages']
        fake_source = """const {createFakeOpenAI}=await import(process.argv[1]);
            const fake=await createFakeOpenAI({reply:'{"events":[]}',tokens:16,rate:10000,jitter:0});
            console.log(JSON.stringify({url:fake.url}));
            for(const s of ['SIGINT','SIGTERM'])process.once(s,async()=>{await fake.close()});"""
        fake = subprocess.Popen([args.node, '--input-type=module', '-e', fake_source,
                                 (ROOT / 'scripts/fake-openai-endpoint.mjs').as_uri()], cwd=ROOT,
                                stdout=subprocess.PIPE, stderr=(fixture / 'provider.log').open('w'), text=True, encoding='utf-8')
        fake_url = json.loads(fake.stdout.readline())['url']
        port = helpers.free_port()
        origin = f'http://127.0.0.1:{port}/'
        prepare = """import fs from 'node:fs/promises';import path from 'node:path';import yaml from 'yaml';
            const [host,dir,port,url]=process.argv.slice(1);
            const config=yaml.parse(await fs.readFile(path.join(host,'default/config.yaml'),'utf8'));
            config.extensions.enabled=true;
            config.extensions.models??={};config.extensions.models.autoDownload=false;
            config.browserLaunch.enabled=false;config.listen=false;config.port=Number(port);
            await fs.writeFile(path.join(dir,'config.yaml'),yaml.stringify(config));
            const settings=JSON.parse(await fs.readFile(path.join(host,'default/content/settings.json'),'utf8'));
            Object.assign(settings,{firstRun:false,username:'Synthetic Tester',main_api:'openai'});
            Object.assign(settings.oai_settings,{chat_completion_source:'custom',custom_url:url,custom_model:'startup-synthetic',stream_openai:false});
            settings.power_user.auto_connect=false;
            settings.extension_settings.disabledExtensions=['director','affinity'];
            const third=path.join(host,'public/scripts/extensions/third-party');
            for(const name of await fs.readdir(third).catch(()=>[]))settings.extension_settings.disabledExtensions.push('third-party/'+name);
            delete settings.extension_settings.affinity;
            settings.extension_settings.director??={};settings.extension_settings.director.affinity={enabled:false,interval:5};
            await fs.mkdir(path.join(dir,'data/default-user/extensions'),{recursive:true});
            await fs.writeFile(path.join(dir,'data/default-user/settings.json'),JSON.stringify(settings));"""
        subprocess.run([args.node, '--input-type=module', '-e', prepare, str(host), str(fixture), str(port), fake_url], cwd=ROOT, check=True)
        extension_root = fixture / 'data/default-user/extensions'
        for item in build['packages']:
            with zipfile.ZipFile(Path(build['buildDir']) / item['fileName']) as archive:
                archive.extractall(extension_root)
        env = {key: value for key, value in os.environ.items() if not key.upper().startswith('SILLYTAVERN_')}
        server = subprocess.Popen([args.node, 'server.js', '--configPath', str(fixture / 'config.yaml'),
                                   '--dataRoot', str(fixture / 'data'), '--port', str(port), '--listen', 'false',
                                   '--browserLaunchEnabled', 'false'], cwd=host, env=env,
                                  stdout=(fixture / 'server.log').open('w', encoding='utf-8'), stderr=subprocess.STDOUT)
        stage = 'wait host'
        helpers.wait_http(origin, server)
        with sync_playwright() as p:
            browser = launch_chromium(p)
            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
            page.on('pageerror', lambda error: result.setdefault('expectedProviderFailures', []).append(str(error))
                    if fixture_state.get('expectingFailure') and 'Internal Server Error' in str(error) else result['errors'].append(str(error)))
            page.on('console', lambda message: result.setdefault('consoleErrors', []).append(message.text) if message.type == 'error' else None)
            memory_text = 'ST_AFF_PRIVATE {{char}} remembers the river promise.'
            fate_text = 'ST_FATE_PRIVATE {{char}}: A courier leaves a sealed invitation.'
            fixture_state = {'failNext': False, 'expectingFailure': False, 'group': False, 'piggyback': None}

            def provider_route(route):
                payload = route.request.post_data_json
                fixture_options = {}
                text = '\n'.join(str(m.get('content', '')) for m in payload.get('messages', []))
                if (payload.get('json_schema') or {}).get('name') == 'relationship_evidence':
                    refs = json.loads(text.rsplit('消息：', 1)[1])
                    owners = {r['owner']: r for r in refs if r['owner'] != 'player'}
                    selected = owners.values() if fixture_state['group'] else [list(owners.values())[-1]]
                    events = [{'owner': ref['owner'], 'kind': 'fact', 'fact': memory_text + (' owner=' + ref['owner'] if fixture_state['group'] else ''),
                               'actor': 'character', 'recipient': 'user', 'status': 'observed', 'valence': 'none', 'impact': 'minor', 'confidence': 'high',
                               'attitudeExplicit': False, 'outcomeKnown': None, 'knownToCharacter': 'yes',
                               'source': {'slot': ref['slot'], 'quote': ref['text'][:120]}} for ref in selected]
                    reply = json.dumps({'events': events})
                elif 'Invent one unexpected event for the current story.' in text:
                    reply = json.dumps({'event': fate_text})
                elif fixture_state['piggyback']:
                    reply = 'Synthetic piggyback story.'
                    fixture_options = {'piggyback': {'story': reply, 'events': ['PRIVATE_INSTALLED_EVENT_'+str(i) for i in range(3)]},
                                       'piggybackChannel': fixture_state['piggyback']}
                else:
                    reply = 'Synthetic standalone reply.'
                req = urllib.request.Request(fake_url.replace('/v1', '') + '/__configure',
                                             data=json.dumps({'reply': reply, 'nextStatus': 500 if fixture_state['failNext'] else 0, **fixture_options}).encode(), headers={'Content-Type': 'application/json'})
                if fixture_state['failNext']:
                    page.evaluate('window.__standaloneFailedRequested=true')
                fixture_state['failNext'] = False
                with urllib.request.urlopen(req) as response:
                    assert response.status == 200
                route.continue_()

            page.route('**/api/backends/chat-completions/generate', provider_route)
            stage = 'activate installed extensions'
            ready(page, origin)
            page.wait_for_selector('#directorButton', state='attached')
            page.wait_for_selector('#affinity_settings', state='attached')
            migrated = page.evaluate('SillyTavern.getContext().extensionSettings.affinity')
            assert migrated == {'enabled': False, 'interval': 5}, migrated
            result['checks']['installedEntriesTemplatesAndLegacyOptOut'] = True
            assert page.locator('#affinity_settings .inline-drawer-content').evaluate('e=>getComputedStyle(e).display') == 'none'
            result['checks']['drawerInitiallyCollapsed'] = True
            stage = 'create synthetic character'
            sample = page.evaluate("""async suffix=>{
                const c=SillyTavern.getContext();const form=new FormData();
                form.set('ch_name','Standalone Synthetic');form.set('file_name','Standalone-'+suffix);
                form.set('description','Synthetic plugin compatibility fixture.');form.set('first_mes','Synthetic greeting');
                const r=await fetch('/api/characters/create',{method:'POST',headers:c.getRequestHeaders({omitContentType:true}),body:form});
                if(!r.ok)throw new Error('Fixture create failed');const avatar=await r.text();
                await c.getCharacters();const index=c.characters.findIndex(x=>x.avatar===avatar);
                await c.selectCharacterById(String(index));return {avatar};
            }""", uuid.uuid4().hex[:8])
            connect_api(page)
            stage = 'standalone affinity only'
            page.evaluate("""async()=>{const c=SillyTavern.getContext();
                c.extensionSettings.disabledExtensions.push('third-party/st-director-fate-cards');
                c.extensionSettings.affinity={enabled:true,interval:5};await (await import('/script.js')).saveSettings();}""")
            ready(page, origin)
            assert page.locator('#directorButton').count() == 0
            page.wait_for_selector('#affinity_settings', state='attached')
            page.evaluate("async avatar=>{const c=SillyTavern.getContext();await c.getCharacters();await c.selectCharacterById(String(c.characters.findIndex(x=>x.avatar===avatar)))}", sample['avatar'])
            connect_api(page)
            for index in range(5):
                page.locator('#send_textarea').fill('Synthetic turn ' + str(index))
                page.locator('#send_but').click()
                try:
                    page.wait_for_function('SillyTavern.getContext().chatMetadata.affinity?.__affinity?.issued >= '+str(index+1), timeout=45000)
                except Exception:
                    result['affinityFailure'] = page.evaluate("""async()=>({ledger:SillyTavern.getContext().chatMetadata.affinity,
                        chat:SillyTavern.getContext().chat, characterId:SillyTavern.getContext().characterId,
                        settings:SillyTavern.getContext().extensionSettings.affinity,
                        diagnostic:(await import('/scripts/extensions/third-party/st-affinity-memory/index.js')).getAffinityDiagnostics()})""")
                    raise
                page.wait_for_function("!document.querySelector('#mes_stop')?.getClientRects().length")
            page.wait_for_function('SillyTavern.getContext().chatMetadata.affinity?.__affinity?.cursor===5', timeout=45000)
            result['checks']['affinityAloneFiveNativeCompletionsAndExtraction'] = True
            requests = json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests'))
            isolated = [r for r in requests if len(r.get('messages', [])) == 1]
            assert len(isolated) == 1, len(isolated)
            assert isolated[0].get('max_tokens', isolated[0].get('max_completion_tokens')) <= 2048
            assert isolated[0].get('stream') is False
            result['checks']['isolatedEvaluatorUsesOneLiteralMessageAndOwnBudget'] = True
            page.locator('#send_textarea').fill('Synthetic memory injection probe')
            page.locator('#send_but').click()
            page.wait_for_function('SillyTavern.getContext().chatMetadata.affinity.__affinity.issued===6')
            requests = json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests'))
            assert json.dumps(requests[-1], ensure_ascii=False).count(memory_text) == 1
            assert 'stprivate' not in json.dumps(requests[-1]) and 'strequest' not in json.dumps(requests[-1])
            result['checks']['extractedObservationActuallyEntersNextPromptLiterallyOnce'] = True
            stage = 'native affinity stream, continue, regenerate and swipe'
            page.evaluate("async()=>{(await import('/scripts/openai.js')).oai_settings.stream_openai=true}")
            page.locator('#send_textarea').fill('Synthetic streaming success')
            page.locator('#send_but').click()
            page.wait_for_function('SillyTavern.getContext().chatMetadata.affinity.__affinity.issued===7', timeout=30000)
            page.evaluate("async()=>{(await import('/scripts/openai.js')).oai_settings.stream_openai=false}")
            for generation_type in ['continue', 'regenerate']:
                page.evaluate('type=>SillyTavern.getContext().generate(type)', generation_type)
                assert page.evaluate('SillyTavern.getContext().chatMetadata.affinity.__affinity.issued') == 7
            slot = page.evaluate('SillyTavern.getContext().chat.length-1')
            helpers.swipe_message(page, slot, 1)
            page.wait_for_function('slot=>SillyTavern.getContext().chat[slot]?.swipe_id===1', arg=slot)
            page.wait_for_function('!window.__standaloneMain.isGenerating() && !window.__standaloneMain.isChatSaving')
            assert page.evaluate('SillyTavern.getContext().chatMetadata.affinity.__affinity.issued') == 7
            result['checks']['nativeStreamCountsOnceContinueRegenerateSwipeKeepLogicalCount'] = True
            stage = 'failed foreground cannot issue affinity receipt'
            fixture_state['failNext'] = True
            fixture_state['expectingFailure'] = True
            page.locator('#send_textarea').fill('Synthetic failing generation')
            page.locator('#send_but').click()
            page.wait_for_function('window.__standaloneFailedRequested===true')
            page.wait_for_function('!window.__standaloneMain.isGenerating() && !window.__standaloneMain.isChatSaving')
            page.wait_for_timeout(100)
            fixture_state['expectingFailure'] = False
            assert page.evaluate('SillyTavern.getContext().chatMetadata.affinity.__affinity.issued') == 7
            result['checks']['failedNativeGenerationDoesNotCount'] = True
            stage = 'standalone Director only'
            page.evaluate("""async()=>{const c=SillyTavern.getContext();
                c.extensionSettings.disabledExtensions=c.extensionSettings.disabledExtensions.filter(x=>x!=='third-party/st-director-fate-cards');
                c.extensionSettings.disabledExtensions.push('third-party/st-affinity-memory');await (await import('/script.js')).saveSettings();}""")
            ready(page, origin)
            page.wait_for_selector('#directorButton', state='attached')
            page.evaluate("async avatar=>{const c=SillyTavern.getContext();await c.getCharacters();await c.selectCharacterById(String(c.characters.findIndex(x=>x.avatar===avatar)))}", sample['avatar'])
            assert page.locator('#affinity_settings').count() == 0
            result['checks']['directorLoadsWithoutAffinity'] = True
            stage = 'first narrative literal and reload'
            page.evaluate("""async()=>{const c=SillyTavern.getContext();c.chat.splice(0);await c.saveChat();
                c.extensionSettings.director.presets.push({id:'standalone-literal',name:'Literal probe',icon:'L',mode:'narrator',
                    template:'{{input:Literal}}',isChapter:false,autoGenerate:false});}""")
            try:
                helpers.preset(page, 'standalone-literal', text='Literal {{char}} {{roll 1d6}}')
            except Exception:
                result['literalFailure'] = page.evaluate("""()=>({characterId:SillyTavern.getContext().characterId,
                    chat:SillyTavern.getContext().chat,presets:SillyTavern.getContext().extensionSettings.director.presets,
                    dialogs:[...document.querySelectorAll('dialog[open]')].map(x=>x.outerHTML),
                    toasts:[...document.querySelectorAll('.toast-message')].map(x=>x.textContent)})""")
                raise
            literal = 'Literal {{char}} {{roll 1d6}}'
            page.wait_for_function('text=>SillyTavern.getContext().chat.some(x=>x.mes===text)', arg=literal)
            connect_api(page)
            page.evaluate("SillyTavern.getContext().generate('normal')")
            page.wait_for_function("!document.querySelector('#mes_stop')?.getClientRects().length")
            page.evaluate('SillyTavern.getContext().reloadCurrentChat()')
            page.wait_for_function('text=>SillyTavern.getContext().chat.some(x=>x.mes===text)', arg=literal)
            first = page.evaluate('SillyTavern.getContext().chat[0]')
            if first.get('extra', {}).get('directorStart'):
                assert first['mes'] == '' and first['is_system']
                assert page.locator('#chat .mes[mesid="0"]').is_hidden()
            result['checks']['firstNarrativeLiteralAfterNativeGenerationAndReload'] = True
            stage = 'Fate draw and parallel native quiet'
            page.locator('#directorButton').click()
            page.locator('#director_fate_open').click()
            page.locator('#director_fate_panel').wait_for(state='visible')
            page.locator('#director_fate_draw').click()
            page.locator('.director_fate_choice').first.click()
            page.wait_for_function('SillyTavern.getContext().chatMetadata.director?.fate?.held?.event', timeout=30000)
            held = page.evaluate('SillyTavern.getContext().chatMetadata.director.fate.held')
            assert held['event'] == fate_text, {'event': held['event']}
            assert fate_text not in page.locator('body').inner_text(), 'private event visible in DOM'
            page.evaluate("""()=>{const c=SillyTavern.getContext();const s=window.__standalonePause={arm:true};
                s.listener=data=>{if(!s.arm || data.dryRun)return;s.arm=false;s.before=structuredClone(data.chat);
                    return new Promise(resolve=>{s.resume=resolve})};
                c.eventSource.on(c.eventTypes.CHAT_COMPLETION_PROMPT_READY,s.listener);}""")
            before = len(json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests')))
            page.locator('#director_fate_apply').click()
            page.wait_for_function('!!window.__standalonePause.resume')
            page.evaluate("SillyTavern.getContext().generateQuietPrompt({quietPrompt:'ST_EXTERNAL_QUIET',responseLength:32})")
            requests = json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests'))
            assert len(requests) == before + 1, {'quietRequestCount': len(requests)-before}
            assert fate_text not in json.dumps(requests[-1], ensure_ascii=False), 'event leaked into quiet'
            assert memory_text not in json.dumps(requests[-1], ensure_ascii=False), 'memory leaked into quiet'
            page.evaluate('window.__standalonePause.resume()')
            page.wait_for_function('id=>!SillyTavern.getContext().chatMetadata.director.fate.held && SillyTavern.getContext().chatMetadata.director.fate.bound?.id===id', arg=held['id'], timeout=30000)
            requests = json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests'))
            batch = requests[before:]
            occurrences = [json.dumps(r, ensure_ascii=False).count(fate_text) for r in batch]
            result['fateConcurrency'] = {'requests': len(batch), 'eventOccurrences': occurrences}
            assert len(batch) == 2, result['fateConcurrency']
            assert occurrences == [0, 1], result['fateConcurrency']
            assert all('stprivate' not in json.dumps(r) and 'strequest' not in json.dumps(r) and 'directorfate' not in json.dumps(r) for r in batch), 'private marker reached provider'
            result['checks']['nativeQuietDoesNotStealFateAndOnlySavedReplyConsumesCard'] = True
            stage = 'both plugins with native group ownership and regeneration'
            page.evaluate("""async()=>{const c=SillyTavern.getContext();
                c.extensionSettings.disabledExtensions=c.extensionSettings.disabledExtensions.filter(x=>x!=='third-party/st-affinity-memory');
                await (await import('/script.js')).saveSettings();}""")
            ready(page, origin)
            group = page.evaluate("""async({avatar,suffix})=>{
                const c=SillyTavern.getContext();const post=async(url,body)=>{
                    const r=await fetch(url,{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify(body)});
                    if(!r.ok)throw new Error('Group fixture failed');return r.json()};
                const form=new FormData();form.set('ch_name','Standalone Synthetic');form.set('file_name','StandaloneTwin-'+suffix);form.set('first_mes','Ready.');
                const r=await fetch('/api/characters/create',{method:'POST',headers:c.getRequestHeaders({omitContentType:true}),body:form});
                const second=await r.text();await c.getCharacters();
                const chatId='StandaloneGroup-'+suffix;
                const group=await post('/api/groups/create',{name:'Standalone Group',members:[avatar,second],chat_id:chatId,chats:[chatId],activation_strategy:1,generation_mode:0});
                await post('/api/chats/group/save',{id:chatId,chat:[{user_name:'Synthetic Tester',character_name:'Group',chat_metadata:{integrity:chatId}},
                    {name:'Synthetic Tester',is_user:true,is_system:false,mes:'Synthetic group scene.',extra:{}}]});
                const g=await import('/scripts/group-chats.js');await g.getGroups();await g.openGroupById(group.id);
                return {id:group.id,members:[avatar,second]};
            }""", {'avatar': sample['avatar'], 'suffix': uuid.uuid4().hex[:8]})
            fixture_state['group'] = True
            connect_api(page)
            for index in range(3):
                page.locator('#send_textarea').fill('Synthetic group turn ' + str(index))
                page.locator('#send_but').click()
                page.wait_for_function('n=>SillyTavern.getContext().chatMetadata.affinity?.__affinity?.issued===n', arg=2*(index+1), timeout=30000)
                page.wait_for_function('!window.__standaloneGroups.is_group_generating && !window.__standaloneMain.isChatSaving')
            page.wait_for_function('SillyTavern.getContext().chatMetadata.affinity.__affinity.cursor===5', timeout=30000)
            ledger = page.evaluate('SillyTavern.getContext().chatMetadata.affinity.__affinity')
            assert set(e['owner'] for e in ledger['events']) == set(group['members'])
            before = len(json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests')))
            page.locator('#send_textarea').fill('Synthetic group memory proof')
            page.locator('#send_but').click()
            page.wait_for_function('SillyTavern.getContext().chatMetadata.affinity.__affinity.issued===8')
            page.wait_for_function('!window.__standaloneGroups.is_group_generating && !window.__standaloneMain.isChatSaving')
            batch = json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests'))[before:]
            assert len(batch) == 2
            for request, owner in zip(batch, group['members']):
                text = json.dumps(request, ensure_ascii=False)
                assert text.count(memory_text + ' owner=' + owner) == 1
                assert all(memory_text + ' owner=' + other not in text for other in group['members'] if other != owner)
            result['checks']['bothPluginsGroupRepliesAndEachNativeSpeakerOwnMemory'] = True
            page.locator('#directorButton').click()
            page.locator('#director_fate_open').click()
            page.locator('#director_fate_draw').click()
            page.locator('.director_fate_choice').first.click()
            page.wait_for_function('SillyTavern.getContext().chatMetadata.director?.fate?.held?.event', timeout=30000)
            group_card = page.evaluate('SillyTavern.getContext().chatMetadata.director.fate.held.id')
            before = len(json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests')))
            page.locator('#director_fate_apply').click()
            page.wait_for_function('SillyTavern.getContext().chatMetadata.affinity.__affinity.issued===10', timeout=30000)
            page.wait_for_function('!window.__standaloneGroups.is_group_generating && !window.__standaloneMain.isChatSaving')
            page.wait_for_function('id=>SillyTavern.getContext().chatMetadata.director.fate.bound?.id===id', arg=group_card)
            batch = json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests'))[before:]
            foreground = [r for r in batch if len(r.get('messages', [])) > 1]
            assert len(foreground) == 2
            assert [json.dumps(r, ensure_ascii=False).count(fate_text) for r in foreground] == [1, 0]
            result['checks']['nativeGroupCardInjectsOnceAndPersistsWhileSpeakerChanges'] = True
            page.evaluate("SillyTavern.getContext().executeSlashCommandsWithOptions('/regenerate await=true')")
            page.wait_for_function('!window.__standaloneGroups.is_group_generating && !window.__standaloneMain.isChatSaving')
            assert page.evaluate('SillyTavern.getContext().chatMetadata.affinity.__affinity.issued') == 10
            assert page.locator('#directorButton').count() == 1 and page.locator('#affinity_settings').count() == 1
            result['checks']['nativeGroupRegeneratePreservesLogicalReceipts'] = True
            stage = '400 codepoint card in saturated 2048 token context'
            page.evaluate("""async()=>{const c=SillyTavern.getContext();c.extensionSettings.affinity.enabled=false;
                await (await import('/script.js')).saveSettings();}""")
            ready(page, origin)
            page.evaluate("async avatar=>{const c=SillyTavern.getContext();await c.selectCharacterById(String(c.characters.findIndex(x=>x.avatar===avatar)))}", sample['avatar'])
            history = [dict(name='Synthetic Tester' if i % 2 == 0 else 'Standalone Synthetic', is_user=i % 2 == 0,
                            is_system=False, mes=f'ST_HISTORY_{i:03} '+('The courier remembers a calm journey beside the river. '*5), extra={}) for i in range(100)]

            def install_history():
                page.evaluate("""async rows=>{const c=SillyTavern.getContext();
                    window.__standaloneMain.updateChatMetadata({integrity:c.chatMetadata.integrity},true);
                    c.chat.splice(0,c.chat.length,...structuredClone(rows));await c.saveChat();await c.reloadCurrentChat();
                    Object.assign((await import('/scripts/openai.js')).oai_settings,{custom_model:'gpt-4o',openai_max_context:2048,
                        openai_max_tokens:256,stream_openai:false,send_if_empty:''});}""", history)

            def measure(messages):
                return page.evaluate("""async messages=>{const t=await import('/scripts/tokenizers.js');
                    const r=await fetch('/api/tokenizers/openai/count?model='+encodeURIComponent(t.getTokenizerModel()),{
                        method:'POST',headers:SillyTavern.getContext().getRequestHeaders(),body:JSON.stringify(messages)});
                    if(!r.ok)throw new Error('Tokenization failed');return (await r.json()).token_count;}""", messages)

            install_history()
            connect_api(page)
            before = len(json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests')))
            page.evaluate("SillyTavern.getContext().generate('normal')")
            baseline = json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests'))[before:]
            assert len(baseline) == 1
            install_history()
            fate_text = ('ST_BUDGET_PRIVATE {{char}}: 晨雾散开后，一位旅人带着封存的地图来到河岸。' + '古桥边灯火亮起，水面浮出通往旧城的标记，信使等待众人的决定。'*20)[:400]
            assert len(fate_text) == 400
            page.locator('#directorButton').click()
            page.locator('#director_fate_open').click()
            page.locator('#director_fate_draw').click()
            page.locator('.director_fate_choice').first.click()
            page.wait_for_function('SillyTavern.getContext().chatMetadata.director?.fate?.held?.event', timeout=30000)
            before = len(json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests')))
            page.locator('#director_fate_apply').click()
            page.wait_for_function('!!SillyTavern.getContext().chatMetadata.director.fate.bound', timeout=30000)
            page.wait_for_function('!window.__standaloneMain.isGenerating() && !window.__standaloneMain.isChatSaving')
            adopted = json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests'))[before:]
            assert len(adopted) == 1
            base_ids = set(re.findall(r'ST_HISTORY_\d{3}', json.dumps(baseline[0])))
            adopted_ids = set(re.findall(r'ST_HISTORY_\d{3}', json.dumps(adopted[0])))
            budget = result['smallContextBudget'] = {'context':2048,'reply':256,'eventCodepoints':400,
                'baselineTokens':measure(baseline[0]['messages']),'adoptedTokens':measure(adopted[0]['messages']),
                'historyWithoutCard':len(base_ids),'historyWithCard':len(adopted_ids)}
            assert 0 < len(adopted_ids) < len(base_ids) < len(history), budget
            assert adopted_ids < base_ids, budget
            assert budget['baselineTokens'] <= 1792 and budget['adoptedTokens'] <= 1792, budget
            assert json.dumps(adopted[0], ensure_ascii=False).count(fate_text) == 1
            result['checks']['full400CodepointCardPaysForRealHistoryWithin2048Budget'] = True
            stage = 'installed piggyback primary, extra candidate, reasoning and stream'
            for channel, stream in [('story', False), ('candidate', False), ('reasoning', False), ('story', True)]:
                page.evaluate("""async stream=>{const c=SillyTavern.getContext();
                    window.__standaloneMain.updateChatMetadata({integrity:c.chatMetadata.integrity},true);
                    c.chat.splice(0,c.chat.length,{name:'Synthetic Tester',is_user:true,is_system:false,mes:'Synthetic piggyback scene.',extra:{}});
                    await c.saveChat();await c.reloadCurrentChat();
                    c.extensionSettings.director.fate.piggyback=true;
                    Object.assign((await import('/scripts/openai.js')).oai_settings,{custom_model:'gpt-4o',openai_max_context:8192,
                        openai_max_tokens:1536,stream_openai:stream,send_if_empty:'',show_thoughts:true});}""", stream)
                fixture_state['piggyback'] = channel
                before = len(json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests')))
                returned = page.evaluate("""async()=>{const value=await SillyTavern.getContext().generate('normal');
                    return {text:String(value),chunk:value?.messageChunk,fromStream:value?.fromStream,
                        hostHasCompletion:!!SillyTavern.getContext().eventTypes.GENERATION_COMPLETED};}""")
                page.wait_for_function('SillyTavern.getContext().chatMetadata.director?.fate?.offer?.cards?.length===3', timeout=30000)
                page.wait_for_function('!window.__standaloneMain.isGenerating() && !window.__standaloneMain.isChatSaving')
                requests = json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests'))[before:]
                assert len(requests) == 1
                message = page.evaluate('JSON.parse(JSON.stringify(SillyTavern.getContext().chat.at(-1)))')
                assert message['mes'] == 'Synthetic piggyback story.'
                assert '[[DIRECTOR_FATE_OFFER]]' not in json.dumps(message, ensure_ascii=False)
                assert 'PRIVATE_INSTALLED_EVENT_' not in json.dumps(message, ensure_ascii=False)
                assert 'PRIVATE_INSTALLED_EVENT_' not in page.locator('#chat').inner_text()
                if channel == 'candidate':
                    assert len(message.get('swipes', [])) >= 2
                if channel == 'reasoning':
                    assert message.get('extra', {}).get('reasoning')
                if returned['hostHasCompletion']:
                    assert returned['text'] == message['mes'], returned
                    assert returned['chunk'] == message['mes'], returned
                location = page.evaluate('()=>({id:SillyTavern.getContext().chatId,avatar:SillyTavern.getContext().characters[SillyTavern.getContext().characterId].avatar})')
                saved = fixture / 'data/default-user/chats' / Path(location['avatar']).stem / (location['id']+'.jsonl')
                rows = [json.loads(line) for line in saved.read_text(encoding='utf-8').splitlines() if line.strip()]
                assert 'PRIVATE_INSTALLED_EVENT_' not in json.dumps(rows[1:], ensure_ascii=False)
                assert '[[DIRECTOR_FATE_OFFER]]' not in json.dumps(rows[1:], ensure_ascii=False)
                key = 'installedPiggyback_' + channel + ('_stream' if stream else '_nonstream')
                result['checks'][key] = True
                result.setdefault('piggyback', {})[key] = {'providerCalls': len(requests), 'diskMessageClean': True,
                    'nativeReturnChecked': returned['hostHasCompletion']}
            fixture_state['piggyback'] = None
            result['providerRequests'] = len(json.load(urllib.request.urlopen(fake_url.replace('/v1', '') + '/__requests')))
            assert not result['errors'], result['errors']
            browser.close()
            browser = None
        result['passed'] = True
    except Exception as error:
        result.update(passed=False, stage=stage, error=str(error))
        if browser:
            with contextlib.suppress(Exception):
                result['stateAtFailure'] = page.evaluate("""()=>({status:[...document.querySelectorAll('.online_status_text')].map(x=>x.textContent),
                    toasts:[...document.querySelectorAll('.toast-message')].map(x=>x.textContent)})""")
        raise
    finally:
        if browser:
            with contextlib.suppress(Exception):
                browser.close()
        helpers.stop(server)
        helpers.stop(fake)
        result['runnerSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        out.write_text(json.dumps(helpers.redact(result, str(fixture)), ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        print(json.dumps({'passed': result.get('passed'), 'stage': stage, 'checks': result['checks']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
