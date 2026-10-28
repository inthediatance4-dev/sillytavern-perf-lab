# Linux synthetic upgrade / rollback drill

Node: v24.22.1; HEAD: 00fb3532dcc94061a4269956c71e6104321f0ce0



No unsafe behavior observed.



Error: AssertionError [ERR_ASSERTION]: Preparing worktree (detached HEAD 48a153e)
fatal: could not create directory of '/workspace/sillytavern-perf-lab/.git/worktrees/OLD': Read-only file system


128 !== 0

    at git (file:///workspace/wt-r3b/scripts/drill-upgrade-rollback.mjs:36:12)
    at async main (file:///workspace/wt-r3b/scripts/drill-upgrade-rollback.mjs:137:9)
    at async file:///workspace/wt-r3b/scripts/drill-upgrade-rollback.mjs:233:5

Full API observations, integrity findings, protected-directory snapshots and exact startup logs: [report.json](report.json).

Browser command (start NEW with a fresh synthetic temp root first):

```sh
LAB_URL=http://127.0.0.1:<port> LAB_EVIDENCE_DIR=<evidence-dir> /tmp/pw-venv/bin/python tests/browser-lifecycle-lab.py
```

Windows hands-on acceptance remains untested. This drill does not authorize deployment.
