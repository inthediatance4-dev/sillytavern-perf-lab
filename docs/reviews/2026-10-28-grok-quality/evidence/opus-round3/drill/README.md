# Round 3 Linux drill evidence

Latest run (opus-round3 HEAD 9fdb0e4, including streaming export, owner-first
probing and the staging-directory cache): [Markdown](report-2026-10-28T10-14-14-090Z.md),
[JSON](report-2026-10-28T10-14-14-090Z.json). **19/19 checks passed**, no findings.
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
