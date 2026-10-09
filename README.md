**English** · [中文说明](README.zh-CN.md)

# SillyTavern Performance & Reliability Lab

**An isolated, evidence-driven optimization lab built on [SillyTavern](https://github.com/SillyTavern/SillyTavern) 1.18.0 (AGPL-3.0).**
Eleven sequential optimization rounds, each in its own branch with its own tests, browser evidence and an independently verified delivery report. Nothing here has been deployed: the production server was never touched, and that is checked by file-hash snapshots across all rounds.

> This is a research fork, **not** a distribution. Incremental ZIP/patch artifacts target the lab's isolated 1.18-based baseline and must not be applied over official 1.19+ or a live installation.

## Understand this repo in 30 seconds

- **What is it?** An isolated lab that health-checks SillyTavern and improves it in 11 verified rounds — each round has its own tests, measured evidence and an acceptance report. One extra branch merges official 1.19.0 in.
- **Why care?** None of these fixes exist in official 1.19.0 yet (file-by-file comparison in [docs/COMPARISON-vs-official-1.19.0.md](docs/COMPARISON-vs-official-1.19.0.md)): expression mode mis-detection (layout reads 40 → 0), wrong batch-embedding count (63 vectors for 21 inputs), long rich-text main-thread blocking roughly halved, message-depth statistics doing 98.3% less work, async chat IO with locks and a recycle bin, per-history backup isolation, and more.
- **How to read it?** ① Read the comparison doc → ② pick a branch below → ③ open its `docs/*-verification.md` (method, measured numbers, honest limits) → ④ inspect the diff and `tests/`.
- **One-line status:** 442/442 tests pass on Node 20 and Node 24 (live re-run); production was never touched (cross-round hash snapshots); not deployed; heavy chats still carry a ~1.2–1.26 s main-thread task, disclosed as-is.

## Why it exists

Official latest release at the time of writing is **1.19.0** (commit `7e8663cd`, 2026-09-14). We compared this lab's final state file-by-file against it:

- **12 files exist only here** — async chat I/O, chat-info cache, streaming chat search, backup scheduler, media-load-scroll module, After Hours theme, lab scaffolding.
- **10 changed files were not touched by upstream 1.19 at all** — including `src/endpoints/vectors.js`, `public/scripts/itemized-prompts.js`, `public/scripts/welcome-screen.js`, `src/endpoints/backups.js`, `src/transformers.js`.
- **11 files were changed by both sides** — merge-review list: `public/script.js`, `src/endpoints/chats.js`, `public/scripts/group-chats.js`, `public/scripts/extensions/expressions/index.js`, `public/scripts/autocomplete/AutoComplete.js`, `src/endpoints/characters.js`, `src/endpoints/tokenizers.js`, `src/server-main.js`, `public/scripts/extensions.js`, `package.json`, `.gitignore`.

### Highlights still absent from official 1.19.0

| Area | Official 1.19.0 | This lab |
|---|---|---|
| Expression VN mode detection | still `$('#visual-novel-wrapper').is(':visible')` (line 502) — a layout read; hidden or `display:contents` wrappers are misjudged and reset sprites/drag positions | private applied-mode state updated synchronously; targeted geometry reads **40 → 0** |
| WebLLM/KoboldCPP batch embeddings | `results.push(...texts.map(...))` inside the batch loop — **63 outputs for 21 inputs** | batch-local lookup → exactly 21 outputs, order preserved |
| Long rich-text chat | synchronous build; longest main-thread task ≈ 2.3 s (180 heavy messages) | one yield boundary after `printMessages` → longest task **2307 → 1237 ms (−46.4%)**; open time +8.3% disclosed as a tradeoff |
| Message depth statistics | scans every earlier message per message | counts only up to the target — `is_system` reads **300,000 → 5,050 (−98.3%)** (last 100 of 3,000) |
| Chat file safety | synchronous writes, permanent unlink | async I/O, per-path locks, exclusive create, retired markers, recycle bin, malformed-header guard |
| Backup throttling | per-name map, unbounded | per-history SHA-256-prefixed keys, 256-key cap, 60 s idle eviction, flush/drain before shutdown |
| Prompt cache races | stale reads can overwrite a newly opened chat's cache; closing mid-read saves empty caches | request ownership + saveable-state; group-cancel propagation |
| Recent chat entry | welcome first opens the default chat, then the target | direct target entry with ownership guard + versioned info cache |
| Character editor open | fills a full creation draft, then immediately re-fills the current character | single fill — editor prep median **−15.4% / −46.7%** (normal / heavy) |
| Startup | no deferred runtimes, no compile-cache middleware, no built-in template preload | deferred optional runtimes, webpack-serve cache, template preload |

The honest other side: **upstream-only fixes not merged here yet** — date-sorted image listing, world-info Map index, `/addswipe` targeted update, bookmark branch integrity, search untrusted-URL filter, account-reset limiting. See [docs/COMPARISON-vs-official-1.19.0.md](docs/COMPARISON-vs-official-1.19.0.md).

## Verification

- Safe Node suites: **442/442 on Node 20.20.2 and 442/442 on Node 24.15.0** — live re-run on 2026-10-09.
- Per-round live re-runs: **632 tests across 11 worktrees, 0 failures**.
- Evidence audit: **17,732 digest claims recomputed**, every artifact ZIP byte-exact against its worktree, all Git bundles re-verified, per-round 1,177–1,214-file restore comparison, **12,915 protected files rescanned**, production file hashes identical across all rounds, **0 problems**.
- Every round keeps its RED/GREEN logs, raw browser evidence and delivery artifacts outside Git (local evidence directories); each round's `docs/*-verification.md` describes method, measurements and remaining limits.

## Branches

Start from `main` (SillyTavern 1.18.0 baseline + lab scaffolding). Each branch is based on the previous round's head, so the history reads as a chain.

| # | Branch | Focus |
|---|---|---|
| 1 | `codex/sillytavern-performance` | streaming chat search, ordered async storage |
| 2 | `codex/sillytavern-lifecycle` | chat lifecycle protection, shared tokenizer initialization |
| 3 | `codex/sillytavern-startup` | deferred optional runtimes, validated frontend cache |
| 4 | `codex/sillytavern-frontend-startup` | built-in template preload during ordered startup |
| 5 | `codex/sillytavern-ui-flow` | After Hours theme, autocomplete/media resource release |
| 6 | `codex/sillytavern-chat-transitions` | direct recent-chat entry, versioned info cache, path locks |
| 7 | `codex/sillytavern-reliability-render` | file-header guard, per-history backup isolation, depth stats, vector-batch fix |
| 8 | `codex/sillytavern-richtext-flow` | rich-text yield boundary, full load-ownership guards |
| 9 | `codex/sillytavern-prompt-isolation` | prompt cache ownership, group-cancel propagation |
| 10 | `codex/sillytavern-character-editor-flow` | single-pass editor preparation |
| 11 | `codex/sillytavern-expression-mode-flow` | expression VN mode state fix (round-11 tip) |
| 12 | `codex/sillytavern-1.19-sync` | **merge official 1.19.0 into the lab**: 62 upstream changes applied cleanly, 5 conflicts resolved semantically (lab hardening kept, upstream resilience adopted); 442/442 tests pass; browser re-acceptance pending — see `docs/2026-10-09-sillytavern-1.19-sync.md` on that branch |

Tagged: `r1-performance` … `r11-expression-mode`, plus `sync-1.19.0` for the sync branch.

## Running the safe test suite

The lab runs only its own safe suites (the upstream Jest suite performs permanent fixture cleanup and is intentionally not used):

```bash
# the accumulated safe suite (442 tests), as declared in package.json "test:perf"
node --test tests/performance-lab.test.mjs tests/enabled-backups.test.mjs tests/chat-lifecycle.test.mjs \
  tests/tokenizer-initialization.test.mjs tests/tokenizer-model-compatibility.test.mjs tests/frontend-lifecycle.test.mjs \
  tests/frontend-template-startup.test.mjs tests/startup-lazy-imports.test.mjs tests/startup-webpack.test.mjs \
  tests/startup-failure-exit.test.mjs tests/media-load-scroll.test.mjs tests/autocomplete-lifecycle.test.mjs \
  tests/chat-transitions.test.mjs tests/chat-load-ownership.test.mjs tests/character-editor-flow.test.mjs \
  tests/expression-mode-flow.test.mjs tests/itemized-prompts-ownership.test.mjs tests/recent-chat-info-cache.test.mjs \
  tests/chat-file-safety.test.mjs tests/chat-backup-isolation.test.mjs tests/message-depth.test.mjs \
  tests/vector-batch-cardinality.test.mjs
```

The optional lab launcher (`npm run perf:lab`) binds **127.0.0.1:8780** only and keeps its own `.lab-data/` and `.lab-config.yaml`.

## Limits

Not deployed and not production-validated; mobile evidence is Chrome UA emulation, not real phones; heavy chats still carry a ~1.2–1.26 s main-thread task; the base is 1.18.0, so real-world use requires a stepwise, function-by-function merge onto 1.19+ with fresh regression and browser acceptance.

## License

AGPL-3.0, inherited from SillyTavern. This is an independent research derivative and is not affiliated with the SillyTavern project. All modifications are released under the same license.
