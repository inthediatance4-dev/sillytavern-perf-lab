# Character Editor Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task.

**Goal:** Remove redundant create-draft initialization during selected-character editor population while preserving final UI and create behavior.
**Architecture:** Existing private menu preparation retains common residuals; internal default-true resetForm option gates the draft reset, selected-character caller disables it. No chat-load/message/scheduling changes.
**Tech Stack:** Existing browser JS/jQuery, actual source VM/DOM-state tests, Node20/24, fresh Chrome/Playwright on synthetic localhost8779.

### Task1: Single-pass source and regression tests

Files: public/script.js; tests/character-editor-flow.test.mjs NEW; package.json safe test:perf; ISOLATION.md. All originals backed up. Root separately owns scripts/start-performance-lab.mjs and tests/performance-lab.test.mjs port8778->8779; do not stage them.

- [ ] Read full select_selected_character/select_rm_create, setWorldInfoButtonClass, checkEmbeddedWorld, read_avatar_load and direct callers. Identify every inherited final residual; request root backup before any additional original file edit.
- [ ] Extract actual selected/create functions (and required unchanged helper source when practical) in a stateful DOM adapter. Run the base code from external baseline public/script.js.bak for reference state. Example contract: call selected on populated synthetic draft; assert no draft creator-note formatting or draft field write, selected formatting once, favorite/world/embedded helpers once, selected editor event only after all final values. Include default-create, group/switchMenu false and restoredraft/FileList contracts.
- [ ] `node --test tests/character-editor-flow.test.mjs` against unchanged functions must produce meaningful RED redundant-work failures, not harness missing names. Preserve task1-red.log; release async gates/close owned resources without deletion.
- [ ] Implement small internal option: `function select_rm_create({ switchMenu = true, resetForm = true } = {})`; `select_selected_character` passes resetForm:false. After existing avatar/menu shared preparation, branch false performs only shared inherited control residuals and returns. True path keeps old create behavior. Review repeated character_version value write and remove duplicate if verified. Update JSDoc, no public API addition.
- [ ] Add newfile to declared safe test:perf and document scope/limits in ISOLATION. Run new test + existing chat-load-ownership/chat-transitions/itemized-prompts-ownership/frontend-lifecycle/media-load-scroll tests. Preserve GREEN log, inspect syntax/diff/self-review.
- [ ] Explicit-stage only your four source/test/docs files; `git diff --cached --check`, name/data/secret whitelist, commit. Do not run browsers/full suites, install, delete or access server.
- [ ] Fresh spec then quality review; resolve blocking findings and re-review. Root user delegated routine isolated decisions, no new permission questions needed.

### Task2: Root measurement and delivery

- [ ] Baseline safe suite and own synthetic lab only. Native editor snapshots/create-draft-return/group-peek/defaults, exact messages/scroll/store and generation0. Matched3 pairs each for regular/heavy histories; verify source byte overlays and recorded work boundaries.
- [ ] Full safe Node20/24, actual output counts/digests/tested source hashes. Verify ten protectedroots11715/fivebacks; cached whitelist/secret/data check.
- [ ] Add truthful report, sourcecommit, source-onlyZIP/patch/standalonebundle and actual restore raw blob/SHA comparisons. Own PID/root/8779 normal shutdown; old data untouched and artifacts retained.
- [ ] Fresh final independent source/artifact review, completion verification, retain isolated branch. Deliver files, acceptance limits and next unresolved item.
