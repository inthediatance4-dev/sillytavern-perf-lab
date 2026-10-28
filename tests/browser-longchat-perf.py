"""Bounded synthetic long-chat measurements; see tests/LONGCHAT-PERF.md."""
import argparse
import gzip
import json
import math
import os
import pathlib
import random
import signal
import socket
import subprocess
import time
import urllib.request
import tempfile
from collections import defaultdict

from lab_browser import assert_lab_page, launch_chromium

ROOT = pathlib.Path(__file__).resolve().parent.parent


def percentile(values, fraction):
    values = sorted(values)
    return values[max(0, math.ceil(len(values) * fraction) - 1)] if values else None


def distribution(values):
    return {'n': len(values), 'median': percentile(values, .5), 'p95': percentile(values, .95)}


def synthetic_rows(size):
    rng = random.Random(20261028)
    rows = [{'user_name': 'Synthetic Tester', 'character_name': 'Longchat Synthetic',
             'chat_metadata': {'integrity': 'longchat-synthetic'}}]
    paragraph = ('A synthetic traveler studies the old map, compares the river crossing, '
                 'and explains why the next experiment needs a careful measurement. ')
    for i in range(size):
        kind = rng.randrange(10)
        text = f'Message {i}: **Observation** with *detail*.\n'
        if kind >= 4:
            text += '\n' + paragraph * (rng.randrange(15, 25) if kind >= 8 else rng.randrange(2, 5))
            text += '\n\n## Plan\n- Check the route\n- Record results\n\n> Synthetic quotation\n[Reference](https://example.invalid/)'
        if i % 7 == 0:
            language, code = [('python', 'for item in range(4):\n    print(item)'),
                              ('javascript', 'const values = [1, 2, 3];\nconsole.log(values);'),
                              ('json', '{"synthetic": true, "count": 4}')][i % 3]
            text += f'\n\n```{language}\n{code}\n```'
        row = {'name': 'Synthetic Tester' if i % 2 == 0 else 'Longchat Synthetic',
               'is_user': i % 2 == 0, 'is_system': False,
               'send_date': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(1700000000 + i * 90)),
               'mes': text, 'extra': {}}
        if i % 10 == 1:
            row.update(swipe_id=0, swipes=[text] + [text + f'\nAlternative {j}' for j in range(rng.randrange(1, 5))])
        rows.append(row)
    return rows


def profile_summary(profile):
    nodes = {n['id']: n for n in profile['nodes']}
    parents = {child: n['id'] for n in profile['nodes'] for child in n.get('children', [])}
    own, total, files, inclusive_files = defaultdict(int), defaultdict(int), defaultdict(int), defaultdict(int)
    duration = sum(profile.get('timeDeltas', []))
    def key(node_id):
        frame = nodes[node_id]['callFrame']
        return (frame['functionName'] or '(anonymous)', frame['url'] or '(native)', frame['lineNumber'] + 1, frame.get('columnNumber', -1) + 1)
    for sample, delta in zip(profile.get('samples', []), profile.get('timeDeltas', [])):
        own[key(sample)] += delta
        files[key(sample)[1]] += delta
        seen_nodes, seen_frames, seen_files = set(), set(), set()
        while sample is not None and sample not in seen_nodes:
            seen_nodes.add(sample)
            frame = key(sample)
            if frame not in seen_frames:
                total[frame] += delta
                seen_frames.add(frame)
            if frame[1] not in seen_files:
                inclusive_files[frame[1]] += delta
                seen_files.add(frame[1])
            sample = parents.get(sample)
    def top(counts):
        return [{'function': frame[0], 'file': frame[1], 'line': frame[2], 'column': frame[3],
                 'ms': value / 1000, 'percent': 100 * value / duration if duration else 0}
                for frame, value in sorted(counts.items(), key=lambda x: -x[1])[:30]]
    libraries = defaultdict(int)
    for frame, delta in own.items():
        label = frame[1].lower() + ' ' + frame[0].lower()
        category = next((name for name, terms in [
            ('markdown/formatting', ['showdown', 'messageformatting']), ('DOMPurify', ['purify']),
            ('highlight.js', ['highlight']), ('jQuery', ['jquery']),
            ('message rendering', ['addonemessage', 'updatemessageelement', 'redisplaychat']),
            ('save/JSON', ['savechat', 'stringify']), ('tokenization', ['gettokencount', 'tokeniz']),
            ('webpack bundle (unresolved)', ['/lib.js'])]
                         if any(term in label for term in terms)), 'other/idle/native')
        libraries[category] += delta
    return {'sampledMs': duration / 1000, 'self': top(own), 'total': top(total),
            'files': [{'file': k, 'percent': v / duration * 100} for k, v in sorted(files.items(), key=lambda x: -x[1])],
            'filesInclusive': [{'file': k, 'percent': v / duration * 100} for k, v in sorted(inclusive_files.items(), key=lambda x: -x[1])],
            'librariesSelfPercent': {k: v / duration * 100 for k, v in libraries.items()}}


