# Fate log and message marks (Ticket C) — evidence

Product commits: `d12f76d` (C1 log), `6e19eb7` (C2+C3 marks and wiring), `60fdb33` (C4+C5 panel and styles). This commit adds the browser acceptance checks in `tests/browser_fate_cases.py` and these reports.

The browser reports below were produced on a tree equal to `60fdb33` plus the `tests/browser_fate_cases.py` committed here (SHA-256 `a8bf8647e271472f6850924dd8a448f51478e8f4f78e3218a299a5f8a58685eb`). Their `head` field therefore reads `60fdb33`. All model requests go to the repository's synthetic OpenAI fixture.

| Command | Result | Report |
| --- | --- | --- |
| `node --test tests/director-fate*.test.mjs` | 181/181 pass | — |
| `node --test tests/director-*.test.mjs` | 223/223 pass | — |
| `npm run lint` | clean | — |
| `python -u tests/browser-director-lab.py --node <node> --fate-only` | 53 checks pass, 0 page errors | [fate-only.results.json](evidence/fate-only.results.json) |
| `python -u tests/browser-director-lab.py --node <node> --fate-review-only` | 5 checks pass, 0 page errors | [fate-review-only.results.json](evidence/fate-review-only.results.json) |
| `python -u tests/browser-director-lab.py --node <node>` (full Director regression) | 53 checks pass, 0 page errors | [full.results.json](evidence/full.results.json) |

`failedRequests` entries are `net::ERR_ABORTED` from the deliberate stop scenarios.

CI (`npm run lint`, `npm run test:perf`) does not run the browser suites; see the CI coverage note in [the earlier review](../2026-11-03-director-fate-review/README.md#ci-coverage).

## CI run for `e48ba6c`

[Run 41704776774](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/41704776774) ended 6/6 green, but only after a rerun.

- Attempt 1: five jobs passed. [`perf (22, windows-latest)`](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/41704776774/job/126157065553) failed with 1031 pass / 1 fail. The failing test was `a live owner blocks another process and leaves the lock unchanged` in the data-root owner tests: `Process identity probe timed out after 5005 ms (attempt 2/2)`. That test and the probe are outside the Director code changed here, and every Fate and Director node test passed in that job.
- Attempt 2 reran only the failed job, and [it passed](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/41704776774/job/126159946978) with no code change.

The data-root owner timeout is recorded here as a known Windows CI flake. It was not fixed on this branch.
