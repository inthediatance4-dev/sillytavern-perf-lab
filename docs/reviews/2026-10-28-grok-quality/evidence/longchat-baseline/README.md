# Long-chat frontend baseline: measurement only

The primary 2000-message matrix has **7 successful ordinary runs per setting**.
Comparison sizes 1000 and 3000 have 5 attempts per setting. All five 3000/load-all
runs completed the measured phases but raised page exceptions; they are failed
interactive runs. A sixth diagnostic reproduced the exception with a stack.
No product optimization, `public/` change, or `src/` change was made.

The measurements use product revision `0bf27455cbab93d09821190a5deff8e4112324e1`,
Node 24.22.1, Linux, headless Chromium 156.0.8078.4, and a 1440×1000 viewport.
The user's WIP commit `790f731` contains that product code plus the harness and
first evidence. The resumed work changes reporting/tests/documentation only.

## Results

Values below are **median / nearest-rank p95, milliseconds**, excluding profiled,
startup-timeout, and page-error runs. [Full tables](combined/tables.md) include
long tasks, frames, memory, DOM, save payloads, and each older-message batch.
[Aggregated JSON](combined/aggregated.json) includes counts, failure observations,
and per-batch distributions; [the input index](combined/raw-index.json) includes
SHA-256 hashes of all 65 source records.

| Messages | Truncation | Successful ordinary runs / attempts | Open | Send through save response |
|---:|---:|---:|---:|---:|
| 2000 | 100 (default) | 7 / 11 | 1121 / 1197 | 1640 / 1827 |
| 2000 | 0 (all) | 7 / 11 | 6522 / 9682 | 5298 / 14609 |
| 2000 | 500 | 7 / 7 | 1626 / 1996 | 4065 / 4370 |
| 1000 | 100 | 5 / 5 | 778 / 820 | 689 / 729 |
| 1000 | 0 | 5 / 5 | 2877 / 3031 | 1924 / 11097 |
| 1000 | 500 | 5 / 5 | 1590 / 1733 | 1663 / 1743 |
| 3000 | 100 | 5 / 5 | 832 / 911 | 956 / 1058 |
| 3000 | 0 | 0 / 5 | failed; see below | failed; see below |
| 3000 | 500 | 5 / 5 | 1789 / 1819 | 4242 / 4528 |

Open includes the mandatory 500 ms quiet window. Send happens **after the two
scroll sweeps and up to three older-message batches**. Thus the 2000-message
send comparison has 400 messages in the DOM at truncation 100, and 2000 at both
500 and 0. It is a comparison of these workflows, not an isolated setting change
with equal DOM size. All 2000 messages remain in application memory at every
setting; truncation does not cap the full-chat save payload.

| 2000-message setting | Open long-task total ms | Longest open task ms | Sweep frame p95 ms | JS heap after open MiB | DOM nodes after open | Existing server save header ms |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 437 / 587 | 432 / 464 | 16.8 / 16.8 | 20.4 / 20.8 | 14111 | 64.3 / 113.7 |
| 0 | 5390 / 8330 | 4153 / 6906 | 33.4 / 50.0 | 23.2 / 23.4 | 154216 | 46.1 / 344.4 |
| 500 | 994 / 1142 | 779 / 862 | 33.4 / 49.9 | 21.1 / 21.1 | 43631 | 36.2 / 42.7 |

CDP's separate embedder-heap reading after open has medians 19.4 MiB (100),
181.2 MiB (0), and 53.8 MiB (500). JS heap alone understates the growth in browser
storage associated with the larger DOM. These readings are not browser RSS and
should not be added blindly together. Save payload medians are 2684 KiB (100)
and 3305 KiB (0/500); these are captured request bytes after the measured workflow.
Server time is the existing `X-Response-Time` middleware's request-to-response-
headers duration, not server CPU time or a substitute for complete send latency.

## CPU profiles and hotspots

Six raw `.cpuprofile.gz` files in [measurement/](measurement/) cover open, scroll,
and send at 2000 messages for default and load-all. The two successful profile
runs are additional to the ordinary repetitions. [Profile tables](profiles/profiles.md)
show top self and inclusive function time with URL/line, plus self/inclusive time
by file and heuristic self time by library. [Focused functions](profiles/focus-functions.json)
include lower-ranked formatting/save/token functions and explicit unobserved entries.
All six summaries were checked against their raw profiles.

Percentages include idle/native/harness time; inclusive rows overlap. Functions
are aggregated by name, URL, line and column, with recursive frames deduplicated
per sample. The requested sampling interval was 100 µs.

