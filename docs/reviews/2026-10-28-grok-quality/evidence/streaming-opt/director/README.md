# Director browser suite (D3)

Source of truth: `tests/browser-director-lab.py`.

```
python tests/browser-lifecycle-lab.py --director --output docs/reviews/2026-10-28-grok-quality/evidence/streaming-opt/director/browser.json
```

`--director` runs that same file. The default lifecycle command is unchanged. The lab starts `scripts/fake-openai-endpoint.mjs` itself, on a free port, with an isolated data root.

Run recorded in `browser.json` (Node v24.22.1, Chromium 156.0.8078.4, base `ffd5f4e`):

- 30/30 checks passed, `pageErrors` empty, 5 generation requests.
- Disabled extension: left-row and chat DOM match the base snapshot. The only added tab stop when enabled is `#directorButton`.
- Narrator matches `/sys` except `extra.director`. Comment is in the chat and absent from the next request. Instruct adds no message, appears once, and is absent from the request after that. `autoGenerate` off sends nothing; on sends one request.
- Digit `1` with the popover closed inserts only `1`. Custom presets survive reload. Restore defaults works. `/director 1 三天` inserts `——三天后——`.
- Chapters: preset title is the first `{{input}}` value, with no stored number. Mark and unmark an arbitrary message. Deleting a middle chapter renumbers the dividers. A 2000-message chat loaded 100 messages; jumping to chapter 1 confirmed `需要加载约 1900 条消息`, cancel left it unloaded, then load scrolled to `第1章 开端`.
- Group chat: narrator, comment, and one-shot instruct. The narrator text was in both generation bodies; the comment was in neither; the instruct was only in the first.

The page reload after restore defaults leaves the API disconnected because auto-connect is off. The group stage connects again before it generates.
