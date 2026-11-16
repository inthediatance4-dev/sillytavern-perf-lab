# CPU profile summaries

Requested interval 100 µs. Percentages include idle/native/harness work; inclusive totals overlap.
JSON.stringify may be charged to its caller. Categories are heuristic; an absent sample is not proof of zero work.

## 2000-0-7-open-profile

Sampled duration: 6253.0 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| querySelectorAll | (native):0 | 21.71 | 1357.21 |
| (program) | (native):0 | 12.13 | 758.44 |
| doScroll | /script.js:2846 | 7.96 | 497.79 |
| (idle) | (native):0 | 7.23 | 452.32 |
| getPropertyValue | (native):0 | 4.98 | 311.50 |
| cloneNode | (native):0 | 2.48 | 155.05 |
| hasDisabledOrNotFocusableAncestor | /scripts/keyboard.js:138 | 2.40 | 149.85 |
| parseFromString | (native):0 | 2.26 | 141.47 |
| setAttribute | (native):0 | 2.15 | 134.44 |
| matches | (native):0 | 2.10 | 131.01 |
| se.attr | /lib/jquery-3.5.1.min.js:2 | 1.72 | 107.82 |
| Ae | /lib.js:2 | 1.58 | 98.55 |
| se | /lib/jquery-3.5.1.min.js:2 | 1.57 | 98.00 |
| contains | (native):0 | 1.47 | 92.08 |
| i.helper.regexIndexOf | /lib.js:2 | 1.43 | 89.54 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 6252.97 |
| getChatResult | /script.js:7870 | 41.16 | 2574.00 |
| printMessages | /script.js:1549 | 40.73 | 2546.66 |
| redisplayChat | /script.js:1571 | 40.72 | 2546.51 |
| (anonymous) | /script.js:1583 | 28.52 | 1783.38 |
| updateMessageElement | /script.js:2686 | 28.42 | 1777.03 |
| (anonymous) | /scripts/keyboard.js:46 | 24.28 | 1518.28 |
| (anonymous) | /scripts/keyboard.js:47 | 24.28 | 1517.97 |
| handleNodeChange | /scripts/keyboard.js:64 | 24.21 | 1514.12 |
| initializeInteractables | /scripts/keyboard.js:166 | 22.56 | 1410.57 |
| querySelectorAll | (native):0 | 21.71 | 1357.21 |
| (anonymous) | /scripts/keyboard.js:179 | 17.50 | 1094.07 |
| getMessageTextHTML | /script.js:2591 | 14.99 | 937.50 |
| messageFormatting | /script.js:1870 | 14.94 | 934.42 |
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

### Inclusive time by file (overlapping)

| File | % |
|---|---:|
| (native) | 100.00 |
| /script.js | 49.91 |
| /scripts/keyboard.js | 24.28 |
| /lib/jquery-3.5.1.min.js | 22.39 |
| /lib.js | 16.83 |
| /scripts/tags.js | 5.60 |
| /lib/jquery-ui.min.js | 5.45 |
| /scripts/a11y.js | 3.92 |
| /scripts/utils.js | 1.97 |
| /scripts/reasoning.js | 1.08 |
| /scripts/i18n.js | 0.62 |
| /scripts/chats.js | 0.51 |
| /lib/eventemitter.js | 0.43 |
| /scripts/power-user.js | 0.25 |
| /scripts/world-info.js | 0.21 |

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
| webpack bundle (unresolved) | 13.46 |
| other/idle/native | 77.69 |

## 2000-0-7-scroll-profile

