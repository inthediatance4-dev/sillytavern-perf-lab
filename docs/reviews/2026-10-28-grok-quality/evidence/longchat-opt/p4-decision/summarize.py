"""Rebuild P4 statistics from saved runs only; never starts a browser or server."""
import hashlib
import json
import math
from pathlib import Path
import random
import statistics

ROOT = Path(__file__).resolve().parent


def distribution(values):
    ordered = sorted(values)
    return {'n': len(values), 'values': values, 'median': statistics.median(values),
            'p95': ordered[math.ceil(.95 * len(ordered)) - 1]}


def load(paths):
    rows = []
    for path in paths:
        row = json.loads(path.read_text())
        assert row['status'] == 'ok' and not row['profiled'], path.name
        rows.append(row)
    return rows


def metrics(rows, snapshot):
    return {'sendMs': distribution([row['send']['ms'] for row in rows]),
            'domNodes': distribution([row[snapshot]['nodes'] for row in rows]),
            'messages': distribution([row[snapshot]['messages'] for row in rows])}


def bootstrap_ratio(numerator, denominator):
    rng = random.Random(20261029)
    ratios = sorted(statistics.median(rng.choices(numerator, k=len(numerator)))
                    / statistics.median(rng.choices(denominator, k=len(denominator))) for _ in range(50000))
    return {'ratio': statistics.median(numerator) / statistics.median(denominator),
            'percentile95CI': [ratios[math.ceil(.025 * len(ratios)) - 1], ratios[math.ceil(.975 * len(ratios)) - 1]],
            'seed': 20261029, 'resamples': 50000, 'method': 'independent resampling, ratio of medians, nearest-rank percentiles'}


a_paths = [ROOT / 'runs' / f'a-{i}' / 'run-2000-100-0.json' for i in range(7)]
b_paths = [ROOT / 'runs' / f'b-{i}' / 'run-2000-100-0.json' for i in range(7)]
head_paths = sorted((ROOT / 'head-10').glob('run-*.json'))
assert len(head_paths) == 5
base_a, base_b, head = load(a_paths), load(b_paths), load(head_paths)
base_no_load = metrics(base_a, 'afterScroll')
base_loaded = metrics(base_b, 'afterScroll')
head_loaded = metrics(head, 'afterSend')
decision = bootstrap_ratio(base_loaded['sendMs']['values'], base_no_load['sendMs']['values'])
comparison = bootstrap_ratio(head_loaded['sendMs']['values'], base_loaded['sendMs']['values'])
acceptance = bootstrap_ratio(head_loaded['sendMs']['values'], base_no_load['sendMs']['values'])
result = {
    'baseRevision': 'c612e0283173a399c11dd8f3d860dcc958f3add2',
    'headRevision': 'uncommitted P4 working tree',
    'productSourceSha256': hashlib.sha256((ROOT.parents[5] / 'public/script.js').read_bytes()).hexdigest(),
    'environment': {'node': '24.22.1', 'chromium': '156.0.8078.4', 'platform': 'Linux headless',
                    'messages': 2000, 'truncation': 100, 'shapeSeed': 20261028, 'extensionsEnabled': False},
    'baseNoLoad': base_no_load, 'baseTenLoads': base_loaded, 'headTenLoads': head_loaded,
    'decisionRatioBOverA': decision, 'p4Required': decision['ratio'] > 1.5,
    'headOverLoadedBase': comparison, 'headOverNoLoadBase': acceptance,
    'targetMsExclusive': 1.5 * base_no_load['sendMs']['median'],
    'latencyAcceptanceMet': acceptance['ratio'] < 1.5,
    'headBeforeSend': metrics(head, 'afterScroll'),
    'inputIndex': [{'path': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                   for path in a_paths + b_paths + head_paths],
    'excluded': [{'path': 'runs/b-6/run-2000-100-1.json', 'reason': 'Additional CPU-profiled run; retained, excluded from ordinary latency statistics.'}],
    'notes': [
        'Reused every supplied ordinary gate run; no gate remeasurement.',
        'Head samples are before/after against existing baseline, not contemporaneously interleaved A/B.',
        'Trim runs inside send before save; the original fill/input-through-save-response timer includes its cost.',
        'afterSend is outside the send timer; 500 old messages plus the newly appended message remain.',
        'All five samples retained, including high-latency samples; no rerun-to-green.',
        'A second equivalence process was started then interrupted before any open/timing record; timing runs were completed before subsequent equivalence checks.',
        'Report generation initially failed on unavailable frame values; fixed and regenerated from saved JSON without new measurements.',
        'First three-load equivalence failed solely on a transient success toast in computed Tab order. The harness now waits for actual toast expiry. Failed comparison retained.',
    ],
}
(ROOT / 'summary.json').write_text(json.dumps(result, indent=2) + '\n')
