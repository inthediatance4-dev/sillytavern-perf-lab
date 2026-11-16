# Merge blocker 1: revert unshipped JS-Slash-Runner TS changes

Completed on `opus-longchat`, starting at `8fff4fb0677e8073bed5c3ce849cf11e164f2abf`. Scope is review section III item 1 only.

## Change and rationale

Restored these files byte-for-byte from `37a4818`, independently confirming identical content at `f6c0053^`:

- `public/scripts/extensions/third-party/JS-Slash-Runner/src/function/chat_message.ts`: revert P1-1 insertion and rotation loops to the original spread calls.
- `public/scripts/extensions/third-party/JS-Slash-Runner/src/function/variables.ts`: revert P1-1 variable assignment loop to the original Lodash assignment.

The extension manifest loads `dist/index.js`. All three tracked `dist/` files are byte-identical to both `37a4818` and the starting HEAD; the directory tree object is `222bd4570dc333dff9364ea3e7df32da74138bd5`. Thus these branch TS edits never affected the shipped dist. No rebuild was performed. They must not remain as TS changes without enabled-extension build/runtime validation: the old browser matrix disabled extensions, and the separate transpiled-function VM checks stubbed refresh/events rather than testing the shipped extension. A future rebuild would otherwise introduce changes outside that coverage.

All other P1-1 product fixes remain unchanged from starting HEAD. Exact restoration also preserves the third-party files' original formatting. No dependency, package script, lifecycle guard, lock, token check or persistence behavior was changed.

## Test and historical evidence adjustment

The current `tests/longchat-spread.test.mjs` contains six core tests and zero checks of either reverted TS file. It remains byte-identical to starting HEAD, and its existing `test:perf` registration remains applicable. No test removal or new test file was needed.

The [P1-1 report](../p1-1-spread-fix/README.md) now explicitly marks its extension-source descriptions, three audit verdicts, source hashes and 15 VM-check results as historical and superseded. This applies to `extension-source-check*.json` and the extension entries in that directory's validation, summary and spread-audit JSON files. Those artifacts are retained as history, not current acceptance evidence; their source-only checks were not rerun against the restored spread behavior. The historical count of 19 changed call sites across 10 product files now excludes three reverted sites across two third-party files (16 retained sites across eight product files).

## Validation

[validation.json](validation.json) records exact source SHA-256 values, equality checks, commands, Node/ESLint versions and results. All commands ran once, with no rerun-to-green.

| Check | Result |
|---|---|
| TS source equality against `37a4818` and `f6c0053^` | 2/2 exact matches |
| Tracked dist content equality against starting HEAD and `37a4818` | 3/3 exact matches |
| Other public product files unchanged from starting HEAD | Pass |
| ESLint, restored TS files | 2 files, exit 0; [log](eslint-typescript.txt) |
| ESLint, remaining spread test file | 1 file, exit 0; [log](eslint-tests.txt) |
| Remaining longchat-spread tests, Node v24.22.1 | 6 pass, 0 fail, 0 skip; [TAP](longchat-spread.txt) |

ESLint v8.57.1 uses the repository config. For TS, `--no-ignore` overrides the third-party exclusion and a temporary `parseForESLint` adapter uses the already installed typescript-estree, visitor-keys and scope-manager packages, as in the original P1-1 evidence. Its complete source is recorded in validation JSON; no parser dependency or repository lint config was added. Markdown/JSON evidence has no configured ESLint target.

No performance A/B was required or measured for this source-only revert. No archived product tree was materialized; baseline bytes were read with `git show`, without changing Git refs. No lab server or browser was started. Logs contain no hostname or absolute paths; command paths are redacted to `<tmp>` where needed. Artifacts are small, so gzip is unnecessary. No commit, push, branch/tag change or external issue was made.

M1 acceptance is met. Other merge blockers, browser/performance measurements and Windows/manual checks are outside this step. Workflow adjustments: the anticipated TS-dependent tests were absent from the current test file, so only their historical evidence needed qualification; TS lint required the documented temporary parser adapter.

## Upstream issue draft (not filed)

**Title:** Avoid function-argument spread over chat-sized arrays in message insertion, rotation and variable collection

**Problem:** Three source call sites expand arrays whose size can grow with chat history into positional function arguments:

- `createChatMessages`: `chat.splice(insert_before, 0, ...converted)` in `src/function/chat_message.ts`.
- `rotateChatMessages`: `chat.splice(begin, 0, ...right_part)` in the same file.
- `_getAllVariables`: `result.assign(...chat.slice(...).map(...))` in `src/function/variables.ts`.

Large histories or bulk insertions can exceed the JavaScript engine's argument-count limit and throw `RangeError`. This is a source-level risk; the core-browser measurements with extensions disabled do not establish enabled-extension failure or a shipped-extension fix.

**Suggested fix:** Iterate over chat-sized collections instead of spreading them into calls. For insertion/rotation, detach the tail and append each inserted/rotated message followed by each tail message, retaining the original chat array identity and order. For variables, evaluate the Lodash chain once and assign each message's selected-swipe variables into one backing object in the original order, then clone as before; later messages must retain precedence. Avoid repeatedly evaluating/copying an accumulating deferred chain, which can introduce quadratic work. Preserve managed-surface mutation checks and refresh/event timing and arguments.

**Suggested upstream validation:** Test empty/single inputs, insertion positions (including normalized negative positions), rotation boundaries, identity/order, selected swipe, undefined variable objects and assignment precedence against the original behavior. Stress roughly 300,000 entries without argument expansion, rebuild dist, and test the enabled extension through its real refresh/events and managed-surface paths. Keep any extension build/runtime changes and their generated artifacts in the upstream extension's own review process.
