# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 934.7 / 934.7 | 2650.5 / 2650.5 | 112.7 / 112.7 | 532.4 / 885.6 | 19.4 / 19.4 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 284.0 / 284.0 | 284.0 / 284.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.4 / 19.4 | 20.9 / 20.9 | 14034.0 / 14034.0 | 87857.0 / 87857.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2650.5 / 2650.5 | 111.9 / 111.9 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 436.7 / 436.7 | 1.0 / 1.0 | 437.0 / 437.0 | 437.0 / 437.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 293.6 / 293.6 | 1.0 / 1.0 | 294.0 / 294.0 | 294.0 / 294.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 532.4 / 532.4 | 1.0 / 1.0 | 534.0 / 534.0 | 534.0 / 534.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 488.4 / 488.4 | 1.0 / 1.0 | 491.0 / 491.0 | 491.0 / 491.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 482.8 / 482.8 | 1.0 / 1.0 | 490.0 / 490.0 | 490.0 / 490.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 758.1 / 758.1 | 1.0 / 1.0 | 767.0 / 767.0 | 767.0 / 767.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 586.2 / 586.2 | 1.0 / 1.0 | 600.0 / 600.0 | 600.0 / 600.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 773.8 / 773.8 | 1.0 / 1.0 | 788.0 / 788.0 | 788.0 / 788.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 885.6 / 885.6 | 1.0 / 1.0 | 896.0 / 896.0 | 896.0 / 896.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 650.2 / 650.2 | 1.0 / 1.0 | 665.0 / 665.0 | 665.0 / 665.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
