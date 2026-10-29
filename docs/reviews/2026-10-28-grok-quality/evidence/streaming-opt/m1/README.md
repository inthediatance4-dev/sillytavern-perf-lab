# M1 deferred paint races

Run locally with Python Playwright and Chromium:

```sh
python tests/browser-streaming-race.py
node --test tests/streaming-dom.test.mjs
```

[`races.json`](races.json) records the Chromium acceptance run. The browser suite
starts an isolated product server and the synthetic OpenAI endpoint. It pauses
the real `STREAM_TOKEN_RECEIVED` listener on the final provider content chunk
(finish and stop), or the eighth chunk (partial stop, failure, chat and swipe).
It submits that update through the real `StreamingProcessor.onProgressStreaming`
and holds only the processor's deferred frame callbacks and MessageChannel posts.

The suite triggers finish and stop after zero, one and two frames. A frame-zero
case retains the cancelled rAF callback; frame-one/two cases retain an actual
post-frame MessageChannel task. It then deliberately delivers the stale work.
Every case requires the final `.mes_text` to equal direct `messageFormatting`
immediately after the terminal action and after stale delivery, with zero later
text mutations. Finish also checks fenced code with its final copy controls and
keyboard attributes, so a delayed full write cannot silently erase decoration.

Additional cases stop a partial reply after zero/one/two frames, call the API
failure handler, switch to a real new chat, and select an existing alternate
swipe. Chat cases reuse the old numeric message id in the new chat and observe
both the old detached text node and the visible new node. The actual event is
`CHAT_CHANGED`, whose value in this fork is `chat_id_changed`.

The cross-platform Node suite evaluates the actual processor and Stopwatch
classes with controlled DOM, clocks and queues. Its 13 cases include cancellation
independent token checks, old MessageChannel delivery while newer work is
pending, and abandonment while reasoning processing awaits. It also proves M2's
first content and first reasoning writes occur before any frame and before the
initial Stopwatch interval, later updates coalesce, and M7 OFF uses the original
Stopwatch cadence with full synchronous writes and no MessageChannel.

`tests/streaming-dom.test.mjs` runs in `npm run test:perf` (CI). The Chromium
`tests/browser-streaming-race.py` suite runs locally and is outside that command.
