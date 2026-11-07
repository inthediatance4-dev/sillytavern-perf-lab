# Lock review fixes (2026-10-26)

> Historical review, superseded by [the locking simplification](2026-10-26-locking-simplification.md).
> The per-path cross-process protocol, its flags, storage namespaces, parent
> filesystem fences, acquisition gates, and protocol-only tests described below
> have been deleted. These are historical findings and test results, not current
> guarantees. Current locking uses the data-root owner lock and in-process queues.

This supersedes the protocol guarantees in the round-4 self-review. All five
P1 findings and both P2 findings in the external review were addressed.

- Foreign Windows PIDs are probed again on each identity check; only self start
  time is cached. Approximate Windows boot timestamps cannot authorize reclaim
  of an existing PID. PowerShell is the sole start-time provider; unavailable
  identity retains the lock. WMIC was removed instead of attempting to reconcile
  incompatible timestamps.
- Every reservation selects the hashed host temporary namespace at configuration.
  Per-reservation fallback, restart logic, and the artificial length seam were
  removed. Contenders must share the temporary directory and normalized root.
  Stop older server versions before upgrading the protocol.
- A per-key directory gate serializes inspection, stale reclaim, quarantine, and
  publication. Every acquirer obeys it. Gates are never reclaimed automatically:
  an interrupted acquisition can leave a gate that requires removal with all
  contenders stopped. This deliberately trades automatic crash recovery for
  exclusion without another unsafe stale-gate reclaim protocol.
- Release, reclaim, unread-file cleanup, and quarantine use bounded short names.
  Path-lock release errors propagate; data-root release retains its ownership
  bookkeeping after a failed rename so explicit release can be retried.
- Deferred backups wait for completion of their originating and enclosing
  reservations through async-local completion promises. They do not poll global
  lock depth or wait for unrelated holders.

Regression coverage includes successive Windows PID incarnations, a fresh
observer after a clock step, unavailable PowerShell without provider fallback,
fixed storage selection, gated contenders observing a replacement live owner,
cleanup destinations constrained to the canonical path budget, retriable owner
release, and deferred backup progress under an unrelated long-held lock. Existing
child-process directory/file contention tests exercise the updated protocol.

Validation on this Linux host:

- `npm run lint`: passed.
- `node --test tests/process-identity.test.mjs tests/path-fs-lock.test.mjs tests/data-root-owner.test.mjs tests/path-lock-fairness.test.mjs tests/chat-backup-isolation.test.mjs`: 70 passed, no failures or skips.
- `git diff --check`: passed.

The subsequent user decision removed concurrent-server support on one data root
and deleted the per-path filesystem protocol. The Windows identity fixes,
bounded owner cleanup names, retriable release bookkeeping, and reservation-based
backup scheduling remain. Actual Windows PowerShell startup and browser behavior
were not exercised by this historical review. No full performance suite was run
for that review. No push or history rewrite was performed.
