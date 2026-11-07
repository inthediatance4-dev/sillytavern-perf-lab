# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 0/2 | — | — | — | — | — |
| 2000 | 0 | 1/2 | 5861.8 / 5861.8 | 5298.2 / 5298.2 | 75.9 / 75.9 | — | 23.3 / 23.3 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | — |
| 2000 | 0 | 5.0 / 5.0 | 5204.0 / 5204.0 | 4153.0 / 4153.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | — | — |
| 2000 | 0 | 16.7 / 16.7 | 33.4 / 33.4 | 61.5 / 61.5 | 0.8 / 0.8 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | — | — | — | — |
| 2000 | 0 | 23.3 / 23.3 | 23.3 / 23.3 | 154216.0 / 154216.0 | 154216.0 / 154216.0 | 2000.0 / 2000.0 | 2000.0 / 2000.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | — |
| 2000 | 0 | 5298.2 / 5298.2 | 75.0 / 75.0 | 3305.0 / 3305.0 |
