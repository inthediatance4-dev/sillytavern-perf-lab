# Review blocker 1: Webpack manifest coverage

Decision: retain the validated skip, with two small correctness fixes. Hash mode/devtool/output selection explicitly, and only record disk outputs that equal this compiler's final asset bytes. Also fingerprint optional tool configuration presence/absence and browserslist environment inputs in the filesystem-cache version. No output-existence shortcut was added.

## Exact input identity

All byte hashes below are SHA-256, except the existing Webpack cache version, which is SHAKE-256 with an 8-byte output. The manifest hashes the JSON serialization of the fixed identity plus the recorded dependency identities with SHA-256. File paths in the dependency lists are relative to `config.context`; paths outside it retain `..` components and are still read and hashed. There is no `node_modules` exclusion.

| What | How hashed/represented | Source |
| --- | --- | --- |
| Webpack version | Version string in cache-version JSON | `webpack.version`, `getWebpackCacheVersion()` in `webpack.config.js` |
| Webpack configuration, manifest implementation, package metadata | Raw file bytes; included in the cache version and re-read in the fixed identity | `webpack.config.js`, `src/webpack-manifest.js`, `package.json`; `cacheInputs` / `cache.buildDependencies.config` |
| npm lockfiles | Raw bytes when present, literal `absent` when missing | Optional `package-lock.json`, `npm-shrinkwrap.json` in `cacheInputs` |
| Optional browserslist/Babel configuration | Raw bytes or `absent`; present files also become explicit Webpack build dependencies | Root `.browserslistrc`, `browserslist`, `.babelrc`, `.babelrc.json`, `.babelrc.js`, `.babelrc.cjs`, `.babelrc.mjs`, `babel.config.json`, `babel.config.js`, `babel.config.cjs`, `babel.config.mjs` in `cacheInputs` |
| External browserslist configuration/statistics | Raw bytes or `absent`, with the selected path also covered by the environment identity | Paths selected by `BROWSERSLIST_CONFIG` / `BROWSERSLIST_STATS` |
| Build environment | `[name, value-or-null]` pairs in the cache version | `NODE_ENV`, `BROWSERSLIST`, `BROWSERSLIST_ENV`, `BROWSERSLIST_CONFIG`, `BROWSERSLIST_STATS` |
| Build mode, source-map selection, output location | Explicit values in fixed-identity JSON | `config.mode`, `config.devtool`, `config.output.path`; production config is `production` / `false` |
| Entry and conservative library source tree | Entry bytes; recursively sorted file names and byte hashes below `public/lib/`, or `absent` | `config.entry` (`public/lib.js`), `sourceTree()` |
| Every file in the last complete compile's graph, including indirect local imports | Sorted path plus raw byte hash; directory dependencies use a `directory` marker; missing files use `absent` | **All** `compilation.fileDependencies`, recorded after real compilation by `record()` |
| Context dependencies | Sorted immediate child names and directory flags; referenced file bytes are covered by file dependencies | All `compilation.contextDependencies` |
| Missing resolution candidates | Sorted path plus current existence boolean | All `compilation.missingDependencies` |

Inspection at this revision found no Babel/browserslist configuration file in the project, no `babel`/`browserslist` package configuration key, and no ancestor browserslist config/package file. There is no Babel loader in this Webpack configuration. The original config had no direct build-time environment-variable branches: mode is fixed to production. Webpack can nevertheless consult browserslist through its implicit target; the five values above are now explicitly fingerprinted. `forceDist` and Docker detection select paths, rather than an environment-controlled build mode.

## Output set and atomicity

`compilation.getAssets()` supplies **every** asset name; there is no `lib.js`-only filter. The fixed entry output must be present in that list. Each named output is read and SHA-256 checked on every possible skip. Invalid names, missing assets, unreadable assets or any differing hash require the real compiler. The real fixture emits `lib.js`, `lib.js.LICENSE.txt` and `lib.js.map`; each is independently deleted and tampered with, then repaired by compilation and byte-compared with its original. Additional chunks are included by the same unfiltered asset enumeration.

