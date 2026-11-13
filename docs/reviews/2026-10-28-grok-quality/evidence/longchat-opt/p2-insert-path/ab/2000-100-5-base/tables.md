# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 802.2 / 802.2 | 477.1 / 477.1 | 25.5 / 25.5 | 809.9 / 1173.4 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 186.0 / 186.0 | 186.0 / 186.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 16.7 / 16.7 | 16.7 / 16.7 | 18.9 / 18.9 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.6 / 19.6 | 20.1 / 20.1 | 14039.0 / 14039.0 | 36183.0 / 36183.0 | 100.0 / 100.0 | 400.0 / 400.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 477.1 / 477.1 | 24.9 / 24.9 | 2365.0 / 2365.0 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 720.4 / 720.4 | 1.0 / 1.0 | 195.0 / 195.0 | 195.0 / 195.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 809.9 / 809.9 | 2.0 / 2.0 | 307.0 / 307.0 | 184.0 / 184.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 1173.4 / 1173.4 | 3.0 / 3.0 | 330.0 / 330.0 | 165.0 / 165.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
