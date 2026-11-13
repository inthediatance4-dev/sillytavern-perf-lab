# Iteration 1 negative result (superseded)

This subdirectory is the first P3 attempt. Correctness passed and performance did not. Raw run JSON, DOM snapshots, server logs and aborted Tab-walk artifacts were deleted after their sha256 values were recorded in `deleted-manifest.json`. The CPU profile of the per-slice anchor correction is kept (gzip). The parent directory is the second iteration.

# P3: time-sliced older messages (performance acceptance fails)

Base: `dfab84be2da4bb64ec3924ff8f60f4cc1ae2a18d` (P0–P2). Head: WORKTREE.
No commit, branch/ref change, persistence optimization or P4 work was performed.

Changed files: public/script.js; the Python harness, browser probe and performance
documentation and measurement tests; the new seven-case older-slice/recorder unit test; package.json registration;
and five affected source-extraction fixtures (idle gate dependency only, plus the
redisplay atomicity assertion). All evidence is confined to this P3 directory.

## Design

`showMoreMessages` retains the truncation/custom batch count and delegates to
`renderOlderMessages`. Each fragment is prepared with a 10 ms elapsed-time budget
(no fixed message count), inserted in ascending ID order, then the visible
message anchor is restored using its bounding-rect offset and explicit scrollTop
correction. The first existing message remains the insertion boundary, so the
fragments form the same contiguous prefix. This does not rely on overflow-anchor.
At batch completion, swipe refresh, optional show-more-button removal and style
pins keep their original order; final anchor correction accounts for those changes.

Between fragments, scheduler.yield() is preferred. MessageChannel is the fallback:
it schedules a task in hidden documents as well as visible ones, whereas rAF can
be suspended in a background tab. Ports are closed after each fallback yield.
The browser runs use Chromium's scheduler; the fallback is covered by a deterministic
browser-free unit test, not a separate hidden-tab latency experiment.

One in-progress flag drops a repeated older-load trigger. A separate insertion
promise gates send/generation, edit/autosave/move/copy/cancel/done, single/bulk
message deletion, clear and redisplay. Attachment completion and deletion/copy
confirmation recheck the gate before mutation. Ordinary calls acquire no new
async boundary when there is no insertion. The gate releases in finally (also
on failure) before MORE_MESSAGES_LOADED, so a completion listener can await a
mutation without deadlocking. The in-progress flag lasts through completion hooks.
General redisplay remains synchronous after its entry barrier. Existing extraction
fixtures supply the new idle gate; their ownership/cancellation assertions remain.
Extensions using these public entry points receive the same signatures and events;
direct arbitrary external array mutations are outside this queue.

P2 has no per-message rendered events in opens or older loads. No events were
invented. MORE_MESSAGES_LOADED fires once, after all fragments and completion
hooks. The existing P2 recorder compares names, count/order, arguments and
rendered-element connectivity exactly.

## Measurement

Linux, Node 24.22.1, headless Chromium 156, 1440×1000; deterministic seed
20261028, end-relative message shape, extensions disabled. Each run owns a fresh
synthetic data root and server. Archives are read-only `git archive` materializations
with a dependency symlink; no worktrees/checkouts/stashes/resets/ref writes.

A/B alternates base/head for **7 pairs per setting**, each with **3 older batches**
(28 ordinary workflows, 84 batches). Batch time is through showMoreMessages completion,
excluding the 500 ms quiet window and frame sweeps. The quiet window remains outside
the timer to drain long-task observation. This is a different interval from historical
P0–P2 tables. CSS overflow-anchor is explicitly disabled on both sides. A child-list
observer samples the original viewport anchor after each insertion task; the final
sample includes the completion hooks. Message IDs must be the exact contiguous
expected suffix after each load. Send at 2000/100 uses the same runs and the existing
fill/input-through-save-response timer after all three loads.

Values below are **median / nearest-rank p95**, n=7 per side in each row. At n=7,
p95 is the maximum. [Raw runs and alternating order](ab/comparison.json) and
[metrics with paired bootstrap intervals](metrics.json) retain all observations.
Long-task maxima are 0 when the observer reports no task >=50 ms; this does not
mean that there was no main-thread work. Layout/observer work is included, rather
than reporting only the fragment-construction budget.

