# P2-c: optional Node module compile cache

Base: `9360604`. `server.js` calls the small built-in-only helper before dynamically importing the command-line parser or server-main. Cache directory: `node_modules/.cache/st-compile-cache`, relative to the application, independent of the launch directory.

The helper checks for `module.enableCompileCache` before filesystem access. Node 20 skips it. On supporting Node versions the directory is created recursively; exceptions and Node failure status results leave normal startup available. No data-root, lock, identity, fsync, probe-budget or reconcile behavior changes.

Validation: Node 24.22.1 and Node 20.19.2 each passed 4 helper tests: absent API, recursive directory creation, a directory blocked by a regular file (portable even under privileged users), and thrown/returned API failures. ESLint passed for server.js, helper and test. The test is included in `test:perf` for the existing Node 20/22/24 × Linux/Windows CI matrix.

Combined S3 B-warm measurement and final cross-version startup verification are recorded in `../p2-ac-ab/README.md`. This helper test alone makes no performance claim.
