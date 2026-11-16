# G1: bundled third-party extensions

The earlier description “unrelated extensions” is withdrawn: both extensions have save or chat mutation capabilities. Static paths establish a risk, not the cause of the earlier failed run.

| Name | Version | Author | Repository source directory | Upstream | Actual entrypoint |
| --- | --- | --- | --- | --- | --- |
| 酒馆助手 | 4.9.1 | KAKAA | `public/scripts/extensions/third-party/JS-Slash-Runner` | https://github.com/N0VI028/JS-Slash-Runner | `dist/index.js` |
| 记忆增强表格 | 2.2.14 | muyoo | `public/scripts/extensions/third-party/st-memory-enhancement` | https://github.com/muyoou/st-memory-enhancement | `index.js` |

These are the versions in the bundled manifests, not a claim about the latest upstream releases. `extension-source-sha256.json` identifies the files inspected.

## 记忆增强表格

Here `M` means its repository source directory from the table.

- `M/index.js:978` registers `CHAT_COMPLETION_PROMPT_READY` → `onChatCompletionPromptReady` (`543–578`). Its normal path calls `initTableData` (`181–185`) and `getTablePrompt` (`192–193`); the step-by-step path (`546–560`) calls `getTablePrompt` before the normal dryRun guard (`564`). Thus this extension can run during generation.
- `M/core/manager.js:271–275`: `getReferencePiece` → `getLastSheetsPiece`. An old `chat[i].dataTable` (`262–266`) can enter `convertOldTablesToNewSheets` (`95–139`), then `sheet.save(targetPiece)` (`108`, `134`). `M/core/table/sheet.js:192,208–211` mutates `targetPiece.hash_sheets[uid]` and calls `USER.saveChat()` unless `manualSave` is true.
- The no-table path (`M/core/manager.js:249,269`) can reach `initHashSheet` (`292–299`) → `buildSheetsByTemplates` (`82,88`) → `USER.saveChat()`.
- `USER.saveChat` (`M/core/manager.js:33–58`) calls `saveGroupChat` for groups or `APP.saveChat` otherwise. `M/services/appFuncManager.js:1,22` imports and exposes the upstream `saveChat` directly. These are real save paths, not just debounced conditional saves.
- `CHAT_CHANGED` and `MESSAGE_DELETED` (`M/index.js:979,982`) reach `onChatChanged` (`723–738`), which looks up tables and can initialize missing ones; this handler has no early `isExtensionAble` return. Render/edit/swipe handlers (`977,980–981`) also touch sheet state, although their direct `sheet.save(piece,true)` suppresses that particular save.
- `replaceTableEditTag` (`M/index.js:506–520`) can write `mes` and the current swipe, then call `ctx.saveChat()`. No in-repository caller was found, so this is a capability, not evidence it ran during the failed check. External adapter success paths (`M/external-data-adapter.js:217–222,283–288`) also save.

## 酒馆助手

Here `J` means its repository source directory from the table. Source findings were cross-checked against the manifest's actual bundled `dist/index.js`.

- `J/src/function/chat_message.ts:268–272,306–310,558–564,596–606` can change `mes`, swipes and swipe metadata; `setChatMessage` awaits `saveChatConditional`. Refresh paths (`172–197`) save immediately or via `J/src/util/tavern.ts:68`, a 1-second debounced `saveChatConditional`. Creation/rotation APIs (`379,479–480`) splice the chat array. These APIs are exposed through `globalThis.TavernHelper` (`J/src/function/index.ts:299–300,477–478`).
- Generation cleanup (`J/src/function/generate/utils.ts:175–180`) deletes temporary extension prompts and schedules a debounced save. `responseGenerator.ts:588–590` runs cleanup in finally; its streaming error path (`115–120`) schedules a save as well. These paths do not by themselves prove a `mes` rewrite.
- `J/src/panel/render/macro_like.ts:104–114` registers generation-data/settings events; `15–47` rewrites outgoing prompt content/text. Its render handlers (`121–136`) operate on DOM. The enable toggle (`94–100`) can call a reload helper (`J/src/util/tavern.ts:70–89`) that saves before rerendering.
- The actual minified bundle imports `saveChatConditional` as `De` (`dist/index.js:1`), defines `_.debounce(De,1e3)` (`73`), changes current `mes`/swipes and calls `await De()` (`650`), cleans prompts and invokes the debouncer (`652`), and invokes it on streaming error (`658`). No direct import/call of `saveChat` was found in this bundle.
- A `window.fetch` wrapper in the bundle will appear as the first frame of observed saves; that frame alone does not mean this extension initiated the save.

## Isolation and scope

G2 starts fresh synthetic data with both extensions enabled. Reports record an empty disabled-extension list, both successful entrypoint loads, and the exposed TavernHelper object. The checks cover literal first narration/comment after quiet generation, ordinary generation's automatic save, saved JSONL reads, and reloads. G4 retains the default fixture isolation of these two third-party extensions. No third-party code, user data or upstream `Generate` is edited.
