# P2-a / P2-c: S3 B-warm alternating A/B

Base: archived `9360604` (pre-optimization tip, public and server sources). Head: optimized WORKTREE based on that commit. The Git worktree's index is mounted read-only, so no local optimization commits could be created; nothing was pushed. `source-checksums.json` identifies the complete changed product/test files, including the two new helpers which the unmodified harness's tracked-file aggregate does not include. The harness is unchanged from `9360604`; its invocation records its own file checksums.

## Environment and method

Linux 6.12.94+ x86_64, 8 logical CPUs, Intel Xeon Processor, approximately 16 GiB RAM; Node 24.22.1; Playwright Chromium 156.0.8078.4; headless. Synthetic lab data: one character and short chat, built-in extensions only, update checks disabled. `exclusiveDataRoot=true`. Launch: `node server.js` with the harness's isolated configuration/data-root arguments.

The pre-existing `node_modules` link pointed outside the writable worktree. For local measurement only, an ignored dependency directory containing links to the same installed packages supplies a writable `.cache` directory. The original link is retained in the ignored fixture recycle directory; installed package contents were unchanged. Node's cache API was independently confirmed to return ENABLED on Node 24. This local layout is not part of the patch.

Command (repository-relative output):

```sh
node scripts/measure-startup.mjs --scenario S3 --browser warm --base 9360604 --head WORKTREE --runs 12 --node /tmp/node-v24.22.1-linux-x64/bin/node --output docs/reviews/2026-10-28-grok-quality/evidence/startup-opt/p2-ac-ab/s3-bwarm
```

Both sides receive one discarded full-build/cache/browser warmup. Then 12 pairs run base/head in alternating order, using the harness's single shared persistent B-warm browser profile. OS page cache, compiler cache, and the available Node compile cache remain warm. Profiles and runtime data/cache directories are retained outside committed evidence. Native Windows and S2 cache-drop timings were not run; these numbers apply to S3 Linux only. First-build timings are excluded from the comparison.

T0 is immediately before process launch. `httpMs` ends after `/csrf-token` supplies a token and `/lib.js` is successfully fetched; `uiMs` ends at APP_READY with the character visible; `sendMs` ends when the local fake OpenAI-compatible server receives generation. All three are absolute from T0. Webpack and server_main_import are the existing high-resolution begin/end trace stage durations. `ui − http` and `send − ui` are successive endpoint differences.

Statistics use the unchanged `scripts/benchmark-statistics.mjs`: 2,000 bootstrap resamples, seed `opus-round1.5`, resampling iteration pairs together, head median minus base median, percentile 95% intervals. `s3-bwarm/comparison.json` contains endpoint results; `s3-bwarm/stage-comparison.json` adds trace stages using the same functions and retains samples. Significance is claimed only when the whole interval excludes zero.

## Results (milliseconds)

| Metric | Base median | Head median | Head − base | Bootstrap 95% CI | Significant? |
|---|---:|---:|---:|---|---|
| httpMs | 1432.1 | 628.8 | -803.2 | [-1463.3, -391.6] | yes |
| webpack stage | 814.9 | 35.0 | -779.9 | [-1290.0, -714.5] | yes |
| server_main_import stage | 387.9 | 286.3 | -101.5 | [-262.1, 83.0] | no |
| uiMs | 4405.1 | 2872.6 | -1532.5 | [-2375.3, -156.9] | yes |
| sendMs | 5237.9 | 3586.6 | -1651.3 | [-2498.5, -115.2] | yes |
| ui − http | 2612.7 | 2249.4 | -363.3 | [-959.0, 501.3] | no |
| send − ui | 774.1 | 723.2 | -50.9 | [-249.5, 38.5] | no |

The combined change significantly reduces the webpack stage and HTTP readiness. The absolute UI and send endpoints also improve in this sample. The separate browser segments have intervals containing zero; they do not establish a frontend-phase speedup. **The server_main_import interval includes zero: this run does not prove a P2-c compile-cache speedup.** P2-c remains an optional, fail-safe cache; no separate causal performance claim is made for it.

All 12 measured head runs report `webpack_skipped=true`, `durationMs=0`, `builtModules=0`. Their nonzero enclosing webpack stage includes SHA-256 verification of inputs and outputs. `assets.json` confirms the full-build manifest's lib.js SHA-256 equals the live lib.js SHA-256 after the measured skip runs; the real-Webpack unit test independently checks full/skip bytes and hashes. A missing manifest always forces compilation even when outputs exist.

All 24 measured runs and both discarded warmups exited with code 0 and removed the data-root owner lock. Raw run metadata, redacted trace/log/browser payloads and `lock-check.txt` are retained under `s3-bwarm/`. No fsync, path lock, data-root lock, process-identity check, six-second budget or exclusive reconcile-before-listen protection was relaxed.

## Validation and handoff

- `npm run test:perf`: Node 20.19.2, 22.20.0 and 24.22.1 each passed **752**, failed **0**, skipped **8** platform-specific tests (760 total). Redacted complete logs: `full-node20.log.gz`, `full-node22.log.gz`, `full-node24.log.gz`.
- Targeted Node 24 webpack + compile-cache suite: **28/28**, retaining all original 19 webpack tests and adding five cases plus four helper cases. The new helper test is included in the existing six-way CI matrix command.
- Additional startup/failure/trace/lazy-import check: Node 22 **60/60**. Node 20 **59/60**; its unchanged, trace-only disabled-resource assertion observes a transient `CloseReq`, reproduced in an isolated retry (4/5 trace tests). The trace test and module are byte-identical to base and this check does not load server.js or either new helper. This test is outside `test:perf`; all new and full CI tests on Node 20 pass, including real application startup/failure safety checks.
- ESLint passed on every changed JS/MJS file. Native Windows CI was not launched because pushing is prohibited; the existing Node 20/22/24 × Linux/Windows workflow is retained.
- Intended commits: `perf(startup): enable Node compile cache when available (P2-c)` and `perf(startup): skip webpack when input and output identities match (P2-a)`. Coordinator must commit the prepared files because the shared Git metadata is read-only here.

Implementation details and scope are in `../p2-a-webpack-manifest/README.md` and `../p2-c-compile-cache/README.md`. `p2-done.txt` is the coordinator handoff copy; the requested sibling handoff directory is outside this session's writable roots.