At Webpack's `emit` hook, `capture()` hashes the final compiler Sources before Webpack replaces them with `SizeOnlySource`. After compiler close, `record()` hashes the complete asset set on disk and requires exact equality with those compiler hashes. Only those verified disk hashes enter the manifest. Source/config changes detected during compilation or any capture/read error prevent recording.

The manifest is replaced by `writeFileAtomic.sync()`, retaining its default fsync. The installed `write-file-atomic` implementation creates a uniquely named sibling temporary file, writes/fsyncs/closes it, then calls `renameSync(tmpfile, filename)`. Readers see an old or new complete manifest. Missing, invalid JSON, unsupported schema, truncated JSON, or unusable manifest contents all fall back to compilation; successful compilation rewrites a valid manifest.

## Concurrency

On ordinary non-Docker startup, different resolved data roots select different `<data-root>/_webpack/<version>/{cache,output}` directories and manifests. `forceDist` and Docker both select `<repo>/dist/_webpack/<version>/...`, so Docker processes from one tree share that location even with different data roots. Dist and ordinary data-root selections have different manifest locations and explicit output-path identities.

With `exclusiveDataRoot` enabled, the existing exclusive owner lock prevents two servers using the same data root. It remains unchanged, as do reconciliation-before-listen, path locks, identity checks and the six-second probe budget. With exclusivity disabled, or when distinct data roots share Docker/dist outputs, Webpack/cache/output writers can overlap. There is no new cross-process lock: optional Webpack cache failures and manifest uncertainty require compilation. Atomic manifest replacement prevents partial JSON; every later skip validates both input identity and all current output hashes.

The previously possible failure was an old compiler overwriting output before a newer compiler's `record()`: the newer inputs could bless older bytes. The new compiler-byte comparison refuses this record. A real-Webpack regression forces that interleaving at compiler close, verifies no matching manifest, and verifies the next build compiles and exports the new value. A writer changing files after a manifest was recorded makes its output hashes fail on the next check. As with any filesystem validation, the check describes bytes at validation time; disabling exclusive ownership does not provide lifetime isolation from arbitrary later writes or live source editing.

## Tests

Command for each runtime: `<node> --test tests/startup-webpack.test.mjs tests/startup-compile-cache.test.mjs`.

| Runtime | Webpack | Compile cache | Combined | Fail / skip |
| --- | ---: | ---: | ---: | ---: |
| Node 20.19.2 | 37 | 5 | 42 | 0 / 0 |
| Node 22.20.0 | 37 | 5 | 42 | 0 / 0 |
| Node 24.22.1 | 37 | 5 | 42 | 0 / 0 |

The Webpack count includes three emitted-asset subtests. The **original 19** tests remain present and pass on all three versions: backend revision stability (1), raw config/package/lock identity (3), explicit dependencies (1), lockless build (1), optional locks (2), required metadata failure (1), recycling (1), dist selection (1), compiler error/close handling (6), pending-until-close (1), real entry/dependency/output/failure behavior (1).

The remaining tests cover warm/missing manifests, optional lock changes, conservative library-tree changes, entry → `a.js` → `b.js` with only `b.js` edited and exported output checked, deletion and tampering of **each** emitted asset, invalid/wrong-schema/truncated manifests and valid rewrites, mode changes, optional Babel/browserslist config appearance/edit/removal, browserslist environment changes, independent dist/data roots, and the competing output writer.

`red.tap.gz` records the pre-fix failures for mode selection and competing output writes (32 pass, 2 fail). `node{20,22,24}.tap.gz` retain the final targeted results. `eslint.txt` records lint validation; `perf-node24.tap.gz` retains the required full suite result: **774 tests, 766 passed, 0 failed, 8 platform/explicit-condition skips** on Node 24.22.1. Fixtures, backups and caches were retained or moved to `.recycle`; none were recursively deleted.
