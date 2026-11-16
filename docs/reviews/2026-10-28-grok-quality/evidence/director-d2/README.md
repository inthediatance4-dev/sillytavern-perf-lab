D2 adds the Director preset manager and the `/director` slash command.
Chapter navigation and streaming changes remain for later steps.

Verification:

- `npm run lint` and `git diff --check` passed.
- Node 24.22.1 and Node 22.20.0: 21/21 director template and preset tests passed.
  Node 20 was not installed in this environment.
- `browser.json` is the isolated Chromium acceptance result: 24 checks passed,
  3 generation requests, 0 page errors. The disabled left-row hash matches the
  D1 run. The disabled chat hash is compared with the base snapshot in the same
  run; it includes the per-run fixture id, so it is not a cross-run fingerprint.

The browser test still accepts `--fake-endpoint` until the S0 provider is on
this branch. It uses random ports, a temporary data root, and only its own
child processes. Evidence keeps summary hashes. Profiles, logs, and browser
caches are not committed.

Import validation is atomic: a bad file shows a toastr error and leaves the
saved presets unchanged. Duplicate ids are rejected, not regenerated. `/director`
text fills only the first `{{input}}`; later inputs use explicit defaults, and
only inputs without defaults open a dialog. A pure numeric selector is always
the 1-based position.
