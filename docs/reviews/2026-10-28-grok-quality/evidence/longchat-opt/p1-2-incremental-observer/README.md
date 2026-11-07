# P1 step 2: incremental keyboard observer

Base is `f6c005331182c3f22c2f108bb120c884b1ccd76f`; head is WORKTREE on `opus-longchat`. Product changes are confined to `public/scripts/keyboard.js`. The observer collects added element roots and class-change targets into Sets, schedules one rAF, skips disconnected roots, and removes roots covered by queued ancestors. It checks each root itself and queries only its subtree. The initial document initialization remains synchronous.

The checked-out base already passed the changed element into its subtree initializer; it did not unconditionally query the document on every record. This step removes repeated overlapping work across records/callbacks. Selector order and duplicate visits remain intact, as do exported signatures and synchronous explicit registration/make calls. Class changes retain subtree processing because ancestor disabled/not_focusable classes and arbitrary registered descendant selectors can change child focusability. The filter stays `class`: native `disabled`, style, tabindex and data-original-tabindex were not inputs to the existing observer contract. No role writes exist in this module. The ancestor check now uses one `closest()` call and never reads computed style. Attribute writes/removals are conditional; existing repeated-disabled-call saved-tabindex semantics (including the string `null`) are preserved.

Linux, Node 24.22.1, headless Chromium 156.0.8078.4, 1440×1000, seed 20261028, extensions disabled, P0 end-relative data shape. A/B uses base/head alternation, seven pairs per setting, each side/run with a fresh owned data root and server. Archived base sources are read-only and use a node_modules symlink. Browser jobs ran sequentially, with no test/profile job overlapping the timing matrix. No attempts were replaced or dropped.

## Alternating A/B

Values are milliseconds. Median is arithmetic; p95 is nearest-rank (the maximum at n=7). Parentheses contain percentile 95% bootstrap CIs. Both sides and their CIs use the existing benchmark-statistics implementation, 2000 paired resamples, seed `opus-round1.5`. Delta is head median minus base median. Raw samples, per-side median/p95 CIs, and ordered runs are in [ab/comparison.json](ab/comparison.json).

| Messages / truncation | Metric | n per side | Base median (CI95) | Base p95 (CI95) | Head median (CI95) | Head p95 (CI95) | Median delta (CI95) |
|---|---|---:|---:|---:|---:|---:|---:|
| 2000 / 100 | Open | 7 | 1080.60 [854.00, 1117.00] | 1170.40 [1093.20, 1170.40] | 826.90 [815.30, 1096.10] | 1111.00 [826.90, 1111.00] | -253.70 [-301.70, 234.30] |
| 2000 / 100 | Send through save response | 7 | 753.23 [699.83, 1462.32] | 1486.75 [1283.50, 1486.75] | 1127.76 [527.01, 1210.88] | 1231.73 [1208.73, 1231.73] | 374.54 [-935.31, 511.05] |
| 2000 / 0 | Open | 7 | 7234.70 [5844.70, 7968.10] | 8104.70 [7951.70, 8104.70] | 5348.50 [5163.80, 5371.40] | 5879.00 [5358.20, 5879.00] | -1886.20 [-2787.90, -473.30] |
| 2000 / 0 | Send through save response | 7 | 4718.96 [3650.19, 5701.31] | 7346.38 [5580.26, 7346.38] | 1541.48 [1508.50, 1658.86] | 1772.40 [1647.15, 1772.40] | -3177.48 [-4182.46, -2131.34] |

The 2000/100 send median increased from 753.23 to 1127.76 ms (+49.72%); its paired delta CI [-935.31, 511.05] includes zero. This experiment does not establish a default-setting send improvement. Its absolute head median meets 1250 ms, and its p95 is lower. Default open also has a delta CI including zero. At 2000/0, open and send median deltas are -1886.20 ms and -3177.48 ms, with both paired CIs entirely below zero. No rerun was used to change these conclusions.

Open includes two rAF and the existing 500 ms quiet window. Send includes Playwright input and full save response, after two scroll sweeps and up to three older-message batches: 400 messages in DOM at 100, 2000 at 0. The post-save render assertion is outside the send timer but inside the CPU capture. All in-memory messages are saved. This measures a synthetic upstream-core workflow, without generation or extensions.

## Send CPU profiles

Inclusive keyboard percentage is the time-weighted union of samples with any keyboard.js frame on the stack, including native work below it; idle/native/harness time remains in the denominator. Percentages are not summed across overlapping functions. n=1 profile per setting/side; absence of a named frame does not prove no work. [profile-comparison.json](profile-comparison.json) gives source hashes and sampled durations; raw head profiles are gzip files in [profiles/](profiles/). Historical baseline profiles use legacy data shape and revision `0bf2745`, so they are attribution context rather than the paired A/B timing base.

| 2000-message truncation | Historical keyboard.js inclusive % | Head keyboard.js inclusive % | Historical initializeInteractables % | Head initializeInteractables % |
|---:|---:|---:|---:|---:|
| 100 | 27.98 | 10.22 | 25.91 | 9.65 |
| 0 | 60.08 | 13.51 | 56.51 | 12.35 |

The harness gained only `--profile-phases send` (default remains all phases) to avoid unrequested open/scroll CPU captures. Its existing profiling mode also performs one ordinary companion workflow per setting; these two observations remain in raw evidence and are excluded from A/B statistics.

## Equivalence and 3000/load-all

At 2000/100, [equivalence/comparison.json](equivalence/comparison.json) reports exact equality of both normalized #chat snapshots and all dynamic Tab descriptors. Snapshot byte lengths and decompressed SHA-256 values were independently reverified. No focusability attributes are normalized away. Each Tab is a real Playwright keyboard action. All scenarios retained the original P0 tests and passed with frame batching; no synchronous fallback was required.

