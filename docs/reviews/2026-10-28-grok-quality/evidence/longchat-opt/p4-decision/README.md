# P4: top-of-DOM retirement

P4 is required by the existing gate. The implementation retires old message DOM
at the user-send boundary, keeps the newest five truncation batches, and leaves
all chat data intact. **The measured send latency target is not met.**

Product base: `c612e0283173a399c11dd8f3d860dcc958f3add2`; head: uncommitted P4
working tree. `summary.json` records the product source SHA-256 and input hashes.
Linux, Node 24.22.1, headless Chromium 156.0.8078.4, 1440×1000, synthetic seed
20261028, 2000 messages, truncation 100, extensions disabled. No gate runs were
repeated. Older revisions used immutable `git archive` copies, with separate
fresh lab data directories. No branch/ref changes or commits were made.

## Existing decision gate and post-implementation result

Milliseconds are median / nearest-rank p95. DOM nodes count all document elements.
The baseline rows describe the pre-send DOM; head describes post-trim/post-append
DOM. Head's pre-send DOM still contains 1100 messages / 87858 nodes.

| Workflow | n | Send ms median / p95 | DOM nodes median / p95 | Displayed messages |
|---|---:|---:|---:|---:|
| Base (a): no older loads | 7 | 398.99 / 612.39 | 14035 / 14035 | 100 |
| Base (b): ten older batches | 7 | 1487.44 / 1704.84 | 87858 / 87858 | 1100 |
| Head: ten older batches, trim on send | 5 | 1060.36 / 2215.38 | 43684 / 43684 | 501 |

The existing gate ratio median(b)/median(a) is **3.728**, with seeded bootstrap
95% CI **[2.320, 4.315]**, exceeding 1.5. Decision: implement P4.
The additional CPU-profiled `runs/b-6/run-2000-100-1.json` is preserved and excluded
from ordinary latency samples. Every supplied ordinary gate run is used.

Head/base(b) median ratio is **0.713** (28.7% lower observed median), bootstrap CI
**[0.514, 1.772]**. The p95 increased; this small, noisy before/after sample does
not establish a statistically reliable latency improvement. Head/base(a) is
**2.658**, CI **[1.732, 5.552]**. The requested strict target is **<598.48 ms**;
1060.36 ms fails it. No further latency runs were made to obtain a passing result.

All ratio intervals use independent resampling of both sample sets, seed
20261029, 50000 resamples, ratios of medians, nearest-rank 2.5/97.5 percentiles.
These are reused-base before/after comparisons, not a new interleaved A/B matrix.
Reproduce the calculations with `python3 summarize.py` in this directory.

## Design and compatibility

- `public/script.js` adds a private `trimMessageDom`, called after attachment work
  and the P3 older-insertion barrier in `sendMessageAsUser`. When count exceeds
  `5 * chat_truncation`, it removes only the oldest direct `.mes` DOM children.
  It retains 500 existing messages at truncation 100; the append adds one. Later
  sends repeat the bound. Zero truncation retains load-all behavior.
- Retirement uses jQuery removal to clean associated handlers/data. It neither
  modifies the chat array nor emits additional message events. Public signatures,
  original event counts/order/arguments, and non-triggered rendering stay intact.
- It recreates `#show_more_messages` if the first survivor has a positive mesid
  and the button is missing. Older nodes can be rendered again by show-more.
- It records the first kept node's bounding rectangle, removes the prefix and
  restores `scrollTop` by the geometry delta. It does not depend on CSS anchoring.
  If the viewport itself was inside retired content, native scroll bounds limit
  compensation; that retired content must be reloaded to view it again.
- An open message editor, textarea (including reasoning/extension controls), or
  focused control in the removal range defers retirement until a later send.
  The open editor/control is preserved; the cap is temporarily exceeded.
- Existing edit/delete/move missing-DOM guards safely no-op. Tests execute these
  real functions, first-survivor deletion/renumbering, and a tool-call deletion
  crossing the boundary. They require no changes to existing mutation semantics.

**Scheduling deviation:** retirement runs before send, not after show-more.
Immediate top retirement after a load would discard the just-loaded older nodes;
repeated show-more calls could never advance past the cap. Browsing therefore
can exceed the threshold, and send is the safe, bounded retirement point after
P3 preparation. This is always on; no lab-only or extension flag is introduced.
Extensions retaining old element references can observe disconnected nodes, as
anticipated by P4; they must resolve/reload by mesid. Protected editors reduce
that risk without changing extension events.

## Checks