def tasks_summary(tasks):
    return {'count': len(tasks), 'totalMs': sum(t['duration'] for t in tasks),
            'maxMs': max((t['duration'] for t in tasks), default=0)}


def redact(value, origin='', temporary=''):
    if isinstance(value, dict):
        return {key: redact(item, origin, temporary) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item, origin, temporary) for item in value]
    if isinstance(value, str):
        for source, target in [(origin.rstrip('/'), 'http://<host>'), (temporary, '<tmp>'), (socket.gethostname(), '<host>')]:
            if source:
                value = value.replace(source, target)
        return value
    return value


def write_json(path, data, origin='', temporary=''):
    text = json.dumps(redact(data, origin, temporary), indent=2, ensure_ascii=False)
    with path.open('x', encoding='utf-8') as handle:
        handle.write(text + '\n')


def run_async(page, source, arg, deadline):
    # Return immediately so Playwright's wait has a real timeout even for a busy renderer.
    page.evaluate('([source, arg]) => { window.labResult = null; window.labFailure = null; '
                  'Promise.resolve().then(() => (0,eval)(source)(arg)).then(x => window.labResult = x)'
                  '.catch(e => window.labFailure = String(e.stack)); }', [source, arg])
    page.wait_for_function('window.labResult !== null || window.labFailure !== null',
                           timeout=max(1, (deadline - time.monotonic()) * 1000))
    failure = page.evaluate('window.labFailure')
    if failure:
        raise RuntimeError(failure)
    return page.evaluate('window.labResult')



def dismiss_onboarding(page):
    # Read and click the current dialog in one browser task: onboarding may
    # replace/close it while Playwright is waiting for an element action.
    dismissed = []
    for _ in range(8):
        state = page.evaluate("""() => {
            const dialog = document.querySelector('dialog[open]');
            if (!dialog) return null;
            const text = dialog.innerText.slice(0, 2000);
            const input = [...dialog.querySelectorAll('input[type=text]')].at(-1);
            if (input) {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Synthetic Tester');
                input.dispatchEvent(new Event('input', {bubbles:true}));
                input.dispatchEvent(new Event('change', {bubbles:true}));
            }
            const button = dialog.querySelector('.popup-button-ok');
            if (!button) throw new Error('Unexpected onboarding dialog without OK control');
            button.click();
            return text;
        }""")
        if state is None:
            return dismissed
        dismissed.append(state)
        page.wait_for_timeout(250)
    raise RuntimeError('Onboarding did not finish')


def wait_application(page, origin, deadline):
    page.goto(origin, wait_until='domcontentloaded', timeout=max(1, (deadline - time.monotonic()) * 1000))
    page.wait_for_function('window.SillyTavern?.getContext', timeout=max(1, (deadline - time.monotonic()) * 1000))
    page.evaluate('() => { window.labAppReady = false; const c = SillyTavern.getContext(); c.eventSource.once(c.eventTypes.APP_READY, () => { window.labAppReady = true; }); }')
    dialogs = []
    while True:
        if time.monotonic() >= deadline:
            raise TimeoutError('Application startup/onboarding deadline exceeded')
        if page.locator('dialog[open]').count():
            dialogs += dismiss_onboarding(page)
        if page.evaluate('window.labAppReady') and not page.locator('dialog[open]').count():
            return dialogs
        page.wait_for_timeout(100)


