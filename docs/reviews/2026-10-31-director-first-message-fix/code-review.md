# Independent source review

Reviewed change: the authorized Generate guard and removal of Director's late restoration, together with the first-message browser regressions. Product changes are committed in `9d592a6d1f7f44d1a87f12cbee57513245142de2`; review compared the working diff with `5e0276b`.

No product-code blocker was found.

- The source guard prevents the temporary mutation itself. It does not depend on save order, lifecycle counters, serialization overrides, or message accessors.
- Every old first-message snapshot/restore hook was removed, so a later dry run cannot restore stale text over an actual API edit or another chat.
- Ordinary first greetings keep the old substitution path. Chapter-marked first messages follow the same Director exception already used by messageFormatting.
- The browser regressions use actual Generate dry runs, raw saveChat, server JSONL reads, structured-clone snapshots and actual TavernHelper.setChatMessages when that extension is enabled.
- The overlap helper's enabled flag prevents an already-captured listener from starting a new pause after cleanup begins.
- Reading save response bodies still waits for save completion and avoids the old Python Response.finished teardown task warning.
- Later prompt-only macro reevaluation remains the behavior documented in the READMEs; this fix does not change PromptManager.

A nonblocking test recommendation was to verify that enabled-extension evidence really used TavernHelper rather than the full-suite fallback. The final evidence validation explicitly requires `f3Interleavings.editor == 'TavernHelper.setChatMessages'` in all three G2 reports, in addition to both loaded entrypoints and an empty third-party disabled list.

The reviewer performed source review and diff checks only. Browser repetitions and CI are independently recorded in the final results; this note does not substitute for those gates.
