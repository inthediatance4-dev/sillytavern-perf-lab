# P3 iteration 2: off-DOM preparation, one insertion

Base: `dfab84be2da4bb64ec3924ff8f60f4cc1ae2a18d` (P0–P2). Head: WORKTREE. No commit and no git ref change.

[Iteration 1](iteration-1/README.md) is the negative result. It inserted every slice into the live chat and corrected the anchor after each slice. Correctness passed and batch time did not (2000/500 third batch median 1176 ms to 42314 ms). This directory is the second attempt. Its raw A/B runs, equivalence records, concurrency records, and one CPU profile are here. Iteration 1 keeps only its summary, hashes, and the per-slice layout profile.

## Design

`showMoreMessages` still loads one truncation-sized batch and still emits `MORE_MESSAGES_LOADED` once, after the batch is in the document. Preparation is a detached `DocumentFragment`. Each slice runs `updateMessageElement` until about 10 ms have elapsed, then yields. `scheduler.yield()` is preferred. `MessageChannel` is the fallback when the scheduler is missing; both ports are closed after the message. Nothing is inserted and no layout is read during preparation.

There is one live insertion, before the current first `.mes` (or after `#show_more_messages` when no message is displayed). Scroll matches the pre-slice function, not a per-message rect walk:

- Immediately before that insertion, `#show_more_messages` is tested with `isElementInViewport`.
- Only when the button is fully inside the window is `scrollHeight` recorded.
- After `refreshSwipeButtons` and optional button removal, `scrollTop` is replaced with `scrollHeight - previousHeight`.
- If the button is not fully in view, `scrollTop` is left unchanged.
- `applyStylePins` runs after that single write. There is no second geometry read.

A nonzero `scrollTop` while the button is still fully visible is replaced by the height delta. That is the old assignment. The check is after preparation, so a scroll during the yields is the one that is honored. The base function checked before a synchronous build; the user could not scroll during that build.

A repeated show-more call while one load is in progress is dropped. The insertion promise queues only mutations that can change the hidden prefix or replace the message list: redisplay, clear, delete-last, delete (including the confirmed tool-call walk), bulk delete, Generate, and send (including the check after the attachment promise). Displayed-message edit, move, and copy are not queued. They need a live element, so their ids are outside the prepared range. The promise is released before `MORE_MESSAGES_LOADED`, including when preparation throws, so a completion listener can send or edit.

Public signatures are unchanged. No per-message render events were added. CSS `overflow-anchor` is not used; the harness disables it during measurement.

## Measurement

Linux, Node 24.22.1, headless Chromium 156, 1440×1000. Seed 20261028, end-relative shape, extensions disabled. Each run has its own data root and server. The base tree is a read-only `git archive` with a `node_modules` symlink. No worktree, checkout, stash, reset, or ref write.

A/B alternates base then head, 7 pairs, for 2000/100 and 2000/500, three older batches. 28 runs, every exit code 0. Batch time is through the `showMoreMessages` promise and excludes the 500 ms quiet window. Every batch had `anchorSamples` 2 (one child-list mutation plus the final sample) and `orderCorrect` true. Added counts were 100 or 500. Drift was 0 px on every batch. Long-task max 0 would mean no task at or above 50 ms. Values are median / nearest-rank p95. At n=7, p95 is the maximum. Paired bootstrap uses seed `opus-round1.5` and 2000 resamples. Raw runs: [ab/comparison.json](ab/comparison.json) and `ab/2000-*-*.json`.

