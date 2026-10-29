# Long-chat frontend measurement

Run from the checkout with installed Node dependencies and Python Playwright + Chromium:

```sh
/tmp/pw-venv/bin/python tests/browser-longchat-perf.py \
  --node /tmp/node-v24.22.1-linux-x64/bin/node \
  --output docs/reviews/2026-10-28-grok-quality/evidence/longchat-baseline/new-measurement
```

Output must not exist. Subsequent runs need a new output name. The previous
`browser-performance-lab.py` remains unchanged and still targets a separately
started lab. This harness starts its own server, never calls `prepareLab`, never
opens the repository `.lab-data`, and retains its fresh synthetic system-temp
root after completion for inspection. One server owns that root. The server
uses `labServerArguments` and enforced loopback/config isolation; environment
`SILLYTAVERN_*` overrides are removed. External network and generation requests
are blocked and recorded as failures. Extensions are disabled in this temporary
config because the bundled third-party extensions load remote scripts and check
remote manifests; this is an upstream-core baseline, not extension acceptance.
Retention, fsync, token checks and lifecycle locks are unchanged.

Defaults: 2000 messages × 7 ordinary runs per setting; 1000 and 3000 × 5.
Truncations: 100 (upstream default, also recorded before override), 0, 500.
Two **additional** 2000-message runs profile truncation 100 and 0, excluded from
aggregate latency statistics. Seed 20261028 generates identical mixed short,
paragraph and 2–4 KB messages, markdown, three fenced-code languages, alternating
roles, fixed increasing dates, and 10% messages with 2–5 swipes. Each iteration
restores its exact input through `/api/chats/save`, then opens a new page in the
same browser context. The network routing guard disables browser HTTP cache; server/OS caches warm up across runs. Navigation/module startup and input
restoration are outside the open interval. Startup waits for DOMContentLoaded, visible onboarding completion, and the upstream sticky APP_READY event; it does not wait for all background network traffic to stop.
Every run records the entire effective `power_user` object, including truncation,
auto load, fast UI, reduced motion and token display settings.

Open begins immediately before `selectCharacterById`, ends after its promise,
CHAT_CHANGED, exact in-memory length and last DOM message assertions, two rAF,
and 500 ms with no observed ≥50 ms long task. This is a repeatable interactivity
proxy; sub-50 ms work may continue. Long tasks are browser PerformanceObserver
entries. Memory is CDP Runtime.getHeapUsage after explicit collectGarbage; GC is
outside the measured open/scroll phases. DOM and message counts accompany heap.

Scroll uses two 61-frame stepped bottom→top→bottom sweeps, one before and one
after loading up to three older-message batches through the actual exported upstream
`showMoreMessages()` (same path as the Show more button). The `--older-batches` limit defaults to 3 to bound runtime; raw output records whether older messages remain. Each batch includes
two rAF and the 500 ms quiet condition. Frame intervals come from rAF, with
median/p95 and percentage strictly above 16.7 and 50 ms; headless Chromium's
refresh scheduling and the 16.7 threshold affect these percentages. Batch work
is measured separately and is not inserted into the rAF sweep distribution.
No older-message batch exists when truncation is 0.

Send starts before Playwright fills `#send_textarea` with `/send Synthetic
measurement message **hello**` and presses Enter (the normal send hotkey); ends after the matching
POST `/api/chats/save` response body completes. Upstream `/send` appends a user
message and calls `saveChatConditional` without generation. Payload assertions
check exactly one appended user message and its text. This measures command
input + dispatch + user append + complete save, not LLM generation; upstream
renders the new message after its save, so this is not a post-render latency.
Payload size is UTF-8 request body bytes. `X-Response-Time` is the existing server
middleware's request-to-response-headers duration (includes save processing,
not browser queueing or response transfer). Browser requestStart→responseStart
and responseEnd are separate network timings; they are not pure server CPU.

Each run has a 120 s timeout, each size/setting 1200 s; remaining runs after the
cap are explicit skips, never fabricated timings. Raw JSON retains failures;
aggregates use successful ordinary runs only, nearest-rank median/p95, and
include sample counts. Timeouts are not treated as successful performance.
`--runs 1 --sizes 2000 --settings 100` is a smoke check, not acceptance evidence.
10k and the historical 48a153e comparison are optional and omitted by default.

