# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 1090.4 / 1090.4 | 812.3 / 812.3 | 54.7 / 54.7 | 283.9 / 486.1 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 2.0 / 2.0 | 445.0 / 445.0 | 377.0 / 377.0 |

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
| 2000 | 100 | 812.3 / 812.3 | 53.5 / 53.5 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 288.9 / 288.9 | 1.0 / 1.0 | 108.0 / 108.0 | 108.0 / 108.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 283.9 / 283.9 | 1.0 / 1.0 | 103.0 / 103.0 | 103.0 / 103.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 277.1 / 277.1 | 1.0 / 1.0 | 93.0 / 93.0 | 93.0 / 93.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 420.5 / 420.5 | 1.0 / 1.0 | 232.0 / 232.0 | 232.0 / 232.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 460.2 / 460.2 | 1.0 / 1.0 | 257.0 / 257.0 | 257.0 / 257.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 486.1 / 486.1 | 1.0 / 1.0 | 334.0 / 334.0 | 334.0 / 334.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 257.0 / 257.0 | 1.0 / 1.0 | 170.0 / 170.0 | 170.0 / 170.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 239.1 / 239.1 | 1.0 / 1.0 | 165.0 / 165.0 | 165.0 / 165.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 248.5 / 248.5 | 1.0 / 1.0 | 173.0 / 173.0 | 173.0 / 173.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 294.5 / 294.5 | 1.0 / 1.0 | 211.0 / 211.0 | 211.0 / 211.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
