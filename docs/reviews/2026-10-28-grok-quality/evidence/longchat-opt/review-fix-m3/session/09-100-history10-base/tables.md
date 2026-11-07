# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 1090.5 / 1090.5 | 2544.5 / 2544.5 | 106.5 / 106.5 | 568.7 / 841.2 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 396.0 / 396.0 | 396.0 / 396.0 |

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
| 2000 | 100 | 2544.5 / 2544.5 | 105.5 / 105.5 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 373.9 / 373.9 | 1.0 / 1.0 | 374.0 / 374.0 | 374.0 / 374.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 285.7 / 285.7 | 1.0 / 1.0 | 289.0 / 289.0 | 289.0 / 289.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 557.6 / 557.6 | 1.0 / 1.0 | 560.0 / 560.0 | 560.0 / 560.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 624.9 / 624.9 | 1.0 / 1.0 | 628.0 / 628.0 | 628.0 / 628.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 613.5 / 613.5 | 1.0 / 1.0 | 617.0 / 617.0 | 617.0 / 617.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 513.0 / 513.0 | 1.0 / 1.0 | 521.0 / 521.0 | 521.0 / 521.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 608.9 / 608.9 | 1.0 / 1.0 | 614.0 / 614.0 | 614.0 / 614.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 568.7 / 568.7 | 1.0 / 1.0 | 578.0 / 578.0 | 578.0 / 578.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 841.2 / 841.2 | 1.0 / 1.0 | 860.0 / 860.0 | 860.0 / 860.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 790.2 / 790.2 | 1.0 / 1.0 | 802.0 / 802.0 | 802.0 / 802.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
