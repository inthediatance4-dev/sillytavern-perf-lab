# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 990.9 / 990.9 | 2339.8 / 2339.8 | 81.7 / 81.7 | 642.4 / 900.4 | 19.5 / 19.5 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 288.0 / 288.0 | 288.0 / 288.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.5 / 19.5 | 21.1 / 21.1 | 14034.0 / 14034.0 | 87857.0 / 87857.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2339.8 / 2339.8 | 73.2 / 73.2 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 461.4 / 461.4 | 1.0 / 1.0 | 462.0 / 462.0 | 462.0 / 462.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 275.2 / 275.2 | 1.0 / 1.0 | 276.0 / 276.0 | 276.0 / 276.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 473.3 / 473.3 | 1.0 / 1.0 | 475.0 / 475.0 | 475.0 / 475.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 670.0 / 670.0 | 1.0 / 1.0 | 673.0 / 673.0 | 673.0 / 673.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 450.1 / 450.1 | 1.0 / 1.0 | 457.0 / 457.0 | 457.0 / 457.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 885.4 / 885.4 | 1.0 / 1.0 | 893.0 / 893.0 | 893.0 / 893.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 642.4 / 642.4 | 1.0 / 1.0 | 647.0 / 647.0 | 647.0 / 647.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 736.7 / 736.7 | 1.0 / 1.0 | 747.0 / 747.0 | 747.0 / 747.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 900.4 / 900.4 | 1.0 / 1.0 | 912.0 / 912.0 | 912.0 / 912.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 847.7 / 847.7 | 1.0 / 1.0 | 870.0 / 870.0 | 870.0 / 870.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
