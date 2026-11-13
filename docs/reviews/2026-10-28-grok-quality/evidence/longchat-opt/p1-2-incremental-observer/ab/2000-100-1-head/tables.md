# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 851.9 / 851.9 | 1208.7 / 1208.7 | 43.0 / 43.0 | 753.1 / 1224.3 | 19.5 / 19.5 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2.0 / 2.0 | 252.0 / 252.0 | 200.0 / 200.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 16.7 / 16.7 | 16.8 / 16.8 | 17.2 / 17.2 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.5 / 19.5 | 20.0 / 20.0 | 14038.0 / 14038.0 | 36182.0 / 36182.0 | 100.0 / 100.0 | 400.0 / 400.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1208.7 / 1208.7 | 42.3 / 42.3 | 2365.0 / 2365.0 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 739.2 / 739.2 | 1.0 / 1.0 | 217.0 / 217.0 | 217.0 / 217.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 753.1 / 753.1 | 2.0 / 2.0 | 248.0 / 248.0 | 146.0 / 146.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 1224.3 / 1224.3 | 3.0 / 3.0 | 434.0 / 434.0 | 184.0 / 184.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
