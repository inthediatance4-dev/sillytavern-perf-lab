# Round 1.5: path-lock call-site audit

Scope: tracked application sources under `src/` and `public/`, including endpoint,
extension and plugin loader code on branch `notion-opus-round`. Line numbers refer
to this working tree. No production source changes were needed: no reachable
production chain acquires a new key inside an existing path-lock scope.

## Method and notation

Searched with `rg -n 'withPathLocks|withPathLock|withCharacterEdit|withCharacterImport|usingRetiredPathReuse|renameChatFile' src public`, then traced callers of
`trySaveChat`, `withImportPublication`, `writeCharacterData`, `mergeCharacterUpdate`,
`backupChat`, and imports of `chat-io.js` / `character-lifecycle.js`.
Import declarations, comments and function definitions are not invocation sites;
wrapper definitions and internal acquisition mechanics are documented below too.

All routes below are POST, with the `/api/` prefix. `F(p)` means **shared**
`dirname(p)` plus **exclusive** `p` (`chatLockPaths`); repeated keys collapse and
exclusive wins. `X(p)` means **exclusive** `p`. Card `a` is
`characters/<avatar>.png`; `d` is `chats/<internal-name>`; history `h` is a
character `.jsonl` or a `groupChats/<id>.jsonl`; group `g` is `groups/<id>.json`.
Publication helpers `usingRetiredPathReuse(s)` acquire **no locks**: they require
exclusive ownership of each authorized path and issue publication tokens. Their
entries are included explicitly because they are part of the requested audit.
“No” in the last column means no nested **new** key or shared-to-exclusive upgrade
on the listed production chain, not that the route does not acquire any locks.

## Every invocation site

