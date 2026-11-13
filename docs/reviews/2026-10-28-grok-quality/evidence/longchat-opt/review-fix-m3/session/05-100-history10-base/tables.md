# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 15425.8 / 15425.8 | 1491.6 / 1491.6 | 78.7 / 78.7 | 479.0 / 640.3 | 19.5 / 19.5 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2.0 / 2.0 | 14788.0 / 14788.0 | 14736.0 / 14736.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.5 / 19.5 | 21.0 / 21.0 | 14030.0 / 14030.0 | 87857.0 / 87857.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1491.6 / 1491.6 | 76.0 / 76.0 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 479.0 / 479.0 | 1.0 / 1.0 | 479.0 / 479.0 | 479.0 / 479.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 400.5 / 400.5 | 1.0 / 1.0 | 401.0 / 401.0 | 401.0 / 401.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 502.8 / 502.8 | 1.0 / 1.0 | 505.0 / 505.0 | 505.0 / 505.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 305.9 / 305.9 | 1.0 / 1.0 | 308.0 / 308.0 | 308.0 / 308.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 505.4 / 505.4 | 1.0 / 1.0 | 509.0 / 509.0 | 509.0 / 509.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 518.2 / 518.2 | 1.0 / 1.0 | 524.0 / 524.0 | 524.0 / 524.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 455.8 / 455.8 | 1.0 / 1.0 | 465.0 / 465.0 | 465.0 / 465.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 474.7 / 474.7 | 1.0 / 1.0 | 489.0 / 489.0 | 489.0 / 489.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 551.5 / 551.5 | 1.0 / 1.0 | 558.0 / 558.0 | 558.0 / 558.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 640.3 / 640.3 | 1.0 / 1.0 | 652.0 / 652.0 | 652.0 / 652.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
