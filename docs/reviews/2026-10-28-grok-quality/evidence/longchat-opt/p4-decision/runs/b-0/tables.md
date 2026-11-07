# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 768.9 / 768.9 | 1487.4 / 1487.4 | 90.6 / 90.6 | 398.5 / 603.4 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 169.0 / 169.0 | 169.0 / 169.0 |

## Scroll sweeps

| Messages | Truncation | Frame median ms | Frame p95 ms | Frames >16.7 ms % | Frames >50 ms % |
|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | — | — | 0.0 / 0.0 | 0.0 / 0.0 |

## Memory and DOM

| Messages | Truncation | Heap open MiB | Heap scroll MiB | DOM open | DOM scroll | Messages open | Messages scroll |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 19.6 / 19.6 | 21.0 / 21.0 | 14035.0 / 14035.0 | 87858.0 / 87858.0 | 100.0 / 100.0 | 1100.0 / 1100.0 |

## Save

| Messages | Truncation | User send ms | Server ms | Payload KiB |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1487.4 / 1487.4 | 89.4 / 89.4 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 179.6 / 179.6 | 1.0 / 1.0 | 95.0 / 95.0 | 95.0 / 95.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 249.1 / 249.1 | 1.0 / 1.0 | 83.0 / 83.0 | 83.0 / 83.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 439.4 / 439.4 | 2.0 / 2.0 | 269.0 / 269.0 | 181.0 / 181.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 391.5 / 391.5 | 1.0 / 1.0 | 222.0 / 222.0 | 222.0 / 222.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 409.2 / 409.2 | 1.0 / 1.0 | 245.0 / 245.0 | 245.0 / 245.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 235.4 / 235.4 | 1.0 / 1.0 | 136.0 / 136.0 | 136.0 / 136.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 417.4 / 417.4 | 1.0 / 1.0 | 197.0 / 197.0 | 197.0 / 197.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 398.5 / 398.5 | 1.0 / 1.0 | 227.0 / 227.0 | 227.0 / 227.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 503.7 / 503.7 | 1.0 / 1.0 | 345.0 / 345.0 | 345.0 / 345.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 603.4 / 603.4 | 1.0 / 1.0 | 432.0 / 432.0 | 432.0 / 432.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
