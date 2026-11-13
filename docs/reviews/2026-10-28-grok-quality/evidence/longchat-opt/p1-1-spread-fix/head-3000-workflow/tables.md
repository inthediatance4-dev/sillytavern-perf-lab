# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 3000 | 0 | 5/5 | 9712.9 / 10601.2 | 8026.7 / 8850.3 | 68.3 / 81.4 | — | 25.8 / 26.7 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 3000 | 0 | 6.0 / 6.0 | 8668.0 / 9600.0 | 7320.0 / 7774.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 3000 | 0 | 33.3 / 49.9 | 33.4 / 83.3 | 81.1 / 97.5 | 1.6 / 23.8 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 3000 | 0 | 25.8 / 26.7 | 25.8 / 26.7 | 228191.0 / 228191.0 | 228191.0 / 228191.0 | 3000.0 / 3000.0 | 3000.0 / 3000.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 3000 | 0 | 8026.7 / 8850.3 | 67.4 / 80.1 | 4603.0 / 4603.0 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
