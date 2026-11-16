# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 771.5 / 771.5 | 1454.3 / 1454.3 | 103.9 / 103.9 | 199.9 / 555.5 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 175.0 / 175.0 | 175.0 / 175.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.6 / 19.6 | 21.0 / 21.0 | 14035.0 / 14035.0 | 87858.0 / 87858.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1454.3 / 1454.3 | 102.9 / 102.9 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 151.3 / 151.3 | 1.0 / 1.0 | 65.0 / 65.0 | 65.0 / 65.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 152.2 / 152.2 | 1.0 / 1.0 | 79.0 / 79.0 | 79.0 / 79.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 164.5 / 164.5 | 1.0 / 1.0 | 91.0 / 91.0 | 91.0 / 91.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 177.9 / 177.9 | 1.0 / 1.0 | 104.0 / 104.0 | 104.0 / 104.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 199.9 / 199.9 | 1.0 / 1.0 | 126.0 / 126.0 | 126.0 / 126.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 307.1 / 307.1 | 1.0 / 1.0 | 150.0 / 150.0 | 150.0 / 150.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 555.5 / 555.5 | 1.0 / 1.0 | 377.0 / 377.0 | 377.0 / 377.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 425.5 / 425.5 | 1.0 / 1.0 | 221.0 / 221.0 | 221.0 / 221.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 530.0 / 530.0 | 1.0 / 1.0 | 369.0 / 369.0 | 369.0 / 369.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 294.2 / 294.2 | 1.0 / 1.0 | 201.0 / 201.0 | 201.0 / 201.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
