# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 1016.5 / 1016.5 | 1702.0 / 1702.0 | 108.9 / 108.9 | 448.4 / 610.9 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2.0 / 2.0 | 349.0 / 349.0 | 295.0 / 295.0 |

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
| 2000 | 100 | 1702.0 / 1702.0 | 108.0 / 108.0 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 359.5 / 359.5 | 1.0 / 1.0 | 167.0 / 167.0 | 167.0 / 167.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 337.1 / 337.1 | 1.0 / 1.0 | 159.0 / 159.0 | 159.0 / 159.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 356.0 / 356.0 | 1.0 / 1.0 | 172.0 / 172.0 | 172.0 / 172.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 348.4 / 348.4 | 1.0 / 1.0 | 179.0 / 179.0 | 179.0 / 179.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 448.4 / 448.4 | 1.0 / 1.0 | 270.0 / 270.0 | 270.0 / 270.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 453.3 / 453.3 | 1.0 / 1.0 | 273.0 / 273.0 | 273.0 / 273.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 477.0 / 477.0 | 1.0 / 1.0 | 287.0 / 287.0 | 287.0 / 287.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 525.0 / 525.0 | 1.0 / 1.0 | 332.0 / 332.0 | 332.0 / 332.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 452.6 / 452.6 | 1.0 / 1.0 | 281.0 / 281.0 | 281.0 / 281.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 610.9 / 610.9 | 1.0 / 1.0 | 395.0 / 395.0 | 395.0 / 395.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
