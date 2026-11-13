# P2: message insertion path

Base: `c7b38d8eb18b0cbdae8b15fd2d52e3e7f3e56e34` (P1 steps 1+2). Head: WORKTREE on `opus-longchat`. Product changes are confined to `public/script.js`. No commits, refs, branches, persistence, lifecycle, locks or retention settings are changed.

## Profile first, before changing product code

The full Chinese plan, measurement-only summary and baseline README were read first. [preprofile/](preprofile/) was captured while the product still equalled base, at both 2000/0 and 2000/100, before any product or harness edit. Each setting has one ordinary companion and one open CPU capture; these are diagnostic observations, excluded from the alternating A/B. CPU sampling interval: 100 µs. [preprofile-lines.json](preprofile-lines.json) retains every requested function's line ticks, source text, self budget and native-call parent stacks. Lines below refer to **base** script.js.

`positionTicks` are line-level self sample counts. The JSON also apportions each node's timeDelta self budget over its ticks as an estimate; it does not claim exact per-line wall time. Native children are reported separately by their full parent stack. A call frame's line is the function's start, not the native operation's call site. Unobserved frames/ticks do not imply zero work.

| Function | 2000/0 self ms / line ticks | 2000/100 self ms / line ticks | Interpretation |
|---|---|---|---|
| updateMessageElement | 13.203; L2708:13, L2769:9, L2730:7, L2713:7, L2763:7, L2710:6, L2765:6 | 0.464; L2748:1, L2764:1, L2763:1 | Timestamp, counters, local fields, media, formatting and code blocks; most inclusive work is in children |
| addOneMessage | Unobserved | Unobserved | Opening an existing chat does not call this single-message entry point |
| printMessages | No self sample | 0.154; L1558:1 | Awaits redisplayChat, then schedules one scroll |
| redisplayChat | 1.077; L1583:4, L1596:1, L1600:1, L1603:1 | 0.308; L1583:1, L1591:1 | Already constructs messages off-document, then appends once |
| doScroll | 456.390; L2847:2834 | No self sample | L2847 reads scrollHeight, requiring the inserted document's geometry |

| Native self cost / sampled ancestor | 2000/0 ms | 2000/100 ms | Source inspection and decision |
|---|---:|---:|---|
| querySelectorAll → jQuery find → updateMessageElement | 22.206 | 1.389 | Field queries at L2728–2765 already use the current message element |
| querySelectorAll → addCopyToCodeBlocks | 13.956 | 0.771 | L2548 already scopes pre/code queries to the message |
| getPropertyValue → jQuery show/toggle → refreshSwipeButtons callback | 287.041 | 13.427 | L9555 (and L9548) toggle pickers after per-message class writes; repeated style invalidation/read alternation |
| querySelectorAll → keyboard traversal | 436.761 | 2.923 | Outside P2; P1 code remains unchanged |
| querySelectorAll → applyA11yRules | 169.093 | 3.295 | Outside P2 |

The pre-edit 2000/0 profile attributes 32.02% inclusive to updateMessageElement, 43.87% to redisplayChat, 8.18% to doScroll, and 5.70% to refreshSwipeButtons. These overlapping shares include idle/native/harness time in the denominator.

## Focused implementation and applicability

