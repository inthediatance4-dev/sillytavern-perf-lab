"""JSON-lines browser worker; the parent owns all server/fake endpoint timing."""
import json
import os
import pathlib
import sys
import time
import traceback
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'tests'))
from lab_browser import launch_chromium, assert_lab_page
from playwright.sync_api import sync_playwright


def measure(browser, context, command):
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    cdp = context.new_cdp_session(page)
    responses = []
    cdp.send('Network.enable')
    cdp.on('Network.responseReceived', lambda e: responses.append({'path': e['response']['url'].split(command['origin'])[-1],
        'status': e['response']['status'], 'diskCache': e['response'].get('fromDiskCache', False)}))
    cdp.on('Network.responseReceivedExtraInfo', lambda e: responses.append({'wireStatus': e['statusCode']}))
    page.add_init_script(path=str(pathlib.Path(__file__).with_name('startup-browser-probe.js')))
    if command.get('trace'):
        cdp.send('Tracing.start', {'categories': 'devtools.timeline,blink.user_timing,loading', 'transferMode': 'ReturnAsStream'})
    nav_epoch_ms = time.time_ns() / 1e6
    page.goto(command['origin'], wait_until='domcontentloaded', timeout=60000)
    # Sticky APP_READY is subscribed in the init script, before app startup.
    page.wait_for_function("""() => {
        const dialog = document.querySelector('dialog[open]');
        if (dialog?.querySelector('.onboarding') && !dialog.dataset.labDismissed) {
            dialog.dataset.labDismissed = 'true';
            const input = [...dialog.querySelectorAll('input[type=text]')].at(-1);
            if (input) { input.value = 'Synthetic Tester'; input.dispatchEvent(new Event('input', {bubbles:true})); }
            dialog.querySelector('.popup-button-ok').click();
        }
        return window.__startupProbe?.appReadyMs !== null && !dialog &&
            !document.querySelector('.splash-screen') && !!document.querySelector('#send_textarea')?.getClientRects().length;
    }""", timeout=60000)
    assert_lab_page(page, command['origin'])
    # Open the character drawer and require the synthetic card to actually render.
    if not page.locator('#right-nav-panel').is_visible():
        page.locator('#rightNavDrawerIcon').click()
    card = page.locator('.character_select').filter(has_text='Startup Synthetic')
    card.first.wait_for(state='visible', timeout=15000)
    ui_epoch_ms = time.time_ns() / 1e6
    ui = page.evaluate('window.__startupProbe.snapshot()')
    card.first.click()
    page.wait_for_function("""() => [...document.querySelectorAll('#chat .mes .mes_text')].some(e => e.textContent.includes('Synthetic ready')) && document.querySelectorAll('#chat .mes').length === 2""", timeout=15000)
    # Settings point at the fake custom provider; use the real Connect and Send controls.
    page.evaluate("document.querySelector('#api_button_openai').click()")
    page.wait_for_function("""() => [...document.querySelectorAll('.online_status_text')].some(e => e.textContent.toLowerCase().includes('valid'))""", timeout=15000)
    page.locator('#send_textarea').fill('Synthetic startup request')
    page.locator('#send_but').click()
    page.wait_for_function("""() => document.querySelectorAll('#chat .mes').length >= 4 &&
        document.querySelector('#chat .mes:last-child .mes_text')?.textContent.includes('Synthetic reply')""", timeout=30000)
    send = page.evaluate('window.__startupProbe.snapshot()')
    report = {'navEpochMs': nav_epoch_ms, 'uiEpochMs': ui_epoch_ms, 'navigationToUiMs': ui_epoch_ms - nav_epoch_ms,
              'atUi': ui, 'atSend': send, 'network': responses,
              'resourceCounts': {'logical200': sum(e.get('status') == 200 for e in responses),
                  'wire200': sum(e.get('wireStatus') == 200 for e in responses),
                  'wire304': sum(e.get('wireStatus') == 304 for e in responses),
                  'diskCache': sum(e.get('diskCache', False) for e in responses)}, 'pageErrors': errors,
              'chromium': browser.version if browser else context.browser.version}
    if command.get('trace'):
        done = []
        cdp.on('Tracing.tracingComplete', lambda e: done.append(e))
        cdp.send('Tracing.end')
        while not done:
            page.wait_for_timeout(50)
        chunks = []
        while True:
            chunk = cdp.send('IO.read', {'handle': done[0]['stream']})
            chunks.append(chunk['data'])
            if chunk['eof']:
                break
        cdp.send('IO.close', {'handle': done[0]['stream']})
        pathlib.Path(command['trace']).write_text(''.join(chunks))
    page.close()
    return report

with sync_playwright() as pw:
    browser = launch_chromium(pw)
    warm = {}
    print(json.dumps({'ready': True, 'chromium': browser.version}), flush=True)
    try:
        for line in sys.stdin:
            command = json.loads(line)
            context = None
            try:
                if command['browser'] == 'warm':
                    profile = command['profile']
                    if profile not in warm:
                        options = {'headless': True, 'args': ['--disable-gpu']}
                        if os.environ.get('LAB_BROWSER_EXECUTABLE'):
                            options['executable_path'] = os.environ['LAB_BROWSER_EXECUTABLE']
                        warm[profile] = pw.chromium.launch_persistent_context(profile, **options)
                        for page in warm[profile].pages:
                            page.close()
                    context = warm[profile]
                else:
                    context = browser.new_context()
                print(json.dumps({'ok': True, 'result': measure(browser, context, command)}), flush=True)
            except Exception:
                print(json.dumps({'ok': False, 'error': traceback.format_exc()}), flush=True)
            finally:
                if context and command['browser'] == 'cold':
                    context.close()
    finally:
        for context in warm.values():
            context.close()
        browser.close()