| Check | Result |
|---|---|
| Existing gate/bootstrap | Required: ratio 3.728, lower CI >1.5 |
| Five ordinary post-trim sends | 5/5 successful; all samples retained |
| DOM bounded at send | 500 retained + 1 appended; 43684 median nodes |
| Send median <1.5× no-load | **Unmet**, 2.658× |
| No-trim equivalence, 0 older batches | Equal DOM, events, physical Tabs, computed order |
| No-trim equivalence, 3 older batches | Equal after deterministic toast-expiry wait |
| Browser boundary/anchor/reload/save scenario | Passed; anchor drift 0 px; saved chat identical |
| Narrow tests, Linux Node 20 / 22 / 24 | Each: 27 total, 26 passed, 1 Windows-only skip, 0 failed |
| ESLint, changed JS/MJS files | Passed |
| Windows CI / real-chat manual check | Not run in this Linux environment |

Each equivalence pair used one base and one head run, 2000/100. Seven Tab
scenarios cover older/appended/class-added/ancestor-disabled/ancestor-enabled/
popup-open/popup-closed. Each non-modal scenario used 128 real Tab presses;
popup used 4. Complete computed focus orders were compared as well. This is a
bounded native Tab walk, not a complete native cycle. Full chat snapshots and
registered rendering/completion events were compared exactly.

Narrow test command on each available Node version:

```sh
LONGCHAT_TEST_PYTHON=<python> node --test tests/longchat-dom-trim.test.mjs tests/longchat-older-slices.test.mjs tests/longchat-measurement.test.mjs tests/longchat-insert-path.test.mjs
npx eslint public/script.js tests/longchat-dom-trim.test.mjs tests/longchat-browser-probe.mjs tests/longchat-measurement.test.mjs
```

The new six-case browser-free trim test is registered in `test:perf`. Browser
cases remain opt-in in the Python harness. The full suite was not run.

## Raw records and harness fixes

- `runs/{a,b}-*/`: supplied gate JSON and one gzip CPU profile; unchanged.
- `head-10/`: five new ordinary sends with ten anchored older loads, no CPU
  profiles; `afterSend` snapshot is outside the original fill/input-through-save
  timer. Trim itself is inside that timer. Each `run-*.json` is a successful run.
- `head-10-derived/`: reports rebuilt from those saved records. Initial reporting
  failed sorting multiple unavailable frame statistics (`None`); sliced-load mode
  performs no frame sweep. `distribution` now excludes unavailable values,
  reporting n=0/null, with deterministic regression assertions. No measurements
  were repeated to repair the report.
- `equivalence-0/`: interrupted before any open/timing record to avoid competing
  browsers during latency measurement; retained as an empty attempt directory.
- `equivalence-0-complete/`: successful zero-load A/B equivalence.
- `equivalence-3/`: preserved first failure. Only `tabOrder/older` differed by a
  focusable success toast expiring on one side. DOM/events/physical Tabs matched.
  The harness now waits for actual `#toast-container .toast` disappearance before
  each Tab scenario. It does not hide controls or filter focus descriptors.
- `equivalence-3-toast-drained/`: successful comparison after that harness fix.
- `trim-boundary/`: one functional run, no latency sample. Verifies the anchor
  with CSS `overflow-anchor:none`, restores a deliberately absent history button,
  verifies saved JSON against the chat array, exercises boundary mutations and
  reloads/edits a trimmed message.
- Large equivalence JSON and HTML snapshots are gzip-compressed deterministically.
  `comparison.json` remains readable; raw run JSON is `*.json.gz` where large.
  `validation.json` records final check counts, shutdown and redaction checks.
  Evidence size after compression: approximately 1.82 MB (below 10 MB).

All completed labs report server exit 0, no stuck shutdown, owner-lock removal,
and no forbidden generation/external requests. Timing and equivalence browsers
were run separately after the interrupted startup attempt. No forced shutdown,
persistence/lifecycle changes, source checkout/reset/stash, or user-data removal.

## Final decision: product change not committed

The gate triggered (ratio 3.728, CI [2.320, 4.315]), and the always-on trim was
implemented and measured. It is **not** merged:

- The latency target failed: head median 1060 ms against a required <598 ms.
- The improvement is not established. The head/base(b) median ratio CI is
  [0.514, 1.772], and it includes 1. The p95 got worse: 1705 to 2215 ms.
- It changes visible behavior on every send. Loaded history leaves the DOM, and
  a synthesized `#show_more_messages` element replaces the original one. This
  is risk with no proven benefit.

The trim diff and its unit test are kept for reference only:
[rejected/p4-dom-trim-script.patch](rejected/p4-dom-trim-script.patch) and
[rejected/longchat-dom-trim.test.mjs.txt](rejected/longchat-dom-trim.test.mjs.txt).
The harness additions (trim-boundary scenario, toast-expiry wait, None-safe
distribution) are committed. Product code stays at the P3 state.

Next lever, not implemented: the (b) send profile shows that send cost still
grows with the DOM after older loads. A future attempt should profile that
send path first instead of trimming.
