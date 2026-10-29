# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 5/5 | 951.3 / 1124.2 | 1060.4 / 2215.4 | 45.9 / 97.0 | 295.8 / 517.1 | 19.5 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 2.0 | 289.0 / 450.0 | 289.0 / 372.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.5 / 19.6 | 20.9 / 20.9 | 14088.0 / 14088.0 | 87915.0 / 87915.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1060.4 / 2215.4 | 44.8 / 96.3 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 5 | 100.0 / 100.0 | 349.6 / 395.2 | 1.0 / 1.0 | 158.0 / 209.0 | 158.0 / 209.0 |
| 2000 | 100 | 2 | 5 | 100.0 / 100.0 | 315.9 / 378.7 | 1.0 / 1.0 | 142.0 / 188.0 | 142.0 / 188.0 |
| 2000 | 100 | 3 | 5 | 100.0 / 100.0 | 202.3 / 415.8 | 1.0 / 1.0 | 107.0 / 221.0 | 107.0 / 221.0 |
| 2000 | 100 | 4 | 5 | 100.0 / 100.0 | 228.2 / 437.5 | 1.0 / 1.0 | 120.0 / 234.0 | 120.0 / 234.0 |
| 2000 | 100 | 5 | 5 | 100.0 / 100.0 | 227.2 / 419.9 | 1.0 / 1.0 | 142.0 / 247.0 | 142.0 / 247.0 |
| 2000 | 100 | 6 | 5 | 100.0 / 100.0 | 237.0 / 480.2 | 1.0 / 1.0 | 154.0 / 299.0 | 154.0 / 299.0 |
| 2000 | 100 | 7 | 5 | 100.0 / 100.0 | 303.0 / 517.1 | 1.0 / 1.0 | 179.0 / 300.0 | 179.0 / 300.0 |
| 2000 | 100 | 8 | 5 | 100.0 / 100.0 | 282.7 / 475.5 | 1.0 / 1.0 | 199.0 / 298.0 | 199.0 / 298.0 |
| 2000 | 100 | 9 | 5 | 100.0 / 100.0 | 307.3 / 422.6 | 1.0 / 1.0 | 222.0 / 260.0 | 222.0 / 260.0 |
| 2000 | 100 | 10 | 5 | 100.0 / 100.0 | 372.0 / 541.1 | 1.0 / 1.0 | 275.0 / 382.0 | 275.0 / 382.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
