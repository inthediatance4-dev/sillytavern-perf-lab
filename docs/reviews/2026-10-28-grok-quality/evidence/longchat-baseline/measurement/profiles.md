# CPU profile summaries

Requested interval 100 µs. Percentages include idle/native/harness work; inclusive totals overlap.
JSON.stringify may be charged to its caller. Categories are heuristic; an absent sample is not proof of zero work.

## 2000-0-7-open-profile

Sampled duration: 6253.0 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| querySelectorAll | (native):0 | 16.31 | 1020.03 |
| (program) | (native):0 | 12.13 | 758.44 |
| doScroll | /script.js:2846 | 7.96 | 497.79 |
| (idle) | (native):0 | 7.23 | 452.32 |
| getPropertyValue | (native):0 | 4.93 | 308.17 |
| querySelectorAll | (native):0 | 2.61 | 163.18 |
| cloneNode | (native):0 | 2.48 | 154.89 |
| hasDisabledOrNotFocusableAncestor | /scripts/keyboard.js:138 | 2.39 | 149.70 |
| parseFromString | (native):0 | 2.26 | 141.32 |
| se.attr | /lib/jquery-3.5.1.min.js:2 | 1.71 | 107.20 |
| Ae | /lib.js:2 | 1.58 | 98.55 |
| matches | (native):0 | 1.55 | 96.61 |
| contains | (native):0 | 1.34 | 83.76 |
| (anonymous) | /lib/jquery-3.5.1.min.js:2 | 1.26 | 79.10 |
| (anonymous) | /scripts/keyboard.js:179 | 1.18 | 74.04 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 6252.97 |
| getChatResult | /script.js:7870 | 41.16 | 2573.85 |
| redisplayChat | /script.js:1571 | 40.72 | 2546.51 |
| printMessages | /script.js:1549 | 40.72 | 2546.51 |
| (anonymous) | /script.js:1583 | 28.52 | 1783.38 |
| updateMessageElement | /script.js:2686 | 28.42 | 1777.03 |
| (anonymous) | /scripts/keyboard.js:46 | 24.28 | 1518.28 |
| (anonymous) | /scripts/keyboard.js:47 | 24.28 | 1517.97 |
| handleNodeChange | /scripts/keyboard.js:64 | 24.21 | 1514.12 |
| initializeInteractables | /scripts/keyboard.js:166 | 22.55 | 1410.26 |
| (anonymous) | /scripts/keyboard.js:179 | 17.50 | 1094.07 |
| querySelectorAll | (native):0 | 16.31 | 1020.03 |
| getMessageTextHTML | /script.js:2591 | 14.99 | 937.34 |
| messageFormatting | /script.js:1870 | 14.94 | 934.11 |
| (program) | (native):0 | 12.13 | 758.44 |

### Self time by file

| File | % |
|---|---:|
| (native) | 61.81 |
| /lib.js | 13.47 |
| /script.js | 9.26 |
| /lib/jquery-3.5.1.min.js | 8.24 |
| /scripts/keyboard.js | 4.62 |
| /scripts/chats.js | 0.44 |
| /scripts/i18n.js | 0.43 |
| /scripts/reasoning.js | 0.42 |
| /scripts/utils.js | 0.36 |
| /scripts/tags.js | 0.27 |
| /scripts/a11y.js | 0.25 |
| /lib/jquery-ui.min.js | 0.11 |
| /scripts/extensions/regex/engine.js | 0.10 |
| /scripts/util/showdown-patch.js | 0.04 |
| /lib/eventemitter.js | 0.03 |

### Self time by library/category

| Category | % |
|---|---:|
| markdown/formatting | 0.30 |
| DOMPurify | 0.00 |
| highlight.js | 0.00 |
| jQuery | 8.36 |
| message rendering | 0.18 |
| save/JSON | 0.00 |
| tokenization | 0.01 |
| other/idle/native | 91.15 |

## 2000-0-7-scroll-profile

