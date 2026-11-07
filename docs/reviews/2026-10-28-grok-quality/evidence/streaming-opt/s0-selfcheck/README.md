# Streaming measurements

Runs per side/scenario: main=10. Bootstrap: 2000 paired resamples, seed `opus-round1.5`.

| Scenario | Side | Frame p95 ms | >33ms % | Typing p95 ms | First token ms | Finish ms | Updates/s | Scroll stolen |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main | base | 16.80 | 1.98 | 43.05 | 112.23 | 244.38 | 21.98 | 0.00 |
| main | head | 16.80 | 2.51 | 45.20 | 132.38 | 247.00 | 21.66 | 10.00 |

Cells are medians of per-run metrics. All per-metric summaries and 95% median-difference CIs are in comparison.json; raw browser/endpoint samples are gzipped beside each run.

All metric CIs include zero: **true**.

Decision on main: **S1 then S2, S3 decided after S1**. Frame p95 median 16.80 ms (threshold 20); typing p95 median 45.20 ms (threshold 50); maximum scroll-stolen 23 (target 0).

Both products are HEAD (`ffd5f4e555b48d50482b330a5d03aa024d14281e`) plus the identical read-only `timing-hooks.patch` and shared timing module. The invocation retains their hashes. Canonical Git metadata was mounted read-only, so the requested S0 commit could not precede this comparison. Neither side includes product optimizations. Both labs exited cleanly and released their owner locks.

| Metric | Base median | Head median | Head − base 95% CI | Includes 0 |
| --- | ---: | ---: | --- | --- |
| frameP50Ms | 16.700 | 16.700 | [0.000, 0.000] | True |
| frameP95Ms | 16.800 | 16.800 | [-0.050, 0.100] | True |
| frameP99Ms | 33.300 | 33.400 | [-16.500, 16.600] | True |
| framesOver16_7Pct | 6.420 | 7.615 | [-2.000, 3.139] | True |
| framesOver33Pct | 1.982 | 2.514 | [-1.832, 4.032] | True |
| loafCount | 2.000 | 2.500 | [-1.500, 2.500] | True |
| loafTotalMs | 248.850 | 293.750 | [-113.300, 241.250] | True |
| loafScriptmessageFormattingMs | 0.000 | 0.000 | [0.000, 0.000] | True |
| loafScriptDOMPurifyMs | 0.000 | 0.000 | [0.000, 0.000] | True |
| loafScriptkeyboardMs | 4.250 | 12.550 | [-17.600, 36.700] | True |
| loafScriptotherMs | 167.700 | 181.050 | [-41.800, 134.800] | True |
| formatP50Ms | 1.400 | 1.350 | [-0.100, 0.050] | True |
| formatP95Ms | 2.200 | 2.150 | [-1.600, 2.100] | True |
| domP50Ms | 0.200 | 0.200 | [0.000, 0.000] | True |
| domP95Ms | 0.300 | 0.300 | [-0.050, 0.000] | True |
| reasoningP95Ms | 0.200 | 0.200 | [0.000, 0.000] | True |
| scrollCallP95Ms | 0.000 | 0.050 | [0.000, 0.100] | True |
| updatesPerSecond | 21.979 | 21.663 | [-1.123, 0.834] | True |
| firstTokenMs | 112.233 | 132.382 | [-43.483, 54.665] | True |
| finishMs | 244.381 | 246.995 | [-99.812, 108.197] | True |
| typingP50Ms | 31.200 | 29.650 | [-5.100, 2.700] | True |
| typingP95Ms | 43.050 | 45.200 | [-2.100, 6.100] | True |
| scrollStolen | 0.000 | 10.000 | [-20.000, 20.500] | True |
