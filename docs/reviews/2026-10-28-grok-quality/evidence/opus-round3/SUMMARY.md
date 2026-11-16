# Opus round 2 review follow-ups and round 3: summary

Repo: https://github.com/inthediatance4-dev/sillytavern-perf-lab

Every code change was implemented by the Codex CLI. I reviewed the diffs, ran lint and the narrow tests, and made the commits. Where I corrected Codex's work, it is marked **(review fix)**.

Patch: /workspace/sillytavern-perf-lab-opus-round3.patch (`git diff 6567d5b..031b83b`; large, because it includes the drill JSON reports).

## Phase A: round 2 review follow-ups (opus-round2, 617a04f → 71997bf), then merge

| Commit | Content |
|---|---|
| f1d81f2 | pid validation and PowerShell argument passing; 6 s probe budget |
| 05d08d2 | `.chat-staging` hidden from listings; `intent:'delete'`; default-mode read-only scan; documentation |
| d6f70cc | Ubuntu skip-reasons table; save A/B evidence; bench-save workflow |
| 71997bf | Windows tar fix for the benchmark |

**1. PowerShell injection (merge blocker), fixed.**
- The pid must pass `Number.isSafeInteger(pid) && pid > 0` before any probe. Strings are never coerced to numbers.
- PowerShell gets a fixed `param([long]$ownerPid)` script, and the pid is a separate argv entry.
- Tests: pids `"1; Start-Process calc"`, `"1e3"`, `1.5`, `-1`, `0` and `"123"` all mean ownership cannot be verified, so startup refuses, and nothing is spawned (spawn spy count = 0).

**2. `.chat-staging` invisibility (merge blocker), fixed.**
- A single helper, `isLifecycleInternalName()`, filters these names out of every listing.
- Coverage: chat lists, the character list and chat sizes, recent chats, group chats, search, the backup list and backup recycling.
- An endpoint smoke test plants staging files in every directory.
- Character rename carries `.chat-staging` along; delete moves it into `.recycle/`.

**3. `intent:'delete'`.** It was missing before; it is now written for `deleted`, `character_deleted` and `group_deleted`. Exclusive-mode startup completes an interrupted delete by moving the target into `.recycle/`.

**4. Cause of the 15 s Windows refusal.**
- A peer with a consistent identity was already refused after one probe.
- The delay came from repeated probes on the reclaim path, each with its own 3 s budget.
- Fix: acquisition now shares a 6 s budget, retries a failed probe once, and prints a progress line once.

**5. Default-mode startup.**
- It now runs the read-only `scanLifecycle` and logs finding counts by kind, plus a hint to run check:integrity or enable exclusiveDataRoot.
- **(review fix):** Codex had dropped the pre-existing legacy hold migration from default-mode startup. I restored it, because removing it would change upgrade behaviour.
- `check:integrity` now warns when the data root has a live owner.

**6. ISOLATION.md (review fix: rewritten from Chinese into English to match the file):**
- deployment prerequisite `exclusiveDataRoot: true`
- manual triage steps for legacy markers with no intent
- rollback note about the 1 ms BigInt rounding difference

**7. Ubuntu skips went from 1 to 5.** All five are native-Windows-only tests; see `evidence/opus-round2/ubuntu-skips.md` for the reasons and the commits that added them.

**8. Save A/B against 9293a4e (record only).**
- Linux box: +2% to +9%, every CI includes 0.
- Windows CI: **+19.9%** (CI 0.98..1.58 ms). This triggered round-3 item 5.
- I added an opt-in `bench-save` workflow (runs when a commit message contains `[bench]`, on windows-latest and ubuntu-latest) and fixed `tar -C C:\…` on Windows.

**CI**

| Run | Result |
|---|---|
| [40667089562](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/40667089562) (d6f70cc) | First attempt failed on Windows Node 24: the self probe timed out twice under load. A rerun was green. Root cause fixed in round 3 (00fb353). |
| [40667690292](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/40667690292) (71997bf) | Green |