| Messages/truncation | Metric (ms unless drift px) | Base median / p95 | Head median / p95 | Median delta |
|---|---|---:|---:|---:|
| 2000/100 | send | 486.19 / 980.32 | 495.13 / 625.47 | 8.94 |
| 2000/100 | older1/ms | 172.90 / 280.30 | 405.90 / 1055.60 | 233.00 |
| 2000/100 | older1/longestTaskMs | 173.00 / 281.00 | 0.00 / 118.00 | -173.00 |
| 2000/100 | older1/anchorDriftPx | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 |
| 2000/100 | older2/ms | 187.80 / 438.30 | 590.90 / 930.30 | 403.10 |
| 2000/100 | older2/longestTaskMs | 189.00 / 439.00 | 56.00 / 78.00 | -133.00 |
| 2000/100 | older2/anchorDriftPx | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 |
| 2000/100 | older3/ms | 188.80 / 361.20 | 815.70 / 1112.10 | 626.90 |
| 2000/100 | older3/longestTaskMs | 190.00 / 363.00 | 74.00 / 86.00 | -116.00 |
| 2000/100 | older3/anchorDriftPx | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 |
| 2000/500 | send | 1477.65 / 3251.39 | 1847.77 / 3002.84 | 370.12 |
| 2000/500 | older1/ms | 831.80 / 1340.40 | 11187.40 / 24343.40 | 10355.60 |
| 2000/500 | older1/longestTaskMs | 834.00 / 1343.00 | 207.00 / 360.00 | -627.00 |
| 2000/500 | older1/anchorDriftPx | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 |
| 2000/500 | older2/ms | 849.50 / 1372.90 | 19271.60 / 39171.40 | 18422.10 |
| 2000/500 | older2/longestTaskMs | 857.00 / 1385.00 | 291.00 / 486.00 | -566.00 |
| 2000/500 | older2/anchorDriftPx | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 |
| 2000/500 | older3/ms | 1176.20 / 2001.80 | 42314.40 / 51860.50 | 41138.20 |
| 2000/500 | older3/longestTaskMs | 1187.00 / 2028.00 | 665.00 / 1223.00 | -522.00 |
| 2000/500 | older3/anchorDriftPx | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 |

All measured batch order/count checks: **True**. Maximum head anchor drift:
**0 px**. Every head batch adds exactly 100 or 500 messages as configured.

## Equivalence and concurrency

[Exact DOM/Tab/event comparisons](equivalence-comparison.json) run separately from
latency with three older loads at both 2000/100 and 2000/500. DOM snapshots retain
the existing declared normalization and are stored as deterministic gzip; no new
normalization of styles, IDs, focusability or content was added.

- 2000/100: exact comparison equal = **True**.
- 2000/500: exact comparison equal = **True**.

At 100 the native walk is complete. At 500 the physical walk is a bounded prefix; complete computed focus-order descriptors are compared in addition.

| Truncation | DOM snapshots | Physical Tab descriptors base / head | Computed order descriptors base / head | Event records base / head |
|---|---:|---:|---:|---:|
| 100 | 2 / 2 | 6694 / 6694 | 0 / 0 | 6 / 6 |
| 500 | 2 / 2 | 772 / 772 | 33008 / 33008 | 6 / 6 |

The [concurrent-send/reference comparison](concurrency-comparison.json) compares
full JSON chat data (only the appended send_date is normalized), exact DOM snapshot,
DOM IDs and recorder events. Both saved files are fetched through /api/chats/get
and compared to the full JSON chat array. The send begins in a child-list observer
after a partial insertion, and queues through the public sendMessageAsUser function.
The reference sends only after the batch completes. Double-trigger uses the same
partial-insertion trigger and requires only one completion and one 500-message load.

| Functional check | Result |
|---|---|
| chatEqual | True |
| domOrderEqual | True |
| domSnapshotEqual | True |
| eventsEqual | True |
| sendSavedMatchesChat | True |
| referenceSavedMatchesChat | True |
| triggeredDuringPartialSlice | True |
| doubleTriggeredDuringPartialSlice | True |
| doubleFinalCount | 1000 |
| doubleCompletionCount | 1 |

Send at 2000/100 changes by 1.84% at the median; its paired median-delta 95% bootstrap interval is [-175.34, 60.21] ms. This is a no-established-regression check, not a formal non-inferiority proof at n=7.

## Performance finding and acceptance

The 10 ms budget bounds preparation, **not synchronous browser layout**. The
profile in [diagnostics/layout-profile/](diagnostics/layout-profile/) shows the
anchor rect/scroll correction consuming 220.16 ms self over one 100-message batch
(13.40% of the full profiled interval, which includes idle waits), versus 94.10 ms
inclusive for updateMessageElement. Repeated layout and subsequent rendering work
grow with the accumulated DOM. This profile supports that layout cost is material;
it does not attribute all native/program time or prove which CSS rule causes it.
A single message/layout/extension callback cannot be preempted by scheduler.yield.

The requested P3 implementation is functional, but it **does not satisfy performance
acceptance and should not be treated as a successful optimization**. No CSS/layout
containment, DOM grouping, accessibility changes, render caching, DOM retirement or
P4 work is added to disguise this result. Removing anchor correction would violate
this step. The substantial total-time regression is retained in the evidence.

