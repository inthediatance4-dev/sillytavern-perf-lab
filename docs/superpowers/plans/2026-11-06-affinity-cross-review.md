# Affinity cross-review corrections implementation plan

> **For agentic workers:** Execute the independent state, lifecycle and budgeting work in parallel with regression-first checks, then review the combined behavior and run the focused browser acceptance.

**Goal:** Fix verified GLM cross-review defects and the previous independent review findings without changing the hidden-affinity product scope or rewriting history.

**Architecture:** Keep the version-1 ledger and native success-bound receipt contract. Deduplicate scoring by the actual character attitude and fulfillment evidence, retain canonical quote ranges, and recompute consistently on reload. Make request fitting and request attribution robust to asynchronous saves and settings changes. Reject invalid event entries independently while retaining strict envelopes and private diagnostics.

**Tech stack:** Existing JavaScript modules, Node test runner, native browser fixture with Python Playwright and a synthetic provider.

## State and parser

- [x] In `tests/director-affinity-state.test.mjs`, add red tests for outcome/attitude shared acknowledgement, repeated promise anchors sharing fulfillment, canonical neutral enrichment and mixed valid/invalid response entries.
- [x] In `public/scripts/extensions/director/affinity-state.js`, implement one scoring contribution per overlapping owner evidence, preserve anchor closure without repeat rewards, preserve canonical ranges and apply the same rule during reconciliation and memory building.
- [x] Keep top-level JSON/envelope/size limits strict. Add `parseAffinityResponse(raw, { onRejected })`; invalid individual entries are skipped, and the callback receives only fixed categories and counts.
- [x] Run the state file and preserve red/green logs.

## Lifecycle, evaluator context and private diagnostics

- [x] In `tests/director-affinity-lifecycle.test.mjs`, reproduce two successful overlapping stream completions with the first save pending, plus a continue path, latest-memory selection, frame-like user literals and diagnostic privacy.
- [x] In `public/scripts/extensions/director/affinity.js`, keep request-bound successful finishing records valid across a later generation; retain stopped, disabled, changed-owner and changed-message rejection.
- [x] Sort evaluator history by actual evidence order with host IDs as tie-breakers, include the newest forty non-promises and required promise anchors, and expose prior outcome acknowledgements to avoid duplicate extraction.
- [x] Strip only complete strictly delimited memory frames. Preserve ordinary bare marker-like strings; unknown complete frames still fail closed.
- [x] Add in-memory diagnostic counters for fixed failure categories, exposed through a detached snapshot getter and optional callback. No chat, model response, quotes, IDs, secrets or raw exceptions are included.
- [x] In `public/scripts/extensions/director/index.js`, expose only the safe diagnostic snapshot for manual troubleshooting.
- [x] Run the lifecycle file and preserve red/green logs.

## Budgeting

- [x] Add tests in `tests/director-affinity-budget.test.mjs` that reduce a dynamic budget during fitting and before dispatch.
- [x] In `public/scripts/extensions/director/affinity-prompt-budget.js`, revalidate queued batches under the current tokenizer/budget, and give the controller a per-batch validation before dispatch. Oversized checks stay unverified rather than producing an oversized request.
- [x] Run the budget file and preserve red/green logs.

## Browser acceptance, review and delivery

- [x] Add a native browser save-gap regression in `tests/browser_affinity_cases.py`, preserving the real Enter path and the send-button control. Assert complete final messages, distinct successful completions and complete persisted receipts.
- [x] Run focused affinity units, lint on changed JavaScript/tests and the affinity browser profile; run the compatible third-party profile where relevant. Do not rerun the full repository suite.
- [x] Review state/lifecycle changes independently. Resolve material findings before completion.
- [x] Update `docs/affinity.md` and review evidence, including the actual system-role injection tradeoff and untested real-model boundary.
Delivery policy: append scoped commits, sanitize staged content for machine paths/secrets, and ordinary-push `feature/hidden-affinity`. Do not merge or deploy. The final response records the actual push and CI outcome.

## Review decisions

The user authorized corrections after supplying concrete review findings. No new feature design or extra approval gate is needed. GLM item 6 remains a documented design risk: the prose requests low-priority treatment but cannot override the provider's actual system-message hierarchy. We retain the established role placement in this correction.
