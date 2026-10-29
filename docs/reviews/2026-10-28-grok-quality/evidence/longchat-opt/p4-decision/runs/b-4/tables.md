# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 979.0 / 979.0 | 909.5 / 909.5 | 68.7 / 68.7 | 302.3 / 590.2 | 19.5 / 19.5 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2.0 / 2.0 | 347.0 / 347.0 | 283.0 / 283.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.5 / 19.5 | 20.9 / 20.9 | 14035.0 / 14035.0 | 87858.0 / 87858.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 909.5 / 909.5 | 67.9 / 67.9 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 248.9 / 248.9 | 1.0 / 1.0 | 102.0 / 102.0 | 102.0 / 102.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 284.1 / 284.1 | 1.0 / 1.0 | 90.0 / 90.0 | 90.0 / 90.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 272.5 / 272.5 | 1.0 / 1.0 | 95.0 / 95.0 | 95.0 / 95.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 302.3 / 302.3 | 1.0 / 1.0 | 114.0 / 114.0 | 114.0 / 114.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 286.9 / 286.9 | 1.0 / 1.0 | 155.0 / 155.0 | 155.0 / 155.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 572.3 / 572.3 | 1.0 / 1.0 | 367.0 / 367.0 | 367.0 / 367.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 421.1 / 421.1 | 1.0 / 1.0 | 284.0 / 284.0 | 284.0 / 284.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 330.5 / 330.5 | 1.0 / 1.0 | 168.0 / 168.0 | 168.0 / 168.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 590.2 / 590.2 | 1.0 / 1.0 | 410.0 / 410.0 | 410.0 / 410.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 338.1 / 338.1 | 1.0 / 1.0 | 242.0 / 242.0 | 242.0 / 242.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
