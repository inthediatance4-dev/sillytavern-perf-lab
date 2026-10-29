# S1 smooth A/B — incomplete (harness flake)

`--base ee771bb --head WORKTREE --scenario smooth --runs 7` started after S1 merge.
Warmups completed on both sides; **smooth-01-base failed** with `Required measurement has no samples`.

Cause (from the gzipped raw): the browser's first paint landed **after** the fake provider's last network chunk (`firstPaintEpochMs > lastChunkEpochMs`), so the first-chunk..last-chunk frame/typing filters were empty. Warmup on the same product had ~869 frames in-window. This is a lab timing flake under smooth streaming (network stream ~15s, smooth backlog ~5.5 min), not a product regression. The harness currently aborts the whole matrix on the first failed run.

## Warmup medians (discarded, not acceptance)

| Side | frame p95 | typing p95 | finish ms | updates/s | scroll stolen |
| --- | ---: | ---: | ---: | ---: | ---: |
| base (ee771bb) | 16.7 | 35.1 | 340553 | 11.0 | 60 |
| head (S1) | 16.7 | 31.9 | 350847 | 11.2 | 23 |

Smooth finish latency is the existing per-character smooth-streaming backlog after the network ends (plan forbids changing those delays). Smooth was optional ("if time permits") for S1 acceptance; the main/short/reasoning/continue A/B already met the targets. Not retried here to free the machine for S2; leave a full smooth A/B for a later pass if desired.