Sampled duration: 3249.7 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (program) | (native):0 | 82.38 | 2677.14 |
| (idle) | (native):0 | 17.37 | 564.55 |
| sweep | blob:/948f6113-7a51-4d97-adf5-fef142bf1c97:41 | 0.09 | 2.99 |
| chatScrollHandler | /script.js:11487 | 0.03 | 1.12 |
| predicate | (native):3 | 0.03 | 0.95 |
| evaluate | (native):364 | 0.02 | 0.51 |
| next | (native):25 | 0.01 | 0.48 |
| requestAnimationFrame | (native):0 | 0.01 | 0.35 |
| (anonymous) | (native):1 | 0.01 | 0.31 |
| now | blob:/948f6113-7a51-4d97-adf5-fef142bf1c97:45 | 0.00 | 0.16 |
| g | /lib/jquery-3.5.1.min.js:2 | 0.00 | 0.16 |
| scrollChat | blob:/948f6113-7a51-4d97-adf5-fef142bf1c97:37 | 0.00 | 0.16 |
| getPropertyValue | (native):0 | 0.00 | 0.16 |
| setTimeout | (native):0 | 0.00 | 0.16 |
| EventEmitter.emit | /lib/eventemitter.js:130 | 0.00 | 0.16 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 3249.66 |
| (program) | (native):0 | 82.38 | 2677.14 |
| (idle) | (native):0 | 17.37 | 564.55 |
| sweep | blob:/948f6113-7a51-4d97-adf5-fef142bf1c97:41 | 0.11 | 3.50 |
| next | (native):25 | 0.04 | 1.43 |
| chatScrollHandler | /script.js:11487 | 0.03 | 1.12 |
| predicate | (native):3 | 0.03 | 0.95 |
| evaluate | (native):364 | 0.03 | 0.82 |
| (anonymous) | (native):1 | 0.03 | 0.82 |
| (anonymous) | (native):1 | 0.02 | 0.63 |
| now | blob:/948f6113-7a51-4d97-adf5-fef142bf1c97:45 | 0.02 | 0.52 |
| requestAnimationFrame | (native):0 | 0.01 | 0.35 |
| showHideExtensionsMenu | /scripts/extensions.js:228 | 0.01 | 0.32 |
| filter | /lib/jquery-3.5.1.min.js:2 | 0.01 | 0.32 |
| (anonymous) | (native):1 | 0.01 | 0.31 |

### Self time by file

| File | % |
|---|---:|
| (native) | 99.85 |
| blob:/948f6113-7a51-4d97-adf5-fef142bf1c97 | 0.10 |
| /script.js | 0.03 |
| /lib/jquery-3.5.1.min.js | 0.01 |
| /lib/eventemitter.js | 0.00 |

### Inclusive time by file (overlapping)

| File | % |
|---|---:|
| (native) | 100.00 |
| blob:/948f6113-7a51-4d97-adf5-fef142bf1c97 | 0.12 |
| /script.js | 0.04 |
| /lib/jquery-3.5.1.min.js | 0.01 |
| /scripts/extensions.js | 0.01 |
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
| webpack bundle (unresolved) | 0.00 |
| other/idle/native | 99.99 |

## 2000-0-7-send-profile

Sampled duration: 4768.4 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| querySelectorAll | (native):0 | 35.76 | 1705.23 |
| (program) | (native):0 | 24.92 | 1188.23 |
| hasDisabledOrNotFocusableAncestor | /scripts/keyboard.js:138 | 10.24 | 488.24 |
| contains | (native):0 | 4.92 | 234.44 |
| getBoundingClientRect | (native):0 | 4.04 | 192.45 |
| matches | (native):0 | 3.70 | 176.22 |
| (anonymous) | /scripts/keyboard.js:179 | 2.67 | 127.08 |
| query | (native):5816 | 2.33 | 111.31 |
| getPropertyValue | (native):0 | 2.29 | 109.16 |
| (anonymous) | /scripts/keyboard.js:122 | 1.64 | 78.18 |
| (garbage collector) | (native):0 | 1.44 | 68.53 |
| se | /lib/jquery-3.5.1.min.js:2 | 0.97 | 46.35 |
| (idle) | (native):0 | 0.95 | 45.46 |
| fetch | (native):0 | 0.57 | 27.12 |
| makeKeyboardInteractable | /scripts/keyboard.js:121 | 0.41 | 19.47 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 4768.39 |
| (anonymous) | /scripts/keyboard.js:46 | 59.78 | 2850.71 |
| (anonymous) | /scripts/keyboard.js:47 | 59.77 | 2849.94 |
| handleNodeChange | /scripts/keyboard.js:64 | 59.68 | 2845.76 |
| initializeInteractables | /scripts/keyboard.js:166 | 56.51 | 2694.56 |
| (anonymous) | /scripts/keyboard.js:179 | 37.57 | 1791.36 |
| querySelectorAll | (native):0 | 35.76 | 1705.23 |
| (program) | (native):0 | 24.92 | 1188.23 |
| makeKeyboardInteractable | /scripts/keyboard.js:121 | 18.70 | 891.90 |
| (anonymous) | /scripts/keyboard.js:122 | 18.31 | 872.89 |
| hasDisabledOrNotFocusableAncestor | /scripts/keyboard.js:138 | 14.75 | 703.32 |
| evaluate | (native):364 | 7.03 | 335.19 |
| (anonymous) | (native):1 | 7.03 | 335.19 |
| (anonymous) | (native):1 | 7.02 | 334.72 |
| contains | (native):0 | 4.92 | 234.44 |

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

### Inclusive time by file (overlapping)

