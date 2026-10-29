# Streaming measurements

Runs per side/scenario: short=1. Bootstrap: 2000 paired resamples, seed `opus-round1.5`.

| Scenario | Side | Frame p95 ms | >33ms % | Typing p95 ms | First token ms | Finish ms | Updates/s | Scroll stolen |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| short | base | 16.80 | 0.77 | 39.20 | 137.78 | 50873.36 | 15.09 | 3.00 |
| short | head | 16.80 | 0.68 | 36.00 | 164.91 | 55636.08 | 15.36 | 0.00 |

Non-smooth frame/typing/hook metrics use the provider first-chunk..last-chunk window. Smooth metrics extend that window through final visible paint to include the existing per-character backlog; first-token and finish latency keep their provider-clock definitions. Each run records both window bounds and named network/render sample counts.

Cells are medians of per-run metrics. All per-metric summaries and 95% median-difference CIs are in comparison.json; raw browser/endpoint samples are gzipped beside each run.

All metric CIs include zero: **false**.
