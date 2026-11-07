# M6 — Director instruction consumption

A Director instruct preset is consumed only after a successful completed generation whose assembled request included its text. API failure and user stop keep it for retry. Pending instructions remain in the current chat's script injections; successful consumption is saved before auto-continue can prepare another request. Settings help documents this rule.

Director creates its upstream `/inject` with `ephemeral=false` and owns its `directorEphemeral` marker. Other `/inject ephemeral=true` commands retain their upstream end/stop behavior. A new `GENERATION_COMPLETED` notification runs only in successful generation paths, including quiet and structured output; aborted streams do not notify. The observer matches the exact assembled request object, chat metadata object, chat ID, and injection object captured before that request. Dry runs, excluded/replaced instructions, and switched chats cannot consume a pending instruction.

Commands and results:

- `node --test tests/director-instruct.test.mjs tests/director-chapters.test.mjs tests/fake-openai-endpoint.test.mjs`: 11 passed. Lifecycle tests cover failed/stopped attempts, success, dry run, excluded/removed instructions, replacement injections, switched chat, ordinary injections, and duplicate notification.
- `npx eslint public/scripts/extensions/director/index.js public/scripts/extensions/director/chapters.js public/scripts/extensions/director/instruct.js public/scripts/events.js public/script.js scripts/fake-openai-endpoint.mjs`: passed.
- `/tmp/pw-venv/bin/python tests/browser-director-lab.py --base ee771bb --output docs/reviews/2026-10-28-grok-quality/evidence/streaming-opt/m6/director.json`: passed, 34 checks, 12 generation requests, no page errors, Chromium 156.0.8078.4, Node v24.22.1.

The [redacted browser result](director.json) proves:

1. An actual configured HTTP 500 leaves the instruction pending; the retry request includes it. Successful retry consumes it, disk reload does not restore it, and the following request omits it.
2. Stopping an active stream leaves its instruction pending; the next successful streaming request includes it, and the following request omits it after disk reload.
3. An ordinary upstream ephemeral injection still clears on user stop.
4. Existing one-shot, auto-generation, narrator/comment prompt, and group-chat behavior passes.

`scripts/fake-openai-endpoint.mjs` adds a local fixture-control endpoint with one-request HTTP failure and reply/rate configuration. Its node coverage verifies that a configured 500 affects exactly one request and preserves request records. The node lifecycle tests run in `test:perf`; the full Director Playwright suite is local acceptance only.

Files: `public/script.js`; `public/scripts/events.js`; `public/scripts/extensions/director/instruct.js`, `index.js`, `settings.html`; `scripts/fake-openai-endpoint.mjs`; `tests/director-instruct.test.mjs`, `tests/fake-openai-endpoint.test.mjs`, `tests/browser-director-lab.py`; the `test:perf` entry in `package.json`; this README and `director.json`.
