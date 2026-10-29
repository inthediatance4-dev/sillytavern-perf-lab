"""Director acceptance on a temporary, isolated lab; retained for D3 to extend.

Run with a Python environment containing Playwright. The S0 provider defaults to
scripts/fake-openai-endpoint.mjs; --fake-endpoint can point at its unmerged copy.
Only summary hashes are retained. Data, logs, base assets and Chromium state live
in a temporary directory, and every process this script stops is its own child.
"""
import argparse
import contextlib
import hashlib
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import uuid

from playwright.sync_api import sync_playwright
from lab_browser import assert_lab_page, launch_chromium

ROOT = pathlib.Path(__file__).resolve().parent.parent


def redact(value, temporary=''):
    text = json.dumps(value, ensure_ascii=False)
    for source, replacement in [(str(ROOT), '<repo>'), (temporary, '<tmp>'),
                                (str(pathlib.Path.home()), '<home>'),
                                (socket.gethostname(), '<host>')]:
        if source:
            text = text.replace(source, replacement)
    text = re.sub(re.escape(str(ROOT.parent)) + r'/[^\s"<>]*', '<repo>', text)
    text = re.sub(r'http://127\.0\.0\.1:\d+', 'http://<host>', text)
    return json.loads(text)


def free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


def stop(child):
    if child and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)


def wait_http(origin, child):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise AssertionError('Lab server exited before readiness')
        try:
            with urllib.request.urlopen(origin + 'csrf-token', timeout=1) as response:
                if json.load(response).get('token'):
                    with urllib.request.urlopen(origin + 'lib.js', timeout=10) as library:
                        if library.status == 200:
                            return
        except (OSError, ValueError):
            pass
        time.sleep(.05)
    raise AssertionError('Lab HTTP readiness exceeded 120 seconds')


def ready(page, origin):
    page.goto(origin, wait_until='domcontentloaded', timeout=60000)
    page.wait_for_function("""() => {
        if (!window.__directorReadyHooked && window.SillyTavern?.getContext) {
            try {
                const {eventSource,eventTypes} = SillyTavern.getContext();
                eventSource.once(eventTypes.APP_READY, () => { window.__directorAppReady = true; });
                window.__directorReadyHooked = true;
            } catch (error) {
                if (!(error instanceof ReferenceError)) throw error;
            }
        }
        const dialog = document.querySelector('dialog[open]');
        if (dialog?.querySelector('.onboarding') && !dialog.dataset.labDismissed) {
            dialog.dataset.labDismissed = 'true';
            const input = [...dialog.querySelectorAll('input[type=text]')].at(-1);
            if (input) { input.value = 'Synthetic Tester'; input.dispatchEvent(new Event('input', { bubbles:true })); }
            dialog.querySelector('.popup-button-ok').click();
        }
        return window.__directorAppReady && !document.querySelector('dialog[open]') &&
            !document.querySelector('.splash-screen') && !!document.querySelector('#send_textarea')?.getClientRects().length;
    }""", timeout=60000)
    assert_lab_page(page, origin)
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')


def select_sample(page, sample, expected_messages=2):
    page.evaluate("""async (sample) => {
        const context = SillyTavern.getContext();
        await context.getCharacters();
        const index = context.characters.findIndex(card => card.avatar === sample.avatar);
        if (index < 0) throw new Error('Synthetic card not found');
        await context.selectCharacterById(String(index));
    }""", sample)
    page.wait_for_function("count => SillyTavern.getContext().chat.length === count && document.querySelectorAll('#chat .mes').length === count", arg=expected_messages)
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')


def snapshot(page):
    return page.evaluate("""() => ({
        left: document.querySelector('#leftSendForm').outerHTML,
        chat: document.querySelector('#chat').outerHTML,
        focus: [...document.querySelector('#leftSendForm').querySelectorAll('[tabindex="0"],button,input,a[href]')]
            .filter(node => node.getClientRects().length).map(node => node.id || node.outerHTML),
    })""")


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def normalize_message(value):
    if isinstance(value, list):
        return [normalize_message(item) for item in value]
    if isinstance(value, dict):
        normalized = {key:normalize_message(item) for key, item in value.items() if key != 'send_date'}
        if isinstance(normalized.get('extra'), dict):
            normalized['extra'].pop('director', None)
        return normalized
    return value


def chat_count(page):
    return page.evaluate('SillyTavern.getContext().chat.length')


def open_manager(page):
    page.locator('#directorButton').click()
    page.locator('#directorPopover').get_by_text('⚙ 管理预设', exact=True).click()
    page.locator('#director_presets').wait_for(state='visible')
    assert page.locator('#directorPopover').is_hidden()


