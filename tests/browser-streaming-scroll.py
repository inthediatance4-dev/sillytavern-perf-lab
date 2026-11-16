#!/usr/bin/env python3
"""S2 follow-bottom acceptance in an isolated streaming lab (Chromium/Linux).

The regular streaming benchmark owns timing measurements. This script checks
scroll intent, the new-content button, composer input, and older-slice loading.
"""
import argparse
import importlib.util
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import traceback

if sys.platform == 'win32':
    print('browser-streaming-scroll is a Linux lab test; skipped on win32')
    sys.exit(0)

REPO = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('streaming_equivalence', REPO / 'tests' / 'browser-streaming-equivalence.py')
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)


STATE = r"""() => {
  const chat = document.querySelector('#chat');
  const button = document.querySelector('#chat_new_content');
  return {
    top: chat.scrollTop,
    height: chat.scrollHeight,
    gap: chat.scrollHeight - chat.clientHeight - chat.scrollTop,
    messages: chat.querySelectorAll('.mes').length,
    button: Boolean(button && getComputedStyle(button).display !== 'none' && button.getClientRects().length),
    streaming: Boolean(SillyTavern.getContext().streamingProcessor),
    typed: document.querySelector('#send_textarea').value,
  };
}"""


INSTALL_SCROLL_PROBE = r"""() => {
  const chat = document.querySelector('#chat');
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  window.__s2Scroll = { active: false, writes: [] };
  Object.defineProperty(chat, 'scrollTop', {
    configurable: true,
    get() { return descriptor.get.call(this); },
    set(value) {
      if (window.__s2Scroll.active) {
        window.__s2Scroll.writes.push({ before: descriptor.get.call(this), value });
      }
      descriptor.set.call(this, value);
    },
  });
}"""


def state(page):
    return page.evaluate(STATE)


def button_state(page, visible):
    page.wait_for_function(r"""(expected) => {
      const button = document.querySelector('#chat_new_content');
      const visible = Boolean(button && getComputedStyle(button).display !== 'none' && button.getClientRects().length);
      return visible === expected;
    }""", arg=visible, timeout=5000)


def bottom(page, gap=0):
    # These sets model a scrollbar drag/return. The scroll handler must distinguish
    # them from its own programmatic sets without relying on event.isTrusted.
    page.evaluate("""(gap) => {
      const chat = document.querySelector('#chat');
      window.__s2Scroll.active = false;
      chat.scrollTop = chat.scrollHeight - chat.clientHeight - gap;
    }""", gap)
    button_state(page, False)
    page.wait_for_timeout(120)
    assert state(page)['gap'] <= 3, state(page)


def begin_held(page):
    page.evaluate("() => { window.__s2Scroll.writes = []; window.__s2Scroll.active = true; }")
    return state(page)


def assert_held(page, before, label, delay=350):
    page.wait_for_timeout(delay)
    after = state(page)
    writes = page.evaluate("() => { window.__s2Scroll.active = false; return window.__s2Scroll.writes; }")
    stolen = [write for write in writes if write['value'] > before['top'] + 3]
    assert after['top'] <= before['top'] + 3, (label, before, after)
    assert not stolen, (label, stolen)
    assert after['button'], (label, after)
    assert after['streaming'], 'Fixture finished before the scroll check'
    return {'before': before, 'after': after, 'scrollStolen': len(stolen)}


def wheel_up(page):
    chat = page.locator('#chat').bounding_box()
    page.mouse.move(chat['x'] + chat['width'] / 2, chat['y'] + chat['height'] / 2)
    page.mouse.wheel(0, -600)
    button_state(page, True)
    page.wait_for_timeout(120)


def touch(page, dx, dy):
    page.evaluate(r"""({ dx, dy }) => {
      const chat = document.querySelector('#chat');
      const rect = chat.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      const point = (x, y) => new Touch({ identifier: 1, target: chat, clientX: x, clientY: y });
      const start = point(startX, startY);
      const end = point(startX + dx, startY + dy);
      chat.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start], changedTouches: [start] }));
      chat.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [end], changedTouches: [end] }));
      chat.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [end] }));
    }""", {'dx': dx, 'dy': dy})