| Messages/truncation | Metric | Base median / p95 | Head median / p95 | Median delta | Delta % | 95% CI of median delta |
|---|---|---:|---:|---:|---:|---:|
| 2000/100 | open | 1202.40 / 1639.50 | 838.90 / 1126.40 | -363.50 | -30.2% | [-490.60, -170.70] |
| 2000/100 | send | 893.09 / 1295.23 | 1030.90 / 1465.96 | 137.81 | +15.4% | [-73.08, 550.49] |
| 2000/100 | older1/ms | 377.00 / 414.10 | 190.90 / 345.70 | -186.10 | -49.4% | [-223.50, -156.30] |
| 2000/100 | older1/longestTaskMs | 377.00 / 414.00 | 85.00 / 199.00 | -292.00 | -77.5% | [-327.00, -262.00] |
| 2000/100 | older1/anchorDriftPx | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 | +0.0% | [0.00, 0.00] |
| 2000/100 | older2/ms | 381.10 / 471.40 | 180.90 / 368.40 | -200.20 | -52.5% | [-247.00, -16.00] |
| 2000/100 | older2/longestTaskMs | 385.00 / 473.00 | 84.00 / 166.00 | -301.00 | -78.2% | [-336.00, -124.00] |
| 2000/100 | older2/anchorDriftPx | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 | +0.0% | [0.00, 0.00] |
| 2000/100 | older3/ms | 298.10 / 386.30 | 236.80 / 348.90 | -61.30 | -20.6% | [-151.40, 51.10] |
| 2000/100 | older3/longestTaskMs | 300.00 / 388.00 | 110.00 / 117.00 | -190.00 | -63.3% | [-236.00, -162.00] |
| 2000/100 | older3/anchorDriftPx | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 | +0.0% | [0.00, 0.00] |
| 2000/500 | open | 1997.30 / 5357.70 | 1746.90 / 2425.60 | -250.40 | -12.5% | [-592.20, 243.40] |
| 2000/500 | send | 2350.70 / 3874.39 | 2582.89 / 5017.42 | 232.19 | +9.9% | [-1785.73, 1774.21] |
| 2000/500 | older1/ms | 1052.90 / 1484.90 | 996.90 / 1989.60 | -56.00 | -5.3% | [-559.80, 513.70] |
| 2000/500 | older1/longestTaskMs | 1058.00 / 1487.00 | 369.00 / 732.00 | -689.00 | -65.1% | [-1032.00, -321.00] |
| 2000/500 | older1/anchorDriftPx | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 | +0.0% | [0.00, 0.00] |
| 2000/500 | older2/ms | 1046.30 / 1618.60 | 1175.30 / 1453.30 | 129.00 | +12.3% | [-561.80, 512.80] |
| 2000/500 | older2/longestTaskMs | 1053.00 / 1636.00 | 520.00 / 723.00 | -533.00 | -50.6% | [-1071.00, -278.00] |
| 2000/500 | older2/anchorDriftPx | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 | +0.0% | [0.00, 0.00] |
| 2000/500 | older3/ms | 1598.50 / 1910.80 | 1732.90 / 1929.70 | 134.40 | +8.4% | [-714.00, 436.90] |
| 2000/500 | older3/longestTaskMs | 1617.00 / 1932.00 | 787.00 / 1062.00 | -830.00 | -51.3% | [-1169.00, -348.00] |
| 2000/500 | older3/anchorDriftPx | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 | +0.0% | [0.00, 0.00] |

The largest batch-time median increase is +12.3% (2000/500 older2). 2000/500 older3 is +8.4%. The other four batch medians are lower than base. Several 500-message intervals are wide and include increases above 20% of the base median; n=7 does not pin that tail. The acceptance call below uses the median, which is the same summary iteration 1 used when it failed.

The longest task at 500 is still one task above 100 ms: medians 369, 520, and 787 ms. At 100, older1 and older2 medians are 85 and 84 ms, with p95 199 and 166 ms. Older3 at 100 has median 110 ms. That task is the synchronous tail after preparation: swipe refresh plus one `scrollHeight` layout of the chat that just received the fragment. A profile of the final head ([diagnostics/final-profile/](diagnostics/final-profile/)) samples 10417.8 ms of the scroll phase, including idle. `placeOlderFragment` is 0.44% inclusive. `prepareOlderMessageFragment` is 21.1% inclusive and `updateMessageElement` 20.8%. `showMoreMessages` itself is 6.4% self, which is the viewport check and the height-delta layout, not a per-slice rect walk. Splitting that layout per message would bring back the iteration 1 cost. It was not split.

