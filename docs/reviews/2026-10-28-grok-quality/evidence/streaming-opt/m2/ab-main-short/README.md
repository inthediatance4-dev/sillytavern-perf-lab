# Streaming measurements

Runs per side/scenario: main=10, short=10. Bootstrap: 2000 paired resamples, seed `opus-round1.5`.

| Scenario | Side | Frame p95 ms | >33ms % | Typing p95 ms | First token ms | Finish ms | Updates/s | Scroll stolen |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main | base | 16.80 | 1.44 | 41.20 | 125.67 | 240.09 | 21.72 | 0.50 |
| main | head | 16.80 | 1.04 | 34.10 | 104.99 | 195.97 | 23.86 | 0.00 |
| short | base | 33.30 | 6.15 | 45.85 | 183.17 | 268.73 | 19.36 | 10.50 |
| short | head | 25.00 | 4.52 | 34.20 | 130.83 | 363.63 | 21.04 | 0.00 |

Non-smooth frame/typing/hook metrics use the provider first-chunk..last-chunk window. Smooth metrics extend that window through final visible paint to include the existing per-character backlog; first-token and finish latency keep their provider-clock definitions. Each run records both window bounds and named network/render sample counts.

Cells are medians of per-run metrics. All per-metric summaries and 95% median-difference CIs are in comparison.json; raw browser/endpoint samples are gzipped beside each run.

All metric CIs include zero: **false**.

Decision on main: **skip S1 and S3, only S2**. Frame p95 median 16.80 ms (threshold 20); typing p95 median 34.10 ms (threshold 50); maximum scroll-stolen 0 (target 0).
