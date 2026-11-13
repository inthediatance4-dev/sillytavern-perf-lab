# Save-path A/B benchmark: 9293a4e vs 617a04f (record only)

Method: `BENCH_BASELINE=9293a4e node scripts/benchmark-performance.mjs`, run from a detached worktree at 617a04f. 5 warmup runs, then 30 interleaved runs; 95% bootstrap CIs. The baseline and current versions run in the same process.

| Platform | Node | baseline median (ms) | current median (ms) | difference (ms) | 95% CI | relative |
|---|---|---|---|---|---|---|
| Linux (box) | 20.19.2 | 5.587 | 6.106 | +0.519 | [-0.108, +1.267] | +9.3% |
| Linux (box) | 22.20.0 | 6.379 | 6.506 | +0.127 | [-0.352, +1.016] | +2.0% |
| Linux (box) | 24.22.1 | 4.915 | 5.195 | +0.280 | [-0.431, +0.879] | +5.7% |

- Every CI includes 0. No median regression above 10% was detected on Linux.
- Windows: see the bench-save workflow (triggered by `[bench]` in a commit message, Node 24, windows-latest and ubuntu-latest). Its current side is that commit's HEAD.
- Raw data: bench-save-linux-v*.json.