## Equivalence

DOM, Tab, and event comparisons are separate from the latency pairs. Normalization is the existing one. Snapshots are gzip with a fixed header.

- 2000/100: equal. Full native Tab walk. Physical descriptors 6695 / 6695. Event records 6 / 6 (open 2, older 3, send 1). See [equivalence/100/comparison.json](equivalence/100/comparison.json).
- 2000/500: equal. Physical presses are capped at 128 per non-popup scenario (772 / 772, popup-open is 4). The complete computed focus order is 33008 / 33008 descriptors. Event records 6 / 6. This is not a full native Tab cycle. See [equivalence/500/comparison.json](equivalence/500/comparison.json).

The 100 pair finished in one alternating invocation. The aggregator then crashed because equivalence does not record scroll samples and the sliced-older summary still indexed them. Both browser runs had already exited 0. The comparison was produced with the same `compare_equivalence` function. The harness now skips batch metrics when the run is open-only.

The 500 base record is from that same style of pair. The head browser closed during its walk, and the harness `finally` queried the closed page, which discarded the run record before the original error was written. Head was repeated alone, with the same limits, and matches that base record exactly (equal, no diffs). The `finally` block now ignores a page that is already closed so a later failure keeps the original error.

## Concurrent send and double trigger

Head only, 2000/500, one chat each. The send or the second show-more starts on the first `scheduler.yield` during preparation. The live message count at that moment was 500, the same as before the load. The reference sends only after completion. Summary: [concurrency/comparison.json](concurrency/comparison.json).

| Check | Result |
|---|---|
| Send vs reference chat, DOM ids, DOM snapshot, events | Equal |
| Saved file matches chat (send and reference) | True |
| Send completion count / DOM count | 1 / 1001 (ids 1000–2000) |
| Double completion count / DOM count | 1 / 1000 (ids 1000–1999, one 500-message load) |
| Trigger while the live count was still unchanged | True (`partialCount` 500) |

## Acceptance

| Criterion | Result |
|---|---|
| Alternating >=7 per side, 2000/100 and 2000/500, three batches | Met (28/28 exit 0) |
| Batch total-time median increase <=20% | Met (largest median increase +12.3%) |
| Longest task <100 ms | Unmet. 500-message medians are 369 / 520 / 787 ms. 100-message older3 median is 110 ms. This is one insertion layout, reported as measured. |
| Anchor drift <=2 px | Met (0 px, overflow-anchor disabled) |
| Order and count | Met |
| DOM, events, and Tab equivalence | Met. 500 uses the bounded physical walk plus the full computed order. |
| Send during preparation matches reference and saved file | Met |
| Double trigger performs one load | Met |
| Send at 2000/100 | Median +15.4% (137.81 ms); the 95% interval includes zero and large positive values |
| Narrow tests and eslint | Met. See [tests.json](tests.json) |
| Native Windows and the six CI combinations | Not run |

## Files

Product: `public/script.js` (`prepareOlderMessageFragment`, `placeOlderFragment`, `showMoreMessages`, and the narrowed insertion queue).

Harness and tests: `tests/browser-longchat-perf.py`, `tests/longchat-browser-probe.mjs`, `tests/longchat-older-slices.test.mjs`, `tests/LONGCHAT-PERF.md`, `tests/longchat-measurement.test.mjs`, and the extraction fixtures that supply an idle insertion promise (`tests/chat-load-ownership.test.mjs`, `tests/chat-transitions.test.mjs`, `tests/frontend-lifecycle.test.mjs`, `tests/itemized-prompts-ownership.test.mjs`, `tests/media-load-scroll.test.mjs`). `package.json` registers the browser-free older-slice test in `test:perf`.
