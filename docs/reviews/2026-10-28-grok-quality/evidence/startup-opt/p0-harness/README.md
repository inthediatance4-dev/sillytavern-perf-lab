# P0 startup measurement harness

Measurement only: no startup speed optimization and no baseline claim. The old October reports supplied methods, never baseline numbers. Full S2/S3 matrices, user-scale tiers, third-party extensions and native Windows measurements remain for p0-baseline.

## Clocks and endpoints

- `t0`: epoch milliseconds plus `process.hrtime.bigint()`, sampled immediately before spawning the actual launch command. Server trace events have monotonic nanoseconds, epoch milliseconds and Node process milliseconds. `performance.nodeTiming` is sampled once.
- `httpMs`: T0 to the first successful `/csrf-token` JSON containing a nonempty token, followed by `/lib.js` HTTP 200 (body drained). Poll interval 10 ms; HTTP deadline 120 s. This is observation time, including polling/HTTP overhead.
- `uiMs`: T0 to sticky APP_READY, no onboarding/dialog/splash, visible main UI and a visible synthetic character card. The helper opens the character drawer when necessary. `navigationToUiMs` separately records navigation invocation to that same endpoint. The browser uses wall-clock epoch milliseconds mapped to the parent's T0 epoch (approximately 1 ms clock quantization); server readiness and fake receipt use monotonic time.
- `sendMs`: T0 to receipt of `/v1/chat/completions` by the localhost fake provider, before reading its body. The helper opens the only/recent seeded chat, verifies both messages, uses the application's Connect button, fills the real textarea and clicks Send. It then verifies the fake reply renders. No intercepted/fabricated application generation request.
- Stage durations: `httpMs`, `uiAfterHttpMs = uiMs - httpMs`, `sendAfterUiMs = sendMs - uiMs`. The six comparison metrics also include the three cumulative/navigation endpoints. All six get paired bootstrap median-difference 95% intervals using the existing statistics module, seed `opus-round1.5`, 2,000 resamples. Trace stage durations, RSS and browser diagnostic samples are retained as diagnostics, not additional optimization hypotheses.
- Trace begin/end pairs cover imports, owner lock, actual identity-provider attempts, user storage, legacy hold restoration, lifecycle scans/reconciliation, migrations, plugins, Webpack, and listen. `fileCount` counts regular files visited in the existing scan; no extra scan. Identity checks, budgets, locks, fsync and exclusive reconciliation ordering are unchanged. `powershell_spawned` is observed from spawn hooks; the synchronous PowerShell event records the attempt, including a failed spawn. Webpack built/cached module counts describe its existing compilation, not a promise that every filesystem cache lookup hit.
- Event-loop block total is a **10 ms timer lateness estimate**, including scheduler delay and tracing overhead, from trace initialization through listen. It is not an exact CPU-blocking measurement. The final partial interval is sampled. Async child spawns in the server process are observed via diagnostics_channel; synchronous PowerShell is marked explicitly. Commands run before the server process (e.g. npm in a launcher) are included in T0 but not the server's child-spawn trace.

Frontend probe snapshots at UI and after send contain full navigation entries, resource timings/bytes/statuses, key API timings, extension script load endpoints, aggregate extension events, and Long Animation Frames with script/function attribution where Chromium supports it. `libJsEvaluatedByMs` is an upper bound: the global SillyTavern assignment after the module imports have evaluated; it is not an exact lib.js evaluation duration. There are no per-extension activation events in this product; the probe reports that limitation rather than inventing activation timings. CDP separately records logical HTTP 200, wire 200/304 and disk-cache responses: Resource Timing often reports cached resources as logical 200, so wire 304 must not be inferred from zero transfer bytes.

## Reproduction

Run from the repository root. The default runtime is Node v24.22.1 under the system temporary directory when installed, otherwise PATH `node`; `--node` overrides it. Python uses the supplied Playwright venv (`/tmp/pw-venv/bin/python`) and bundled Chromium, or `LAB_BROWSER_EXECUTABLE`. No packages are installed by the harness.

```sh
node scripts/describe-data-root.mjs --data-root '<your-data-root>'
node scripts/measure-startup.mjs --base HEAD --head HEAD --scenario S3 --browser warm --runs 24 --output .evidence/startup-same-commit
node scripts/measure-startup.mjs --scenario S3 --runs 30 --lock-only --output .evidence/startup-locks-30
```

