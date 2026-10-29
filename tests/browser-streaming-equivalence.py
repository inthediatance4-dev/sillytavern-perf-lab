#!/usr/bin/env python3
"""Streaming equivalence: an archived base vs this worktree.

Linux lab test (Playwright Chromium). Not part of npm test:perf.
Cases: DOM tail-patch, tab order, normal send, stop, continue, swipe,
impersonate, reasoning, group chat.

Ignored saved-chat fields (wall clock, not model output):
  gen_started, gen_finished, send_date, create_date, date_last_chat,
  extra.time_to_first_token, extra.reasoning_duration
  (also when copied onto swipe_info entries).
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

if sys.platform == 'win32':
    print('browser-streaming-equivalence is a Linux lab test; skipped on win32')
    sys.exit(0)

REPO = pathlib.Path(__file__).resolve().parents[1]
BASE_REV = 'ee771bb'
OPTIMIZED = True
SMOOTH = False
NODE = os.environ.get('LAB_NODE') or shutil.which('node') or 'node'
EVIDENCE = REPO / 'docs' / 'reviews' / '2026-10-28-grok-quality' / 'evidence' / 'streaming-opt' / 's1'
sys.path.insert(0, str(REPO / 'tests'))
from lab_browser import assert_lab_page, launch_chromium  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

IGNORED = [
    'gen_started',
    'gen_finished',
    'send_date',
    'create_date',
    'date_last_chat',
    'time_to_first_token',
    'reasoning_duration',
    'integrity',
    'gen_id',
]
PROMPT = 'Continue the synthetic river story.'
CHILDREN = []


def log(message):
    print(message, file=sys.stderr, flush=True)


def redact(value):
    text = value if isinstance(value, str) else json.dumps(value)
    host = socket.gethostname()
    for source, target in (
        (str(REPO), '<repo>'),
        (os.path.expanduser('~'), '<home>'),
        (host, '<host>'),
        ('/workspace', '<repo>'),
        ('/home/box', '<home>'),
    ):
        if source:
            text = text.replace(source, target)
    text = re.sub(r'/tmp/st-eq-[^\s\'"]+', '<tmp>', text)
    text = re.sub(r'http://127\.0\.0\.1:\d+', 'http://<host>', text)
    return text


def spawn(argv, cwd, env=None, stdout=subprocess.PIPE, stderr=None):
    child_env = env if env is not None else os.environ.copy()
    child_env = {key: value for key, value in child_env.items() if not key.upper().startswith('SILLYTAVERN_')}
    # Keep stderr off the URL pipe. Node warnings otherwise precede the JSON line.
    if stderr is None:
        stderr = subprocess.DEVNULL if stdout is subprocess.PIPE else subprocess.STDOUT
    proc = subprocess.Popen(
        argv,
        cwd=cwd,
        env=child_env,
        start_new_session=True,
        stdout=stdout,
        stderr=stderr,
        text=True,
    )
    CHILDREN.append(proc)
    return proc


def stop_all():
    for proc in CHILDREN:
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    deadline = time.time() + 5
    for proc in CHILDREN:
        remaining = deadline - time.time()
        try:
            proc.wait(timeout=max(0.1, remaining))
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def wait_http(url, proc, timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            log_handle = getattr(proc, '_eq_log', None)
            tail = ''
            if log_handle:
                log_handle.flush()
                tail = pathlib.Path(log_handle.name).read_text(encoding='utf-8', errors='replace')[-2000:]
            raise RuntimeError(redact(f'{url} exited {proc.returncode}: {tail}'))
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.2)
    raise TimeoutError(url)


def read_url_line(proc, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(redact(f'fake endpoint exited {proc.returncode}'))
        line = proc.stdout.readline()
        if not line:
            time.sleep(0.05)
            continue
        line = line.strip()
        if not line.startswith('{'):
            continue
        return json.loads(line)['url']
    raise TimeoutError('fake endpoint did not print its url')


def sha256(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def first_diff(left, right, limit=80):
    size = min(len(left), len(right))
    for index in range(size):
        if left[index] != right[index]:
            return {'index': index, 'left': left[max(0, index - 20):index + limit], 'right': right[max(0, index - 20):index + limit]}
    if len(left) != len(right):
        return {'index': size, 'leftLen': len(left), 'rightLen': len(right)}
    return None


def canonical_diff(left, right, path='$'):
    if type(left) is not type(right):
        return [{'path': path, 'left': left, 'right': right}]
    if isinstance(left, dict):
        diffs = []
        for key in sorted(set(left) | set(right)):
            if key not in left or key not in right:
                diffs.append({'path': f'{path}.{key}', 'left': left.get(key, '<missing>'), 'right': right.get(key, '<missing>')})
            else:
                diffs.extend(canonical_diff(left[key], right[key], f'{path}.{key}'))
            if len(diffs) > 12:
                break
        return diffs
    if isinstance(left, list):
        diffs = []
        if len(left) != len(right):
            diffs.append({'path': f'{path}.length', 'left': len(left), 'right': len(right)})
        for index, (item, other) in enumerate(zip(left, right)):
            diffs.extend(canonical_diff(item, other, f'{path}[{index}]'))
            if len(diffs) > 12:
                break
        return diffs
    if left != right:
        return [{'path': path, 'left': left, 'right': right}]
    return []


INSTALL_HOOKS = r"""
() => {
  const eq = window.__eq = { tokens: [], received: 0, rendered: 0, impersonate: 0, impersonateText: '', stopAt: 0, domWrites: [] };
  const html = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { ...html, set(value) {
    html.set.call(this, value);
    if (this.matches('#chat .mes_text')) eq.domWrites.push({tokenIndex:eq.tokens.length, epochMs:performance.timeOrigin + performance.now()});
  } });
  const ctx = SillyTavern.getContext();
  ctx.eventSource.on(ctx.eventTypes.STREAM_TOKEN_RECEIVED, (text) => {
    eq.tokens.push(String(text));
    if (eq.stopAt && eq.tokens.length >= eq.stopAt) {
      eq.stopAt = 0;
      ctx.stopGeneration();
    }
  });
  ctx.eventSource.on(ctx.eventTypes.MESSAGE_RECEIVED, () => { eq.received++; });
  ctx.eventSource.on(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, () => { eq.rendered++; });
  ctx.eventSource.on(ctx.eventTypes.IMPERSONATE_READY, (text) => { eq.impersonate++; eq.impersonateText = String(text ?? ''); });
}
"""

SNAPSHOT = r"""
async () => {
  const drop = new Set(['gen_started','gen_finished','send_date','create_date','date_last_chat','time_to_first_token','reasoning_duration','integrity','gen_id']);
  const strip = (value) => {
    if (Array.isArray(value)) return value.map(strip);
    if (value instanceof Date) return '<date>';
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) {
        if (drop.has(key) || typeof item === 'function' || typeof item === 'symbol') continue;
        out[key] = strip(item);
      }
      return out;
    }
    return value;
  };
  const ctx = SillyTavern.getContext();
  const last = document.querySelector('#chat .mes.last_mes') || document.querySelector('#chat .mes:last-child');
  const textNode = last?.querySelector('.mes_text');
  const reasoningNode = last?.querySelector('.mes_reasoning');
  const before = textNode ? textNode.innerHTML : '';
  let direct = before;
  let directError = '';
  if (last && textNode) {
    try {
      const id = Number(last.getAttribute('mesid'));
      const message = ctx.chat[id];
      const script = await import('/script.js');
      const formatted = script.messageFormatting(message.mes, message.name, message.is_system, message.is_user, id, {}, false);
      const holder = document.createElement('div');
      holder.setAttribute('data-eq-probe', '1');
      holder.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;';
      const probe = document.createElement('div');
      probe.className = 'mes_text';
      probe.innerHTML = formatted;
      holder.appendChild(probe);
      script.addCopyToCodeBlocks(holder);
      // Copy buttons gain tabindex="0" only once connected (keyboard.js observer).
      document.body.appendChild(holder);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      direct = probe.innerHTML;
      holder.remove();
    } catch (error) {
      directError = String(error);
    }
  }
  const headers = ctx.getRequestHeaders();
  const chatId = String(ctx.getCurrentChatId() || '');
  let disk = null;
  let diskError = '';
  try {
    const response = ctx.groupId
      ? await fetch('/api/chats/group/get', { method: 'POST', headers, body: JSON.stringify({ id: chatId }) })
      : await fetch('/api/chats/get', { method: 'POST', headers, body: JSON.stringify({
          avatar_url: ctx.characters[ctx.characterId].avatar,
          file_name: chatId.replace(/\.jsonl$/, ''),
        }) });
    disk = await response.json();
  } catch (error) {
    diskError = String(error);
  }
  const dom = window.__stStreamingDom ? { ...window.__stStreamingDom } : null;
  return {
    tokens: window.__eq.tokens,
    received: window.__eq.received,
    rendered: window.__eq.rendered,
    impersonate: window.__eq.impersonate,
    impersonateText: window.__eq.impersonateText,
    textarea: document.querySelector('#send_textarea')?.value ?? '',
    chatLength: ctx.chat.length,
    memory: strip(ctx.chat),
    disk: strip(disk),
    diskError,
    mesText: before,
    direct,
    directError,
    directEqual: before === direct && !directError,
    reasoningHtml: reasoningNode ? reasoningNode.innerHTML : '',
    header: last?.querySelector('.mes_reasoning_header_title')?.textContent ?? '',
    dom,
    chatCount: document.querySelectorAll('#chat').length,
    group: Boolean(ctx.groupId),
    domWrites: window.__eq.domWrites,
  };
}
"""


def boot(page, origin, probe):
    if probe:
        # Evaluated as a script, not called as a function. Strip the probe flag
        # before jQuery UI treats the query as a remote tab and duplicates the page.
        page.add_init_script("""
          Object.defineProperty(window, '__stStreamingPerf', { configurable: true, set(value) {
            Object.defineProperty(window, '__stStreamingPerf', { value, configurable: true, writable: true });
            const url = new URL(location.href);
            url.searchParams.delete('stPerfStreaming');
            history.replaceState(null, '', url);
          } });
        """)
        page.goto(origin + '?stPerfStreaming=1', wait_until='domcontentloaded', timeout=90000)
    else:
        page.goto(origin, wait_until='domcontentloaded', timeout=90000)
    page.wait_for_function("""() => {
      const dialog = document.querySelector('dialog[open]');
      if (dialog?.querySelector('.onboarding')) {
        const input = [...dialog.querySelectorAll('input[type=text]')].at(-1);
        if (input) { input.value = 'Synthetic Tester'; input.dispatchEvent(new Event('input', { bubbles: true })); }
        dialog.querySelector('.popup-button-ok')?.click();
      }
      return window.SillyTavern?.getContext && !dialog && !document.querySelector('.splash-screen') && document.querySelector('.character_select');
    }""", timeout=90000)
    assert_lab_page(page, origin)
    if page.locator('#chat').count() != 1 or page.locator('#send_textarea').count() != 1:
        raise AssertionError('duplicate chat or composer')
    page.wait_for_function("""() => (window.SillyTavern.getContext().characters || []).some(item => item && item.name === 'Startup Synthetic')""", timeout=20000)
    page.evaluate("""async () => {
      const ctx = SillyTavern.getContext();
      const index = ctx.characters.findIndex(item => item.name === 'Startup Synthetic');
      if (index < 0) {
        const names = (ctx.characters || []).map(item => item && item.name).slice(0, 15).join('|');
        throw new Error('missing fixture card; count=' + (ctx.characters || []).length + '; names=' + names);
      }
      await ctx.selectCharacterById(String(index));
    }""")
    page.wait_for_function("""() => {
      const ctx = SillyTavern.getContext();
      return ctx.chat?.length >= 1 && document.querySelector('#chat .mes .mes_text');
    }""", timeout=30000)
    # The connect control lives in a closed panel. A DOM click still runs its handler.
    page.evaluate("() => document.querySelector('#api_button_openai').click()")
    page.wait_for_function("""() => [...document.querySelectorAll('.online_status_text')].some(item => item.textContent.toLowerCase().includes('valid'))""", timeout=20000)
    page.evaluate(INSTALL_HOOKS)
    page.wait_for_timeout(300)


def tab_order(page):
    # initExtensions shows #extensionsMenuButton immediately. A 1s interval then
    # hides it when the menu has no visible items. Snapshot only after that matches.
    page.wait_for_function(r"""() => {
      const button = document.querySelector('#extensionsMenuButton');
      if (!button) return false;
      const shown = getComputedStyle(button).display !== 'none';
      const items = [...document.querySelectorAll('#extensionsMenu > *')].some(el => getComputedStyle(el).display !== 'none');
      return shown === items;
    }""", timeout=4000)
    return page.evaluate(r"""() => [...document.querySelectorAll('a, button, input, textarea, select, [tabindex]')]
      .filter(el => !el.closest('#chat') && !el.closest('.toast') && !el.closest('dialog'))
      .filter(el => el.tabIndex >= 0 && !el.disabled)
      .filter(el => {
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
      })
      .map(el => `${el.tagName}#${el.id}|${el.getAttribute('name') || ''}|${String(el.className).split(/\s+/).slice(0, 2).join('.')}`)""")


def reset_case(page, stop_at=0):
    page.evaluate("""(stopAt) => {
      const eq = window.__eq;
      eq.tokens = [];
      eq.received = 0;
      eq.rendered = 0;
      eq.impersonate = 0;
      eq.impersonateText = '';
      eq.stopAt = stopAt;
      eq.domWrites = [];
      const dom = window.__stStreamingDom;
      if (dom) { dom.incremental = 0; dom.full = 0; dom.fade = 0; dom.frames = 0; }
    }""", stop_at)


def wait_stream(page, kind, timeout=90000):
    if kind == 'impersonate':
        page.wait_for_function("""() => {
          const stop = document.querySelector('#mes_stop');
          return window.__eq.impersonate >= 1 && !SillyTavern.getContext().streamingProcessor && stop && getComputedStyle(stop).display === 'none';
        }""", timeout=timeout)
    else:
        page.wait_for_function("""() => {
          const stop = document.querySelector('#mes_stop');
          return window.__eq.rendered >= 1 && !SillyTavern.getContext().streamingProcessor && stop && getComputedStyle(stop).display === 'none';
        }""", timeout=timeout)
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")


def new_chat(page):
    page.evaluate("async () => { await SillyTavern.getContext().executeSlashCommands('/newchat'); }")
    page.wait_for_function("""() => {
      const ctx = SillyTavern.getContext();
      return !ctx.groupId && ctx.chat?.length === 1 && !ctx.streamingProcessor && document.querySelectorAll('#chat .mes').length === 1;
    }""", timeout=30000)


def send(page, text=PROMPT):
    # Set the composer the same way the app does. Playwright fill() sometimes
    # reports success while the textarea is empty on the streaming page.
    page.evaluate("""(text) => {
      const el = document.querySelector('#send_textarea');
      el.focus();
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }""", text)
    page.evaluate("() => document.querySelector('#send_but').click()")


def click_id(page, element_id):
    page.evaluate("""(id) => { const node = document.querySelector(id); if (!node) throw new Error('missing ' + id); node.click(); }""", element_id)


def summarize(side, raw, expect_events=True):
    tokens = raw['tokens']
    memory = raw['memory']
    disk = raw['disk'] if isinstance(raw['disk'], list) else {'invalid': raw['disk']}
    return {
        'side': side,
        'tokenCount': len(tokens),
        'tokenSha256': sha256(json.dumps(tokens, ensure_ascii=False)),
        'tokens': tokens,
        'received': raw['received'],
        'rendered': raw['rendered'],
        'impersonate': raw['impersonate'],
        'impersonateText': raw['impersonateText'],
        'textarea': raw['textarea'],
        'chatLength': raw['chatLength'],
        'memory': memory,
        'disk': disk,
        'diskError': raw['diskError'],
        'mesText': raw['mesText'],
        'direct': raw['direct'],
        'directEqual': raw['directEqual'],
        'directError': raw['directError'],
        'reasoningHtml': raw['reasoningHtml'],
        'header': raw['header'],
        'dom': raw['dom'],
        'chatCount': raw['chatCount'],
        'group': raw['group'],
        'expectEvents': expect_events,
        'domWrites': raw['domWrites'],
    }


def run_side(browser, origin, probe):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, locale='en-US')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    out = {'errors': errors}
    try:
        boot(page, origin, probe)
        if probe:
            page.wait_for_function("document.querySelector('#directorButton') !== null", timeout=15000)
        out['settings'] = page.evaluate("""async () => {
          const p = (await import('/scripts/power-user.js')).power_user;
          return {smooth_streaming:p.smooth_streaming, optimized_streaming:p.optimized_streaming ?? null,
            optimizedCheckbox:document.querySelector('#optimized_streaming')?.checked ?? null};
        }""")
        if out['settings']['smooth_streaming'] != SMOOTH:
            raise AssertionError('smooth setting did not load')
        if probe and (out['settings']['optimized_streaming'] != OPTIMIZED or out['settings']['optimizedCheckbox'] != OPTIMIZED):
            raise AssertionError('optimized setting/checkbox did not load')
        out['tabOrder'] = tab_order(page)
        if probe:
            out['patch'] = page.evaluate("""async () => {
              const { replaceStreamingHtml } = await import('/script.js');
              const element = document.createElement('div');
              element.innerHTML = '<p>one</p><p>two</p><p>three</p>';
              const extended = replaceStreamingHtml(element, '<p>one</p><p>two</p><p>FOUR</p><p>five</p>', true);
              const extendedText = [...element.children].map(node => node.textContent);
              const shrunk = replaceStreamingHtml(element, '<p>one</p>', true);
              const shrunkCount = element.children.length;
              const replaced = replaceStreamingHtml(element, '<div>x</div><p>one</p>', true);
              const replacedName = element.firstChild.nodeName;
              element.innerHTML = '<p>keep</p>';
              const forced = replaceStreamingHtml(element, '<p>other</p>', false);
              return {
                extended, extendedText, shrunk, shrunkCount, replaced, replacedName, forced,
                forcedText: element.textContent,
              };
            }""")
        reset_case(page)
        send(page)
        wait_stream(page, 'send')
        out['normal'] = summarize('normal', page.evaluate(SNAPSHOT))
        new_chat(page)
        reset_case(page, 8)
        send(page)
        wait_stream(page, 'stop')
        out['stop'] = summarize('stop', page.evaluate(SNAPSHOT))
        reset_case(page)
        click_id(page, '#option_continue')
        wait_stream(page, 'continue')
        out['continue'] = summarize('continue', page.evaluate(SNAPSHOT))
        reset_case(page)
        click_id(page, '#chat .mes.last_mes .swipe_right')
        wait_stream(page, 'swipe')
        out['swipe'] = summarize('swipe', page.evaluate(SNAPSHOT))
        new_chat(page)
        before_len = page.evaluate("() => SillyTavern.getContext().chat.length")
        reset_case(page)
        click_id(page, '#option_impersonate')
        wait_stream(page, 'impersonate')
        impersonate = summarize('impersonate', page.evaluate(SNAPSHOT), expect_events=False)
        impersonate['lengthBefore'] = before_len
        out['impersonate'] = impersonate
        new_chat(page)
        page.evaluate("""async (url) => {
          const openai = await import('/scripts/openai.js');
          openai.oai_settings.custom_url = url;
          const input = document.querySelector('#custom_api_url_text');
          if (input) { input.value = url; input.dispatchEvent(new Event('input', { bubbles: true })); }
        }""", out_reasoning_url)
        reset_case(page)
        send(page)
        wait_stream(page, 'reasoning')
        out['reasoning'] = summarize('reasoning', page.evaluate(SNAPSHOT))
        out['group'] = run_group(page)
        out['errors'] = errors
        return out
    except Exception:
        log('page errors: ' + ' | '.join(redact(item) for item in errors[:12]))
        raise
    finally:
        context.close()


def run_group(page):
    page.evaluate("""async (url) => {
      const openai = await import('/scripts/openai.js');
      openai.oai_settings.custom_url = url;
      const input = document.querySelector('#custom_api_url_text');
      if (input) { input.value = url; input.dispatchEvent(new Event('input', { bubbles: true })); }
    }""", out_plain_url)
    created = page.evaluate("""async () => {
      const ctx = SillyTavern.getContext();
      const avatar = ctx.characters[ctx.characterId].avatar;
      const response = await fetch('/api/groups/create', {
        method: 'POST',
        headers: ctx.getRequestHeaders(),
        body: JSON.stringify({
          name: 'Eq Group',
          members: [avatar],
          activation_strategy: 1,
          generation_mode: 0,
          chat_id: 'eq-group',
          chats: ['eq-group'],
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error('group create failed ' + response.status);
      const groups = await import('/scripts/group-chats.js');
      await groups.getGroups();
      const opened = await groups.openGroupById(String(body.id));
      return { id: String(body.id), opened, chatId: body.chat_id };
    }""")
    if not created.get('opened'):
        raise AssertionError(f'group did not open: {created}')
    page.wait_for_function("""() => {
      const ctx = SillyTavern.getContext();
      return !!ctx.groupId && document.querySelector('#chat .mes') && !ctx.streamingProcessor;
    }""", timeout=30000)
    reset_case(page)
    send(page, 'Hello from the group.')
    wait_stream(page, 'group')
    snap = summarize('group', page.evaluate(SNAPSHOT))
    snap['groupMeta'] = {'opened': True, 'chatId': created.get('chatId')}
    return snap


# Set in main before run_side so the page can switch providers.
out_plain_url = ''
out_reasoning_url = ''


def compare_case(name, base, head, once=True):
    problems = []
    if base['chatCount'] != 1 or head['chatCount'] != 1:
        problems.append('duplicate #chat')
    if base['tokenSha256'] != head['tokenSha256'] or base['tokenCount'] != head['tokenCount']:
        mismatch = next((index for index, (left, right) in enumerate(zip(base['tokens'], head['tokens'])) if left != right), None)
        problems.append({'tokens': {'base': base['tokenCount'], 'head': head['tokenCount'], 'index': mismatch}})
    if once:
        for key in ('received', 'rendered'):
            if base[key] != 1 or head[key] != 1:
                problems.append({key: {'base': base[key], 'head': head[key]}})
    if name != 'impersonate':
        if not base['directEqual'] or not head['directEqual']:
            problems.append({
                'directRender': {'base': base['directEqual'], 'head': head['directEqual'], 'baseError': base['directError'], 'headError': head['directError']},
                'baseDiff': first_diff(base['mesText'], base['direct']),
                'headDiff': first_diff(head['mesText'], head['direct']),
            })
        if base['mesText'] != head['mesText']:
            problems.append({'mesText': first_diff(base['mesText'], head['mesText'])})
        if base['direct'] != base['mesText'] or head['direct'] != head['mesText']:
            problems.append('direct render diverged from streamed html')
        if base['reasoningHtml'] != head['reasoningHtml']:
            problems.append({'reasoningHtml': first_diff(base['reasoningHtml'], head['reasoningHtml'])})
        memory = canonical_diff(base['memory'], head['memory'])
        disk = canonical_diff(base['disk'], head['disk'])
        if memory:
            problems.append({'memory': memory})
        if disk:
            problems.append({'disk': disk})
        if base['diskError'] or head['diskError']:
            problems.append({'diskError': {'base': base['diskError'], 'head': head['diskError']}})
    result = {
        'pass': not problems,
        'problems': problems,
        'tokenCount': {'base': base['tokenCount'], 'head': head['tokenCount']},
        'received': {'base': base['received'], 'head': head['received']},
        'rendered': {'base': base['rendered'], 'head': head['rendered']},
        'mesTextSha256': sha256(head['mesText']) if name != 'impersonate' else None,
        'directEqual': {'base': base.get('directEqual'), 'head': head.get('directEqual')},
        'chatLength': {'base': base['chatLength'], 'head': head['chatLength']},
        'headDom': head.get('dom'),
        'tokensEqual': base['tokens'] == head['tokens'],
        'tokenOrderSha256': {'base': base['tokenSha256'], 'head': head['tokenSha256']},
        'mesTextEqual': base['mesText'] == head['mesText'],
        'memoryEqual': base['memory'] == head['memory'],
        'jsonlEqual': base['disk'] == head['disk'],
        'jsonlSha256': {side: sha256(json.dumps(value['disk'], sort_keys=True, ensure_ascii=False)) for side, value in [('base', base), ('head', head)]},
        'domUpdateCounts': {'base': len(base['domWrites']), 'head': len(head['domWrites'])},
    }
    if name == 'impersonate':
        length_same = base['lengthBefore'] == base['chatLength'] == head['lengthBefore'] == head['chatLength']
        text_same = base['textarea'] == head['textarea'] and base['impersonateText'] == head['impersonateText'] and bool(base['textarea'])
        events_clear = base['received'] == head['received'] == 0 and base['rendered'] == head['rendered'] == 0 and base['impersonate'] == head['impersonate'] == 1
        if not length_same:
            problems.append('impersonate changed chat length')
        if not text_same:
            problems.append('impersonate textarea mismatch')
        if not events_clear:
            problems.append('impersonate events')
        memory = canonical_diff(base['memory'], head['memory'])
        if memory:
            problems.append({'memory': memory})
        result['pass'] = not problems
        result['problems'] = problems
        result['textareaSha256'] = sha256(head['textarea'])
    if not OPTIMIZED and head.get('dom'):
        if head['dom'].get('incremental', 0) != 0 or head['dom'].get('frames', 0) != 0:
            problems.append({'disabledOptimizationStillCoalescedOrPatched': head['dom']})
            result['pass'] = False
            result['problems'] = problems
    if name == 'normal' and OPTIMIZED and head.get('dom'):
        if head['dom'].get('incremental', 0) < 1 or head['dom'].get('frames', 0) < 1 or head['dom'].get('full', 0) < 1:
            problems.append({'domStats': head['dom']})
            result['pass'] = False
            result['problems'] = problems
    return result


def main():
    global out_plain_url, out_reasoning_url, BASE_REV, OPTIMIZED, SMOOTH
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default=BASE_REV)
    parser.add_argument('--optimized', choices=['on', 'off'], default='on')
    parser.add_argument('--smooth', action='store_true')
    parser.add_argument('--output', type=pathlib.Path, default=EVIDENCE / 'equivalence.json')
    args = parser.parse_args()
    BASE_REV, OPTIMIZED, SMOOTH = args.base, args.optimized == 'on', args.smooth
    output = args.output
    temp = pathlib.Path(tempfile.mkdtemp(prefix='st-eq-'))
    report = {
        'baseRevision': BASE_REV,
        'head': 'WORKTREE',
        'optimized': OPTIMIZED,
        'smooth': SMOOTH,
        'extensions': 'Built-in extensions enabled; unrelated third-party extensions disabled on both products.',
        'cadence': 'Final HTML/data and event count/order are exact assertions. Per-run synchronous .mes_text innerHTML write counts are reported; wall-clock tick cadence is not asserted across independent runs.',
        'ignoredFields': IGNORED,
        'ignoredFieldReasons': {
            'gen_started': 'Wall-clock start of this generation.',
            'gen_finished': 'Wall-clock end of this generation.',
            'send_date': 'Message timestamp assigned when the row is created.',
            'create_date': 'Chat-file header timestamp. Message bodies are compared instead.',
            'date_last_chat': 'Character or group recency timestamp, not message text.',
            'time_to_first_token': 'Latency from generation start to the first token.',
            'reasoning_duration': 'Wall-clock reasoning duration. The header "Thought for …" and data-duration are derived from it; .mes_reasoning HTML is compared exactly.',
            'integrity': 'Random UUID assigned on save (uuidv4), not a hash of the message text.',
            'gen_id': 'Group batch id. Greeting uses Date.now()*Math.random(); a reply uses Date.now().',
        },
        'note': 'Optimized mode paints first visible content immediately; subsequent writes can lag STREAM_TOKEN_RECEIVED by a frame plus its post-frame task. Slow formatting can skip one or two more frames. Finish paints immediately. OFF mode uses synchronous full writes; S2 follow-bottom remains enabled.',
        'pass': False,
        'cases': {},
    }
    try:
        logs = {}
        log('starting fake endpoints')
        plain_log = open(temp / 'plain-fake.log', 'w', encoding='utf-8')
        reasoning_log = open(temp / 'reasoning-fake.log', 'w', encoding='utf-8')
        plain = spawn([NODE, str(REPO / 'scripts' / 'fake-openai-endpoint.mjs'), '--port', '0', '--tokens', '180', '--rate', '400', '--jitter', '0', '--seed', 'eq-s1'], REPO, stderr=plain_log)
        reasoning = spawn([NODE, str(REPO / 'scripts' / 'fake-openai-endpoint.mjs'), '--port', '0', '--tokens', '180', '--rate', '400', '--jitter', '0', '--seed', 'eq-s1', '--reasoning'], REPO, stderr=reasoning_log)
        out_plain_url = read_url_line(plain)
        plain_url = out_plain_url
        out_reasoning_url = read_url_line(reasoning)
        log('archiving base and seeding labs')
        base_dir = temp / 'base'
        base_dir.mkdir()
        archive = temp / 'base.tar'
        subprocess.check_call(['git', 'archive', '--output', str(archive), BASE_REV], cwd=REPO)
        subprocess.check_call(['tar', '-xf', str(archive), '-C', str(base_dir)])
        os.symlink(os.path.realpath(REPO / 'node_modules'), base_dir / 'node_modules')
        seed = temp / 'seed.mjs'
        seed.write_text(SEED_JS, encoding='utf-8')
        origins = {}
        for label, product in (('base', base_dir), ('head', REPO)):
            lab_dir = temp / f'{label}-data'
            lab_dir.mkdir()
            port = free_port()
            seeded = json.loads(subprocess.check_output([NODE, str(seed), str(product), str(lab_dir), str(port), plain_url, 'on' if SMOOTH else 'off', 'on' if OPTIMIZED else 'off'], cwd=REPO, text=True))
            log_handle = open(temp / f'{label}-server.log', 'w', encoding='utf-8')
            proc = spawn([
                NODE, 'server.js',
                '--configPath', seeded['configPath'],
                '--dataRoot', seeded['dataRoot'],
                '--port', str(seeded['port']),
                '--listen', 'false',
                '--listenAddressIPv4', '127.0.0.1',
                '--enableIPv4', 'true',
                '--enableIPv6', 'false',
                '--browserLaunchEnabled', 'false',
                '--ssl', 'false',
                '--exclusiveDataRoot', 'true',
            ], product, stdout=log_handle)
            proc._eq_log = log_handle
            logs[label] = log_handle
            origin = f"http://127.0.0.1:{seeded['port']}/"
            wait_http(origin + 'csrf-token', proc)
            origins[label] = origin
            disk_chars = list((pathlib.Path(seeded['dataRoot']) / 'default-user' / 'characters').glob('*.png'))
            log(f'{label} lab ready disk={len(disk_chars)}')
        with sync_playwright() as playwright:
            browser = launch_chromium(playwright)
            try:
                log('running base')
                base = run_side(browser, origins['base'], False)
                log('running head')
                head = run_side(browser, origins['head'], True)
            finally:
                browser.close()
        report['settings'] = {'base': base['settings'], 'head': head['settings']}
        report['tabOrderEqual'] = base['tabOrder'] == head['tabOrder']
        director_tabs = [item for item in head['tabOrder'] if item.startswith('DIV#directorButton|')]
        report['tabOrderEqualExceptDirector'] = len(director_tabs) == 1 and base['tabOrder'] == [item for item in head['tabOrder'] if item not in director_tabs]
        report['tabOrder'] = {
                'base': base['tabOrder'],
                'head': head['tabOrder'],
                'baseLen': len(base['tabOrder']),
                'headLen': len(head['tabOrder']),
                'baseOnly': [item for item in base['tabOrder'] if item not in head['tabOrder']][:20],
                'headOnly': [item for item in head['tabOrder'] if item not in base['tabOrder']][:20],
                'intentionalExtra': '🎬 Director button beside the extensions menu',
        }
        patch = head.get('patch') or {}
        patch_ok = patch == {
            'extended': 'incremental',
            'extendedText': ['one', 'two', 'FOUR', 'five'],
            'shrunk': 'incremental',
            'shrunkCount': 1,
            'replaced': 'full',
            'replacedName': 'DIV',
            'forced': 'full',
            'forcedText': 'other',
        }
        report['cases']['domPatch'] = {'pass': patch_ok, 'patch': patch}
        for name in ('normal', 'stop', 'continue', 'swipe', 'reasoning', 'group'):
            report['cases'][name] = compare_case(name, base[name], head[name], once=True)
            log(f"{name}: {'pass' if report['cases'][name]['pass'] else 'FAIL'}")
        report['cases']['impersonate'] = compare_case('impersonate', base['impersonate'], head['impersonate'], once=False)
        log(f"impersonate: {'pass' if report['cases']['impersonate']['pass'] else 'FAIL'}")
        def notable(items):
            return [redact(item) for item in items if 'Failed to load resource' not in item][:8]
        base_errors, head_errors = notable(base['errors']), notable(head['errors'])
        if base_errors or head_errors:
            report['pageErrors'] = {'base': base_errors, 'head': head_errors}
        report['pass'] = report['tabOrderEqualExceptDirector'] and patch_ok and all(item['pass'] for item in report['cases'].values()) and not base_errors and not head_errors
    except Exception as error:
        report['error'] = redact(f'{type(error).__name__}: {error}')
        tails = {}
        for label, handle in logs.items():
            try:
                handle.flush()
                tails[label] = redact(pathlib.Path(handle.name).read_text(encoding='utf-8', errors='replace')[-1500:])
            except OSError:
                continue
        if tails:
            report['serverLogTail'] = tails
        log(report['error'])
        report['pass'] = False
    finally:
        stop_all()
        shutil.rmtree(temp, ignore_errors=True)
    public = json.loads(json.dumps(report))
    for case in public.get('cases', {}).values():
        case.pop('tokens', None)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(public, indent=2) + '\n', encoding='utf-8')
    log(f"wrote evidence pass={public['pass']}")
    if not public['pass']:
        sys.exit(1)


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


SEED_JS = r"""
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('<REPO>/package.json');
const yaml = require('yaml');
const { prepareTemporaryLab } = await import('<REPO>/scripts/longchat-lab-server.mjs');
const { write: writeCard } = await import('<REPO>/src/character-card-parser.js');

const [product, dataDir, portText, plainUrl, smooth = 'off', optimized = 'on'] = process.argv.slice(2);
const lab = await prepareTemporaryLab(dataDir, Number(portText));
const config = yaml.parse(await fs.readFile(lab.configPath, 'utf8'));
config.extensions.enabled = true;
await fs.writeFile(lab.configPath, yaml.stringify(config));
const settings = JSON.parse(await fs.readFile(path.join(product, 'default/content/settings.json'), 'utf8'));
Object.assign(settings, { firstRun: false, username: 'Synthetic Tester', main_api: 'openai' });
Object.assign(settings.oai_settings, {
    chat_completion_source: 'custom', custom_url: plainUrl, custom_model: 'startup-synthetic', stream_openai: true, show_thoughts: true,
});
Object.assign(settings.power_user, {
    auto_connect: true, chat_truncation: 100, smooth_streaming: smooth === 'on', optimized_streaming: optimized === 'on', stream_fade_in: false, streaming_fps: 30, auto_swipe: false, continue_on_send: false,
});
settings.extension_settings.disabledExtensions = (await fs.readdir(path.join(product, 'public/scripts/extensions/third-party'))).map(name => `third-party/${name}`);
settings.extension_settings.notifyUpdates = false;
const user = path.join(lab.dataRoot, 'default-user');
await fs.mkdir(path.join(user, 'characters'), { recursive: true });
await fs.mkdir(path.join(user, 'chats', 'StartupSynthetic'), { recursive: true });
await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify(settings));
const card = { name: 'Startup Synthetic', description: 'Synthetic streaming fixture', personality: '', scenario: '', first_mes: 'Synthetic ready', mes_example: '', creatorcomment: '', avatar: 'none', chat: 'startup-chat', talkativeness: '0.5', fav: false, spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Startup Synthetic', description: 'Synthetic streaming fixture', personality: '', scenario: '', first_mes: 'Synthetic ready', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '', character_version: '', extensions: { talkativeness: '0.5', fav: false } } };
const png = writeCard(await fs.readFile(path.join(product, 'public/img/ai4.png')), JSON.stringify(card));
await fs.writeFile(path.join(user, 'characters', 'StartupSynthetic.png'), png);
// Authors Note initializes these defaults on chat load. Seed them equally so a
// fast first generation cannot race its debounced metadata save on either side.
const header = { user_name: 'Synthetic Tester', character_name: 'Startup Synthetic', create_date: '2026-1-1@00h00m00s',
    chat_metadata: { note_depth: 4, note_interval: 1, note_position: 1, note_prompt: '', note_role: 0 } };
const greeting = { name: 'Startup Synthetic', is_user: false, is_system: false, send_date: '2026-1-1@00h00m00s', mes: 'Synthetic ready', extra: {} };
await fs.writeFile(path.join(user, 'chats', 'StartupSynthetic', 'startup-chat.jsonl'), JSON.stringify(header) + '\n' + JSON.stringify(greeting) + '\n');
const index = JSON.parse(await fs.readFile(path.join(product, 'default/content/index.json'), 'utf8'));
await fs.writeFile(path.join(user, 'content.log'), index.filter(item => item.type === 'character').map(item => item.filename).join('\n'));
process.stdout.write(JSON.stringify(lab));
"""


if __name__ == '__main__':
    SEED_JS = SEED_JS.replace('<REPO>', REPO.as_posix())
    main()
