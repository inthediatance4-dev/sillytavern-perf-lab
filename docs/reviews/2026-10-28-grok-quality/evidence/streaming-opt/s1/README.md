# S1 streaming DOM coalesce

Base is `ee771bb`. Head is the live worktree (uncommitted S1). Ten kept runs per side for `main`, `short` (100 messages × 500 tokens), `reasoning`, and `continue`. One warmup per side/scenario was discarded. Order alternates AB/BA. Bootstrap is 2,000 paired resamples, seed `opus-round1.5`. `smooth` was not run. `comparison.json` has every metric, its samples, and the 95% CI of the median difference (head minus base). Gzipped raw browser and provider samples sit beside each run.

The machine was not idle: other CPU-bound work ran during the A/B. Absolute times are noisy. The paired design still separates the two products.

## Medians

| Scenario | Side | Frame p95 ms | >33 ms % | Typing p95 ms | First token ms | Finish ms | Updates/s | Scroll stolen |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main | base | 16.80 | 3.32 | 45.45 | 133.57 | 281.62 | 21.22 | 0 |
| main | head | 16.80 | 1.44 | 34.70 | 159.62 | 281.27 | 23.45 | 0 |
| short | base | 16.80 | 2.63 | 41.85 | 130.41 | 190.86 | 20.51 | 0 |
| short | head | 16.80 | 3.79 | 27.20 | 156.09 | 303.47 | 21.20 | 0 |
| reasoning | base | 16.80 | 4.35 | 44.90 | 1494.94 | 259.05 | 20.97 | 1 |
| reasoning | head | 16.80 | 1.87 | 34.20 | 1525.90 | 361.99 | 23.43 | 1 |
| continue | base | 33.30 | 7.82 | 47.40 | 158.63 | 306.13 | 20.55 | 0 |
| continue | head | 16.80 | 2.84 | 33.65 | 173.18 | 260.19 | 22.77 | 0 |

Cells are medians of per-run values. Frame p50 is 16.70 ms on every side (one vsync). Scroll-stolen medians are 0 except reasoning, whose median is 1 on both sides. Main scroll-stolen samples are base `[0,0,0,1,0,0,0,0,0,21]` and head `[1,0,0,22,0,0,0,0,21,22]`.

## Main differences (head − base)

| Metric | Diff | 95% CI | CI includes 0 |
| --- | ---: | --- | --- |
| Frame p95 ms | 0.00 | [−0.05, 0.00] | yes |
| >16.7 ms % | −1.93 | [−3.29, −0.37] | no |
| >33 ms % | −1.89 | [−3.06, −0.78] | no |
| Typing p50 ms | −10.00 | [−10.90, −3.50] | no |
| Typing p95 ms | −10.75 | [−13.45, −7.75] | no |
| First token ms | +26.05 | [−6.19, 63.00] | yes |
| Finish ms | −0.35 | [−112.34, 62.41] | yes |
| Updates/s | +2.23 | [1.72, 2.92] | no |
| Format p95 ms | +1.55 | [−1.20, 2.90] | yes |
| DOM p95 ms | 0.00 | [−0.10, 0.00] | yes |
| Reasoning hook p95 ms | −0.20 | [−0.20, −0.10] | no |
| Scroll stolen | 0 | [0, 21] | yes |
| LoAF count | −2 | [−4, 0] | yes |
| LoAF total ms | −103 | [−232, 34] | yes |

Main >33 ms samples: base 5.86, 3.81, 1.05, 3.95, 0.70, 2.98, 2.96, 3.45, 3.20, 4.37; head 1.03, 1.50, 1.74, 2.92, 0.23, 2.21, 0.81, 1.99, 1.38, 0.69. Every head run is at or under 2.92%. Share drop is 56.7% (3.32 → 1.44).

On the ten main head runs the DOM writer recorded 3,476 incremental patches, 1,090 full `innerHTML` replacements, and 3,486 coalesced frames.

## Acceptance

