# Richtext chat load responsiveness

Base: d7b3de40abbe583620aab9b9b1247e04747dfeee. Isolated branch codex/sillytavern-richtext-flow; localhost8777, synthetic data only. No production changes, dependency installation, or permanent deletion.

## Measured problem and decision

180 synthetic rich messages, last100 displayed: baseline open3234ms, longest task2302ms. CPU/Chrome tracing shows synchronous richtext construction followed by style/layout and plugin reads. CSS containment had no improvement; content-visibility changed task distribution without reducing total open time. Reject both CSS candidates pending geometry contracts. Incremental detached construction has global model side effects and would broaden edit/swipe/plugin concurrency, so reject it.

Candidate: retain synchronous redisplayChat and add at most one browser task boundary in full character load getChatResult after printMessages completes, before menu selection and CHAT_CHANGED listeners. Only large visible text loads need this boundary. Scheduling can improve responsiveness without reducing computation; measured total latency must be reported separately. Prototype longest1240ms, total3667ms is diagnostic only, not accepted performance evidence.

## Ownership and compatibility contract

Each character getChat starts a serial owner capturing character/avatar, group and filename. clearChat invalidates immediately on entry, before awaits. Metadata identity must be captured/refreshed at the legitimate response application and checked after suspension. Same-file reload supersedes earlier owner. Verify ownership after every newly introduced await and before DOM/model application, menu selection, terminal events and delayed focus. Cancellation returns false through getChatResult/getChat and outer open callers; never retry cancelled rendering through catch, emit stale CHAT_LOADED, or save a stale character selection. Existing success return contracts remain compatible. Do not silently treat real fetch errors as cancellation; retain existing fallback only if owner remains current.

No yielding in redisplayChat/updateMessageElement, no per-message DOM virtualization/caches or CSS containment. Keep sanitization, regex/macros, depth, reasoning, media, swipe/edit, prompts, event order and full DOM unchanged. Include group/neutral compatibility; scheduling applies only owned character loads, not general redisplay callers.

## Acceptance

Behavioral tests execute actual source functions (VM extraction where established): successful normal/large load, superseded response/render, clear during boundary, same-file reload, failed request fallback, cancelled catch, delayed focus, outer callers cancelling saves. Baseline must fail new safety/scheduling contracts first. Full safe test:perf suite on Node20/24. Browser fresh-context matched baseline/candidate at least3pairs, heavy plus small/truncated longhistory, no profiling during timed runs. Verify message IDs/full HTML, body/order integrity, bottom position, zero generation, native open/close, prompts and retry; explicitly exercise close/switch during boundary. Accept only demonstrable reduction of longest blocking time with bounded total-latency tradeoff and no behavior regression. Otherwise preserve evidence and revise candidate.

Backups and source hashes precede original file edits. Protected eight previous workspaces and9327 tracked files remain unchanged. All deletions to Recycle Bin. Independent spec then quality review required before release. Artifacts: patch, sourceZIP, standalone bundle restored and byte-verified, report with measured limits, source fingerprints and validation logs. Stop own lab gracefully and verify PID/port; no deployment.
