# Prompt Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task.

**Goal:** Prevent stale prompt reads/clears from corrupting cache or replacing stored inspection prompts.

**Architecture:** Prompt module reserves opaque request generations and distinguishes ready from unavailable cache. Character/group loaders pass ownership; clear captures cancellation state and refuses to reset newer cache/model after persistence. Existing save-as works for ready arrays.

**Tech Stack:** Browser JS/localforage, actual source VM tests, Node20/24, fresh Chrome/Playwright artificial IndexedDB only.

### Task1: Stateful prompt ownership and integration

Files: public/scripts/itemized-prompts.js; public/script.js; public/scripts/group-chats.js; tests/itemized-prompts-ownership.test.mjs (new); package.json; ISOLATION.md. Existing tests/chat-transitions.test.mjs, tests/chat-load-ownership.test.mjs, tests/media-load-scroll.test.mjs and tests/frontend-lifecycle.test.mjs may require VM dependency updates only. All originals backed up. Root separately owns localhost8778 lab launcher/test and browser evidence; implementer must not stage them.

- [ ] Read full relevant load/save/clear, getChat/getChatResult/getGroupChat, validateGroup, saveChatConditional and bookmark save-as callers. Inspect spec and baseline reproduction; notify root before editing any additional original file and back it up.
- [ ] Create actual prompt-state source harness by evaluating import-stripped module preamble and real functions; use deferred storage and event listeners. Example red contract: `const a=load('A'); const b=load('B'); resolveB(rowsB); await b; resolveA(rowsA); await a; assert.deepEqual(currentRows, rowsB); assert.equal(events.filter(x=>x.chatId==='A').length,0);`. Add close-pending preservation and late-clear/new-read contracts against actual clearChat too.
- [ ] Run `node --test tests/itemized-prompts-ownership.test.mjs` on old source, capture expected behavioral failures externally. Fix extraction/VM harness failures before treating RED as evidence. Then add prepared/failure/legacy/save-as/group cases as new behaviors are implemented.
- [ ] Implement minimal module request reservation, cancellation, validity and conditional reset API. Keep awaited rows local, check caller+generation before every state mutation/event/catch, separate read rejection from listener rejection. Cache ready only on complete successful read or legitimate no-id/neutral reset. Suppress saving unavailable cache; preserve legitimate ready save-as and started old snapshot saves.
- [ ] Integrate reservation before character greeting save and before group async preparation; check late group ownership before prompt read starts. Main clear captures serial/prompt token, invalidates synchronously, saves only ready data, clears only if still owner; getChatResult/group stop false continuation. No rendering changes. Recover readiness by successful retry and document failed-read unpersisted inspection limit.
- [ ] Update existing VM dependencies without weakening assertions. Run new test plus `tests/chat-load-ownership.test.mjs`, `tests/chat-transitions.test.mjs`, `tests/media-load-scroll.test.mjs`, `tests/frontend-lifecycle.test.mjs`. Save RED/GREEN logs, syntax checks, self-review. Explicit stage whitelist, cached check/name list/no data/deps, commit.
- [ ] Fresh independent spec review then quality review, fix and re-review each blocking finding before root acceptance. Implementer no browser benchmarks/full Node20/24 runs/production access/cleanup.

### Task2: Bounded native recent-group cancellation follow-up (2026-10-09)

Files: public/scripts/group-chats.js; public/scripts/welcome-screen.js; tests/itemized-prompts-ownership.test.mjs; this plan/spec and ISOLATION.md. Root backed up welcome-screen.js before the added scope; baseline registry now contains 12 original backups. No new public API, rendering scheduling, prompt format or production changes.

- [x] Reproduce the native canceled IndexedDB group read: getGroupChat returns false but openGroupById reports true, so welcome activates/saves/opens history and clears HOME again. Inspect legacy same-selected-group false compatibility and direct callers.
- [x] Add actual-source prompt/group/welcome tests first. Preserve task2-red.log with 41 tests, 31 pass and 10 assertion failures, zero cancellations/timeouts; retain aborted/harness-timeout exploratory logs separately and do not count them as RED evidence.
- [x] Propagate canceled getGroupChat, protect awaited opening clears with an internal serial invalidated by reset/newer group entries, and recheck group object/file/metadata before selection. Recheck the group load owner after rendering/events so stale completed loads cannot report success.
- [x] Stop stale recent-group continuation using its own entry serial, original group selection/object/file and live saving/generation guards. Keep legacy already-selected false compatible with another history in that same group; do not accept every false.
- [x] Verify 159 targeted tests across prompt ownership, chat ownership/transitions, media scroll and frontend lifecycle. Preserve task2-green.log separately. Normal CHAT_CHANGED/GROUP_CHAT_CREATED listeners may replace metadata without cancellation.
- [x] Stage only six listed files after syntax, whitespace, staged-name/data/secret checks; commit the bounded change. Root separately performs browser/full-suite acceptance and independent reviews.

Limit: this suppresses outer canceled/stale continuation, with post-render and final owner checks. It does not roll back already-running group greeting/render/extension effects or cover unrelated direct history/generation/delete races.

### Task3: Root acceptance and delivery

- [ ] Run synthetic real IndexedDB delayed-read/close/retry/reversed-read browser contracts and existing native navigation/inspection contracts. Preserve canceled store contents and late-event absence. Check final model/HTML/IDs/scroll and synthetic source body/order/integrity. Do not advertise CPU/performance gains from this correctness fix.
- [ ] Run full declared safe test suite on Node20/24; inspect complete outputs/counts/source hashes. Verify nine protected workspaces/10519 files and12 .bak against original Git; cached staged whitelist/secrets/data exclusion.
- [ ] Add validation report, commit source/docs, sourceZIP/patch/fullbundle and actual restore byte/blob checks. Preserve all failed experiments outside Git. Stop only owned lab gracefully and prove PID/port absent.
- [ ] Final independent artifact/report review and fresh completion verification. Keep isolated branch/worktree; deliver file links, verified results, unverified boundaries and remaining issues.