| File:line | Invocation and acquired/required keys | Complete upstream entry chain | Nested new key? |
|---|---|---|---|
| `src/chat-io.js:41` | `withPathLocks`, X(argument) | `chats/save` or `chats/group/save` → `trySaveChat` → scheduler → `backupChat` → `runAfterPathLocks` → `withPathLock` | No; after originating/enclosing reservations release, outside their ALS scope |
| `src/chat-io.js:369` | `usingRetiredPathReuses`, requires X(argument), no acquisition | all single-path reuse callers below → `usingRetiredPathReuse` | No |
| `src/chat-io.js:536` | `withPathLocks`, F(source), F(destination), then recursive `renameChatFile` | `chats/rename` → `renameChatFile`; fallback supports direct unlocked callers | No; HTTP caller already holds destination so fallback is not entered; direct unlocked call takes both keys at once |
| `src/chat-io.js:536` | recursive `renameChatFile`, same keys | preceding fallback → recursive call | No; destination now held |
| `src/chat-io.js:539` | `usingRetiredPathReuse`, requires X(destination) | `chats/rename` → `renameChatFile` | No |
| `src/character-lifecycle.js:9` | `withPathLocks`, F(a) plus supplied `lockPaths` | character edit routes → `characterEditHandler`, or merge → `mergeCharacterUpdate`, or import → `withImportPublication` → `withCharacterImport` → `withCharacterEdit` | No; extra X(d) for import is acquired here up front |
| `src/character-lifecycle.js:38` | `withCharacterEdit`, F(a), X(d) | `characters/import` → `withImportPublication` (directly for preserved name, otherwise through `writeCharacterData`) → `withCharacterImport` | No |
| `src/endpoints/chats.js:71` | `withPathLock`, X(backups directory) | `chats/save` / `chats/group/save` → `trySaveChat` → `backupScheduler.schedule` → scheduler `run` (leading, timer trailing, overflow, retirement or flush) → `backupChat` → `runAfterPathLocks` | No; deferred outside lock scope even if timer/Promise inherited save context |
| `src/endpoints/chats.js:518` | `withPathLocks`, F(h) | `chats/save:547` / `chats/group/save:964` → `trySaveChat` | No |
| `src/endpoints/chats.js:588` | `withPathLocks`, F(h) | `chats/get` | No |
| `src/endpoints/chats.js:623` | `withPathLocks`, F(source h), F(destination h) | `chats/rename`, ordinary or group branch | No |
| `src/endpoints/chats.js:624` | `renameChatFile`, already-held source/destination keys | `chats/rename` → preceding reservation | No |
| `src/endpoints/chats.js:647` | `withPathLocks`, F(h) | `chats/delete` | No |
| `src/endpoints/chats.js:767` | `withPathLocks`, F(new group h) | `chats/group/import` | No |
| `src/endpoints/chats.js:768` | `usingRetiredPathReuse`, requires X(new group h) | `chats/group/import` → preceding reservation | No |
| `src/endpoints/chats.js:863` | `withPathLocks`, F(every imported h) | `chats/import` → JSONL or JSON format converter (including multi-history CAI) → validate complete batch | No; all batch keys reserved before publishing any file |
| `src/endpoints/chats.js:864` | `usingRetiredPathReuses`, requires X(every imported h) | `chats/import` → preceding reservation | No |
| `src/endpoints/chats.js:897` | `withPathLocks`, F(group h) | `chats/group/get` | No |
| `src/endpoints/chats.js:917` | `withPathLocks`, F(group h) | `chats/group/info` | No |
| `src/endpoints/chats.js:939` | `withPathLocks`, F(group h) | `chats/group/delete` | No |
| `src/endpoints/characters.js:222` | `withCharacterImport`, F(a), X(d) | `characters/import:1703` → `withImportPublication` for preserved name; or new import → format importer → `writeCharacterData:248` → `withImportPublication` | No; new import enters once at final card write; preserved import supplies `checkCharacterImport` so final write does not re-enter |
| `src/endpoints/characters.js:223` | `usingRetiredPathReuses`, requires X(a), X(d) | same chain → `withCharacterImport` → `withCharacterEdit` reservation | No |
| `src/endpoints/characters.js:856` | `withPathLocks`, F(new BYAF scenario h) | `characters/import` → `importFromByaf` → `createChatAsCurrentPersona`, only when **no preserved name** | No; scenario chats precede `writeCharacterData` and its card publication reservation; preserved-name branch skips scenario import |
| `src/endpoints/characters.js:857` | `usingRetiredPathReuse`, requires X(new BYAF h) | preceding BYAF scenario reservation | No |
| `src/endpoints/characters.js:1075` | `withPathLocks`, F(a), X(d) | `characters/create` | No |
| `src/endpoints/characters.js:1078` | `usingRetiredPathReuses`, requires X(a), X(d) | `characters/create` → preceding reservation | No |
| `src/endpoints/characters.js:1135` | `withPathLocks`, F(old a), F(new a), X(old d), X(new d) | `characters/rename` | No; retirement inheritance and filesystem moves do not acquire path locks |
| `src/endpoints/characters.js:1137` | `usingRetiredPathReuses`, requires X(new a), X(new d) | `characters/rename` → preceding reservation | No |
| `src/endpoints/characters.js:1186` | `withCharacterEdit`, F(a) | `characters/edit:1195`, `characters/edit-avatar:1236`, `characters/edit-attribute:1287` → `characterEditHandler` → handler → `writeCharacterData` | No; ordinary edits have no `characterImport` flag and do not re-enter import publication |
| `src/endpoints/characters.js:1371` | `withCharacterEdit`, F(a) | `characters/merge-attributes:1424` → single branch `:1500` or bulk branch `processOne:1472` → `mergeCharacterUpdate` | No; bulk batches use independent Promise branches with no outer path-lock reservation, including empty-avatars scan-all mode |
| `src/endpoints/characters.js:1538` | `withPathLocks`, F(a), X(d) | `characters/delete` → invalidate import → reservation | No; recursive chat recycling takes no file locks |
| `src/endpoints/characters.js:1765` | `withPathLocks`, F(source a), F(copy a), X(copy d) | `characters/duplicate` | No |
| `src/endpoints/characters.js:1765` | `usingRetiredPathReuses`, requires X(copy a), X(copy d) | `characters/duplicate` → preceding reservation | No |
| `src/endpoints/groups.js:192` | `withPathLocks`, F(g) | `groups/create` | No |
| `src/endpoints/groups.js:215` | `withPathLocks`, F(g) | `groups/edit` | No |
| `src/endpoints/groups.js:235` | `withPathLocks`, F(g), X(groupChats directory) | `groups/delete` → read metadata → recycle group → retire/recycle each listed history | No; child histories are protected by exclusive directory reservation, and recycling/retirement do not acquire child locks |
| `src/endpoints/backups.js:43` | `withPathLocks`, F(backup file) | `backups/chat/delete` | No |

## Other acquisition mechanics and entry points

- `src/chat-io.js:174` is the only path-lock reservation implementation:
  `withPathLocks` → `normalizeLockRequests` → `reserve` (`:112`, invoked at `:189`)
  → `getGate`/`pump`; it rejects nested new keys/upgrades and reuses held keys.
  `chatLockPaths:215` builds requests, without acquiring. `runAfterPathLocks:155`
  clears held-key scope only after enclosing reservations release.
- `writeChatFile`, `createChatFileExclusive`, `copyChatFileExclusive`,
  `publishExclusive`, `recycleChatPath`, `recycleRetiredChat`, `retireChatPath`,
  `rollbackChatRetirement`, `inheritChatRetirements`, fingerprinting, and backup
  pruning do filesystem I/O but acquire **no path locks**. They cannot add a
  nested key. `usingRetiredPathReuses:379` verifies the caller's exclusive locks.
