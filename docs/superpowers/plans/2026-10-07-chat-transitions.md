# Chat Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Eliminate redundant history navigation work and repeated recent-summary reads, while retaining chat integrity and keeping production unchanged until explicitly authorized.

**Architecture:** Add a targeted option to the existing character selection path and reuse its normal chat-open/persistence operations. Add a stat-validated bounded in-memory cache used only by /recent. Generate a separate minimal original-source variant for future production review.

**Tech Stack:** Existing ESM JavaScript, Node 20/24, node:test, fs, Express and local artificial-data Chrome/Playwright; no new dependency.

**Design:** ../specs/2026-10-07-chat-transitions-design.md. Evidence lives at F:/SillyTavern-Research/2026-10-07-chat-transitions. Branch begins at b14fefec7a7b50cdcbf22b987c797ef3960a7fa9.

### Task 1: Direct recent-character navigation

Files: modify public/script.js selectCharacterById and public/scripts/welcome-screen.js openRecentCharacterChat; create tests/chat-transitions.test.mjs. No group or plugin changes.

- [ ] Write a source-execution regression harness extracting the actual functions via vm, following tests/frontend-lifecycle.test.mjs. Stub getChat/openCharacterChat to record the character/filename and awaited events, not substitute the selection or welcome orchestration. Include this central behavioral assertion:

```js
await context.openRecentCharacterChat('target.png', 'history');
assert.deepEqual(loads, [{ id: 1, file: 'history' }]);
assert.deepEqual(events, ['history']);
```

Use two character records, the target starting with chat 'default'; setCharacterId updates context.this_chid, unshallowCharacter can replace the record, getChat records and emits one chat-changed entry, openCharacterChat implements its normal filename/load/persistence boundary behavior. Original code must fail because loads contains both default and history. Record RED output in evidence.
- [ ] Run `node --test tests/chat-transitions.test.mjs` before implementation; expect the duplicate-load assertion to fail.
- [ ] Add optional chatFile to selection. Compute targeted mode only when the option is explicitly supplied; refuse empty/non-string target and blocked generation/save before clearing. Preserve ordinary selection without this option. Unshallow the selected character before testing or setting its default filename. Use existing getChat when the requested chat is already the default and the character is newly selected, and openCharacterChat for a different requested file; do not perform both. For an already selected character, open only when requested id differs from getCurrentChatId. Return successful acceptance for targeted mode, failure on guards; ordinary callers retain prior semantics. Recheck active id after awaited preparation so stale work cannot write another character.

The welcome call becomes:
```js
const opened = await selectCharacterById(characterId, { chatFile: fileName });
if (!opened) return;
setActiveCharacter(avatarId);
saveSettingsDebounced();
```

Place a module-scope recent-character navigation flag around this try/finally; repeated calls while true return, and finally always clears it. Remove the old second openCharacterChat from this caller. Do not remove its import if other welcome operations still use it.
- [ ] Add tests for invalid/saving/generating guards, shallow refresh, legacy switchMenu, default target, same-character different/same filename, selected-group reset, persistence, stale preparation, rejected selection and settings, double tap and retry after failure. Run the targeted file and frontend-lifecycle tests. Record GREEN output, inspect diff, stage only these three files, `git diff --cached --check`, commit.
- [ ] Fresh independent spec review, then fresh quality review; fix/re-review before Task 2.

### Task 2: Recent metadata cache

Files: create src/chat-info-cache.js; modify src/endpoints/chats.js only import/cache instance and /recent reader calls; create tests/recent-chat-info-cache.test.mjs. No general reader/search/write changes.

