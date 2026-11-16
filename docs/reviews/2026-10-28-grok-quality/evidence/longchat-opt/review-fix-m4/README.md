# Merge blocker 4: spread edge semantics

Completed review section III item 4 only, starting at `8c0c939b38f5f8e480f0d7081890865a5a38954e` on `opus-longchat`. Extended `tests/longchat-spread.test.mjs`, already registered in `test:perf`, with **32 browser-free tests: empty and single-element operands at each of the 16 retained call sites across eight product files**. The P1-1 count was 19; M1 reverted three JS-Slash-Runner sites, which are excluded here.

No product mismatch was found, and no product code or package script changed. The existing six tests remain, including 300,000-element checks and the aliased `saveReply` swipe case.

## Coverage inventory

The original expressions below were checked against the P1-1 product diff from `b1cf0e9` to `f6c0053`. Each row corresponds to two named tests in the logs. Tests read the current product source directly; they do not copy the replacement loop/reduce into the test.

| # | Product site | Original operation | Tested behavior / extraction |
|---|---|---|---|
| 1 | `keyboard.js` / `initializeInteractables` | `makeKeyboardInteractable(...interactables)` | Whole keyboard module; empty return/no controls, singleton tabindex `0`, parity with exported variadic call. |
| 2 | `keyboard.js` / `registerInteractableType` | `makeKeyboardInteractable(...interactables)` | Whole module; NodeList-like iterable at both sizes; same return, tabindex and class as variadic call. |
| 3 | `script.js` / `StreamingProcessor.finalizeIntermediaryMessage`, payload | `message.swipes.push(...this.swipes)` | Extract actual append statement; preserve existing entry, array identity and singleton object identity. |
| 4 | Same method, metadata | `message.swipe_info.push(...swipeInfoArray)` | Extract actual append statement; unchanged destination for empty input, same singleton metadata reference. |
| 5 | `script.js` / `saveReply`, payload | `item.swipes.push(...swipes)` | Extract actual append statement; same checks as #3. |
| 6 | Same function, metadata | `item.swipe_info.push(...swipeInfoArray)` | Extract actual append statement; same checks as #4. |
| 7 | `script.js` / `getChat`, loaded history | `chat.splice(0, chat.length, ...data)` | Extract contiguous clear + loop; empty clears stale history, singleton replaces it, preserving chat and message identity. |
| 8 | `script.js` / `getFirstDisplayedMessageId` | `Math.min(...allIds)` | Whole function; empty is `+Infinity`; singleton finite, NaN-filtered, signed-zero and infinity values match spread. |
| 9 | `scripts/chats.js` / `restoreNeutralChat` | `chat.splice(0, chat.length, ...neutralChatData)` | Whole function; same empty/single replacement, chat identity, metadata reset and storage cleanup. |
| 10 | `scripts/chats.js` / assistant-note import | `chat.splice(0, chat.length, ...messages)` | Extract contiguous clear + loop; same replacement and identity checks as #7. |
| 11 | `scripts/group-chats.js` / `getGroupChat` | `chat.splice(0, chat.length, ...data)` | Extract contiguous clear + loop; same replacement and identity checks as #7. |
| 12 | `scripts/openai.js` / `MessageCollection.flatten` | `acc.push(...message.flatten())` | Whole classes; empty/single nested collection, original message identity, preserved prefix/suffix, empty root returns the shipped `[]` reduce seed. |
| 13 | `scripts/openai.js` / `ChatCompletion.getChat` | `chat.push(...item.getChat())` | Whole classes; empty/single nested chat, same serialized fields, preserved prefix/suffix, empty root returns `[]`. |
| 14 | `scripts/power-user.js` / `applyStylePins` | `pinsElement.append(...Array.from(styleTags))` | Actual append statement against NodeList-like iterable plus whole function; empty append preserves existing child, singleton moves the original node. Whole-function empty guard creates no pins. |
| 15 | `scripts/swipe-picker.js` / `openSwipePicker` | `listContainer.replaceChildren(...swipeBlocks)` | Extract actual fragment creation, append loop and replacement; one replacement, removal of stale children, singleton node identity/parent, drained fragment. |
| 16 | `scripts/extensions/expressions/index.js` / `visualNovelUpdateLayers` | `Math.max(...imagesWidth)` | Extract and evaluate the shipped reduce expression with `-Infinity` seed; empty and singleton finite, NaN, signed-zero and infinity values match spread. |

