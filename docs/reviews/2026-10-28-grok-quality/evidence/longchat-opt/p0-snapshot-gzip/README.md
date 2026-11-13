# P0 follow-up: compressed equivalence snapshots

The harness stores each normalized DOM snapshot beside its run JSON as
`run-<label>-dom-<phase>.html.gz`. Gzip uses mtime 0 and an empty embedded filename.
The JSON DOM entry contains only `sha256`, `length` (decompressed UTF-8 bytes), and
`file` (relative to the run JSON). Tab sequences remain inline. Comparison reads
and verifies both gzip files, then performs the same exact comparison and emits
readable unified diffs on mismatch. Older inline observations remain readable.
Missing files, corrupt gzip, wrong hashes and wrong lengths fail explicitly.

Only `tests/browser-longchat-perf.py`, `tests/longchat-measurement.test.mjs`,
`tests/LONGCHAT-PERF.md`, and the P0 evidence/documentation changed in this follow-up.
Product code and behavior are unchanged. No browser, lab server, A/B timing run,
or CPU profile was started. Timing median/p95 base vs head are not applicable
(n = 0); the measurements below compare storage before and after conversion.

## Storage measurements

[Raw index](raw-index.json) records original/new run hashes, per-snapshot inline
and decompressed hashes, compressed-file hashes, byte counts, and preserved
comparison hashes. Each gzip was read back and verified against the original
inline UTF-8 bytes **before** the inline copy was removed. Restoring the strings
from gzip reproduced all six parsed records exactly, including every Tab entry
and timing field. The P0 manifest now includes the gzip files and refreshed hashes.

| Artifact | n | Before median / p95 bytes | After median / p95 bytes | Before total bytes | After total bytes |
|---|---:|---:|---:|---:|---:|
| Equivalence run JSON plus adjacent snapshots | 6 | 5,084,148.5 / 5,086,585 | 1,910,538.5 / 1,912,910 | 30,501,974 | 11,463,205 |

Arithmetic median and nearest-rank p95; after sizes include both gzip files per
run. Savings: **19,038,769 bytes (62.42%)**. Remaining bulk is the unchanged full
Tab sequences; this step changes only DOM snapshot storage.

## Equivalence and validation

All three comparisons were recomputed directly from the compressed evidence.
Their entire result objects, including readable diff lines, exactly match the
saved comparison JSON. The saved comparison files were left byte-for-byte intact.

| Saved control | DOM snapshots | Tab walks | Result after conversion |
|---|---|---|---|
| equivalence-final | both equal | all 7 equal | identical positive result |
| equivalence-self | both equal | all 7 equal | identical positive result |
| equivalence-negative | both different | 6 different; modal equal | identical negative result and diffs |

| Check | Result |
|---|---|
| Decompressed SHA-256 equals original inline SHA-256 | 12 / 12 |
| Exact reconstructed records; non-DOM fields unchanged | 6 / 6 |
| Comparison objects and diff lines preserved | 3 / 3 |
| Deterministic header (mtime 0, no filename) | 12 / 12 |
| ESLint on changed JavaScript test | passed |
| Python py_compile on changed harness | passed |
| node --test tests/longchat-measurement.test.mjs | 7 passed, 1 Windows-only skip, 0 failed |
| git diff --check | passed |

[Check record](checks.json) includes the initial new-test import-path failure:
the Python subprocess omitted `PYTHONPATH=tests`. Setting it to match the existing
harness test fixed the root cause; no retry logic was added. The conversion helper
hit the same import error before any snapshot or run JSON was written and was
corrected before conversion.

All requested follow-up acceptance criteria are met. No new test file or
`test:perf` registration was needed. No broader suite, remote CI or Windows
browser run was required for this storage-only step. No Git refs, user data,
persistence checks, or lifecycle markers were changed. No deviations.
