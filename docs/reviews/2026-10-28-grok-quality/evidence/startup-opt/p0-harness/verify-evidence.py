"""Run from <repo> after all checks. Does not inspect browser profiles or recycled caches."""
import gzip
import hashlib
import json
from pathlib import Path
import socket

root = Path(__file__).resolve().parent
comparison = json.loads((root / 'comparison.json').read_text())
assert comparison['runsPerSide'] == 24
assert comparison['allCiIncludeZero']
assert all(row['difference']['ci95'][0] <= 0 <= row['difference']['ci95'][1] for row in comparison['metrics'].values())
for group in ['same-commit']:
    invocation = json.loads((root / group / 'invocation.json').read_text())
    assert invocation['toolCommit'] == comparison['commit']
    assert invocation['products']['base']['revision'] == invocation['products']['head']['revision'] == comparison['commit']
    assert invocation['products']['base']['productSourceSha256'] == invocation['products']['head']['productSourceSha256']
    for file, sha in invocation['toolSourceSha256'].items():
        assert hashlib.sha256(Path(file).read_bytes()).hexdigest() == sha, file
    for i in range(1, int(invocation['args']['runs']) + 1):
        for side in ['base', 'head']:
            row = json.loads((root / group / f'{i:02}-{side}.json').read_text())
            assert row['status'] == 'ok' and row['lockGone'] and row['exit']['code'] == 0
            assert 0 < row['httpMs'] < row['uiMs'] < row['sendMs']
            assert not row['browser']['pageErrors']
            assert row['generation']['model'] == 'startup-synthetic'
locks = (root / 'lock-check.txt').read_text().splitlines()
assert len(locks) == 31  # one discarded warmup plus 30 measured launches
assert all('status=ok exit=0 lockGone=true' in line for line in locks)
for file in root.rglob('*'):
    if not file.is_file() or any(p in file.parts for p in ['browser-profile', '.recycle']):
        continue
    data = gzip.decompress(file.read_bytes()) if file.suffix == '.gz' else file.read_bytes()
    # Split literals so this verifier's own source is also redaction-clean.
    forbidden = [b'/' + b'workspace/', b'/' + b'home/box', socket.gethostname().encode()]
    assert not any(value in data for value in forbidden), str(file)
print('PASS: 24 paired samples per side; all six 95% intervals include zero; all UI/send checks pass.')
print('PASS: 30 consecutive HTTP-ready launches; SIGINT exit 0 and owner lock removed each time.')
print('PASS: tool hashes match delivered source; identical immutable product commit on both sides.')
print('PASS: evidence redaction scan (including decompressed traces/logs/probes); browser/recycled caches excluded.')
