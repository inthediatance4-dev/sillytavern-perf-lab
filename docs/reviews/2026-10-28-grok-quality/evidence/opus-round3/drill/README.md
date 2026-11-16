# Round 3 Linux drill evidence

Latest run (current HEAD working tree, including uncommitted follow-ups):
[near-real Markdown](report-2026-10-28T10-46-08-017Z.md),
[near-real JSON](report-2026-10-28T10-46-08-017Z.json): **50 chats × 2000 messages**;
[default Markdown](report-2026-10-28T10-44-22-401Z.md),
[default JSON](report-2026-10-28T10-44-22-401Z.json): **2 chats × 6 messages**.
Both Linux Node 24.22.1 runs recorded **29/30 PASS, 1 FAIL**, with browser lifecycle
passing and no report error. The required safety gate is **unmet**: OLD 48a153e
started listening while NEW held its live v2 owner record. PREV 9293a4e refused
with exit 78. Both attempts left NEW's lock bytes unchanged and NEW still serving.
Both rollback targets rejected explicit save with 409 retired_path, kept the
deleted path absent from discovery APIs and the visible filesystem, and preserved
the protected recycle/lifecycle/staging snapshots. This finding intentionally
fails the drill; no old-version behavior was weakened or patched.

Correction to historical narrative (old evidence is retained unchanged):
`git grep` at 48a153e finds no exclusiveDataRoot/owner-lock implementation.
Its unchanged dead v2 file means it ignored that record, not that it acquired
ownership. The inherited observation sentence in these JSON/Markdown reports
claiming OLD already has owner locking is inaccurate; the measured live-owner
run logs and failed assertion are authoritative. The script's observation text
has now been corrected. PREV has owner locking. Never rely on OLD to prevent
concurrent startup; stop NEW first.

Reproduce with `node scripts/drill-upgrade-rollback.mjs`, or
`DRILL_CHATS=50 DRILL_MESSAGES=2000 node scripts/drill-upgrade-rollback.mjs`.
Each run uses only a fresh synthetic root and a whole-root pre-upgrade backup;
no real data is used. NEW is the working tree; OLD/PREV are temporary detached
historical sources. Reports are timestamped and never overwrite previous files.

Focused validation: `npx eslint src/deploy-check.js tests/deploy-check.test.mjs
scripts/drill-upgrade-rollback.mjs` and `git diff --check` pass. Explicit Node
20.19.2, 22.20.0 and 24.22.1 runs of deploy-check + integrity-check each have
24 tests: 23 pass, 0 fail, 1 native-Windows-only skip with an explicit reason
(case-insensitive filesystem required). Total: 69 pass, 3 skips. The injected
statfs OK/WARN tests and CLI real statfs test also run on Windows CI. No new test
files were added; the existing deploy-check file is already in test:perf.
No full suite was run. Windows hands-on acceptance remains outstanding.

Previous latest successful run (9fdb0e4):
[Markdown](report-2026-10-28T10-14-14-090Z.md),
[JSON](report-2026-10-28T10-14-14-090Z.json), 19/19 checks (before the live-owner assertion).
The run described below was on 00fb353.

Final completed run: [Markdown](report-2026-10-28T10-10-31-682Z.md),
[JSON](report-2026-10-28T10-10-31-682Z.json). **19/19 checks passed**, no unsafe
rollback behavior observed. Linux Node 22 ran the drill. Browser lifecycle passed
headless Chromium 156 with zero page errors and zero generation requests; the
browser result JSON is embedded in the report. NEW SIGINT shutdown succeeded;
timing and all server exit records are in the JSON. All detached temporary
worktrees were removed; completed-run synthetic data was removed.

Integrity expectations: three staging orphans (chats, characters, group chats),
one visible publish-intent conflict, and recycle usage in chats and characters;
exit 1, no other finding kinds, and identical full before/after snapshots.

Both OLD 48a153e and PREV 9293a4e started by reclaiming the dead v2 owner record.
Both already contain retirement protection: explicit save to the deleted chat
returned 409 `chat_lifecycle/retired_path`; neither automatically nor explicitly
resurrected it. These measured behaviors differ from the task's OLD assumptions
(ignoring the lock and permitting explicit recreation). No legacy code was changed.
Retained normal/group chats round-tripped; staging was absent from API lists;
user lifecycle protected-directory snapshots matched exactly.

Earlier attempts are preserved without edits:

- `report.json` / `report.md`: sandbox rejected worktree metadata writes to the
  source repository's read-only Git directory. The script now uses a temporary
  local clone for detached worktree metadata.
- `report-2026-10-28T10-07-31-078Z.*`: completed browser/rollback observations,
  but three overly broad measurement assertions failed. Copy timestamp precision
  caused the backup mismatch; additional webpack cache recycle entries caused
  the two protected-snapshot mismatches. No existing protected file changed or
  disappeared. The final drill compares backup paths/bytes and scopes exact
  protected-directory assertions to user lifecycle roots. The old results and
  their FINDING labels remain intact for audit.

Validation: `npx eslint scripts/drill-upgrade-rollback.mjs` passed.
`tests/integrity-check.test.mjs` on Node 20.19.2, Node 22 and Node 24.22.1 each
reported 11 tests: 10 passed, 0 failed, 1 skipped explicitly because native Windows
case-insensitive filesystem behavior requires Windows. Total: 30 passed, 3 skips.
`git diff --check` passed. No full suite was run; no new test files were added
(the drill is an explicitly invoked integration script), so no `test:perf`
registration was needed. No Windows product logic was introduced.

Acceptance: Linux synthetic upgrade/rollback, backup, crash leftovers, integrity,
read-only preservation, owner handling, explicit-save observations and browser
checks completed. Windows hands-on browser/Ctrl+C acceptance remains outstanding;
this evidence does not authorize deployment. Dependency symlinks worked; no npm ci
fallback was needed. Source branches/tags and existing evidence were untouched.