For #3–6, surrounding guards normally skip empty swipe arrays. #10 prepends an assistant note before replacement; #11 guards on nonempty history. These tests deliberately supply empty operands directly to the extracted statements to check their semantics independently of those guards. The empty `getChat` operand corresponds to header-only loaded data. #16 evaluates the extrema expression independently of its layout-width guard. This is operand-level unit coverage, not a browser or loader integration test.

An empty **append** leaves the destination unchanged. The original whole-history **replacement** splices delete `chat.length` entries, so empty input must clear stale history while retaining the array object. Likewise, `replaceChildren(...[])` clears existing children; it is not an append no-op. The tests preserve these distinctions. The displayed-ID minimum tests also retain the original NaN filtering before `Math.min`; the expression-width maximum propagates NaN.

The DOM fixture models child moves and DocumentFragment consumption only. The actual style function and the changed swipe-picker block execute in `vm` with that fixture; no browser is required. Source extraction asserts that anchors exist and are unique, so a removed or moved replacement cannot silently turn the check into an empty execution.

## Validation

Each version ran the complete spread test file once, sequentially, with no failures, retries, cancellations, skips or discarded results. [validation.json](validation.json) records commands, versions, source hashes and raw summaries. This is functional validation; durations below are test-run durations, not performance A/B measurements.

| Runtime | Passed / total | Failed / skipped | Runner duration | Raw output |
|---|---|---|---|---|
| Node 20.19.2 | 38 / 38 | 0 / 0 | 1536.11 ms | [TAP](node20.tap) |
| Node 22.20.0 | 38 / 38 | 0 / 0 | 1484.58 ms | [TAP](node22.tap) |
| Node 24.22.1 | 38 / 38 | 0 / 0 | 1499.44 ms | [Spec](node24.txt) |
| ESLint 8.57.1, changed test file | 1 file | 0 diagnostics | — | [Log](eslint.txt) |

Total: 114 passing test executions, including 96 new edge-case executions. `git diff --check` also passed. The updated file is deterministic and browser-free; its existing `test:perf` registration needs no change. No broad suite or browser/performance lab was run for this unit-test-only step.

The final audit initially failed its whole-file `public/script.js` hash assertion because concurrent M2 work changed P3 preparation/navigation code after the matrix. The recorded test-run hash matches starting HEAD. Inspection confirmed that all four scopes exercised from that file (`getChat`, `getFirstDisplayedMessageId`, `saveReply`, `StreamingProcessor`) remain byte-identical to starting HEAD, as do all other recorded source files. [final-checks.txt](final-checks.txt) and validation JSON retain that audit failure and the scoped comparison; no test failed or was rerun. Concurrent M2/M3 product, test and evidence changes were left untouched.

The environment's default `node` actually resolved to Node 24, so all three runs used explicit binaries under `<tmp>`, including the installed Node 22 binary. Node 24 auto-selected the spec reporter; its original output is retained as `.txt`, without rerunning merely to change the reporter. These are the only execution adjustments.

No old product tree was materialized: historical operation text was inspected with read-only Git diffs, and tests compare current extracted product code with the original spread operations. No A/B run, worktree, checkout, stash, reset, ref change, commit or push was needed. No server or browser was started. Evidence contains no hostname or absolute machine paths; command paths use `<tmp>`. All artifacts are small plain text, so gzip is unnecessary. Unrelated concurrent work was left untouched.

**M4 acceptance is met for all 16 retained sites.** No product semantic fix or scope deviation was required; other blockers and merge work remain outside this step.