**Merge.** `git merge --no-ff opus-round2` into codex-improvements gave **6567d5b**, pushed normally.
- CI [40668172884](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/40668172884): the first attempt had one failure on Windows Node 20, a PID-reuse flake in "a stale reclaim marker is taken over once…". The rerun was **green** (642 tests).
- The flake was then fixed for good in round 3 (00fb353).

## Phase B: opus-round3 (from 6567d5b, HEAD 031b83b)

| Commit | Content |
|---|---|
| b886741 | Priority 2: streaming export |
| 00fb353 | Priority 3: owner record inspected before self probe, plus deterministic PID-reuse fixtures |
| e4e729a | Priority 4: `npm run check:deploy` |
| 9fdb0e4, 3b656aa | Priority 5: staging-directory cache, then the fix for its cache key |
| 9d4da60 | Priority 1 (automatable part): upgrade/rollback drill and headless browser run |
| af70991, 031b83b | Evidence |

**Priority 2: streaming export.**
- The export holds the existing shared directory and file locks for its whole duration.
- Pass 1 streams and validates. A bad line returns 400 with its line number before any header or byte is sent.
- Pass 2 streams the same JSON envelope with backpressure. An I/O error after headers destroys the response; it never completes a truncated 200. A client disconnect releases the locks.
- Output is byte-identical to the old version. A concurrent save gives a deterministic result (tested with a gate, not sleeps).
- **100 MiB txt export: RSS peak 113 MiB vs 486 MiB baseline** (target < 150 MiB).
- Caveats:
  - JSONL export stays a raw export with no line validation, as before.
  - A slow client holds the shared lock, so saves to that chat wait until the download finishes.
  - A single huge line still costs memory proportional to that line.

**Priority 3: Windows refusal speed.**
- Acquisition now inspects the existing owner record first. Refusing a consistent live owner needs one peer probe and no self probe.
- Real Windows CI: warm refusal took **186–384 ms** (target < 1 s).
- A failed probe takes at most about 6 s, with a progress line.
- The self probe gets its own 6 s budget and only runs when a lock record is about to be written. Worst case is about 12 s.
- Unverified ownership still refuses with exit 78.
- PID-reuse flakes: the marker and race tests now use a v2 record with an impossible identity. The legacy dead-pid test re-checks that the pid is dead right before acquiring.

**Priority 4: check:deploy (read-only).** It checks:
- exclusiveDataRoot: FAIL if it is not enabled
- maxRecycleBytes: INFO
- whether the data root is writable
- the cgroup v2/v1 memory limit or os.totalmem, against 512 MiB and the measured streaming-export allowance (max(150 MiB, peak × 1.25))
- the largest chat

Exit codes are 0/1/2, with a `--json` option.

**Priority 5: staging-directory cache (triggered by the Windows +20%).**
- Directory creation is cached by pathKey, retire/recycle invalidates the cache, and an ENOENT triggers a retry. The redundant parent mkdir is gone.
- **Result:** Windows is still **+20.7%** (about +1.3 ms per save, CI 1.16..1.63 ms); ubuntu CI is +5.6%. The cache did not remove the Windows overhead.
- The remaining cost is most likely the staging write plus the cross-directory rename under NTFS/Defender. This is a guess, not proven; Windows profiling is the next step. fsync and locks were not touched.
- **(review fix):** my first attempt keyed the cache by `path.resolve()`, which broke the Windows case-alias test (run 40670912923, fix iteration 1). I reverted to pathKey.

**Priority 1 (automatable part): upgrade and rollback drill.**
- `scripts/drill-upgrade-rollback.mjs` works only in a temporary clone and temporary worktrees, with synthetic data. It runs these phases:
  1. Seed a data root with OLD = 48a153e (`codex/sillytavern-1.19-sync`).
  2. Back up the whole data root.
  3. Upgrade to NEW under exclusive mode, then delete, rename and save. kill -9 the server so it leaves a v2 owner record, and plant staging orphans and a publish conflict.
  4. Run check:integrity: the findings match expectations and nothing changes.
  5. Roll back to OLD and to PREV (9293a4e), each on its own copy of the data root.
