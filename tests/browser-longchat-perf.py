"""Bounded synthetic long-chat measurements; see tests/LONGCHAT-PERF.md."""
import argparse
import difflib
import gzip
import hashlib
import json
import math
import os
import pathlib
import random
import re
import signal
import socket
import subprocess
import time
import urllib.request
import tempfile
import sys
from collections import defaultdict

from lab_browser import assert_lab_page, launch_chromium

ROOT = pathlib.Path(__file__).resolve().parent.parent


def percentile(values, fraction):
    values = sorted(values)
    return values[max(0, math.ceil(len(values) * fraction) - 1)] if values else None


def distribution(values):
    return {'n': len(values), 'median': percentile(values, .5), 'p95': percentile(values, .95)}


def synthetic_rows(size, legacy=False):
    rng = random.Random(20261028)
    rows = [{'user_name': 'Synthetic Tester', 'character_name': 'Longchat Synthetic',
             'chat_metadata': {'integrity': 'longchat-synthetic'}}]
    paragraph = ('A synthetic traveler studies the old map, compares the river crossing, '
                 'and explains why the next experiment needs a careful measurement. ')
    for i in range(size):
        offset = size - 1 - i
        if not legacy:
            rng = random.Random(20261028 + offset % 100)
        kind = rng.randrange(10)
        text = f'Message {i}: **Observation** with *detail*.\n'
        if kind >= 4:
            text += '\n' + paragraph * (rng.randrange(15, 25) if kind >= 8 else rng.randrange(2, 5))
            text += '\n\n## Plan\n- Check the route\n- Record results\n\n> Synthetic quotation\n[Reference](https://example.invalid/)'
        position = i if legacy else offset
        if position % 7 == 0:
            language, code = [('python', 'for item in range(4):\n    print(item)'),
                              ('javascript', 'const values = [1, 2, 3];\nconsole.log(values);'),
                              ('json', '{"synthetic": true, "count": 4}')][position % 3]
            text += f'\n\n```{language}\n{code}\n```'
        row = {'name': 'Synthetic Tester' if i % 2 == 0 else 'Longchat Synthetic',
               'is_user': i % 2 == 0, 'is_system': False,
               'send_date': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(1700000000 + i * 90)),
               'mes': text, 'extra': {}}
        has_swipes = i % 10 == 1 if legacy else offset % 10 == 8
        if has_swipes:
            row.update(swipe_id=0, swipes=[text] + [text + f'\nAlternative {j}' for j in range(rng.randrange(1, 5))])
        rows.append(row)
    return rows


def profile_summary(profile):
    nodes = {n['id']: n for n in profile['nodes']}
    parents = {child: n['id'] for n in profile['nodes'] for child in n.get('children', [])}
    own, total, files, inclusive_files = defaultdict(int), defaultdict(int), defaultdict(int), defaultdict(int)
    duration = sum(profile.get('timeDeltas', []))
    focus_names = ['messageFormatting', 'addOneMessage', 'updateMessageElement', 'redisplayChat', 'showMoreMessages',
                   'saveChat', 'saveChatConditional', 'stringify', 'getTokenCount', 'getTokenCountAsync']
    focus_self, focus_total, focus_seen = defaultdict(int), defaultdict(int), set()
    def key(node_id):
        frame = nodes[node_id]['callFrame']
        return (frame['functionName'] or '(anonymous)', frame['url'] or '(native)', frame['lineNumber'] + 1, frame.get('columnNumber', -1) + 1)
    for sample, delta in zip(profile.get('samples', []), profile.get('timeDeltas', [])):
        own[key(sample)] += delta
        files[key(sample)[1]] += delta
        if key(sample)[0] in focus_names:
            focus_self[key(sample)[0]] += delta
        seen_nodes, seen_frames, seen_files = set(), set(), set()
        seen_focus = set()
        while sample is not None and sample not in seen_nodes:
            seen_nodes.add(sample)
            frame = key(sample)
            if frame[0] in focus_names and frame[0] not in seen_focus:
                focus_total[frame[0]] += delta
                seen_focus.add(frame[0])
                focus_seen.add(frame[0])
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
            'focusFunctions': {name: {'observed': name in focus_seen,
                                      'selfPercent': focus_self[name] / duration * 100 if duration and name in focus_seen else None,
                                      'inclusivePercent': focus_total[name] / duration * 100 if duration and name in focus_seen else None}
                               for name in focus_names},
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
        value = re.sub(r'/tmp/[^\s\"\'<>]+', '<tmp>', value)
        return value
    return value


