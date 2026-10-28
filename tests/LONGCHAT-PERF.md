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
