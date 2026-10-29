# Streaming measurements

Runs per side/scenario: main=10, short=10. Bootstrap: 2000 paired resamples, seed `opus-round1.5`.

| Scenario | Side | Frame p95 ms | >33ms % | Typing p95 ms | First token ms | Finish ms | Updates/s | Scroll stolen |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main | base | 16.80 | 3.22 | 43.55 | 107.90 | 225.96 | 21.57 | 0.00 |
| main | head | 16.80 | 1.04 | 33.15 | 158.55 | 232.31 | 23.64 | 0.00 |
| short | base | 33.30 | 6.89 | 46.30 | 149.37 | 373.33 | 19.38 | 0.00 |
| short | head | 16.80 | 1.48 | 32.10 | 142.11 | 317.39 | 21.42 | 0.00 |

Cells are medians of per-run metrics. All per-metric summaries and 95% median-difference CIs are in comparison.json; raw browser/endpoint samples are gzipped beside each run.

All metric CIs include zero: **false**.

Decision on main: **skip S1 and S3, only S2**. Frame p95 median 16.80 ms (threshold 20); typing p95 median 33.15 ms (threshold 50); maximum scroll-stolen 0 (target 0).

This is generated harness output. Its automatic S0 decision label is not an S2 acceptance decision. See the parent README and combined vs-s1-comparison.json for S2 interpretation and control-run exclusions.
