# Long-chat baseline

Values: median / nearest-rank p95; milliseconds unless labeled. Failed runs excluded; see raw records.

| Messages | Truncation | Completed | Open | Send incl save | Save response wait | Batch | Heap open MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1/1 | 1063.0 / 1063.0 | 1536.1 / 1536.1 | 86.0 / 86.0 | 473.3 / 707.0 | 19.6 / 19.6 |

## Open long tasks

| Messages | Truncation | Count | Total ms | Max ms |
|---:|---:|---:|---:|---:|
| 2000 | 100 | 1.0 / 1.0 | 389.0 / 389.0 | 389.0 / 389.0 |

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
| 2000 | 100 | 1536.1 / 1536.1 | 85.1 / 85.1 | 2672.8 / 2672.8 |

## Older-message batches

Batch number is relative to the initial rendered window. Values include the fixed 500 ms quiet wait.

| Messages | Truncation | Batch | n | Added | Batch ms | Long tasks | Long-task total ms | Long-task max ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2000 | 100 | 1 | 1 | 100.0 / 100.0 | 413.2 / 413.2 | 1.0 / 1.0 | 413.0 / 413.0 | 413.0 / 413.0 |
| 2000 | 100 | 2 | 1 | 100.0 / 100.0 | 473.3 / 473.3 | 1.0 / 1.0 | 474.0 / 474.0 | 474.0 / 474.0 |
| 2000 | 100 | 3 | 1 | 100.0 / 100.0 | 452.1 / 452.1 | 1.0 / 1.0 | 454.0 / 454.0 | 454.0 / 454.0 |
| 2000 | 100 | 4 | 1 | 100.0 / 100.0 | 522.2 / 522.2 | 1.0 / 1.0 | 525.0 / 525.0 | 525.0 / 525.0 |
| 2000 | 100 | 5 | 1 | 100.0 / 100.0 | 431.9 / 431.9 | 1.0 / 1.0 | 435.0 / 435.0 | 435.0 / 435.0 |
| 2000 | 100 | 6 | 1 | 100.0 / 100.0 | 675.8 / 675.8 | 1.0 / 1.0 | 680.0 / 680.0 | 680.0 / 680.0 |
| 2000 | 100 | 7 | 1 | 100.0 / 100.0 | 465.9 / 465.9 | 1.0 / 1.0 | 470.0 / 470.0 | 470.0 / 470.0 |
| 2000 | 100 | 8 | 1 | 100.0 / 100.0 | 707.0 / 707.0 | 1.0 / 1.0 | 718.0 / 718.0 | 718.0 / 718.0 |
| 2000 | 100 | 9 | 1 | 100.0 / 100.0 | 502.1 / 502.1 | 1.0 / 1.0 | 509.0 / 509.0 | 509.0 / 509.0 |
| 2000 | 100 | 10 | 1 | 100.0 / 100.0 | 583.8 / 583.8 | 1.0 / 1.0 | 600.0 / 600.0 | 600.0 / 600.0 |

## Completed phase observations with page errors

These are failed interactive runs, excluded from every successful-run table above.

| Messages | Truncation | n | Open ms | Send ms | Frame p95 ms | Server ms | DOM open |
|---:|---:|---:|---:|---:|---:|---:|---:|
