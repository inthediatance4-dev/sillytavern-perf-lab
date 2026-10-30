# SillyTavern performance lab


## Deployment prerequisites and rollback

Supported/tested Node majors are **20, 22, 24** on Ubuntu and Windows CI. `.nvmrc` selects 24 to track the newer tested line; use `nvm use` and pin an accepted patch version in deployment. Upstream `engines.node >=20` remains unchanged and does not imply every later major is tested.

Enable `exclusiveDataRoot: true`, one server per data root, and require `npm run check:deploy -- --config ./config.yaml --data-root <root>` to exit 0 (all checks OK, informational lines allowed; no WARN/FAIL). Disk availability must be at least max(1 GiB, twice the logical bytes in chats, group chats, backups and any `.recycle/`), counting each file once without following symlinks. INFO shows available and recycled bytes; recycle retention defaults to unbounded (-1). Scan/statfs failure warns; the check is read-only.

Check listen addresses, whitelist and authentication separately: `perf:lab` forces localhost. Streaming exports currently hold locks throughout downloads; stalled clients can block saves, including other chats of the character when a directory writer queues. Exposure beyond localhost requires the round-4 timeout and lock-scope fix first. Back up the whole root and complete real-machine acceptance before deployment.

Follow the [Chinese rollback runbook](docs/ROLLBACK.zh-CN.md): stop NEW and verify its process has exited before restoring a whole-root backup including hidden directories or archiving an individually verified stale owner lock.

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

Current verification: [round-1.5 CI run 40656640441](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/40656640441)
at commit `7a0b029`: Node 20/24 × Ubuntu/Windows all green. Ubuntu: 591 tests,
590 pass, 1 skip; Windows: 591 tests, 578 pass, 13 skips, all with explicit reasons.
Windows CreationTime reclaim has only conservative refusal coverage; Windows has
no real-server SIGTERM e2e coverage. Deployment remains pending browser acceptance,
Windows hands-on acceptance and crash reconciliation.

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
Owner reclaim and release use bounded short cleanup names. Release read or cleanup
failures retain ownership bookkeeping and any pending cleanup path for explicit
release retries.
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

## Director button

### Opening it

Click the 🎬 button (`directorButton`) beside the message box. With the preset panel focused, 1–9 runs one of the first nine presets and Escape closes it. `/director <name or 1-based index> [text]` runs a preset from STscript, including Quick Replies, and STscript expands that argument before the preset runs. The hotkey field in the 🎬 Director drawer starts empty, and a global shortcut exists only after you set one.

### Modes

| Mode | Saved in the chat | Visible to the model | Upstream path |
| --- | --- | --- | --- |
| narrator | yes | yes | `/sys` (`sendNarratorMessage`) |
| comment | yes | no | `/comment` (`sendCommentMessage`) |
| instruct | no | yes, on the lifecycle below | `/inject` while pending; `setExtensionPrompt` while bound |

Narrator and comment go through those registered callbacks. A pending instruct calls `/inject` with ephemeral false, position chat, depth 0, role system, and scan false, and is stored on `chat_metadata.script_injects` with `directorEphemeral`. The generate interceptor `director_rebind_interceptor` copies a bound instruct through `setExtensionPrompt` as `script_inject_director-bound` at that same position, and that copy stays out of `script_injects`, so completing the generation keeps the binding.

### Presets

Eight presets ship in this order: 时间跳跃, 场景切换, 旁白, 新章节, 突发事件, 导演指令, 推进剧情, 备注. ⚙ 管理预设 opens the 🎬 Director drawer under Extensions, where you can reorder, add, delete, import or export version-1 JSON, or restore the defaults, up to 50 presets. `autoGenerate`（插入后自动生成）stays off until you enable it.

### Templates

`{{input:label|default}}` opens a popup; the first `|` is the default, Cancel inserts nothing, and `/director` text fills only the first input. `{{chapter}}` is one plus the number of chapter titles already in the chat. `substituteParams` runs only on the template's own text, so popup text such as `{{char}}` is copied through unchanged. STscript can still expand the `/director` argument itself. A saved narrator or comment `mes` stays literal on disk, but `PromptManager.preparePrompt` still runs `substituteParams` on saved chat messages in a later generation; instruct text in the request body keeps the typed macros.

