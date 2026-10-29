#!/usr/bin/env python3
"""Deterministic deferred-streaming paint races in an isolated Chromium lab.

The real StreamingProcessor consumes the fake provider. Only its frame callbacks
and MessageChannel deliveries are held, so terminal actions can run with a known
pending frame or post-frame task. Cancelled callbacks are also delivered once to
prove that the session token protects the write, independently of cancellation.
This Linux Playwright suite is local acceptance coverage, not npm test:perf.
"""
import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile


REPO = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('streaming_equivalence', REPO / 'tests' / 'browser-streaming-equivalence.py')
lab = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lab)
EVIDENCE = REPO / 'docs/reviews/2026-10-28-grok-quality/evidence/streaming-opt/m1'
REPLY = ('Plain 中文 streaming fixture. The traveller follows the river.\n\n' * 5) + '```javascript\nconst river = "complete";\n```'


SCHEDULER = r"""
(() => {
  const nativeFrame = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const NativeChannel = window.MessageChannel;
  const race = window.__race = {
    active: false, frames: [], tasks: [], cancelled: 0, framePosts: 0,
    taskPosts: 0, frameDeliveries: 0, taskDeliveries: 0, sequence: 0,
    waitFrame: () => new Promise(resolve => nativeFrame(resolve)),
    async stepFrame(includeCancelled = false) {
      await this.waitFrame();
      const callbacks = this.frames.splice(0);
      for (const entry of callbacks) {
        if (!entry.cancelled || includeCancelled) {
          this.frameDeliveries++;
          entry.callback(performance.now());
        }
      }
    },
    async drain() {
      // A cancellation is deliberately insufficient: run even cancelled frames.
      await this.stepFrame(true);
      const callbacks = this.tasks.splice(0);
      for (const callback of callbacks) { this.taskDeliveries++; callback(); }
      await this.waitFrame();
      await this.waitFrame();
    },
  };
  window.requestAnimationFrame = callback => {
    const stack = new Error().stack || '';
    if (race.active && /armStreamingDomFrame|onStreamingFrame/.test(stack)) {
      const entry = { id: --race.sequence, callback, cancelled: false };
      race.frames.push(entry);
      race.framePosts++;
      return entry.id;
    }
    return nativeFrame(callback);
  };
  window.cancelAnimationFrame = id => {
    const entry = race.frames.find(item => item.id === id);
    if (entry) { entry.cancelled = true; race.cancelled++; }
    else nativeCancel(id);
  };
  window.MessageChannel = function () {
    const channel = new NativeChannel();
    const post = channel.port2.postMessage.bind(channel.port2);
    channel.port2.postMessage = (...args) => {
      const stack = new Error().stack || '';
      if (race.active && /queueStreamingDomTask/.test(stack)) {
        race.taskPosts++;
        race.tasks.push(() => post(...args));
      } else post(...args);
    };
    return channel;
  };
})();
"""

INSTALL_GATE = r"""
(options) => {
  const race = window.__race;
  const ctx = SillyTavern.getContext();
  race.options = options;
  race.tokens = 0;
  race.ready = false;
  ctx.eventSource.on(ctx.eventTypes.STREAM_TOKEN_RECEIVED, async text => {
    race.tokens++;
    const complete = String(text) === options.reply;
    if (race.ready || (options.midstream ? race.tokens < 8 : !complete)) return;
    race.processor = SillyTavern.getContext().streamingProcessor;
    race.text = String(text);
    // Pause inside the real unbatched token event, before its stopwatch tick.
    race.ready = true;
    await new Promise(resolve => { race.release = resolve; });
  });
}
"""

