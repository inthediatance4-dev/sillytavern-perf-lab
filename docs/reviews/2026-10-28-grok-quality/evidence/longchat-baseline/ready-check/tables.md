# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/2 | 844.9 / 844.9 | 732.9 / 732.9 | 29.0 / 29.0 | 868.8 / 1174.7 | 20.8 / 20.8 |
| 2000 | 0 | 1/2 | 5917.9 / 5917.9 | 4496.7 / 4496.7 | 47.8 / 47.8 | — | 23.2 / 23.2 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 229.0 / 229.0 | 229.0 / 229.0 |
| 2000 | 0 | 3.0 / 3.0 | 5173.0 / 5173.0 | 4141.0 / 4141.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 16.7 / 16.7 | 16.7 / 16.7 | 30.3 / 30.3 | 0.0 / 0.0 |
| 2000 | 0 | 16.7 / 16.7 | 33.4 / 33.4 | 48.4 / 48.4 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 20.8 / 20.8 | 21.2 / 21.2 | 14058.0 / 14058.0 | 36140.0 / 36140.0 | 100.0 / 100.0 | 400.0 / 400.0 |
| 2000 | 0 | 23.2 / 23.2 | 23.2 / 23.2 | 154216.0 / 154216.0 | 154216.0 / 154216.0 | 2000.0 / 2000.0 | 2000.0 / 2000.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 732.9 / 732.9 | 28.0 / 28.0 | 2684.0 / 2684.0 |
| 2000 | 0 | 4496.7 / 4496.7 | 46.1 / 46.1 | 3305.0 / 3305.0 |