| Phase | Default 100 | Load-all 0 |
|---|---|---|
| Open, self | idle 40.59%; program/native 30.43%; jQuery Transit `z` 2.94% | native `querySelectorAll` 21.71%; program/native 12.13%; `doScroll` 7.96% |
| Open, inclusive | `redisplayChat` 14.82%; `updateMessageElement` 13.08%; `messageFormatting` 6.74% | `redisplayChat` 40.72%; `updateMessageElement` 28.42%; `initializeInteractables` 22.56%; `messageFormatting` 14.94% |
| Scroll, self | idle 54.98%; program/native 17.59%; native `getPropertyValue` 5.26% | program/native 82.38%; idle 17.37% |
| Scroll, inclusive | `showMoreMessages` 17.99%; `updateMessageElement` 11.36%; keyboard `initializeInteractables` 5.91% | no show-more batch: all messages already loaded; JS CPU attribution is mostly native/program |
| Send, self | program/native 36.73%; native `querySelectorAll` 9.84%; `hasDisabledOrNotFocusableAncestor` 6.80% | native `querySelectorAll` 35.76%; program/native 24.92%; `hasDisabledOrNotFocusableAncestor` 10.24% |
| Send, inclusive | keyboard mutation observer 27.83%; `initializeInteractables` 25.91%; `saveChat` 3.59% | keyboard mutation observer 59.78%; `initializeInteractables` 56.51%; `saveChat` 0.98% |

The open-profile self-time file budgets include `lib.js` at 8.2% / 13.5%, jQuery
at 3.6% / 8.2%, and `script.js` at 1.5% / 9.3% (default / all). The send-profile
self-time file budgets include `keyboard.js` at 11.3% / 15.8%; its native DOM calls
account for additional inclusive work. The production Webpack bundle has no
source map, so DOMPurify/highlight.js/other bundled internals cannot be precisely
split by package. The unresolved bundle budget is retained, not assigned zero
cost. `JSON.stringify` has no separate named sample; native work may be charged
to `saveChat`. `getTokenCountAsync` appears in open at 0.11% / 0.01% inclusive.
Unobserved functions do not establish zero cost. A JS CPU profile alone cannot
split native/program samples into layout, paint, browser bookkeeping, or waits.

## Reproduced 3000-message failure

All five load-all matrix runs raised two `RangeError: Maximum call stack size
exceeded` exceptions. The [separate diagnostic](stack-diagnostic/run-3000-0-0.json)
identifies `initializeInteractables` at `public/scripts/keyboard.js:168`, reached
from its class-change `MutationObserver`. That line spreads the full interactable
array into `makeKeyboardInteractable`. The stack and source make argument-list
size a concrete investigation target; no fix was implemented.

Captured failed-run medians/p95 are open 10319/10617 ms, send 5237/5576 ms, frame
p95 66.6/66.7 ms, and server save 49.5/68.9 ms, with 228047 DOM nodes after open.
The failed-phase table and `failedCompleted` JSON preserve this information while
keeping it out of valid interactive-run statistics. These runs must not be
presented as successful acceptance or as proof that all controls still work.

## Settings and next experiments

The actual fresh-root default was 100. In all successful runs,
`auto_load_chat=false`, `fast_ui_mode=true`, `reduced_motion=false`, and
`message_token_count_enabled=false`. The complete effective `power_user` object
is recorded in each opened run, including any other lazy-load/message limits.
Only truncation was varied. Extensions were disabled in the synthetic server
config to prevent bundled third-party remote-script and manifest requests.
Fast UI, reduced motion and extensions were not A/B tested here.

At 2000 messages, default truncation lowers median open time by about 83% versus
load-all in this experiment. The middle setting gives a modest initial open cost,
but after three 500-message batches it reaches the same 2000-message DOM size.
Default truncation's workflow keeps the DOM at 400 messages after three batches
and has substantially lower send latency. Keeping 100 is a meaningful existing
control for this experience; no user's saved settings were changed.

| Candidate experiment only | Expected impact at 2000 messages; hypothesis, not a measured improvement |
|---|---|
| Bound accessibility processing to affected subtrees; coalesce repeated mutation records while preserving focus/disabled-state behavior | Highest priority. Halving the profiled `initializeInteractables` interval would imply roughly 13% (default) / 28% (all) shorter profiled send intervals by Amdahl's law. This is not a guarantee for end-to-end send time. Also investigate the 3000-message argument-spread failure. |
| Reduce repeated DOM queries, style reads and scrolling during message insertion; retain event/extension contracts | Load-all open spends 40.7% inclusive in redisplay and 22.6% in accessibility initialization. A 10–20% end-to-end open improvement is a useful experiment target, not an established forecast; overlapping budgets cannot be added. |
| Cache formatting with complete invalidation for edits, swipes, regex/settings/extension effects | Formatting's inclusive open budget is 6.7% at default and 14.9% at all. Even a 50% reduction suggests only about 3% / 7% of the profiled open interval; lower priority than accessibility/DOM work. Preserve sanitization. |
| Investigate save serialization only after client profiling confirms it | Existing server save-header times are tens of milliseconds against multi-second client workflows. Named `saveChat` budgets are 3.6% / 1.0%; this evidence does not justify weakening fsync, locks or identity/token checks. |