| Check | Base / head count | Result |
|---|---:|---|
| DOM after open | 1 / 1 | Identical |
| DOM after older | 1 / 1 | Identical |
| Tab: older | 565 / 565 | Identical |
| Tab: appended | 565 / 565 | Identical |
| Tab: class-added | 567 / 567 | Identical |
| Tab: ancestor-disabled | 566 / 566 | Identical |
| Tab: ancestor-enabled | 567 / 567 | Identical |
| Tab: popup-open | 4 / 4 | Identical |
| Tab: popup-closed | 567 / 567 | Identical |

Total: 3401 actual Tab presses per side. DOM snapshots cover 100 messages at open and 200 after one real showMoreMessages call. The append scenario uses the real send/save path. Equivalence-run timings are excluded from the A/B table.

| Head 3000/0 full workflow | Successful / attempted | Open median / p95 ms | Send median / p95 ms | Page errors / RangeError |
|---|---:|---:|---:|---:|
| Open, both scroll sweeps, send/save/render assertions | 5 / 5 | 7861.60 / 10089.10 | 3282.60 / 4758.83 | 0 / 0 |

## Validation, limits and cleanup

The new six-case browser-free VM/minimal-DOM file is registered in test:perf. It covers callback/frame coalescing, root/descendant handling, ancestor deduplication in either queue order, detached/text nodes, late classes, disabled/not_focusable ancestors, extension descendant selectors, scroll-reset initialization, observer filters, and stable attribute writes. The existing spread-test fake now supports closest and reports stored attributes accurately. An initial stress-test failure came from its old mock reporting hasAttribute=false even after writing an attribute; the mock was corrected, without weakening the assertion. No flaky browser runs or reruns-to-green occurred.

[validation.json](validation.json) retains exact narrow commands, Node versions, exit codes and output. Only the keyboard, spread and measurement unit files were run; the full suite was not run. ESLint covers the changed JS files, and the changed Python harness was compiled. The default PATH node resolved to 24.22.1 despite the environment description; that successful observation is retained separately, and the missing Node 22 coverage was completed with its explicit 22.20.0 binary. No test failed in either invocation. Remote Windows/Ubuntu CI combinations and manual Windows/real-chat browser checks are unrun because this session is Linux and no commit/push was requested.

| Local validation | Tests / files | Pass | Skip | Fail |
|---|---:|---:|---:|---:|
| Node 20.19.2 narrow tests | 20 | 19 | 1 | 0 |
| Node 22.20.0 narrow tests | 20 | 19 | 1 | 0 |
| Node 24.22.1 narrow tests | 20 | 19 | 1 | 0 |
| Default PATH node (resolved 24.22.1), retained extra run | 20 | 19 | 1 | 0 |
| ESLint changed JS files | 3 | exit 0 | — | 0 |
| Python compile + diff whitespace | 2 checks | exit 0 | — | 0 |

| Acceptance | Result |
|---|---|
| All P0 dynamic Tab sequences and 2000/100 DOM snapshots identical | Met |
| Alternating A/B at 2000/100 and 2000/0, >=7 per side, median/p95 and bootstrap CIs | Met |
| Head send profiles at 2000/100 and 2000/0, gzip, baseline attribution comparison | Met |
| Head keyboard inclusive <3% at 2000/100 | Unmet: 10.22% |
| Head send median <1250 ms at 2000/100 | Met: 1127.76 ms |
| 3000/0 full workflow succeeds 5/5 | Met |
| Default-setting send improvement | Not established; median point estimate increased, paired CI includes zero |
| Local Node 20/22/24 narrow tests and changed-file lint | Met; intended 3-version matrix: 57 passes, 3 native-Windows skips; extra default-24 run: 19 passes, 1 skip |
| Six remote OS/Node CI combinations and Windows real chat | Unrun; environment limitation |

All 39 browser workflows succeeded; all 32 isolated servers exited 0, reported no incomplete shutdown and removed their own ownership lock. Playwright browsers closed and driver processes exited. [summary.json](summary.json) records every shutdown observation and source hash. No data directories were shared, no locks/identity/token/fsync/retention policies changed, no user/synthetic data or lifecycle markers were deleted, and no Git refs/commits/pushes were made. Evidence privacy/integrity is recorded in privacy-snapshot-audit.json and raw-index.json.

## Reproduction

Use the installed Playwright Python as `PYTHON`, the installed Node 24 binary as `NODE24`, and a fresh output directory as `OUT`. The A/B harness creates its immutable base via git archive piped to tar; no checkout/worktree/ref changes are used.

```sh
"$PYTHON" tests/browser-longchat-perf.py --base f6c0053 --head WORKTREE --sizes 2000 --settings 100 --runs 1 --equivalence --output "$OUT/equivalence" --node "$NODE24"
"$PYTHON" tests/browser-longchat-perf.py --base f6c0053 --head WORKTREE --sizes 2000 --settings 100,0 --runs 7 --output "$OUT/ab" --node "$NODE24"
"$PYTHON" tests/browser-longchat-perf.py --sizes 2000 --settings 100,0 --runs 1 --profile-phases send --output "$OUT/profiles" --node "$NODE24"
"$PYTHON" tests/browser-longchat-perf.py --sizes 3000 --settings 0 --runs 5 --no-profiles --output "$OUT/head-3000" --node "$NODE24"
node --test tests/longchat-keyboard.test.mjs tests/longchat-spread.test.mjs tests/longchat-measurement.test.mjs
npx eslint public/scripts/keyboard.js tests/longchat-keyboard.test.mjs tests/longchat-spread.test.mjs
```
