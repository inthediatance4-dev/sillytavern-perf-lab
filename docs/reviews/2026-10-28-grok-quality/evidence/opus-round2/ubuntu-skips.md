# Ubuntu skips: 1 → 5 (opus-round2, CI run 40665272453)

All 5 skipped tests are native-Windows-only. Each one also runs, and passes, on windows-latest.

| # | Test | File | Introduced in | Skip reason |
|---|---|---|---|---|
| 1 | Windows case aliases refer to the same retired path | tests/chat-lifecycle.test.mjs | 135d943 (before round 1, the original 1 skip) | Requires Windows case-insensitive path semantics |
| 2 | DOS short-name lifecycle roots preserve retirement in both directions (native Windows) | tests/windows-path-key.test.mjs | 9933e1e (round 1.5 phase A) | Requires native Windows DOS 8.3 short-name aliases |
| 3 | real Windows cold probe is bounded and self identity matches a peer observation | tests/process-identity.test.mjs | fc18486 (round 2 item 2) | Requires real Windows PowerShell and process table |
| 4 | native Windows case aliases reconcile the same root-relative marker | tests/lifecycle-reconcile.test.mjs | 1bb906d (round 2 item 1) | Requires native Windows case-insensitive filesystem; path-key simulations run on Linux |
| 5 | native Windows case alias data root reports conflicts read-only | tests/integrity-check.test.mjs | f9b2f88 (round 2 item 3) | Requires native Windows case-insensitive filesystem; unsafe path inputs are tested on all platforms |

Notes:
- The merge commit 9293a4e showed 2 ubuntu skips: rows 1 and 2.
- Rows 3–5 are new Windows-only tests added in round 2.
