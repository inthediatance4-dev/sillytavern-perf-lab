# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 878.1 / 878.1 | 1370.1 / 1370.1 | 53.1 / 53.1 | 214.9 / 388.5 | 19.5 / 19.5 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 201.0 / 201.0 | 201.0 / 201.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.5 / 19.5 | 20.9 / 20.9 | 14087.0 / 14087.0 | 87914.0 / 87914.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1370.1 / 1370.1 | 51.9 / 51.9 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 214.9 / 214.9 | 1.0 / 1.0 | 119.0 / 119.0 | 119.0 / 119.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 176.1 / 176.1 | 1.0 / 1.0 | 78.0 / 78.0 | 78.0 / 78.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 204.2 / 204.2 | 1.0 / 1.0 | 102.0 / 102.0 | 102.0 / 102.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 206.7 / 206.7 | 1.0 / 1.0 | 112.0 / 112.0 | 112.0 / 112.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 212.9 / 212.9 | 1.0 / 1.0 | 128.0 / 128.0 | 128.0 / 128.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 221.7 / 221.7 | 1.0 / 1.0 | 138.0 / 138.0 | 138.0 / 138.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 388.5 / 388.5 | 1.0 / 1.0 | 254.0 / 254.0 | 254.0 / 254.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 249.5 / 249.5 | 1.0 / 1.0 | 176.0 / 176.0 | 176.0 / 176.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 270.3 / 270.3 | 1.0 / 1.0 | 197.0 / 197.0 | 197.0 / 197.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 319.7 / 319.7 | 1.0 / 1.0 | 233.0 / 233.0 | 233.0 / 233.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
