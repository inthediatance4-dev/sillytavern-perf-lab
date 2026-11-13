# CPU profile summaries

Requested interval 100 µs. Percentages include idle/native/harness work; inclusive totals overlap.
JSON.stringify may be charged to its caller. Categories are heuristic; an absent sample is not proof of zero work.

## 2000-0-1-open-profile

Sampled duration: 5589.9 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (program) | (native):0 | 14.81 | 827.87 |
| (idle) | (native):0 | 14.06 | 785.69 |
| querySelectorAll | (native):0 | 13.66 | 763.50 |
| doScroll | /script.js:2846 | 8.16 | 456.39 |
| getPropertyValue | (native):0 | 5.26 | 294.12 |
| cloneNode | (native):0 | 2.54 | 142.06 |
| parseFromString | (native):0 | 2.53 | 141.61 |
| setAttribute | (native):0 | 2.42 | 135.55 |
| It | /lib.js:2 | 1.86 | 103.88 |
| i.helper.regexIndexOf | /lib.js:2 | 1.71 | 95.43 |
| se | /lib/jquery-3.5.1.min.js:2 | 1.64 | 91.82 |
| Ae | /lib.js:2 | 1.59 | 88.85 |
| (anonymous) | /lib.js:2 | 1.43 | 80.09 |
| (anonymous) | /lib/jquery-3.5.1.min.js:2 | 1.41 | 79.10 |
| se.attr | /lib/jquery-3.5.1.min.js:2 | 1.30 | 72.39 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 5589.91 |
| getChatResult | /script.js:7871 | 44.36 | 2479.89 |
| redisplayChat | /script.js:1571 | 43.87 | 2452.40 |
| printMessages | /script.js:1549 | 43.87 | 2452.40 |
| (anonymous) | /script.js:1583 | 32.11 | 1795.07 |
| updateMessageElement | /script.js:2686 | 32.02 | 1789.72 |
| getMessageTextHTML | /script.js:2591 | 16.28 | 910.14 |
| messageFormatting | /script.js:1870 | 16.24 | 907.55 |
| (program) | (native):0 | 14.81 | 827.87 |
| (idle) | (native):0 | 14.06 | 785.69 |
| querySelectorAll | (native):0 | 13.66 | 763.50 |
| processNodeChanges | /scripts/keyboard.js:67 | 10.67 | 596.26 |
| handleNodeChange | /scripts/keyboard.js:88 | 10.63 | 593.98 |
| initializeInteractables | /scripts/keyboard.js:197 | 9.86 | 551.16 |
| n.sanitize | /lib.js:2 | 8.82 | 492.87 |

### Self time by file

| File | % |
|---|---:|
| (native) | 62.42 |
| /lib.js | 15.84 |
| /script.js | 9.55 |
| /lib/jquery-3.5.1.min.js | 8.00 |
| /scripts/keyboard.js | 1.47 |
| /scripts/chats.js | 0.48 |
| /scripts/utils.js | 0.44 |
| /scripts/i18n.js | 0.40 |
| /scripts/reasoning.js | 0.32 |
| /scripts/tags.js | 0.29 |
| /scripts/a11y.js | 0.28 |
| /lib/jquery-ui.min.js | 0.12 |
| /scripts/extensions/regex/engine.js | 0.11 |
| /scripts/util/showdown-patch.js | 0.05 |
| /scripts/autocomplete/MacroAutoComplete.js | 0.03 |

### Inclusive time by file (overlapping)

| File | % |
|---|---:|
| (native) | 100.00 |
| /script.js | 53.47 |
| /lib/jquery-3.5.1.min.js | 22.90 |
| /lib.js | 19.66 |
| /scripts/keyboard.js | 10.70 |
| /lib/jquery-ui.min.js | 5.76 |
| /scripts/tags.js | 5.09 |
| /scripts/a11y.js | 4.42 |
| /scripts/utils.js | 3.75 |
| /scripts/reasoning.js | 1.04 |
| /scripts/i18n.js | 0.58 |
| /scripts/chats.js | 0.53 |
| /lib/eventemitter.js | 0.45 |
| /scripts/power-user.js | 0.26 |
| /scripts/world-info.js | 0.24 |

### Self time by library/category

| Category | % |
|---|---:|
| markdown/formatting | 0.33 |
| DOMPurify | 0.00 |
| highlight.js | 0.00 |
| jQuery | 8.15 |
| message rendering | 0.26 |
| save/JSON | 0.00 |
| tokenization | 0.01 |
| webpack bundle (unresolved) | 15.84 |
| other/idle/native | 75.42 |

