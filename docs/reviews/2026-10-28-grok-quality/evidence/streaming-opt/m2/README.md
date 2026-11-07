# M2 immediate first paint and performance rerun

First visible content and first visible reasoning each bypass both the initial Stopwatch interval and the frame/post-frame queue. They use full synchronous formatting and DOM writes. Later updates retain the existing FPS cap, adaptive coalescing, and incremental patching. Token events remain unbatched; smooth-streaming delays are unchanged. The scheduling assertions are in the 13-case cross-platform `tests/streaming-dom.test.mjs` suite.

The final optimized-ON [equivalence run](equivalence.json) passes all seven generation paths against archived `ee771bb`: final/direct/base HTML, normalized memory/JSONL, token count/order, once-only completion events, and the intentional Director tab stop. The fixture seeds the same Author’s Note defaults in each initial chat header, avoiding asynchronous extension initialization races without ignoring additional fields.

Commands, run from the repository root with Node v24.22.1 and the local Python Playwright environment:

```sh
node scripts/measure-streaming.mjs --base ee771bb --head WORKTREE --scenario main,short --runs 10 --output docs/reviews/2026-10-28-grok-quality/evidence/streaming-opt/m2/ab-main-short
node scripts/measure-streaming.mjs --base ee771bb --head WORKTREE --scenario main --runs 10 --output docs/reviews/2026-10-28-grok-quality/evidence/streaming-opt/m2/ab-main-replication
node docs/reviews/2026-10-28-grok-quality/evidence/streaming-opt/m2/pool-main.mjs
```

Both measurements used `nohup` with a retained shell wait and file polling. Other owned browsers/tests were stopped. Non-smooth metrics retain the original provider first-chunk..last-chunk window. First paint uses the same two-rAF convention on both products and includes visible content or expanded reasoning. Each scenario alternates side order and discards only its two warmups. Bootstrap uses 2,000 paired resamples with seed `opus-round1.5`; differences are head minus base.

The first fixed batch contains ten main pairs and ten short pairs. Because its long-frame-share interval was wide, exactly one additional ten-pair main replication was specified before starting it. All twenty main pairs are pooled; no valid measured run was removed or chosen for significance. The [pooling script](pool-main.mjs) asserts matching source hashes, Chromium, Node, and base revision; [pooled-main.json](pooled-main.json) lists every contributing run. Both standalone comparisons remain available. The per-batch README’s automatic S0 decision text is a baseline heuristic; the explicit final-build acceptance assessment is below.

## Main, pooled n=20 per side

| Metric | Base median | Head median | Head − base | 95% CI |
| --- | ---: | ---: | ---: | --- |
| First visible paint (ms) | 128.96 | 100.62 | -28.34 | [-57.67, -4.26] |
| Finish (ms) | 300.14 | 248.23 | -51.91 | [-141.32, 5.04] |
| Frame p95 (ms) | 16.80 | 16.80 | +0.00 | [0.00, 0.00] |
| Frames >33 ms (%) | 2.23 | 1.63 | -0.60 | [-2.97, 0.64] |
| Typing p95 (ms) | 44.65 | 34.05 | -10.60 | [-12.75, -4.55] |
| Stolen scrolls | 0.50 | 0.00 | -0.50 | [-10.50, 0.00] |

First-paint latency is significantly earlier and finish latency is not significantly worse. Frame p95 remains 16.8 ms; typing p95 is below 50 ms and significantly improves. Every measured head run has zero stolen scrolls.

**Unconfirmed original criterion:** >33 ms frame share is 2.23% → 1.63% (27.02% lower), CI [−2.97, +0.64] percentage points. This does not re-establish the original plan’s ≥50% reduction with an interval excluding zero. The point estimate improves and no significant tail-frame regression is detected, but the old quantitative win must not be claimed for this final build from these measurements. This remains the only unconfirmed original performance criterion.

## Main, primary n=10 per side

| Metric | Base median | Head median | Head − base | 95% CI |
| --- | ---: | ---: | ---: | --- |
| First visible paint (ms) | 125.67 | 104.99 | -20.68 | [-62.58, 17.03] |
| Finish (ms) | 240.09 | 195.97 | -44.12 | [-173.40, 58.05] |
| Frame p95 (ms) | 16.80 | 16.80 | +0.00 | [-8.20, 0.10] |
| Frames >33 ms (%) | 1.44 | 1.04 | -0.40 | [-3.16, 1.17] |
| Typing p95 (ms) | 41.20 | 34.10 | -7.10 | [-11.30, -3.00] |
| Stolen scrolls | 0.50 | 0.00 | -0.50 | [-11.50, 0.00] |

[Primary comparison](ab-main-short/comparison.json); [independent main replication](ab-main-replication/comparison.json).

## Short, 100 messages × 500 tokens, n=10 per side

| Metric | Base median | Head median | Head − base | 95% CI |
| --- | ---: | ---: | ---: | --- |
| First visible paint (ms) | 183.17 | 130.83 | -52.34 | [-70.21, -9.29] |
| Finish (ms) | 268.73 | 363.63 | +94.90 | [-41.65, 162.90] |
| Frame p95 (ms) | 33.30 | 25.00 | -8.30 | [-16.50, 16.45] |
| Frames >33 ms (%) | 6.15 | 4.52 | -1.64 | [-4.65, 0.83] |
| Typing p95 (ms) | 45.85 | 34.20 | -11.65 | [-141.10, -7.00] |
| Stolen scrolls | 10.50 | 0.00 | -10.50 | [-11.50, 0.00] |

The required short frame/typing/first-paint/finish metrics show no significant regression. First paint and typing significantly improve. Finish has a higher +94.90 ms point estimate with a wide interval spanning zero; this is uncertainty, not a demonstrated finish win.

Across both batches: 66 valid samples including six discarded warmups; 30 measured head runs all have `scrollStolen=0`. Both batches exited 0; all four product-server shutdown records show exit 0 and removed owner locks. Per-run summaries, source identities, named sample counts, and redacted raw gzip samples are retained alongside each comparison. These are local Linux/Chromium measurements, separate from CI `test:perf` node tests.
