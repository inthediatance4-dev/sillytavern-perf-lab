# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 861.8 / 861.8 | 690.5 / 690.5 | 22.5 / 22.5 | 774.2 / 1136.5 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 250.0 / 250.0 | 250.0 / 250.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 16.7 / 16.7 | 16.7 / 16.7 | 31.1 / 31.1 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.6 / 19.6 | 20.1 / 20.1 | 14038.0 / 14038.0 | 36182.0 / 36182.0 | 100.0 / 100.0 | 400.0 / 400.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 690.5 / 690.5 | 21.8 / 21.8 | 2365.0 / 2365.0 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 752.5 / 752.5 | 1.0 / 1.0 | 243.0 / 243.0 | 243.0 / 243.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 774.2 / 774.2 | 2.0 / 2.0 | 272.0 / 272.0 | 207.0 / 207.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 1136.5 / 1136.5 | 3.0 / 3.0 | 370.0 / 370.0 | 234.0 / 234.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
