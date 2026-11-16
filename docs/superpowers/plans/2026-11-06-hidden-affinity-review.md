# Hidden affinity completion and logic review

Baseline: `feature/hidden-affinity` at `a72f9e7`. Continue the existing contract
in `docs/affinity.md`; preserve hidden scores, owner isolation, success-only
receipts, causal promises, independent major verification and nonblocking work.

## Baseline observations

- Related Director/reasoning tests: 365 passed, no failures or skips.
- Local full regression: 1184 cases, 1163 passed, one failure, 20 skipped. The
  remaining native Windows path case misquotes `cmd.exe` arguments. The 15
  development-environment failures did not reproduce as that group locally.
- Production state probes show quote-width aliases rescore one attitude and
  duplicate promise anchors. Unknown-to-character facts also enter its prompt.
- Lifecycle probes show shared short memory placeholders bypass full budgeting
  and concurrent quiet requests destroy the normal attempt and receipt.
- A removed group member can trigger a new major-verifier call after removal.
- Major verification currently loses quoted evidence beyond the first 2000
  characters; a scheduled worker can see a native chat-load empty window.
- Current evaluator input on five long Chinese replies is 27778 model tokens,
  with a 927-token empty template; a 4096/300 configuration allows only 3796.

## Changes and acceptance

- [x] Canonicalize overlapping source spans without merging independent statements;
  migrate persisted aliases and preserve valid canonical promise dependencies.
- [x] Retain unknown evidence in storage but inject only character-known evidence.
- [x] Put complete shielded memory in the request-local chat copy; exclude it
  from world-info scanning and scrub unknown frames without leaking private text.
- [x] Pass native generation type alongside finalized data; quiet/impersonate
  cannot clear or claim a normal generation's state, even with no memory yet.
- [x] Cancel changed roster work before verification; supply actual quote context
  for major checks, including late quotes, results and acknowledgements.
- [x] Bind scheduled saves to the original owner and loaded message identity;
  prove the real immediate-reload path neither saves an empty chat nor loses
  or duplicates accepted receipts.
- [x] Fit evaluator input using the active model tokenizer and response-adjusted
  budget. Trimming request views never deletes stored evidence; omitted context
  is not marked evaluated. Cancellation releases stalled tokenization.
- [x] Reproduce and fix native Windows quoting without skipping the real alias test:
  the focused file passes all five cases after verbatim cmd arguments.
- [x] Add real browser synthetic-provider acceptance for 5/10 cadence, persisted
  state, edits/swipes, quiet overlap, budgets, cancellation, real group owners
  and mobile-sized settings. No real chat data or paid model requests.
- [x] Run final focused tests/lint, complete regression, applicable Director/Fate
  browser checks; preserve red/green and honest skipped/untested boundaries.
- [x] Append commits and ordinary-push the feature branch with sanitized evidence.
  Prepare review; do not merge or deploy automatically.

## Final evidence

User approved an independent bounded sidecar output allowance; implementation caps it at 2048 tokens and scales it with model context without changing foreground settings. Final related tests:427/427; affinity-only units:160/160; full regression:1226 passed,0 failed,20 explicitly listed environment/platform skips. Native browser groups:affinity14/82 requests,third-party compatibility13/74,Director53/63,Fate57/35;all page errors0. The compatibility profile explicitly omits only the third-party main-prompt small-context budget case;the isolated complete profile retains it. Product CI7b6379f actual6/6 in run42235693957. Delivery CI is identified separately in the final handoff. All source/test hashes are bound in the review report;no merge or deployment.
