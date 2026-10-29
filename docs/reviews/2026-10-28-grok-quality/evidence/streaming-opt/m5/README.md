# M5 — chapter metadata survives swipes

`markChapter` and `unmarkChapter` synchronize independent copies of `extra.director` into every existing `swipe_info[i].extra`, including missing slots for existing swipes. The chapter preset uses the same synchronization. Each swipe keeps its other extras. `MESSAGE_SWIPED` refreshes the chapter divider after the upstream DOM rebuild.

Upstream `syncSwipeToMes` restores the selected swipe's entire `extra`; all marked swipes now restore the same chapter. Swipe regeneration also preserves `extra.director`: `clearMessageData` removes specific generation/media fields, and `saveReply(type='swipe')` updates the existing extras before copying them into the new swipe.

Validation:

- `node --test tests/director-chapters.test.mjs`: 6 passed, including independent swipe metadata copies, a JSON roundtrip, and clearing every swipe on unmark.
- `/tmp/pw-venv/bin/python tests/browser-director-lab.py --base ee771bb --output docs/reviews/2026-10-28-grok-quality/evidence/streaming-opt/m6/director.json`: passed. The browser creates two swipes, marks a chapter, uses the real `swipe()` function to switch away and back, reloads the chat from disk, and checks metadata and the `第1章 手动章节` divider. Unmark clears both swipe records.

The full redacted result is [director.json](../m6/director.json), specifically `chapterSurvivesSwipeAwayBackAndDiskReload` and `markUnmarkArbitraryMessagePersistsWithoutNumber`. The Director browser suite also retains its chapter preset, deletion/renumbering, and 2000-message chapter jump checks. Node coverage runs through `test:perf`; Playwright acceptance is local only.

Files: `public/scripts/extensions/director/chapters.js`, `index.js`, `settings.html`; `tests/director-chapters.test.mjs`; `tests/browser-director-lab.py`; this README and the shared browser result.
