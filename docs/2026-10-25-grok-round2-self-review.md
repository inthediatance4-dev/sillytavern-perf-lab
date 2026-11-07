# Grok round-2 self-review (2026-10-25)

Reviewed `git diff 2daee64..HEAD` on `codex-improvements` for commits `0883867` (shared and exclusive directory locks), `76258dc` (data-root owner lock), `53d56cc` (upstream comment and locale ports), `9ec8ea0` (flock reclaim), and `41da717` (pure-Node reclaim). The stale-reclaim race in `76258dc` was first closed with a runtime flock addon in `9ec8ea0`. That addon compiled `src/data-root-flock.c` with `gcc` and `node_api.h`, so the lab launcher (which forces `exclusiveDataRoot`) could not start on Windows or on a machine without a compiler. `41da717` deletes the addon and reclaims a stale owner in pure Node. No P2 remained. No push. Tag `grok-handoff-start` and branch `backup-before-grok-r2` were not moved.

## Findings

| Severity | Location | Finding | Fix status |
| --- | --- | --- | --- |
| P1 | `76258dc` `src/data-root-owner.js` (then `:164-179`) | Stale same-host reclaim re-read the owner file, then `unlinkSync`, then retried `O_EXCL` create. Two processes could both pass the content check and both unlink. The second unlink deleted the winner's new lock, so both acquires could succeed. | First closed in `9ec8ea0` by rewriting the record only while `LOCK_EX\|LOCK_NB` was held. Superseded by `41da717`: `claimReclaimMarker` (`src/data-root-owner.js:422`) creates `.st-lab-owner.lock.reclaim` with `O_EXCL`, and `takeVerifiedStaleLock` (`:446-466`) renames the stale owner aside and `unlinkSync`s it only when the bytes still match. The other process gets a fresh marker and then `ELOCKED`. Other-host, symlink, and corrupt files are not modified. Regression: `tests/data-root-owner.test.mjs:205`. |
| P1 | `9ec8ea0` `src/data-root-owner.js` `loadFlock` and `src/data-root-flock.c` | The first acquire compiled a N-API addon with `gcc`. Missing `gcc` or `node_api.h` threw `EREAD` before the data root was usable. Windows has no `flock` and no guaranteed compiler, so `exclusiveDataRoot` (forced by the lab launcher) stopped startup. | Fixed in `41da717`. `src/data-root-flock.c` is deleted. `src/data-root-owner.js` does not spawn a process or reference `gcc`, `node_api`, or `child_process`. Regression: `tests/data-root-owner.test.mjs:240`. |

## Checked, not defects

