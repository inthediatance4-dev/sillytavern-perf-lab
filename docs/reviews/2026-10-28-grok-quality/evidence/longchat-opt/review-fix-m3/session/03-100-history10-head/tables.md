# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 786.4 / 786.4 | 867.4 / 867.4 | 59.5 / 59.5 | 223.0 / 280.9 | 19.5 / 19.5 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 182.0 / 182.0 | 182.0 / 182.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.5 / 19.5 | 20.9 / 20.9 | 14034.0 / 14034.0 | 87857.0 / 87857.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 867.4 / 867.4 | 58.4 / 58.4 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 231.5 / 231.5 | 1.0 / 1.0 | 111.0 / 111.0 | 111.0 / 111.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 177.8 / 177.8 | 1.0 / 1.0 | 82.0 / 82.0 | 82.0 / 82.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 169.3 / 169.3 | 1.0 / 1.0 | 85.0 / 85.0 | 85.0 / 85.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 200.0 / 200.0 | 1.0 / 1.0 | 116.0 / 116.0 | 116.0 / 116.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 207.6 / 207.6 | 1.0 / 1.0 | 122.0 / 122.0 | 122.0 / 122.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 246.0 / 246.0 | 1.0 / 1.0 | 162.0 / 162.0 | 162.0 / 162.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 223.0 / 223.0 | 1.0 / 1.0 | 150.0 / 150.0 | 150.0 / 150.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 258.0 / 258.0 | 1.0 / 1.0 | 175.0 / 175.0 | 175.0 / 175.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 277.7 / 277.7 | 1.0 / 1.0 | 193.0 / 193.0 | 193.0 / 193.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 280.9 / 280.9 | 1.0 / 1.0 | 207.0 / 207.0 | 207.0 / 207.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
