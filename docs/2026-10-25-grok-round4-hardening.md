# Grok round-4 hardening (2026-10-25)

Local-only follow-up on `codex-improvements` after `f9051e5`. No push. Tag `grok-handoff-start` and branch `backup-before-grok-r2` were not moved. No Windows host and no browser lab were used.

Commits:

- `5895fd7` fence exclusive directory ops against child writers
- `d9f3636` prefer process start over a drifting Windows boot id
- `c33b0fa` record this note
- this doc commit syncs `README.md`, `README.zh-CN.md`, and `ISOLATION.md` to the protocol below

## What changed

### Shared parent fence

`acquireCrossProcessPathLocks` in `src/path-fs-lock.js` takes the sorted reservation, not only the exclusive keys. An exclusive file also gets a shared filesystem lock on its parent when that parent is not already an exclusive directory. `chatLockPaths` already asks for that parent in-process; a bare exclusive file path gets the same parent fence only on the filesystem.

Names under the lock directory:

- shared holder: `<sha256>.shared.<token>`, created with `O_EXCL`
- exclusive holder: `<sha256>.exclusive`, created with `O_EXCL` only while that hash has no live `.shared.*` file

Shared acquires wait until `<sha256>.exclusive` is gone. After either create, the winner checks the other side and drops its file if it lost the race, so the two modes do not both stay held. Several `.shared.*` files for one hash coexist. Each key still has its own wait (`path_lock_busy` at the configured timeout, default 15s). Dead and reused holders use the existing identity reclaim. Another host's file is left in place.

Acquisition stays in sorted key order after the in-process grants. A parent key sorts before its child, so the shared fence is held before the file exclusive, and a directory exclusive on that same key cannot cut ahead of it. Release is the reverse: the file exclusive drops before the parent fence. `withPathLocks` still rejects a nested entry while `exclusiveFsDepth > 0`. A shared-only reservation still creates no filesystem file.

### Path length

If a primary path under `<dataRoot>/.st-path-locks/` is too long (`ENAMETOOLONG`, or a Windows message that says the path or filename is too long), the process switches to `os.tmpdir()/st-lab-path-locks/<sha256(dataRoot)>/`, creates it mode `0o700`, and writes `root.json` there. `activePathLockLocation()` reports `primary` or `fallback`. The whole sorted set is released and retried on the fallback root, so a name that did get created on the primary root is not left behind. The shared name is longer than the exclusive name; if that longer name does not fit, directory exclusives use the fallback root too, so both sides still meet.

Tests force this with `setPathLockPathLimitForTest` before any create. This Linux host was not given a real near-`PATH_MAX` data root.

### Quarantine

A symlink, a non-regular file, or a regular file larger than `MAX_LOCK_BYTES` (4096) that is older than `LOCK_QUARANTINE_MIN_AGE_MS` (60s) is renamed into `.st-path-locks/.quarantine/` (or the fallback root's `.quarantine/`). The create is retried once. A younger unusable entry still fails with `path_lock_unavailable` and stays in place. A regular file that still looks like a live JSON holder is not quarantined; if a rename races with one, it is linked back. The first quarantine logs once. Dead regular JSON still uses the old rename-and-check reclaim.

### Windows boot id

`classifyPidLiveness` decides from `processStartMs` when both sides have it. A match is live even if `bootId` differs. A mismatch is reused even if the boot stamps match. Boot id is used only when neither side has a start time. One side having a start time and the other missing it stays live.

`win-boot:` stamps within `WIN_BOOT_MATCH_TOLERANCE_SEC` (120) seconds match. That replaces the old 2 second window. `settleWindowsBootSample` keeps the first stamp until a second sample is more than `WIN_BOOT_STABILITY_GAP_MS` (2000) later. If that pair falls outside the 120 second window, later payloads omit `bootId` and keep pid, token, and `processStartMs`. Tests pass forged `signaled` and `identity` into `classifyPidLiveness`; they do not need Windows.

## Self-check

Reviewed the acquire and release paths after the tests above.

- No cross-process order inversion between a directory exclusive and a child file writer: both touch the directory key, and the file writer takes that key before its own file.
- The post-create recheck drops the loser, so a shared parent and an exclusive directory do not remain held together.
- A throw, timeout, or fallback retry releases every file that attempt already took, then the in-process gates. Nested `lock_reentered` still returns before any file is created.
- Fallback selection runs before the first create when the test length limit trips. A real `ENAMETOOLONG` from `open` unlinks that name if one exists.
- Quarantine does not delete a live regular lock. The overlap test sees two shared parents and two file exclusives, then an empty lock directory after release.
- `src/path-fs-lock.js` still does not spawn a compiler or a child process.

## Verification

Recorded on Node v20.19.2. The doc commit does not change runtime behavior.

- `npm run lint`: exit 0.
- Narrow `node --test tests/path-fs-lock.test.mjs tests/process-identity.test.mjs tests/data-root-owner.test.mjs tests/path-lock-fairness.test.mjs`: tests 49, pass 49, fail 0, skipped 0, `duration_ms` 3815.163607.
- `npm run test:perf` (one run): tests 538, pass 536, fail 1, cancelled 0, skipped 1, todo 0, `duration_ms` 14365.159036, exit 1.
- The skip is `tests/chat-lifecycle.test.mjs` `Windows case aliases refer to the same retired path` (`process.platform !== 'win32'`).
- The failure is `tests/recent-chat-info-cache.test.mjs:170` `a write during a pending read prevents storing that unstable snapshot` (`reads` was 1, expected 2). That file is not in this diff. An isolated re-run passed (tests 17, pass 17, `duration_ms` 819.381926). The lock and identity tests in the full run passed.

## Still needs a real Windows host or a browser

- A real `win-boot:` step from `Date.now() - os.uptime()`, and the PowerShell or WMIC process-start probe, including a probe that exceeds 200ms.
- A data root close to Windows `MAX_PATH`, including `ERROR_FILENAME_EXCED_RANGE` as Node reports it on that host. The Linux run used the length seam, not a too-long real path.
- The browser lab was not started.

## User docs

`README.md`, `README.zh-CN.md`, and `ISOLATION.md` are synced to this protocol. They name the shared parent fence (`<sha256>.shared.<token>` / `<sha256>.exclusive`), the `ENAMETOOLONG` fallback at `os.tmpdir()/st-lab-path-locks/<sha256(dataRoot)>/`, quarantine of an old symlink or oversized entry, a 120 second `win-boot:` window, omission of an unstable `bootId`, and preference for `processStartMs`. That docs commit does not change runtime behavior and re-runs `npm run lint` only.

## Residuals

- A reservation that is only shared still does not create a filesystem file. File writes go through `chatLockPaths` or a bare exclusive path, both of which take the parent fence when the feature is on.
- In-process nesting of a different key still runs when cross-process locks are off.
- An unusable lock younger than 60s is left in place and the acquire fails closed.
- `.quarantine/` is not purged.
- Lock files named `<sha256>.lock` by `73269ac` are not holders under this protocol.
- The fallback directory is on this host's tmp directory. Pid identity was already host-local.
- Two writers of different files in one directory can pause on each other only while each shared parent file is created. After that they run together.
