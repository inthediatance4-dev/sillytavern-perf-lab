"""M3: one fixed, alternating final matrix using the current browser harness."""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import time

SPEC = importlib.util.spec_from_file_location('longchat', pathlib.Path(__file__).with_name('browser-longchat-perf.py'))
LAB = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LAB)
ROOT = LAB.ROOT
CASES = [('100-immediate', 100, 0), ('100-history10', 100, 10), ('0-immediate', 0, 0)]


def archive(revision, paths, destination):
    process = subprocess.Popen(['git', 'archive', revision, *paths], cwd=ROOT, stdout=subprocess.PIPE)
    try:
        subprocess.run(['tar', '-x', '-C', str(destination)], stdin=process.stdout, check=True)
    finally:
        process.stdout.close()
    if process.wait() != 0:
        raise RuntimeError('git archive failed')


def baseline_tree(revision, head):
    directory = pathlib.Path(tempfile.mkdtemp(prefix='lcab-' + revision[:12] + '-m3-'))
    # Current support/backend and harness; only public/ comes from the old revision.
    archive(head, ['package.json', 'package-lock.json', 'server.js', 'webpack.config.js',
                   'src', 'default', 'scripts', 'tests'], directory)
    archive(revision, ['public'], directory)
    (directory / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
    source = "import {PUBLIC_DIRECTORIES} from './src/constants.js'; console.log(JSON.stringify(Object.values(PUBLIC_DIRECTORIES)));"
    relatives = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', source], cwd=directory, text=True))
    LAB.prepare_archive_directories(directory, relatives)
    for entry in directory.rglob('*'):
        if not entry.is_symlink():
            entry.chmod(entry.stat().st_mode & ~0o222)
    directory.chmod(directory.stat().st_mode & ~0o222)
    return directory


def metrics(case, record):
    if case == '100-history10':
        batches = record['scroll']['batches']
        assert len(batches) == 10
        assert record['afterScroll']['messages'] == 1100
        result = {'2000/100 send after10': record['send']['ms']}
        for index in range(3):
            result[f'2000/100 older{index + 1}'] = batches[index]['ms']
            result[f'2000/100 older{index + 1} longest task'] = LAB.tasks_summary(batches[index]['tasks'])['maxMs']
        return result
    truncation = record['truncation']
    assert record['afterOpen']['messages'] == (truncation or 2000)
    assert not record['scroll']['batches']
    return {f'2000/{truncation} open': record['open']['ms'],
            f'2000/{truncation} send': record['send']['ms']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--node', required=True)
    parser.add_argument('--pairs', type=int, default=10)
    args = parser.parse_args()
    if args.pairs < 10:
        parser.error('Final acceptance requires at least ten pairs')
    args.output.mkdir(parents=True, exist_ok=False)
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    base = subprocess.check_output(['git', 'rev-parse', '37a4818^{commit}'], cwd=ROOT, text=True).strip()
    products = {'base': baseline_tree(base, head), 'head': ROOT}
    files = ['tests/browser-longchat-perf.py', 'tests/longchat-browser-probe.mjs',
             'tests/longchat-normalization.mjs', 'tests/lab_browser.py', 'tests/longchat-final-ab.py',
             'scripts/longchat-lab-server.mjs', 'scripts/start-performance-lab.mjs', 'scripts/benchmark-statistics.mjs']
    report = {'basePublicRevision': base, 'headRevision': head,
              'construction': 'git archive HEAD support/backend/tests/scripts; git archive 37a4818 public/; current harness invokes both',
              'harnessSha256': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files},
              'startedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'plannedPairs': args.pairs, 'order': [], 'metrics': {}}
    samples = {}
    failed = False
    # Same session: A B for every cohort, then the next iteration. No retries.
    for iteration in range(args.pairs):
        for case, truncation, batches in CASES:
            for side in ['base', 'head']:
                output = args.output / f'{iteration:02}-{case}-{side}'
                command = [sys.executable, str(ROOT / 'tests/browser-longchat-perf.py'),
                           '--output', str(output), '--product-root', str(products[side]),
                           '--product-revision', base if side == 'base' else head,
                           '--sizes', '2000', '--settings', str(truncation), '--runs', '1',
                           '--no-profiles', '--sliced-older', '--older-batches', str(batches),
                           '--node', args.node, '--run-timeout', '240', '--combo-timeout', '300']
                print(iteration, case, side, 'start', flush=True)
                completed = subprocess.run(command, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                LAB.write_snapshot(args.output / f'{output.name}-console.txt.gz', LAB.redact(completed.stdout))
                record_path = output / f'run-2000-{truncation}-0.json'
                record = json.loads(record_path.read_text()) if record_path.exists() else {'status': 'missing'}
                attempt = {'iteration': iteration, 'case': case, 'side': side,
                           'exitCode': completed.returncode, 'status': record['status'],
                           'record': str(record_path.relative_to(args.output))}
                try:
                    assert completed.returncode == 0 and record['status'] == 'ok', 'Unsuccessful attempt'
                    observed = metrics(case, record)
                    for name, value in observed.items():
                        samples.setdefault(name, {'base': [], 'head': []})[side].append(value)
                except (AssertionError, KeyError) as error:
                    attempt['failure'] = str(error)
                    failed = True
                report['order'].append(attempt)
                LAB.write_json(args.output / 'comparison.json', report, overwrite=True)
                print(iteration, case, side, record['status'], 'exit', completed.returncode, flush=True)
    # An incomplete matrix never gets successful-pair statistics.
    if not failed:
        for name, sides in samples.items():
            assert len(sides['base']) == len(sides['head']) == args.pairs
            stats = LAB.node_statistics(sides['base'], sides['head'])
            lo, hi = stats['difference']['ci95']
            report['metrics'][name] = {**stats, 'nPerSide': args.pairs,
                                       'significant': hi < 0 or lo > 0}
    report['finishedUtc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    report['acceptance'] = 'unmet' if failed else 'met'
    LAB.write_json(args.output / 'comparison.json', report, overwrite=True)
    raise SystemExit(1 if failed else 0)


if __name__ == '__main__':
    main()
