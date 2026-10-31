#!/usr/bin/env python3
"""Adaptive streaming frame gaps in an isolated Python Playwright lab.

Run: python tests/browser-streaming-adaptive.py
Uses the real provider, formatter and StreamingProcessor. As in the streaming
race suite, only streaming rAF callbacks are held. A controlled 4ms frame grid
keeps all three gap decisions below their elapsed-time escape thresholds,
independent of the display refresh rate and browser RPC latency. MessageChannel
tasks and formatting run in the browser without a mocked performance clock.
Synthetic data and logs remain in a temporary directory for diagnosis.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile

from playwright.sync_api import sync_playwright
from lab_browser import launch_chromium


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('director_lab', ROOT / 'tests/browser-director-lab.py')
lab = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lab)
REPLY = ('The traveller follows the river. 中文流式文本完整。\n\n**Complete** and *correct*.\n\n'
         '```javascript\nconst river = "完整";\nconsole.log(river);\n```\n\n'
         + 'A quiet river flows. ' * 20 + 'The end.')


SCHEDULER = r"""
(() => {
  const nativeFrame = requestAnimationFrame.bind(window);
  const nativeCancel = cancelAnimationFrame.bind(window);
  const NativeChannel = MessageChannel;
  const probe = window.__adaptive = {
    active: false, frames: new Map(), sequence: 0, taskStart: null, frame: 0,
    taskCount: 0, waitFrame: () => new Promise(resolve => nativeFrame(resolve)),
    step() {
      const callbacks = [...this.frames.values()];
      this.frames.clear();
      this.frame++;
      const stamp = this.taskStart === null ? performance.now() : this.taskStart + this.frame * 4;
      for (const callback of callbacks) callback(stamp);
    },
  };
  window.requestAnimationFrame = callback => {
    if (probe.active && /armStreamingDomFrame|onStreamingFrame/.test(new Error().stack || '')) {
      const id = --probe.sequence;
      probe.frames.set(id, callback);
      return id;
    }
    return nativeFrame(callback);
  };
  window.cancelAnimationFrame = id => {
    if (!probe.frames.delete(id)) nativeCancel(id);
  };
  window.MessageChannel = function () {
    const channel = new NativeChannel();
    const post = channel.port2.postMessage.bind(channel.port2);
    // Registered before the product's onmessage handler.
    channel.port1.addEventListener('message', () => {
      if (!probe.active) return;
      probe.taskStart = performance.now();
      probe.frame = 0;
      queueMicrotask(() => probe.taskDone());
    });
    channel.port2.postMessage = (...args) => {
      if (probe.active && /queueStreamingDomTask/.test(new Error().stack || '')) {
        probe.taskCount++;
      }
      post(...args);
    };
    return channel;
  };
  // The query is read once by streaming-perf.js. Remove it only after module
  // evaluation so jQuery UI does not mistake local tabs for remote tabs.
  Object.defineProperty(window, '__stStreamingPerf', { configurable: true, set(value) {
    Object.defineProperty(window, '__stStreamingPerf', { value, configurable: true, writable: true });
    history.replaceState(null, '', location.pathname);
  } });
})();
"""


INSTALL_GATE = r"""
({ hold }) => {
  const probe = window.__adaptive;
  const ctx = SillyTavern.getContext();
  probe.tokens = 0;
  ctx.eventSource.on(ctx.eventTypes.STREAM_TOKEN_RECEIVED, async text => {
    probe.processor = SillyTavern.getContext().streamingProcessor;
    if (!hold) return;
    if (++probe.tokens < 8 || probe.ready) return;
    probe.ready = true;
    await new Promise(resolve => { probe.release = resolve; });
  });
  ctx.eventSource.once(ctx.eventTypes.GENERATION_ENDED, () => { probe.ended = true; });
}
"""


RUN_GAPS = r"""
async ({ reply, expectedGap, delay }) => {
  const probe = window.__adaptive;
  const { streamingFormatDelayMs } = await import('/scripts/streaming-perf.js');
  if (streamingFormatDelayMs !== delay) throw new Error('URL format-delay hook was not applied');
  await probe.waitFrame();
  await probe.waitFrame();
  probe.active = true;
  const processor = probe.processor;
  const gaps = [];
  for (let index = 0; index < 15; index++) {
    const text = reply.slice(0, 80 + index * 8);
    await processor.onProgressStreaming(processor.messageId, text, false);
    if (probe.frames.size !== 1) throw new Error('Expected one pending streaming frame');
    const before = probe.taskCount;
    let frames = 0;
    const done = new Promise(resolve => { probe.taskDone = resolve; });
    while (probe.taskCount === before && frames < 4) { probe.step(); frames++; }
    if (probe.taskCount !== before + 1) throw new Error('Expected one post-frame paint task');
    await done;
    const script = await import('/script.js');
    const message = SillyTavern.getContext().chat[processor.messageId];
    const expected = document.createElement('div');
    expected.innerHTML = script.messageFormatting(message.mes, message.name, message.is_system, message.is_user, processor.messageId, {}, false);
    if (processor.messageTextDom.textContent !== expected.textContent) throw new Error('Streaming paint lost text');
    gaps.push(frames);
  }
  // Discard startup and at least six real format samples before checking the
  // steady state. The retained six-sample moving average must choose the gap.
  const stable = gaps.slice(-6);
  if (!stable.every(gap => gap === expectedGap)) {
    throw new Error(`delay=${delay}: expected ${expectedGap} frames, got ${JSON.stringify(gaps)}`);
  }
  probe.active = false;
  probe.release();
  return { delay, expectedGap, gaps, stable };
}
"""


FINAL_TEXT = r"""
async reply => {
  const ctx = SillyTavern.getContext();
  const id = window.__adaptive.processor.messageId;
  const message = ctx.chat[id];
  const target = document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
  if (message.mes !== reply) throw new Error('Final chat text is incomplete or incorrect');
  if (target.querySelectorAll('pre code.language-javascript').length !== 1) throw new Error('Missing final language-marked code block');
  if (target.querySelectorAll('pre code .code-copy[tabindex="0"]').length !== 1) throw new Error('Missing final keyboard-accessible code-copy control');
  const response = await fetch('/api/chats/get', {
    method: 'POST', headers: ctx.getRequestHeaders(),
    body: JSON.stringify({ avatar_url: ctx.characters[ctx.characterId].avatar, file_name: ctx.getCurrentChatId() }),
  });
  if (!response.ok || (await response.json()).at(-1).mes !== reply) throw new Error('Saved final text differs');
  return { finalTextComplete: true, codeBlockAndCopyControlPresent: true, savedTextComplete: true, html: target.innerHTML };
}
"""


def run(args, temporary):
    temp = pathlib.Path(temporary)
    fake = server = None
    log_path = temp / 'server.log'
    try:
        fake_source = """const { createFakeOpenAI } = await import(process.argv[1]);
            const fake = await createFakeOpenAI({ reply:JSON.parse(process.argv[2]), rate:250, jitter:0 });
            console.log(JSON.stringify({ url:fake.url }));"""
        fake = subprocess.Popen([args.node, '--input-type=module', '-e', fake_source,
                                 (ROOT / 'scripts/fake-openai-endpoint.mjs').as_uri(), json.dumps(REPLY)],
                                cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        fake_url = json.loads(fake.stdout.readline())['url']
        port = lab.free_port()
        origin = f'http://127.0.0.1:{port}/'
        directory = temp / 'lab'
        directory.mkdir()
        prepare = """import fs from 'node:fs/promises';
            import path from 'node:path';
            import { pathToFileURL } from 'node:url';
            const [repo,directory,port,fakeUrl] = process.argv.slice(1);
            const { prepareTemporaryLab } = await import(pathToFileURL(path.join(repo,'scripts/longchat-lab-server.mjs')));
            const lab = await prepareTemporaryLab(directory, Number(port));
            const settings = JSON.parse(await fs.readFile(path.join(repo,'default/content/settings.json'),'utf8'));
            Object.assign(settings,{ firstRun:false,username:'Synthetic Tester',main_api:'openai' });
            Object.assign(settings.oai_settings,{ chat_completion_source:'custom',custom_url:fakeUrl,
                custom_model:'startup-synthetic',stream_openai:true });
            Object.assign(settings.power_user,{ auto_connect:false,optimized_streaming:true,
                smooth_streaming:false,stream_fade_in:false,streaming_fps:100,auto_swipe:false,continue_on_send:false });
            await fs.mkdir(path.join(lab.dataRoot,'default-user'),{ recursive:true });
            await fs.writeFile(path.join(lab.dataRoot,'default-user/settings.json'),JSON.stringify(settings));
            console.log(JSON.stringify(lab));"""
        seeded = json.loads(subprocess.check_output([args.node, '--input-type=module', '-e', prepare,
            str(ROOT), str(directory), str(port), fake_url], cwd=ROOT, text=True))
        env = {key: value for key, value in os.environ.items() if not key.upper().startswith('SILLYTAVERN_')}
        with log_path.open('w', encoding='utf-8') as logs:
            server = subprocess.Popen([args.node, 'server.js', '--configPath', seeded['configPath'],
                '--dataRoot', seeded['dataRoot'], '--port', str(port), '--listen', 'false',
                '--listenAddressIPv4', '127.0.0.1', '--enableIPv4', 'true', '--enableIPv6', 'false',
                '--browserLaunchEnabled', 'false', '--ssl', 'false', '--exclusiveDataRoot', 'true'],
                cwd=ROOT, env=env, stdout=logs, stderr=subprocess.STDOUT)
            lab.wait_http(origin, server)
            assert (pathlib.Path(seeded['dataRoot']) / '.st-lab-owner.lock').is_file()
            cases = []
            baseline_html = None
            with sync_playwright() as playwright:
                browser = launch_chromium(playwright)
                try:
                    for optimized, delay, expected_gap in [(False, 0, None), (True, 0, 1), (True, 10, 2), (True, 20, 3)]:
                        context = browser.new_context(viewport={'width': 1280, 'height': 800}, locale='en-US')
                        try:
                            page = context.new_page()
                            errors = []
                            page.on('pageerror', lambda error: errors.append(str(error)))
                            page.add_init_script(SCHEDULER)
                            query = '?stPerfStreaming=1' + (f'&stPerfFormatDelay={delay}' if delay else '')
                            lab.ready(page, origin, query)
                            sample = page.evaluate("""async () => {
                                const ctx = SillyTavern.getContext();
                                const form = new FormData();
                                form.set('ch_name','Adaptive Synthetic');
                                form.set('first_mes','Synthetic ready');
                                const response = await fetch('/api/characters/create', {
                                    method:'POST',headers:{'X-CSRF-Token':(await (await fetch('/csrf-token')).json()).token},body:form });
                                if (!response.ok) throw new Error('Synthetic create failed');
                                return { avatar:await response.text() };
                            }""")
                            lab.select_sample(page, sample, expected_messages=1)
                            page.evaluate("""async optimized => {
                                (await import('/scripts/power-user.js')).power_user.optimized_streaming = optimized;
                            }""", optimized)
                            page.evaluate("() => document.querySelector('#api_button_openai').click()")
                            page.wait_for_function("() => [...document.querySelectorAll('.online_status_text')].some(node => node.textContent.toLowerCase().includes('valid'))")
                            page.evaluate(INSTALL_GATE, {'hold': optimized})
                            page.locator('#send_textarea').fill('Continue the synthetic river story.')
                            page.locator('#send_but').click()
                            if optimized:
                                page.wait_for_function('() => window.__adaptive.ready', timeout=30000)
                                result = page.evaluate(RUN_GAPS, {'reply': REPLY, 'delay': delay, 'expectedGap': expected_gap})
                            else:
                                result = {'delay': 0, 'expectedGap': None}
                            page.wait_for_function('() => window.__adaptive.ended && !SillyTavern.getContext().streamingProcessor', timeout=30000)
                            # Allow the real keyboard MutationObserver to decorate
                            # copy controls before capturing either final path.
                            page.evaluate('async () => { await window.__adaptive.waitFrame(); await window.__adaptive.waitFrame(); }')
                            final = page.evaluate(FINAL_TEXT, REPLY)
                            html = final.pop('html')
                            if baseline_html is None:
                                baseline_html = html
                            assert html == baseline_html, 'Final HTML differs from optimized_streaming=false (no attributes ignored)'
                            result.update(final)
                            result.update({'optimized': optimized, 'finalDomMatchesUnoptimized': True,
                                           'finalHtmlSha256': hashlib.sha256(html.encode()).hexdigest()})
                            assert not errors, errors
                            cases.append(result)
                            print(f'optimized={optimized}, delay={delay}ms: {expected_gap} frame(s), final HTML matches baseline', flush=True)
                        finally:
                            context.close()
                    return {'pass': True, 'cases': cases, 'chromium': browser.version}
                finally:
                    browser.close()
    except Exception as error:
        tail = log_path.read_text(encoding='utf-8', errors='replace')[-3000:] if log_path.exists() else ''
        raise AssertionError(json.dumps(lab.redact({'error': str(error), 'serverLogTail': tail}, temporary))) from error
    finally:
        lab.stop(server)
        lab.stop(fake)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', default='node')
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / '.evidence/streaming-adaptive/results.json')
    args = parser.parse_args()
    temporary = tempfile.mkdtemp(prefix='st-adaptive-')
    result = lab.redact(run(args, temporary), temporary)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