CPU profiles use CDP 100 µs requested sampling, separate open/scroll/send files,
gzipped. Profile summary JSON and `profiles.md` report self and inclusive ancestor sample time,
file URLs and one-based lines, and heuristic library categories. Inclusive
percentages overlap; idle/native samples remain in the denominator. V8 may
attribute JSON.stringify/native work to its caller; zero/absent category samples
do not prove no cost. Profiling overhead is excluded from ordinary-run tables.

Use `--profile-phases send` to capture only send CPU profiles in the additional
profiled runs. The workflow and exclusion of profiled runs from latency statistics
stay the same; the default still captures all three phases.

Linux shutdown sends SIGINT and waits 45 s; Windows starts a new console process
group and sends CTRL_BREAK_EVENT, which the measurement entry point forwards to
the server's normal SIGINT handlers. A stuck process is left for inspection and
marked unsuccessful, never killed or counted as graceful. Unit tests simulate
SIGBREAK forwarding on Linux; a native Windows CTRL_BREAK process-group test runs in the
Node 20/22/24 Windows CI `test:perf` jobs and explicitly skips elsewhere. Browser
measurements themselves require Playwright and are opt-in, not CI timings.

Validation: `npx eslint scripts/longchat-lab-server.mjs tests/longchat-*.mjs`
and `node --test tests/longchat-measurement.test.mjs` (registered in `test:perf`).


## Rebuild the final combined report

This command needs only standard-library Python, with no browser or server. It
regenerates the three derived files in `combined/`, retaining raw input bytes and
recording their SHA-256 hashes. It distinguishes successful runs, startup
failures, and completed phases with page errors. Profiled runs are excluded from
latency distributions. Per-batch long-task distributions are included.

```sh
python3 tests/browser-longchat-perf.py \
  --output docs/reviews/2026-10-28-grok-quality/evidence/longchat-baseline/combined \
  --combine \
  docs/reviews/2026-10-28-grok-quality/evidence/longchat-baseline/measurement \
  docs/reviews/2026-10-28-grok-quality/evidence/longchat-baseline/supplement \
  docs/reviews/2026-10-28-grok-quality/evidence/longchat-baseline/ready-check
```

The separate stack diagnostic is deliberately outside the planned matrix. See
the [final report](../docs/reviews/2026-10-28-grok-quality/evidence/longchat-baseline/README.md)
for startup-harness failures, profile attribution limits, the 3000-message error,
and skipped optional comparisons. Measurement exit codes are 0 for complete
success, 1 for errors/shutdown/network failures, and 2 for timeouts/skips.

## P0 comparison and equivalence harness

The readiness predicate subscribes to sticky `APP_READY`, atomically fills/clicks
only the onboarding dialog currently present, and waits for `#chat`, a visible
`#send_textarea`, no open dialog, and no splash screen. There are no fixed startup
sleeps. Unexpected dialogs remain visible and cause a deadline failure. The old
failures retained in `supplement/` and `ready-check/` show locators waiting for
hidden/detached dialogs and one generic readiness wait. Source inspection confirms
that startup can await onboarding before emitting APP_READY.

Run 50 consecutive fresh browser-context startups, forcing `firstRun=true` only
in the isolated synthetic settings response so every attempt exercises onboarding:

```sh
/tmp/pw-venv/bin/python tests/browser-longchat-perf.py \
  --startup-runs 50 --output /tmp/p0-startups \
  --node /tmp/node-v24.22.1-linux-x64/bin/node
```

The fixed generator anchors its seed-20261028 shape **at the chat end**:
ten swipe messages per 100, swipe multiplicities and length choices repeat every
100, and markdown/code placement uses the same offset from the end at every size. Index, fixed date and role
still identify each message. `--legacy-shape` retains the original generator for
controlled diagnostics; it must not be used for future optimization acceptance.

```sh
/tmp/pw-venv/bin/python tests/browser-longchat-perf.py \
  --base 37a4818 --head WORKTREE --sizes 2000,3000 --settings 100 \
  --runs 7 --open-only --output /tmp/p0-ab \
  --node /tmp/node-v24.22.1-linux-x64/bin/node
```

