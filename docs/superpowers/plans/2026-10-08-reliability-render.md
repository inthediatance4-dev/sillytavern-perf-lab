# Reliability and long-history implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement each task sequentially, then fresh spec review and quality review. The user approved the recommended scope and delegated decisions; do not ask again for design approval.

**Goal:** Protect corrupt chat files and separate backups while reducing redundant long-history formatting work and fixing known local vector cardinality.

**Architecture:** Apply targeted functions to the tested isolated 1.18-based branch. Preserve current IO/lifecycle/recycle and frontend contracts. Use bounded backup scheduling, pure depth counting and batch-local vector lookup; do not wholesale replace latest upstream files.

**Tech Stack:** Node 20/24, Express, actual-file Node tests, source VM frontend tests, Playwright/Chrome artificial UI. No dependency installation or user profiles.

## Task 1 — header safety and degraded previews

Files: `src/endpoints/chats.js`, new `tests/chat-file-safety.test.mjs`.

- [x] Create fresh retained fixtures and run real router/function tests showing bad JSON/null/[]/primitive and BOM mismatch cannot overwrite; valid object/legacy/empty/missing and explicit force remain compatible. Assert bytes and error status on rejection. Existing fixture helpers in chat-lifecycle.test.mjs use synthetic DATA_ROOT/config and loopback port 0; do not copy destructive official afterEach.
- [x] Save RED log outside Git at F:/SillyTavern-Research/2026-10-08-reliability-render/task1-red.log.
- [x] Under current path locks, use stat and BOM-stripped parsing, rejecting nonempty non-object headers before the existing slug comparison. Add degraded last-line result excluding incomplete trailing row while preserving metadata/matcher/error/blank-line rules.
- [x] Cover search/recent/metadata and malformed tail cache invalidation as real-file tests; run targeted tests and existing recent/cache/lifecycle tests, preserve fixtures, save GREEN log. Inspect explicit staged files/whitespace and commit only these two files.
- [x] Fresh spec reviewer then quality reviewer; fix and re-review before Task 2.

## Task 2 — isolated bounded backup scheduling

Files: `src/endpoints/chats.js`, `src/endpoints/backups.js`, new small `src/chat-backup-scheduler.js` if necessary, new `tests/chat-backup-isolation.test.mjs`.

- [x] Real artificial files/HTTP: same user A/B/C distinct histories all get latest backup; same-character histories, two Chinese names, group histories and users do not share throttle/quota. Existing legacy backups remain byte-identical/listed, new backups downloadable. Prove leading/trailing latest snapshot, delayed writes, flush, capacity, error retry and no permanent deletion; save RED.
- [x] Use resolved history identity (Windows case normalization consistent with path locks) rather than only handle/cardName. Include a stable hash in quota prefix without breaking legacy/name-based backup-browser selection. Retain directory locking, atomic async writer, randomUUID, recycleOldChatBackups and exported shutdown flush.
- [x] Backup browser delete must share directory/file locks with writes/retention and recycleChatPath into its own backups .recycle, preserving original bytes. Test get/download/new and legacy files, invalid prefix, missing file, and delete recovery. No unlink/rm cleanup.
- [x] Bound retained scheduling states to 256; access cleanup at 60 seconds or safe capacity flush. Flush and await active/pending data before retirement. No per-key async overlap or unbounded latest snapshots. Direct overflow write is allowed if shutdown waits for it. Ensure rejected write can retry and does not poison scheduling.
- [x] Run real new tests plus lifecycle/IO and Task 1; GREEN logs and owned commits. Fresh spec then quality review with fixes before continuing.

## Task 3 — rendering depth calculation

Files: `public/script.js`, optional new small public helper, new `tests/message-depth.test.mjs`.

- [x] Save artificial browser baseline timings/profile before source changes, using synthetic retained fixtures only. Add reference algorithm tests for ids, system flags, holes if valid, transient negative and string ids, counts before/after edits and caller preservation; operation-count assertion must fail for full-map implementation.
- [x] Replace repeated full-history map/filter/findIndex allocation with pure suffix counting in formatting. Do not cache mutable global chat or change event/Markdown/regex/DOM contracts. Keep current undefined-depth behavior when target is not a normal eligible message.
- [x] Compare raw regex depth outputs and formatting results with reference, measure field reads for large N and visible last M. Browser artificial profile validates full message content, prompts, scrolling and switching; report uncertainty/remaining parse/plugin blocks. Run relevant frontend/transition regressions. Commit, spec then quality reviews.

## Task 4 — vector batch cardinality

Files: `src/endpoints/vectors.js`, new `tests/vector-batch-cardinality.test.mjs`.

- [x] Extract/execute actual getBatchVector with synthetic embeddings, proving two local backends 21 inputs must return 21 matching vectors; 0/1/10/11/21/large boundaries and ordering. Save RED of actual 63 outputs.
- [x] In each local embedding branch use `batch.map(x => sourceSettings.embeddings[x])`; keep unknown-source and remote branches unchanged. Missing embeddings retain existing values unless explicit API validation is separately reviewed.
- [x] GREEN tests and relevant original vector regressions, commit, fresh spec then quality reviews.

## Integration and delivery

- [x] Change own launcher/test expectation to port 8776, append meaningful new tests to test:perf, update ISOLATION and verification doc. No models/config/data/cache staged.
- [ ] Node 20 and 24 full suite, final real HTTP and browser contracts, inspect all staged/changed names and secret-like values; source-only local commit.
- [ ] Final independent review; source ZIP/diff/bundle with actual restored checkout and raw Git blob verification. Recheck seven prior workspaces and eight original backups.
- [x] Identity-bound stop of only owned lab. If already exited, record absence/free port and unavailable exit code accurately. Deliver files/results/limitations; no merge/push/deployment.
