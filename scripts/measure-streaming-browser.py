"""JSON-lines worker for the streaming lab. All contexts and caches are temporary."""
import json
import pathlib
import sys
import time
import traceback
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'tests'))
from lab_browser import launch_chromium, assert_lab_page
from playwright.sync_api import sync_playwright


def measure(browser, command):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, locale='en-US')
    try:
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.add_init_script(path=str(pathlib.Path(__file__).with_name('streaming-browser-probe.js')))
        page.goto(command['origin'] + '?stPerfStreaming=1', wait_until='domcontentloaded', timeout=60000)
        page.wait_for_function("""() => {
            const dialog = document.querySelector('dialog[open]');
            if (dialog?.querySelector('.onboarding')) {
                const input = [...dialog.querySelectorAll('input[type=text]')].at(-1);
                if (input) { input.value = 'Synthetic Tester'; input.dispatchEvent(new Event('input', {bubbles:true})); }
                dialog.querySelector('.popup-button-ok').click();
            }
            return window.__streamingProbe?.appReady && !dialog && !document.querySelector('.splash-screen') && document.querySelector('.character_select');
        }""", timeout=60000)
        print('streaming worker: application ready', file=sys.stderr, flush=True)
        assert_lab_page(page, command['origin'])
        assert page.locator('#send_textarea').count() == 1, 'Unexpected duplicate page/composer'
        assert page.locator('#chat').count() == 1, 'Unexpected duplicate chat'
        page.evaluate("async () => { const c = SillyTavern.getContext(); const i = c.characters.findIndex(x => x.name === 'Startup Synthetic'); if (i < 0) throw new Error('Missing fixture card'); await c.selectCharacterById(String(i)); }")
        page.wait_for_function('(n) => SillyTavern.getContext().chat.length === n && document.querySelectorAll("#chat .mes").length === 100', arg=command['scenario']['messages'], timeout=30000)
        page.evaluate("document.querySelector('#api_button_openai').click()")
        page.wait_for_function("[...document.querySelectorAll('.online_status_text')].some(e => e.textContent.toLowerCase().includes('valid'))", timeout=15000)
        print('streaming worker: chat connected', file=sys.stderr, flush=True)
        settings = page.evaluate("""async () => {
            const p = (await import('/scripts/power-user.js')).power_user;
            const o = (await import('/scripts/openai.js')).oai_settings;
            return {chat_truncation:p.chat_truncation, streaming_fps:p.streaming_fps, smooth_streaming:p.smooth_streaming,
                smooth_streaming_speed:p.smooth_streaming_speed, stream_fade_in:p.stream_fade_in, show_thoughts:o.show_thoughts,
                stream_openai:o.stream_openai, source:o.chat_completion_source, documentFocused:document.hasFocus(), reasoning_auto_expand:p.reasoning.auto_expand};
        }""")
        page.evaluate('window.__streamingProbe.start()')
        if command['scenario']['mode'] == 'continue':
            page.evaluate("document.querySelector('#option_continue').click()")
        else:
            page.locator('#send_textarea:visible').fill('Continue the synthetic river story.')
            page.locator('#send_but:visible').click()
        page.wait_for_function("window.__stStreamingPerf.records.some(r => r.kind === 'dom')", timeout=60000)
        print('streaming worker: first DOM update', file=sys.stderr, flush=True)
        textarea = page.locator('#send_textarea:visible')
        textarea.focus()
        next_key = time.monotonic()
        scroll_at = time.monotonic() + 1
        scrolled = False
        deadline = time.monotonic() + 900
        while not page.evaluate('window.__streamingProbe.finalPaintEpochMs !== null'):
            now = time.monotonic()
            if now > deadline:
                raise TimeoutError('Streaming final paint deadline exceeded')
            if now >= next_key:
                # A real browser key event; rAF paint timing is recorded in the page.
                textarea.press('x', timeout=5000)
                next_key += 0.2
            if not scrolled and now >= scroll_at:
                page.evaluate("""() => {
                    const chat = document.querySelector('#chat .mes').closest('#chat');
                    const before = chat.scrollTop;
                    chat.scrollTop -= 600;
                    window.__streamingProbe.scrollProbeEpochMs = performance.timeOrigin + performance.now();
                    window.__streamingProbe.scrollProbe = {before, after:chat.scrollTop, delta:before-chat.scrollTop};
                }""")
                scrolled = True
            page.wait_for_timeout(20)
        page.wait_for_timeout(100)
        result = page.evaluate("""() => {
            const probe = window.__streamingProbe;
            probe.active = false;
            const context = SillyTavern.getContext();
            return {...probe, hooks:window.__stStreamingPerf, timeOrigin:performance.timeOrigin,
                finalText:context.chat.at(-1).mes, finalReasoning:context.chat.at(-1).extra?.reasoning || '',
                messageCount:context.chat.length};
        }""")
        expected_count = command['scenario']['messages'] + (0 if command['scenario']['mode'] == 'continue' else 2)
        assert result['messageCount'] == expected_count, result['messageCount']
        result.update({'settings': settings, 'pageErrors': errors, 'chromium': browser.version})
        return result
    finally:
        context.close()


if len(sys.argv) > 1 and sys.argv[1] == '--fixture':
    import runpy
    fixture = runpy.run_path(str(pathlib.Path(__file__).resolve().parent.parent / 'tests' / 'browser-longchat-perf.py'))
    rows = fixture['synthetic_rows'](int(sys.argv[2]))
    for row in rows:
        if row.get('name') == 'Longchat Synthetic':
            row['name'] = 'Startup Synthetic'
    pathlib.Path(sys.argv[3]).write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows), encoding='utf-8')
    sys.exit(0)

with sync_playwright() as pw:
    browser = launch_chromium(pw)
    print(json.dumps({'ready': True, 'chromium': browser.version}), flush=True)
    try:
        for line in sys.stdin:
            try:
                print(json.dumps({'ok': True, 'result': measure(browser, json.loads(line))}), flush=True)
            except Exception:
                print(json.dumps({'ok': False, 'error': traceback.format_exc()}), flush=True)
    finally:
        browser.close()