RUN_CASE = r"""
async ({ kind, frames }) => {
  const race = window.__race;
  const ctx = SillyTavern.getContext();
  const script = await import('/script.js');
  const p = race.processor;
  const id = p.messageId;
  const oldNode = p.messageTextDom;
  if (!oldNode || !oldNode.isConnected) throw new Error('missing active text node');
  // Drop previous healthy frame work, then queue the final/partial tick under
  // the controlled scheduler. The first content paint has already happened.
  await race.waitFrame();
  await race.waitFrame();
  race.active = true;
  await p.onProgressStreaming(id, race.text, false);
  const immediateHtml = oldNode.innerHTML;
  const pendingBefore = { frames: race.frames.length, tasks: race.tasks.length };
  if (!pendingBefore.frames) throw new Error('did not arm the product frame gate');
  for (let index = 0; index < frames; index++) await race.stepFrame();
  const beforeAction = { frames: race.frames.length, tasks: race.tasks.length };
  if (frames && !beforeAction.tasks) throw new Error('did not queue the product MessageChannel task');
  let lateWrites = 0;
  const observer = new MutationObserver(records => { lateWrites += records.length; });
  let target = oldNode;
  let expectedText = race.text;
  if (kind === 'finish') {
    await p.onFinishStreaming(id, race.text);
  } else if (kind === 'stop' || kind === 'stopPartial') {
    p.onStopStreaming();
  } else if (kind === 'error') {
    p.onErrorStreaming();
  } else if (kind === 'chat') {
    const beforeChat = ctx.getCurrentChatId();
    await script.doNewChat();
    if (ctx.getCurrentChatId() === beforeChat) throw new Error('chat did not change');
    // Reuse the old numeric message id in the newly selected chat. A stale
    // callback must not write even to its cached, now detached text element.
    while (ctx.chat.length <= id) {
      const message = { name: 'Startup Synthetic', mes: 'New chat sentinel ' + ctx.chat.length, is_user: false, is_system: false, extra: {} };
      ctx.chat.push(message);
      script.addOneMessage(message);
    }
    target = document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
    expectedText = ctx.chat[id].mes;
  } else if (kind === 'swipe') {
    const { SWIPE_DIRECTION, SWIPE_SOURCE } = await import('/scripts/constants.js');
    const message = ctx.chat[id];
    script.ensureSwipes(message);
    message.swipes.push('Alternate swipe sentinel.');
    message.swipe_info.push({ send_date: message.send_date, extra: {} });
    await script.swipe(null, SWIPE_DIRECTION.RIGHT, {
      source: SWIPE_SOURCE.SLASH_COMMAND, forceMesId: id,
      forceSwipeId: message.swipes.length - 1, forceDuration: 0,
    });
    target = document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
    expectedText = ctx.chat[id].mes;
    if (expectedText !== 'Alternate swipe sentinel.') throw new Error('swipe did not select the sentinel');
  } else throw new Error('unknown action ' + kind);
  await Promise.resolve();
  const message = ctx.chat[id];
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:-10000px;visibility:hidden';
  const expected = document.createElement('div');
  expected.className = 'mes_text';
  expected.innerHTML = script.messageFormatting(message.mes, message.name, message.is_system, message.is_user, id, {}, false);
  holder.appendChild(expected);
  if (kind === 'finish') script.addCopyToCodeBlocks(holder);
  document.body.appendChild(holder);
  // Let keyboard.js decorate the terminal code-copy controls while streaming
  // callbacks remain held. A stale full paint would erase those controls.
  await race.waitFrame();
  await race.waitFrame();
  const atAction = target.innerHTML;
  observer.observe(oldNode, { childList: true, characterData: true, subtree: true });
  if (target !== oldNode) observer.observe(target, { childList: true, characterData: true, subtree: true });
  await race.drain();
  const afterDrain = target.innerHTML;
  observer.disconnect();
  holder.remove();
  const out = {
    kind, delayFrames: frames, tokens: race.tokens, pendingBefore, beforeAction,
    framePosts: race.framePosts, taskPosts: race.taskPosts,
    frameDeliveries: race.frameDeliveries, taskDeliveries: race.taskDeliveries,
    cancelledFramesDelivered: race.cancelled,
    directEqualAtAction: atAction === expected.innerHTML,
    directEqualAfterDrain: afterDrain === expected.innerHTML,
    lateWrites, oldNodeConnected: oldNode.isConnected,
    finalText: message.mes, expectedText,
    hadDeferredDifference: immediateHtml !== expected.innerHTML,
    chatChangedEvent: ctx.eventTypes.CHAT_CHANGED,
  };
  out.pass = out.directEqualAtAction && out.directEqualAfterDrain && lateWrites === 0;
  return out;
}
"""