def render_profiles(output):
    lines = ['# CPU profile summaries', '',
             'Requested interval 100 µs. Percentages include idle/native/harness work; inclusive totals overlap.',
             'JSON.stringify may be charged to its caller. Categories are heuristic; an absent sample is not proof of zero work.']
    for path in sorted(output.glob('*-profile.json')):
        summary = json.loads(path.read_text())
        lines += ['', '## ' + path.stem, '', f"Sampled duration: {summary['sampledMs']:.1f} ms."]
        for kind in ['self', 'total']:
            lines += ['', f'### Top {kind} time', '', '| Function | File:line | % | ms |', '|---|---|---:|---:|']
            for row in summary[kind][:15]:
                label = row['file'].replace('http://<host>', '')
                lines.append(f"| {row['function'].replace('|', '/')} | {label}:{row['line']} | {row['percent']:.2f} | {row['ms']:.2f} |")
        lines += ['', '### Self time by file', '', '| File | % |', '|---|---:|']
        for row in summary['files'][:15]:
            lines.append(f"| {row['file'].replace('http://<host>', '')} | {row['percent']:.2f} |")
        if 'filesInclusive' in summary:
            lines += ['', '### Inclusive time by file (overlapping)', '', '| File | % |', '|---|---:|']
            for row in summary['filesInclusive'][:15]:
                lines.append(f"| {row['file'].replace('http://<host>', '')} | {row['percent']:.2f} |")
        lines += ['', '### Self time by library/category', '', '| Category | % |', '|---|---:|']
        for category in ['markdown/formatting', 'DOMPurify', 'highlight.js', 'jQuery', 'message rendering', 'save/JSON', 'tokenization', 'webpack bundle (unresolved)', 'other/idle/native']:
            lines.append(f"| {category} | {summary['librariesSelfPercent'].get(category, 0):.2f} |")
    with (output / 'profiles.md').open('x', encoding='utf-8') as handle:
        handle.write('\n'.join(lines) + '\n')


def aggregate_results(raw, sizes, settings, output):
    aggregate = []
    for size in sizes:
        for truncation in settings:
            subset = [r for r in raw if r['size'] == size and r['truncation'] == truncation and not r['profiled']]
            ok = [r for r in subset if r['status'] == 'ok']
            metrics = {
                'openMs': lambda r: r['open']['ms'], 'openLongTaskCount': lambda r: r['open']['longTasks']['count'],
                'openLongTaskTotalMs': lambda r: r['open']['longTasks']['totalMs'], 'openLongTaskMaxMs': lambda r: r['open']['longTasks']['maxMs'],
                'frameMedianMs': lambda r: r['scroll']['frameMs']['median'], 'frameP95Ms': lambda r: r['scroll']['frameMs']['p95'],
                'framesOver16_7Percent': lambda r: r['scroll']['over16_7Percent'], 'framesOver50Percent': lambda r: r['scroll']['over50Percent'],
                'sendMs': lambda r: r['send']['ms'], 'savePayloadBytes': lambda r: r['send']['payloadBytes'],
                'saveResponseWaitMs': lambda r: r['send']['responseWaitMs'], 'saveServerMs': lambda r: r['send']['serverMs'],
                'heapOpenBytes': lambda r: r['afterOpen']['usedSize'], 'heapScrollBytes': lambda r: r['afterScroll']['usedSize'],
                'domOpen': lambda r: r['afterOpen']['nodes'], 'domScroll': lambda r: r['afterScroll']['nodes'],
                'messagesOpen': lambda r: r['afterOpen']['messages'], 'messagesScroll': lambda r: r['afterScroll']['messages']}
            aggregate.append({'size': size, 'truncation': truncation, 'success': len(ok), 'attempted': len(subset),
                              'metrics': {key: distribution([fn(r) for r in ok]) for key, fn in metrics.items()},
                              'batchMs': distribution([b['ms'] for r in ok for b in r['scroll']['batches']]),
                              'batchLongTaskTotalMs': distribution([sum(t['duration'] for t in b['tasks']) for r in ok for b in r['scroll']['batches']])})
    write_json(output / 'aggregated.json', aggregate)
    lines = ['# Long-chat baseline', '', 'Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.', '',
             '| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |',
             '|---:|---:|---:|---:|---:|---:|---:|---:|']
    def fmt(d, scale=1):
        return '—' if not d['n'] else f"{d['median']/scale:.1f} / {d['p95']/scale:.1f}"
    for r in aggregate:
        m = r['metrics']
        lines.append(f"| {r['size']} | {r['truncation']} | {r['success']}/{r['attempted']} | {fmt(m['openMs'])} | {fmt(m['sendMs'])} | {fmt(m['saveResponseWaitMs'])} | {fmt(r['batchMs'])} | {fmt(m['heapOpenBytes'], 2**20)} |")
    for title, columns in [
        ('Open long tasks', [('Count', 'openLongTaskCount', 1), ('Total ms', 'openLongTaskTotalMs', 1), ('Max ms', 'openLongTaskMaxMs', 1)]),
        ('Scroll sweeps', [('Frame median ms', 'frameMedianMs', 1), ('Frame p95 ms', 'frameP95Ms', 1), ('Frames >16.7 ms %', 'framesOver16_7Percent', 1), ('Frames >50 ms %', 'framesOver50Percent', 1)]),
        ('Memory and DOM', [('Heap open MiB', 'heapOpenBytes', 2**20), ('Heap scroll MiB', 'heapScrollBytes', 2**20), ('DOM open', 'domOpen', 1), ('DOM scroll', 'domScroll', 1), ('Messages open', 'messagesOpen', 1), ('Messages scroll', 'messagesScroll', 1)]),
        ('Save', [('User send ms', 'sendMs', 1), ('Server ms', 'saveServerMs', 1), ('Payload KiB', 'savePayloadBytes', 1024)])]:
        lines += ['', '## ' + title, '', '| Messages | Truncation | ' + ' | '.join(c[0] for c in columns) + ' |',
                  '|---:|---:|' + '---:|' * len(columns)]
        for r in aggregate:
            lines.append(f"| {r['size']} | {r['truncation']} | " + ' | '.join(fmt(r['metrics'][key], scale) for _, key, scale in columns) + ' |')
    (output / 'tables.md').write_text('\n'.join(lines) + '\n')
    return aggregate


