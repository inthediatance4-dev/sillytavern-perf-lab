"""D1 acceptance on a temporary, isolated lab; retained for D3 to extend.

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


def select_sample(page, sample):
    page.evaluate("""async (sample) => {
        const context = SillyTavern.getContext();
        await context.getCharacters();
        const index = context.characters.findIndex(card => card.avatar === sample.avatar);
        if (index < 0) throw new Error('Synthetic card not found');
        await context.selectCharacterById(String(index));
    }""", sample)
    page.wait_for_function("SillyTavern.getContext().chat.length === 2 && document.querySelectorAll('#chat .mes').length === 2")
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
                page.screenshot(path=str(pathlib.Path(tempfile.gettempdir()) / 'director-d1-popover.png'))
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
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / '.evidence' / 'director-d1' / 'results.json')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='director-lab-') as temporary:
        result = redact(run(args, temporary), temporary)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
