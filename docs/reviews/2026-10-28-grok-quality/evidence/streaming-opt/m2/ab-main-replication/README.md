# Streaming measurements

Runs per side/scenario: main=10. Bootstrap: 2000 paired resamples, seed `opus-round1.5`.

| Scenario | Side | Frame p95 ms | >33ms % | Typing p95 ms | First token ms | Finish ms | Updates/s | Scroll stolen |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main | base | 16.80 | 3.50 | 46.25 | 150.07 | 337.76 | 21.38 | 0.50 |
| main | head | 16.80 | 1.84 | 34.05 | 100.62 | 270.34 | 23.36 | 0.00 |

Non-smooth frame/typing/hook metrics use the provider first-chunk..last-chunk window. Smooth metrics extend that window through final visible paint to include the existing per-character backlog; first-token and finish latency keep their provider-clock definitions. Each run records both window bounds and named network/render sample counts.

Cells are medians of per-run metrics. All per-metric summaries and 95% median-difference CIs are in comparison.json; raw browser/endpoint samples are gzipped beside each run.

All metric CIs include zero: **false**.

Decision on main: **skip S1 and S3, only S2**. Frame p95 median 16.80 ms (threshold 20); typing p95 median 34.05 ms (threshold 50); maximum scroll-stolen 0 (target 0).
