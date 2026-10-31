# Blind Fate Cards Implementation Plan

**Goal:** Implement the approved sealed-card interaction without changing existing Director instructions.

**Architecture:** Independent fate.js controller/model, fate-ui.js for DOM, one index.js integration hook, and scoped group regeneration notifications. Existing quiet-generation and success-completion APIs remain authoritative.

**Tech Stack:** Existing browser ES modules, node:test, Python Playwright and fake OpenAI fixture. Test with existing Node v24.22.1.

1. Add failing tests and implement fate.js: strict response validation, public projection, immutable held/bound state, operation identity, temporary prompt shielding, success-only consumption and scoped replay.
2. Add the two generic group-regeneration notifications with finally cleanup. Integrate Fate into the existing Director interceptor after quiet/impersonate exclusion.
3. Implement the panel in fate-ui.js: draw/strength/preview/adopt/discard/retry, busy and stale handling, responsive layout. Use callback-based injection of core UI dependencies and no private content in UI.
4. Add real browser Fate scenarios in the existing framework/fixture with deterministic model replies and failures. Verify actual request bodies, JSONL metadata, reload, binding, group identity, hidden DOM and 390px width.
5. Run affected node tests and targeted lint, independent spec/code review, Fate browser tests and the existing full Director regression. Address failures before rerunning affected checks.
6. Update both READMEs, save sanitized evidence/hashes, commit independently, normal push to feature/director-fate-cards and verify final CI. Leave merge for review.
