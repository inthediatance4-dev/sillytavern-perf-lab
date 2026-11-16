# P2-a: verify input and output identities before skipping Webpack

Base product: `9360604`. Worktree patch is the optimized product; local Git index writes are unavailable in this environment. Final source checksums, validation and alternating S3 B-warm measurements are in `../p2-ac-ab/`.

## Skip contract

An output file merely existing never enables the shortcut. Before creating a compiler, middleware reads `<webpack-root>/<existing-cache-version>/manifest.json`, recomputes the input identity, and verifies SHA-256 for **every recorded emitted asset**, including `lib.js`. A missing, malformed, unreadable or mismatched manifest, input, or output runs the normal compiler. The Express middleware still serves `lib.js` from its usual output directory after a skip.

The existing frontend cache version continues to use Webpack's version and raw bytes of `webpack.config.js`, `package.json`, and both optional npm locks (`package-lock.json`, `npm-shrinkwrap.json`), with explicit absence identities. The manifest helper's raw source is now also a build/cache dependency. No Git revision enters the identity. Entry changes stay within the existing compiler-cache directory and invalidate the manifest independently.

The SHA-256 input identity combines that version with raw build input hashes and this explicit conservative source set:

- `public/lib.js` (the only configured public library entry; currently its imports are installed packages).
- Every file recursively beneath `public/lib/`, including file names and directory structure, whether or not currently imported.
- All files reported in the successful compilation's `fileDependencies`, including local transitive sources outside `public/lib/`, installed package source bytes and package metadata. Resolver ancestor directories contribute their existence/type, avoiding invalidation from unrelated sibling files.
- Directory entry names/types in `contextDependencies` and existence of every `missingDependencies` resolution candidate. Unknown/unreadable dependency state falls back to compilation.

Installed package bytes are hashed too, which is stricter than the previous immutable-package-per-version assumption. Webpack remains responsible for compiling and snapshot validation whenever a rebuild is needed.

Only a successful compile **and successful compiler close** can record the manifest. Recording verifies that the explicit source set stayed stable and refuses files modified during compilation. It includes all emitted asset hashes, uses atomic replacement with `write-file-atomic`'s default fsync, and treats any recording failure as an optional-cache failure. A later startup then compiles normally. `pruneCache` executes only on the normal compile path and retains its existing move-to-`.recycle` behavior. No lock, fsync, identity, six-second probe budget or exclusive reconcile-before-listen behavior is weakened.

Trace: `webpack_stats.detail.webpack_skipped=true`, `durationMs=0`, `builtModules=0` on a hit; false on a full compile. The enclosing webpack stage still includes input/output verification, so it is intentionally nonzero.

## Validation

The original 19 startup-webpack cases remain, with compiler creation counters and byte/SHA-256 checks added to the real-build test. Five additional cases cover malformed/missing manifests despite existing outputs, warm skip without pruning, both optional locks appearing/changing/disappearing, broad source edits, emitted license sidecar removal, and a local transitive source edit. Four compile-cache cases bring the targeted total to 28.

Cold/no-manifest builds compile; warm matching input/output manifests skip; missing or corrupt outputs rebuild, retaining fixture backups/recycled bytes. Evicting only Webpack's compiler cache does not itself invalidate an otherwise verified input/output manifest; remove or recycle the manifest too when deliberately requesting a first-build measurement. OS page-cache eviction does not alter byte identities. The requested measured scenario is S3; S2 timing and native Windows execution are not claimed here.

See `../p2-ac-ab/README.md` for cross-version test counts, measurements and limitations.