| Criterion | Result |
|---|---|
| Alternating >=7 per side, both settings, three batches | Met |
| Per-batch longest task <100 ms | Unmet: 100 includes a 118 ms task; 500 also exceeds 100 ms |
| Batch total-time increase <=20% | Unmet |
| Anchor drift <=2 px without CSS anchoring | Met |
| Message order/count, no duplicates/missing | Met |
| DOM/event equivalence and computed full focus order | See exact comparisons above |
| Full native Tab cycle at 500 | Unmet; bounded physical-prefix plus complete computed-order comparison used |
| Send during slicing matches reference and saved file | See functional table above |
| Double trigger starts exactly one load | See functional table above |
| Send at 2000/100 | Reported from the same seven pairs |
| Narrow tests, changed-file ESLint | Met locally; details below |
| Native Windows / six CI combinations / real Windows chat | Not run in this Linux workspace |

## Validation and diagnostics

[tests.json](tests.json): Node 20.19.2, installed Node 22 and Node 24.22.1 each run
18 focused long-chat tests (17 pass, 1 native-Windows skip) and 166 affected
ownership/lifecycle/media tests (166 pass). Per runtime: 183 pass, 1 skip, 0 fail.
Across three runtimes: 549 pass, 3 skips. ESLint passes on all 9 changed JS/MJS files;
git diff --check passes. Only the new fast deterministic browser-free test is
registered in test:perf; browser scenarios stay in the Python harness.

Diagnostics are separate from acceptance statistics:

- `initial-pilot`: one ordinary head workflow per setting. It exposed layout
  amplification and a reporting error when the new no-sweep mode had empty frame
  distributions. Reporting now renders missing frame measurements as unavailable.
- `layout-profile`: one ordinary and one profiled 2000/100 workflow, one older batch.
  CPU profile is gzip-compressed. These runs are excluded from A/B.
- `serialization-check-failed`: the first concurrency assertion used structuredClone,
  which retains undefined gen_started/gen_finished fields in swipe_info; these
  become null through the browser protocol, unlike JSON.stringify's omission
  in saved files. This was a
  deterministic harness mismatch. The check now uses the exact production JSON
  serialization; the failed record is retained. No retries or dropped A/B pairs.
- The initial 2000/500 full Tab walk exceeded its 600-second functional deadline
  (5501 keys per non-modal scenario, six such scenarios). That failed raw record
  and comparison remain in `equivalence/`. The test now records focus descriptors
  after trusted keyup dispatch, using the same descriptor function and every real
  Playwright Tab press, eliminating one RPC per key. Each walk checks its first
  16 observations against the original per-key RPC and asserts exact key count.
  The extended full-walk attempt in `equivalence-500/` was interrupted to bound
  validation cost; it has no completed run or graceful-shutdown telemetry. Its
  lab endpoint was unreachable afterward; its synthetic owner file was retained,
  without recovery or cleanup. `interrupted-run.json` records this outcome.
  The final `equivalence-500-bounded/` run compares all computed focus-order
  descriptors plus 128 trusted physical Tab presses per scenario (4 for the modal).
  This is a documented deviation: the full native 500-message Tab cycle is **not
  completed**, so strict full-native-walk acceptance remains unmet.
  No A/B latency runs are repeated. Executable product code remains unchanged.
- A new send-unit fixture initially omitted characters/this_chid; supplying those
  dependencies fixed its deterministic ReferenceError. No flaky test was rerun to green.

[shutdown.json](shutdown.json) records completed lab servers exiting zero and releasing their
owner locks. The interrupted test's shutdown telemetry is unavailable; its lab
endpoint was unreachable and its synthetic owner file remains. There was no
stuck shutdown being hidden. Started test process scopes and labs are stopped.
[evidence-index.json](evidence-index.json) lists SHA-256 hashes for raw run records
and compressed artifacts. Evidence is scanned for machine hostname, user paths
and absolute temporary paths, including decompressed gzip files.

Reproduction (substitute installed Python/Node paths locally):

```sh
python tests/browser-longchat-perf.py --base dfab84be2da4bb64ec3924ff8f60f4cc1ae2a18d --head WORKTREE --sizes 2000 --settings 100,500 --runs 7 --sliced-older --older-batches 3 --run-timeout 300 --output <new-output>/ab --node node
python tests/browser-longchat-perf.py --base dfab84be2da4bb64ec3924ff8f60f4cc1ae2a18d --head WORKTREE --sizes 2000 --settings 500 --runs 1 --equivalence --older-batches 3 --tab-limit 128 --run-timeout 600 --output <new-output>/equivalence-500-bounded --node node
python tests/browser-longchat-perf.py --sizes 2000 --settings 500 --runs 1 --no-profiles --open-only --older-scenario send --run-timeout 600 --output <new-output>/send --node node
```

Repeat the last functional command with reference and double in fresh output
directories, then compare as described above. No permanent user data is deleted.
