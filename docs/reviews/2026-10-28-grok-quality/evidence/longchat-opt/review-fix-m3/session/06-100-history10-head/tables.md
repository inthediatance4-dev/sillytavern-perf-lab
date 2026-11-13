# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 789.4 / 789.4 | 862.1 / 862.1 | 36.0 / 36.0 | 211.2 / 275.9 | 19.5 / 19.5 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 177.0 / 177.0 | 177.0 / 177.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.5 / 19.5 | 21.0 / 21.0 | 14034.0 / 14034.0 | 87857.0 / 87857.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 862.1 / 862.1 | 35.0 / 35.0 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 156.8 / 156.8 | 1.0 / 1.0 | 72.0 / 72.0 | 72.0 / 72.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 156.7 / 156.7 | 1.0 / 1.0 | 73.0 / 73.0 | 73.0 / 73.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 171.6 / 171.6 | 1.0 / 1.0 | 87.0 / 87.0 | 87.0 / 87.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 184.8 / 184.8 | 1.0 / 1.0 | 112.0 / 112.0 | 112.0 / 112.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 213.1 / 213.1 | 1.0 / 1.0 | 129.0 / 129.0 | 129.0 / 129.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 211.2 / 211.2 | 1.0 / 1.0 | 139.0 / 139.0 | 139.0 / 139.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 226.4 / 226.4 | 1.0 / 1.0 | 151.0 / 151.0 | 151.0 / 151.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 233.9 / 233.9 | 1.0 / 1.0 | 161.0 / 161.0 | 161.0 / 161.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 243.9 / 243.9 | 1.0 / 1.0 | 170.0 / 170.0 | 170.0 / 170.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 275.9 / 275.9 | 1.0 / 1.0 | 202.0 / 202.0 | 202.0 / 202.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