A/B executes base/head/base/head for each size/setting, seven pairs by default.
`--runs 1` is allowed only with `--equivalence` for functional self-checks;
A/B latency mode requires at least seven runs. Revisions are materialized
with `git archive | tar -x` into read-only `/tmp/lcab-<rev>-...` directories and a
node_modules symlink. No Git refs or working trees are modified. Each side/run
owns a new synthetic data root and server; servers never share a data directory.
The current harness measures both products, including revisions with older
harnesses. `WORKTREE` means current on-disk product files. Revision IDs and ordered
exit codes appear in `comparison.json`. Each child directory retains raw JSON,
settings, server log and graceful shutdown checks. Any failure makes A/B fail;
failed pairs are never silently dropped or replaced. Profiles are off in A/B.

`--open-only` omits scroll/send/heap work after the open snapshot. Without it,
A/B measures the original open/scroll/send workflow. Comparison summaries use
`benchmark-statistics.mjs` directly: arithmetic median, nearest-rank p95, 2000
paired bootstrap resamples, seed `opus-round1.5`, percentile 95% CI of
`median(head) - median(base)`. This differs from the historical Python combined
report's lower nearest-rank median for even n; planned odd n medians agree.

Add `--equivalence` to capture two normalized `#chat` outerHTML snapshots (after
open and after one real `showMoreMessages` call), then full Playwright Tab walks
for older messages, a real `/send` append, a late `.interactable` class, ancestor
`.disabled` on/off, and an upstream Popup opened/closed. This flag implies
`--open-only`: the scenarios mutate chat/focus and must not contaminate send or
scroll timing. Run equivalence separately from latency measurements.

```sh
/tmp/pw-venv/bin/python tests/browser-longchat-perf.py \
  --base WORKTREE --head WORKTREE --sizes 2000 --settings 100 --runs 1 \
  --equivalence --output /tmp/p0-equivalence \
  --node /tmp/node-v24.22.1-linux-x64/bin/node
```

Each walk starts at body (or the active modal), with tabindex -1. N is at least
the number of visible, enabled native/tabindex controls plus two, covering the
chat and main controls through a full cycle; `--tab-count N` raises that minimum.
The popup walk counts modal controls only because native dialogs trap focus.
Descriptors retain structural CSS path, message ID, tag, stable ID, classes,
role, accessible name, title, type, href and leaf text. Each Tab is an actual
Playwright keyboard action. The ancestor scenario uses the **class** `disabled`,
which is the keyboard module's existing public contract.

Snapshot normalization lives in `longchat-normalization.mjs` and accepts a plain
DOM tree for browser-free tests. It sorts attributes, escapes text/attributes,
removes UUID/select2 random ID references and the explicit volatile attributes
`timer`, `timestamp`, `data-timestamp`, `data-generation-started`, `data-generation-finished`.
Only `.timestamp` and `.mes_timer` content/title become `<timestamp>`.
Message index identity attributes, text, role, tabindex, classes, styles,
order, and all other attributes remain significant. Whitespace is preserved.
No focusability attribute is normalized away. Each normalized snapshot is stored
next to its run JSON as `run-<label>-dom-<phase>.html.gz`, with gzip mtime 0 and
no embedded filename. The run's `equivalence.dom` entries contain only `sha256`
(of decompressed UTF-8 bytes), `length` (UTF-8 bytes), and `file` (relative to the
run JSON). Tab sequences remain inline. Comparison decompresses and verifies
both snapshots before exact comparison; `comparison.json` reports equal/different
and readable unified diffs per mismatched phase/scenario. Older inline snapshots
remain readable. Equality is exact, not fuzzy.

The P0 evidence also includes a negative control using a temporary archived
product copy with a deliberately added chat button, then discards that code.
Browser acceptance is opt-in; only pure data/statistics/normalization tests are
registered in `test:perf` and need no browser.

P2 adds test-extension listeners through the public `eventSource` during
`--equivalence`. All available `*_RENDERED`, `MORE_MESSAGES_LOADED`, `CHAT_CHANGED`
and `CHAT_LOADED` event types are registered before opening. Per-phase records
retain names, order, count, arguments and whether a rendered message ID resolves
to an element in the document. Generated current-chat IDs become `<chat-id>`;
`CHAT_LOADED`'s mutable character object is projected to its index, avatar and
name, rather than comparing generated card timestamps. Undefined arguments are
explicitly marked. These event records are compared exactly alongside DOM/Tab
results, including the real send. No per-message render events are invented for
chat opens or older loads where upstream emits none.

