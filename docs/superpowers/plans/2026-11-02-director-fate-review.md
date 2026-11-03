# Fate Cards Review Corrections Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the independent group-state fix, browser cases and read-only review. Keep shared-file edits owned by one worker.

**Goal:** Resolve FC1–FC4 with append-only commits, actual request evidence and an approved merge order.

**Architecture:** Preserve the private-card model, exact data-object completion identity and separate held/bound metadata. Count the complete event during assembly, shield macro delimiters until request finalization, and keep request records across unrelated quiet generations. Insert the full shielded Fate event only into the interceptor request-local chat copy. The user approved the one-line Generate world-info filter for these temporary rows; no shared Fate prompt is installed.

**Tech Stack:** Existing browser ES modules, node:test, Python Playwright, synthetic OpenAI provider, existing Node v24.22.1.

## Merge prerequisite

- [x] Recheck the frozen followups evidence and 25 source/test hashes plus 17 third-party hashes.
- [x] Obtain the user's final G1–G6 approval. Merge `01eff6a` into `codex-improvements` with `--no-ff` as `19d06f3` and ordinary push.
- [x] Verify the actual merged commit's six-job CI: https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/41217529543.
- [x] Merge the new baseline into Fate as `9dd3f66`, retaining every existing commit; ordinary push.

## FC3: ownership change unlock

Files: `public/scripts/group-chats.js`, `tests/director-fate-group-scope.test.mjs`.

- [x] Run three failing tests against the actual extracted function, with mutable group/chat/metadata bindings rather than by-value fixture arguments.
- [x] Before ownership-change return, execute `setSendButtonState(false)`. Assert no deletion or wrapper invocation, a FINISHED notification, and a successful later regeneration.
- [x] Run the focused file and lint; independently commit as `643c3f9`.

## FC1: full event budget and response limit

Files: `public/scripts/extensions/director/fate.js`, `tests/director-fate.test.mjs`.

- [x] Add failing tests for 400 codepoints accepted / 401 rejected, output allowance, and an assembly value at least as long as the eventual literal text.
- [x] Frame the complete instruction and event with a per-record identity; replace macro delimiters with same-length private characters. Include legacy angle-bracket macros in shielding. Replace the complete frame with the original literal text at AFTER_DATA, after budget allocation.
- [x] Change new event validation and the quiet prompt to 400 codepoints. Increase the quiet response allowance to 1024 tokens and request concise text; malformed/truncated output remains an ordinary retained-card failure.
- [x] Confirm that the assembled final text retains `{{char}}`, `{{random}}` and `<uSeR>` literally. Run affected controller tests and commit FC1 separately.

## FC2: concurrent quiet request ownership

Files: `fate.js`, Director `index.js`, controller tests, and the new `tests/browser_fate_review_cases.py`.

- [x] Reproduce normal prepare → quiet start/assembly/end → normal AFTER_DATA. Preserve the normal record throughout; exclude Fate from quiet/impersonate, and remove an unrecognized frame completely rather than leaking a marker or private body.
- [x] Evaluate the interceptor's request-local `coreChat` copy as an alternative to the shared extension prompt. A temporary narrator message can carry the full shielded text, but would enter world-info scanning unless explicitly excluded. The user explicitly approved this concrete world-info filter exception; the implementation uses only that additional Generate change.
- [x] Add tests for copied normal data surviving quiet, failed quiet, chat change, orphan frames and request identity. Keep ENDED separate from successful COMPLETED and retain exact metadata/position/fingerprint checks.
- [x] Run focused tests, independent spec and quality review, then commit FC2 separately.

## Review suggestions

- [x] S1: Extract the first complete JSON object using balanced braces and JSON string/escape handling; retain strict one-field validation and private generic errors.
- [x] S2: Include `hasPendingFileAttachment()` in the adoption draft guard; prove the pending attachment is neither submitted nor cleared.
- [x] S3: Skip an unchanged replay binding save, while preserving changed group generation identity.
- [x] S4: Roll back only the `fate` field, preserving concurrent `boundInstruct` writes.
- [x] S5/S6: Both READMEs explicitly state that titles hint at category and adoption also consumes a pending normal Director instruction.
- [x] S7: Check existing issues and separately track the existing 390px instruction-chip overflow.

## Browser and final acceptance

Files: existing browser runner, `tests/browser_fate_review_cases.py`, review evidence directory.

- [x] FC1: context 2048, reply 256, identical saturated synthetic history; adopt a 400-codepoint event and count the actual outgoing messages with the configured tokenizer. Require prompt <=1792 tokens, exactly one literal event, and the corresponding reduction in retained history.
- [x] FC2: pause a real UI adoption at CHAT_COMPLETION_PROMPT_READY, run a real quiet request to completion, then resume. Require no frame/event in quiet, exactly one event in normal, held consumed, and no `directorfate` in any provider request.
- [x] FC3: change ownership in STARTED on a real two-member group; assert native sending state false and successful subsequent UI send.
- [x] Run only related Director unit tests and lint, then three browser groups: default complete Director (isolated extensions), `--fate-only --enable-third-party`, and the new focused review group. Stop after those pass.
- [ ] Preserve red/green and failed diagnostic evidence, source hashes, exact command/results and actual CI run links. Ordinary push, final HEAD CI 6/6; leave Fate merge for the next review approval.

## Verification details

The corrected browser cases use synchronous Playwright polling of a previously awaited live module namespace. A minimal reproduction proved that an async predicate returning false was accepted as a truthy Promise. Dates in diagnostic snapshots are serialized as ISO strings. These fixture failures remain distinct from source regressions.

Results: related Director units 104/104; targeted lint exit 0; default full browser 53 checks / 63 synthetic requests; third-party enabled Fate 10 checks / 23 requests; FC1/FC2/FC3 5 checks / 13 requests. All three final browser groups have zero page errors. Optional LAB_BROWSER_PROXY uses an existing proxy only for external dependencies, keeps loopback direct, and does not alter third-party code or suppress errors.
