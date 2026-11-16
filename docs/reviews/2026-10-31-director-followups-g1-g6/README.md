# Director followups: G1–G6 review evidence

**G2 阻塞，不能合入。** 中途保存污染已得到请求和 JSONL 回读的实证，不能按最终重载结果判为通过，也不能写成已知限制后放行。

Product baseline: `29f1e7dba9608a354e6bd264a13c6408786265ce` (unchanged). The original end-state checks and two full runs used runner `626bf1062a8a60b03c3dcae9ecbd37b062eb3a7c`. The runner subsequently gained a strict every-save assertion and a controlled direct-save probe. Its exact bytes are in the validated manifest. Premerge comparison baseline: `931354ffb5c9fe77bea504a4317d434f59eb98da` (`origin/codex-improvements` and merge-base at the start of G3).

This report supersedes the earlier report's R5 scope and its “unrelated third-party extensions” wording. No product source or third-party extension was changed. No merge or force-push is performed. Opus retains final merge approval.

| Gate | Evidence |
| --- | --- |
| G1 | [Extension versions and save/mutation call paths](extensions.md), [inspected-file hashes](extension-source-sha256.json) |
| G2 | **FAIL / blocked.** Both extensions enabled. The old end-state assertions passed 3/3, but auditing `g2-3.results.json` found an expanded first-message save before a later manual save repaired it. `g2-direct-save-race.results.json` reproduces the actual disk pollution, and the strict assertion exits 1. See `g2-audit-finding.json`. |
| G3 | Same runner against both frozen product trees: `g3-baseline.results.json`, `g3-head.results.json`. Both PASS; request counts 1 → 2; swipe counts 1 → 2; both swipes checked after disk reload. [Historical intermittent failure tracking issue #1](https://github.com/inthediatance4-dev/sillytavern-perf-lab/issues/1). |
| G4 | The original default complete suite passed twice at runner `626bf10`: 48 checks, 63 fake generation requests, 0 page errors each. `g4-1.results.json`, `g4-2.results.json`; isolation below. These earlier passes do not satisfy a post-fix/final strict-runner acceptance. After the G2 finding, further acceptance repetitions stopped pending the product fix. |
| G5 | [Validated source hashes](validated-source-sha256.json), [cumulative file list](files-since-29f1e7d.txt). Compared with the previous manifest: only `tests/browser-director-lab.py` changes; all other 10 recorded files match. |
| G6 | Final commit's actual six-job CI run is linked in the final handoff. The results for an earlier commit are not substituted for it. |

## Reproduction

Python Playwright and Node are installed. `LAB_BROWSER_EXECUTABLE` selects installed Chrome. Browser reports include exact Chromium and Node versions, product HEAD, runner HEAD and runner SHA-256. Each command creates fresh synthetic data and a local fake provider, and retains its temporary data for diagnosis.

```sh
# G2: run three times sequentially, using a different output file each time
python tests/browser-director-lab.py --f3-only --enable-third-party --output .evidence/gates/g2-final-1.json
python tests/browser-director-lab.py --f3-only --enable-third-party --output .evidence/gates/g2-final-2.json
python tests/browser-director-lab.py --f3-only --enable-third-party --output .evidence/gates/g2-final-3.json

# Controlled real dry-run plus direct save; expected exit 1 on current product
python tests/browser-director-lab.py --f3-only --enable-third-party --f3-save-probe --output .evidence/gates/g2-direct-save-race.json

# G3: .worktrees/g3-baseline is detached at 931354ffb5c9fe77bea504a4317d434f59eb98da
python tests/browser-director-lab.py --chapter-only --product-root .worktrees/g3-baseline --output .evidence/gates/g3-baseline.json
python tests/browser-director-lab.py --chapter-only --output .evidence/gates/g3-head.json

# G4: the default complete suite, twice
python tests/browser-director-lab.py --output .evidence/gates/g4-first.json
python tests/browser-director-lab.py --output .evidence/gates/g4-second.json
```

## Isolation

G2's `disabledThirdPartyExtensions` is empty, both manifest entrypoints loaded successfully, and TavernHelper is present. Network save bodies and DevTools initiator stacks are observed without replacing fetch. Saved JSONL and DOM are independently asserted after reload. The extra every-save audit exposed a dirty save that the old end-state assertions missed; the later explicit fixture save had masked it.

G3 and G4 use the default fresh fixture, with precisely these two third-party extensions disabled:

```json
["third-party/JS-Slash-Runner", "third-party/st-memory-enhancement"]
```

The runner first compares disabled-Director DOM/focus with the existing `ffd5f4e` static-asset baseline, then enables Director. That static DOM comparison base is distinct from G3's product baseline. Third-party code and global settings are never edited.

## Failed diagnostic attempts and limits

Earlier attempts from this G1–G6 session are preserved separately, not silently overwritten:

- Two initial extension-enabled focused runs passed both F3/R2 checks (`diagnostics/g2-initial-1.results.json`, `diagnostics/g2-initial-2.results.json`). A third passed the first-narration quiet/reload check, then failed in the additional ordinary-generation API fetch (`diagnostics/g2-fetch-failure.results.json`). All six captured chat saves before that failure kept literal macros. There was no expanded first-message save in that observation. Its exact network error was not captured by the old instrumentation, so its transport root cause remains unproven; it is not called a product fix or a successful ordinary-generation run.
- Network error and process-state recording were then added to the test runner. The next focused run passed (`diagnostics/g2-network-diagnostic.results.json`). A further attempt failed during Chrome launch with `chrome_browser_main_win.cc:577 NOTREACHED`, before any product check (`diagnostics/g2-browser-start-failure.results.json`); both lab subprocesses were still alive. Subsequent acceptance runs were serialized.
- Some successful runs emit a Python Playwright `Response.finished`/`Target closed` task warning while closing the browser. It is a teardown warning, retained in `diagnostics/teardown-warnings.txt`, not a passed page assertion. Reports separately retain request aborts: periodic ping requests are aborted, and the full suite intentionally stops generation requests in its stop scenarios. No JavaScript page errors are accepted.

The exact historical long-suite failure's individual extension caller remains unproven. The new observation and controlled probe do prove an unsafe persistence window in the current product; they are not a claim that a particular extension caused the historical failure. G3 establishes matching controlled results, not the cause of its earlier intermittent failure; issue #1 retains that investigation.

## G2 root cause and required next step

The natural third repetition's third save request contains `【Director Synthetic】Director Synthetic 和 Synthetic Tester a` instead of the literal first narration. Its phase is `create-fixture`, before the explicit quiet probe. The next manual save restores the expected literal text on disk, explaining why the old final-state checks still pass. The old caller trace only reaches the shared upstream `saveChat` and the TavernHelper fetch wrapper; it does not establish which caller initiated that save.

The prompt manager can run background token-count dry runs: `PromptManager.render()` calls `tryGenerate()` (`public/scripts/PromptManager.js:862–872`), and the OpenAI binding invokes `Generate('normal', {}, true)` (`public/scripts/openai.js:707–709`). Generate writes the expanded value to `chat[0].mes` (`public/script.js:5054`) even for dry runs. Director restores it at `GENERATE_AFTER_DATA` (`director/index.js:755–757`), leaving an asynchronous interval in which another save can serialize the expansion.

The controlled probe leaves both third-party extensions enabled. In a real `CHAT_COMPLETION_PROMPT_READY` dry-run event it calls the actual exported upstream `saveChat` directly, matching the direct-save capability identified in G1. It waits for the save and immediately reads the stored JSONL before proceeding. Both the memory observation and the disk row contain the expanded text. The report retains this under `f3Audit.dryRunSaveProbe`. This is a test listener, not a modification to Generate or either extension. A prior conditional-save probe did not await a concurrently started handler completely and is retained as an inconclusive diagnostic, not persistence proof.

**暂停合入，回交讨论。** No product fix is claimed. Merely restoring at an earlier prompt event cannot guarantee safety against an arbitrary concurrent save before that event. The next Director fix needs to protect the saved first-message snapshot throughout the temporary expansion, including overlapping dry runs, while preserving real message edits, chat switches and prompt behavior. A Director-owned serialization guard is one candidate to evaluate; its interactions with upstream snapshotting and third-party cloning need a concrete design and tests before choosing it. Generate and third-party code remain outside the edit boundary. After the fix, rerun strict enabled-extension G2 three times and the default full suite twice, then CI; do not treat this failure as a known limitation.

## Changes after the product baseline

Only test instrumentation/focused entrypoints and review documents/evidence are added. The assertions still require exactly one new swipe request, complete saved JSONL literals, and all default suite checks; the stricter runner additionally rejects any observed intermediate expanded-message save. The final documentation commit adds evidence only; `validated-source-sha256.json` records the final product and runner bytes, while each result retains the runner hash actually used. The previous R1–R6 report remains as historical evidence and is superseded here for R5. CI success does not override the G2 blocker.
