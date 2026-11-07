# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 1068.5 / 1068.5 | 612.4 / 612.4 | 46.9 / 46.9 | — | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2.0 / 2.0 | 427.0 / 427.0 | 364.0 / 364.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.6 / 19.6 | 19.6 / 19.6 | 14035.0 / 14035.0 | 14035.0 / 14035.0 | 100.0 / 100.0 | 100.0 / 100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 612.4 / 612.4 | 46.1 / 46.1 | 2233.1 / 2233.1 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
