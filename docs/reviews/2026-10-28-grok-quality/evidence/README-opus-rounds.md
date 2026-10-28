# Opus rounds: rewritten commit references

Benchmark JSON files retain their original `currentCommit` values. The history
rewrite redacted hostnames in evidence; benchmarked source trees are identical.
Evidence bytes affected by redaction are the only tree differences. Existing
benchmark JSON and evidence files are preserved.

| Pre-rewrite SHA | Rewritten SHA |
| --- | --- |
| `505cb03` | `5e6cff6` |
| `8255099` | `31801d2` |
| `506ad49` | `1ef39e9` |
| `8b17d30` | `ed3fc98` |
| `fa08139` | `21649df` |
| `2402847` | `0ad1e44` |
| `fee0bc7` | `57d9ce2` |
| `25b67f2` | `255cc5a` |
| `c6291f0` | `c0f8281` |
| `b6ec95c` | `bc5aff2` |
| `71eb444` | `794bc72` |
| `786a6b0` | `e34806e` |
| `8db195d` | `a343a5c` |
| `0daa4bf` | `06024d4` |
| `b312204` | `1cc64b5` |

## Benchmark records

Each JSON containing `currentCommit` under this evidence directory was checked.
Paths below are relative to this directory.

| JSON | Recorded currentCommit | Corresponding rewritten source tree |
| --- | --- | --- |
| `opus-round1/p1-5/bench-perf-node22-runs15.json` | `fee0bc77153b95ebcb8d061db04b7b5e76885773` | `57d9ce2` |
| `opus-round1/p1-5/bench-perf-node22-runs5.json` | `fee0bc77153b95ebcb8d061db04b7b5e76885773` | `57d9ce2` |
| `opus-round1/p1-5/bench-perf.json` | `8b17d30105728b5c59219ced5687e0e64160162b` | `ed3fc98` |
| `opus-round1.5/bench-perf-runs30-node22.json` | `786a6b0e999786c30a3bd5d17e781ec9b16cf32d` | `e34806e` |
| `opus-round1.5/bench-perf-runs30.json` | `786a6b0e999786c30a3bd5d17e781ec9b16cf32d` | `e34806e` |

Verified each benchmark pair with `git diff --quiet OLD NEW -- src tests scripts package.json package-lock.json` (all equal). These references do not claim that redacted evidence blobs have identical tree hashes.
