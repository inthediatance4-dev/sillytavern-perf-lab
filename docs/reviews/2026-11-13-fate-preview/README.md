# Fate preview and next-round preparation

Director 1.3.3 and Affinity 1.1.3 (shared runtime compatibility update).

Prepared candidate cards show an excerpt of their actual event, capped at 80 Unicode code points plus ellipsis. A held card can be tapped or keyboard-activated to view this preview before adoption, then tapped again to return. Full completed-event reveal still follows the reveal preference. Missing events are explicitly labelled, rather than presented as ready.

Adopting a card now prepares the next offer in the same successful single-character normal reply. It no longer requires another user message to clear the previous binding. Existing offers and unadopted cards are preserved; groups and replay generation do not prepare another offer. Matching-strength pregenerated picks make no additional model request. Cold starts, malformed/missing model blocks and strength changes can still require a quiet request. This does not guarantee every provider obeys the preparation instruction or fits its response budget.

Transport extraction captures the private block before native sentence trimming or regex replacement. Exact request ownership isolates concurrent requests. Multipart content shares its semantic channel; partial marker prefixes are restored at EOF and cannot block unrelated channels. Older shared runtimes are augmented without installing a second bridge. Native rendered-message normalization is accepted once; subsequent edits cannot grant another completion receipt.

## Validation

- Related tests: 352 passed, 0 failed, 0 skipped/cancelled: `node --test tests/director-fate*.test.mjs tests/plugin-*.test.mjs tests/standalone-plugin-package.test.mjs` (PowerShell expands the file arguments explicitly).
- Installed browser runs: `python tests/browser-standalone-plugins.py --host-root . --piggyback-only --node <node> --output <evidence>` and the same command with `--host-root .worktrees/official-plugin-host`.
- Both hosts: 8/8 checks, including 6 lifecycle cases: story/candidate/reasoning, streaming, sentence trimming and marker-removing regex. 390px touch activation in streaming cases; desktop in nonstreaming cases. Events survive reload; private blocks stay out of intermediate story DOM and saved message rows. Each adoption prepares the next offer; the next pick makes zero extra calls.
- Reasoning-only blocks deliberately fall back to one quiet request; they are not used as event data. Official-host Generate return values are not claimed to be rewritten.
- ESLint, Python compilation and whitespace checks passed. Final ZIP hashes match both browser-tested packages (see result JSON).
- Synthetic local provider only; no real model or physical handset acceptance. Fork emitted one pre-existing resource 404; no page exceptions. Official emitted none.
- Independent review identified multipart, literal-prefix and cross-channel buffering issues, all covered by regressions. The reviewer could not finish the last follow-up because its usage limit was reached; final fixes were verified locally.

No host core, third-party extensions, credentials or user chats were modified by this source change. Production deployment retains previous plugin directories for rollback. CI links are reported with the final commit after push.
