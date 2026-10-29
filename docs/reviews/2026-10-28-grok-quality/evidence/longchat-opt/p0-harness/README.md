# P0: trustworthy long-chat harness

Only the measurement harness and its documentation/tests changed. Product files
under `public/` and `src/` are unchanged. No P1–P4 optimization was attempted.

## Startup diagnosis and acceptance

The [diagnostic extraction](startup-diagnosis.json) retains the errors from all
12 `supplement/` and `ready-check/` records. Nine timed out (including profiled
attempts); eight waited on dialog locators that became hidden/detached or no
longer existed. One timed out inside `Page.wait_for_function`; its saved call log does not
identify the exact predicate. These
records do not prove a lost APP_READY event: it is sticky, as confirmed in
`public/lib/eventemitter.js`. Startup awaits `getSettings`, which can await the
persona onboarding popup before APP_READY can be emitted. This establishes why
waiting for the event without concurrently driving onboarding can block, while
the eight locator failures directly establish the transient-dialog race.

The predicate now subscribes to sticky APP_READY and reads/fills/clicks the
currently open onboarding dialog within one browser evaluation. It waits for
`#chat`, visible `#send_textarea`, no open dialog and no splash screen. Unexpected
dialogs are not dismissed. There are no fixed startup sleeps.

| Check | Attempts | Success | Timeouts | Other failures |
|---|---:|---:|---:|---:|
| Consecutive fresh-context startups, onboarding forced on every attempt | 50 | 50 | 0 | 0 |

[Raw startup records](startups/) include each onboarding interaction and startup
latency. Only synthetic `/api/settings/get` responses receive `firstRun=true`;
product settings behavior is unchanged. The server exited normally, its owner
lock was removed, and no external/generation request was attempted.

## Measurement method

Node 24.22.1, Chromium 156 headless, Linux, 1440×1000, extensions disabled,
truncation 100. Each recorded A/B side/run starts its own server with a unique
synthetic data root and fresh browser. The baseline is archived revision
`37a48181fc55f7d2c45bae05f1a68c26a4c76d5d`; head is WORKTREE. Product code is equal.
The current harness measures both sides. ABAB order is retained in comparison
JSON, with no discarded warmup, replacement sample, or dropped failed pair.

Open still includes two animation frames and the original 500 ms long-task quiet
window. Startup/navigation, restoration, and explicit GC are outside open timing.
Only open is timed for P0; scroll/send and profiles are omitted to bound cost.

Summaries call `scripts/benchmark-statistics.mjs` directly: arithmetic median,
nearest-rank p95, 2000 paired bootstrap resamples, seed `opus-round1.5`, percentile
95% interval for median(head) minus median(base). Positive differences mean head
is slower. A/B comparison is a harness calibration, not a product speedup claim.

## Final open measurements

Acceptance uses [the complete A/B matrix](ab-complete-directories/comparison.json).
All 28 runs succeeded, without page exceptions, forbidden requests, or shutdown
failures. Values are ms; n is **per side**.

| Messages / truncation | n | Base median / p95 | Head median / p95 | Head − base median | Bootstrap 95% CI |
|---|---:|---:|---:|---:|---:|
| 2000 / 100 | 7 | 825.7 / 866.8 | 811.9 / 900.3 | -13.8 | [-40.9, 63.4] |
| 3000 / 100 | 7 | 843.3 / 854.6 | 825.8 / 865.0 | -17.5 | [-28.6, 6.4] |

Both A/B intervals include zero, consistent with equal product sources. At fixed
shape, 3000 is slightly slower than 2000 on both sides; the old reversed ordering
has disappeared. These measurements do not claim a product optimization.

## Data shape and the earlier size anomaly

[Data shape JSON](data-shape.json) compares the last 100 messages. The old
fixture already had ten assistant swipe messages at identical positions for
2000/3000; swipe multiplicities and body/code shapes differed. Its 2000 window
contained 89,885 body characters and 24 messages ≥2 KiB, versus 77,617 and 20 at
3000. Thus swipe count alone cannot explain the historical 1121 vs 832 ms medians.

The new fixture anchors every shape decision to distance from the chat end.
Length choices and swipe multiplicities repeat every 100, code placement is
anchored at the same relative offsets, and each last-100 window has ten assistant
swipe messages, 25 alternatives, 90,455 body characters, 15 fenced-code messages,
and 25 messages ≥2 KiB. Message IDs and fixed dates remain distinct.

An extra [old-shape diagnostic](legacy-shape/) uses the same current product,
readiness predicate, viewport and settings, with seven runs per size:

| Fixture | Messages | n | Open median / p95 ms |
|---|---:|---:|---:|
| Historical generator, remeasured | 2000 | 7 | 815.4 / 858.8 |
| Historical generator, remeasured | 3000 | 7 | 828.7 / 849.0 |
| Fixed generator, WORKTREE A/B side | 2000 | 7 | 811.9 / 900.3 |
| Fixed generator, WORKTREE A/B side | 3000 | 7 | 825.8 / 865.0 |

The historical reversal does **not** reproduce even with the old generator.
Therefore the old 289 ms gap cannot credibly be assigned to swipe position/count,
and this experiment does not prove the remaining body-shape difference caused
it. Shape was a real confound and is now controlled; unique historical causal
attribution remains inconclusive. Old-shape repetitions share one server, while
the A/B matrix uses a fresh server per run; background startup/batch conditions
also differ from the original baseline. No historical timing is erased or
presented as a direct product A/B speedup.

