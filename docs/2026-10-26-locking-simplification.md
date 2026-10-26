# Locking simplification (2026-10-26)

Concurrent servers sharing one data root are unsupported. The per-path
cross-process lock implementation and its configuration option have been removed.
No per-path lock files, storage namespaces, filesystem parent fences, quarantine,
or acquisition directories are created or consulted.

The queue in `src/chat-io.js` still reserves shared/exclusive paths synchronously,
grants shared holders together, and prevents later readers from bypassing a
queued writer. File operations retain shared parent-directory reservations;
directory retirement, rename, deletion, and backup pruning remain exclusive.
Self-waits and shared-to-exclusive upgrades still reject with `lock_reentered`.
Backup work uses `runAfterPathLocks` to wait for its originating and enclosing
reservations, outside their held-key scope; unrelated locks do not delay it.

`exclusiveDataRoot` retains the pure Node owner file with `O_EXCL` acquisition
and stale-owner reclaim. Every cooperating server must enable it; the lab
launcher does so. The owner implementation and process-identity implementation
are unchanged, including bounded cleanup names, retriable release bookkeeping,
fresh foreign Windows PID probes, and conservative Windows identity handling.

Retired-name reuse, bounded shutdown drain, and the backup recycle byte budget
are unchanged. Protocol-only tests were deleted; queue nesting and deferred-work
regressions were retained in `tests/path-lock-fairness.test.mjs`. Dated reviews
of the removed protocol remain historical evidence only.
