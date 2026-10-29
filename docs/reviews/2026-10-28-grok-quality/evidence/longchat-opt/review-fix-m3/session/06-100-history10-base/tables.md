# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 1094.8 / 1094.8 | 1642.6 / 1642.6 | 113.2 / 113.2 | 496.4 / 753.7 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 422.0 / 422.0 | 422.0 / 422.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.6 / 19.6 | 20.9 / 20.9 | 14034.0 / 14034.0 | 87857.0 / 87857.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1642.6 / 1642.6 | 110.9 / 110.9 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 496.4 / 496.4 | 1.0 / 1.0 | 497.0 / 497.0 | 497.0 / 497.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 480.7 / 480.7 | 1.0 / 1.0 | 482.0 / 482.0 | 482.0 / 482.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 565.7 / 565.7 | 1.0 / 1.0 | 567.0 / 567.0 | 567.0 / 567.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 569.9 / 569.9 | 1.0 / 1.0 | 572.0 / 572.0 | 572.0 / 572.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 352.4 / 352.4 | 1.0 / 1.0 | 356.0 / 356.0 | 356.0 / 356.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 753.7 / 753.7 | 1.0 / 1.0 | 762.0 / 762.0 | 762.0 / 762.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 456.3 / 456.3 | 1.0 / 1.0 | 461.0 / 461.0 | 461.0 / 461.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 434.5 / 434.5 | 1.0 / 1.0 | 440.0 / 440.0 | 440.0 / 440.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 523.9 / 523.9 | 1.0 / 1.0 | 531.0 / 531.0 | 531.0 / 531.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 564.0 / 564.0 | 1.0 / 1.0 | 572.0 / 572.0 | 572.0 / 572.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