def main():
    output = pathlib.Path(sys.argv[sys.argv.index('--output') + 1]) if '--output' in sys.argv else EVIDENCE / 'races.json'
    temp = pathlib.Path(tempfile.mkdtemp(prefix='st-race-'))
    report = {
        'head': 'WORKTREE', 'pass': False, 'cases': [],
        'definition': 'Real stream token listener gates its final (or eighth) content chunk. The test queues that tick through the real processor, advances zero/one/two frames, performs the terminal action, then adversarially delivers retained frame/MessageChannel callbacks. HTML is compared immediately after the action and after delivery; all late .mes_text writes fail.',
    }
    try:
        runner = temp / 'fake.mjs'
        runner.write_text(
            f"import {{ createFakeOpenAI }} from {json.dumps((REPO / 'scripts/fake-openai-endpoint.mjs').as_uri())};\n"
            f"const fake = await createFakeOpenAI({{ reply: {json.dumps(REPLY)}, rate: 250, jitter: 0, seed: 'race-m1' }});\n"
            "console.log(JSON.stringify({ url: fake.url }));\n"
            "for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await fake.close(); });\n",
            encoding='utf-8',
        )
        fake = lab.spawn([lab.NODE, str(runner)], REPO)
        fake_url = lab.read_url_line(fake)
        data_dir = temp / 'data'
        data_dir.mkdir()
        seed = temp / 'seed.mjs'
        seed.write_text(lab.SEED_JS.replace('<REPO>', REPO.as_posix()), encoding='utf-8')
        seeded = json.loads(subprocess.check_output([lab.NODE, str(seed), str(REPO), str(data_dir), str(lab.free_port()), fake_url], cwd=REPO, text=True))
        log_handle = open(temp / 'server.log', 'w', encoding='utf-8')
        server = lab.spawn([
            lab.NODE, 'server.js', '--configPath', seeded['configPath'],
            '--dataRoot', seeded['dataRoot'], '--port', str(seeded['port']),
            '--listen', 'false', '--listenAddressIPv4', '127.0.0.1',
            '--enableIPv4', 'true', '--enableIPv6', 'false',
            '--browserLaunchEnabled', 'false', '--ssl', 'false',
            '--exclusiveDataRoot', 'true',
        ], REPO, stdout=log_handle)
        server._eq_log = log_handle
        origin = f"http://127.0.0.1:{seeded['port']}/"
        lab.wait_http(origin + 'csrf-token', server)
        with lab.sync_playwright() as playwright:
            browser = lab.launch_chromium(playwright)
            try:
                cases = [(kind, frames) for kind in ('finish', 'stop', 'stopPartial') for frames in range(3)]
                cases.extend([('error', 1), ('chat', 0), ('chat', 1), ('swipe', 0), ('swipe', 1)])
                for kind, frames in cases:
                    context = browser.new_context(viewport={'width': 1280, 'height': 800})
                    page = context.new_page()
                    page.add_init_script(SCHEDULER)
                    try:
                        lab.boot(page, origin, False)
                        page.evaluate(INSTALL_GATE, {'reply': REPLY, 'midstream': kind not in ('finish', 'stop')})
                        lab.send(page)
                        page.wait_for_function('() => window.__race.ready', timeout=30000)
                        result = page.evaluate(RUN_CASE, {'kind': kind, 'frames': frames})
                        report['cases'].append(result)
                        lab.log(f"{kind}/{frames}: {'pass' if result['pass'] else 'FAIL'}")
                    finally:
                        context.close()
            finally:
                browser.close()
        report['pass'] = all(case['pass'] for case in report['cases']) and len(report['cases']) == 14
    except Exception as error:
        report['error'] = lab.redact(f'{type(error).__name__}: {error}')
        lab.log(report['error'])
    finally:
        lab.stop_all()
        shutil.rmtree(temp, ignore_errors=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(lab.redact(json.dumps(report, indent=2, ensure_ascii=False)) + '\n', encoding='utf-8')
    lab.log(f"wrote race evidence pass={report['pass']}")
    if not report['pass']:
        sys.exit(1)


if __name__ == '__main__':
    main()
