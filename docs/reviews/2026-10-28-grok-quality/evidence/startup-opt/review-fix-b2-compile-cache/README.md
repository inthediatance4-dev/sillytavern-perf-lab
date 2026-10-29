# Review blocker 2: compile-cache activation and isolated A/B

Decision: **keep P2-c**. The paired median difference for `server_main_import` is negative with a 95% confidence interval excluding zero, meeting the requested decision rule. HTTP and UI intervals include zero; this comparison makes no HTTP/UI speedup claim.

## Activation before application imports

The actual `server.js` statically imports only `src/compile-cache.js` and `src/server-directory.js`. Their static transitive imports are Node built-ins (`fs`, `module`, `url`, `path`). `enableStartupCompileCache()` executes before dynamic imports of startup tracing, command-line parsing and `server-main.js`. No restructuring was necessary.

An independent Node 24.22.1 full-server probe observed `module.getCompileCacheDir()` at module resolution time. The probe wraps the real `enableCompileCache` API only to select a **fresh** temporary cache, and installs a synchronous resolve hook that fails if command-line, server-main, Express or Webpack resolve without an active cache. It is separate from the timed experiment.

Observed order in [activation/activation.jsonl](activation/activation.jsonl): application files resolved before enablement were only `server.js`, `compile-cache.js`, `server-directory.js`; enable returned status 1 with an active cache directory; command-line, server-main, Express and Webpack subsequently resolved with that directory active. The first run wrote **1,819 cache entries**, reached HTTP readiness, exited 0 after SIGINT and removed its owner lock. [activation/result.json](activation/result.json) retains the cache file inventory. The probe runner/preload are retained beside these results; run `node activation/run.mjs` from the repository root using its full repository-relative path and a fresh `.evidence/review-fix-b2-probe` output location.

The new bootstrap regression executes the real `server.js`, compile-cache helper and server-directory helper in a synthetic project. Its command-line module checks cache activation **during evaluation**, so moving it back to a static import fails on supported Node versions. Its main graph imports that activation assertion, and the parent verifies cache files after process exit. Node 20 verifies the unsupported-API path without creating a cache directory.

## Experiment

Baseline materialization, before changing B1 product code:

```sh
mkdir -p <tmp>/startup-review-cc/cc-off
git archive HEAD | tar -x -C <tmp>/startup-review-cc/cc-off
# Edit only server.js: replace enableStartupCompileCache(); with a comment.
# Keep its static imports and dynamic import sequence identical.
ln -s <repo>/node_modules <tmp>/startup-review-cc/cc-off/node_modules
node scripts/measure-startup.mjs \
  --base <tmp>/startup-review-cc/cc-off --head WORKTREE \
  --scenario S3 --browser warm --runs 12 \
  --output .evidence/review-fix-b2-ab
```

Both harness and server runtime were Node 24.22.1. HEAD was `edce4e8d0b274efecbfd01d4751fa35ff3d54b3c`. The cache-on worktree product was still HEAD at measurement time; B1 runtime fixes were applied **after all measurements completed**, so they are not a second experimental variable. Concurrent documentation changes were outside the product code and the harness source fingerprint excludes docs. The archive control changes only the cache-enable call; the existing helper and all startup/lock/trace hooks remain in place. Shared installed dependencies were unchanged. Ordinary warmups populated both Webpack manifests and the cache-on Node compile cache.

The harness discarded one full server/browser warmup per side, then measured **12 base/head pairs**, in the order `01-base, 01-head, ... 12-base, 12-head`. Browser state is B-warm using the existing shared persistent profile. All 26 starts, including warmups, returned status OK, exited 0 and removed the owner lock. All 24 timed starts skipped Webpack using matching manifests. No tests or B1 runtime edits ran during timing. This is S3 synthetic data on this host; no broader startup scenario or tail-latency conclusion is drawn.

## Paired results

All values are milliseconds. Differences are **head minus base**. Bootstrap resamples iteration-pair indices together, calculating `median(head sample) - median(base sample)` for each draw, exactly as `medianDifference()` in `scripts/benchmark-statistics.mjs`. Seed: `opus-round1.5`; resamples: 2,000; 2.5% / 97.5% nearest-rank endpoints. Full precision and sample arrays are in [comparison.json](comparison.json).

| Metric | Cache off median | Cache on median | Difference | Paired 95% CI |
| --- | ---: | ---: | ---: | --- |
| `server_main_import` | 337.62 | 246.07 | **−91.55** | **[−106.58, −41.77]** |
| `imports_done` | 476.84 | 356.61 | −120.23 | [−141.96, −9.37] |
| `httpMs` | 633.78 | 555.27 | −78.50 | [−107.57, 90.74] |
| `uiMs` | 2689.23 | 2708.15 | 18.92 | [−115.48, 673.28] |

`server_main_import` is taken directly from each run's `trace.stagesMs.server_main_import` (begin → imported). `imports_done` is the trace event's `t.processMs`, elapsed process time at that milestone, rather than an invented begin/end stage. HTTP/UI use the unchanged harness metrics. `raw/comparison.json` is the original endpoint comparison; the top-level comparison adds stage-level paired bootstrap analysis. [analyze.mjs](analyze.mjs) reproduces that analysis from retained raw records and traces.

The decision rule allows keeping the cache when **either** server-main import or HTTP has a negative median difference and a 95% CI excluding zero. Server-main import meets it. No extra performance tests or stopping rule were used after seeing the results.

## Validation and retained files

Node 20.19.2 / 22.20.0 / 24.22.1 each pass **37 Webpack + 5 compile-cache = 42** targeted tests, with no failures or skips. This includes the original 19 Webpack cache tests. The cache helper, its test registration in `test:perf` and the early bootstrap are retained. ESLint and the Node 24 full `npm run test:perf` result are retained with the [B1 evidence](../review-fix-b1-manifest/README.md).

`raw/` retains redacted invocation metadata, individual run records, gzipped browser probes/server traces/logs, endpoint comparison and lock checks, including warmups. The browser profile stays ignored and is not evidence. Caches and synthetic fixtures remain recoverable on disk. No locks, fsync, identity checks, six-second probe budget or exclusive reconciliation behavior changed.
