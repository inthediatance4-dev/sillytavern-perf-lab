# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 791.3 / 791.3 | 478.2 / 478.2 | 24.5 / 24.5 | 729.8 / 1239.8 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 178.0 / 178.0 | 178.0 / 178.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 16.7 / 16.7 | 16.7 / 16.7 | 24.6 / 24.6 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.6 / 19.6 | 20.1 / 20.1 | 14039.0 / 14039.0 | 36183.0 / 36183.0 | 100.0 / 100.0 | 400.0 / 400.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 478.2 / 478.2 | 23.7 / 23.7 | 2365.0 / 2365.0 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 717.7 / 717.7 | 1.0 / 1.0 | 190.0 / 190.0 | 190.0 / 190.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 729.8 / 729.8 | 2.0 / 2.0 | 226.0 / 226.0 | 143.0 / 143.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 1239.8 / 1239.8 | 3.0 / 3.0 | 307.0 / 307.0 | 148.0 / 148.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
