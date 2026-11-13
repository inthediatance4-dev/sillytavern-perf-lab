# S2 follow-bottom

Product changes are limited to S2. Primary comparison: original S0 product `ee771bb` versus the live S2 tree, ten kept runs per side for both main (2000 messages × 3000 tokens, smooth off) and short (100 × 500). `ab/` retains summaries and gzipped raw samples. One warmup per side/scenario is discarded; order alternates AB/BA. Intervals use 2000 paired bootstrap resamples, seed `opus-round1.5`, from `scripts/benchmark-statistics.mjs`.

Main versus S0:

| Metric | Base | S2 | Difference | 95% CI |
| --- | ---: | ---: | ---: | --- |
| Frame p95 ms | 16.80 | 16.80 | +0.00 | [-16.50, 0.00] |
| Frames >33 ms % | 3.22 | 1.04 | -2.18 | [-4.84, -0.29] |
| Typing p95 ms | 43.55 | 33.15 | -10.40 | [-13.00, -5.80] |
| First token ms | 107.90 | 158.55 | +50.65 | [3.97, 60.38] |
| Finish ms | 225.96 | 232.31 | +6.35 | [-96.39, 105.61] |

All ten main and all ten short S2 samples have scrollStolen **0**, as do both primary S2 warmups. Main frame p95 meets the ≤20 ms target. Frames >33 ms fell **67.8%**, with the difference CI excluding zero. Typing meets ≤50 ms and improves significantly. Finish does not regress significantly. **First-token acceptance versus S0 has an exception:** +50.65 ms, CI [3.97, 60.38], excludes zero. Do not call the complete S0 performance acceptance green.

Short versus S0:

| Metric | Base | S2 | Difference | 95% CI |
| --- | ---: | ---: | ---: | --- |
| Frame p95 ms | 33.30 | 16.80 | -16.50 | [-16.60, 0.00] |
| Frames >33 ms % | 6.89 | 1.48 | -5.41 | [-8.35, -0.76] |
| Typing p95 ms | 46.30 | 32.10 | -14.20 | [-18.50, -6.60] |
| First token ms | 149.37 | 142.11 | -7.27 | [-49.89, 51.87] |
| Finish ms | 373.33 | 317.39 | -55.94 | [-98.32, 73.55] |

No significant regression in short frame, typing, first-token or finish metrics. The >33 ms share and typing improve significantly.

Controlled main comparison against pre-S2 `6465e75` (S1 + Director):

| Metric | Base | S2 | Difference | 95% CI |
| --- | ---: | ---: | ---: | --- |
| Frame p95 ms | 16.80 | 16.80 | +0.00 | [0.00, 8.25] |
| Frames >33 ms % | 1.93 | 1.97 | +0.04 | [-1.93, 1.91] |
| Typing p95 ms | 32.90 | 32.25 | -0.65 | [-2.40, 1.30] |
| First token ms | 136.80 | 129.37 | -7.43 | [-40.74, 27.89] |
| Finish ms | 207.38 | 360.61 | +153.23 | [-122.03, 197.56] |

`vs-s1-comparison.json` combines the first eight complete pairs from `vs-s1/` with two pairs from `vs-s1-replacement/`, using the same statistics module, seed and resample count. No significant S2 regression from S1 is detected in frame p95, >33 ms share, typing, first-token or finish latency. Finish's point estimate is +153.23 ms and its CI is wide; this is uncertainty, not evidence of equal finish times. S1 scroll-stolen median is 1; all ten S2 values are 0 (difference CI [-1, -1]). This control does not erase the primary S0 first-token exception.

The original control stopped on pair 9: provider last chunk 1793290298911.57 preceded browser time origin 1793290314110.90, so frame/typing samples had zero overlap with the provider interval. That head sample and its paired base are excluded for invalid clocks. Their summaries/raw samples are retained. The replacement command uses `--smoke --runs 2` only to finish the interrupted ten-pair series, not as an independent acceptance run. All warmups are discarded. Source hashes match across the primary run, control and replacements. All six lab shutdown records have exit 0 and lockGone true.

Commands (Node v24.22.1; Chromium 156.0.8078.4):

```sh
node scripts/measure-streaming.mjs --base ee771bb --head WORKTREE --scenario main,short --runs 10 --output <evidence>/ab
node scripts/measure-streaming.mjs --base 6465e75 --head WORKTREE --scenario main --runs 10 --output <evidence>/vs-s1
node scripts/measure-streaming.mjs --base 6465e75 --head WORKTREE --scenario main --runs 2 --smoke --output <evidence>/vs-s1-replacement
python tests/browser-streaming-scroll.py --output <evidence>/scroll.json
python tests/browser-streaming-equivalence.py --output <evidence>/equivalence.json
python tests/browser-lifecycle-lab.py --director --output <evidence>/director.json
npm run lint
npm run test:perf
```

Browser validation on the final product: `scroll.json` has 15 passing cases, including upward wheel/touch/keys/scrollbar, return within 40 px, button accessibility/click/persistence, auto-scroll off, typing while paused and following, and multiline composer placement. Every held-scroll check records zero steals. Older slices load 102 → 202 messages after scrolling to the top and using the existing Show more control; no new automatic loader was added. One fixture-setup timeout during parallel browser validation was followed by an isolated successful run; failure-state diagnostics were added to the test.

`equivalence.json` passes all eight cases, including normal, stop, continue, swipe, reasoning, group and impersonate; HTML, saved data, token/event behavior and tab order remain equivalent under the existing timing-field exclusions. `director.json` passes all 30 checks, including exact disabled left-row/chat/focus snapshots. The button is created lazily under `#form_sheld`, outside `#chat` and `#leftSendForm`, and is hidden while following or after pending content is dismissed. It therefore preserves the Director disabled snapshot and ordinary tab order. Director's process exits 0 with pageErrors []; Playwright prints two Target closed warnings during teardown.

Node validation: lint exits 0; test:perf has **814 passed, 8 skipped, 0 failed** (822 total), including 20 new scroll tests and all long-chat node tests. No benchmark ran alongside these final checks. The new node file is included in test:perf and uses browser boundary mocks and platform-independent URL paths.

Development regression tests retain the two issues found by the first discarded warmup: last_mes transfer/native anchoring could falsely pause before streaming, and a composer wrap could move a paused view 19 px. Insertion now captures geometry before writes and marks its resulting layout; layout shrink is distinguished from upward intent, and resize corrections do not move a paused or auto-scroll-disabled reader. The discarded development warmup is not part of either comparison.

S3's condition is **false**: final primary main frame p95 is 16.8 ms, below 20 ms. LoAF entries attribute no script duration directly to messageFormatting and most script time to other entry points; that is incomplete attribution rather than proof of zero formatting cost. Format p95 is 4.9 ms. S3 was not started. Manual Windows validation with the user's real chat remains for the user.

`validation.json` records final source identities, test results and the evidence leak scan. Raw samples/logs are gzipped; no profiles, caches, machine hostname, or repository/home absolute paths are retained.