def write_json(path, data, origin='', temporary='', overwrite=False):
    text = json.dumps(redact(data, origin, temporary), indent=2, ensure_ascii=False)
    with path.open('w' if overwrite else 'x', encoding='utf-8') as handle:
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



def wait_application(page, origin, deadline):
    page.goto(origin, wait_until='domcontentloaded', timeout=max(1, (deadline - time.monotonic()) * 1000))
    # A single predicate owns the dialog read/click and event subscription. Never
    # retain a locator across an async onboarding transition. APP_READY is sticky.
    page.wait_for_function("""() => {
        if (!window.SillyTavern?.getContext) return false;
        if (!window.labReadySubscribed) {
            window.labReadySubscribed = true;
            window.labOnboarding = [];
            const c = SillyTavern.getContext();
            c.eventSource.once(c.eventTypes.APP_READY, () => { window.labAppReady = true; });
        }
        const dialog = document.querySelector('dialog[open]');
        if (dialog) {
            if (dialog.querySelector('.onboarding') && !dialog.dataset.labDismissed) {
                dialog.dataset.labDismissed = 'true';
                window.labOnboarding.push(dialog.innerText);
                const input = [...dialog.querySelectorAll('input[type=text]')].at(-1);
                if (input) {
                    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Synthetic Tester');
                    input.dispatchEvent(new Event('input', {bubbles:true}));
                    input.dispatchEvent(new Event('change', {bubbles:true}));
                }
                dialog.querySelector('.popup-button-ok').click();
            }
            return false;
        }
        return !!window.labAppReady && !!document.querySelector('#chat') &&
            !!document.querySelector('#send_textarea')?.getClientRects().length &&
            !document.querySelector('.splash-screen');
    }""", timeout=max(1, (deadline - time.monotonic()) * 1000))
    return page.evaluate('window.labOnboarding')


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