Sampled duration: 3249.7 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (program) | (native):0 | 82.38 | 2677.14 |
| (idle) | (native):0 | 17.37 | 564.55 |
| sweep | blob:/948f6113-7a51-4d97-adf5-fef142bf1c97:41 | 0.09 | 2.99 |
| chatScrollHandler | /script.js:11487 | 0.03 | 1.12 |
| predicate | (native):3 | 0.02 | 0.79 |
| evaluate | (native):364 | 0.02 | 0.51 |
| next | (native):25 | 0.01 | 0.48 |
| requestAnimationFrame | (native):0 | 0.01 | 0.35 |
| now | blob:/948f6113-7a51-4d97-adf5-fef142bf1c97:45 | 0.00 | 0.16 |
| predicate | (native):3 | 0.00 | 0.16 |
| g | /lib/jquery-3.5.1.min.js:2 | 0.00 | 0.16 |
| scrollChat | blob:/948f6113-7a51-4d97-adf5-fef142bf1c97:37 | 0.00 | 0.16 |
| getPropertyValue | (native):0 | 0.00 | 0.16 |
| setTimeout | (native):0 | 0.00 | 0.16 |
| (anonymous) | (native):1 | 0.00 | 0.16 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 3249.66 |
| (program) | (native):0 | 82.38 | 2677.14 |
| (idle) | (native):0 | 17.37 | 564.55 |
| sweep | blob:/948f6113-7a51-4d97-adf5-fef142bf1c97:41 | 0.11 | 3.50 |
| next | (native):25 | 0.04 | 1.26 |
| chatScrollHandler | /script.js:11487 | 0.03 | 1.12 |
| evaluate | (native):364 | 0.03 | 0.82 |
| (anonymous) | (native):1 | 0.03 | 0.82 |
| predicate | (native):3 | 0.02 | 0.79 |
| now | blob:/948f6113-7a51-4d97-adf5-fef142bf1c97:45 | 0.02 | 0.52 |
| requestAnimationFrame | (native):0 | 0.01 | 0.35 |
| showHideExtensionsMenu | /scripts/extensions.js:228 | 0.01 | 0.32 |
| (anonymous) | (native):1 | 0.01 | 0.31 |
| (anonymous) | (native):1 | 0.01 | 0.31 |
| predicate | (native):3 | 0.00 | 0.16 |

### Self time by file

| File | % |
|---|---:|
| (native) | 99.85 |
| blob:/948f6113-7a51-4d97-adf5-fef142bf1c97 | 0.10 |
| /script.js | 0.03 |
| /lib/jquery-3.5.1.min.js | 0.01 |
| /lib/eventemitter.js | 0.00 |

### Self time by library/category

| Category | % |
|---|---:|
| markdown/formatting | 0.00 |
| DOMPurify | 0.00 |
| highlight.js | 0.00 |
| jQuery | 0.01 |
| message rendering | 0.00 |
| save/JSON | 0.00 |
| tokenization | 0.00 |
| other/idle/native | 99.99 |

## 2000-0-7-send-profile

Sampled duration: 4768.4 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| querySelectorAll | (native):0 | 34.90 | 1664.28 |
| (program) | (native):0 | 24.92 | 1188.23 |
| hasDisabledOrNotFocusableAncestor | /scripts/keyboard.js:138 | 10.24 | 488.24 |
| contains | (native):0 | 4.51 | 215.08 |
| getBoundingClientRect | (native):0 | 4.04 | 192.45 |
| (anonymous) | /scripts/keyboard.js:179 | 2.67 | 127.08 |
| matches | (native):0 | 2.51 | 119.48 |
| query | (native):5816 | 2.33 | 111.15 |
| getPropertyValue | (native):0 | 2.19 | 104.64 |
| (anonymous) | /scripts/keyboard.js:122 | 1.63 | 77.72 |
| (garbage collector) | (native):0 | 1.44 | 68.53 |
| (idle) | (native):0 | 0.95 | 45.46 |
| matches | (native):0 | 0.90 | 42.69 |
| fetch | (native):0 | 0.56 | 26.66 |
| querySelectorAll | (native):0 | 0.45 | 21.58 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 4768.39 |
| (anonymous) | /scripts/keyboard.js:46 | 59.78 | 2850.71 |
| (anonymous) | /scripts/keyboard.js:47 | 59.77 | 2849.94 |
| handleNodeChange | /scripts/keyboard.js:64 | 59.68 | 2845.76 |
| initializeInteractables | /scripts/keyboard.js:166 | 56.50 | 2694.25 |
| (anonymous) | /scripts/keyboard.js:179 | 37.57 | 1791.36 |
| querySelectorAll | (native):0 | 34.90 | 1664.28 |
| (program) | (native):0 | 24.92 | 1188.23 |
| makeKeyboardInteractable | /scripts/keyboard.js:121 | 18.70 | 891.90 |
| (anonymous) | /scripts/keyboard.js:122 | 18.30 | 872.43 |
| hasDisabledOrNotFocusableAncestor | /scripts/keyboard.js:138 | 14.75 | 703.32 |
| evaluate | (native):364 | 7.03 | 335.19 |
| (anonymous) | (native):1 | 7.03 | 335.19 |
| (anonymous) | (native):1 | 6.80 | 324.39 |
| contains | (native):0 | 4.51 | 215.08 |

