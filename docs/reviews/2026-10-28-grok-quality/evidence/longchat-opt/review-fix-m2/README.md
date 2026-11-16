# M2: preparation concurrency acceptance

All acceptance criteria for this step are met. This continuation preserves the
existing product abort fix and corrects two probe expectations. No latency claim
or merge-blocker 3 A/B measurement is made here.

## Product design

`showMoreMessages()` captures an ownership token before preparing a detached
fragment: load serial, character, group, chat filename, metadata object, message
array identity, and message count. `isCurrent()` checks the token at each slice
and immediately before insertion. A stale batch returns without inserting or
emitting `MORE_MESSAGES_LOADED`; its insertion barrier is released in `finally`.
`clearChat()` increments the load serial before awaiting that barrier, then checks
that its own clear has not been superseded. Navigation can therefore cancel the
old preparation without inserting old messages after a selection change.
Existing structural mutation barriers remain in place; displayed-message edits
and swipes can complete while the older fragment is detached.

## Reference construction

Each operation gets two fresh pages, each restoring the identical saved synthetic
300-message chat with truncation 100. The reference finishes one older load before
performing the operation. The concurrent run invokes the same production operation
at the first preparation yield, with 100 live messages and zero fragment insertions.
Same-chat navigation holds the yield for 50 ms to cross its save-gate poll; edits
and swipes finish while paused. Structural operations await the production barrier.

Both pages fix wall time, disable jQuery animation duration, and canonicalize swipe
metadata before capturing the initial array. Regeneration executes the real
`Generate('regenerate')` with exactly one locally fulfilled Kobold response.
There are no real LLM calls. Snapshots compare complete normalized DOM and full
chat arrays. Checks also cover contiguous IDs, unchanged unrelated fields, saved
active-chat data, synchronous insertion ownership, completion counts, page errors,
and forbidden requests. This is functional testing, outside latency samples.

These continuation runs use worktree product code and the current harness, both
based on HEAD `6586620a9cb5f08da74db016db92456aafacbe6e` plus uncommitted changes.
No historical revision was materialized in this continuation. `source-manifest.json`
and `source.patch.gz` identify the tested files. Inherited `before/`, `after/`, and
`acceptance/` are retained as prior-session evidence, including all failures; they
are not the final acceptance run.

## Probe corrections and diagnosis

The inherited swipe DOM diff changed only the class order on message 299:
`last_swipe fade last_mes` versus `last_swipe last_mes fade`.
`normalizeSnapshot()` now sorts tokens in `class`/`classList`, `rel`, `sandbox`,
`part`, and `headers`. Token membership remains significant; ordered ARIA references,
style declarations, message text, identity, focusability, and element order remain
significant. A browser-free test verifies both equivalence and negative controls.

`regenerate-diagnostic/` retains the two failed diagnostic runs. Both identified
exactly `chat.298.extra.reasoning`: absent (logged as null) versus `""`.
`saveReply()` explicitly initializes reasoning on the preceding user message
before appending the new reply. The probe now expects that precise initialization
on message 298 and still compares every other field. This required no further
product change. Unrelated-entry errors retain a bounded JSON field diff.

## Results

| Scenario | Full-suite reference | Full-suite concurrent | DOM / array match |
| --- | --- | --- | --- |
| switch-character | PASS (#0) | PASS (#1) | exact / exact |
| switch-chat | PASS (#2) | PASS (#3) | exact / exact |
| delete | PASS (#4) | PASS (#5) | exact / exact |
| delete-last | PASS (#6) | PASS (#7) | exact / exact |
| edit | PASS (#8) | PASS (#9) | exact / exact |
| swipe | PASS (#10) | PASS (#11) | exact / exact |
| regenerate | PASS (#12) | PASS (#13) | exact / exact |

Focused reruns: `swipe-fixed/` 2/2 and `regenerate-fixed/` 2/2. The single subsequent
`full-suite/` invocation passed 14/14, with zero wrong-chat insertions, page errors,
or forbidden requests. Concurrent switches inserted/completed zero times; other
concurrent cases inserted/completed once. Every concurrent trigger recorded
100 live messages and zero prior insertions. All final arrays matched saved data.
Node v20.19.2; Chromium 156.0.8078.4; extensions disabled. All continuation labs
reported exit 0, no incomplete shutdown, and owner-lock removal; browsers closed.

`node20-unit-final.txt`: 58 tests, 57 passed, 1 native-Windows-only skip, 0 failed.
Includes abort ownership, older slices, normalization and measurement tests.
`eslint.txt`: all six changed JS/MJS files pass. Python syntax parsing passes.
No new test file or `test:perf` registration was needed.

The full browser invocation used the supplied Python environment and Node 20:

```sh
<tmp>/pw-venv/bin/python tests/browser-longchat-perf.py \
  --node <tmp>/node-v20.19.2-linux-x64/bin/node --sizes 300 --settings 100 \
  --prep-scenarios switch-character,switch-chat,delete,delete-last,edit,swipe,regenerate \
  --output docs/reviews/2026-10-28-grok-quality/evidence/longchat-opt/review-fix-m2/full-suite
```

Use a fresh output directory to reproduce. Paths/hostname are redacted; DOM/chat
artifacts and large logs are gzipped. Evidence remains below 10 MB. No failed run
was discarded or repeated without an identified code/probe fix. The final unit
run followed an added assertion for symlinked dependency-path redaction. No
branches/tags, commits, or pushes were changed. No scope deviations.
