# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 0 | 1/1 | 5348.5 / 5348.5 | 1772.4 / 1772.4 | 70.6 / 70.6 | — | 22.6 / 22.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 0 | 5.0 / 5.0 | 4444.0 / 4444.0 | 2588.0 / 2588.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 0 | 16.7 / 16.7 | 33.3 / 33.3 | 50.0 / 50.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 0 | 22.6 / 22.6 | 22.7 / 22.7 | 154301.0 / 154301.0 | 154301.0 / 154301.0 | 2000.0 / 2000.0 | 2000.0 / 2000.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 0 | 1772.4 / 1772.4 | 69.8 / 69.8 | 3068.3 / 3068.3 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