- **Result at 9fdb0e4: 19/19 checks pass, no findings.**
  - Both old builds reclaim the dead v2 record.
  - The deleted chat stays hidden, and an explicit attempt to recreate it returns 409 retired_path.
  - Staging is never listed.
  - The `.chat-lifecycle`, `.recycle` and `.chat-staging` directories are byte- and mtime-identical before and after.
- Note: 48a153e already had retirement protection and the owner lock, so the expectation that "OLD ignores the lock and allows recreation" did not hold in practice. The drill records measured behaviour instead.
- `browser-lifecycle-lab.py` passed in headless Chromium on Linux (0 page errors), and SIGINT shut the server down cleanly.

**CI (opus-round3)**

| Run | Commit | Result |
|---|---|---|
| [40669367914](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/40669367914) | 00fb353 | Green |
| [40670912923](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/40670912923) | af70991 | Failed on both Windows jobs: staging cache key. Fixed in 3b656aa. |
| [40671817523](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/40671817523) | 3b656aa | Green |
| [40672362115](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/40672362115) | 031b83b | **Green.** 671 tests per job: ubuntu 664 pass / 7 skip; windows 661 pass / 10 skip. |

- Fix iterations: 1 (cap: 6).
- Local check: lint passes, and the full test:perf on Node 24 gives 671 tests, 664 pass, 0 fail (evidence/opus-round3/final/).

## Still not done (deployment gates)

**Windows hands-on acceptance (item 4).** Only you can do this. Steps:
1. On Windows, from the repo directory: `git fetch && git checkout opus-round3 && npm ci`.
2. Run `npm run perf:lab`. It starts on http://127.0.0.1:8780/ with its own `.lab-data/` and exclusiveDataRoot enabled.
3. In a second terminal, install the browser tooling once: `py -m venv .venv`, `.venv\Scripts\pip install playwright`, `.venv\Scripts\playwright install chromium`.
4. Run `.venv\Scripts\python tests\browser-lifecycle-lab.py`. It covers import, delete, rename and re-import, and should end with no errors. Evidence goes to `.evidence\browser`.
5. In the browser, do one manual round: import a character, chat, delete the chat, rename the character, then import the same card again. Check that the chat list never shows `.chat-staging` and that deleted items do not reappear.
6. While the server is running, start a second server on the same data root from another terminal: `node server.js --configPath .lab-config.yaml --dataRoot .lab-data --port 8781 --listen false --listenAddressIPv4 127.0.0.1 --browserLaunchEnabled false --exclusiveDataRoot true`. It should print "Verifying data-root owner identity…" and refuse within about 1 s (ELOCKED, "owned by pid …"), not after 15 s, and leave the lock file unchanged.
7. Press Ctrl+C in the server window. It should exit within the shutdown deadline (default 30 s; normally about 1 s) and print no "Shutdown incomplete". Then confirm `.lab-data\.st-lab-owner.lock` has been removed.
8. Run `npm run check:integrity -- --data-root .lab-data` and `npm run check:deploy -- --config .lab-config.yaml --data-root .lab-data`, and save the output.

**Production deployment check.** Run `check:deploy` on the real deployment configuration. Run the Linux drill again with real-scale synthetic data, and back up the data root before the drill.

**Windows save +20%.** This needs a Windows profile before deciding the next step.

## Notes
- No force-push. No backup branch was pushed.
- The local branch backup-before-hostname-rebase (b312204) is kept.
- Tag grok-handoff-start (45be44a) and branch backup-before-grok-r2 (2daee64) were not touched.
- The machine's hostname does not appear in the pushed history.
- One interruption around 18:30 (Asia/Shanghai). Local and origin were consistent afterwards; no work was lost.
