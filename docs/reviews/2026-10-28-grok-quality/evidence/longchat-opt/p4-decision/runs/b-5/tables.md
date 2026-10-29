# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 1115.7 / 1115.7 | 1704.8 / 1704.8 | 91.8 / 91.8 | 362.7 / 427.5 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2.0 / 2.0 | 481.0 / 481.0 | 413.0 / 413.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.6 / 19.6 | 20.9 / 20.9 | 14035.0 / 14035.0 | 87858.0 / 87858.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1704.8 / 1704.8 | 90.6 / 90.6 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 362.7 / 362.7 | 1.0 / 1.0 | 158.0 / 158.0 | 158.0 / 158.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 353.7 / 353.7 | 1.0 / 1.0 | 162.0 / 162.0 | 162.0 / 162.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 388.7 / 388.7 | 1.0 / 1.0 | 202.0 / 202.0 | 202.0 / 202.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 427.5 / 427.5 | 1.0 / 1.0 | 240.0 / 240.0 | 240.0 / 240.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 379.1 / 379.1 | 1.0 / 1.0 | 203.0 / 203.0 | 203.0 / 203.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 381.4 / 381.4 | 1.0 / 1.0 | 212.0 / 212.0 | 212.0 / 212.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 286.6 / 286.6 | 1.0 / 1.0 | 164.0 / 164.0 | 164.0 / 164.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 348.5 / 348.5 | 1.0 / 1.0 | 181.0 / 181.0 | 181.0 / 181.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 277.4 / 277.4 | 1.0 / 1.0 | 191.0 / 191.0 | 191.0 / 191.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 371.5 / 371.5 | 1.0 / 1.0 | 225.0 / 225.0 | 225.0 / 225.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