- Startup: `server-main.js:501` → `initUserStorage` completion →
  `restoreLegacyRetiredHolds:507-509`; later `preSetupTasks:302` →
  `migrateGroupChatsMetadataFormat:320` (`groups.js:36`) perform startup migration
  without path-lock reservations, before serving requests. The migration's
  backup copies therefore do not introduce nested acquisitions. Data-root
  ownership is a separate process lock, not part of this in-process key system.
- Shutdown: `server-main.js` → `exitProcess` → `runShutdown` →
  `flushChatBackups` → scheduler `flush` → `backupChat` uses the same deferred
  backup acquisition described above; no enclosing path locks.
- `src/endpoints/extensions.js` has install/update/branches/switch/move/version/
  delete endpoints, none importing these modules or acquiring path locks.
  `src/plugin-loader.js:213-222` gives external plugins their own routers under
  `/api/plugins/<id>`; no checked-in server plugin implementations were found.
  `public/scripts/extensions/**` contains browser code (including third-party
  extensions), with no calls to these server lock helpers. Browser `saveChat`
  and `context.saveChat` calls reach the ordinary HTTP save routes above; they
  cannot inherit server ALS state. No additional lock-acquiring endpoint module
  was found in `src/` or `public/`.

Finding: **zero production nested-new-key chains found; zero production fixes**.
This is a static audit of checked-in callers, not a guarantee about future or
externally installed plugins, or arbitrary direct calls to exported helpers.
No generic nested-lock sharing/upgrade mechanism was added.

## HTTP smoke coverage

`tests/data-endpoint-smoke.test.mjs` mounts real Express routers on loopback with
synthetic authenticated user directories and the same `req.file` upload seam as
`chat-lifecycle.test.mjs`. It runs route middleware and filesystem publication,
with backups enabled. PNG WASM is initialized from installed local bytes so the
real image codec runs without Node's unsupported `fetch(file:)` path. Every
request must return 200 (stronger than no 5xx), no error payload, and no
`LockOrderError` in response or captured server errors, including after backup
flush. Bulk merge failures and created/imported/deleted files are also checked.

| Router | Covered POST paths | Additional branches |
|---|---|---|
| chats | `/save`, `/get`, `/rename`, `/delete`, `/import`, `/group/import`, `/group/save`, `/group/get`, `/group/info`, `/group/delete` | Ordinary and group rename; JSONL import and two-history JSON batch; leading/latest-trailing scheduled backups and explicit flush |
| characters | `/create`, `/edit`, `/edit-avatar`, `/edit-attribute`, `/merge-attributes`, `/import`, `/duplicate`, `/rename`, `/delete` | Single merge, explicit multi-card bulk and scan-all bulk; new JSON import, preserved-name import and replacement; BYAF scenario chat publication; rename/delete with histories |
| groups | `/all`, `/create`, `/edit`, `/delete` | `/all` creates missing groups directory; deletion with existing and absent histories |
| backups | `/chat/delete` | Deletes a real scheduler-produced backup |

Every data-writing POST in these four routers is covered. A router-stack guard
fails if a POST is added without coverage or explicit read-only classification.
The following POSTs are not exercised because they do not write these datasets
or acquire path locks (read/cache behavior is outside this regression):

- chats: `/export`, `/search`, `/recent`.
- characters: `/all`, `/get`, `/chats`, `/export`.
- backups: `/chat/get`, `/chat/download`.

Other endpoint modules do not call path-lock helpers and are outside the task's
specified router inventory. In particular, sprites/assets subdirectories,
extension installation, content downloads, and settings are not chat/card/group/
backup publication operations in these routers. External plugin endpoints cannot
be enumerated or smoke-tested without an installed plugin and are not enabled by
this test. Startup migrations are not HTTP endpoints. Format permutations that
share publication sites (YAML/PNG/CharX imports and other chat JSON converters)
are statically traced but not each tested: JSON and BYAF cover the distinct lock
chains, with preserved-name and fresh-name admission both exercised.

## Validation

Linux, Node v20.19.2:

- `npx eslint tests/data-endpoint-smoke.test.mjs`: exit 0, no diagnostics.
- `node --test tests/data-endpoint-smoke.test.mjs tests/path-lock-fairness.test.mjs`:
  **16 passed, 0 failed, 0 skipped, 0 cancelled** (6 smoke tests including parent,
  10 lock-fairness tests). Leading and latest-trailing backup contents both verified.
- `git diff --check`: exit 0.
- New smoke file registered in `package.json` `test:perf`; full suite not run.

No existing review scripts/evidence were changed. No commit, push, tag or branch
operation was performed. Windows and other review prerequisites are outside this
single-task validation.