- [ ] Build a real Express /recent fixture harness following tests/performance-lab.test.mjs with fresh .fixtures path and artificial cards/chats/groups. Patch fs.createReadStream only to count reads inside this fixture, restoring it in finally. First test posts twice and asserts identical nonempty result and zero extra streams on the second request. Original code fails this read-count assertion. Save RED output.
- [ ] Implement createChatInfoCache with injected readInfo, optional stat/now/limits for deterministic tests; defaults read fs.promises.stat with bigint timestamps. Key path and metadata mode; collect fresh file signature before every hit. On a miss read, stat again, and retain only equal signatures. Use a bounded Map of pending version records to coalesce equal signatures; identity-check cleanup so a replaced pending record survives older completion. Read uncached when the pending limit is reached. Maintain LRU entry ordering, absolute expiry and estimated byte counters. structuredClone inputs and results. Oversized/invalid snapshots are returned without storing. Catch failures only to clean the current cache/pending state, then rethrow. No disk write or timer.

Endpoint integration:
```js
import { createChatInfoCache } from '../chat-info-cache.js';
const getRecentChatInfo = createChatInfoCache((file, metadata) => getChatInfo(file, {}, metadata));
```

Only within /recent replace the two getChatInfo calls with getRecentChatInfo, preserving their path, annotations and metadata argument.
- [ ] Execute targeted tests. Add real rewrite/atomic replacement invalidation, stable identity/metadata/user separation, mutation/annotation isolation, failure/retry, read-time writes, concurrent versions/waiters, LRU/TTL/estimated bytes/oversized/in-flight bounds and order/pins/group regression checks. Fixtures and copies remain retained; simulated delete means move to fixture .recycle, never unlink. Record GREEN output, stage only these three files, cached check, commit.
- [ ] Fresh spec review followed by fresh quality review; resolve all issues before integration.

### Task 3: Isolated verification and original-version package

Files: modify scripts/start-performance-lab.mjs (port 8775), tests/performance-lab.test.mjs (corresponding expected port), package.json test:perf (append both new files), ISOLATION.md (new results and boundary); add docs/chat-transitions-verification.md and package-builder verification if needed. Evidence scripts remain outside Git unless deliberately added with review.

- [ ] Back up .lab-config.yaml to evidence, update only its port field to 8775; no real settings. Change startup constant and test port expectation together. Append tests to the existing script preserving all prior tests.
- [ ] Build F:/SillyTavern-Research/2026-10-07-chat-transitions/production-patch from verified production-original. Replace selectCharacterById/openRecentCharacterChat and its scoped flag with reviewed equivalents, plus just endpoint cache import/instance/calls and helper. Assert all affected original source hashes and exact replacement counts. Preserve every unrelated byte or document bounded function-region differences. No plugin files.
- [ ] Execute source-extracted navigation tests against the original-version variant, and real HTTP recent-cache tests against that variant. Do not call it accepted based solely on a syntax check.
- [ ] Run baseline/candidate desktop and CPU-rate-4/mobile viewport native UI profiles separately without concurrent full tests. Use at least three valid samples per condition, same instrumentation, 40 ms simulated latency, original default and target artificial cases. Assert one target request/event, expected message marker/count, no model generation and no candidate-only runtime error. Preserve all raw failed attempts. Validate full nonempty synthetic chat content and integrity before and after; report extension-driven metadata writes rather than silently ignoring them.
- [ ] Run original/lab/production recent benchmarks, compare 11-file outputs, warm reads and latencies; invalidate one fixture and show only that file rereads. Do not extrapolate local timings to the production host.
- [ ] Run Node 24 and Node 20 `npm run test:perf` equivalent with exact file list, retaining logs; no redundant broad repeats unless fixes require them. Validate protected workspaces/backups and live read-only hashes/process state.
- [ ] Write accurate Chinese/English verification report, whitelist stage and cached check, final independent review, commit after issues are fixed. Build incremental ZIP, binary patch, full source bundle and narrow original-version ZIP with SHA-256 manifest; restore bundle and verify every tracked byte/commit without deleting files.
- [ ] Stop only the owned 8775 lab process using its verified control identity and graceful SIGINT. Verify exit/port release. Deliver files, metrics, tests and remaining limits. If deployment is requested as a final step, explicit approval must include backend reload; elapsed time is not authorization.
