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