def run_cases(page, origin):
    lab.boot(page, origin, False)
    page.evaluate(INSTALL_SCROLL_PROBE)
    try:
        page.wait_for_function('SillyTavern.getContext().chat.length === 200 && document.querySelectorAll("#chat .mes").length === 100')
    except Exception as error:
        fixture = page.evaluate("""async () => {
          const ctx = SillyTavern.getContext();
          return {
            chatLength: ctx.chat.length,
            renderedMessages: document.querySelectorAll('#chat .mes').length,
            character: ctx.characters[ctx.characterId]?.name,
            chatId: ctx.getCurrentChatId(),
            truncation: (await import('/scripts/power-user.js')).power_user.chat_truncation,
          };
        }""")
        raise AssertionError(f'Fixture did not open: {fixture}') from error
    assert not state(page)['button'], 'New-content button must be hidden before streaming'
    lab.reset_case(page)
    lab.send(page)
    page.wait_for_function('window.__eq.tokens.length > 20 && !!SillyTavern.getContext().streamingProcessor', timeout=30000)
    page.wait_for_timeout(150)
    assert state(page)['gap'] <= 40, state(page)
    result = {}

    # Horizontal movement, a downward scroll gesture, and a tiny movement are
    # not upward intent. These synthetic events isolate intent from scrolling.
    for label, dx, dy in [('horizontalTouch', 100, 2), ('fingerUpTouch', 0, -80), ('tinyTouch', 0, 3)]:
        touch(page, dx, dy)
        page.wait_for_timeout(120)
        assert not state(page)['button'], (label, state(page))
        result[label] = {'pass': True}

    # A finger moving down means the content moves down / viewport moves up.
    touch(page, 0, 80)
    button_state(page, True)
    page.evaluate("() => { const chat = document.querySelector('#chat'); chat.scrollTop -= 600; }")
    button_state(page, True)
    result['fingerDownTouch'] = assert_held(page, begin_held(page), 'finger-down touch')
    bottom(page)

    before_wheel = state(page)
    wheel_up(page)
    held = begin_held(page)
    assert before_wheel['top'] - held['top'] >= 400, (before_wheel, held)
    result['wheelUp'] = assert_held(page, held, 'wheel up 600px')

    # A visible, labelled native button is keyboard accessible and can resume.
    button = page.locator('#chat_new_content')
    assert button.evaluate("node => node.tagName === 'BUTTON' && !!node.getAttribute('aria-label') && node.textContent.includes('新内容')")
    button.click()
    button_state(page, False)
    page.wait_for_timeout(120)
    assert state(page)['gap'] <= 3, state(page)
    result['buttonClick'] = {'pass': True}

    # PageUp is scoped to #chat. Give the scroll container a temporary tab stop
    # only if necessary; restore it immediately after the keyboard check.
    page.evaluate("""() => {
      const chat = document.querySelector('#chat');
      window.__s2Tabindex = chat.getAttribute('tabindex');
      chat.tabIndex = 0;
      chat.focus();
    }""")
    page.keyboard.press('PageUp')
    button_state(page, True)
    page.wait_for_timeout(150)
    result['pageUp'] = assert_held(page, begin_held(page), 'PageUp in chat')
    page.evaluate("""() => {
      const chat = document.querySelector('#chat');
      if (window.__s2Tabindex === null) chat.removeAttribute('tabindex');
      else chat.setAttribute('tabindex', window.__s2Tabindex);
    }""")
    bottom(page, 30)
    result['nearBottomResume'] = {'pass': True, 'gap': state(page)['gap']}

    # Real text input and its ArrowUp key must retain textarea behavior and
    # must not suspend follow-bottom while streaming continues.
    textarea = page.locator('#send_textarea')
    textarea.fill('S2 typing probe\nsecond line')
    textarea.press('End')
    cursor_before = textarea.evaluate('node => node.selectionStart')
    textarea.press('ArrowUp')
    cursor_after = textarea.evaluate('node => node.selectionStart')
    assert cursor_after < cursor_before, (cursor_before, cursor_after)
    textarea.press('ControlOrMeta+End')
    textarea.type(' typed during streaming', delay=20)
    expected = 'S2 typing probe\nsecond line typed during streaming'
    page.wait_for_timeout(120)
    assert state(page)['typed'] == expected, state(page)
    assert not state(page)['button'], state(page)
    assert state(page)['gap'] <= 40, state(page)
    result['textarea'] = {'pass': True, 'cursorMovedUp': True, 'textPreserved': True}

    # Direct upward scroll models a scrollbar drag, and the pending button
    # stays visible after the final render until the viewport returns down.
    page.evaluate("() => { const chat = document.querySelector('#chat'); chat.scrollTop -= 600; }")
    button_state(page, True)
    result['scrollbarUp'] = assert_held(page, begin_held(page), 'scrollbar up')
    held = begin_held(page)
    wrapped = ' additional input to wrap the composer' * 8
    textarea.type(wrapped, delay=1)
    assert state(page)['typed'] == expected + wrapped, state(page)
    result['pausedTyping'] = assert_held(page, held, 'typing wraps composer while paused')
    button_rect = button.bounding_box()
    chat_rect = page.locator('#chat').bounding_box()
    button_bottom = button_rect['y'] + button_rect['height']
    chat_bottom = chat_rect['y'] + chat_rect['height']
    assert button_bottom <= chat_bottom + 1, (button_rect, chat_rect)
    result['buttonPlacement'] = {'pass': True, 'buttonBottom': button_bottom, 'chatBottom': chat_bottom}
    held = begin_held(page)
    lab.wait_stream(page, 'send')
    finished = state(page)
    writes = page.evaluate("() => { window.__s2Scroll.active = false; return window.__s2Scroll.writes; }")
    stolen = [write for write in writes if write['value'] > held['top'] + 3]
    assert finished['button'] and finished['top'] <= held['top'] + 3, (held, finished)
    assert not stolen, stolen
    bottom(page)
    result['finishPersistence'] = {'pass': True, 'scrollStolen': len(stolen)}

    # Older-slice loading still responds to top-of-chat scrolling.
    older_before = state(page)['messages']
    page.evaluate("() => { document.querySelector('#chat').scrollTop = 0; }")
    page.locator('#show_more_messages').click()
    page.wait_for_function('(count) => document.querySelectorAll("#chat .mes").length > count', arg=older_before, timeout=10000)
    result['olderSlice'] = {'before': older_before, 'after': state(page)['messages'], 'pass': True}
    page.evaluate("() => { const chat = document.querySelector('#chat'); chat.scrollTop = chat.scrollHeight; }")
    page.wait_for_timeout(150)

    # With auto-scroll disabled, neither token updates nor finish may move the
    # viewport. The explicit button click is still allowed to jump down.
    page.evaluate("async () => { (await import('/scripts/power-user.js')).power_user.auto_scroll_chat_to_bottom = false; }")
    page.evaluate("() => { const chat = document.querySelector('#chat'); chat.scrollTop -= 500; }")
    before = state(page)
    lab.reset_case(page)
    lab.send(page, 'Second synthetic stream.')
    page.wait_for_function('window.__eq.tokens.length > 20 && !!SillyTavern.getContext().streamingProcessor', timeout=30000)
    button_state(page, True)
    after_start = state(page)
    assert after_start['top'] <= before['top'] + 3, (before, after_start)
    off = assert_held(page, begin_held(page), 'auto-scroll off')
    page.evaluate("""() => {
      document.querySelector('#chat_new_content').addEventListener('click', () => {
        const chat = document.querySelector('#chat');
        window.__s2ClickGap = chat.scrollHeight - chat.clientHeight - chat.scrollTop;
      }, { once: true });
    }""")
    button.click()
    clicked_gap = page.evaluate('() => window.__s2ClickGap')
    assert clicked_gap <= 3, clicked_gap
    button_state(page, True)
    after_click = assert_held(page, begin_held(page), 'auto-scroll off after explicit click')
    held = begin_held(page)
    page.evaluate('() => SillyTavern.getContext().stopGeneration()')
    lab.wait_stream(page, 'stop')
    ended = state(page)
    writes = page.evaluate("() => { window.__s2Scroll.active = false; return window.__s2Scroll.writes; }")
    stolen = [write for write in writes if write['value'] > held['top'] + 3]
    assert ended['top'] <= held['top'] + 3 and ended['button'], (held, ended)
    assert not stolen, stolen
    page.evaluate("() => { const chat = document.querySelector('#chat'); chat.scrollTop = chat.scrollHeight; }")
    button_state(page, False)
    result['autoScrollOff'] = {'pass': True, 'during': off, 'buttonClick': {'gap': clicked_gap}, 'afterClick': after_click, 'finishScrollStolen': len(stolen)}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=REPO / 'docs/reviews/2026-10-28-grok-quality/evidence/streaming-opt/s2/browser-scroll.json')
    args = parser.parse_args()
    temporary = pathlib.Path(tempfile.mkdtemp(prefix='st-scroll-'))
    report = {'pass': False, 'head': 'WORKTREE', 'cases': {}}
    logs = []
    try:
        fake_log = open(temporary / 'fake.log', 'w', encoding='utf-8')
        logs.append(fake_log)
        fake = lab.spawn([lab.NODE, str(REPO / 'scripts/fake-openai-endpoint.mjs'), '--port', '0', '--tokens', '1500', '--rate', '100', '--jitter', '0', '--seed', 's2-scroll'], REPO, stderr=fake_log)
        fake_url = lab.read_url_line(fake)
        data_dir = temporary / 'lab'
        data_dir.mkdir()
        seed = temporary / 'seed.mjs'
        # Reuse the equivalence lab's card/settings and the benchmark's complex
        # history. Its last 100 rows have the same shapes as the main scenario,
        # including the last-message reflow when a new user message is appended.
        seed.write_text(lab.SEED_JS.replace('<REPO>', REPO.as_posix()), encoding='utf-8')
        seeded = json.loads(subprocess.check_output([lab.NODE, str(seed), str(REPO), str(data_dir), str(lab.free_port()), fake_url], cwd=REPO, text=True))
        subprocess.check_call([
            sys.executable, str(REPO / 'scripts/measure-streaming-browser.py'), '--fixture', '200',
            str(pathlib.Path(seeded['dataRoot']) / 'default-user/chats/StartupSynthetic/startup-chat.jsonl'),
        ], cwd=REPO)
        server_log = open(temporary / 'server.log', 'w', encoding='utf-8')
        logs.append(server_log)
        server = lab.spawn([
            lab.NODE, 'server.js', '--configPath', seeded['configPath'], '--dataRoot', seeded['dataRoot'],
            '--port', str(seeded['port']), '--listen', 'false', '--listenAddressIPv4', '127.0.0.1',
            '--enableIPv4', 'true', '--enableIPv6', 'false', '--browserLaunchEnabled', 'false',
            '--ssl', 'false', '--exclusiveDataRoot', 'true',
        ], REPO, stdout=server_log)
        server._eq_log = server_log
        origin = f"http://127.0.0.1:{seeded['port']}/"
        lab.wait_http(origin + 'csrf-token', server)
        with lab.sync_playwright() as playwright:
            browser = lab.launch_chromium(playwright)
            try:
                context = browser.new_context(viewport={'width': 1440, 'height': 1000}, locale='en-US', has_touch=True)
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                report['cases'] = run_cases(page, origin)
                assert not errors, errors
                report['pageErrors'] = errors
                report['chromium'] = browser.version
                report['pass'] = True
                context.close()
            finally:
                browser.close()
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
        lab.log(lab.redact(traceback.format_exc()))
    finally:
        lab.stop_all()
        for handle in logs:
            handle.close()
        shutil.rmtree(temporary, ignore_errors=True)
    public = lab.redact(json.dumps(report, indent=2))
    public = re.sub(r'/tmp/st-scroll-[^\s\'\"]+', '<tmp>', public)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(public + '\n', encoding='utf-8')
    lab.log(f'wrote scroll evidence pass={report["pass"]}')
    if not report['pass']:
        sys.exit(1)


if __name__ == '__main__':
    main()