## 2000-100-1-open-profile

Sampled duration: 1009.2 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (idle) | (native):0 | 51.35 | 518.24 |
| (program) | (native):0 | 22.80 | 230.13 |
| z | /lib/jquery.transit.min.js:1 | 2.35 | 23.72 |
| (garbage collector) | (native):0 | 2.30 | 23.21 |
| querySelectorAll | (native):0 | 1.93 | 19.49 |
| getPropertyValue | (native):0 | 1.90 | 19.21 |
| se | /lib/jquery-3.5.1.min.js:2 | 0.95 | 9.61 |
| cloneNode | (native):0 | 0.76 | 7.68 |
| parseFromString | (native):0 | 0.69 | 6.94 |
| i.helper.regexIndexOf | /lib.js:2 | 0.58 | 5.89 |
| setAttribute | (native):0 | 0.58 | 5.86 |
| Ae | /lib.js:2 | 0.58 | 5.84 |
| (anonymous) | /lib.js:2 | 0.55 | 5.59 |
| (anonymous) | /lib/jquery-3.5.1.min.js:2 | 0.44 | 4.48 |
| matches | (native):0 | 0.44 | 4.46 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 1009.20 |
| (idle) | (native):0 | 51.35 | 518.24 |
| (program) | (native):0 | 22.80 | 230.13 |
| getChatResult | /script.js:7871 | 16.57 | 167.22 |
| printMessages | /script.js:1549 | 13.23 | 133.56 |
| redisplayChat | /script.js:1571 | 13.22 | 133.41 |
| (anonymous) | /script.js:1583 | 11.08 | 111.82 |
| updateMessageElement | /script.js:2686 | 11.02 | 111.20 |
| messageFormatting | /script.js:1870 | 5.55 | 56.06 |
| getMessageTextHTML | /script.js:2591 | 5.52 | 55.73 |
| each | /lib/jquery-3.5.1.min.js:2 | 5.05 | 50.96 |
| each | /lib/jquery-3.5.1.min.js:2 | 5.02 | 50.65 |
| select_selected_character | /script.js:9003 | 3.27 | 33.04 |
| n.sanitize | /lib.js:2 | 2.81 | 28.36 |
| se | /lib/jquery-3.5.1.min.js:2 | 2.73 | 27.52 |

### Self time by file

| File | % |
|---|---:|
| (native) | 84.42 |
| /lib.js | 6.17 |
| /lib/jquery-3.5.1.min.js | 3.61 |
| /lib/jquery.transit.min.js | 2.38 |
| /script.js | 1.09 |
| /scripts/keyboard.js | 0.48 |
| /scripts/utils.js | 0.26 |
| /scripts/i18n.js | 0.22 |
| /scripts/reasoning.js | 0.15 |
| /lib/eventemitter.js | 0.12 |
| /scripts/chats.js | 0.12 |
| /lib/jquery-ui.min.js | 0.12 |
| /scripts/tags.js | 0.12 |
| /scripts/extensions/regex/engine.js | 0.09 |
| /scripts/horde.js | 0.08 |

### Inclusive time by file (overlapping)

| File | % |
|---|---:|
| (native) | 100.00 |
| /script.js | 19.27 |
| /lib/jquery-3.5.1.min.js | 11.17 |
| /lib.js | 7.24 |
| /lib/jquery.transit.min.js | 2.41 |
| /lib/jquery-ui.min.js | 2.38 |
| /scripts/utils.js | 1.68 |
| /scripts/keyboard.js | 1.28 |
| /scripts/tags.js | 1.08 |
| /lib/eventemitter.js | 0.67 |
| /scripts/RossAscends-mods.js | 0.65 |
| /scripts/a11y.js | 0.64 |
| /scripts/reasoning.js | 0.38 |
| /scripts/horde.js | 0.32 |
| /lib/pagination.js | 0.29 |

### Self time by library/category

| Category | % |
|---|---:|
| markdown/formatting | 0.23 |
| DOMPurify | 0.00 |
| highlight.js | 0.00 |
| jQuery | 6.11 |
| message rendering | 0.08 |
| save/JSON | 0.00 |
| tokenization | 0.05 |
| webpack bundle (unresolved) | 6.17 |
| other/idle/native | 87.36 |