- Both synchronous batch entry points (`redisplayChat` and `showMoreMessages`) capture persona/character thumbnail URLs and the timestamp-model-icon setting once per batch. Message-specific forced avatars still take precedence. `updateMessageElement` accepts an additive optional batch context; existing callers, defaults, return type and positional parameters remain compatible. Single-message callers construct a fresh context.
- Both batches explicitly build a DocumentFragment and insert it once through the existing jQuery insertion point, retaining jQuery script handling. Upstream already effectively batches through jQuery's internal fragment, so this is not claimed as a newly eliminated per-message insertion.
- The profiled `refreshSwipeButtons` now finishes message-class writes before grouping hidden and visible picker updates. It retains jQuery toggle/show behavior, including custom CSS handling, all matched picker elements, and the existing public signature. This removes the observed class-write/style-read alternation. It is part of the existing batch insertion path despite not being listed among the plan's example function names.
- Query scoping: **already applicable upstream**. The relevant rendering helpers use messageElement.find, pass the current element to updateSwipeCounter and reasoning helpers, and use the global chat only for insertion targets/last-message bookkeeping. No document-wide per-message query was replaced speculatively. No repeated CSS-variable reads exist in these loops; the measured getPropertyValue calls are jQuery display reads, not CSS variable reads.
- Render events: **no new per-message events**. Existing-chat opens emit CHAT_CHANGED then CHAT_LOADED, older loads emit MORE_MESSAGES_LOADED, and send emits USER_MESSAGE_RENDERED after insertion. No MESSAGE_RENDERED constant exists. The plan's assumed per-message open/load events are absent. Moving or adding events would break the required order/count contract, so original call sites remain untouched. No extension-visible insertion/event ordering changes or compatibility flag are needed.
- Scrolling: **already once per batch**. printMessages schedules one scroll after redisplay; doScroll uses cancellable rAF coalescing. showMoreMessages adjusts its height anchor once after insertion. There is no per-message doScroll to remove. Its scrollHeight layout read is necessary to preserve scrolling and was left intact. Media adjustment and single-message send/receive logic stay intact. No P3 time slicing or P4 DOM retirement is introduced.

## Method

Linux, Node 24.22.1, headless Chromium 156.0.8078.4, 1440×1000, seed 20261028, deterministic end-relative data shape, extensions disabled except the tiny equivalence recorder. Each archived base is materialized by git archive piped to tar, made read-only, and uses the workspace node_modules symlink. Each run has its own owned temporary data root and server. Timing jobs are sequential, alternating base/head for seven pairs at each setting; no profile/test job overlaps the timing matrix. Failed attempts are retained; none are replaced.

Open includes two rAF and a 500 ms long-task quiet window. Older-batch ms includes the same quiet window. Send retains the existing fill/input-through-save-response timer and occurs after two scroll sweeps and three older batches: 400 messages in DOM at truncation 100. Send's post-save render assertion is outside the timer. The P2 harness additionally records fill time and send long tasks; event listeners are installed only for equivalence runs. Profile-mode ordinary companion runs are excluded from A/B statistics.

## Equivalence

[Exact comparison](equivalence/comparison.json) passes at 2000/100. Each normalized DOM snapshot is stored as deterministic gzip with a verified decompressed length and SHA-256. No styles, focusability, message identity or content fields are normalized away beyond the harness's previously declared volatile fields. Tab traversal uses actual Playwright key presses.

| Check | Base / head observations | Result |
|---|---:|---|
| DOM after open (100 messages) | 1 / 1 | Identical |
| DOM after one older load (200 messages) | 1 / 1 | Identical |
| Tab: older | 565 / 565 | Identical |
| Tab: real send append | 565 / 565 | Identical |
| Tab: late interactable class | 567 / 567 | Identical |
| Tab: disabled ancestor | 566 / 566 | Identical |
| Tab: enabled ancestor | 567 / 567 | Identical |
| Tab: popup open | 4 / 4 | Identical |
| Tab: popup closed | 567 / 567 | Identical |
| All Tab descriptors | 3401 / 3401 | Identical |

The tiny test-extension recorder registers through the application's public eventSource before open, without replacing emit. All available `*_RENDERED` types plus `MORE_MESSAGES_LOADED`, `CHAT_CHANGED` and `CHAT_LOADED` are registered (six types). Arrays preserve event order/count and arguments. Generated current-chat IDs alone become `<chat-id>`; `CHAT_LOADED`'s mutable full card is projected to character index/avatar/name, avoiding generated creation timestamps. Rendered message IDs and any additional render-event arguments are retained exactly. Zero-occurrence render-event types are still listed as registered.

| Phase | Exact ordered event records, both sides | Message connected when observed |
|---|---|---|
| Open | CHAT_CHANGED(`<chat-id>`), CHAT_LOADED({detail:{id:"0",character:{avatar:"LongchatSynthetic.png",name:"Longchat Synthetic"}}}) | No per-message rendered event upstream |
| Older load | MORE_MESSAGES_LOADED() | Complete batch inserted before event |
| Send | USER_MESSAGE_RENDERED(2000) | true on both sides |