### Self time by file

| File | % |
|---|---:|
| (native) | 81.92 |
| /scripts/keyboard.js | 15.80 |
| /lib/jquery-3.5.1.min.js | 1.38 |
| /script.js | 0.62 |
| /lib.js | 0.05 |
| /scripts/slash-commands.js | 0.03 |
| /scripts/slash-commands/SlashCommandClosure.js | 0.03 |
| /scripts/slash-commands/SlashCommandParser.js | 0.03 |
| /scripts/autocomplete/AutoComplete.js | 0.03 |
| /scripts/RossAscends-mods.js | 0.02 |
| /lib/jquery-ui.min.js | 0.01 |
| /scripts/utils.js | 0.01 |
| /scripts/slash-commands/SlashCommandCommandAutoCompleteOption.js | 0.01 |
| /scripts/slash-commands/SlashCommandAutoCompleteNameResult.js | 0.01 |
| /lib/eventemitter.js | 0.01 |

### Self time by library/category

| Category | % |
|---|---:|
| markdown/formatting | 0.00 |
| DOMPurify | 0.00 |
| highlight.js | 0.00 |
| jQuery | 1.39 |
| message rendering | 0.00 |
| save/JSON | 0.26 |
| tokenization | 0.00 |
| other/idle/native | 98.34 |

## 2000-100-7-open-profile

Sampled duration: 1475.3 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (idle) | (native):0 | 40.59 | 598.78 |
| (program) | (native):0 | 30.43 | 448.96 |
| z | /lib/jquery.transit.min.js:1 | 2.94 | 43.34 |
| (garbage collector) | (native):0 | 1.04 | 15.39 |
| getPropertyValue | (native):0 | 0.90 | 13.22 |
| setAttribute | (native):0 | 0.80 | 11.74 |
| Ae | /lib.js:2 | 0.76 | 11.18 |
| cloneNode | (native):0 | 0.68 | 10.09 |
| querySelectorAll | (native):0 | 0.66 | 9.68 |
| parseFromString | (native):0 | 0.62 | 9.09 |
| hasDisabledOrNotFocusableAncestor | /scripts/keyboard.js:138 | 0.59 | 8.77 |
| vt | /lib/jquery-3.5.1.min.js:2 | 0.57 | 8.43 |
| fetch | (native):0 | 0.54 | 7.95 |
| contains | (native):0 | 0.53 | 7.89 |
| Rt | /lib.js:2 | 0.47 | 6.93 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 1475.25 |
| (idle) | (native):0 | 40.59 | 598.78 |
| (program) | (native):0 | 30.43 | 448.96 |
| getChatResult | /script.js:7870 | 18.42 | 271.71 |
| printMessages | /script.js:1549 | 14.84 | 218.90 |
| redisplayChat | /script.js:1571 | 14.82 | 218.59 |
| (anonymous) | /script.js:1583 | 13.15 | 194.05 |
| updateMessageElement | /script.js:2686 | 13.08 | 193.03 |
| getMessageTextHTML | /script.js:2591 | 6.58 | 97.02 |
| messageFormatting | /script.js:1870 | 6.57 | 96.87 |
| select_selected_character | /script.js:9002 | 3.53 | 52.02 |
| n.sanitize | /lib.js:2 | 3.23 | 47.63 |
| makeHtml | /lib.js:2 | 3.22 | 47.50 |
| select_rm_create | /script.js:9089 | 3.09 | 45.65 |
| selectRightMenuWithAnimation | /script.js:8872 | 3.08 | 45.38 |

