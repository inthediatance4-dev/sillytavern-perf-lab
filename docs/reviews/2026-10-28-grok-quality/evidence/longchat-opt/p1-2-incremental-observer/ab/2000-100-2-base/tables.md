# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 1093.2 / 1093.2 | 753.2 / 753.2 | 71.7 / 71.7 | 1061.4 / 1120.8 | 19.4 / 19.4 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 395.0 / 395.0 | 395.0 / 395.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 16.7 / 16.7 | 16.7 / 16.7 | 24.6 / 24.6 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.4 / 19.4 | 19.9 / 19.9 | 14038.0 / 14038.0 | 36182.0 / 36182.0 | 100.0 / 100.0 | 400.0 / 400.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 753.2 / 753.2 | 71.0 / 71.0 | 2365.0 / 2365.0 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 1061.4 / 1061.4 | 1.0 / 1.0 | 551.0 / 551.0 | 551.0 / 551.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 1120.8 / 1120.8 | 3.0 / 3.0 | 358.0 / 358.0 | 232.0 / 232.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 874.6 / 874.6 | 2.0 / 2.0 | 371.0 / 371.0 | 282.0 / 282.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
