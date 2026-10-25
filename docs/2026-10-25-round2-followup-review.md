# Round-2 follow-up review (2026-10-25)

Reviewed `git diff 6584d65..HEAD` against the original review and round-2 notes.
Changes below are working-tree edits; no commits, Git writes, network access or
pushes were performed.

## Step A findings

- **Fixed: failed character publication was acknowledged as success.**
  `writeCharacterData` catches errors and returns false. Ordinary edits,
  avatar-only edits, attribute edits and merges ignored that result. They now
  return failure before deleting uploaded files or reporting successful merges.
  Four native-route failure tests inject invalid PNG publication, verify the
  original card and upload survive, and verify a subsequent edit completes.
- **Fixed: structured cloning could silently suppress prompt persistence.**
  The browser module is served without a structuredClone polyfill, and the
  project does not declare a sufficiently narrow browser support matrix to
  assume that global always exists. Extensions can also introduce functions or
  other unsupported values. Saving now tries structured cloning and falls back
  to a detached JSON snapshot. Unsupported JSON properties are omitted according
  to JSON semantics. If JSON also fails (e.g. a cycle), the existing stored record
  remains intact and no saved event is emitted. Tests cover an unavailable global,
  a real non-cloneable function, a throwing clone implementation, nested mutation
  during deferred storage serialization, and an unserializable fallback.
- **Character lock ordering:** no additional cycle found in the changed edit
  paths. Rename/delete reserve card, card-parent and chat-directory queues in one
  synchronous `withPathLocks` call; edits reserve the overlapping card queues and
  do not acquire chat locks inside that boundary. Bulk merges acquire one card
  boundary at a time. Rejected operations release their queue tails. Shared
  parent locks still serialize otherwise unrelated card work.
- **Request drain:** admission closes synchronously before the handler snapshot;
  handlers register before their first microtask. A disconnected response cannot
  release the independently tracked handler. Handlers delayed by earlier
  middleware are rejected after stopping. Added tests for that delayed admission
  and for async errors reaching Express while draining remains repeatable.
  Tracking currently wraps the async route handlers in the three persistence
  routers; future synchronous handlers returning promises need explicit coverage.
  Plugin/background writes and an indefinitely open admitted response remain
  outside a bounded shutdown guarantee.
- **Launcher:** existing configs are re-enforced on every preparation; fixed
  child arguments and filtered environment agree with port 8780 and the local
  data/config paths. Existing socket-free repeated-config enforcement tests pass.
  This is process-local isolation, not an exclusive data-root ownership lock or
  protection from concurrent external filesystem changes.

## Step B and suggested commits

1. `fix: handle failed character publication and prompt snapshot fallback`
   — character writer results, prompt fallback and their focused regressions;
   drain regressions can accompany this correctness commit.
2. `test: skip unavailable historical source oracles`
   — shared asynchronous Git reader, missing-object tests, editor/expression and
   tokenizer suite guards, and test command registration. Unexpected execution
   errors still fail. Verified simulated missing-object runs skip 26 editor
   cases, 19 expression cases and the tokenizer suite before its listener starts.
   The benchmark remains history-dependent and is documented as such.
3. `docs: identify the current lab branch and operating boundaries`
   — English/Chinese README, current ISOLATION entry point, recovery procedure,
   CHANGES sections, historical evidence labels and this review.

## Verification

- `npm run lint` and `git diff --check`: passed.
- Socket-free `node --test` selection: 20 passed, 0 failed. This sandbox's runner
  reports one entry per file, so this is not a full individual-case count.
- Direct Node runs additionally report 12 native character-route cases,
  46 prompt-ownership cases and 5 drain cases passed.
- Full `npm run test:perf`: 28 file entries, 20 passed, 8 failed. The excluded
  listener-dependent files are performance-lab, chat-lifecycle,
  tokenizer-model-compatibility, startup-lazy-imports, startup-failure-exit,
  recent-chat-info-cache, chat-file-safety and chat-backup-isolation. Localhost
  listening is denied (`EPERM`) here; full HTTP/browser acceptance remains open.
- Historical 442/442 evidence remains dated and is not represented as a current
  full-suite result. No browser acceptance or deployment was performed.
