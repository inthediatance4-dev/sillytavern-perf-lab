D1 adds the built-in Director extension only. Preset management, chapter navigation
and streaming changes remain for later steps. Product changes are confined to the
new extension directory; package.json adds its pure template tests to test:perf.

Verification:

- `npm run lint` and `git diff --check` passed.
- Node 24.22.1: 27/27 targeted tests passed (`director-template`,
  `longchat-keyboard`, `frontend-template-startup`).
- Node 20.19.2 and 22.20.0: all 8 template tests passed on each version.
- `browser.json` contains the isolated Chromium acceptance results and source
  hashes: 14 checks passed, 3 generation requests, 0 page errors. The provider is
  the S0 fake endpoint, imported read-only from the
  concurrent streaming work until the branches are integrated.

Run the retained browser test after S0 integration:

```sh
python tests/browser-director-lab.py --base ffd5f4e --output .evidence/director-d1/results.json
```

Before integration, pass `--fake-endpoint <s0-provider-module>` explicitly. The
script owns random ports, a temporary data root, and its child processes. It
archives base public assets without changing another worktree, then serves those
assets through browser routing for the disabled-extension comparison. The server
code and generated lib.js bundle are unchanged between the two page contexts.
Exact left-row and chat DOM equality and unchanged focus entries are checked;
enabling Director intentionally adds exactly one focus entry next to the wand.

Narrator equivalence compares actual /sys output, including nested swipe data and
rendered .mes_text HTML. Date.now is fixed for matching upstream gen_id values;
only send_date and extra.director are omitted from the comparison. Real generation
requests prove narrator inclusion, comment exclusion, and one-use injection
removal. Evidence retains summary hashes only; profiles, logs and browser caches
are not committed. No performance improvement or remote CI result is claimed.

Extension discovery already enumerates folders with manifests, so no registry
change is needed. source-manifest.json has no runtime/check consumer and remains
the historical snapshot. The new settings template uses the ordinary extension
template loader; no startup preload-list change is needed.
