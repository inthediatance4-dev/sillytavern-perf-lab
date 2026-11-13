# Save-path A/B vs 9293a4e (record only)

Method: `scripts/benchmark-performance.mjs` saveChat with `BENCH_BASELINE=9293a4e`, 5 warmup runs then 30 interleaved runs. Medians are in ms; the 95% CI is a paired bootstrap of the difference (current − baseline).

| Where | Node | Commit (current) | Baseline | Current | Diff | 95% CI | Relative |
|---|---|---|---|---|---|---|---|
| GitHub windows-latest | 24.22.1 | 71997bf (round 2, before cache) | 6.671 | 8.002 | +1.330 | 0.976..1.580 | **+19.9%** |
| GitHub ubuntu-latest | 24.21.0 | 71997bf | 2.570 | 2.823 | +0.253 | 0.040..0.380 | +9.8% |
| GitHub windows-latest | 24.22.1 | af70991 (cache, resolve key) | 6.813 | 8.061 | +1.248 | 1.118..1.431 | +18.3% |
| GitHub ubuntu-latest | 24.21.0 | af70991 | 4.147 | 4.458 | +0.311 | 0.196..0.456 | +7.5% |
| GitHub windows-latest | 24.22.1 | 3b656aa (cache, pathKey key; final) | 6.416 | 7.747 | +1.331 | 1.161..1.625 | **+20.7%** |
| GitHub ubuntu-latest | 24.21.0 | 3b656aa | 3.827 | 4.041 | +0.214 | 0.108..0.402 | +5.6% |
| Linux box (shared, noisy) | 20/22/24 | af70991 | | | | all CIs include 0 | +1.1% / +14.7% / −6.2% |

Conclusion:
- Caching the creation of the staging directory removed the per-save mkdir, but the Windows overhead did not change measurably (about +1.3 ms per save, ~+20%).
- The remaining cost is most likely the staging write plus the cross-directory rename on NTFS/Defender. That is not proven; profiling the Windows save path is the next step.
- fsync, locks and token checks were not touched.
- Raw data: bench-ci/*.json and bench-save-linux-v*.json.