def main():
    from playwright.sync_api import sync_playwright
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--sizes', default='2000,1000,3000')
    parser.add_argument('--settings', default='100,0,500')
    parser.add_argument('--runs', type=int, help='Override repetitions for smoke checks only')
    parser.add_argument('--older-batches', type=int, default=3)
    parser.add_argument('--run-timeout', type=int, default=120)
    parser.add_argument('--combo-timeout', type=int, default=1200)
    parser.add_argument('--node', default='node')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    temporary = tempfile.mkdtemp(prefix='longchat-perf-')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    origin = f'http://127.0.0.1:{port}/'
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith('SILLYTAVERN_')}
    log = tempfile.TemporaryFile(mode='w+')
    server = subprocess.Popen([args.node, 'scripts/longchat-lab-server.mjs', temporary, str(port)],
                              cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
                              creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
    raw = []
    metadata = {'seed': 20261028, 'node': subprocess.check_output([args.node, '--version'], text=True).strip(),
                'platform': os.name, 'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                'startupWait': 'DOMContentLoaded + onboarding + sticky APP_READY event', 'olderBatchLimit': args.older_batches, 'cpuCount': os.cpu_count(), 'extensionsEnabled': False,
                'optionalSkipped': ['10000 scaling run: bounded core matrix prioritized', '48a153e comparison: optional separate historical experiment'],
                'runTimeoutSeconds': args.run_timeout, 'comboTimeoutSeconds': args.combo_timeout}
    try:
        for _ in range(180):
            if server.poll() is not None:
                raise RuntimeError('Lab server exited before readiness')
            try:
                urllib.request.urlopen(origin + 'csrf-token', timeout=1).close()
                break
            except OSError:
                time.sleep(.5)
        else:
            raise TimeoutError('Lab startup exceeded 90 seconds')
        with sync_playwright() as p:
            browser = launch_chromium(p)
            metadata['browser'] = browser.version
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            forbidden = []
            def guard(route):
                url = route.request.url
                if not url.startswith(origin) or ('/api/' in url and any(x in url for x in ['/generate', '/completions', '/chat-completion'])):
                    forbidden.append(url)
                    route.abort()
                else:
                    route.continue_()
            context.route('**/*', guard)
            page = context.new_page()
            metadata['onboarding'] = wait_application(page, origin, time.monotonic() + args.run_timeout)
            assert_lab_page(page, origin)
            metadata['freshDefaultTruncation'] = page.evaluate("async () => (await import(location.origin + '/scripts/power-user.js')).power_user.chat_truncation")
            token = context.request.get(origin + 'csrf-token').json()['token']
            headers = {'X-CSRF-Token': token}
            created = context.request.post(origin + 'api/characters/create', headers=headers,
                                           multipart={'ch_name': 'Longchat Synthetic', 'file_name': 'LongchatSynthetic',
                                                      'first_mes': 'Synthetic only.'})
            assert created.ok, created.text()
            avatar = created.text()
            cards = context.request.post(origin + 'api/characters/all', headers=headers, data={}).json()
            card = next(c for c in cards if c['avatar'] == avatar)
            probe = (ROOT / 'tests/longchat-browser-probe.mjs').read_text()
            # Dynamic import via a blob keeps this test module out of public/.
            page.close()
            for size in map(int, args.sizes.split(',')):
                rows = synthetic_rows(size)
                for truncation in map(int, args.settings.split(',')):
                    combo_deadline = time.monotonic() + args.combo_timeout
                    count = args.runs or (7 if size == 2000 else 5)
                    profile_combo = size == 2000 and truncation in (100, 0)
                    total_count = count + int(profile_combo)
                    for iteration in range(total_count):
                        result = {'size': size, 'truncation': truncation, 'iteration': iteration, 'status': 'ok'}
                        result['profiled'] = profile_combo and iteration == count
                        label = f'{size}-{truncation}-{iteration}'
                        if time.monotonic() >= combo_deadline:
                            result.update(status='skipped', error='size/setting wall-clock cap')
                            raw.append(result)
                            write_json(args.output / f'run-{label}.json', result)
                            continue
                        saved = context.request.post(origin + 'api/chats/save', headers=headers,
                                                     data={'avatar_url': avatar, 'file_name': card['chat'], 'chat': rows})
                        assert saved.ok, saved.text()
                        page = context.new_page()
                        page.set_default_timeout(min(30000, args.run_timeout * 1000))
                        errors = []
                        stacks = []
                        page.on('pageerror', lambda e: (errors.append(str(e)), stacks.append(e.stack)))
                        deadline = min(combo_deadline, time.monotonic() + args.run_timeout)
                        try:
                            result['onboarding'] = wait_application(page, origin, deadline)
                            page.evaluate('async source => { window.labProbe = await import(URL.createObjectURL(new Blob([source], {type:"text/javascript"}))); }', probe)
                            page.evaluate('(t) => window.labProbe.installProbe(t)', truncation)
                            cdp = context.new_cdp_session(page)
                            profiling = result['profiled']
                            def phase(name, operation):
                                if profiling:
                                    cdp.send('Profiler.enable')
                                    cdp.send('Profiler.setSamplingInterval', {'interval': 100})
                                    cdp.send('Profiler.start')
                                value = operation()
                                if profiling:
                                    profile = cdp.send('Profiler.stop')['profile']
                                    text = json.dumps(profile).replace(origin.rstrip('/'), 'http://<host>').replace(temporary, '<tmp>')
                                    with gzip.open(args.output / f'{label}-{name}.cpuprofile.gz', 'xt') as handle:
                                        handle.write(text)
                                    write_json(args.output / f'{label}-{name}-profile.json', profile_summary(json.loads(text)))
                                return value
                            def snapshot():
                                cdp.send('HeapProfiler.collectGarbage')
                                return {**cdp.send('Runtime.getHeapUsage'), **page.evaluate('({nodes:document.getElementsByTagName("*").length, messages:document.querySelectorAll("#chat .mes").length})')}
                            opened = phase('open', lambda: run_async(page, 'arg => window.labProbe.openChat(arg)', {'avatar': avatar, 'size': size}, deadline))
                            result['open'] = {**opened, 'longTasks': tasks_summary(opened['tasks'])}
                            result['afterOpen'] = snapshot()
                            print(label, 'opened', flush=True)
                            scroll = phase('scroll', lambda: run_async(page, 'n => window.labProbe.scrollChat(n)', args.older_batches, deadline))
                            frames = scroll['frames']
                            result['scroll'] = {**scroll, 'frameMs': distribution(frames),
                                                'over16_7Percent': sum(x > 16.7 for x in frames) / len(frames) * 100,
                                                'over50Percent': sum(x > 50 for x in frames) / len(frames) * 100,
                                                'longTasks': tasks_summary(scroll['tasks'])}
                            result['afterScroll'] = snapshot()
                            print(label, 'scrolled', flush=True)
                            def send():
                                start = time.monotonic()
                                page.locator('#send_textarea').fill('/send Synthetic measurement message **hello**')
                                with page.expect_response(lambda r: r.url.endswith('/api/chats/save') and r.request.method == 'POST', timeout=max(1, (deadline - time.monotonic()) * 1000)) as pending:
                                    page.locator('#send_textarea').press('Enter')
                                response = pending.value
                                response.body()
                                elapsed = (time.monotonic() - start) * 1000
                                assert response.ok, response.text()
                                request = response.request
                                payload = json.loads(request.post_data)
                                assert len(payload['chat']) == size + 2
                                assert payload['chat'][-1]['is_user'] is True
                                assert payload['chat'][-1]['mes'] == 'Synthetic measurement message **hello**'
                                timing = request.timing
                                page.wait_for_function('(size) => !!document.querySelector(`#chat .mes[mesid="${size}"]`)', arg=size, timeout=max(1, (deadline - time.monotonic()) * 1000))
                                return {'ms': elapsed, 'payloadBytes': len(request.post_data.encode()),
                                        'responseWaitMs': timing['responseStart'] - timing['requestStart'],
                                        'requestToResponseEndMs': timing['responseEnd'] - timing['requestStart'],
                                        'serverTiming': response.headers.get('server-timing'),
                                        'serverMs': float(response.headers['x-response-time'].removesuffix('ms')), 'timing': timing}
                            result['send'] = phase('send', send)
                            assert not errors, errors
                        except Exception as error:
                            result.update(status='timeout' if 'Timeout' in type(error).__name__ else 'error', error=str(error))
                        finally:
                            result['dialogs'] = page.locator('dialog[open]').all_text_contents()
                            result['pageErrorStacks'] = stacks
                            result['pageErrors'] = errors
                            result['forbiddenRequests'] = list(forbidden)
                            page.close()
                        raw.append(result)
                        write_json(args.output / f'run-{label}.json', result, origin, temporary)
                        print(label, result['status'], flush=True)
            browser.close()
            metadata['forbiddenRequests'] = forbidden
    finally:
        server.send_signal(signal.CTRL_BREAK_EVENT if os.name == 'nt' else signal.SIGINT)
        try:
            metadata['serverExitCode'] = server.wait(timeout=45)
            log.seek(0)
            server_log = log.read()
            metadata['shutdownIncomplete'] = 'Shutdown incomplete' in server_log
            write_json(args.output / 'server-log.json', {'log': server_log}, origin, temporary)
            metadata['ownerLockRemoved'] = not (pathlib.Path(temporary) / 'data/.st-lab-owner.lock').exists()
        except subprocess.TimeoutExpired:
            metadata['shutdownIncomplete'] = True
            metadata['serverExitCode'] = None
            # Deliberately leave the process and synthetic root for inspection; never hide a stuck shutdown.
        write_json(args.output / 'metadata.json', metadata, origin, temporary)
        log.close()
    aggregate_results(raw, list(map(int, args.sizes.split(','))), list(map(int, args.settings.split(','))), args.output)
    render_profiles(args.output)
    if any(r['status'] == 'error' for r in raw) or metadata.get('forbiddenRequests') or metadata.get('shutdownIncomplete') or metadata.get('serverExitCode') != 0:
        raise SystemExit(1)
    if any(r['status'] != 'ok' for r in raw):
        raise SystemExit(2)


if __name__ == '__main__':
    main()