def presets_snapshot(page):
    return page.evaluate("async () => structuredClone((await import('/scripts/extensions.js')).extension_settings.director.presets)")


def wait_presets(page, expected):
    deadline = time.monotonic() + 15
    latest = None
    while time.monotonic() < deadline:
        latest = presets_snapshot(page)
        if latest == expected:
            return latest
        page.wait_for_timeout(50)
    raise AssertionError('Director presets did not reach the expected value: ' + json.dumps(latest, ensure_ascii=False))


def wait_presets_saved(data_root, expected):
    deadline = time.monotonic() + 15
    settings_file = pathlib.Path(data_root) / 'default-user' / 'settings.json'
    while time.monotonic() < deadline:
        settings = json.loads(settings_file.read_text(encoding='utf-8'))
        if settings.get('extension_settings', {}).get('director', {}).get('presets') == expected:
            return
        time.sleep(.05)
    raise AssertionError('Debounced Director presets did not persist')


def preset(page, preset_id, text=None, cancel=False, digit=None):
    saves_chat = not cancel and preset_id in {'time-skip', 'scene', 'narration', 'chapter', 'event', 'note'}
    save = page.expect_response(lambda response: '/api/chats/save' in response.url and response.status == 200) if saves_chat else contextlib.nullcontext()
    with save as saved:
        page.locator('#directorButton').click()
        page.locator('#directorPopover').wait_for(state='visible')
        if digit:
            page.keyboard.press(str(digit))
        else:
            page.locator(f'#directorPopover [data-preset-id="{preset_id}"]').click()
        if text is not None or cancel:
            dialog = page.locator('dialog[open]')
            dialog.locator('#director-input-0').wait_for(state='visible')
            if text is not None:
                dialog.locator('#director-input-0').fill(text)
            dialog.locator('.popup-button-cancel' if cancel else '.popup-button-ok').click()
            dialog.wait_for(state='hidden')
    if saves_chat:
        saved.value.body()
    page.locator('#directorPopover').wait_for(state='hidden')
    # Rendering precedes JSONL persistence; allow the command's final continuation
    # to release its execution guard before the next user action.
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')


