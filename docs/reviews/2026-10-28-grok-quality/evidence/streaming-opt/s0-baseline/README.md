# S0 baseline (product = codex-improvements ffd5f4e + read-only probes, commit ee771bb)

Headless Chromium 156 on Linux (8 vCPU), fake streaming provider 200 tok/s, 1–3 tokens/chunk, ±25% jitter, seed `opus-streaming-s0`, streaming_fps 30, chat_truncation 100. Single-side baseline runs (no A/B); values are medians of per-run metrics; ms unless noted.

The baseline was collected in three output directories because the run was interrupted twice (tool quota stop, then a box reboot); each directory is a complete, independent set for the scenarios listed against it. `s0-baseline` smooth runs 1–5 are an interrupted partial set and are superseded by `s0-baseline-3`. During `s0-baseline-2`/`-3` another agent session was editing code (mostly idle LLM time, occasional light browser checks), so absolute numbers may carry small extra noise; all later decisions use paired A/B runs.

| 场景 Scenario | 来源 dir | n | frame p50 | frame p95 | frame p99 | >16.7ms % | >33ms % | typing p95 | first token | finish | format p95 | DOM p95 | updates/s | LoAF total ms | scroll stolen median / max |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| main | s0-baseline | 10 | 16.7 | 16.8 | 33.4 | 7.05 | 2.64 | 44.1 | 115 | 292 | 1.90 | 0.30 | 21.8 | 211 | 0 / 20 |
| short | s0-baseline | 7 | 16.7 | 16.8 | 50.1 | 8.09 | 3.68 | 39.8 | 156 | 186 | 1.30 | 0.30 | 19.9 | 236 | 0 / 10 |
| smooth | s0-baseline-3 | 7 | 16.7 | 16.7 | 16.8 | 4.85 | 0.12 | 35.3 | 116 | 329332 | 0.80 | 0.20 | 11.0 | 83 | 23 / 60 |
| reasoning | s0-baseline-2 | 7 | 16.7 | 33.3 | 50.0 | 12.05 | 7.37 | 47.4 | 1510 | 282 | 4.90 | 0.30 | 20.0 | 544 | 1 / 1 |
| continue | s0-baseline-2 | 7 | 16.7 | 33.4 | 33.5 | 14.34 | 11.50 | 47.6 | 177 | 217 | 6.20 | 1.20 | 19.6 | 551 | 0 / 1 |

Scenarios: main = 2000 msgs × 3000 tok, smooth off, no reasoning, send; short = 100 × 500; smooth = main with smooth_streaming on; reasoning = main with streamed reasoning first; continue = main in Continue mode.

Notes:
- Smooth-streaming finish latency (~329 s) is the existing per-character smooth-streaming backlog after the network stream ends (3000 tokens of text), not a hang. The plan forbids changing smooth_streaming delays, so this is reported only.
- Reasoning first-token latency counts until visible answer text (collapsed reasoning excluded), so it includes the whole reasoning phase.
- Scroll stolen is bimodal: many runs 0, others 10–60 resets after a 600 px upward scroll (see s0-selfcheck: same-commit medians 0 vs 10).

## Decision (plan rule, main scenario)

frame p95 16.8 ms ≤ 20 ✓, typing p95 44.1 ms ≤ 50 ✓, scroll stolen = 0 in every run ✗ (max 20). → **S1 then S2, S3 decided after S1.**
The reasoning and continue scenarios show frame p95 ≈ 33 ms and 7–11% frames > 33 ms, which is where S1 is expected to help most.
