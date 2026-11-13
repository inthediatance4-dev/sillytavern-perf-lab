# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 1211.3 / 1211.3 | 2241.1 / 2241.1 | 126.1 / 126.1 | 560.8 / 876.7 | 19.4 / 19.4 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2.0 / 2.0 | 565.0 / 565.0 | 466.0 / 466.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.4 / 19.4 | 21.1 / 21.1 | 14034.0 / 14034.0 | 87857.0 / 87857.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2241.1 / 2241.1 | 120.9 / 120.9 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 492.3 / 492.3 | 1.0 / 1.0 | 493.0 / 493.0 | 493.0 / 493.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 553.3 / 553.3 | 1.0 / 1.0 | 554.0 / 554.0 | 554.0 / 554.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 588.9 / 588.9 | 1.0 / 1.0 | 591.0 / 591.0 | 591.0 / 591.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 418.9 / 418.9 | 1.0 / 1.0 | 421.0 / 421.0 | 421.0 / 421.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 630.2 / 630.2 | 1.0 / 1.0 | 633.0 / 633.0 | 633.0 / 633.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 502.8 / 502.8 | 1.0 / 1.0 | 507.0 / 507.0 | 507.0 / 507.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 560.8 / 560.8 | 1.0 / 1.0 | 569.0 / 569.0 | 569.0 / 569.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 792.8 / 792.8 | 1.0 / 1.0 | 798.0 / 798.0 | 798.0 / 798.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 876.7 / 876.7 | 1.0 / 1.0 | 889.0 / 889.0 | 889.0 / 889.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 621.8 / 621.8 | 1.0 / 1.0 | 633.0 / 633.0 | 633.0 / 633.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
