# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 1048.1 / 1048.1 | 832.9 / 832.9 | 51.4 / 51.4 | 251.4 / 344.4 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2.0 / 2.0 | 389.0 / 389.0 | 321.0 / 321.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.6 / 19.6 | 20.9 / 20.9 | 14034.0 / 14034.0 | 87857.0 / 87857.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 832.9 / 832.9 | 50.2 / 50.2 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 344.4 / 344.4 | 1.0 / 1.0 | 153.0 / 153.0 | 153.0 / 153.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 275.9 / 275.9 | 1.0 / 1.0 | 103.0 / 103.0 | 103.0 / 103.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 251.4 / 251.4 | 1.0 / 1.0 | 154.0 / 154.0 | 154.0 / 154.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 241.3 / 241.3 | 1.0 / 1.0 | 120.0 / 120.0 | 120.0 / 120.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 216.7 / 216.7 | 1.0 / 1.0 | 134.0 / 134.0 | 134.0 / 134.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 243.8 / 243.8 | 1.0 / 1.0 | 146.0 / 146.0 | 146.0 / 146.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 276.9 / 276.9 | 1.0 / 1.0 | 157.0 / 157.0 | 157.0 / 157.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 240.2 / 240.2 | 1.0 / 1.0 | 167.0 / 167.0 | 167.0 / 167.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 294.9 / 294.9 | 1.0 / 1.0 | 188.0 / 188.0 | 188.0 / 188.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 326.7 / 326.7 | 1.0 / 1.0 | 220.0 / 220.0 | 220.0 / 220.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