- Main frame p95 ≤ 20 ms: **pass** (16.80 both sides). A ≥40% drop of that median is impossible here: once the 33.3 ms tail no longer reaches p95, both products sit on the 16.7 ms vsync floor, so the CI of the median difference includes 0. Head frame p95 samples are 16.7 or 16.8 on every main run. Base has one 33.3 and nine 16.8.
- Main share of frames >33 ms down ≥50%: **pass**. −56.7%, and the CI excludes 0.
- Main typing p95 ≤ 50 ms: **pass** (34.70). It is also lower than base 45.45; that CI excludes 0.
- Main first-token and finish not significantly worse: **pass**. Both CIs include 0. The first-token point estimate is about 26 ms slower (one to two frames), which is the cost of painting after the frame instead of inside it.
- 100×500 (`short`) no significant regression: **pass** on the tested metrics. Frame p95 is tied (CI [−16.5, 16.5]). The >33 ms share point estimate is higher (2.63 → 3.79) and finish is higher (191 → 303); both CIs include 0. Typing p95 is significantly better (41.85 → 27.20).

`allCiIncludeZero` in `comparison.json` is false because several differences are real (the >33 ms share, typing, and updates/s among them).

## Other scenarios

- Reasoning frame p95 stays 16.80 (CI [−8.25, 0]). The >33 ms share falls 4.35 → 1.87; that CI includes 0. Typing p95 is significantly better. First token is significantly slower: +31 ms, CI [0.95, 72.28]. On a ~1500 ms baseline (reasoning tokens before visible answer text) that is about 2%. Finish +103 ms, CI includes 0. Format p95 rises 3.65 → 5.55 and that CI excludes 0; 5.6 ms is not a long task.
- Continue frame p95 median falls 33.30 → 16.80. Every head run is 16.8. The CI is [−16.55, 0.00], so it touches 0. The >33 ms share falls 7.82 → 2.84 (−64%); the CI upper bound is +0.12, so it still includes 0. Typing p95 is significantly better. First token and finish CIs include 0 (finish point estimate is lower).

## What this build does

Chat fields and `STREAM_TOKEN_RECEIVED` still update on the existing per-chunk / `streaming_fps` schedule (`Stopwatch`, default 30/s). Formatting, the `.mes_text` write, the timer text, the reasoning block, and the follow-bottom scroll are gated to one animation frame, then run in a `MessageChannel` task after that frame. The animation callback itself does not format or write the DOM. Extensions that read `.mes_text` inside `STREAM_TOKEN_RECEIVED` can see the DOM up to two frames behind. If recent formatting averages more than 8 ms the gap can add another frame, and more than 16 ms another; this run’s format times stayed near 1–5 ms, so the gap stayed one frame. Finish, stop, and error paints are still immediate full writes. `stream_fade_in` and impersonate stay synchronous. An unchanged reasoning block skips its DOM write on an incremental paint and still records a reasoning timing sample. Incremental patching compares top-level children with `isEqualNode` and falls back to `innerHTML` when the first child differs. DOM write p95 stayed 0.3 ms, so the compare is not the frame cost.

Updates/s rose (main 21.2 → 23.5) because the streaming tick no longer includes format and DOM time, so the stopwatch’s next slot opens sooner. The rate is still under the 30/s cap.

## What this does not decide

S3 is not indicated. Main frame p95 is 16.8 ms, not above 20, and long-animation-frame entries are not dominated by `messageFormatting` (format p95 is about 5 ms; LoAF script attribution still reports entry points, so unattributed work stays “other”).

S2 is still required. Scroll stolen is not 0 in every main run (head maximum 22, base maximum 21). Medians are 0 and the CI includes 0. S1 did not change follow-bottom behavior: the scroll read stays on a later frame (`waitForFrame: true`) so the paint task does not force layout.

`equivalence.json` in this directory is the browser equivalence run on this same head: pass, including the DOM patch, normal send, stop, continue, swipe, reasoning, group, and impersonate cases, with tab order unchanged. Ignored saved-chat fields are `gen_started`, `gen_finished`, `send_date`, `create_date`, `date_last_chat`, `extra.time_to_first_token`, `extra.reasoning_duration` (also on swipe info), `integrity`, and `gen_id`.
