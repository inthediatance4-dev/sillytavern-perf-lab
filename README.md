# SillyTavern performance lab

This research fork combines SillyTavern 1.19.0 with chat reliability, lifecycle,
startup and frontend experiments. Use **`codex-improvements`** for the current
reviewed work. `codex/sillytavern-1.19-sync` is the earlier integration base;
the other candidate branches and dated evidence describe historical experiments.
This is an isolated lab, not a production release.

With the package dependencies installed and Node.js 20 or newer, run from the
repository root:

```sh
npm run test:perf
npm run lint
npm run perf:lab
```

`test:perf` runs 33 test files with synthetic fixtures (some bind localhost
sockets). The three independent historical-oracle suites skip gracefully when
Git or their historical objects are unavailable; a full-history checkout enables
those comparisons. `bench:perf` still requires historical Git objects.
`lint` parse-checks project source and enforces selected rules on lab modules,
scripts and tests; it is not a full recommended-rule gate.

`perf:lab` opens a server at **http://127.0.0.1:8780/** using this checkout's
`.lab-data/` and `.lab-config.yaml`. Every launch enforces loopback, disables SSL,
browser launch, extension auto-updates and server plugins, and rejects inherited
`SILLYTAVERN_*` overrides. It refuses an occupied port and sets
`exclusiveDataRoot`, so the server creates `<dataRoot>/.st-lab-owner.lock`
and a second opted-in process cannot share that directory. Use synthetic data
and one server process per data root. See [ISOLATION.md](ISOLATION.md) for recovery,
limitations and dated evidence, and [中文说明](README.zh-CN.md).

`python tests/browser-performance-lab.py` and `python tests/browser-lifecycle-lab.py`
target that same origin. `LAB_URL` or `LAB_ORIGIN`, `LAB_BROWSER_EXECUTABLE`, and
`LAB_EVIDENCE_DIR` override the URL, browser, and evidence directory. An unset
browser path uses Playwright's bundled Chromium. Evidence defaults to
`.evidence/browser/`. The page has no separate lab marker; the scripts check the
SillyTavern title and origin, then create synthetic data only. Install Playwright
and its Chromium (`playwright install chromium`) before running them.

Current verification (2026-10-25, Node 20.19.2): the socket-free `node --test`
selection reports **20 tests passed**, one runner entry per selected file in this
sandbox. This is not the full suite's individual-case count or browser acceptance.
The full run reports 28 file entries: 20 passed and 8 failed in suites requiring
localhost listeners denied by this sandbox. The old 442/442 result belongs to
the dated 1.19 sync evidence.

## CHANGES

Recent reviews added character edit lifecycle locks, shutdown request/handler
draining, group-history path validation and repeated launcher isolation checks.
Shutdown drain now also tracks sync handlers that return a promise and stops
waiting after `SILLYTAVERN_DRAIN_TIMEOUT_MS` (default 30 seconds).
`backups.common.numberOfBackups` limits visible backup files only.
`backups.chat.maxRecycleBytes` (default `-1`, unlimited) can prune oldest
artifacts already inside the backup directory's `.recycle` folder.
Deliberate character create and rename targets can reuse an absent retired
name. The marker is recycled only after that create or rename publishes; a
failed attempt restores it when the visible path is still absent. An ordinary
save of a path that is still retired still conflicts.
Character merge, including bulk merge, still uses `withCharacterEdit`, and
rename still takes the card and chat locks in one `withPathLocks` call.
Ordinary file operations take a shared lock on the parent directory and an
exclusive lock on the file, so different group chats in one directory can
proceed together. Directory retirement, rename, delete, and backup pruning
take that directory exclusively and are not starved by later shared holders.
In-process shared/exclusive path locks are always on and use a queue; they create
no lock files. Keys are reserved in sorted order before any wait. Nested calls
cannot wait on a key already held exclusively or upgrade a shared key to exclusive.
The backup writer waits for its originating and enclosing reservations to release;
unrelated holders do not postpone it.
Concurrent servers sharing a data root are unsupported. Use the exclusive
data-root owner lock to prevent a second cooperating server from starting.
`exclusiveDataRoot` is off unless the lab launcher or config turns it on. The owner file records pid, host,
start time, a random token, and, when the host can provide them, a boot id
and the process start time. Linux uses `/proc/sys/kernel/random/boot_id` and
`/proc/<pid>/stat` starttime plus `btime`. Windows stores a best-effort
`win-boot:` time from `os.uptime()` (samples within 120 seconds match).
When both sides have `processStartMs`, that value decides: a match stays
live even if `bootId` differs, and a mismatch is reuse even if the boot
stamps match. An exact Linux boot id is used only when neither side has a start time.
Approximate Windows boot estimates never authorize reclaim of an existing PID. A
start time on only one side stays live. If two local samples more than 2
seconds apart fall outside the 120 second window, later payloads omit the
unstable `bootId` and keep pid, token, and `processStartMs`. Process start
comes from a PowerShell probe and is omitted when the probe is
missing or slower than 200ms; same-boot pid reuse then cannot be told
apart. Only this process's own start time is cached; foreign PIDs are re-probed.
A later start refuses while `process.kill(pid, 0)` reports the pid
alive, including `EPERM`, and that identity still matches. A mismatch is
pid reuse and is reclaimed. An older lock with neither identity field is
kept while its pid is alive. A dead same-host owner, or a reused pid, is reclaimed by exactly one
process: it creates `<dataRoot>/.st-lab-owner.lock.reclaim` with `O_EXCL`,
renames the stale owner file aside, checks the bytes, and only then deletes
them and creates the owner file with `O_EXCL`. That reclaim file expires by
age, so a crashed reclaimer cannot block the next start. A lock from another
host is left in place, as is a symlink or an unreadable file.
The owner file is removed on exit when its bytes still match, including
`process.exit` and an uncaught exception. A signal that skips the exit hook
can leave the file; the next acquire on this host reclaims it. No compiler is
required. If an unexpected filesystem error means ownership cannot be
determined, startup logs a warning and continues. A live owner on this host
still refuses the second process. The owner file is the whole-root gate.
Path queues coordinate work within this process only. Every server using a data
root must enable `exclusiveDataRoot`; external writers are outside this guarantee.
Owner reclaim and release use bounded short cleanup names. Failed release keeps
ownership bookkeeping so an explicit release can retry.
This follow-up reports failed character publications correctly, falls back to a
detached JSON prompt snapshot when structured cloning is unavailable or rejects a
value, and skips unavailable historical test oracles. Unserializable prompt data
leaves the stored record intact.

## Upstream

SillyTavern: LLM Frontend for Power Users

## Resources

- GitHub: <https://github.com/SillyTavern/SillyTavern>
- Docs: <https://docs.sillytavern.app/>
- Discord: <https://discord.gg/sillytavern>
- Reddit: <https://reddit.com/r/SillyTavernAI>

## License

AGPL-3.0