`--base`/`--head` accept Git revisions (materialized with git archive and a node_modules symlink), directories, or `WORKTREE`. They must be provided together. Runs alternate base/head in iteration order; the bootstrap retains these pairs. Each side gets one discarded fixture/cache/browser warmup before samples. Browser-warm uses one shared persistent user-data directory for both sides **under output/browser-profile/** at a stable origin throughout the invocation. Browser-cold creates a fresh context. Chromium launch is outside navigation measurement. Runtime fixture roots and Webpack caches remain in retained temporary directories; browser profiles are gitignored. Output directories cannot overwrite an earlier invocation.

The fixture has one synthetic card and one chat with two short messages, a fake custom OpenAI endpoint, built-in extensions enabled and extensions.autoUpdate false. Default shipped presets/assets may also seed. The fixture's settings/card/chat are reset before each launch while no owner lock exists. `describe-data-root` counts flat character cards (not PNG sprites in nested directories), recursive chat JSONL files, flat groups/worlds, and installed user extension directory names, without opening file contents or following links. Run it on the user's real root later to design realistic scale tiers.

```sh
# S1: move each version's cache into _webpack/.recycle; retain outputs and older recycled caches.
node scripts/measure-startup.mjs --scenario S1 --browser cold --runs 1 --output .evidence/startup-s1
# S2: sync then noninteractive sudo writes 3 to /proc/sys/vm/drop_caches; cached Webpack data is retained.
node scripts/measure-startup.mjs --scenario S2 --browser warm --runs 7 --output .evidence/startup-s2
# Explicitly unflushed S2 capability check; never call this a true cold baseline.
node scripts/measure-startup.mjs --scenario S2 --skip-drop-caches --lock-only --runs 1 --output .evidence/startup-s2-unflushed
# Separate profiling invocation, excluded from timing comparisons.
node scripts/measure-startup.mjs --profile --runs 1 --output .evidence/startup-profiles
```

Linux S2 requires sudo access; unavailable cache dropping fails instead of silently continuing. Webpack root selection respects the product's Docker `dist/_webpack` behavior. `--profile` retains gzipped Node CPU and Chromium traces separately; profiles span launch through shutdown, so use listen_ready when isolating startup CPU samples.

A launch override inherits `ST_LAB_NODE`, `ST_LAB_CONFIG`, `ST_LAB_DATA_ROOT`, `ST_LAB_PORT`, and `ST_STARTUP_TRACE`. It runs in each product tree and **must use the provided isolated config/root/port**, with exclusiveDataRoot true, listen false and IPv4 127.0.0.1. Example on Linux:

```sh
node scripts/measure-startup.mjs --launch 'exec "$ST_LAB_NODE" server.js --configPath "$ST_LAB_CONFIG" --dataRoot "$ST_LAB_DATA_ROOT" --port "$ST_LAB_PORT" --listen false --exclusiveDataRoot true --enableIPv4 true --enableIPv6 false --listenAddressIPv4 127.0.0.1 --browserLaunchEnabled false' --runs 1 --output .evidence/startup-launch
```

For a single POSIX command, use `exec` as shown so the outer shell does not exit on SIGINT before reporting the server exit status. A multi-command launcher must forward signals, wait for the server, and report its exit status. `rejected-launcher-wrapper/` retains a capability check where a bare shell wrapper was correctly rejected after SIGINT, although its child removed the lock. The process group receives SIGINT, the launch process must exit 0, and the owner lock must be gone before the next run. A failed run is retained and stops the sequence. `--lock-only` omits Chromium and generation, testing real HTTP-ready launches and graceful lock removal.

For a later **native Windows Start.bat** measurement, use `--launch` to include its npm/install time and forward the same config/root/port arguments. This Linux harness currently rejects native Windows early: it still needs a platform Python-path option and a console-owning supervisor using CREATE_NEW_PROCESS_GROUP plus CTRL_BREAK_EVENT, forwarding SIGBREAK to graceful SIGINT as in the longchat lab entry. Do not substitute taskkill/TerminateProcess, which bypasses cleanup. Windows filesystem-cache coldness needs separately documented reboot observations. Native Windows is not claimed as validated here.

## Evidence and version identity

Acceptance results and environment details are listed below after completion. `invocation.json` retains runtime/OS/CPU/memory, exact tool-source hashes, product-source identity, arguments and launch configuration paths (redacted). Raw per-run traces, browser probes and server logs are gzip compressed. Browser caches and Webpack outputs are never committed. Paths and host names are redacted to `<repo>`, `<home>`, `<tmp>` and `<host>`.

The shared worktree's Git metadata is mounted read-only. A temporary clone is used to produce an actual tool commit and run identical-commit A/B measurements; a portable delivery bundle will be retained for applying the validated commits to opus-startup. The worktree's implementation files remain reviewable here.

## Calibration history

`rejected-separate-browsers/` retains the original failed same-commit comparison using separate browser processes (`8e677be`). The shared-context revision (`d63861c`) and its complete 12 + 24 paired measurements are retained in `rejected-early-context-probe/`: their pooled intervals passed, but final verification found probe-induced early-context ReferenceErrors. That entire protocol was rejected. Its README explains the fixed follow-up and pooling, with no sample removal.

The final probe handles the exact expected initialization ReferenceError in one shared hook, before subscribing to sticky APP_READY. `probe-recheck.txt` records a regression test that reproduces the early global assignment and timer retries without page errors. Both failures and corrections remain visible; rejected measurements are excluded from final acceptance.

## Environment and checks

Node **v24.22.1**, Playwright Chromium **156.0.8078.4**, Linux **6.12.94+**, x64, Intel Xeon, 8 exposed CPUs, 16,779,640,832 bytes exposed RAM. This is a shared virtual environment; scheduling/load variation is retained.

Targeted compatibility checks: **119 pass, 0 fail, 3 platform skips** (`targeted-tests.txt`), followed by **30 pass, 0 fail** after final backend tracing adjustments (`final-recheck.txt`), and **6 pass, 0 fail** for the final browser probe/tracer (`probe-recheck.txt`). Coverage includes template preload, lazy imports, cache identity/compiler failures, ownership/identity budgets, lifecycle reconciliation and harness failure handling. This is targeted validation, not a claim that every repository test was run.

Native Windows, real cache-dropping S2, realistic user scale, third-party extensions and the full baseline matrix remain unmeasured. The explicit unflushed S2 capability check must not be described as a cold baseline. Existing Jimp average-color containment warnings with symlinked dependencies remain in the server logs; no product change suppresses them.

## Final immutable self-check

Tool code commit **`962fa78cf871568673ce17152b235584e8cca4e5`**. Both sides in `same-commit/` are git archives of that exact commit with matching product source hashes. The evidence-only delivery commit retains the same tool code.

**PASS:** 24 alternating S3 B-warm runs per side; all six paired median-difference 95% intervals include zero. All 48 measured runs reach UI/send, have no page errors, exit 0 and remove the owner lock. `comparison.json` is the complete final comparison with its tool commit added; `same-commit/comparison.json` is the original runner output. No final-protocol samples were removed or pooled with the rejected protocols. The intervals are broad in this shared environment and do not establish equivalence or a speed improvement.

`verify-evidence.py` checks endpoint ordering, exact tool hashes, identical product revisions/hashes, empty page-error lists, all six intervals, shutdown/lock records, and redaction including decompressed evidence. Run it from the repository root.

**PASS:** `locks-30/` uses final tool commit `962fa78` and records 30 consecutive S3 HTTP-ready launches plus a discarded warmup. Every SIGINT exits 0 and every owner lock is gone before the next launch. `lock-check.txt` is a direct copy of that complete check.

Capability checks also pass: `s1-cold-smoke/` tests S1 and fresh browser contexts through real UI/send (run before the probe retry correction; these two pages have no errors). `cache-recycle-check.json` verifies retained cache files in .recycle, a rebuilt cache, retained output, and real module compilation. `s2-unflushed-launch-smoke/` verifies explicit cache-drop skipping, kept Webpack cache (zero rebuilt modules), and a POSIX exec launch override with clean shutdown. `profile-smoke/` verifies separate Node CPU/Chromium trace capture; both gzip files parse as nonempty profiles. Profiling times are excluded from calibration. `capability-checks.json` records format validation. These are harness capability checks, not a baseline matrix or profile analysis.

## Delivery limitation

The original worktree remains based on `c3a1b34`: its shared Git metadata is mounted read-only, and git add fails while creating index.lock. The validated commits are prepared on the same named branch in a temporary clone; `.evidence/startup-p0.bundle` is the portable delivery artifact. No push was attempted. Applying those commits to the original branch requires making its shared Git metadata writable. The requested completion-note directory is also outside the permitted writable roots; a local `.evidence/p0-harness-done.txt` is supplied as fallback.
