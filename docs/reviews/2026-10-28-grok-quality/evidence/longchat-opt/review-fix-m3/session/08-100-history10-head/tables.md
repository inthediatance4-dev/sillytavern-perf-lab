# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 1061.5 / 1061.5 | 1049.6 / 1049.6 | 45.4 / 45.4 | 231.6 / 414.4 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2.0 / 2.0 | 432.0 / 432.0 | 372.0 / 372.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.6 / 19.6 | 21.0 / 21.0 | 14034.0 / 14034.0 | 87857.0 / 87857.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1049.6 / 1049.6 | 44.4 / 44.4 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 414.4 / 414.4 | 1.0 / 1.0 | 198.0 / 198.0 | 198.0 / 198.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 350.4 / 350.4 | 1.0 / 1.0 | 165.0 / 165.0 | 165.0 / 165.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 228.3 / 228.3 | 1.0 / 1.0 | 115.0 / 115.0 | 115.0 / 115.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 207.4 / 207.4 | 1.0 / 1.0 | 113.0 / 113.0 | 113.0 / 113.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 225.1 / 225.1 | 1.0 / 1.0 | 129.0 / 129.0 | 129.0 / 129.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 221.9 / 221.9 | 1.0 / 1.0 | 137.0 / 137.0 | 137.0 / 137.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 231.6 / 231.6 | 1.0 / 1.0 | 158.0 / 158.0 | 158.0 / 158.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 259.4 / 259.4 | 1.0 / 1.0 | 175.0 / 175.0 | 175.0 / 175.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 261.3 / 261.3 | 1.0 / 1.0 | 187.0 / 187.0 | 187.0 / 187.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 283.0 / 283.0 | 1.0 / 1.0 | 198.0 / 198.0 | 198.0 / 198.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
