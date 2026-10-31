"""Director acceptance on a temporary, isolated lab.

This is the director browser suite. tests/browser-lifecycle-lab.py --director
runs this same file. The default lifecycle command is unchanged.

Run with a Python environment containing Playwright. The S0 provider is
scripts/fake-openai-endpoint.mjs. Only summary hashes are retained. Data, logs,
base assets and Chromium state live in a temporary directory, and every process
this script stops is its own child.
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
            text = text.replace(json.dumps(source, ensure_ascii=False)[1:-1], replacement)
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


def ready(page, origin, query=''):
    page.goto(origin + query, wait_until='domcontentloaded', timeout=60000)
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


CHAPTER_SNAPSHOT = """() => {
    const chat = SillyTavern.getContext().chat;
    const chapters = [];
    let number = 0;
    for (let index = 0; index < chat.length; index++) {
        const director = chat[index]?.extra?.director;
        const title = director?.chapter?.title;
        if (typeof title !== 'string') continue;
        number += 1;
        const mes = document.querySelector('#chat .mes[mesid="' + index + '"]');
        const text = mes?.querySelector('.mes_text');
        chapters.push({
            index, number, title,
            divider: mes?.querySelector('.mes_block > .director-chapter-divider')?.textContent ?? null,
            insideText: !!text?.querySelector('.director-chapter-divider'),
            hasClass: !!mes?.classList.contains('director-chapter'),
            text: text?.textContent ?? null,
            html: text?.innerHTML ?? null,
            storedKeys: director ? Object.keys(director).sort() : [],
            chapterKeys: director?.chapter ? Object.keys(director.chapter).sort() : [],
        });
    }
    return chapters;
}"""


def chapter_snapshot(page):
    chapters = page.evaluate(CHAPTER_SNAPSHOT)
    for chapter in chapters:
        assert chapter['divider'] == f"第{chapter['number']}章 {chapter['title']}", chapter
        assert chapter['insideText'] is False
        assert chapter['hasClass'] is True
        assert 'number' not in chapter['storedKeys']
        assert chapter['chapterKeys'] == ['title']
    return chapters


def open_chapter_menu(page, mesid):
    row = page.locator(f'#chat .mes[mesid="{mesid}"]')
    row.scroll_into_view_if_needed()
    button = row.locator('.mes_director_chapter')
    if not button.is_visible():
        row.locator('.extraMesButtonsHint').click()
        button.wait_for(state='visible')
    return row, button


def swipe_message(page, mesid, swipe_id):
    page.evaluate("""async ({mesid, swipeId}) => {
        const main = await import('/script.js');
        const { SWIPE_DIRECTION, SWIPE_SOURCE } = await import('/scripts/constants.js');
        await main.swipe(null, SWIPE_DIRECTION.RIGHT, { source:SWIPE_SOURCE.SLASH_COMMAND,
            forceMesId:mesid, forceSwipeId:swipeId, forceDuration:0 });
    }""", {'mesid': mesid, 'swipeId': swipe_id})


def assert_chapter_swipes(page, mesid, count, director, label=None):
    message = page.evaluate('id => structuredClone(SillyTavern.getContext().chat[id])', mesid)
    assert len(message['swipes']) == len(message['swipe_info']) == count
    for info in message['swipe_info']:
        if director is None:
            assert 'director' not in info['extra'], info
        else:
            assert info['extra']['director'] == director, info
    for swipe_id in reversed(range(count)):
        swipe_message(page, mesid, swipe_id)
        page.wait_for_function("""({mesid, swipeId, director, label}) => {
            const message = SillyTavern.getContext().chat[mesid];
            const row = document.querySelector('#chat .mes[mesid="' + mesid + '"]');
            const divider = row?.querySelector('.mes_block > .director-chapter-divider');
            return message.swipe_id === swipeId && (director ?
                JSON.stringify(message.extra.director) === JSON.stringify(director) &&
                    row.classList.contains('director-chapter') && divider?.textContent === label :
                !Object.hasOwn(message.extra, 'director') && !row.classList.contains('director-chapter') && !divider);
        }""", arg={'mesid': mesid, 'swipeId': swipe_id, 'director': director, 'label': label})


def connect_api(page):
    page.evaluate("document.querySelector('#api_button_openai').click()")
    page.wait_for_function("[...document.querySelectorAll('.online_status_text')].some(node => node.textContent.toLowerCase().includes('valid'))", timeout=15000)


def wait_director_idle(page):
    # usePreset ignores a new click until its command (and optional /trigger) finishes.
    page.wait_for_function("() => !document.querySelector('#directorButton')?.hasAttribute('data-director-busy')")


def open_manager(page):
    wait_director_idle(page)
    page.locator('#directorButton').click()
    page.locator('#directorPopover').wait_for(state='visible')
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


def is_saved_chat(response):
    path = urllib.parse.urlparse(response.url).path
    return response.status == 200 and path in {'/api/chats/save', '/api/chats/group/save'}


def preset(page, preset_id, text=None, cancel=False, digit=None):
    saves_chat = not cancel and preset_id in {'time-skip', 'scene', 'narration', 'chapter', 'event', 'note'}
    save = page.expect_response(is_saved_chat) if saves_chat else contextlib.nullcontext()
    wait_director_idle(page)
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
    # The save response arrives before usePreset releases its guard.
    wait_director_idle(page)


def run(args, temporary):
    provider = pathlib.Path(args.fake_endpoint).resolve()
    if not provider.is_file():
        raise AssertionError('S0 provider missing; supply --fake-endpoint with its module path')
    temp = pathlib.Path(temporary)
    node = args.node
    fake = server = None
    log_path = temp / 'server.log'
    result = {'base': args.base, 'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'checks': {}}
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
                # Intentional tab-order change: only the extra 🎬 #directorButton.
                # The chapter menu item lives in the hidden per-message … menu and
                # is not a left-row tab stop.
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
                connect_api(page)
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
                wait_director_idle(page)
                page.locator('#directorButton').click()
                page.locator('#directorPopover').wait_for(state='visible')
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

                stage = 'digit one with popover closed'
                page.locator('#send_textarea').fill('')
                assert page.locator('#directorPopover').is_hidden()
                page.locator('#send_textarea').press('1')
                assert page.locator('#send_textarea').input_value() == '1'
                assert chat_count(page) == 15 and page.locator('dialog[open]').count() == 0
                assert page.locator('#directorPopover').is_hidden()
                page.locator('#send_textarea').fill('')
                result['checks']['digitOneInsertsOnlyWhenPopoverClosed'] = True

                stage = 'chapter dividers outside message text'
                existing = chapter_snapshot(page)
                assert len(existing) >= 3, existing
                assert all('第' not in chapter['divider'] or chapter['divider'].startswith('第') for chapter in existing)
                assert any(chapter['text'] != chapter['divider'] for chapter in existing)
                result['checks']['chapterDividersUseLiveNumbersOutsideMesText'] = True

                stage = 'mark and unmark an arbitrary message'
                page.evaluate("""() => {
                    const message = SillyTavern.getContext().chat[0];
                    message.swipe_id = 0;
                    message.swipes = [message.mes, 'Synthetic alternate greeting'];
                    message.swipe_info = message.swipes.map((_, index) => ({ send_date:message.send_date,
                        extra:{ ...structuredClone(message.extra), swipeSentinel:index } }));
                }""")
                target = page.locator('#chat .mes[mesid="0"]')
                html_before = target.locator('.mes_text').inner_html()
                assert page.evaluate("() => !SillyTavern.getContext().chat[0]?.extra?.director?.chapter")
                row, menu_button = open_chapter_menu(page, 0)
                menu_button.click()
                dialog = page.locator('dialog[open]')
                dialog.locator('textarea').wait_for(state='visible')
                assert dialog.locator('textarea').input_value() == 'Synthetic greeting'
                dialog.locator('textarea').fill('手动章节')
                with page.expect_response(is_saved_chat) as marked_save:
                    dialog.locator('.popup-button-ok').click()
                dialog.wait_for(state='hidden')
                marked_save.value.finished()
                page.wait_for_function("""() => document.querySelector('#chat .mes[mesid="0"] .director-chapter-divider')?.textContent === '第1章 手动章节'""")
                assert target.locator('.mes_text').inner_html() == html_before
                assert target.locator('.mes_text .director-chapter-divider').count() == 0
                marked = chapter_snapshot(page)
                assert marked[0]['title'] == '手动章节' and marked[0]['index'] == 0
                assert [chapter['title'] for chapter in marked[1:]] == [chapter['title'] for chapter in existing]
                assert [chapter['number'] for chapter in marked[1:]] == [chapter['number'] + 1 for chapter in existing]
                stored = page.evaluate("""async (sample) => {
                    const context = SillyTavern.getContext();
                    const response = await fetch('/api/chats/get', { method:'POST', headers:context.getRequestHeaders(),
                        body:JSON.stringify({ avatar_url:sample.avatar, file_name:sample.chatName }) });
                    if (!response.ok) throw new Error('chapter JSONL read failed');
                    const rows = await response.json();
                    return rows[1].extra.director;
                }""", sample)
                assert stored['preset'] == 'chapter' and stored['chapter'] == {'title': '手动章节'}
                assert set(stored) == {'id', 'preset', 'chapter'}
                assert str(uuid.UUID(stored['id'])) == stored['id']
                stage = 'chapter survives swiping away, back and disk reload'
                for swipe_id in [1, 0]:
                    swipe_message(page, 0, swipe_id)
                    page.wait_for_function("""swipeId => SillyTavern.getContext().chat[0].swipe_id === swipeId &&
                        document.querySelector('#chat .mes[mesid="0"] .director-chapter-divider')?.textContent === '第1章 手动章节'""", arg=swipe_id)
                page.evaluate("""async () => {
                    const context = SillyTavern.getContext();
                    await context.saveChat();
                    await context.reloadCurrentChat();
                }""")
                page.wait_for_function("""() => document.querySelector('#chat .mes[mesid="0"] .director-chapter-divider')?.textContent === '第1章 手动章节'""")
                swipe_directors = page.evaluate("""() => SillyTavern.getContext().chat[0].swipe_info.map(info => info.extra.director)""")
                assert swipe_directors == [stored, stored]
                result['checks']['chapterSurvivesSwipeAwayBackAndDiskReload'] = True
                row, menu_button = open_chapter_menu(page, 0)
                with page.expect_response(is_saved_chat) as unmarked_save:
                    menu_button.click()
                unmarked_save.value.finished()
                page.wait_for_function("""() => !document.querySelector('#chat .mes[mesid="0"]').classList.contains('director-chapter')""")
                assert page.evaluate("() => SillyTavern.getContext().chat[0].extra.director") is None
                assert page.evaluate("() => SillyTavern.getContext().chat[0].swipe_info.every(info => !info.extra.director)")
                assert target.locator('.mes_text').inner_html() == html_before
                assert chapter_snapshot(page) == existing
                result['checks']['markUnmarkArbitraryMessagePersistsWithoutNumber'] = True

                stage = 'unmarked existing swipes stay clear after disk reload'
                page.evaluate('async () => { await SillyTavern.getContext().reloadCurrentChat(); }')
                assert_chapter_swipes(page, 0, 2, None)
                assert target.locator('.mes_text').inner_html() == html_before
                assert chapter_snapshot(page) == existing
                result['checks']['unmarkClearsExistingSwipesAfterDiskReload'] = True

                stage = 'generate a new swipe after marking a chapter'
                connect_api(page)
                before_generation = chat_count(page)
                page.evaluate("async () => { await SillyTavern.getContext().generate('normal'); }")
                mesid = before_generation
                assert chat_count(page) == before_generation + 1
                message = page.evaluate('id => structuredClone(SillyTavern.getContext().chat[id])', mesid)
                assert not message['is_user'] and not message.get('is_system')
                assert not message['extra'].get('director')
                swipe_count = len(message['swipes'])
                assert swipe_count == 1
                row, menu_button = open_chapter_menu(page, mesid)
                menu_button.click()
                dialog = page.locator('dialog[open]')
                dialog.locator('textarea').fill('新 swipe 章节')
                with page.expect_response(is_saved_chat) as marked_save:
                    dialog.locator('.popup-button-ok').click()
                dialog.wait_for(state='hidden')
                marked_save.value.finished()
                director = page.evaluate('id => structuredClone(SillyTavern.getContext().chat[id].extra.director)', mesid)
                label = f"第{len(existing) + 1}章 新 swipe 章节"
                assert_chapter_swipes(page, mesid, swipe_count, director, label)
                request_baseline = len(requests())
                # The out-of-range target enters swipe()'s regenerate branch and
                # saveReply(type='swipe'); no new swipe is seeded by the fixture.
                swipe_message(page, mesid, swipe_count)
                assert len(requests()) == request_baseline + 1
                assert chat_count(page) == before_generation + 1
                assert page.evaluate('id => SillyTavern.getContext().chat[id].swipe_id', mesid) == swipe_count
                assert row.locator('.mes_block > .director-chapter-divider').text_content() == label
                assert_chapter_swipes(page, mesid, swipe_count + 1, director, label)
                page.evaluate("""async () => {
                    const context = SillyTavern.getContext();
                    await context.saveChat();
                    await context.reloadCurrentChat();
                }""")
                assert_chapter_swipes(page, mesid, swipe_count + 1, director, label)
                result['checks']['chapterSurvivesNewSwipeGenerationAndDiskReload'] = {
                    'swipesBeforeMark': swipe_count, 'newSwipeId': swipe_count,
                    'checkedSwipeIdsAfterReload': list(range(swipe_count + 1)),
                }

                stage = 'unmark clears generated and original swipes after disk reload'
                row, menu_button = open_chapter_menu(page, mesid)
                with page.expect_response(is_saved_chat) as unmarked_save:
                    menu_button.click()
                unmarked_save.value.finished()
                assert_chapter_swipes(page, mesid, swipe_count + 1, None)
                page.evaluate('async () => { await SillyTavern.getContext().reloadCurrentChat(); }')
                assert_chapter_swipes(page, mesid, swipe_count + 1, None)
                assert chapter_snapshot(page) == existing
                result['checks']['unmarkClearsGeneratedAndOriginalSwipesAfterDiskReload'] = True
                print('Chapter survives a newly generated swipe; unmark stays clear on every swipe after disk reload', flush=True)

                stage = 'delete middle chapter renumbers'
                before_delete = chapter_snapshot(page)
                middle = before_delete[len(before_delete) // 2]
                following = next(chapter for chapter in before_delete if chapter['number'] == middle['number'] + 1)
                page.locator('#send_textarea').click()
                victim = page.locator(f"#chat .mes[mesid='{middle['index']}']")
                victim.scroll_into_view_if_needed()
                victim.hover()
                victim.locator('.mes_edit').click()
                victim.locator('.mes_edit_delete').click()
                page.locator('dialog[open]').get_by_text('Delete Message', exact=True).click()
                page.wait_for_function("""({removed, title, label}) => {
                    const chat = SillyTavern.getContext().chat;
                    if (chat.some(message => message?.extra?.director?.chapter?.title === removed)) return false;
                    const index = chat.findIndex(message => message?.extra?.director?.chapter?.title === title);
                    return document.querySelector('#chat .mes[mesid="' + index + '"] .director-chapter-divider')?.textContent === label;
                }""", arg={'removed': middle['title'], 'title': following['title'], 'label': f"第{following['number'] - 1}章 {following['title']}"})
                after_delete = chapter_snapshot(page)
                assert [chapter['title'] for chapter in after_delete] == [chapter['title'] for chapter in before_delete if chapter['title'] != middle['title']]
                assert [chapter['number'] for chapter in after_delete] == list(range(1, len(after_delete) + 1))
                renumbered = next(chapter for chapter in after_delete if chapter['title'] == following['title'])
                assert renumbered['number'] == following['number'] - 1
                assert renumbered['text'] == following['text']
                result['checks']['deleteMiddleChapterRecomputesNumbers'] = True
                print('Chapter mark, unmark and live renumber passed', flush=True)

                stage = 'chapter list jumps through a 2000 message chat'
                page.set_default_timeout(180000)
                long_chat = page.evaluate("""async (sample) => {
                    const main = await import('/script.js');
                    const deadline = Date.now() + 15000;
                    while (main.isChatSaving && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
                    const token = (await (await fetch('/csrf-token')).json()).token;
                    const post = async (url, body) => {
                        const response = await fetch(url, { method:'POST', headers:{ 'X-CSRF-Token':token, 'Content-Type':'application/json' }, body:JSON.stringify(body) });
                        if (!response.ok) throw new Error(url + ' ' + response.status + ' ' + await response.text());
                        return response.json();
                    };
                    const file = 'DirectorLong-' + sample.suffix;
                    const titles = { 0:'开端', 1000:'中段', 1990:'近尾' };
                    const rows = [{ user_name:'Synthetic Tester', character_name:'Director Synthetic', chat_metadata:{ integrity:'director-long-' + sample.suffix } }];
                    for (let i = 0; i < 2000; i++) {
                        const extra = {};
                        if (titles[i]) extra.director = { id:crypto.randomUUID(), preset:'chapter', chapter:{ title:titles[i] } };
                        rows.push({ name:i % 2 ? 'Director Synthetic' : 'Synthetic Tester', is_user:i % 2 === 0, is_system:false,
                            send_date:'2026-01-01T00:00:00.000Z', mes:'Synthetic long ' + i, extra });
                    }
                    await post('/api/chats/save', { avatar_url:sample.avatar, file_name:file, chat:rows });
                    const opened = await SillyTavern.getContext().openCharacterChat(file);
                    if (opened === false) throw new Error('2000 message chat did not open');
                    return file;
                }""", {**sample, 'suffix': uuid.uuid4().hex[:10]})
                page.wait_for_function("""() => SillyTavern.getContext().chat.length === 2000 && document.querySelectorAll('#chat .mes').length === 100 && !!document.querySelector('#show_more_messages')""", timeout=60000)
                tail = page.locator('#chat .mes[mesid="1990"] .director-chapter-divider')
                tail.wait_for(state='visible')
                assert tail.inner_text() == '第3章 近尾'
                assert page.locator('#chat .mes[mesid="1990"] .mes_text').inner_text() == 'Synthetic long 1990'
                assert page.locator('#chat .mes[mesid="1990"] .mes_text .director-chapter-divider').count() == 0
                assert page.locator('#chat .mes[mesid="0"]').count() == 0
                page.locator('#directorButton').click()
                page.locator('#directorPopover').get_by_text('📖 章节', exact=True).click()
                assert page.locator('#directorPopover .director_chapter_jump').count() == 3
                page.locator('#directorPopover .director_chapter_jump', has_text='第3章 近尾').click()
                page.wait_for_function("""() => {
                    const mes = document.querySelector('#chat .mes[mesid="1990"]');
                    if (!mes?.classList.contains('director-chapter-highlight')) return false;
                    const rect = mes.getBoundingClientRect();
                    return rect.bottom > 0 && rect.top < innerHeight && !document.querySelector('dialog[open]');
                }""")
                first_loaded = page.evaluate("""() => Number(document.querySelector('#chat .mes').getAttribute('mesid'))""")
                distance = first_loaded - 0
                assert distance > 500, distance
                page.locator('#directorButton').click()
                page.locator('#directorPopover').get_by_text('📖 章节', exact=True).click()
                page.locator('#directorPopover .director_chapter_jump', has_text='第1章 开端').click()
                dialog = page.locator('dialog[open]')
                dialog.get_by_text(f'需要加载约 {distance} 条消息', exact=True).wait_for()
                dialog.get_by_text('取消', exact=True).click()
                dialog.wait_for(state='hidden')
                assert page.locator('#chat .mes[mesid="0"]').count() == 0
                page.locator('#directorButton').click()
                page.locator('#directorPopover').get_by_text('📖 章节', exact=True).click()
                page.locator('#directorPopover .director_chapter_jump', has_text='第1章 开端').click()
                dialog.get_by_text('加载', exact=True).click()
                page.wait_for_function("""() => {
                    const mes = document.querySelector('#chat .mes[mesid="0"]');
                    if (!mes?.classList.contains('director-chapter-highlight')) return false;
                    const rect = mes.getBoundingClientRect();
                    const divider = mes.querySelector('.mes_block > .director-chapter-divider');
                    return rect.bottom > 0 && rect.top < innerHeight && divider?.textContent === '第1章 开端'
                        && mes.querySelector('.mes_text')?.textContent === 'Synthetic long 0'
                        && !mes.querySelector('.mes_text .director-chapter-divider')
                        && !document.querySelector('#show_more_messages');
                }""", timeout=180000)
                loaded = chapter_snapshot(page)
                assert [chapter['title'] for chapter in loaded] == ['开端', '中段', '近尾']
                assert loaded[1]['divider'] == '第2章 中段'
                assert page.evaluate("""() => SillyTavern.getContext().chat.every(message => {
                    const director = message?.extra?.director;
                    if (!director) return true;
                    return !Object.hasOwn(director, 'number') && !Object.hasOwn(director.chapter || {}, 'number');
                })""")
                result['checks']['chapterListJumpsAcrossTwoThousandMessages'] = True
                result['longChat'] = {'file': long_chat, 'loadedBeforeJump': 100, 'confirmDistance': distance}
                print('Chapter list loaded and jumped to chapter 1', flush=True)

                stage = 'group chat narrator comment and instruct'
                # Restoring presets reloads the page, and auto-connect is off.
                connect_api(page)
                request_baseline = len(requests())
                page.evaluate("""async (sample) => {
                    const main = await import('/script.js');
                    const deadline = Date.now() + 15000;
                    while (main.isChatSaving && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
                    const token = (await (await fetch('/csrf-token')).json()).token;
                    const post = async (url, body) => {
                        const response = await fetch(url, { method:'POST', headers:{ 'X-CSRF-Token':token, 'Content-Type':'application/json' }, body:JSON.stringify(body) });
                        const data = await response.json().catch(() => ({}));
                        if (!response.ok) throw new Error(url + ' ' + response.status + ' ' + JSON.stringify(data));
                        return data;
                    };
                    const chatId = 'DirectorGroup-' + sample.suffix;
                    const group = await post('/api/groups/create', { name:'Synthetic Director Group', members:[sample.avatar],
                        chat_id:chatId, chats:[chatId], activation_strategy:1, generation_mode:0 });
                    await post('/api/chats/group/save', { id:chatId, chat:[
                        { user_name:'Synthetic Tester', character_name:'Group', chat_metadata:{ integrity:'director-group-' + sample.suffix } },
                        { name:'Synthetic Tester', is_user:true, is_system:false, send_date:'2026-01-01T00:00:00.000Z', mes:'Group synthetic start', extra:{} },
                    ] });
                    const groupModule = await import('/scripts/group-chats.js');
                    await groupModule.getGroups();
                    if (!await groupModule.openGroupById(group.id)) throw new Error('Synthetic group did not open');
                }""", {**sample, 'suffix': uuid.uuid4().hex[:10]})
                page.wait_for_function("""() => !!SillyTavern.getContext().groupId && SillyTavern.getContext().chat.length === 1 && document.querySelectorAll('#chat .mes').length === 1""", timeout=60000)
                preset(page, 'time-skip', text='群聊片刻')
                page.wait_for_function("""() => SillyTavern.getContext().chat.at(-1)?.mes === '——群聊片刻后——'""")
                narrator = page.evaluate("""() => {
                    const message = SillyTavern.getContext().chat.at(-1);
                    return {
                        type: message?.extra?.type ?? null,
                        preset: message?.extra?.director?.preset ?? null,
                        text: message?.mes ?? null,
                        system: message?.is_system ?? null,
                        director: message?.extra?.director ?? null,
                        extraKeys: message?.extra ? Object.keys(message.extra) : [],
                    };
                }""")
                # /sys stores is_system as '' when extractMessageBias finds no {{bias}}.
                # The empty string is falsy, so the narrator stays in the prompt like /sys.
                assert narrator['text'] == '——群聊片刻后——', narrator
                assert narrator['type'] == 'narrator', narrator
                assert narrator['preset'] == 'time-skip', narrator
                assert narrator['system'] == '', narrator
                assert narrator['director'].get('chapter') is None, narrator
                preset(page, 'note', text='群聊备注不进模型')
                page.wait_for_function("""() => SillyTavern.getContext().chat.at(-1)?.mes === '群聊备注不进模型' && SillyTavern.getContext().chat.at(-1)?.is_system === true""")
                comment_preset = page.evaluate("""() => SillyTavern.getContext().chat.at(-1).extra.director.preset""")
                assert comment_preset == 'note'
                before_instruct = chat_count(page)
                preset(page, 'direct', text='群聊只出现一次的指令')
                assert chat_count(page) == before_instruct
                page.evaluate("""() => SillyTavern.getContext().executeSlashCommandsWithOptions('/trigger await=true')""")
                page.wait_for_function("""() => SillyTavern.getContext().chat.at(-1)?.mes === 'Synthetic Director reply.'""", timeout=30000)
                deadline = time.monotonic() + 15
                while len(requests()) < request_baseline + 1 and time.monotonic() < deadline:
                    page.wait_for_timeout(50)
                first_group = requests()[request_baseline:]
                assert len(first_group) == 1, len(requests())
                first_body = json.dumps(first_group[0], ensure_ascii=False)
                assert '——群聊片刻后——' in first_body and '群聊备注不进模型' not in first_body and '群聊只出现一次的指令' in first_body
                page.evaluate("""() => SillyTavern.getContext().executeSlashCommandsWithOptions('/trigger await=true')""")
                page.wait_for_function("""() => SillyTavern.getContext().chat.filter(message => message.mes === 'Synthetic Director reply.').length === 2""", timeout=30000)
                deadline = time.monotonic() + 15
                while len(requests()) < request_baseline + 2 and time.monotonic() < deadline:
                    page.wait_for_timeout(50)
                second_group = requests()[request_baseline:]
                assert len(second_group) == 2
                second_body = json.dumps(second_group[1], ensure_ascii=False)
                assert '群聊只出现一次的指令' not in second_body and '——群聊片刻后——' in second_body
                result['checks']['groupNarratorCommentAndInstruct'] = True
                print('Group narrator, comment and one-shot instruct passed', flush=True)

                stage = 'Director instruct API failure and successful retry'
                page.evaluate("""async sample => {
                    const context = SillyTavern.getContext();
                    const index = context.characters.findIndex(card => card.avatar === sample.avatar);
                    await context.selectCharacterById(String(index));
                    await SillyTavern.getContext().openCharacterChat(sample.chatName);
                }""", sample)

                def configure_provider(options):
                    request = urllib.request.Request(fake_url.removesuffix('/v1') + '/__configure',
                        data=json.dumps(options).encode(), headers={'Content-Type': 'application/json'}, method='POST')
                    with urllib.request.urlopen(request, timeout=10) as response:
                        assert json.load(response)['configured']

                def generate():
                    return page.evaluate("""async () => {
                        try { await SillyTavern.getContext().generate('normal'); return { failed:false }; }
                        catch { return { failed:true }; }
                    }""")

                failed_instruction = 'Keep the synthetic failure instruction for retry.'
                preset(page, 'direct', text=failed_instruction)
                baseline = len(requests())
                configure_provider({'nextStatus': 500})
                failed = generate()
                assert failed['failed'], failed
                assert failed_instruction in json.dumps(requests()[baseline], ensure_ascii=False)
                assert page.evaluate("""text => Object.values(SillyTavern.getContext().chatMetadata.script_injects || {}).some(inject => inject.value.includes(text))""", failed_instruction)
                generate()
                assert failed_instruction in json.dumps(requests()[baseline + 1], ensure_ascii=False)
                page.evaluate("""async () => { await SillyTavern.getContext().reloadCurrentChat(); }""")
                assert not page.evaluate("""text => Object.values(SillyTavern.getContext().chatMetadata.script_injects || {}).some(inject => inject.value.includes(text))""", failed_instruction)
                generate()
                assert failed_instruction not in json.dumps(requests()[baseline + 2], ensure_ascii=False)
                result['checks']['instructSurvivesApi500ThenConsumedOnSuccessfulRetryAndDiskReload'] = True

                stage = 'Director instruct user stop and successful retry'
                stopped_instruction = 'Keep the synthetic stopped instruction for retry.'
                preset(page, 'direct', text=stopped_instruction)
                baseline = len(requests())
                configure_provider({'tokens': 500, 'rate': 25, 'jitter': 0})
                page.evaluate("""async () => {
                    (await import('/scripts/openai.js')).oai_settings.stream_openai = true;
                    window.__directorPendingGeneration = SillyTavern.getContext().generate('normal').catch(() => null);
                }""")
                page.wait_for_function("""() => {
                    const context = SillyTavern.getContext();
                    return context.streamingProcessor?.result?.length > 20;
                }""", timeout=30000)
                page.evaluate("SillyTavern.getContext().stopGeneration()")
                page.evaluate("window.__directorPendingGeneration")
                assert stopped_instruction in json.dumps(requests()[baseline], ensure_ascii=False)
                assert page.evaluate("""text => Object.values(SillyTavern.getContext().chatMetadata.script_injects || {}).some(inject => inject.value.includes(text))""", stopped_instruction)
                configure_provider({'reply': 'Synthetic Director reply.', 'tokens': 8, 'rate': 10000, 'jitter': 0})
                generate()
                assert stopped_instruction in json.dumps(requests()[baseline + 1], ensure_ascii=False)
                page.evaluate("""async () => { await SillyTavern.getContext().reloadCurrentChat(); }""")
                generate()
                assert stopped_instruction not in json.dumps(requests()[baseline + 2], ensure_ascii=False)
                result['checks']['instructSurvivesStopThenConsumedOnSuccessfulStreamingRetry'] = True

                stage = 'ordinary ephemeral inject retains upstream stop lifecycle'
                page.evaluate("""async () => {
                    await SillyTavern.getContext().SlashCommandParser.commands.inject.callback({
                        id:'ordinary-stop-check', ephemeral:'true', position:'chat', depth:'0',
                    }, 'Ordinary synthetic ephemeral injection');
                }""")
                configure_provider({'tokens': 500, 'rate': 25, 'jitter': 0})
                page.evaluate("""() => {
                    window.__directorPendingGeneration = SillyTavern.getContext().generate('normal').catch(() => null);
                }""")
                page.wait_for_function("() => SillyTavern.getContext().streamingProcessor?.result?.length > 20", timeout=30000)
                page.evaluate("SillyTavern.getContext().stopGeneration()")
                page.evaluate("window.__directorPendingGeneration")
                assert page.evaluate("() => !SillyTavern.getContext().chatMetadata.script_injects?.['ordinary-stop-check']")
                result['checks']['ordinaryEphemeralInjectStillClearsOnStop'] = True
                print('Director failure, stop, retry and ordinary inject lifecycle passed', flush=True)

                stage = 'director instruct rebind'
                # The stop stage leaves streaming on and a slow fixture. Rebind checks
                # non-streaming requests except for the explicit mid-stop swipe.
                page.evaluate("""async () => { (await import('/scripts/openai.js')).oai_settings.stream_openai = false; }""")
                configure_provider({'reply': 'Synthetic Director reply.', 'tokens': 8, 'rate': 10000, 'jitter': 0})

                def chip_state():
                    return page.evaluate("""() => {
                        const chip = document.querySelector('#director_instruct_chip');
                        if (!chip) return null;
                        const style = getComputedStyle(chip);
                        return {
                            hidden: chip.hidden,
                            display: style.display,
                            state: chip.dataset.state || '',
                            title: chip.title || '',
                            label: chip.textContent || '',
                            aria: chip.getAttribute('aria-label') || '',
                        };
                    }""")

                def count_needle(payload, needle):
                    return json.dumps(payload, ensure_ascii=False).count(needle)

                def wait_count(count, timeout=20):
                    deadline = time.monotonic() + timeout
                    latest = requests()
                    while len(latest) < count and time.monotonic() < deadline:
                        page.wait_for_timeout(50)
                        latest = requests()
                    assert len(latest) >= count, len(latest)
                    return latest

                def slash(command):
                    outcome = page.evaluate("""async (command) => {
                        try {
                            await SillyTavern.getContext().executeSlashCommandsWithOptions(command);
                            return { ok: true };
                        } catch (error) {
                            return { ok: false, error: String(error && error.message || error) };
                        }
                    }""", command)
                    assert outcome['ok'], outcome
                    return outcome

                def click_generation(option_id):
                    page.evaluate("""async (optionId) => {
                        const main = await import('/script.js');
                        const stamp = () => SillyTavern.getContext().chat.at(-1)?.gen_finished ?? null;
                        const beforeStamp = stamp();
                        document.getElementById(optionId).click();
                        const started = Date.now();
                        let saw = main.is_send_press || main.is_group_generating;
                        while (Date.now() - started < 30000) {
                            if (main.is_send_press || main.is_group_generating) saw = true;
                            const idle = !main.is_send_press && !main.is_group_generating;
                            if (idle && (saw || stamp() !== beforeStamp)) return;
                            await new Promise(resolve => setTimeout(resolve, 30));
                        }
                        throw new Error('Timed out after clicking ' + optionId);
                    }""", option_id)

                def send_and_generate(text):
                    page.evaluate("""async (text) => {
                        const main = await import('/script.js');
                        const box = document.querySelector('#send_textarea');
                        box.value = text;
                        box.dispatchEvent(new Event('input', { bubbles: true }));
                        document.querySelector('#send_but').click();
                        const started = Date.now();
                        let saw = main.is_send_press || main.is_group_generating;
                        while (Date.now() - started < 30000) {
                            if (main.is_send_press || main.is_group_generating) saw = true;
                            if (saw && !main.is_send_press && !main.is_group_generating) return;
                            await new Promise(resolve => setTimeout(resolve, 30));
                        }
                        throw new Error('Timed out sending a user message');
                    }""", text)

                def assert_latest(needle, present):
                    body = json.dumps(requests()[-1], ensure_ascii=False)
                    found = body.count(needle)
                    assert found == (1 if present else 0), found

                def assert_bound(token):
                    state = chip_state()
                    assert state and state['hidden'] is False and state['display'] != 'none', state
                    assert state['state'] == 'bound' and token in state['title'] and '重生沿用' in state['label'], state
                    assert token in state['aria'] and '✕' in state['label']

                def assert_hidden_chip():
                    state = chip_state()
                    assert state and state['hidden'] is True and state['display'] == 'none', state
                    assert 'director_instruct_chip' not in snapshot(page)['focus']

                alpha = 'REBINDALPHAUNIQUE01'
                stage = 'director instruct chip idle and pending focus'
                idle_focus = snapshot(page)['focus']
                assert 'director_instruct_chip' not in idle_focus
                assert_hidden_chip()
                preset(page, 'direct', text=alpha)
                pending = chip_state()
                assert pending['state'] == 'pending' and pending['hidden'] is False, pending
                assert alpha in pending['title'] and '[导演指令：' in pending['title'], pending
                assert '待生效' in pending['label'] and '…' in pending['label'] and '✕' in pending['label'], pending
                assert alpha not in pending['label']
                shown_focus = snapshot(page)['focus']
                # Intentional tab-order change while an instruction is visible: only #director_instruct_chip.
                assert [item for item in shown_focus if item != 'director_instruct_chip'] == idle_focus
                assert shown_focus.count('director_instruct_chip') == 1
                result['checks']['instructChipIntentionalFocusEntry'] = True
                page.locator('#director_instruct_chip .director_instruct_text').click()
                dialog = page.locator('dialog[open]')
                dialog.wait_for(state='visible')
                assert alpha in dialog.inner_text()
                # TEXT popups keep a hidden template input. The instruction view has no visible field.
                assert dialog.locator('input, textarea').locator('visible=true').count() == 0
                assert dialog.locator('.popup-button-ok').count() == 0 or not dialog.locator('.popup-button-ok').is_visible()
                assert dialog.get_by_text('关闭', exact=True).is_visible()
                assert dialog.get_by_text('清除', exact=True).is_visible()
                dialog.get_by_text('关闭', exact=True).click()
                dialog.wait_for(state='hidden')
                assert chip_state()['state'] == 'pending'

                stage = 'director instruct consume binds the producing message'
                before = len(requests())
                slash('/trigger await=true')
                wait_count(before + 1)
                assert_latest(alpha, True)
                assert_bound(alpha)
                stored = page.evaluate("""() => {
                    const context = SillyTavern.getContext();
                    const bound = context.chatMetadata.director.boundInstruct;
                    const message = context.chat[bound.slotIndex];
                    return {
                        slot: bound.slotIndex,
                        last: context.chat.length - 1,
                        extraDirector: message?.extra?.director ?? null,
                        own: Object.hasOwn(message, 'boundInstruct'),
                        swipeInfo: (message.swipe_info || []).some(info => info && (info.boundInstruct || info.extra?.boundInstruct)),
                    };
                }""")
                assert stored['slot'] == stored['last'] and stored['extraDirector'] is None, stored
                assert stored['own'] is False and stored['swipeInfo'] is False, stored

                stage = 'pending dismiss restores the previous binding'
                zeta = 'REBINDZETACANCEL02'
                preset(page, 'direct', text=zeta)
                assert chip_state()['state'] == 'pending' and zeta in chip_state()['title']
                page.locator('#director_instruct_chip .director_instruct_dismiss').click()
                assert page.locator('dialog[open]').count() == 0
                page.wait_for_function("""token => {
                    const chip = document.querySelector('#director_instruct_chip');
                    return chip && !chip.hidden && chip.dataset.state === 'bound' && chip.title.includes(token);
                }""", arg=alpha)
                assert_bound(alpha)
                assert zeta not in chip_state()['title']

                stage = 'swipe regenerate and continue reinject the bound instruction'
                for command in ('/swipe await=true', '/swipe await=true'):
                    before = len(requests())
                    slash(command)
                    wait_count(before + 1)
                    assert_latest(alpha, True)
                    assert_bound(alpha)
                before = len(requests())
                click_generation('option_regenerate')
                wait_count(before + 1)
                assert_latest(alpha, True)
                assert_bound(alpha)
                before = len(requests())
                click_generation('option_continue')
                wait_count(before + 1)
                assert_latest(alpha, True)
                assert_bound(alpha)

                stage = 'optimized streaming off still reinjects'
                page.evaluate("""async (enabled) => {
                    (await import('/scripts/power-user.js')).power_user.optimized_streaming = enabled;
                }""", False)
                before = len(requests())
                slash('/swipe await=true')
                wait_count(before + 1)
                assert_latest(alpha, True)
                page.evaluate("""async () => {
                    (await import('/scripts/power-user.js')).power_user.optimized_streaming = true;
                }""")
                assert_bound(alpha)

                stage = 'failed and stopped reinject keep the binding'
                before = len(requests())
                configure_provider({'nextStatus': 500})
                # /swipe observes Generate only after the swipe animation. A fast 500
                # rejects first, and Playwright records that as a page error even though
                # endSwipe catches it. generate('swipe') is the same interceptor type and
                # attaches the rejection handler immediately, matching the M6 failure test.
                failed_swipe = page.evaluate("""async () => {
                    try { await SillyTavern.getContext().generate('swipe'); return { failed: false }; }
                    catch (error) { return { failed: true, error: String(error && error.message || error) }; }
                }""")
                assert failed_swipe['failed'], failed_swipe
                wait_count(before + 1)
                assert_latest(alpha, True)
                assert_bound(alpha)
                configure_provider({'reply': 'Synthetic Director reply.', 'tokens': 8, 'rate': 10000, 'jitter': 0})
                before = len(requests())
                slash('/swipe await=true')
                wait_count(before + 1)
                assert_latest(alpha, True)
                configure_provider({'tokens': 500, 'rate': 25, 'jitter': 0})
                before = len(requests())
                page.evaluate("""async () => {
                    (await import('/scripts/openai.js')).oai_settings.stream_openai = true;
                    window.__directorPendingGeneration = SillyTavern.getContext().executeSlashCommandsWithOptions('/swipe await=true').catch(error => String(error));
                }""")
                page.wait_for_function("""() => (SillyTavern.getContext().streamingProcessor?.result?.length || 0) > 10""", timeout=30000)
                page.evaluate('SillyTavern.getContext().stopGeneration()')
                page.evaluate('window.__directorPendingGeneration')
                wait_count(before + 1)
                assert_latest(alpha, True)
                assert_bound(alpha)
                page.evaluate("""async () => { (await import('/scripts/openai.js')).oai_settings.stream_openai = false; }""")
                configure_provider({'reply': 'Synthetic Director reply.', 'tokens': 8, 'rate': 10000, 'jitter': 0})
                before = len(requests())
                slash('/swipe await=true')
                wait_count(before + 1)
                assert_latest(alpha, True)
                assert_bound(alpha)

                stage = 'a new pending instruction replaces the binding'
                beta = 'REBINDBETAUNIQUE03'
                preset(page, 'direct', text=beta)
                assert chip_state()['state'] == 'pending' and beta in chip_state()['title']
                before = len(requests())
                slash('/swipe await=true')
                wait_count(before + 1)
                assert_latest(beta, True)
                assert count_needle(requests()[-1], alpha) == 0
                assert_bound(beta)

                stage = 'refresh keeps the bound instruction'
                ready(page, origin)
                connect_api(page)
                page.evaluate("""async (sample) => {
                    const context = SillyTavern.getContext();
                    await context.getCharacters();
                    const index = context.characters.findIndex(card => card.avatar === sample.avatar);
                    if (index < 0) throw new Error('Synthetic card missing after reload');
                    await context.selectCharacterById(String(index));
                    const current = SillyTavern.getContext();
                    if (current.chatId !== sample.chatName) await current.openCharacterChat(sample.chatName);
                }""", sample)
                page.wait_for_function("""token => {
                    const chip = document.querySelector('#director_instruct_chip');
                    return chip && !chip.hidden && chip.title.includes(token);
                }""", arg=beta, timeout=30000)
                before = len(requests())
                slash('/swipe await=true')
                wait_count(before + 1)
                assert_latest(beta, True)
                assert_bound(beta)

                stage = 'a new user message drops the binding'
                before = len(requests())
                send_and_generate('SyntheticUserFollowsBound')
                wait_count(before + 1)
                assert_latest(beta, False)
                assert_hidden_chip()

                stage = 'editing the previous message drops the binding'
                edit_token = 'REBINDEDITUNIQUE04'
                slash('/send RebindEditUserLine')
                assert page.evaluate("""() => {
                    const message = SillyTavern.getContext().chat.at(-1);
                    return message.is_user === true && message.mes === 'RebindEditUserLine';
                }""")
                preset(page, 'direct', text=edit_token)
                before = len(requests())
                slash('/trigger await=true')
                wait_count(before + 1)
                assert_latest(edit_token, True)
                assert_bound(edit_token)
                page.evaluate("""async () => {
                    const context = SillyTavern.getContext();
                    const slot = context.chatMetadata.director.boundInstruct.slotIndex;
                    context.chat[slot - 1].mes += ' fingerprint-edit';
                    await context.saveChat();
                }""")
                before = len(requests())
                slash('/swipe await=true')
                wait_count(before + 1)
                assert_latest(edit_token, False)
                assert_hidden_chip()

                stage = 'deleting the bound message drops the binding'
                gamma = 'REBINDGAMMADELETE05'
                preset(page, 'direct', text=gamma)
                before = len(requests())
                slash('/trigger await=true')
                wait_count(before + 1)
                assert_latest(gamma, True)
                assert_bound(gamma)
                removed = page.evaluate("""async () => {
                    const context = SillyTavern.getContext();
                    const slot = context.chatMetadata.director.boundInstruct.slotIndex;
                    const before = context.chat.length;
                    await context.deleteMessage(slot);
                    return { before, after: SillyTavern.getContext().chat.length, slot };
                }""")
                assert removed['after'] < removed['before'], removed
                assert_hidden_chip()
                before = len(requests())
                slash('/trigger await=true')
                wait_count(before + 1)
                assert_latest(gamma, False)
                assert_hidden_chip()

                stage = 'impersonate and quiet leave the binding'
                delta = 'REBINDDELTAQUIET06'
                preset(page, 'direct', text=delta)
                before = len(requests())
                slash('/trigger await=true')
                wait_count(before + 1)
                assert_bound(delta)
                before = len(requests())
                slash('/impersonate await=true')
                wait_count(before + 1)
                assert_latest(delta, False)
                assert_bound(delta)
                before = len(requests())
                slash('/gen QuietProbe')
                wait_count(before + 1)
                assert_latest(delta, False)
                assert_bound(delta)
                page.evaluate("""() => {
                    const box = document.querySelector('#send_textarea');
                    box.value = '';
                    box.dispatchEvent(new Event('input', { bubbles: true }));
                }""")

                stage = 'chip dismiss clears pending and bound'
                page.locator('#director_instruct_chip .director_instruct_dismiss').click()
                assert page.locator('dialog[open]').count() == 0
                page.wait_for_function("""() => document.querySelector('#director_instruct_chip')?.hidden""")
                assert_hidden_chip()
                before = len(requests())
                slash('/swipe await=true')
                wait_count(before + 1)
                assert_latest(delta, False)
                epsilon = 'REBINDEPSILONCLEAR07'
                preset(page, 'direct', text=epsilon)
                assert chip_state()['state'] == 'pending'
                page.locator('#director_instruct_chip .director_instruct_dismiss').click()
                page.wait_for_function("""() => document.querySelector('#director_instruct_chip')?.hidden""")
                assert_hidden_chip()
                before = len(requests())
                slash('/trigger await=true')
                wait_count(before + 1)
                assert_latest(epsilon, False)

                stage = 'each chat keeps its own binding'
                chat_token = 'REBINDZETACHAT08'
                preset(page, 'direct', text=chat_token)
                before = len(requests())
                slash('/trigger await=true')
                wait_count(before + 1)
                assert_bound(chat_token)
                other_chat = page.evaluate("""async (sample) => {
                    const token = (await (await fetch('/csrf-token')).json()).token;
                    const post = async (url, body) => {
                        const response = await fetch(url, { method: 'POST', headers: { 'X-CSRF-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                        const data = await response.json().catch(() => ({}));
                        if (!response.ok) throw new Error(url + ' ' + response.status + ' ' + JSON.stringify(data));
                        return data;
                    };
                    const context = SillyTavern.getContext();
                    const card = context.characters.find(item => item.avatar === sample.avatar);
                    const file = 'DirectorRebindB-' + sample.suffix;
                    await post('/api/chats/save', { avatar_url: sample.avatar, file_name: file, chat: [
                        { user_name: 'Synthetic Tester', character_name: card.name, chat_metadata: { integrity: 'rebind-b-' + sample.suffix } },
                        { name: 'Synthetic Tester', is_user: true, is_system: false, send_date: '2026-02-01T00:00:00.000Z', mes: 'Chat B greeting', extra: {} },
                        { name: card.name, is_user: false, is_system: false, send_date: '2026-02-01T00:00:01.000Z', mes: 'Chat B ready', extra: {} },
                    ] });
                    await context.openCharacterChat(file);
                    return file;
                }""", {**sample, 'suffix': uuid.uuid4().hex[:10]})
                page.wait_for_function("""() => SillyTavern.getContext().chat.length === 2 && document.querySelector('#director_instruct_chip')?.hidden""")
                before = len(requests())
                slash('/swipe await=true')
                wait_count(before + 1)
                assert_latest(chat_token, False)
                assert_hidden_chip()
                page.evaluate("""async (name) => { await SillyTavern.getContext().openCharacterChat(name); }""", sample['chatName'])
                page.wait_for_function("""token => {
                    const chip = document.querySelector('#director_instruct_chip');
                    return chip && !chip.hidden && chip.title.includes(token) && SillyTavern.getContext().chat.length > 2;
                }""", arg=chat_token, timeout=30000)
                before = len(requests())
                slash('/swipe await=true')
                wait_count(before + 1)
                assert_latest(chat_token, True)
                assert_bound(chat_token)
                assert other_chat

                stage = 'group swipe reinjects and the next member clears it'
                eta = 'REBINDETAGROUP09'
                page.evaluate("""async (sample) => {
                    const token = (await (await fetch('/csrf-token')).json()).token;
                    const post = async (url, body) => {
                        const response = await fetch(url, { method: 'POST', headers: { 'X-CSRF-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                        const data = await response.json().catch(() => ({}));
                        if (!response.ok) throw new Error(url + ' ' + response.status + ' ' + JSON.stringify(data));
                        return data;
                    };
                    const form = new FormData();
                    form.set('ch_name', 'Director Synthetic Two');
                    form.set('file_name', 'DirectorSyntheticTwo-' + sample.suffix);
                    form.set('description', 'Second synthetic group member.');
                    form.set('first_mes', 'Second ready');
                    const created = await fetch('/api/characters/create', { method: 'POST', headers: { 'X-CSRF-Token': token }, body: form });
                    if (!created.ok) throw new Error('Second synthetic create failed');
                    const avatar = await created.text();
                    const chatId = 'DirectorRebindGroup-' + sample.suffix;
                    const group = await post('/api/groups/create', { name: 'Synthetic Rebind Group', members: [sample.avatar, avatar],
                        chat_id: chatId, chats: [chatId], activation_strategy: 1, generation_mode: 0 });
                    await post('/api/chats/group/save', { id: chatId, chat: [
                        { user_name: 'Synthetic Tester', character_name: 'Group', chat_metadata: { integrity: 'rebind-group-' + sample.suffix } },
                        { name: 'Synthetic Tester', is_user: true, is_system: false, send_date: '2026-03-01T00:00:00.000Z', mes: 'Group rebind start', extra: {} },
                    ] });
                    const groupModule = await import('/scripts/group-chats.js');
                    await groupModule.getGroups();
                    if (!await groupModule.openGroupById(group.id)) throw new Error('Rebind group did not open');
                }""", {**sample, 'suffix': uuid.uuid4().hex[:10]})
                page.wait_for_function("""() => !!SillyTavern.getContext().groupId && SillyTavern.getContext().chat.length === 1""", timeout=30000)
                preset(page, 'direct', text=eta)
                before = len(requests())
                slash('/trigger await=true 0')
                wait_count(before + 1)
                assert_latest(eta, True)
                assert_bound(eta)
                before = len(requests())
                slash('/swipe await=true')
                wait_count(before + 1)
                assert_latest(eta, True)
                assert_bound(eta)
                before = len(requests())
                slash('/trigger await=true 1')
                wait_count(before + 1)
                assert_latest(eta, False)
                assert_hidden_chip()
                result['checks']['instructRebindSwipeRegenerateContinueAndChatScope'] = True
                print('Director instruct rebind passed', flush=True)

                stage = 'user input macros stay literal'
                # The group stage leaves a group open. Select the character before
                # opening its chat. Popup input is not an STscript argument, so
                # {{char}} reaches the template raw.
                page.evaluate("""async (sample) => {
                    const context = SillyTavern.getContext();
                    const index = context.characters.findIndex(card => card.avatar === sample.avatar);
                    await context.selectCharacterById(String(index));
                    await SillyTavern.getContext().openCharacterChat(sample.chatName);
                }""", sample)
                page.wait_for_function("""name => {
                    const context = SillyTavern.getContext();
                    return !context.groupId && context.chatId === name && context.name2 === 'Director Synthetic';
                }""", arg=sample['chatName'], timeout=30000)
                literal_input = '{{char}} 和 {{user}} {{random::a,b}}'
                expected_mes = '【Director Synthetic】' + literal_input
                page.evaluate("""async () => {
                    const { extension_settings } = await import('/scripts/extensions.js');
                    const template = '【{{char}}】{{input:说什么}}';
                    const fields = { template, isChapter: false, autoGenerate: false };
                    extension_settings.director.presets.push(
                        { ...fields, id: 'macro-narrator', icon: '⏩', name: '宏旁白', mode: 'narrator' },
                        { ...fields, id: 'macro-comment', icon: '📝', name: '宏备注', mode: 'comment' },
                        { ...fields, id: 'macro-instruct', icon: '🎭', name: '宏指令', mode: 'instruct' },
                    );
                }""")

                def saved_message():
                    return page.evaluate("""async (sample) => {
                        const context = SillyTavern.getContext();
                        const response = await fetch('/api/chats/get', { method: 'POST', headers: context.getRequestHeaders(),
                            body: JSON.stringify({ avatar_url: sample.avatar, file_name: sample.chatName }) });
                        if (!response.ok) throw new Error('Saved JSONL read failed');
                        const saved = await response.json();
                        return saved[saved.length - 1];
                    }""", sample)

                for preset_id in ('macro-narrator', 'macro-comment'):
                    preset(page, preset_id, text=literal_input)
                    memory = page.evaluate('() => SillyTavern.getContext().chat.at(-1)')
                    assert memory['mes'] == expected_mes, memory['mes']
                    assert memory['extra']['director']['preset'] == preset_id
                    saved = saved_message()
                    assert saved['mes'] == expected_mes, saved.get('mes')
                    assert '{{random::a,b}}' in saved['mes']
                    assert saved['extra']['director']['preset'] == preset_id
                chat_before = page.evaluate('() => SillyTavern.getContext().chat.length')
                preset(page, 'macro-instruct', text=literal_input)
                assert page.evaluate('() => SillyTavern.getContext().chat.length') == chat_before
                before = len(requests())
                slash('/trigger await=true')
                latest = wait_count(before + 1, timeout=30)
                body = json.dumps(latest[-1], ensure_ascii=False)
                # Prompt assembly still expands macros inside saved chat messages.
                # The injection itself is the system content that keeps the typed text.
                assert expected_mes in body, body
                assert '{{random::a,b}}' in body
                result['checks']['userInputMacrosStayLiteral'] = True
                print('User input macros stay literal in JSONL and the instruct request', flush=True)

                stage = 'quiet and impersonate keep a pending instruct'

                def director_prompts():
                    return page.evaluate("""() => {
                        const context = SillyTavern.getContext();
                        return Object.entries(context.chatMetadata.script_injects || {})
                            .filter(([, inject]) => inject && inject.directorEphemeral === true)
                            .map(([id, inject]) => {
                                const prompt = context.extensionPrompts['script_inject_' + id];
                                return { id, value: inject.value, promptValue: prompt ? prompt.value : null, hasPrompt: !!prompt };
                            });
                    }""")

                def assert_pending(token):
                    state = chip_state()
                    assert state and state['hidden'] is False and state['state'] == 'pending', state
                    assert token in state['title'] and '待生效' in state['label'], state
                    color = page.evaluate("""() => getComputedStyle(document.querySelector('#director_instruct_chip')).color""")
                    assert color == 'rgb(196, 92, 18)', color
                    found = [item for item in director_prompts() if token in item['value']]
                    assert len(found) == 1 and found[0]['hasPrompt'] and found[0]['promptValue'] == found[0]['value'], found

                quiet_token = 'QUIETMASKUNIQUE10'
                preset(page, 'direct', text=quiet_token)
                assert_pending(quiet_token)
                before = len(requests())
                quiet = page.evaluate("""async () => {
                    try {
                        const text = await SillyTavern.getContext().generateQuietPrompt({ quietPrompt: 'Quiet probe only.' });
                        return { failed: false, text: String(text ?? '') };
                    } catch (error) {
                        return { failed: true, error: String(error && error.message || error) };
                    }
                }""")
                assert quiet['failed'] is False, quiet
                quiet_body = json.dumps(wait_count(before + 1)[-1], ensure_ascii=False)
                assert quiet_token not in quiet_body, quiet_body
                assert 'Quiet probe only.' in quiet_body
                assert_pending(quiet_token)

                before = len(requests())
                slash('/impersonate await=true')
                impersonate_body = json.dumps(wait_count(before + 1)[-1], ensure_ascii=False)
                assert quiet_token not in impersonate_body, impersonate_body
                assert_pending(quiet_token)
                page.evaluate("""() => {
                    const box = document.querySelector('#send_textarea');
                    box.value = '';
                    box.dispatchEvent(new Event('input', { bubbles: true }));
                }""")

                before = len(requests())
                slash('/trigger await=true')
                sent_body = json.dumps(wait_count(before + 1)[-1], ensure_ascii=False)
                assert quiet_token in sent_body, sent_body
                assert_bound(quiet_token)
                assert not any(quiet_token in item['value'] for item in director_prompts())

                stage = 'quiet 500 restores the extension prompt'
                fail_token = 'QUIETFAILUNIQUE11'
                preset(page, 'direct', text=fail_token)
                assert_pending(fail_token)
                configure_provider({'nextStatus': 500})
                before = len(requests())
                failed = page.evaluate("""async () => {
                    try {
                        await SillyTavern.getContext().generateQuietPrompt({ quietPrompt: 'Quiet failure probe.' });
                        return { failed: false };
                    } catch (error) {
                        return { failed: true, error: String(error && error.message || error) };
                    }
                }""")
                assert failed['failed'] is True, failed
                failed_body = json.dumps(wait_count(before + 1)[-1], ensure_ascii=False)
                assert fail_token not in failed_body, failed_body
                assert_pending(fail_token)
                configure_provider({'reply': 'Synthetic Director reply.', 'tokens': 8, 'rate': 10000, 'jitter': 0})
                result['checks']['quietAndImpersonateDoNotConsumePending'] = True
                print('Quiet and impersonate leave pending instructs in place', flush=True)

                stage = 'regenerate delete skip does not stick'

                def dismiss_pending():
                    if chip_state()['state'] != 'pending':
                        return
                    page.locator('#director_instruct_chip .director_instruct_dismiss').click()
                    page.wait_for_function("""() => {
                        const chip = document.querySelector('#director_instruct_chip');
                        return !chip || chip.hidden || chip.dataset.state !== 'pending';
                    }""")

                def bind_instruct(token):
                    dismiss_pending()
                    preset(page, 'direct', text=token)
                    before_bind = len(requests())
                    slash('/trigger await=true')
                    wait_count(before_bind + 1)
                    assert_bound(token)

                def delete_bound_message():
                    return page.evaluate("""async () => {
                        const context = SillyTavern.getContext();
                        const bound = context.chatMetadata.director && context.chatMetadata.director.boundInstruct;
                        if (!bound) return { cleared: false, reason: 'no binding' };
                        await context.deleteMessage(bound.slotIndex);
                        const after = SillyTavern.getContext();
                        const still = after.chatMetadata.director && after.chatMetadata.director.boundInstruct;
                        return { cleared: !still, text: still && still.text || '' };
                    }""")

                regen_fail = 'REGENFAILUNIQUE12'
                page.evaluate("""async () => { (await import('/scripts/openai.js')).oai_settings.stream_openai = false; }""")
                bind_instruct(regen_fail)
                # A non-streaming 500 deletes the bound message before the request
                # and does not put it back. Another extension may also save that
                # shorter chat, so a reload cannot restore the row. Put the same
                # message back without a delete event, then delete it for real.
                bound_message = page.evaluate("""() => {
                    const context = SillyTavern.getContext();
                    const bound = context.chatMetadata.director.boundInstruct;
                    return structuredClone(context.chat[bound.slotIndex]);
                }""")
                configure_provider({'nextStatus': 500})
                before = len(requests())
                failed_regen = page.evaluate("""async () => {
                    try {
                        await SillyTavern.getContext().generate('regenerate');
                        return { failed: false };
                    } catch (error) {
                        return { failed: true, error: String(error && error.message || error) };
                    }
                }""")
                assert failed_regen['failed'] is True, failed_regen
                assert regen_fail in json.dumps(wait_count(before + 1)[-1], ensure_ascii=False)
                assert_bound(regen_fail)
                page.evaluate("""(message) => {
                    const context = SillyTavern.getContext();
                    const bound = context.chatMetadata.director && context.chatMetadata.director.boundInstruct;
                    if (!bound || context.chat[bound.slotIndex]) return;
                    context.chat.push(message);
                    context.addOneMessage(context.chat.at(-1));
                }""", bound_message)
                deleted = delete_bound_message()
                assert deleted['cleared'] is True, deleted
                assert_hidden_chip()

                stage = 'stopped regenerate delete skip does not stick'
                regen_stop = 'REGENSTOPUNIQUE13'
                configure_provider({'reply': 'Synthetic Director reply.', 'tokens': 8, 'rate': 10000, 'jitter': 0})
                bind_instruct(regen_stop)
                configure_provider({'tokens': 500, 'rate': 25, 'jitter': 0})
                page.evaluate("""async () => { (await import('/scripts/openai.js')).oai_settings.stream_openai = true; }""")
                before = len(requests())
                page.evaluate("""() => {
                    window.__directorPendingGeneration = SillyTavern.getContext().generate('regenerate').catch(() => null);
                }""")
                page.wait_for_function("""() => SillyTavern.getContext().streamingProcessor?.result?.length > 20""", timeout=30000)
                page.evaluate("SillyTavern.getContext().stopGeneration()")
                page.evaluate("window.__directorPendingGeneration")
                wait_count(before + 1)
                assert_bound(regen_stop)
                deleted = delete_bound_message()
                assert deleted['cleared'] is True, deleted
                assert_hidden_chip()

                stage = 'successful regenerate delete skip does not stick'
                regen_ok = 'REGENOKUNIQUE14'
                page.evaluate("""async () => { (await import('/scripts/openai.js')).oai_settings.stream_openai = false; }""")
                configure_provider({'reply': 'Synthetic Director reply.', 'tokens': 8, 'rate': 10000, 'jitter': 0})
                bind_instruct(regen_ok)
                before = len(requests())
                ok_regen = page.evaluate("""async () => {
                    try {
                        await SillyTavern.getContext().generate('regenerate');
                        return { failed: false };
                    } catch (error) {
                        return { failed: true, error: String(error && error.message || error) };
                    }
                }""")
                assert ok_regen['failed'] is False, ok_regen
                wait_count(before + 1)
                assert_bound(regen_ok)
                deleted = delete_bound_message()
                assert deleted['cleared'] is True, deleted
                assert_hidden_chip()
                result['checks']['regenerateDeleteSkipDoesNotStick'] = True
                print('Regenerate delete skip resets after failure, stop, and success', flush=True)

                stage = 'disconnected regenerate cannot hide a manual deletion'
                early_token = 'REGENEARLYRETURN15'
                bind_instruct(early_token)
                before = len(requests())
                page.evaluate("""async () => {
                    const main = await import('/script.js');
                    window.__directorOnlineStatus = main.online_status;
                    main.setOnlineStatus('no_connection');
                    await SillyTavern.getContext().generate('regenerate');
                    if (main.is_send_press) throw new Error('Early return left generation active');
                }""")
                assert len(requests()) == before
                deleted = delete_bound_message()
                assert deleted['cleared'] is True, deleted
                assert_hidden_chip()
                page.evaluate("""async () => {
                    (await import('/script.js')).setOnlineStatus(window.__directorOnlineStatus);
                }""")
                connect_api(page)
                page.evaluate("async () => { await SillyTavern.getContext().generate('regenerate'); }")
                assert early_token not in json.dumps(wait_count(before + 1)[-1], ensure_ascii=False)
                assert_hidden_chip()
                result['checks']['disconnectedRegenerateThenDeleteClearsBinding'] = True

                stage = 'dryRun leaves the real regenerate deletion token alone'
                dry_token = 'REGENDRYRUN16'
                bind_instruct(dry_token)
                before = len(requests())
                page.evaluate("""async () => {
                    const context = SillyTavern.getContext();
                    context.eventSource.once(context.eventTypes.GENERATION_STARTED, async (type, params, dryRun) => {
                        if (!dryRun && type === 'regenerate') {
                            await context.eventSource.emit(context.eventTypes.GENERATION_STARTED, 'quiet', {}, true);
                        }
                    });
                    await context.generate('regenerate');
                }""")
                assert dry_token in json.dumps(wait_count(before + 1)[-1], ensure_ascii=False)
                assert_bound(dry_token)
                result['checks']['dryRunPreservesRegenerateDeleteToken'] = True

                stage = 'first message narration keeps literal macros'
                # messageFormatting rewrites message 0. The sample chat is never
                # empty, so open a chat with one placeholder and delete it first.
                macro_chat = 'DirectorMacroZero-' + uuid.uuid4().hex[:10]
                page.evaluate("""async ({sample, chatName}) => {
                    const context = SillyTavern.getContext();
                    const response = await fetch('/api/chats/save', {
                        method: 'POST',
                        headers: context.getRequestHeaders(),
                        body: JSON.stringify({
                            ch_name: 'Director Synthetic',
                            file_name: chatName,
                            avatar_url: sample.avatar,
                            force: true,
                            chat: [
                                { user_name: 'Synthetic Tester', character_name: 'Director Synthetic', chat_metadata: { integrity: 'macro-zero' } },
                                { name: 'Synthetic Tester', is_user: true, is_system: false, send_date: '2026-03-01T00:00:00.000Z', mes: 'placeholder', extra: {} },
                            ],
                        }),
                    });
                    if (!response.ok) throw new Error('macro chat save failed ' + response.status);
                    if (await context.openCharacterChat(chatName) === false) throw new Error('macro chat did not open');
                }""", {'sample': sample, 'chatName': macro_chat})
                page.wait_for_function("""name => {
                    const context = SillyTavern.getContext();
                    return context.chatId === name && context.chat.length === 1 && context.chat[0].mes === 'placeholder';
                }""", arg=macro_chat, timeout=30000)
                page.evaluate("""async () => { await SillyTavern.getContext().deleteMessage(0); }""")
                page.wait_for_function("""() => SillyTavern.getContext().chat.length === 0 && document.querySelectorAll('#chat .mes').length === 0""")
                literal_input = '{{char}} 和 {{user}} {{random::a,b}}'
                expected_mes = '【Director Synthetic】' + literal_input

                def visible_text(mesid):
                    return page.evaluate("""id => {
                        const node = document.querySelector('#chat .mes[mesid="' + id + '"] .mes_text');
                        return node ? node.textContent : '';
                    }""", mesid)

                def assert_literal_message(mesid, preset_id):
                    memory = page.evaluate("""id => SillyTavern.getContext().chat[id]""", mesid)
                    assert memory['mes'] == expected_mes, memory['mes']
                    assert memory['extra']['director']['preset'] == preset_id
                    shown = visible_text(mesid)
                    assert expected_mes in shown, shown
                    assert '{{random::a,b}}' in shown

                preset(page, 'macro-narrator', text=literal_input)
                page.wait_for_function("""() => SillyTavern.getContext().chat.length === 1""")
                assert_literal_message(0, 'macro-narrator')
                preset(page, 'macro-comment', text=literal_input)
                page.wait_for_function("""() => SillyTavern.getContext().chat.length === 2""")
                assert_literal_message(1, 'macro-comment')
                page.evaluate("""async () => {
                    const extensions = await import('/scripts/extensions.js');
                    extensions.cancelDebouncedMetadataSave();
                    await SillyTavern.getContext().saveChat();
                    await SillyTavern.getContext().generateQuietPrompt({ quietPrompt: 'Literal macro probe.' });
                }""")
                assert page.evaluate("""() => SillyTavern.getContext().chat[0].mes""") == expected_mes
                page.evaluate("""async () => { await SillyTavern.getContext().reloadCurrentChat(); }""")
                page.wait_for_function("""expected => {
                    const context = SillyTavern.getContext();
                    const narrator = context.chat[0];
                    const comment = context.chat[1];
                    return narrator && narrator.mes === expected && comment && comment.mes === expected
                        && document.querySelectorAll('#chat .mes').length === 2;
                }""", arg=expected_mes, timeout=30000)
                assert_literal_message(0, 'macro-narrator')
                assert_literal_message(1, 'macro-comment')
                stored = page.evaluate("""async (chatName) => {
                    const context = SillyTavern.getContext();
                    const response = await fetch('/api/chats/get', {
                        method: 'POST',
                        headers: context.getRequestHeaders(),
                        body: JSON.stringify({ avatar_url: context.characters[context.characterId].avatar, file_name: chatName }),
                    });
                    if (!response.ok) throw new Error('macro JSONL read failed');
                    return response.json();
                }""", macro_chat)
                assert stored[1]['mes'] == expected_mes, stored[1].get('mes')
                assert stored[2]['mes'] == expected_mes, stored[2].get('mes')
                assert '{{random::a,b}}' in stored[1]['mes'] and '{{random::a,b}}' in stored[2]['mes']
                result['checks']['firstMessageNarrationKeepsLiteralMacros'] = True
                print('First narration and comment keep literal macros after reload', flush=True)

                stage = 'ordinary generation auto-saves literal first narration'
                before = len(requests())
                page.locator('#send_textarea').fill('Ordinary generation after literal narration.')
                # Generate(normal) sends the user message and awaits its own
                # final save. Do not manually save the pre-generation fixture.
                with page.expect_response(is_saved_chat):
                    page.evaluate("async () => { await SillyTavern.getContext().generate('normal'); }")
                wait_count(before + 1)
                stored = page.evaluate("""async chatName => {
                    const context = SillyTavern.getContext();
                    const response = await fetch('/api/chats/get', {
                        method:'POST', headers:context.getRequestHeaders(),
                        body:JSON.stringify({ avatar_url:context.characters[context.characterId].avatar, file_name:chatName }),
                    });
                    if (!response.ok) throw new Error('Post-generation JSONL read failed');
                    return response.json();
                }""", macro_chat)
                assert len(stored) == 5, stored
                assert stored[1]['mes'] == expected_mes, stored[1]
                assert stored[2]['mes'] == expected_mes, stored[2]
                assert stored[-1]['mes'] == 'Synthetic Director reply.', stored[-1]
                page.evaluate("async () => { await SillyTavern.getContext().reloadCurrentChat(); }")
                page.wait_for_function("() => SillyTavern.getContext().chat.length === 4")
                assert_literal_message(0, 'macro-narrator')
                assert_literal_message(1, 'macro-comment')
                result['checks']['ordinaryGenerationSavesLiteralFirstNarration'] = True
                assert not errors, errors
                result.update({'pass':True, 'pageErrors':errors, 'generationRequests':len(requests()), 'chromium':browser.version})
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
    # Preserve synthetic artifacts for diagnosis instead of permanently deleting
    # them on success or failure. Only this script's child processes are stopped.
    temporary = tempfile.mkdtemp(prefix='director-lab-')
    result = redact(run(args, temporary), temporary)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