| File | % |
|---|---:|
| (native) | 100.00 |
| /scripts/keyboard.js | 60.08 |
| /script.js | 5.28 |
| /lib/jquery-3.5.1.min.js | 4.25 |
| /lib/jquery-ui.min.js | 2.40 |
| /scripts/slash-commands.js | 0.17 |
| /scripts/autocomplete/AutoComplete.js | 0.10 |
| /scripts/slash-commands/SlashCommandClosure.js | 0.07 |
| /scripts/tags.js | 0.06 |
| /scripts/RossAscends-mods.js | 0.06 |
| /lib.js | 0.05 |
| /scripts/slash-commands/SlashCommandParser.js | 0.05 |
| /scripts/utils.js | 0.04 |
| /scripts/extensions.js | 0.02 |
| /scripts/slash-commands/SlashCommandCommandAutoCompleteOption.js | 0.02 |

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
| webpack bundle (unresolved) | 0.05 |
| other/idle/native | 98.29 |

## 2000-100-7-open-profile

Sampled duration: 1475.3 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (idle) | (native):0 | 40.59 | 598.78 |
| (program) | (native):0 | 30.43 | 448.96 |
| z | /lib/jquery.transit.min.js:1 | 2.94 | 43.34 |
| querySelectorAll | (native):0 | 1.79 | 26.47 |
| getPropertyValue | (native):0 | 1.17 | 17.27 |
| (garbage collector) | (native):0 | 1.04 | 15.39 |
| setAttribute | (native):0 | 1.00 | 14.70 |
| fetch | (native):0 | 0.85 | 12.52 |
| Ae | /lib.js:2 | 0.78 | 11.50 |
| cloneNode | (native):0 | 0.71 | 10.41 |
| parseFromString | (native):0 | 0.64 | 9.40 |
| hasDisabledOrNotFocusableAncestor | /scripts/keyboard.js:138 | 0.59 | 8.77 |
| vt | /lib/jquery-3.5.1.min.js:2 | 0.58 | 8.59 |
| i.helper.regexIndexOf | /lib.js:2 | 0.56 | 8.28 |
| contains | (native):0 | 0.55 | 8.05 |

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
| messageFormatting | /script.js:1870 | 6.74 | 99.48 |
| getMessageTextHTML | /script.js:2591 | 6.58 | 97.02 |
| each | /lib/jquery-3.5.1.min.js:2 | 5.98 | 88.26 |
| each | /lib/jquery-3.5.1.min.js:2 | 5.97 | 88.11 |
| select_selected_character | /script.js:9002 | 3.53 | 52.02 |
| makeHtml | /lib.js:2 | 3.33 | 49.17 |
| n.sanitize | /lib.js:2 | 3.29 | 48.58 |

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

### Inclusive time by file (overlapping)

| File | % |
|---|---:|
| (native) | 100.00 |
| /script.js | 23.45 |
| /lib/jquery-3.5.1.min.js | 11.26 |
| /lib.js | 9.35 |
| /lib/jquery.transit.min.js | 2.97 |
| /scripts/keyboard.js | 2.54 |
| /lib/jquery-ui.min.js | 1.93 |
| /scripts/tags.js | 1.81 |
| /scripts/utils.js | 1.06 |
| /lib/eventemitter.js | 0.83 |
| blob:/66f167ba-e0d7-4960-937c-6df3b69c47ff | 0.73 |
| /lib/pagination.js | 0.53 |
| /scripts/i18n.js | 0.48 |
| /scripts/a11y.js | 0.45 |
| /scripts/chats.js | 0.40 |

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
| webpack bundle (unresolved) | 8.16 |
| other/idle/native | 84.64 |

## 2000-100-7-scroll-profile

