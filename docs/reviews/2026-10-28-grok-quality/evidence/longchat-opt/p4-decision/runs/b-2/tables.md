# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 770.2 / 770.2 | 1666.5 / 1666.5 | 129.5 / 129.5 | 409.1 / 613.1 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 172.0 / 172.0 | 172.0 / 172.0 |

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
| 2000 | 100 | 1666.5 / 1666.5 | 128.7 / 128.7 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 201.5 / 201.5 | 1.0 / 1.0 | 95.0 / 95.0 | 95.0 / 95.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 295.1 / 295.1 | 1.0 / 1.0 | 122.0 / 122.0 | 122.0 / 122.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 378.0 / 378.0 | 1.0 / 1.0 | 196.0 / 196.0 | 196.0 / 196.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 405.9 / 405.9 | 1.0 / 1.0 | 234.0 / 234.0 | 234.0 / 234.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 452.6 / 452.6 | 1.0 / 1.0 | 265.0 / 265.0 | 265.0 / 265.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 465.2 / 465.2 | 1.0 / 1.0 | 298.0 / 298.0 | 298.0 / 298.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 432.3 / 432.3 | 1.0 / 1.0 | 204.0 / 204.0 | 204.0 / 204.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 409.1 / 409.1 | 1.0 / 1.0 | 270.0 / 270.0 | 270.0 / 270.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 613.1 / 613.1 | 1.0 / 1.0 | 461.0 / 461.0 | 461.0 / 461.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 474.0 / 474.0 | 1.0 / 1.0 | 289.0 / 289.0 | 289.0 / 289.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