def run(args, temporary):
    provider = pathlib.Path(args.fake_endpoint).resolve()
    if not provider.is_file():
        raise AssertionError('S0 provider missing; supply --fake-endpoint with its module path')
    temp = pathlib.Path(temporary)
    node = args.node
    fake = server = None
    log_path = temp / 'server.log'
    result = {'base': args.base, 'checks': {}}
    stage = 'start isolated lab'
    try:
        fake_source = """const { createFakeOpenAI } = await import(process.argv[1]);
            const fake = await createFakeOpenAI({ reply:'Synthetic Director reply.', tokens:8, rate:10000, jitter:0 });
            console.log(JSON.stringify({ url:fake.url }));
            for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { await fake.close(); });"""
        fake = subprocess.Popen([node, '--input-type=module', '-e', fake_source, provider.as_uri()],
                                cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                start_new_session=os.name != 'nt')
        fake_url = json.loads(fake.stdout.readline())['url']
        port = free_port()
        origin = f'http://127.0.0.1:{port}/'
        lab_dir = temp / 'lab'
        lab_dir.mkdir()
        prepare_source = """import fs from 'node:fs/promises';
            import path from 'node:path';
            import { createRequire } from 'node:module';
            const [repo,directory,port,fakeUrl] = process.argv.slice(1);
            const require = createRequire(path.join(repo,'package.json'));
            const yaml = require('yaml');
            const { pathToFileURL } = await import('node:url');
            const { prepareTemporaryLab } = await import(pathToFileURL(path.join(repo,'scripts','longchat-lab-server.mjs')));
            const lab = await prepareTemporaryLab(directory,Number(port));
            const config = yaml.parse(await fs.readFile(lab.configPath,'utf8'));
            config.extensions.enabled = true;
            await fs.writeFile(lab.configPath,yaml.stringify(config));
            const settings = JSON.parse(await fs.readFile(path.join(repo,'default','content','settings.json'),'utf8'));
            Object.assign(settings,{ firstRun:false,username:'Synthetic Tester',main_api:'openai' });
            Object.assign(settings.oai_settings,{ chat_completion_source:'custom',custom_url:fakeUrl,
                custom_model:'startup-synthetic',stream_openai:false });
            settings.power_user.auto_connect = false;
            settings.extension_settings.disabledExtensions = ['director'];
            await fs.mkdir(path.join(lab.dataRoot,'default-user'),{ recursive:true });
            await fs.writeFile(path.join(lab.dataRoot,'default-user','settings.json'),JSON.stringify(settings));
            console.log(JSON.stringify(lab));"""
        lab = json.loads(subprocess.check_output([node, '--input-type=module', '-e', prepare_source,
            str(ROOT), str(lab_dir), str(port), fake_url], cwd=ROOT, text=True))
        env = {key: value for key, value in os.environ.items() if not key.upper().startswith('SILLYTAVERN_')}
        with log_path.open('w', encoding='utf-8') as logs:
            server = subprocess.Popen([node, 'server.js', '--configPath', lab['configPath'], '--dataRoot', lab['dataRoot'],
                '--port', str(port), '--listen', 'false', '--listenAddressIPv4', '127.0.0.1', '--enableIPv4', 'true',
                '--enableIPv6', 'false', '--browserLaunchEnabled', 'false', '--ssl', 'false', '--exclusiveDataRoot', 'true'],
                cwd=ROOT, env=env, stdout=logs, stderr=subprocess.STDOUT, start_new_session=os.name != 'nt')
            wait_http(origin, server)
            if not (pathlib.Path(lab['dataRoot']) / '.st-lab-owner.lock').is_file():
                raise AssertionError('Lab server ready without data-root owner lock')

            # Materialize static base assets without creating or changing any worktree.
            base_assets = temp / 'base-assets'
            base_assets.mkdir()
            archive = temp / 'base-public.tar'
            subprocess.run(['git', 'archive', '--output', str(archive), args.base, 'public'], cwd=ROOT, check=True)
            shutil.unpack_archive(archive, base_assets, 'tar')
            with sync_playwright() as playwright:
                browser = launch_chromium(playwright)
                context = browser.new_context(viewport={'width':1440, 'height':1000}, locale='en-US')
                errors = []
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                ready(page, origin)
                print('Director lab ready; creating synthetic fixture', flush=True)
                sample = page.evaluate("""async (suffix) => {
                    const token = (await (await fetch('/csrf-token')).json()).token;
                    const post = async (url,body) => {
                        const response = await fetch(url,{ method:'POST',headers:{'X-CSRF-Token':token,
                            'Content-Type':'application/json'},body:JSON.stringify(body) });
                        if (!response.ok) throw new Error(url+': '+response.status+' '+await response.text());
                        return response.json();
                    };
                    const form = new FormData();
                    form.set('ch_name','Director Synthetic'); form.set('file_name','DirectorSynthetic-'+suffix);
                    form.set('description','Artificial Director acceptance character.');
                    form.set('first_mes','Synthetic ready');
                    const created = await fetch('/api/characters/create',{ method:'POST',headers:{'X-CSRF-Token':token},body:form });
                    if (!created.ok) throw new Error('Synthetic create failed');
                    const avatar = await created.text();
                    const card = (await post('/api/characters/all',{})).find(card => card.avatar === avatar);
                    const rows = [{ user_name:'Synthetic Tester',character_name:card.name,chat_metadata:{integrity:'director-'+suffix} },
                        { name:'Synthetic Tester',is_user:true,is_system:false,send_date:'2026-01-01T00:00:00.000Z',mes:'Synthetic greeting',extra:{} },
                        { name:card.name,is_user:false,is_system:false,send_date:'2026-01-01T00:00:01.000Z',mes:'Synthetic ready',extra:{} }];
                    await post('/api/chats/save',{avatar_url:avatar,file_name:card.chat,chat:rows});
                    window.__directorPost = post;
                    return {avatar,chatName:card.chat};
                }""", uuid.uuid4().hex[:10])
                select_sample(page, sample)
                assert page.locator('#directorButton').count() == 0
                disabled = snapshot(page)
                stage = 'base disabled static asset snapshot'
                base_page = context.new_page()
                base_page.on('pageerror', lambda error: errors.append(str(error)))

                def base_asset(route):
                    pathname = urllib.parse.unquote(urllib.parse.urlparse(route.request.url).path)
                    target = base_assets / 'public' / (pathname.lstrip('/') or 'index.html')
                    # public/lib.js is Webpack input; the server serves its generated
                    # bundle instead. Its source is unchanged at the compared revisions.
                    if pathname != '/lib.js' and target.is_file() and target.resolve().is_relative_to((base_assets / 'public').resolve()):
                        route.fulfill(path=str(target))
                    else:
                        route.continue_()

                base_page.route(origin + '**', base_asset)
                ready(base_page, origin)
                select_sample(base_page, sample)
                base_disabled = snapshot(base_page)
                assert disabled == base_disabled, 'Disabled Director changes base left row/chat/focus snapshot'
                print('Disabled left row, chat and focus match the base exactly', flush=True)
                result['checks']['disabledBaseDomExact'] = {
                    'leftSha256':digest(disabled['left']), 'chatSha256':digest(disabled['chat']),
                    'focusCount':len(disabled['focus'])}
                base_page.close()

                stage = 'enable Director'
                await_enable = """async () => {
                    const extensions = await import('/scripts/extensions.js');
                    extensions.extension_settings.disabledExtensions = extensions.extension_settings.disabledExtensions.filter(id => id !== 'director');
                    await (await import('/script.js')).saveSettings();
                }"""
                page.evaluate(await_enable)
                ready(page, origin)
                select_sample(page, sample)
                page.locator('#directorButton').wait_for(state='visible')
                assert page.evaluate("document.querySelector('#extensionsMenuButton').nextElementSibling?.id") == 'directorButton'
                wand_box = page.locator('#extensionsMenuButton').bounding_box()
                director_box = page.locator('#directorButton').bounding_box()
                assert abs(wand_box['y'] - director_box['y']) < 1 and director_box['x'] >= wand_box['x'] + wand_box['width'] - 1
                enabled_focus = snapshot(page)['focus']
                # Director intentionally adds one focusable button next to the extension menu.
                assert [item for item in enabled_focus if item != 'directorButton'] == disabled['focus']
                assert enabled_focus.count('directorButton') == 1
                result['checks']['buttonAdjacentAndIntentionalFocusEntry'] = True
                print('Director button adjacency and focus entry passed', flush=True)

                stage = 'scoped keyboard and cancellation'
                before = chat_count(page)
                page.locator('#send_textarea').fill('')
                page.locator('#send_textarea').press_sequentially('123')
                assert page.locator('#send_textarea').input_value() == '123'
                assert chat_count(page) == before and page.locator('dialog[open]').count() == 0
                page.locator('#directorButton').click()
                page.locator('#directorPopover').wait_for(state='visible')
                page.screenshot(path=str(temp / 'director-popover.png'))
                page.locator('#send_textarea').focus()
                page.keyboard.press('2')
                assert page.locator('#send_textarea').input_value() == '1232'
                assert chat_count(page) == before and page.locator('dialog[open]').count() == 0
                page.locator('#chat .mes_text').last.click()
                page.locator('#directorPopover').wait_for(state='hidden')
                page.locator('#directorButton').click()
                page.keyboard.press('Escape')
                page.locator('#directorPopover').wait_for(state='hidden')
                page.locator('#send_textarea').fill('')
                result['checks']['digitsScopedTextareaSafeEscOutsideClose'] = True

                preset(page, 'narration', text='Cancelled synthetic text', cancel=True)
                assert chat_count(page) == before
                result['checks']['cancelInsertsNothing'] = True

                stage = 'manage settings footer'
                page.locator('#directorButton').click()
                page.locator('#directorPopover').get_by_text('⚙ 管理预设', exact=True).click()
                page.locator('#director_hotkey').wait_for(state='visible')
                page.wait_for_function("document.activeElement?.id === 'director_hotkey'")
                assert page.locator('#director_hotkey').input_value() == ''
                assert page.locator('#directorPopover').is_hidden()
                page.locator('#extensions-settings-button .drawer-toggle').click()
                result['checks']['manageFooterOpensSettingsDefaultHotkeyOff'] = True

                stage = 'pending input ownership'
                page.locator('#directorButton').click()
                page.locator('#directorPopover [data-preset-id="narration"]').click()
                page.locator('dialog[open] #director-input-0').fill('Stale synthetic input')
                # A real CHAT_CHANGED signal invalidates a pending dialog even
                # when a reload selects the same chat id.
                page.evaluate("async () => { const context = SillyTavern.getContext(); await context.eventSource.emit(context.eventTypes.CHAT_CHANGED,context.chatId); }")
                page.locator('dialog[open] .popup-button-ok').click()
                page.locator('dialog[open]').wait_for(state='hidden')
                assert chat_count(page) == before
                result['checks']['chatChangedCancelsPendingInput'] = True
                print('Scoped keyboard, settings footer and input cancellation passed', flush=True)

                stage = 'narrator exact equivalence'
                # /sys includes Date.now() in extra.gen_id; freeze it for byte-exact comparison.
                page.evaluate('() => { window.__directorDateNow = Date.now; Date.now = () => 1767225600000; }')
                preset(page, 'time-skip', text='一段时间', digit=1)
                page.wait_for_function("SillyTavern.getContext().chat.length === 3 && document.querySelectorAll('#chat .mes').length === 3 && document.querySelector('#chat .mes:last-child .mes_text').textContent.includes('——一段时间后——')")
                director_message = page.evaluate("""() => ({ message:structuredClone(SillyTavern.getContext().chat.at(-1)),
                    html:document.querySelector('#chat .mes:last-child .mes_text').innerHTML })""")
                page.evaluate("SillyTavern.getContext().executeSlashCommandsWithOptions('/sys ——一段时间后——')")
                page.wait_for_function("SillyTavern.getContext().chat.length === 4 && document.querySelectorAll('#chat .mes').length === 4 && document.querySelector('#chat .mes:last-child .mes_text').textContent.includes('——一段时间后——')")
                slash_message = page.evaluate("""() => ({ message:structuredClone(SillyTavern.getContext().chat.at(-1)),
                    html:document.querySelector('#chat .mes:last-child .mes_text').innerHTML })""")
                page.evaluate('() => { Date.now = window.__directorDateNow; }')
                director_extra = director_message['message']['extra'].pop('director')
                assert director_extra['preset'] == 'time-skip' and str(uuid.UUID(director_extra['id'])) == director_extra['id']
                assert normalize_message(director_message) == normalize_message(slash_message), 'Director narrator differs from actual /sys: ' + json.dumps({
                    'director':director_message, 'sys':slash_message}, ensure_ascii=False)
                result['checks']['narratorByteAndRenderedHtmlExactToSys'] = True
                print('Narrator message bytes and rendered HTML match /sys', flush=True)

                stage = 'comment and JSONL metadata'
                note = 'Director comment is private synthetic text.'
                preset(page, 'note', text=note)
                page.wait_for_function("SillyTavern.getContext().chat.length === 5 && document.querySelectorAll('#chat .mes').length === 5")
                comment = page.evaluate('structuredClone(SillyTavern.getContext().chat.at(-1))')
                assert comment['is_system'] is True and comment['extra']['director']['preset'] == 'note'
                saved = page.evaluate("""async sample => {
                    await SillyTavern.getContext().saveChat();
                    const context = SillyTavern.getContext();
                    const response = await fetch('/api/chats/get',{ method:'POST',headers:context.getRequestHeaders(),
                        body:JSON.stringify({avatar_url:sample.avatar,file_name:sample.chatName}) });
                    if (!response.ok) throw new Error('Saved JSONL read failed');
                    return response.json();
                }""", sample)
                assert saved[-1]['extra']['director'] == comment['extra']['director']
                assert saved[-3]['extra']['director'] == director_extra
                result['checks']['commentAndDirectorMetadataSaved'] = True
                print('Comment and saved Director metadata passed', flush=True)

                stage = 'instruct and generation request bodies'
                instruction = 'A synthetic lantern appears beside the river.'
                preset(page, 'direct', text=instruction)
                assert chat_count(page) == 5 and page.locator('#chat .mes').count() == 5
                result['checks']['instructAddsNoChatMessage'] = True
                page.evaluate("document.querySelector('#api_button_openai').click()")
                page.wait_for_function("[...document.querySelectorAll('.online_status_text')].some(node => node.textContent.toLowerCase().includes('valid'))", timeout=15000)
                request_url = fake_url.removesuffix('/v1') + '/__requests'

                def requests():
                    with urllib.request.urlopen(request_url, timeout=5) as response:
                        return json.load(response)

                assert not requests(), 'Presets with autoGenerate off unexpectedly generated'
                page.evaluate("SillyTavern.getContext().executeSlashCommandsWithOptions('/trigger await=true')")
                first = requests()
                assert len(first) == 1
                first_body = json.dumps(first[0], ensure_ascii=False)
                assert instruction in first_body and '——一段时间后——' in first_body and note not in first_body
                page.evaluate("SillyTavern.getContext().executeSlashCommandsWithOptions('/trigger await=true')")
                second = requests()
                assert len(second) == 2 and instruction not in json.dumps(second[1], ensure_ascii=False)
                result['checks']['promptNarratorIncludedCommentExcludedInstructOnce'] = True

                stage = 'autoGenerate opt in'
                page.evaluate("""async () => {
                    const {extension_settings} = await import('/scripts/extensions.js');
                    extension_settings.director.presets.find(preset => preset.id === 'advance').autoGenerate = true;
                }""")
                preset(page, 'advance')
                page.wait_for_function("SillyTavern.getContext().chat.length === 8 && document.querySelectorAll('#chat .mes').length === 8 && SillyTavern.getContext().chat.at(-1)?.mes === 'Synthetic Director reply.' && !document.querySelector('#mes_stop')?.getClientRects().length", timeout=30000)
                deadline = time.monotonic() + 15
                while len(requests()) < 3 and time.monotonic() < deadline:
                    page.wait_for_timeout(50)
                assert len(requests()) == 3
                result['checks']['autoGenerateOptIn'] = True

                stage = 'default chapter metadata'
                preset(page, 'chapter', text='Synthetic chapter title')
                page.wait_for_function("SillyTavern.getContext().chat.length === 9 && document.querySelectorAll('#chat .mes').length === 9")
                chapter = page.evaluate('structuredClone(SillyTavern.getContext().chat.at(-1))')
                assert chapter['mes'] == '第1章　Synthetic chapter title'
                assert chapter['extra']['director']['preset'] == 'chapter'
                assert chapter['extra']['director']['chapter'] == {'title':'Synthetic chapter title'}
                assert str(uuid.UUID(chapter['extra']['director']['id'])) == chapter['extra']['director']['id']
                assert len(requests()) == 3
                result['checks']['defaultChapterTitleAndLiveNumber'] = True
                preset(page, 'chapter', text='Synthetic next chapter')
                page.wait_for_function("SillyTavern.getContext().chat.length === 10 && document.querySelectorAll('#chat .mes').length === 10")
                next_chapter = page.evaluate('structuredClone(SillyTavern.getContext().chat.at(-1))')
                assert next_chapter['mes'] == '第2章　Synthetic next chapter'
                assert next_chapter['extra']['director']['chapter'] == {'title':'Synthetic next chapter'}
                result['checks']['nextChapterCountComputedLive'] = True

                stage = 'optional configured hotkey'
                page.locator('#directorButton').click()
                page.locator('#directorPopover').get_by_text('⚙ 管理预设', exact=True).click()
                page.locator('#director_hotkey').fill('Ctrl+Shift+D')
                page.locator('#extensions-settings-button .drawer-toggle').click()
                page.locator('#directorButton').focus()
                page.keyboard.press('Control+Shift+D')
                page.locator('#directorPopover').wait_for(state='visible')
                page.keyboard.press('Escape')
                page.locator('#directorPopover').wait_for(state='hidden')
                page.locator('#send_textarea').fill('Hotkey typing guard')
                page.keyboard.press('Control+Shift+D')
                assert page.locator('#directorPopover').is_hidden()
                assert page.locator('#send_textarea').input_value() == 'Hotkey typing guard'
                page.locator('#send_textarea').fill('')
                result['checks']['configuredHotkeyWorksAndSkipsTyping'] = True

                stage = 'custom preset manager fields and reload persistence'
                open_manager(page)
                assert page.locator('#director_presets .director_preset').count() == 8
                page.locator('#director_preset_add').click()
                custom = page.locator('#director_presets .director_preset').last
                custom_id = custom.get_attribute('data-preset-id')
                custom.locator('[data-field="icon"]').fill('🧪')
                custom.locator('[data-field="name"]').fill('Synthetic Custom Name')
                custom.locator('[data-field="mode"]').select_option('comment')
                custom.locator('[data-field="template"]').fill('Custom {{input:first|saved}} / {{input:second|second default}}')
                custom.locator('[data-field="isChapter"]').check()
                custom.locator('[data-field="autoGenerate"]').check()
                configured = presets_snapshot(page)
                assert configured[-1] == {'id':custom_id, 'icon':'🧪', 'name':'Synthetic Custom Name', 'mode':'comment',
                    'template':'Custom {{input:first|saved}} / {{input:second|second default}}',
                    'isChapter':True, 'autoGenerate':True}
                wait_presets_saved(lab['dataRoot'], configured)
                ready(page, origin)
                select_sample(page, sample, expected_messages=10)
                assert presets_snapshot(page) == configured
                open_manager(page)
                custom = page.locator(f'#director_presets .director_preset[data-preset-id="{custom_id}"]')
                assert custom.locator('[data-field="name"]').input_value() == 'Synthetic Custom Name'
                assert custom.locator('[data-field="mode"]').input_value() == 'comment'
                assert custom.locator('[data-field="isChapter"]').is_checked()
                assert custom.locator('[data-field="autoGenerate"]').is_checked()
                # Keep the remaining acceptance checks from generating extra replies.
                custom.locator('[data-field="autoGenerate"]').uncheck()
                result['checks']['customPresetAllFieldsPersistAcrossReload'] = True

                stage = 'keyboard reorder updates digit mapping'
                for _ in range(8):
                    custom.locator('[data-action="up"]').focus()
                    page.keyboard.press('Enter')
                assert presets_snapshot(page)[0]['id'] == custom_id
                custom.locator('[data-action="down"]').focus()
                page.keyboard.press('Enter')
                assert presets_snapshot(page)[1]['id'] == custom_id
                custom.locator('[data-action="up"]').focus()
                page.keyboard.press('Enter')
                stage = 'drag reorder saves order'
                custom.locator('.drag-handle').evaluate("node => node.scrollIntoView({ block:'start' })")
                source = custom.locator('.drag-handle').bounding_box()
                target = page.locator('#director_presets .director_preset').nth(1).bounding_box()
                page.mouse.move(source['x'] + source['width'] / 2, source['y'] + source['height'] / 2)
                page.mouse.down()
                page.wait_for_timeout(page.evaluate("$('#director_presets').sortable('option', 'delay')") + 50)
                page.mouse.move(target['x'] + target['width'] / 2, target['y'] + target['height'] * .7, steps=20)
                page.mouse.up()
                assert presets_snapshot(page)[1]['id'] == custom_id
                custom.locator('[data-action="up"]').click()
                assert presets_snapshot(page)[0]['id'] == custom_id
                result['checks']['dragReorderUpdatesStoredOrder'] = True
                page.locator('#extensions-settings-button .drawer-toggle').click()
                page.locator('#directorButton').click()
                first_item = page.locator('#directorPopover > button').first
                assert first_item.get_attribute('data-preset-id') == custom_id
                assert first_item.locator('kbd').inner_text() == '1'
                page.keyboard.press('1')
                dialog = page.locator('dialog[open]')
                dialog.locator('#director-input-0').fill('Keyboard reorder proof')
                # The message is visible before the command finishes saving. Wait for
                # that save so the next /director call is not ignored as in-flight.
                with page.expect_response(lambda response: '/api/chats/save' in response.url and response.status == 200) as saved:
                    dialog.locator('.popup-button-ok').click()
                dialog.wait_for(state='hidden')
                saved.value.body()
                page.wait_for_function("SillyTavern.getContext().chat.at(-1)?.mes === 'Custom Keyboard reorder proof / second default'")
                page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                assert chat_count(page) == 11
                result['checks']['keyboardReorderUpdatesDigitMapping'] = True

                stage = 'slash quoted names literal input remaining defaults'
                slash_result = page.evaluate("SillyTavern.getContext().executeSlashCommandsWithOptions('/director \"Synthetic Custom Name\" literal=stuff')")
                assert slash_result['pipe'] == ''
                assert page.locator('dialog[open]').count() == 0
                quoted_message = page.evaluate('SillyTavern.getContext().chat.at(-1).mes')
                assert quoted_message == 'Custom literal=stuff / second default', quoted_message
                assert chat_count(page) == 12
                result['checks']['slashQuotedNameLiteralInputRemainingDefaultsEmptyPipe'] = True

                stage = 'slash remaining required input and cancellation'
                open_manager(page)
                custom.locator('[data-field="template"]').fill('Custom {{input:first|saved}} / {{input:second|second default}} / {{input:remaining}}')
                page.locator('#extensions-settings-button .drawer-toggle').click()
                for cancel in (True, False):
                    page.evaluate("() => { window.__directorSlash = SillyTavern.getContext().executeSlashCommandsWithOptions('/director 1 supplied'); }")
                    dialog = page.locator('dialog[open]')
                    dialog.locator('#director-input-0').wait_for(state='visible')
                    assert dialog.locator('input[id^="director-input-"]').count() == 1
                    assert 'remaining' in dialog.inner_text()
                    dialog.locator('#director-input-0').fill('still needed')
                    dialog.locator('.popup-button-cancel' if cancel else '.popup-button-ok').click()
                    dialog.wait_for(state='hidden')
                    assert page.evaluate('window.__directorSlash')['pipe'] == ''
                    assert chat_count(page) == (12 if cancel else 13)
                assert page.evaluate('SillyTavern.getContext().chat.at(-1).mes') == 'Custom supplied / second default / still needed'
                result['checks']['slashPromptsOnlyRemainingRequiredInputsAndCancelIsAtomic'] = True

                stage = 'export and invalid import atomicity'
                open_manager(page)
                exported_presets = presets_snapshot(page)
                with page.expect_download() as download_event:
                    page.locator('#director_export').click()
                exported_path = temp / 'director-presets.json'
                download_event.value.save_as(str(exported_path))
                exported = json.loads(exported_path.read_text(encoding='utf-8'))
                assert exported == {'version':1, 'presets':exported_presets}
                page.evaluate('toastr.clear()')
                invalid = {'version':1, 'presets':[exported_presets[1], {**exported_presets[0], 'template':42}]}
                page.locator('#director_import_file').set_input_files({'name':'invalid-director.json',
                    'mimeType':'application/json', 'buffer':json.dumps(invalid, ensure_ascii=False).encode()})
                page.locator('.toast-error').wait_for(state='visible')
                assert presets_snapshot(page) == exported_presets
                assert page.locator('#director_presets .director_preset').count() == 9
                page.evaluate('toastr.clear()')
                result['checks']['exportVersionedJsonAndInvalidImportAtomicError'] = True

                stage = 'delete and valid import round trip'
                custom.locator('[data-action="delete"]').click()
                assert page.locator('#director_presets .director_preset').count() == 8
                page.locator('#director_import_file').set_input_files(str(exported_path))
                imported = wait_presets(page, exported_presets)
                assert [entry['id'] for entry in imported] == [entry['id'] for entry in exported_presets]
                assert imported == exported_presets
                assert page.locator('#director_presets .director_preset').count() == 9
                result['checks']['deleteAndValidImportRoundTrip'] = True

                stage = 'restore defaults requires confirmation'
                page.locator('#director_restore_defaults').click()
                dialog = page.locator('dialog[open]')
                dialog.locator('.popup-button-cancel').click()
                dialog.wait_for(state='hidden')
                assert presets_snapshot(page) == exported_presets
                page.locator('#director_restore_defaults').click()
                dialog.locator('.popup-button-ok').click()
                dialog.wait_for(state='hidden')
                restored = presets_snapshot(page)
                assert [entry['id'] for entry in restored] == ['time-skip','scene','narration','chapter','event','direct','advance','note']
                assert all(not entry['autoGenerate'] for entry in restored)
                assert page.locator('#director_presets .director_preset').count() == 8
                wait_presets_saved(lab['dataRoot'], restored)
                ready(page, origin)
                select_sample(page, sample, expected_messages=13)
                assert presets_snapshot(page) == restored
                result['checks']['restoreDefaultsCancelAcceptAndReload'] = True

                stage = 'slash index example inserts exact narrator'
                slash_result = page.evaluate("SillyTavern.getContext().executeSlashCommandsWithOptions('/director 1 三天')")
                assert slash_result['pipe'] == ''
                inserted = page.evaluate('structuredClone(SillyTavern.getContext().chat.at(-1))')
                assert inserted['mes'] == '——三天后——'
                assert inserted['extra']['type'] == 'narrator' and inserted['extra']['director']['preset'] == 'time-skip'
                assert page.locator('#chat .mes:last-child .mes_text').inner_text() == '——三天后——'
                assert page.locator('dialog[open]').count() == 0
                assert chat_count(page) == 14 and len(requests()) == 3
                result['checks']['slashDirectorIndexTextExactNarrator'] = True

                stage = 'actual Quick Reply execution'
                quick_reply_pipe = page.evaluate("""async () => {
                    const { QuickReplySet } = await import('/scripts/extensions/quick-reply/src/QuickReplySet.js');
                    const { QuickReply } = await import('/scripts/extensions/quick-reply/src/QuickReply.js');
                    const set = QuickReplySet.from({ name:'Synthetic Director acceptance' });
                    const reply = QuickReply.from({ id:1, label:'Director synthetic', message:'/director 1 五天' });
                    set.hookQuickReply(reply);
                    return reply.execute();
                }""")
                assert quick_reply_pipe == ''
                assert page.evaluate('SillyTavern.getContext().chat.at(-1).mes') == '——五天后——'
                assert chat_count(page) == 15 and len(requests()) == 3
                result['checks']['actualQuickReplyExecutionExactNarrator'] = True
                print('D2 manager persistence, reorder, import/export, restore and slash command passed', flush=True)
                assert not errors, errors
                result.update({'pageErrors':errors, 'generationRequests':len(requests()), 'chromium':browser.version})
                source_paths = sorted((ROOT / 'public' / 'scripts' / 'extensions' / 'director').glob('*')) + [pathlib.Path(__file__)]
                result['sourceSha256'] = {source.relative_to(ROOT).as_posix():hashlib.sha256(source.read_bytes()).hexdigest()
                    for source in source_paths if source.is_file()}
                result['fakeEndpointSha256'] = hashlib.sha256(provider.read_bytes()).hexdigest()
                result['node'] = subprocess.check_output([node, '--version'], text=True).strip()
                browser.close()
        return result
    except Exception as error:
        tail = log_path.read_text(encoding='utf-8', errors='replace')[-4000:] if log_path.exists() else ''
        raise AssertionError(json.dumps(redact({'stage':stage, 'error':str(error), 'serverLogTail':tail}, temporary), ensure_ascii=False)) from error
    finally:
        stop(server)
        stop(fake)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    preferred_node = pathlib.Path('/tmp/node-v24.22.1-linux-x64/bin/node')
    parser.add_argument('--node', default=str(preferred_node) if preferred_node.is_file() else 'node')
    parser.add_argument('--fake-endpoint', default=str(ROOT / 'scripts' / 'fake-openai-endpoint.mjs'))
    parser.add_argument('--base', default='ffd5f4e')
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / '.evidence' / 'director-d2' / 'results.json')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='director-lab-') as temporary:
        result = redact(run(args, temporary), temporary)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