def aggregate_results(raw, sizes, settings, output, overwrite=False):
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
                'scrollLongTaskCount': lambda r: r['scroll']['longTasks']['count'],
                'scrollLongTaskTotalMs': lambda r: r['scroll']['longTasks']['totalMs'],
                'scrollLongTaskMaxMs': lambda r: r['scroll']['longTasks']['maxMs'],
                'sendMs': lambda r: r['send']['ms'], 'savePayloadBytes': lambda r: r['send']['payloadBytes'],
                'saveResponseWaitMs': lambda r: r['send']['responseWaitMs'], 'saveServerMs': lambda r: r['send']['serverMs'],
                'heapOpenBytes': lambda r: r['afterOpen']['usedSize'], 'heapScrollBytes': lambda r: r['afterScroll']['usedSize'],
                'domOpen': lambda r: r['afterOpen']['nodes'], 'domScroll': lambda r: r['afterScroll']['nodes'],
                'messagesOpen': lambda r: r['afterOpen']['messages'], 'messagesScroll': lambda r: r['afterScroll']['messages']}
            failed_completed = [r for r in subset if r['status'] != 'ok' and all(k in r for k in ['open', 'scroll', 'send', 'afterOpen', 'afterScroll'])]
            batches = []
            for index in range(max((len(r['scroll']['batches']) for r in ok), default=0)):
                samples = [r['scroll']['batches'][index] for r in ok if len(r['scroll']['batches']) > index]
                batches.append({'batch': index + 1, 'addedMessages': distribution([b['added'] for b in samples]),
                                'ms': distribution([b['ms'] for b in samples]),
                                'longTaskCount': distribution([len(b['tasks']) for b in samples]),
                                'longTaskTotalMs': distribution([tasks_summary(b['tasks'])['totalMs'] for b in samples]),
                                'longTaskMaxMs': distribution([tasks_summary(b['tasks'])['maxMs'] for b in samples])})
            aggregate.append({'size': size, 'truncation': truncation, 'success': len(ok), 'attempted': len(subset),
                              'statusCounts': {status: sum(r['status'] == status for r in subset) for status in ['ok', 'error', 'timeout', 'skipped']},
                              'metrics': {key: distribution([fn(r) for r in ok]) for key, fn in metrics.items()},
                              'failedCompleted': {'n': len(failed_completed),
                                                  'warning': 'Phase timings exist, but page errors invalidate successful interactivity.',
                                                  'metrics': {key: distribution([fn(r) for r in failed_completed]) for key, fn in metrics.items()}},
                              'batchesByIndex': batches,
                              'batchMs': distribution([b['ms'] for r in ok for b in r['scroll']['batches']]),
                              'batchLongTaskTotalMs': distribution([sum(t['duration'] for t in b['tasks']) for r in ok for b in r['scroll']['batches']])})
    write_json(output / 'aggregated.json', aggregate, overwrite=overwrite)
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
    lines += ['', '## Older-message batches', '',
              'Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.', '',
              '| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |',
              '|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for r in aggregate:
        for batch in r['batchesByIndex']:
            values = [fmt(batch[k]) for k in ['addedMessages', 'ms', 'longTaskCount', 'longTaskTotalMs', 'longTaskMaxMs']]
            lines.append(f"| {r['size']} | {r['truncation']} | {batch['batch']} | {batch['ms']['n']} | " + ' | '.join(values) + ' |')
    lines += ['', '## Completed phase observations with page errors', '',
              'These are failed interactive runs, excluded from every successful-run table above.', '',
              '| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |',
              '|---:|---:|---:|---:|---:|---:|---:|---:|']
    for r in aggregate:
        if r['failedCompleted']['n']:
            metrics = r['failedCompleted']['metrics']
            values = [fmt(metrics[k]) for k in ['openMs', 'sendMs', 'frameP95Ms', 'saveServerMs', 'domOpen']]
            lines.append(f"| {r['size']} | {r['truncation']} | {r['failedCompleted']['n']} | " + ' | '.join(values) + ' |')
    with (output / 'tables.md').open('w' if overwrite else 'x', encoding='utf-8') as handle:
        handle.write('\n'.join(lines) + '\n')
    return aggregate


def combine_results(directories, output):
    """Regenerate derived tables only; raw observations remain immutable."""
    output.mkdir(parents=True, exist_ok=True)
    raw, index = [], []
    for directory in directories:
        for path in sorted(directory.glob('run-*.json')):
            data = path.read_bytes()
            record = json.loads(data)
            source = os.path.relpath(path, output.parent)
            if any(row['sourceRecord'] == source for row in index):
                raise ValueError('Duplicate input run: ' + source)
            raw.append(record)
            index.append({**{k: record[k] for k in ['size', 'truncation', 'iteration', 'profiled', 'status']},
                          'sourceRecord': source, 'sha256': hashlib.sha256(data).hexdigest()})
    if not raw:
        raise ValueError('No input runs')
    aggregate_results(raw, sorted({r['size'] for r in raw}, key=lambda size: (size != 2000, size)),
                      sorted({r['truncation'] for r in raw}, key=lambda value: (value != 100, value)), output, overwrite=True)
    write_json(output / 'raw-index.json', index, overwrite=True)


def node_statistics(base, head):
    source = "import {summarize,medianDifference,bootstrapSeed,resamples} from './scripts/benchmark-statistics.mjs'; let s=''; for await (const chunk of process.stdin) s+=chunk; const [a,b]=JSON.parse(s); console.log(JSON.stringify({base:summarize(a),head:summarize(b),difference:medianDifference(a,b),bootstrapSeed,resamples}));"
    result = subprocess.run(['node', '--input-type=module', '-e', source], input=json.dumps([base, head]), cwd=ROOT, text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def equivalence(page, args, deadline):
    result = {'dom': {'open': page.evaluate('labProbe.chatSnapshot()')}, 'tabs': {},
              'events': {'open': page.evaluate('labProbe.takeRenderingEvents()')}}
    run_async(page, 'async () => { await labScript.showMoreMessages(); await labIdle(); return true; }', None, deadline)
    result['dom']['older'] = page.evaluate('labProbe.chatSnapshot()')
    result['events']['older'] = page.evaluate('labProbe.takeRenderingEvents()')
    for scenario in ['older', 'appended', 'class-added', 'ancestor-disabled', 'ancestor-enabled', 'popup-open', 'popup-closed']:
        if scenario == 'appended':
            before = page.evaluate('SillyTavern.getContext().chat.length')
            page.locator('#send_textarea').fill('/send Synthetic equivalence append')
            with page.expect_response(lambda r: r.url.endswith('/api/chats/save') and r.request.method == 'POST') as pending:
                page.locator('#send_textarea').press('Enter')
            response = pending.value
            response.body()
            assert response.ok, response.text()
            payload = json.loads(response.request.post_data)
            assert len(payload['chat']) == before + 2
            assert payload['chat'][-1]['is_user'] and payload['chat'][-1]['mes'] == 'Synthetic equivalence append'
            page.wait_for_function("document.querySelector('#chat .last_mes .mes_text')?.textContent.includes('Synthetic equivalence append')")
        count = run_async(page, 'name => labProbe.prepareTabScenario(name)', scenario, deadline)
        print('tabs', scenario, max(args.tab_count, count), flush=True)
        sequence = []
        for _ in range(max(args.tab_count, count)):
            if time.monotonic() >= deadline:
                raise TimeoutError('Tab traversal exceeded run deadline')
            page.keyboard.press('Tab')
            sequence.append(page.evaluate('labProbe.focusDescriptor()'))
        result['tabs'][scenario] = sequence
        if scenario == 'appended':
            result['events']['send'] = page.evaluate('labProbe.takeRenderingEvents()')
    return result


def prepare_archive_directories(directory, relatives):
    for relative in relatives:
        target = directory / relative
        if not target.resolve().is_relative_to(directory.resolve()):
            raise ValueError('Archive runtime directory escapes source tree')
        target.mkdir(parents=True, exist_ok=True)


def materialize(revision):
    if revision == 'WORKTREE':
        return ROOT, 'WORKTREE'
    commit = subprocess.check_output(['git', 'rev-parse', '--verify', revision + '^{commit}'], cwd=ROOT, text=True).strip()
    directory = pathlib.Path(tempfile.mkdtemp(prefix='lcab-' + commit[:12] + '-'))
    archive = subprocess.Popen(['git', 'archive', commit], cwd=ROOT, stdout=subprocess.PIPE)
    subprocess.run(['tar', '-x', '-C', str(directory)], stdin=archive.stdout, check=True)
    archive.stdout.close()
    if archive.wait() != 0:
        raise RuntimeError('git archive failed')
    (directory / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
    # Git omits these empty runtime directories. Fresh labs must not try to
    # create them inside the immutable source tree during server startup.
    source = "import {pathToFileURL} from 'node:url'; const {PUBLIC_DIRECTORIES} = await import(pathToFileURL(process.argv[1])); console.log(JSON.stringify(Object.values(PUBLIC_DIRECTORIES)));"
    directories = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', source, str(directory / 'src/constants.js')], text=True))
    prepare_archive_directories(directory, directories)
    # Product sources are immutable; only the isolated server's temp root is writable.
    for entry in directory.rglob('*'):
        if not entry.is_symlink():
            entry.chmod(entry.stat().st_mode & ~0o222)
    directory.chmod(directory.stat().st_mode & ~0o222)
    return directory, commit


def write_snapshot(path, text):
    data = text.encode('utf-8')
    # Suppress both the clock and original filename in the gzip header.
    with path.open('xb') as output:
        with gzip.GzipFile(fileobj=output, mode='wb', filename='', mtime=0) as compressed:
            compressed.write(data)
    return {'sha256': hashlib.sha256(data).hexdigest(), 'length': len(data), 'file': path.name}


def read_snapshot(snapshot, directory):
    # Accept older inline observations as well as the compact on-disk format.
    if snapshot is None or isinstance(snapshot, str):
        return snapshot
    path = directory / snapshot['file']
    data = gzip.decompress(path.read_bytes())
    if len(data) != snapshot['length'] or hashlib.sha256(data).hexdigest() != snapshot['sha256']:
        raise ValueError('Snapshot integrity mismatch: ' + snapshot['file'])
    return data.decode('utf-8')


def compare_equivalence(base, head, base_directory=None, head_directory=None):
    differences = {}
    for kind in ['dom', 'tabs', 'events']:
        for scenario in sorted(set(base.get(kind, {})) | set(head.get(kind, {}))):
            a, b = base.get(kind, {}).get(scenario), head.get(kind, {}).get(scenario)
            if kind == 'dom':
                a, b = read_snapshot(a, base_directory), read_snapshot(b, head_directory)
            if a != b:
                a = json.dumps(a, indent=2, ensure_ascii=False).splitlines() if not isinstance(a, str) else a.replace('><', '>\n<').splitlines()
                b = json.dumps(b, indent=2, ensure_ascii=False).splitlines() if not isinstance(b, str) else b.replace('><', '>\n<').splitlines()
                differences[kind + '/' + scenario] = list(difflib.unified_diff(a, b, fromfile='base', tofile='head', lineterm=''))
    return {'status': 'different' if differences else 'equal', 'equal': not differences, 'differences': differences}


def compare_revisions(args):
    args.output.mkdir(parents=True, exist_ok=False)
    products = {side: materialize(revision) for side, revision in [('base', args.base), ('head', args.head)]}
    if args.head == 'WORKTREE' and args.product_root != ROOT:
        products['head'] = (args.product_root, 'WORKTREE temporary diagnostic copy')
    report = {'revisions': {side: revision for side, (_, revision) in products.items()}, 'order': [], 'settings': []}
    failed = False
    for size in map(int, args.sizes.split(',')):
        for truncation in map(int, args.settings.split(',')):
            records = {'base': [], 'head': []}
            checks = []
            for iteration in range(args.runs or 7):
                for side in ['base', 'head']:
                    output = args.output / f'{size}-{truncation}-{iteration}-{side}'
                    command = [sys.executable, str(ROOT / 'tests/browser-longchat-perf.py'), '--output', str(output), '--product-root', str(products[side][0]),
                               '--sizes', str(size), '--settings', str(truncation), '--runs', '1', '--no-profiles', '--node', args.node,
                               '--older-batches', str(args.older_batches), '--run-timeout', str(args.run_timeout), '--tab-count', str(args.tab_count), '--product-revision', products[side][1], '--combo-timeout', str(args.combo_timeout)]
                    if args.open_only:
                        command.append('--open-only')
                    if args.equivalence:
                        command.append('--equivalence')
                    if args.legacy_shape:
                        command.append('--legacy-shape')
                    completed = subprocess.run(command, cwd=ROOT)
                    report['order'].append({'size': size, 'truncation': truncation, 'iteration': iteration, 'side': side, 'exitCode': completed.returncode})
                    record_path = output / f'run-{size}-{truncation}-0.json'
                    record = json.loads(record_path.read_text()) if record_path.exists() else {'status': 'missing'}
                    records[side].append(record)
                    run_failed = completed.returncode != 0 or record['status'] != 'ok'
                    failed |= run_failed
                    if run_failed:
                        report['failure'] = {'side': side, 'size': size, 'truncation': truncation, 'iteration': iteration, 'status': record['status']}
                        write_json(args.output / 'comparison.json', report)
                        raise SystemExit(1)
                a, b = records['base'][-1], records['head'][-1]
                if args.equivalence:
                    check = compare_equivalence(a['equivalence'], b['equivalence'],
                                                args.output / f'{size}-{truncation}-{iteration}-base',
                                                args.output / f'{size}-{truncation}-{iteration}-head')
                    checks.append({'iteration': iteration, **check})
                    failed |= not check['equal']
            metrics = {}
            # Never drop failed pairs to manufacture an acceptance result.
            if all(r['status'] == 'ok' for rows in records.values() for r in rows):
                for metric in ['open'] + ([] if args.open_only else ['send']):
                    metrics[metric] = node_statistics([r[metric]['ms'] for r in records['base']], [r[metric]['ms'] for r in records['head']])
            report['settings'].append({'size': size, 'truncation': truncation, 'metrics': metrics, 'equivalence': checks})
    write_json(args.output / 'comparison.json', report)
    raise SystemExit(1 if failed else 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--combine', type=pathlib.Path, nargs='+', help='Regenerate derived tables from these saved run directories; no browser/server')
    parser.add_argument('--sizes', default='2000,1000,3000')
    parser.add_argument('--settings', default='100,0,500')
    parser.add_argument('--runs', type=int, help='Repetitions per size/setting (A/B defaults to seven pairs)')
    parser.add_argument('--older-batches', type=int, default=3)
    parser.add_argument('--run-timeout', type=int, default=120)
    parser.add_argument('--combo-timeout', type=int, default=1200)
    parser.add_argument('--node', default='node')
    parser.add_argument('--product-revision', default='WORKTREE', help=argparse.SUPPRESS)
    parser.add_argument('--base')
    parser.add_argument('--head', default='WORKTREE')
    parser.add_argument('--product-root', type=pathlib.Path, default=ROOT, help=argparse.SUPPRESS)
    parser.add_argument('--startup-runs', type=int, default=0, help='Fresh-context startups only; forces first-run onboarding in the synthetic settings response')
    parser.add_argument('--open-only', action='store_true')
    parser.add_argument('--no-profiles', action='store_true')
    parser.add_argument('--profile-phases', nargs='+', choices=['open', 'scroll', 'send'], default=['open', 'scroll', 'send'], help='Limit CPU capture in additional profiled runs')
    parser.add_argument('--equivalence', action='store_true')
    parser.add_argument('--tab-count', type=int, default=0, help='Minimum Tab presses; default also traverses all focusable controls')
    parser.add_argument('--legacy-shape', action='store_true', help='Diagnostic only: original generator')
    args = parser.parse_args()
    if args.equivalence:
        args.open_only = True  # Focus scenarios mutate chat state; keep them out of send/scroll timings.
    if args.runs is not None and args.runs < 1:
        parser.error('--runs must be positive')
    if args.startup_runs < 0 or args.tab_count < 0:
        parser.error('startup and Tab counts must be nonnegative')
    if args.head != 'WORKTREE' and not args.base:
        parser.error('--head requires --base')
    if args.startup_runs and args.base:
        parser.error('--startup-runs is separate from A/B measurements')
    if args.base and not args.equivalence and args.runs is not None and args.runs < 7:
        parser.error('A/B timing requires at least seven runs; use --equivalence for a one-pair self-check')
    if args.combine:
        combine_results(args.combine, args.output)
        return
    if args.base:
        compare_revisions(args)
        return
    from playwright.sync_api import sync_playwright
    args.output.mkdir(parents=True, exist_ok=False)
    temporary = tempfile.mkdtemp(prefix='longchat-perf-')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    origin = f'http://127.0.0.1:{port}/'
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith('SILLYTAVERN_')}
    log = tempfile.TemporaryFile(mode='w+')
    server = subprocess.Popen([args.node, 'scripts/longchat-lab-server.mjs', temporary, str(port)],
                              cwd=args.product_root, env=env, stdout=log, stderr=subprocess.STDOUT,
                              creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
    raw = []
    metadata = {'seed': 20261028, 'node': subprocess.check_output([args.node, '--version'], text=True).strip(),
                'platform': os.name, 'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                'productRevision': args.product_revision, 'dataShape': 'legacy' if args.legacy_shape else 'end-relative-100',
                'startupWait': 'sticky APP_READY + visible main UI + no onboarding/dialog/splash', 'olderBatchLimit': args.older_batches, 'cpuCount': os.cpu_count(), 'extensionsEnabled': False,
                'profilePhases': args.profile_phases,
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
            if args.startup_runs:
                startups = []
                for iteration in range(args.startup_runs):
                    fresh = browser.new_context(viewport={'width': 1440, 'height': 1000})
                    fresh.route('**/*', guard)
                    def first_run(route):
                        response = route.fetch()
                        data = response.json()
                        settings = json.loads(data['settings'])
                        settings['firstRun'] = True
                        data['settings'] = json.dumps(settings)
                        route.fulfill(response=response, json=data)
                    fresh.route('**/api/settings/get', first_run)
                    page = fresh.new_page()
                    errors = []
                    page.on('pageerror', lambda e: errors.append(str(e)))
                    started = time.monotonic()
                    record = {'iteration': iteration, 'status': 'ok'}
                    try:
                        record['onboarding'] = wait_application(page, origin, started + args.run_timeout)
                        assert record['onboarding'], 'First-run onboarding was not exercised'
                        assert not errors, errors
                    except Exception as error:
                        record.update(status='timeout' if 'Timeout' in type(error).__name__ else 'error', error=str(error))
                    record['ms'] = (time.monotonic() - started) * 1000
                    startups.append(record)
                    write_json(args.output / f'startup-{iteration:02}.json', record, origin, temporary)
                    fresh.close()
                    print('startup', iteration, record['status'], flush=True)
                metadata['startups'] = {'attempted': len(startups), 'failures': sum(r['status'] != 'ok' for r in startups)}
                metadata['forbiddenRequests'] = forbidden
                if metadata['startups']['failures'] or forbidden:
                    raise RuntimeError('Startup acceptance failed; all attempts retained')
                browser.close()
                return
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
            probe = (ROOT / 'tests/longchat-normalization.mjs').read_text() + (ROOT / 'tests/longchat-browser-probe.mjs').read_text().replace("import { normalizeSnapshot } from './longchat-normalization.mjs';", '')
            # Dynamic import via a blob keeps this test module out of public/.
            page.close()
            for size in map(int, args.sizes.split(',')):
                rows = synthetic_rows(size, args.legacy_shape)
                for truncation in map(int, args.settings.split(',')):
                    combo_deadline = time.monotonic() + args.combo_timeout
                    count = args.runs or (7 if size == 2000 else 5)
                    profile_combo = not args.no_profiles and size == 2000 and truncation in (100, 0)
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
                            if args.equivalence:
                                page.evaluate('labProbe.installRenderingRecorder()')
                            cdp = context.new_cdp_session(page)
                            profiling = result['profiled']
                            def phase(name, operation):
                                capture_profile = profiling and name in args.profile_phases
                                if capture_profile:
                                    cdp.send('Profiler.enable')
                                    cdp.send('Profiler.setSamplingInterval', {'interval': 100})
                                    cdp.send('Profiler.start')
                                value = operation()
                                if capture_profile:
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
                            if args.equivalence:
                                result['equivalence'] = equivalence(page, args, deadline)
                                result['equivalence']['dom'] = {
                                    scenario: write_snapshot(args.output / f'run-{label}-dom-{scenario}.html.gz',
                                                             redact(text, origin, temporary))
                                    for scenario, text in result['equivalence']['dom'].items()
                                }
                            if args.open_only:
                                assert not errors, errors
                                continue
                            scroll = phase('scroll', lambda: run_async(page, 'n => window.labProbe.scrollChat(n)', args.older_batches, deadline))
                            frames = scroll['frames']
                            result['scroll'] = {**scroll, 'frameMs': distribution(frames),
                                                'over16_7Percent': sum(x > 16.7 for x in frames) / len(frames) * 100,
                                                'over50Percent': sum(x > 50 for x in frames) / len(frames) * 100,
                                                'longTasks': tasks_summary(scroll['tasks'])}
                            result['afterScroll'] = snapshot()
                            print(label, 'scrolled', flush=True)
                            def send():
                                page.evaluate('window.labTasks = []')
                                start = time.monotonic()
                                page.locator('#send_textarea').fill('/send Synthetic measurement message **hello**')
                                filled = time.monotonic()
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
                                send_tasks = page.evaluate('window.labTasks')
                                return {'ms': elapsed, 'fillMs': (filled - start) * 1000, 'tasks': send_tasks,
                                        'longTasks': tasks_summary(send_tasks), 'payloadBytes': len(request.post_data.encode()),
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
        if server.poll() is None:
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
        if args.startup_runs and (metadata.get('shutdownIncomplete') or metadata.get('serverExitCode') != 0 or not metadata.get('ownerLockRemoved')):
            raise RuntimeError('Startup lab did not shut down gracefully')
    if not args.open_only:
        aggregate_results(raw, list(map(int, args.sizes.split(','))), list(map(int, args.settings.split(','))), args.output)
    render_profiles(args.output)
    if any(r['status'] == 'error' for r in raw) or metadata.get('forbiddenRequests') or metadata.get('shutdownIncomplete') or metadata.get('serverExitCode') != 0 or not metadata.get('ownerLockRemoved'):
        raise SystemExit(1)
    if any(r['status'] != 'ok' for r in raw):
        raise SystemExit(2)


if __name__ == '__main__':
    main()