Ordinary send records also retain `fillMs`, long-task entries and their summary.
The original timer (fill/input through save response body) stays intact. The
post-save DOM assertion and retrieval of observed tasks remain outside that
timer; a final still-running task is not guaranteed to have been delivered to
the observer. Subtracting HTTP request-to-response-end from elapsed time only
bounds time outside that HTTP interval; it does not attribute a named JS task.

P3's `--sliced-older` mode replaces scroll sweeps with three real older loads
at scrollTop=0. Each records elapsed time through the completion promise
(**excludes** the historical 500 ms quiet window), the overlapping long tasks,
contiguous message IDs/count and maximum visible-anchor drift. Older messages
are prepared off-DOM and inserted once, so a child-list MutationObserver sees
one insertion task; the final sample includes completion hooks/button removal.
Scroll matches the pre-slice path and is not sampled per message: immediately
before that insertion the show-more button is tested for being fully in the
window, and only then is `scrollHeight` recorded. After swipe refresh and
optional button removal, `scrollTop` is replaced with the height delta. When
the button is not fully in view, `scrollTop` is left unchanged.
CSS `overflow-anchor` is explicitly disabled on both sides during these
measurements. The quiet window still drains task observation outside each
timer. Send follows the three loads with the existing
fill/input-through-save-response timer. Empty frame readings are reported as
unavailable, since this mode performs no frame sweep. `comparison.json`
additionally summarizes each batch's elapsed time, longest observed task and
drift with the existing paired bootstrap method.

Use `--equivalence --older-batches 3` separately for exact normalized DOM,
complete Tab walks and P2 event-recorder comparison after all three loads.
Equivalence now honors the batch limit (use `--older-batches 1` to reproduce P0–P2).
`--older-scenario send|double|reference --open-only --settings 500 --runs 1`
executes a functional P3 scenario on a fresh synthetic chat. The public send
function or another older load is triggered from the first `scheduler.yield`
during off-DOM preparation, while the live message count is still unchanged;
the reference sends only after completion. It asserts exactly one completion,
contiguous DOM IDs, final array count, and (for sends) exact JSON serialization
of the array versus the saved file fetched through `/api/chats/get`. Undefined
generation fields in swipe metadata are omitted by JSON serialization,
just as in the production save. Only the appended message's send_date is
normalized for cross-run comparison; the DOM uses the existing normalizer.
These scenarios do not contribute latency samples. Browser cases remain opt-in.

Full Tab walks can be expensive at 2000/500 after three older loads. The recorder
now samples the same focus descriptor in a microtask after trusted keyup dispatch,
while Playwright still issues every individual Tab press. Each walk cross-checks
the first 16 samples with the original post-key browser RPC and asserts exactly
one descriptor per key. This removes an extra RPC per key without shortening the
walk. Use an explicit larger `--run-timeout` for these functional runs (P3 uses
1800 seconds at 500); this does not change the latency run's time budget.

For a documented bounded alternative, `--tab-limit N` limits physical presses per
scenario and also stores the complete computed focus order (positive tabindex
first, then zero/native controls in document order) using the same descriptors.
`tabOrder` is compared exactly alongside DOM, physical `tabs` and events. This is
not a full native Tab cycle; report that limitation explicitly. Default zero
retains the original full walk. P3's 500-message final check uses 128 physical
presses per non-modal scenario and all 5500+ computed descriptors.

P4 adds `--trim-scenario --sizes 2000 --settings 100 --runs 1 --no-profiles`
for a browser-only functional check. It loads ten older batches, disables CSS
scroll anchoring, sends through the public API, and checks the first kept
message's geometry at `MESSAGE_SENT`, before the new message is rendered. It
also checks button restoration, untouched chat data, safe missing-DOM edit/delete,
edit/delete of the first kept message, contiguous renumbering, and reloading and
editing a retired message. This mode records no send latency samples. Ordinary
runs now record `afterSend` DOM/memory outside the existing send timer.

The always-on trim runs after the older-insertion barrier in `sendMessageAsUser`:
when more than five truncation batches are displayed, it retains the newest five.
The append itself can leave one additional message. Truncation zero disables the
trim. An editor, textarea or focused control in the removable prefix defers it
until a later send. History browsing can exceed the threshold: trimming the top
immediately after show-more would remove the just-loaded messages and prevent
progress. All original array entries remain reloadable with show-more.

Sliced-load mode has no frame sweep. Aggregation excludes unavailable (`None`)
frame values and reports `n=0`, median/p95 null, including when combining multiple
saved runs. It never replaces missing measurements with zero.
