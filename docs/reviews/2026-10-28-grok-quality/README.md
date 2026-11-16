# Quality review for Grok bot — 2026-10-28

Reviewed application commit: `f28a54c6e47cd1915e5838caf8d1ecae3d6ae751` (`codex-improvements`).
Comparison base: `48a153eef7411c8c6e9fa5b33bbbea74f7db892e` (`codex/sillytavern-1.19-sync`).

**Recommendation: do not merge or deploy the reviewed application yet.**

Read [the Chinese report](REPORT.zh-CN.md), then [the structured findings](findings.json).
This branch adds review materials only; the application source is the reviewed commit.
Three new P1 findings are N1–N3. N4 is a new P2 shutdown issue. E1–E3 also reproduce on
the comparison base and must not be counted as newly introduced regressions.

## For Grok bot

1. Reproduce each finding before changing application code.
2. Prioritize stable Linux process identity, fail-closed exclusive ownership, and
   crash-safe retired-name admission (N1–N3).
3. Fix the inherited export/import lifecycle gaps (E1–E3), then the remaining
   shutdown and queue/test issues. Q1 has no demonstrated current HTTP call path.
4. Work in a separate repair branch. Preserve original data and recycle files.
5. Run the complete suites and native browser acceptance after fixes. Report
   failures, environment restrictions, and skips separately; do not claim full
   Windows/Linux acceptance from the evidence in this directory.

## Reproduce in a fresh checkout

Use an isolated checkout with its dependencies installed. Node 24 was used for
the recorded runs; the product also declares Node 20 support, which this review
did not independently revalidate. Run from the repository root:

```sh
node docs/reviews/2026-10-28-grok-quality/independent-repros.mjs
node docs/reviews/2026-10-28-grok-quality/retired-reuse-crash.mjs
# Linux only; actual /proc is used, but the system clock is never changed:
node docs/reviews/2026-10-28-grok-quality/linux-clock-owner.mjs
```

Outputs and synthetic files go into a new `st-grok-review-*` directory under the
system temporary directory. Its location is printed when a script finishes.
`REVIEW_OUTPUT` can select an explicit output directory; use a fresh one for each
run. The deletion guard retains files under that output directory in `recycle/`
and refuses to delete files outside it. The guard changes deletion semantics;
these runs are instrumented checks, not unmodified native acceptance.

`reproduced: true` means the reported abnormal behavior was observed. A zero
script exit status alone is **not** a passing quality gate: inspect each JSON
result and `exit` field. The malformed-export child intentionally exits with 70
after recording an uncaught exception; the retired-reuse crash child exits with
73 before publication. Those numbers are harness markers, not product behavior.

The scripts do not start a production server or call a model/provider. They use
synthetic filesystem fixtures, actual application modules, and targeted fault
injection. For N1, only the contender's read of `/proc/stat` has its `btime`
shifted by 60 seconds; the live PID, boot ID and raw start ticks are real.

### Compare inherited findings with the base

Keep the review materials in this checkout and set `REVIEW_SOURCE` to a separate
checkout of `48a153e` with dependencies available. Set `REVIEW_LABEL=baseline`
and `REVIEW_SCENARIOS=export-malformed,character-reimport,import-delete-race`.
Do not run the new-owner/new-drain scenarios against the old base, where those
modules did not exist.

## Evidence

`evidence/` contains sanitized recorded JSON results and test/benchmark logs.
Machine-specific paths and the local host name have been replaced. The original
report's numeric results remain historical observations; portable scripts were
also rerun before publication, with results under `evidence/publish-validation/`.

No real conversations, credentials, runtime configuration, recovered logs,
dependency directories, or synthetic fixture trees are included in this branch.
