# M5 — chapter metadata survives swipes (including new swipe after mark)

`markChapter` / `unmarkChapter` synchronize independent copies of `extra.director` into every `swipe_info[i].extra`. Swipe regeneration preserves `extra.director` through `clearMessageData` + `saveReply(type='swipe')`.

## Opus confirmation (pre-merge)

1. **Mark → generate NEW swipe → switch to it → reload:** covered by node test `a chapter survives a newly regenerated swipe and reload, then unmark stays clear after reload` (executes real `saveReply` / `syncMesToSwipe` / `clearMessageData` / `syncSwipeToMes` from `public/script.js`) and browser check `chapterSurvivesNewSwipeGenerationAndDiskReload` (real `swipe()` regenerate after mark, then disk reload).
2. **Unmark clears ALL swipes → reload still clear:** node same test; browser `unmarkClearsExistingSwipesAfterDiskReload` and `unmarkClearsGeneratedAndOriginalSwipesAfterDiskReload`.

Also retained: pre-existing swipe away/back + reload (`chapterSurvivesSwipeAwayBackAndDiskReload`).

Validation this round: `node --test tests/director-chapters.test.mjs` 7/7; `/tmp/pw-venv/bin/python tests/browser-director-lab.py --base ee771bb --output …/m5/director.json` exit 0 (see director.json).