- **Lock order.** `normalizeLockRequests` (`src/chat-io.js:43-58`) sorts every key and collapses a path requested both shared and exclusive in one reservation to exclusive. `withPathLocks` (`src/chat-io.js:149-151`) reserves every key synchronously before any wait. No production callback calls `withPathLocks` again. `tests/path-lock-fairness.test.mjs:109` and `:131`.
- **Backup writer vs save.** `trySaveChat` (`src/endpoints/chats.js:526`) only schedules. The writer starts on a later microtask (`src/chat-backup-scheduler.js:48`) and locks the backup directory (`src/endpoints/chats.js:69`). Nothing holds that directory and then takes a chat path.
- **Starvation.** Writer preference is intentional (`src/chat-io.js:75-94`): an exclusive already queued blocks later shared grants, and shared holders already queued ahead of it still run. A continuous exclusive stream delays shared holders. The reverse (shared holders starving an exclusive) is closed by `exclusivePending`.
- **Rejection leak.** Release is on the reservation `finally` (`src/chat-io.js:153-155`), including when the task throws. `pendingIO` drops that reservation after it settles (`src/chat-io.js:156-160`). `tests/path-lock-fairness.test.mjs:150`.
- **`waitForChatIO`.** Every accepted reservation, shared or exclusive, queued or running, is added to `pendingIO` before `withPathLocks` returns (`src/chat-io.js:156-161`). `waitForChatIO` (`src/chat-io.js:507-508`) drains that set.
- **Shared parent vs directory mutation.** `chatLockPaths` (`src/chat-io.js:171-175`) is shared parent plus exclusive file. Directory create, rename, and delete pass the directory as an exclusive string: character create and delete `src/endpoints/characters.js:1045` and `:1507`, character rename `:1105` (directory rename at `:1125`), group delete `src/endpoints/groups.js:235`. Backup creation and prune hold the backup directory exclusively (`src/endpoints/chats.js:69-75`). Backup-file delete (`src/endpoints/backups.js:43-44`) keeps the shared parent and moves one file through `mkdtemp` (`src/chat-io.js:347-356`). That conflicts with exclusive prune; it does not share the directory with it. Chat file rename (`src/endpoints/chats.js:619`) renames files under the shared parent, not the directory.
- **Abnormal exit.** `installRelease` (`src/data-root-owner.js:516-528`) registers `process.on('exit')`. `releaseOwnedLock` (`:533-560`) renames the owner file aside and unlinks that inode only when the bytes still match. `process.exit` and an uncaught exception both run that hook, including startup `process.exit(1)` after a successful acquire (`src/server-main.js:103-108`, and `src/server-main.js:346` from `uncaughtException` at `:352-355`). Regression: `tests/data-root-owner.test.mjs:150`. `SIGINT` and `SIGTERM` handlers are registered later (`src/server-main.js:350-351`). A signal that kills the process without running `exit` leaves the file. The next same-host acquire reclaims it. The lock module does not add its own signal handlers and does not keep a descriptor open. `SIGKILL` reclaim is covered by `tests/data-root-owner.test.mjs:205`.
- **Same-host liveness.** `pidAlive` (`src/data-root-owner.js:86-97`) uses `process.kill(pid, 0)`. `ESRCH` is dead. `EPERM` is alive, which is the Windows result when the pid exists but cannot be signaled. Any other error fails closed and is treated as alive. Regression: `tests/data-root-owner.test.mjs:273`. A live owner still throws `ELOCKED` and does not warn (`tests/data-root-owner.test.mjs:70`).
- **Unexpected environment errors.** `warnOwnership` (`src/data-root-owner.js:497-499`) logs and `acquireDataRootOwnership` returns `{ unverified: true, lockPath: null }` instead of throwing (`:588-594`, `:617-620`). Startup continues. The existing owner file is not removed. Regression: `tests/data-root-owner.test.mjs:295`.
- **Upstream port.** `53d56cc` changes comments and locale strings only (20 files, +25/-25), including `#6054`, `#6052`, `#6053`, and `#6049`. It does not touch locks, the launcher, or the data root. `exclusiveDataRoot` stays default false (`src/command-line.js:85`). The lab launcher still forces it (`scripts/start-performance-lab.mjs:48`, `:64`, `:82`).

## Residuals (not P1/P2, no code change)

- A non-empty torn owner payload is corrupt and is left in place (`src/data-root-owner.js:356`). An empty file is reclaimed (`:69`, `:357`). Same fail-closed rule as the previous corrupt-file behavior. Symlinks (`:352`) and other-host records (`:358-359`) are also left in place.
- A reclaim marker younger than `DATA_ROOT_RECLAIM_TIMEOUT_MS` (10 seconds, `src/data-root-owner.js:19`) is not stolen. This acquire retries for about half a second and then throws `ELOCKED`. A marker older than the timeout is taken by one process (`takeoverStaleMarker`, `:377`). Regression: `tests/data-root-owner.test.mjs:213`.
- This is process ownership of one data root, not per-file cross-process locking. A process that does not pass the flag can still use the same root.

## Verification

Recorded against `41da717` before this doc commit. The doc does not change runtime behavior.

- `npm run lint`: exit 0.
- `node --test tests/data-root-owner.test.mjs`: tests 13, pass 13, fail 0, skipped 0, `duration_ms` 1806.98859.
- `npm run test:perf`: tests 511, pass 510, fail 0, cancelled 0, skipped 1, todo 0, `duration_ms` 11084.275988, exit 0.
- The single skip is `tests/chat-lifecycle.test.mjs:221` (`Windows case aliases refer to the same retired path`, skipped when `process.platform !== 'win32'`). This run had no listener `EPERM` failures. The suite grew by the four new owner cases (stale reclaim marker, no compiler, `EPERM`, unexpected environment error), from 507 to 511.

Earlier flock-fix verification against `9ec8ea0` (before `41da717`):

- `npm run lint`: exit 0.
- `node --test tests/data-root-owner.test.mjs tests/path-lock-fairness.test.mjs tests/lab-launcher-isolation.test.mjs`: tests 16, pass 16, fail 0, skipped 0.
- `npm run test:perf`: tests 507, pass 506, fail 0, cancelled 0, skipped 1, todo 0, `duration_ms` 6872.077531, exit 0.
