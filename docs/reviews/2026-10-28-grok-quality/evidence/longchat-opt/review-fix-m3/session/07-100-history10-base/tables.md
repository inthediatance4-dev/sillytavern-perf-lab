# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 1126.8 / 1126.8 | 2478.9 / 2478.9 | 123.9 / 123.9 | 647.6 / 984.7 | 19.4 / 19.4 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2.0 / 2.0 | 482.0 / 482.0 | 430.0 / 430.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.4 / 19.4 | 20.8 / 20.8 | 14034.0 / 14034.0 | 87857.0 / 87857.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2478.9 / 2478.9 | 122.9 / 122.9 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 320.8 / 320.8 | 1.0 / 1.0 | 321.0 / 321.0 | 321.0 / 321.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 343.4 / 343.4 | 1.0 / 1.0 | 344.0 / 344.0 | 344.0 / 344.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 554.9 / 554.9 | 1.0 / 1.0 | 557.0 / 557.0 | 557.0 / 557.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 588.2 / 588.2 | 1.0 / 1.0 | 591.0 / 591.0 | 591.0 / 591.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 647.6 / 647.6 | 1.0 / 1.0 | 655.0 / 655.0 | 655.0 / 655.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 719.4 / 719.4 | 1.0 / 1.0 | 729.0 / 729.0 | 729.0 / 729.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 648.9 / 648.9 | 1.0 / 1.0 | 658.0 / 658.0 | 658.0 / 658.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 811.8 / 811.8 | 1.0 / 1.0 | 825.0 / 825.0 | 825.0 / 825.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 984.7 / 984.7 | 1.0 / 1.0 | 1000.0 / 1000.0 | 1000.0 / 1000.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 874.7 / 874.7 | 1.0 / 1.0 | 891.0 / 891.0 | 891.0 / 891.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
