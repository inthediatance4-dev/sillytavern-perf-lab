# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 3000 | 0 | 5/5 | 7861.6 / 10089.1 | 3282.6 / 4758.8 | 64.8 / 108.9 | — | 26.2 / 26.3 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 3000 | 0 | 8.0 / 10.0 | 6926.0 / 9086.0 | 4019.0 / 4682.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 3000 | 0 | 33.3 / 33.4 | 33.4 / 83.4 | 77.9 / 96.7 | 0.0 / 15.6 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 3000 | 0 | 26.2 / 26.3 | 26.2 / 26.3 | 228191.0 / 228191.0 | 228191.0 / 228191.0 | 3000.0 / 3000.0 | 3000.0 / 3000.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 3000 | 0 | 3282.6 / 4758.8 | 63.9 / 108.0 | 4603.0 / 4603.0 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