### Self time by file

| File | % |
|---|---:|
| (native) | 80.45 |
| /lib.js | 8.16 |
| /lib/jquery-3.5.1.min.js | 3.64 |
| /lib/jquery.transit.min.js | 2.95 |
| /script.js | 1.48 |
| /scripts/keyboard.js | 1.13 |
| /lib/eventemitter.js | 0.44 |
| /scripts/i18n.js | 0.44 |
| /scripts/chats.js | 0.36 |
| /scripts/tags.js | 0.17 |
| /scripts/a11y.js | 0.16 |
| /scripts/utils.js | 0.12 |
| blob:/66f167ba-e0d7-4960-937c-6df3b69c47ff | 0.12 |
| /scripts/reasoning.js | 0.09 |
| /lib/jquery-ui.min.js | 0.08 |

### Self time by library/category

| Category | % |
|---|---:|
| markdown/formatting | 0.11 |
| DOMPurify | 0.00 |
| highlight.js | 0.00 |
| jQuery | 6.67 |
| message rendering | 0.42 |
| save/JSON | 0.00 |
| tokenization | 0.00 |
| other/idle/native | 92.80 |

## 2000-100-7-scroll-profile

Sampled duration: 6415.2 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (idle) | (native):0 | 54.98 | 3526.93 |
| (program) | (native):0 | 17.59 | 1128.33 |
| getPropertyValue | (native):0 | 5.25 | 337.04 |
| querySelectorAll | (native):0 | 2.26 | 145.28 |
| hasDisabledOrNotFocusableAncestor | /scripts/keyboard.js:138 | 1.54 | 98.61 |
| (garbage collector) | (native):0 | 1.40 | 89.51 |
| matches | (native):0 | 0.94 | 60.13 |
| contains | (native):0 | 0.93 | 59.76 |
| parseFromString | (native):0 | 0.91 | 58.42 |
| cloneNode | (native):0 | 0.87 | 55.83 |
| (anonymous) | /scripts/keyboard.js:179 | 0.50 | 32.28 |
| (anonymous) | /lib/jquery-3.5.1.min.js:2 | 0.47 | 30.40 |
| setAttribute | (native):0 | 0.34 | 21.84 |
| Ae | /lib.js:2 | 0.33 | 20.87 |
| Rt | /lib.js:2 | 0.32 | 20.64 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 6415.24 |
| (idle) | (native):0 | 54.98 | 3526.93 |
| scrollChat | blob:/66f167ba-e0d7-4960-937c-6df3b69c47ff:37 | 18.04 | 1157.55 |
| showMoreMessages | /script.js:1505 | 17.99 | 1153.95 |
| (program) | (native):0 | 17.59 | 1128.33 |
| (anonymous) | /script.js:1523 | 11.46 | 734.90 |
| updateMessageElement | /script.js:2686 | 11.36 | 728.99 |
| (anonymous) | /scripts/keyboard.js:46 | 6.90 | 442.86 |
| (anonymous) | /scripts/keyboard.js:47 | 6.90 | 442.55 |
| handleNodeChange | /scripts/keyboard.js:64 | 6.88 | 441.31 |
| refreshSwipeButtons | /script.js:9498 | 5.91 | 379.19 |
| initializeInteractables | /scripts/keyboard.js:166 | 5.91 | 378.82 |
| getMessageTextHTML | /script.js:2591 | 5.78 | 370.56 |
| messageFormatting | /script.js:1870 | 5.76 | 369.62 |
| each | /lib/jquery-3.5.1.min.js:2 | 5.65 | 362.68 |

### Self time by file

| File | % |
|---|---:|
| (native) | 88.27 |
| /lib.js | 4.74 |
| /scripts/keyboard.js | 2.69 |
| /lib/jquery-3.5.1.min.js | 2.26 |
| /script.js | 0.76 |
| /scripts/reasoning.js | 0.44 |
| /scripts/chats.js | 0.28 |
| /scripts/extensions/regex/engine.js | 0.22 |
| blob:/66f167ba-e0d7-4960-937c-6df3b69c47ff | 0.11 |
| /scripts/utils.js | 0.10 |
| /scripts/i18n.js | 0.04 |
| /scripts/a11y.js | 0.04 |
| /lib/jquery-ui.min.js | 0.03 |
| /scripts/util/showdown-patch.js | 0.01 |
| /scripts/swipe-picker.js | 0.00 |

