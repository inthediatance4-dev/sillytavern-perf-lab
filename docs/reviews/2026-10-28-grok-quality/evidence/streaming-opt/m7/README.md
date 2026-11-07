# M7 rendering fallback

Command: `python tests/browser-streaming-equivalence.py --base ee771bb --optimized off --output docs/reviews/2026-10-28-grok-quality/evidence/streaming-opt/m7/equivalence.json` (Playwright Chromium in the local Linux lab).

[equivalence.json](equivalence.json) passes all seven generation cases: normal, stop, continue, swipe regeneration, reasoning, group, and impersonate. Final message HTML equals direct full formatting and the archived base; normalized memory and saved JSONL match. Stream token count and order match; message-received and character-rendered events occur once per message case. Impersonate keeps the chat unchanged and emits its own completion event once.

The loaded checkbox and setting are false. Every head case records zero coalesced frames and zero incremental patches. S2 follow-bottom stays enabled in both rendering modes. Independent timers produce small `.mes_text.innerHTML` write-count differences in normal send (11/12), swipe (13/14) and reasoning (32/31); continue is 13/13 and group is 12/12. This suite asserts final output and events, not exact wall-clock tick cadence.

Built-in extensions are enabled; unrelated third-party extensions are disabled on both products. The complete tab sequences differ by exactly `DIV#directorButton||interactable` (the intentional 🎬 button); removing that entry preserves the base order.

JSONL comparisons ignore `gen_started`, `gen_finished`, `send_date`, `create_date`, `date_last_chat`, `time_to_first_token`, `reasoning_duration`, `integrity`, and `gen_id`. The JSON report records the reason for each omitted runtime timestamp or generated identity and records matching JSONL and token-order hashes. Browser suites run locally; they are not included in `npm run test:perf`.
