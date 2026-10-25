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

`test:perf` runs 28 test files with synthetic fixtures (some bind localhost
sockets). The three independent historical-oracle suites skip gracefully when
Git or their historical objects are unavailable; a full-history checkout enables
those comparisons. `bench:perf` still requires historical Git objects.
`lint` parse-checks project source and enforces selected rules on lab modules,
scripts and tests; it is not a full recommended-rule gate.

`perf:lab` opens a server at **http://127.0.0.1:8780/** using this checkout's
`.lab-data/` and `.lab-config.yaml`. Every launch enforces loopback, disables SSL,
browser launch, extension auto-updates and server plugins, and rejects inherited
`SILLYTAVERN_*` overrides. It refuses an occupied port. Use synthetic data and one
server process per data root. See [ISOLATION.md](ISOLATION.md) for recovery,
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
