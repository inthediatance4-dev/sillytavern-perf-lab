# Richtext Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Reduce longest main-thread block during rich character chat opening while preserving chat ownership and data.

**Architecture:** One owned task boundary after synchronous DOM construction; serial lifecycle cancellation propagated through character load and outer callers. Exported general redisplay remains unchanged.

**Tech Stack:** Browser JavaScript, Node20/24 native tests, synthetic localhost Playwright Chrome verification.

### Task1: Owned load scheduling

Files: public/script.js; optional focused public/scripts/utils/chat-load-ownership.js; new tests/chat-load-ownership.test.mjs; package.json test:perf list; ISOLATION.md. Root separately owns lab port/test8777 and browser measurements.

- [ ] Read all getChat/getChatResult, clearChat and await getChat callers; read existing transition tests/helpers and design contract. Preserve originals in external baseline before edits; notify root about added original files.
- [ ] Write behavior tests using actual source functions with controlled fetch/render/yield promises: ownership success, clear invalidation, samefile supersession, late response, stale terminal events, cancelled catch fallback, delayed focus, outer save suppression, retained realerror fallback and no scheduling in general redisplay.
- [ ] Run node --test tests/chat-load-ownership.test.mjs, save RED output externally; confirm intended behavioral failure, not harness/module-loading failure.
- [ ] Implement minimal serial owner and thresholded single task yield after printMessages, preserving existing successful API semantics and atomic message build. Guard all newly resumable work and outer open/save calls.
- [ ] Run new targeted tests and existing chat transition tests; self-review and fix. Save GREEN logs externally. Explicitly stage whitelist, git diff --cached --check, verify no labdata/dependencies/secrets, commit.
- [ ] Fresh independent spec review; fix and re-review before fresh quality review; fix and re-review. No browser/CPU benchmarking by subagents during root measurements.

### Task2: Integration and delivery (root)

- [ ] Repeated matched synthetic browser probes including heavy and longhistory. Compare full rendered HTML/IDs and bottom position; native prompt/doubletap/retry plus cancellation-boundary tests. Distinguish latency from longestblock; reject if contracts fail or no responsiveness gain.
- [ ] Full Node20/24 safe suite, original8workspace hashes and original.bak verification, all newsource syntax and staged secret/data whitelist check.
- [ ] Write candid report, patch/sourceZIP/standalonebundle, restore and byte-check every trackedfile. Preserve synthetic/evidence outside Git.
- [ ] Gracefully stop owned server/control matching PID/root/8777, verify process absent/freeport. Final independent review; deliver files/results/remaining limitations, no production deployment.