No event-order/count/argument difference was found; no compatibility fallback was necessary. This validates the synthetic core and recorder, not arbitrary third-party extensions or a real Windows chat.

## Historical send bimodality: bounded diagnosis

[send-bimodality.json](send-bimodality.json) preserves the seven existing P1-2 raw records per side and phase decomposition. That step's **base** was `f6c0053`; this P2 A/B base is `c7b38d8`, its completed P1-2 head. These are not interchangeable baselines. A transparent 1000 ms split describes the visibly separated historical samples; it is not a fitted statistical mixture model.

| Historical P1-2 side / mode | n | Send median ms | HTTP interval median ms | Server median ms | Median time outside HTTP ms |
|---|---:|---:|---:|---:|---:|
| base fast | 4 | 725.99 | 197.00 | 33.50 | 520.54 |
| base slow | 3 | 1462.32 | 297.54 | 88.55 | 1059.26 |
| head fast | 3 | 527.01 | 178.88 | 27.29 | 348.13 |
| head slow | 4 | 1209.81 | 395.03 | 66.09 | 826.28 |

Most historical slow-mode excess occurs **outside the HTTP request-to-response-end phase** (about +539 ms on the historical base), with a smaller HTTP contribution (about +101 ms) and server difference (about +55 ms). These medians are calculated independently and need not add exactly. The old records contain neither send long-task entries, fill/press timestamps nor a matching trace, so they cannot identify a named long task or distinguish pre-request input work from browser/driver delivery delays. Assigning it specifically to keyboard.js, doScroll, serialization, GC or a fixed debounce from those records would be unsupported. P2 adds fill-time and observed long-task diagnostics without changing the send timer; no separate send profiling or attempt to fix unrelated bimodality is performed.

## Alternating A/B results

Values are milliseconds, **median / nearest-rank p95**, n=7 per side for every row. At n=7, p95 is the maximum. [metrics.json](metrics.json) retains raw samples, per-side median/p95 bootstrap CIs and paired median-delta CIs; [ab/comparison.json](ab/comparison.json) records the exact alternating order and exits. Bootstrap uses the existing benchmark-statistics implementation, 2000 paired resamples, seed `opus-round1.5`. Delta is head minus base.

| Messages / truncation | Metric | Base median / p95 | Head median / p95 | Median delta [CI95] |
|---|---|---:|---:|---:|
| 2000 / 100 | Open ms | 806.20 / 1073.30 | 820.50 / 850.90 | 14.30 [-16.80, 35.00] |
| 2000 / 100 | Open longest task ms | 183.00 / 363.00 | 193.00 / 207.00 | 10.00 [-11.00, 21.00] |
| 2000 / 100 | Open long-task total ms | 183.00 / 430.00 | 193.00 / 207.00 | 10.00 [-11.00, 21.00] |
| 2000 / 100 | Send through save response ms | 489.78 / 1061.65 | 507.57 / 682.05 | 17.78 [-69.38, 48.77] |
| 2000 / 100 | Older batch 1 ms | 720.40 / 983.50 | 719.90 / 815.50 | -0.50 [-10.90, 12.70] |
| 2000 / 100 | Older batch 1 longest task ms | 195.00 / 424.00 | 191.00 / 277.00 | -4.00 [-14.00, 7.00] |
| 2000 / 100 | Older batch 2 ms | 744.90 / 1253.50 | 739.70 / 812.70 | -5.20 [-70.20, 70.30] |
| 2000 / 100 | Older batch 2 longest task ms | 148.00 / 270.00 | 145.00 / 226.00 | -3.00 [-39.00, 28.00] |
| 2000 / 100 | Older batch 3 ms | 1200.00 / 1239.80 | 1233.90 / 1272.10 | 33.90 [-51.60, 64.30] |
| 2000 / 100 | Older batch 3 longest task ms | 165.00 / 287.00 | 162.00 / 168.00 | -3.00 [-58.00, 9.00] |
| 2000 / 0 | Open ms | 5234.10 / 7904.70 | 5307.30 / 6052.80 | 73.20 [-373.10, 288.10] |
| 2000 / 0 | Open longest task ms | 2532.00 / 3830.00 | 2558.00 / 2712.00 | 26.00 [-101.00, 215.00] |
| 2000 / 0 | Open long-task total ms | 4279.00 / 7042.00 | 4294.00 / 5211.00 | 15.00 [-372.00, 295.00] |

