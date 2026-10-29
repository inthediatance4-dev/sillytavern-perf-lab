# M3 final evidence index

All M1–M7 product fixes are implemented. Functional evidence is complete. M2’s first-paint and finish requirements pass; the original plan’s ≥50% reduction in >33 ms frame share is **not reproduced** by the final measurements (27.02% lower; interval spans zero). This index does not claim full original performance acceptance.

## Final HTML, saved data and events

The final optimized-ON [equivalence.json](../m2/equivalence.json) compares the worktree to a `git archive` of `ee771bb`. Each non-impersonate case compares final `.mes_text.innerHTML` both to direct `messageFormatting` of that same final text and to base HTML. Code-copy controls receive the same final decoration before comparison. The report records identical HTML hashes, normalized JSONL hashes, and stream-token sequence hashes.

| Case | HTML direct / base | Memory / JSONL equal | STREAM_TOKEN_RECEIVED | MESSAGE_RECEIVED / CHARACTER_MESSAGE_RENDERED |
| --- | --- | --- | --- | --- |
| normal | yes / yes | yes / yes | 87 / identical order | 1 / 1 |
| stop | yes / yes | yes / yes | 8 / identical order | 1 / 1 |
| continue | yes / yes | yes / yes | 87 / identical order | 1 / 1 |
| swipe | yes / yes | yes / yes | 87 / identical order | 1 / 1 |
| group | yes / yes | yes / yes | 87 / identical order | 1 / 1 |
| reasoning | yes / yes | yes / yes | 238 / identical order | 1 / 1 |
| impersonate | textarea equal; chat unchanged | yes / yes | 87 / identical order | 0 / 0 |

Tokens are retained in their original event order for comparison; count and SHA-256 of the complete ordered text sequence must match. Both final message events occur exactly once in every message-generation case. Impersonate changes only the textarea, leaves chat data unchanged, and emits `IMPERSONATE_READY` once instead of those message events.

Saved JSONL is fetched from the real chat-file API and compared as canonical parsed records, including swipes and extras. The only omitted runtime fields, recursively including swipe info and the chat header, are:

- `gen_started`, `gen_finished`, `send_date`, `create_date`, `date_last_chat`: wall-clock generation/message/header/recency values.
- `time_to_first_token` and `reasoning_duration` (including `extra`): measured wall-clock durations. Reasoning body HTML still compares exactly.
- `integrity`: random save UUID, not a content digest.
- `gen_id`: time/random group batch identifier.

No message text, swipe text, reasoning text or other output field is ignored. The initial fixture seeds identical Author’s Note defaults in both headers to remove an extension-startup race; no ignore was added for that metadata. Per-field reasons are also in the equivalence JSON.

## Stop, continuation, swipes and smooth mode

The table above covers actual stop, continue, swipe regeneration, group, reasoning and impersonation paths. The final [14-case race run](../m1/races.json) adds finish/stop at 0/1/2 frames after the final provider chunk, partial stops at 0/1/2 frames, failure, real chat changes and existing swipe changes. Every case reports exact direct formatting before/after stale callback delivery and zero late `.mes_text` mutations. Cancelled frames and retained MessageChannel tasks are deliberately delivered; final code-copy controls survive.

[Optimization OFF](../m7/equivalence.json) preserves final/direct/base HTML, normalized data and event sequences with zero coalesced frames and incremental patches. The actual-class node tests additionally prove no MessageChannel is created and the upstream Stopwatch/full synchronous write cadence is retained. S2 follow-bottom remains enabled in both modes. Browser tick counts are documented rather than asserted equal under independent timers.

[Default-speed smooth equivalence](../m4/equivalence.json) passes the same seven generation cases. The [M4 smoke](../m4/README.md) retains four healthy samples at speed 50, including the backlog through final paint. Its one measured pair is a harness-health check and supports no statistical smooth-performance claim.

## Focus order and short-chat performance

The complete default chat-view tab sequences are in the ON/OFF equivalence JSON (settings panels closed). Base has 13 entries and head has 14. Removing exactly `DIV#directorButton||interactable` restores the base sequence; 🎬 beside the extensions menu is intentional.

The [100-message × 500-token comparison](../m2/ab-main-short/comparison.json) has ten runs per side. No required short frame/typing/first-paint/finish metric significantly regresses. First paint is −52.34 ms, CI [−70.21, −9.29]; typing p95 is −11.65 ms, CI [−141.10, −7.00]. Finish is +94.90 ms, CI [−41.65, +162.90], so its higher point estimate remains uncertain. See the [M2 tables](../m2/README.md) for every required metric and the complete primary and pooled main results.

## CI versus local acceptance

`npm run lint` passes. `npm run test:perf` passes **835 tests, 8 skipped, 0 failed**. The command includes the new cross-platform node suites `streaming-dom.test.mjs` (13 cases), `streaming-measurement.test.mjs` (4), `director-instruct.test.mjs` (2), and the extended chapter/fake-endpoint tests, alongside the existing performance tests. Native Windows-only checks account for skips in this Linux run.

Playwright runs locally in the isolated Chromium/Linux lab: optimized ON/OFF equivalence, smooth equivalence, streaming races (14), and the [Director suite](../m6/director.json) (34 checks). They are **outside** `test:perf` and are not claimed as CI jobs. The benchmark commands also run locally. All benchmark labs exited 0 and removed owner locks. Remote CI and Windows manual checks remain for the orchestrator/user.

[validation.json](validation.json) records final source hashes, commands, suite counts, artifact hashes, privacy checks and the explicit original frame-tail acceptance exception. It verifies that all three measurement invocations match the final timed source files. The M5 [chapter proof](../m5/README.md) and M6 [instruction lifecycle proof](../m6/README.md) link to the saved swipe/retry browser checks.
