# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 791.5 / 791.5 | 785.5 / 785.5 | 57.3 / 57.3 | 208.0 / 275.6 | 19.5 / 19.5 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 178.0 / 178.0 | 178.0 / 178.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.5 / 19.5 | 20.9 / 20.9 | 14034.0 / 14034.0 | 87857.0 / 87857.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 785.5 / 785.5 | 56.2 / 56.2 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 237.4 / 237.4 | 2.0 / 2.0 | 151.0 / 151.0 | 78.0 / 78.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 152.4 / 152.4 | 1.0 / 1.0 | 79.0 / 79.0 | 79.0 / 79.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 173.9 / 173.9 | 1.0 / 1.0 | 91.0 / 91.0 | 91.0 / 91.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 181.9 / 181.9 | 1.0 / 1.0 | 109.0 / 109.0 | 109.0 / 109.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 205.4 / 205.4 | 1.0 / 1.0 | 122.0 / 122.0 | 122.0 / 122.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 208.0 / 208.0 | 1.0 / 1.0 | 135.0 / 135.0 | 135.0 / 135.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 218.0 / 218.0 | 1.0 / 1.0 | 145.0 / 145.0 | 145.0 / 145.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 236.0 / 236.0 | 1.0 / 1.0 | 163.0 / 163.0 | 163.0 / 163.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 237.1 / 237.1 | 1.0 / 1.0 | 164.0 / 164.0 | 164.0 / 164.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 275.6 / 275.6 | 1.0 / 1.0 | 202.0 / 202.0 | 202.0 / 202.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
