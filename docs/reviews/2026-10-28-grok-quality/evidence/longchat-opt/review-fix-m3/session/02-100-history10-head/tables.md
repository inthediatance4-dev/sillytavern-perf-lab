# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 1091.1 / 1091.1 | 1988.7 / 1988.7 | 99.5 / 99.5 | 449.8 / 536.8 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2.0 / 2.0 | 452.0 / 452.0 | 389.0 / 389.0 |

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
| 2000 | 100 | 1988.7 / 1988.7 | 98.6 / 98.6 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 412.0 / 412.0 | 1.0 / 1.0 | 179.0 / 179.0 | 179.0 / 179.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 350.1 / 350.1 | 1.0 / 1.0 | 172.0 / 172.0 | 172.0 / 172.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 407.5 / 407.5 | 1.0 / 1.0 | 216.0 / 216.0 | 216.0 / 216.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 429.7 / 429.7 | 1.0 / 1.0 | 244.0 / 244.0 | 244.0 / 244.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 479.1 / 479.1 | 1.0 / 1.0 | 286.0 / 286.0 | 286.0 / 286.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 520.3 / 520.3 | 1.0 / 1.0 | 333.0 / 333.0 | 333.0 / 333.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 449.8 / 449.8 | 1.0 / 1.0 | 265.0 / 265.0 | 265.0 / 265.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 536.8 / 536.8 | 1.0 / 1.0 | 308.0 / 308.0 | 308.0 / 308.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 480.7 / 480.7 | 1.0 / 1.0 | 307.0 / 307.0 | 307.0 / 307.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 475.5 / 475.5 | 1.0 / 1.0 | 306.0 / 306.0 | 306.0 / 306.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