No virtual scrolling, rendering cache, accessibility change, or persistence
optimization was implemented. All ideas need separate behavior/extension tests
and a measured before/after comparison.

## Method, provenance and caveats

The [run instructions](../../../../../tests/LONGCHAT-PERF.md) define the exact
intervals. Each run restores deterministic seed-20261028 mixed-length synthetic
JSONL through the API, opens a fresh page, waits for CHAT_CHANGED + last message
in DOM + two rAF + 500 ms without a long task, scrolls bottom/top/bottom, loads at
most three upstream show-more batches, then fills `/send ...` and presses Enter.
The save payload asserts one appended user message. No LLM generation is used;
all four evidence servers recorded no external/generation requests.

- `measurement/`: original complete nine-combination matrix, 53 records including
  2 successful profile runs. Its startup wait was browser `networkidle`.
- `supplement/` and `ready-check/`: 12 additional records from startup-harness
  investigation, yielding three successful ordinary replacements. They wait for
  APP_READY; their failures remain in the index. Together the three directories
  contain 46 successful ordinary runs, 8 ordinary startup timeouts, 5 ordinary
  page-error runs, 2 successful profile runs, and 4 profile startup timeouts.
- `stack-diagnostic/`: one additional 3000/load-all run with the final onboarding
  helper; purpose is exception diagnosis, excluded from the planned matrix.
- `profiles/`: derived function-aggregated summaries of the six original profiles.
  Earlier per-call-path summaries beside the raw profiles remain unchanged.

The initial harness had a `networkidle` wait and a transient-dialog race, then
an APP_READY/onboarding race. All timeouts are retained and excluded; none were
recorded as fast chat opens. The final helper clicks the currently open onboarding
dialog atomically in one browser task. The diagnostic validates that final path.
Startup/navigation is outside the open interval, but successful replacements
come from fresh synthetic roots; server/OS cache and machine-load differences
remain possible. Settings were run in blocks, not randomized or paired. Do not
infer a production throughput curve from the 1000/2000/3000 ordering.

Headless Linux, disabled extensions, a fixed viewport and synthetic text are not
Windows/real-extension acceptance. Routing disables browser HTTP cache. Each
size/setting is capped at 1200 s; runs have 120 s limits (45 s for ready-check,
90 s for the stack diagnostic). No combination was cap-skipped. The 500 ms quiet
wait is included in open and each batch; scroll-frame statistics exclude batch
loading gaps. Percentages strictly above 16.7 ms are sensitive to floating point
and display cadence. With n=5 or n=7, nearest-rank p95 is the maximum sample.
Send includes Playwright input/IPC and full save-response completion; it ends
before the post-save rendering assertion, whereas the CPU capture also includes
that assertion. Heap samples follow explicit GC outside measured phases.

The optional 10000-message run and 48a153e A/B were skipped: the 3000-message
boundary already exposes a real exception, and historical A/B would require
another isolated startup/matrix with compatible harness checks. No historical
speedup/regression claim is made.

All raw JSON and profiles remain intact. Only the explicitly requested derived
`combined/{aggregated.json,tables.md,raw-index.json}` were regenerated on resume.
`--combine` reproduces those derived artifacts and does not need Playwright.
The older `failed-completed-aggregated.json` is retained; the final comprehensive
failed-phase distributions are also embedded in `aggregated.json`.

## Validation and remaining acceptance

The browser-free narrow test is registered in `package.json:test:perf`. It tests
isolation/default retention, Windows SIGBREAK forwarding (simulated on Linux),
deterministic data/statistics/profile attribution, and immutable aggregation.
A native Windows test allocates a private console and sends CTRL_BREAK only to
its child process group, avoiding broadcasts into the CI runner; the mock child
has a 5 s natural failure timer. Python is standard-library-only for these tests.
No browser, data server, external network, or timing-performance assertion is
required in CI. The real Windows case skips on Linux with an explicit reason.

See `validation-resumed/` for final Node 20/22/24 narrow runs and lint/compile logs.
On each local Node version: 5 cases, 4 pass, 1 native-Windows skip, 0 failures.
The full suite was not run. Windows native execution remains for CI.

All four evidence servers recorded exit 0, no incomplete shutdown, and removal of
their own ownership lock. A resumed audit found no listener on any of eight
retained synthetic lab ports; see `cleanup-audit.json`. One early interrupted
`/tmp` smoke had exit 130 without graceful-shutdown evidence and retains its
owner record. It is not counted as graceful success. No stale owner record,
retirement marker, lifecycle directory, or synthetic root was deleted.

Met: primary successful counts; comparison attempt counts and honest failures;
all requested metric families; six CPU profiles and summaries; isolated data;
no generation; raw evidence and bounded failures; graceful evidence-server
shutdown; browser-free deterministic narrow checks. Partial/unmet: successful
3000/load-all interactivity, exact attribution inside the minified library
bundle, and native Windows browser/console execution locally. Optional historical
A/B and 10000 scaling were omitted. No commit or push was made by the agent.