No measured median-delta CI excludes zero. The data does **not establish a total-open or older-batch speedup**. Default open's longest-task median increases from 183 to 193 ms while its p95 falls from 363 to 207 ms; all seven head observations meet 250 ms. Load-all open remains over five seconds. The send median point estimate increases 3.63% (489.78→507.57 ms), with paired delta CI [-69.38, 48.77] ms: no statistically established regression, but this is not a formal non-inferiority proof. No rerun was performed to change the result. The existing full-workflow harness also captured send at truncation 0; those unrequested supplemental observations remain in raw records and the existing comparison report, outside this step's acceptance table.

The P2 send sample contains one >1000 ms observation on base and zero on head (seven observations per side). Base's one slow observation has fill 111.70 ms, HTTP 287.18 ms, server 111.96 ms and outside-HTTP 774.47 ms; fast-base medians are 54.84 / 160.00 / 24.62 / 333.74 ms respectively. Its delivered long tasks total 245 ms with longest 132 ms, so there is no observed single task accounting for the whole ~572 ms slow/fast difference. Head's send median is 507.57 ms. This run does not reproduce a two-cluster head distribution, but n=7 and the differing historical frequencies cannot establish that P2 removed bimodality. Observer delivery may miss a final running task; no function-level attribution is invented.

## Open CPU profiles, 2000/0

One profile per side, gzip, requested sampling interval 100 µs. [profile-comparison.json](profile-comparison.json) records raw source hashes, weighted sampled budgets and native attribution. Base is the required pre-edit capture; head is [head-profile/2000-0-1-open.cpuprofile.gz](head-profile/2000-0-1-open.cpuprofile.gz). Companion ordinary runs are retained and excluded from A/B. Profiles were not captured concurrently with timing/test jobs.

| Function | Base inclusive % (ms) | Head inclusive % (ms) |
|---|---:|---:|
| updateMessageElement | 32.02% (1789.72) | 34.68% (1745.67) |
| redisplayChat | 43.87% (2452.40) | 47.60% (2396.36) |
| doScroll | 8.18% (457.47) | 9.12% (459.22) |
| refreshSwipeButtons | 5.70% (318.71) | 5.81% (292.27) |

Inclusive shares overlap and include idle/native/harness time in their denominator (5589.91 ms base, 5033.86 ms head). updateMessageElement's share **was not halved**: 32.02%→34.68%; its inclusive sampled time is 1789.72→1745.67 ms. jQuery getPropertyValue self time under refreshSwipeButtons is still 287.04→260.00 ms. Grouping the class writes did not remove the per-picker style-read cost. doScroll still spends about 456 ms self at the single scrollHeight read. These measurements do not justify claiming the planned 40% longest-task improvement or making unrelated formatting/keyboard/style-system refactors within P2.
## Validation, acceptance and cleanup

[validation.json](validation.json) retains exact commands (temporary executable paths redacted), Node versions, exit codes and full test output. The new three-case browser-free deterministic test is registered in `test:perf`. It checks that swipe refresh avoids repeated class-write/style-read flushes, retains every scoped picker match and historical/user/last-message state, retains fade and opt-in counters, and leaves empty/disabled paths intact. The existing measurement test now includes a negative event-argument comparison. Only four relevant test files were run: insertion path, measurement, media scrolling and chat transitions. ESLint covers all four changed JS/MJS files; Python compilation and diff whitespace checks pass.

| Local check | Tests / files | Pass | Skip | Fail |
|---|---:|---:|---:|---:|
| Node 20.19.2 | 79 tests | 78 | 1 | 0 |
| Node 22.20.0 | 79 tests | 78 | 1 | 0 |
| Node 24.22.1 | 79 tests | 78 | 1 | 0 |
| ESLint | 4 changed JS/MJS files | exit 0 | — | 0 |
| Python compile + diff whitespace | 2 checks | exit 0 | — | 0 |