### Chapters

A chapter marker lives on the message `extra.director` (`id`, `preset`, `chapter.title`) and is copied onto every swipe. The displayed number is counted from those titles when the chat is shown. 📖 章节 lists them, and a jump asks first when the target sits more than 500 messages before the loaded range. The message action 设为章节起点 marks or clears any message.

### Instruction lifecycle

A pending instruct becomes `chat_metadata.director.boundInstruct` only after `GENERATION_COMPLETED` when the request contains its text; a failed or stopped run keeps the pending instruct. `quiet` and `impersonate` leave that pending instruct out of the request and do not consume or bind it. Their extension prompts are removed for that run and restored on `GENERATION_ENDED`, `GENERATION_STOPPED`, or error. Swipe, `regenerate`, and `continue` send the bound text again when they still target that message, and that copy is not consumed; a pending instruct is the only one sent when one exists, and a successful consume replaces the binding. An ordinary send, impersonate, quiet, and any `normal` run, including the next group member and group regenerate, do not reuse it. The binding clears on `MESSAGE_SENT` (a user message, and also narrator or comment, because those emit it), on `MESSAGE_RECEIVED` after `slotIndex`, on `MESSAGE_DELETED` when the chat no longer reaches the previous message, the fingerprint of `is_user`, `name`, and `mes` no longer matches, or the bound message itself was removed (the temporary delete at the start of `regenerate` does not), when swipe, regenerate, or continue matches the slot but the fingerprint does not, when a new pending instruct is consumed, or from ✕ or 清除 on `#director_instruct_chip` (the label opens a view with 关闭 and 清除, and there is no editor). With no instruction that button is hidden; pending is orange (`#c45c12`, 🎭 待生效) and bound is gray-blue (`#5c6b80`, 🎭 重生沿用), the label keeps 16 Unicode code points with an ellipsis only when the text is longer, `title` and `aria-label` hold the full text, and switching chats leaves each chat's binding in place.

```text
pending → completed generation whose request contains the text → bound → cleared
```

## Streaming

### Optimized streaming

With `optimized_streaming` on, DOM updates coalesce to one paint per frame, run after that frame, and stay under `streaming_fps` (Streaming FPS in User Settings → Chat/Message Handling, default 30). The first visible chunk, including visible reasoning, is painted immediately, and later chunks replace only the changed tail (`isEqualNode`). Scrolling up stops following and shows ↓ 新内容 (`chat_new_content`); it stays, including after generation ends, until you are back within 40px of the bottom. `auto_scroll_chat_to_bottom` (Auto-scroll Chat) off never scrolls on its own, and that button is how you return to the bottom. `STREAM_TOKEN_RECEIVED` still fires once per chunk, before the DOM write.

### Fallback switch

The checkbox 使用优化的流式渲染 (`optimized_streaming`, `power_user.optimized_streaming`) is under User Settings → Miscellaneous and defaults to on. Off uses the original synchronous streaming path. Turn it off when an extension's streaming display is wrong, especially if it reads the bubble from `STREAM_TOKEN_RECEIVED` and expects every token to be on screen already. Impersonate and Stream Fade-In (`stream_fade_in`) stay synchronous even while the switch is on. The Director button does not depend on this switch.

### Known limits

A frame-time p95 of 16.8ms sits on the 60Hz floor, which is as fast as that trace can report. The older goal, cutting the share of frames over 33ms by at least half, came out to about a 27% drop on the later measurement, and the confidence interval includes 0. A `STREAM_TOKEN_RECEIVED` listener can read DOM a frame behind the text it was given, and further behind when formatting skips extra frames. Format-time refresh is already on this path: the average of the last six format samples skips one extra frame above 8ms and another above 16ms, while the final, stop, and error paints stay immediate and the first visible token stays synchronous. That rule shipped with the coalesced renderer; a separate follow-up was not opened, because the main-scenario frame p95 was already 16.8ms and formatting was not the main long task.
