# Expression mode flow implementation plan

> For agentic workers: use subagent-driven-development; implementation followed by fresh spec and quality review. User delegated decisions and authorized local isolated optimization.

**Goal:** remove geometry-based VN mode transition inference and redundant stable-mode resets.
**Architecture:** one private state boolean in existing expressions module; update synchronously after wrapper switching. Existing lifecycle/refresh/classification code unchanged.
**Tech Stack:** JavaScript ESM, Node native tests, real Chrome/jQuery browser checks.

### Task 1: actual worker regression and bounded implementation

Files: modify public/scripts/extensions/expressions/index.js; create tests/expression-mode-flow.test.mjs; modify package.json test:perf, scripts/start-performance-lab.mjs, tests/performance-lab.test.mjs, append ISOLATION.md.

- [ ] Evaluate actual source/state/function bodies with controlled context/DOM seams; baseline defaults to immutable base Git blob. Assert stable normal/VN geometry-free behavior, one reset per genuine transition, home/reopen, mobile/group/single, zero geometry/hidden ancestor and last-message invalidation. Do not copy worker implementation into tests; record mock scope.
- [ ] Run against original source and retain RED log. Assertions must fail for intended redundant reads/resets rather than harness errors.
- [ ] Add last-applied mode state only, preserve all asynchronous and public lifecycle behavior.
- [ ] Update safe test declaration; use distinct local lab folder/config/port8780 in launcher and corresponding test. Append accurate isolation limits.
- [ ] GREEN targeted tests and safe perf suite; source diff/syntax/staging hygiene; commit explicit files after tests.

### Task 2: root acceptance and delivery

- [ ] Fresh independent spec review then quality review; address real findings before proceeding.
- [ ] Browser actual-source geometry/mode contracts and synthetic full application A/B open/close checks; retain raw evidence and inspect console failures.
- [ ] Run declared safe Node20/24 suites; snapshot tested source fingerprints; verify protected old roots and original backups.
- [ ] Add verification report with what changed, measured evidence and remaining limits; commit explicitly reviewed source/doc files with cached whitespace and privacy checks.
- [ ] Gracefully stop own lab by root/command/PID/control/port checks. Package source ZIP/patch/full Git bundle; restore and compare all tracked blobs, final fresh reviewer and completion checks. Never deploy or permanently delete anything.