### Self time by library/category

| Category | % |
|---|---:|
| markdown/formatting | 0.13 |
| DOMPurify | 0.00 |
| highlight.js | 0.00 |
| jQuery | 2.29 |
| message rendering | 0.05 |
| save/JSON | 0.00 |
| tokenization | 0.00 |
| other/idle/native | 97.53 |

## 2000-100-7-send-profile

Sampled duration: 1827.6 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (program) | (native):0 | 36.73 | 671.23 |
| (idle) | (native):0 | 13.18 | 240.96 |
| querySelectorAll | (native):0 | 9.22 | 168.48 |
| hasDisabledOrNotFocusableAncestor | /scripts/keyboard.js:138 | 6.80 | 124.34 |
| (garbage collector) | (native):0 | 5.51 | 100.66 |
| contains | (native):0 | 4.78 | 87.43 |
| getBoundingClientRect | (native):0 | 2.69 | 49.20 |
| fetch | (native):0 | 2.56 | 46.76 |
| query | (native):5816 | 2.54 | 46.36 |
| (anonymous) | /scripts/keyboard.js:179 | 2.43 | 44.40 |
| matches | (native):0 | 1.73 | 31.57 |
| (anonymous) | /scripts/keyboard.js:122 | 1.12 | 20.51 |
| getPropertyValue | (native):0 | 0.95 | 17.41 |
| saveChat | /script.js:7529 | 0.59 | 10.75 |
| previewNode | (native):7986 | 0.58 | 10.55 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 1827.62 |
| (program) | (native):0 | 36.73 | 671.23 |
| (anonymous) | /scripts/keyboard.js:46 | 27.83 | 508.67 |
| (anonymous) | /scripts/keyboard.js:47 | 27.82 | 508.51 |
| handleNodeChange | /scripts/keyboard.js:64 | 27.79 | 507.93 |
| initializeInteractables | /scripts/keyboard.js:166 | 25.91 | 473.53 |
| makeKeyboardInteractable | /scripts/keyboard.js:121 | 14.16 | 258.72 |
| (anonymous) | /scripts/keyboard.js:122 | 13.63 | 249.11 |
| (idle) | (native):0 | 13.18 | 240.96 |
| (anonymous) | /scripts/keyboard.js:179 | 11.65 | 212.88 |
| hasDisabledOrNotFocusableAncestor | /scripts/keyboard.js:138 | 11.59 | 211.76 |
| querySelectorAll | (native):0 | 9.22 | 168.48 |
| evaluate | (native):364 | 6.85 | 125.13 |
| (anonymous) | (native):1 | 6.85 | 125.13 |
| (anonymous) | (native):1 | 6.38 | 116.56 |

### Self time by file

| File | % |
|---|---:|
| (native) | 84.25 |
| /scripts/keyboard.js | 11.29 |
| /lib/jquery-3.5.1.min.js | 1.80 |
| /script.js | 1.77 |
| /scripts/autocomplete/AutoComplete.js | 0.29 |
| /lib.js | 0.12 |
| /scripts/slash-commands/SlashCommandParser.js | 0.09 |
| /scripts/RossAscends-mods.js | 0.07 |
| /scripts/slash-commands/SlashCommandClosure.js | 0.06 |
| /scripts/slash-commands/SlashCommand.js | 0.05 |
| /scripts/slash-commands/SlashCommandAutoCompleteNameResult.js | 0.04 |
| /scripts/slash-commands.js | 0.03 |
| /lib/eventemitter.js | 0.03 |
| /scripts/utils.js | 0.03 |
| /scripts/stats.js | 0.03 |

### Self time by library/category

| Category | % |
|---|---:|
| markdown/formatting | 0.00 |
| DOMPurify | 0.00 |
| highlight.js | 0.00 |
| jQuery | 1.80 |
| message rendering | 0.00 |
| save/JSON | 0.67 |
| tokenization | 0.00 |
| other/idle/native | 97.52 |
