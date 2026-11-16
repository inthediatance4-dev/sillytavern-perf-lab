# Streaming measurements

Runs per side/scenario: smooth=7. Bootstrap: 2000 paired resamples, seed `opus-round1.5`.

| Scenario | Side | Frame p95 ms | >33ms % | Typing p95 ms | First token ms | Finish ms | Updates/s | Scroll stolen |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| smooth | head | 16.70 | 0.12 | 35.30 | 115.72 | 329332.09 | 11.04 | 23.00 |

Cells are medians of per-run metrics. All per-metric summaries and 95% median-difference CIs are in comparison.json; raw browser/endpoint samples are gzipped beside each run.