## Functional equivalence

Snapshots are retained as adjacent deterministic `.html.gz` files; each run JSON
keeps their decompressed UTF-8 SHA-256, byte length and relative filename. Full
Tab sequences remain inline. The [storage follow-up](../p0-snapshot-gzip/README.md)
records lossless conversion of all 12 snapshots without rerunning browsers,
with original/decompressed hashes and refreshed run hashes in its raw index.
The [usage guide](../../../../../../tests/LONGCHAT-PERF.md#p0-comparison-and-equivalence-harness)
documents normalization precisely. Only declared random ID references and
clock/timing fields are removed; message text, order, focusability, roles,
classes and style remain significant. Equality is byte/sequence exact. Mismatches
produce unified diffs for both DOM phases and every affected Tab scenario.

Tab walks start at body or the active modal and press Tab through the complete
visible enabled control count plus two. They traverse chat and main controls,
append an actual message through `/send`, add `.interactable` later, toggle an
ancestor's `.disabled` class on/off, and open/close an upstream Popup. Modal walks
count only dialog controls because native dialogs trap focus. The positive
control also verifies that the late control is reached, disabled children are
skipped/restored, and focus returns to main controls after popup closure.

The final fixed-fixture [positive control](equivalence-final/comparison.json)
reports **equal** for both snapshots and all seven Tab walks. The earlier
[equal control](equivalence-self/comparison.json), before the fixture's assistant
swipe positions were aligned with the original generator, is retained as a
harness diagnostic rather than final fixture acceptance.

| Tab scenario | Presses / side | Chat traversed | Send reached | Late control | Child control | Popup control |
|---|---:|---|---|---|---|---|
| Older messages | 565 | yes | yes | absent | absent | absent |
| Real message appended | 565 | yes | yes | absent | absent | absent |
| Interactable class added | 567 | yes | yes | yes | yes | absent |
| Ancestor disabled | 566 | yes | yes | yes | skipped | absent |
| Ancestor enabled | 567 | yes | yes | yes | restored | absent |
| Popup open | 4 | modal trap | no | outside modal | outside modal | yes |
| Popup closed | 567 | yes | yes | yes | yes | absent |

The [negative A/B control](equivalence-negative/comparison.json) reports
**different** for both DOM phases and six non-modal Tab sequences, with unified
diffs. Both browser runs themselves succeeded; comparison exit code 1 was the
expected detection result. The temporary archived copy appended
`button#p0-perturbation` on CHAT_CHANGED; the modal walk correctly remains equal.
[Control provenance](negative-control.json) records the exact perturbation and
SHA-256 values proving the original source bytes were restored afterward.

## Validation and completion

[Raw check output](checks.json) records narrow browser-free tests on Node
20.19.2, 22.20.0 and 24.22.1: **8 passed, 1 platform skip, 0 failures** per version.
The skip is the native Windows CTRL_BREAK test; its Linux simulation passes.
The shell's default node resolved to 24, so Node 22 was checked by explicit path;
Node 24 was consequently exercised twice. ESLint passed on all three changed JS
modules. `git diff --check` passed. No new test entry was necessary because the
extended test file is already in `test:perf`.

[Summary JSON](summary.json) includes all acceptance counts, shape measurements,
focus coverage and shutdown audits. All **34 acceptance/diagnostic servers**
(startup 1, A/B 28, old-shape 1, final equivalence 2, negative control 2) exited
normally with owner locks removed and zero forbidden requests. The earlier
positive-control servers also exited normally. Browsers are closed by the
harness; no forced process termination was used.

| P0 requirement | Result |
|---|---|
| Diagnose startup race and 50 consecutive startups with no timeout | met; one historical generic wait has insufficient predicate detail |
| Deterministic end-relative shape and ≥7 reruns at 2000/100 and 3000/100 | met; exact historical timing cause remains inconclusive |
| Alternating revision A/B, ≥7 per side, seeded median-difference 95% CI | met |
| Exact DOM and Tab equivalence, dynamic P1 scenarios | met |
| Current/current equal and temporary perturbed copy different | met |
| Windows CI/manual real-chat validation from the broader plan | not run in this Linux, no-push step |

## Preserved setup failures and root fix

[Initial A/B attempt](ab/) failed because Git archives omit empty runtime
directories: the first archived server tried to create `backups/` in a read-only
source tree. Its original orchestrator continued recording failed baseline
attempts; none of those timings is acceptance evidence. The first fix precreated
only some directories; [the next attempt](ab-fixed/) stopped immediately on the
missing `public/sounds` directory. Both attempts remain intact.

Materialization now imports **all** PUBLIC_DIRECTORIES values from the archived
revision, creates the missing empty directories before write-protecting the
archive, and validates path containment. The sources stay read-only at runtime.
A browser-free regression assertion covers empty directories and escaping paths.
A/B now stops immediately on a failed child, retaining its exit code, status,
metadata and server log. These were deterministic setup defects, corrected at
their source; there is no retry-to-green logic.

## Limits and deviations

No CPU profile was needed for P0. No full test suite, remote CI, or Windows GUI
run was launched. Native Windows process-group handling remains a documented
platform-only skip on Linux. Real-chat Windows acceptance remains for later
product changes; this step changes no frontend behavior. All synthetic roots are
retained; no user data, lifecycle markers, persistence checks or Git refs were
modified. Temporary negative-control source is restored after its run.
