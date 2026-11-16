# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 1056.1 / 1056.1 | 1034.8 / 1034.8 | 97.7 / 97.7 | 397.2 / 558.7 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2.0 / 2.0 | 426.0 / 426.0 | 375.0 / 375.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.6 / 19.6 | 21.0 / 21.0 | 14035.0 / 14035.0 | 87858.0 / 87858.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1034.8 / 1034.8 | 95.4 / 95.4 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 394.2 / 394.2 | 1.0 / 1.0 | 196.0 / 196.0 | 196.0 / 196.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 420.2 / 420.2 | 1.0 / 1.0 | 225.0 / 225.0 | 225.0 / 225.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 275.7 / 275.7 | 1.0 / 1.0 | 98.0 / 98.0 | 98.0 / 98.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 397.2 / 397.2 | 1.0 / 1.0 | 213.0 / 213.0 | 213.0 / 213.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 244.7 / 244.7 | 1.0 / 1.0 | 131.0 / 131.0 | 131.0 / 131.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 438.8 / 438.8 | 1.0 / 1.0 | 266.0 / 266.0 | 266.0 / 266.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 411.2 / 411.2 | 1.0 / 1.0 | 244.0 / 244.0 | 244.0 / 244.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 386.3 / 386.3 | 1.0 / 1.0 | 211.0 / 211.0 | 211.0 / 211.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 558.7 / 558.7 | 1.0 / 1.0 | 390.0 / 390.0 | 390.0 / 390.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 462.4 / 462.4 | 1.0 / 1.0 | 294.0 / 294.0 | 294.0 / 294.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