Sampled duration: 6415.2 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (idle) | (native):0 | 54.98 | 3526.93 |
| (program) | (native):0 | 17.59 | 1128.33 |
| getPropertyValue | (native):0 | 5.26 | 337.20 |
| querySelectorAll | (native):0 | 2.80 | 179.78 |
| hasDisabledOrNotFocusableAncestor | /scripts/keyboard.js:138 | 1.54 | 98.61 |
| (garbage collector) | (native):0 | 1.40 | 89.51 |
| matches | (native):0 | 1.03 | 65.99 |
| contains | (native):0 | 0.96 | 61.81 |
| parseFromString | (native):0 | 0.92 | 58.74 |
| cloneNode | (native):0 | 0.87 | 55.83 |
| setAttribute | (native):0 | 0.70 | 44.80 |
| se | /lib/jquery-3.5.1.min.js:2 | 0.54 | 34.64 |
| (anonymous) | /scripts/keyboard.js:179 | 0.50 | 32.28 |
| (anonymous) | /lib/jquery-3.5.1.min.js:2 | 0.47 | 30.40 |
| (anonymous) | /scripts/keyboard.js:122 | 0.36 | 23.22 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 6415.24 |
| (idle) | (native):0 | 54.98 | 3526.93 |
| scrollChat | blob:/66f167ba-e0d7-4960-937c-6df3b69c47ff:37 | 18.05 | 1157.71 |
| showMoreMessages | /script.js:1505 | 17.99 | 1153.95 |
| (program) | (native):0 | 17.59 | 1128.33 |
| (anonymous) | /script.js:1523 | 11.46 | 734.90 |
| updateMessageElement | /script.js:2686 | 11.36 | 728.99 |
| (anonymous) | /scripts/keyboard.js:46 | 6.90 | 442.86 |
| (anonymous) | /scripts/keyboard.js:47 | 6.90 | 442.55 |
| handleNodeChange | /scripts/keyboard.js:64 | 6.88 | 441.31 |
| refreshSwipeButtons | /script.js:9498 | 5.91 | 379.19 |
| initializeInteractables | /scripts/keyboard.js:166 | 5.91 | 378.82 |
| messageFormatting | /script.js:1870 | 5.81 | 372.43 |
| getMessageTextHTML | /script.js:2591 | 5.78 | 370.56 |
| each | /lib/jquery-3.5.1.min.js:2 | 5.76 | 369.29 |

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

### Inclusive time by file (overlapping)

| File | % |
|---|---:|
| (native) | 100.00 |
| blob:/66f167ba-e0d7-4960-937c-6df3b69c47ff | 18.15 |
| /script.js | 18.10 |
| /lib/jquery-3.5.1.min.js | 9.70 |
| /scripts/keyboard.js | 6.97 |
| /lib.js | 6.50 |
| /lib/jquery-ui.min.js | 5.40 |
| /scripts/utils.js | 0.97 |
| /scripts/reasoning.js | 0.61 |
| /scripts/a11y.js | 0.56 |
| /scripts/chats.js | 0.31 |
| /scripts/power-user.js | 0.28 |
| /scripts/extensions/regex/engine.js | 0.22 |
| /scripts/i18n.js | 0.05 |
| /scripts/autocomplete/MacroAutoComplete.js | 0.02 |

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
| webpack bundle (unresolved) | 4.74 |
| other/idle/native | 92.79 |

## 2000-100-7-send-profile

Sampled duration: 1827.6 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (program) | (native):0 | 36.73 | 671.23 |
| (idle) | (native):0 | 13.18 | 240.96 |
| querySelectorAll | (native):0 | 9.84 | 179.78 |
| hasDisabledOrNotFocusableAncestor | /scripts/keyboard.js:138 | 6.80 | 124.34 |
| (garbage collector) | (native):0 | 5.51 | 100.66 |
| contains | (native):0 | 4.96 | 90.57 |
| fetch | (native):0 | 3.18 | 58.16 |
| getBoundingClientRect | (native):0 | 2.69 | 49.20 |
| query | (native):5816 | 2.54 | 46.36 |
| (anonymous) | /scripts/keyboard.js:179 | 2.43 | 44.40 |
| matches | (native):0 | 2.12 | 38.73 |
| getPropertyValue | (native):0 | 1.58 | 28.95 |
| se | /lib/jquery-3.5.1.min.js:2 | 1.16 | 21.26 |
| (anonymous) | /scripts/keyboard.js:122 | 1.12 | 20.51 |
| saveChat | /script.js:7529 | 0.66 | 12.01 |

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
| querySelectorAll | (native):0 | 9.84 | 179.78 |
| evaluate | (native):364 | 6.85 | 125.13 |
| (anonymous) | (native):1 | 6.85 | 125.13 |
| (anonymous) | (native):1 | 6.77 | 123.71 |

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

### Inclusive time by file (overlapping)

| File | % |
|---|---:|
| (native) | 100.00 |
| /scripts/keyboard.js | 27.98 |
| /script.js | 8.09 |
| /lib/jquery-3.5.1.min.js | 4.16 |
| /lib/jquery-ui.min.js | 1.15 |
| /scripts/autocomplete/AutoComplete.js | 0.74 |
| /scripts/stats.js | 0.65 |
| /scripts/utils.js | 0.37 |
| /scripts/slash-commands.js | 0.34 |
| /scripts/RossAscends-mods.js | 0.31 |
| /scripts/slash-commands/SlashCommandCommandAutoCompleteOption.js | 0.28 |
| /scripts/slash-commands/SlashCommand.js | 0.25 |
| /lib.js | 0.12 |
| /scripts/slash-commands/SlashCommandParser.js | 0.11 |
| /scripts/extensions.js | 0.07 |

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
| webpack bundle (unresolved) | 0.12 |
| other/idle/native | 97.40 |
