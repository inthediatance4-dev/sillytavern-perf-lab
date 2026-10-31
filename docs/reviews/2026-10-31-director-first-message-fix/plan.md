# Director first-message persistence repair

**Goal:** A Director first message stays literal in memory and every saved snapshot, including saves during overlapping token-count dry runs. Real edits and ordinary first greetings keep their existing behavior.

**Architecture:** Exclude messages carrying `extra.director` from Generate's first-greeting substitution, matching the existing messageFormatting exception. Remove Director's late snapshot/restore machinery. This prevents the transient mutation rather than trying to recognize it at save time. No serializer hooks, accessors, third-party modifications, or new lifecycle state.

**Authorization:** The user explicitly approved changing `if (chat.length)` to `if (chat.length && !chat[0].extra?.director)` in Generate and removing the obsolete Director restoration code. This supersedes the earlier prohibition for that exact change. No merge is authorized.

**Alternatives reviewed:** A serialization guard can miss cloned snapshots and overwrite a legitimate edit. A synchronous save hook cannot distinguish an expansion from an intentional edit with the same text. The source-side exception avoids both ambiguities.

**Scope:** `public/script.js` (one guard plus explanatory comment), `public/scripts/extensions/director/index.js` (remove obsolete snapshot/hooks), `tests/browser-director-lab.py` (behavioral regression coverage), and review documentation/evidence. A manually chapter-marked first message also has `extra.director` and follows the existing formatter exception. Ordinary greeting substitution is unchanged. PromptManager's later prompt-only macro expansion, already documented in both READMEs, is unchanged.

## Implementation and verification plan

- [x] Reproduce on unmodified source with `python tests/browser-director-lab.py --f3-only --enable-third-party --f3-save-probe`. The pre-fix probe reads expanded text back from the real saved JSONL; a later first-message assertion fails too. Retain the failed report.
- [ ] Make the authorized source exception and delete the old snapshot/restore code, including start/end/stop/chat-change restoration.
- [ ] Keep the direct-save probe strict and assert its JSONL readback immediately, before any subsequent save can repair it.
- [ ] Add browser cases for overlapping dry runs, saves between their completions, structured-clone saves, a real TavernHelper edit during a paused dry run, chat switching during a paused dry run, and ordinary/chapter-marked greetings. Use promises and actual events rather than elapsed-time sleeps.
- [ ] Run the focused probe and affected Director node tests. Fix any failure before acceptance repetitions. Obtain an independent review of the actual diff.
- [ ] Commit source/tests, then run the final runner with both third-party extensions enabled three times using `--f3-only --enable-third-party --f3-save-probe`. Require all saves, JSONL reloads, and interleaving assertions to pass.
- [ ] Run `python tests/browser-director-lab.py` with default mode twice. Require all checks to pass, preserving the recorded two-extension isolation list. Do not substitute `--review-only`.
- [ ] Revalidate the existing adaptive streaming browser test because this repair touches its shared source file; retain its exact report. Do not run unrelated local suites.
- [ ] Publish sanitized results, final source hashes and a file list. The two authorized product files are an explicit exception to the old G5 documentation-only expectation. Keep the old failed reports as history.
- [ ] Normal push to `feature/director-followups`; verify the final commit's actual six-job CI. Leave merge to Opus's final review.

**Acceptance:** No captured save may contain an expanded Director first message; every probe must verify the stored JSONL, not only final in-memory state. Both extensions must actually load in G2. Genuine edits must persist after pending dry runs finish. No failed, cancelled or skipped run counts as an acceptance pass.
