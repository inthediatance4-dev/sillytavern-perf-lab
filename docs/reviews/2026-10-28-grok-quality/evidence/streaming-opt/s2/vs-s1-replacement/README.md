# Streaming measurements

Runs per side/scenario: main=2. Bootstrap: 2000 paired resamples, seed `opus-round1.5`.

| Scenario | Side | Frame p95 ms | >33ms % | Typing p95 ms | First token ms | Finish ms | Updates/s | Scroll stolen |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main | base | 16.80 | 3.23 | 31.05 | 132.62 | 301.22 | 22.66 | 1.00 |
| main | head | 25.05 | 2.91 | 37.45 | 109.98 | 148.64 | 23.80 | 0.00 |

Cells are medians of per-run metrics. All per-metric summaries and 95% median-difference CIs are in comparison.json; raw browser/endpoint samples are gzipped beside each run.

All metric CIs include zero: **false**.

Decision on main: **S1 then S2, S3 decided after S1**. Frame p95 median 25.05 ms (threshold 20); typing p95 median 37.45 ms (threshold 50); maximum scroll-stolen 0 (target 0).

This is generated harness output. Its automatic S0 decision label is not an S2 acceptance decision. See the parent README and combined vs-s1-comparison.json for S2 interpretation and control-run exclusions.
