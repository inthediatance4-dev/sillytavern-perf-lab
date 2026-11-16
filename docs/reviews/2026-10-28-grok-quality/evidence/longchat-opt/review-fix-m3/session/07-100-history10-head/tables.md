# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 862.6 / 862.6 | 895.9 / 895.9 | 56.9 / 56.9 | 242.5 / 355.6 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 224.0 / 224.0 | 224.0 / 224.0 |

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
| 2000 | 100 | 895.9 / 895.9 | 54.6 / 54.6 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 198.9 / 198.9 | 1.0 / 1.0 | 103.0 / 103.0 | 103.0 / 103.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 174.2 / 174.2 | 1.0 / 1.0 | 79.0 / 79.0 | 79.0 / 79.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 182.7 / 182.7 | 1.0 / 1.0 | 98.0 / 98.0 | 98.0 / 98.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 234.8 / 234.8 | 1.0 / 1.0 | 124.0 / 124.0 | 124.0 / 124.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 242.5 / 242.5 | 1.0 / 1.0 | 136.0 / 136.0 | 136.0 / 136.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 289.6 / 289.6 | 1.0 / 1.0 | 184.0 / 184.0 | 184.0 / 184.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 257.8 / 257.8 | 1.0 / 1.0 | 167.0 / 167.0 | 167.0 / 167.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 355.6 / 355.6 | 1.0 / 1.0 | 283.0 / 283.0 | 283.0 / 283.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 272.9 / 272.9 | 1.0 / 1.0 | 187.0 / 187.0 | 187.0 / 187.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 317.7 / 317.7 | 1.0 / 1.0 | 219.0 / 219.0 | 219.0 / 219.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