The skip on each Node version is the native Windows console-break test, whose Linux simulation passes. An earlier successful default-PATH Node 24 narrow run was performed before the final event-negative-control assertion was added; the explicit three-version run above verifies the final code. No test failure, flaky retry or rerun-to-green occurred. The full suite was not run.

| Acceptance / plan expectation | Result |
|---|---|
| Profile both settings before editing, with line-level attribution | Met; addOneMessage is correctly unobserved on existing-chat open |
| Batch shared reads; explicit fragment insertion; scoped queries | Met where applicable; scoped queries and effective fragment batching already existed |
| Original event order/count/arguments and connected message on send | Met in the browser recorder; no event moved or invented |
| DOM after open and older load, all dynamic Tab scenarios identical | Met |
| Alternating A/B, >=7 per side at both settings, required open/older/send metrics | Met; all 28 ordinary workflows succeeded |
| 2000/100 open longest task <250 ms | Met; all seven head runs, median 193 / p95 207 ms |
| updateMessageElement share at 2000/0 halved | Unmet; 32.02%→34.68% inclusive |
| P1+P2 2000/0 open <3 s | Unmet; head median 5307.30 ms |
| Expected >40% open/older longest-task reduction | Unmet; median-delta CIs include zero |
| Default send regression guard | No statistically established regression; point estimate +3.63%, CI includes zero; formal non-inferiority not established |
| Local Node 20/22/24 narrow checks and lint | Met; 234 passes, 3 native-Windows skips, 0 failures |
| Six remote OS/Node CI combinations; Windows real-chat/manual extension checks | Unrun; Linux-only session, no commit/push requested |

All 36 browser workflows succeeded, including four pre-edit diagnostic workflows, two equivalence workflows, 28 alternating ordinary workflows and two head-profile workflows. All 32 isolated servers exited 0, reported no incomplete shutdown and removed their own ownership lock; Playwright browsers/contexts and drivers closed. [summary.json](summary.json) records every run/server observation and base/head script hashes. Temporary synthetic data roots and read-only archives are retained; no user data or lifecycle markers were deleted. No data root was shared between processes. No fsync, lock, token, identity, lifecycle, shutdown or default retention policy was weakened.

[privacy-integrity-audit.json](privacy-integrity-audit.json) covers decompressed profile/snapshot content, evidence privacy and snapshot verification; [raw-index.json](raw-index.json) records SHA-256 and sizes of the evidence files. Evidence contains no machine hostname, machine username or absolute temporary path. Profiles are gzip files.

## Reproduction

Use `PYTHON` for the installed Playwright Python and `NODE24` for the installed Node 24 binary; `OUT` must be a fresh evidence directory. Before the first product edit, the preprofile command was run with product HEAD equal to c7b38d8. For reproducing that pre-edit capture after applying this patch, point `--product-root` at a read-only c7b38d8 archive prepared by the existing harness's materialize helper. The A/B command materializes base automatically through git archive, never checkout/worktree/ref operations.

```sh
"$PYTHON" tests/browser-longchat-perf.py --sizes 2000 --settings 0,100 --runs 1 --open-only --profile-phases open --output "$OUT/preprofile" --node "$NODE24"
"$PYTHON" tests/browser-longchat-perf.py --base c7b38d8 --head WORKTREE --sizes 2000 --settings 100 --runs 1 --equivalence --run-timeout 180 --output "$OUT/equivalence" --node "$NODE24"
"$PYTHON" tests/browser-longchat-perf.py --base c7b38d8 --head WORKTREE --sizes 2000 --settings 100,0 --runs 7 --older-batches 3 --output "$OUT/ab" --node "$NODE24"
"$PYTHON" tests/browser-longchat-perf.py --sizes 2000 --settings 0 --runs 1 --open-only --profile-phases open --output "$OUT/head-profile" --node "$NODE24"
node --test tests/longchat-insert-path.test.mjs tests/longchat-measurement.test.mjs tests/media-load-scroll.test.mjs tests/chat-transitions.test.mjs
npx eslint public/script.js tests/longchat-browser-probe.mjs tests/longchat-insert-path.test.mjs tests/longchat-measurement.test.mjs
```
