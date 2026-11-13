# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 822.2 / 822.2 | 2156.6 / 2156.6 | 124.7 / 124.7 | 323.7 / 641.7 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 220.0 / 220.0 | 220.0 / 220.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.6 / 19.6 | 21.0 / 21.0 | 14034.0 / 14034.0 | 87857.0 / 87857.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2156.6 / 2156.6 | 122.2 / 122.2 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 247.3 / 247.3 | 1.0 / 1.0 | 247.0 / 247.0 | 247.0 / 247.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 231.1 / 231.1 | 1.0 / 1.0 | 232.0 / 232.0 | 232.0 / 232.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 253.0 / 253.0 | 1.0 / 1.0 | 254.0 / 254.0 | 254.0 / 254.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 323.7 / 323.7 | 1.0 / 1.0 | 326.0 / 326.0 | 326.0 / 326.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 320.1 / 320.1 | 1.0 / 1.0 | 323.0 / 323.0 | 323.0 / 323.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 447.2 / 447.2 | 1.0 / 1.0 | 451.0 / 451.0 | 451.0 / 451.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 365.9 / 365.9 | 1.0 / 1.0 | 370.0 / 370.0 | 370.0 / 370.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 411.0 / 411.0 | 1.0 / 1.0 | 417.0 / 417.0 | 417.0 / 417.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 481.7 / 481.7 | 1.0 / 1.0 | 488.0 / 488.0 | 488.0 / 488.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 641.7 / 641.7 | 1.0 / 1.0 | 658.0 / 658.0 | 658.0 / 658.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
