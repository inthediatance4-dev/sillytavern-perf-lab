# CPU profile summaries

Requested interval 100 µs. Percentages include idle/native/harness work; inclusive totals overlap.
JSON.stringify may be charged to its caller. Categories are heuristic; an absent sample is not proof of zero work.

## 2000-0-1-open-profile

Sampled duration: 5033.9 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| querySelectorAll | (native):0 | 16.13 | 811.93 |
| (program) | (native):0 | 11.69 | 588.41 |
| (idle) | (native):0 | 9.85 | 495.79 |
| doScroll | /script.js:2843 | 9.07 | 456.33 |
| getPropertyValue | (native):0 | 5.29 | 266.39 |
| cloneNode | (native):0 | 2.91 | 146.29 |
| parseFromString | (native):0 | 2.83 | 142.53 |
| setAttribute | (native):0 | 2.75 | 138.54 |
| Ae | /lib.js:2 | 1.87 | 94.09 |
| se | /lib/jquery-3.5.1.min.js:2 | 1.84 | 92.62 |
| i.helper.regexIndexOf | /lib.js:2 | 1.73 | 86.93 |
| (anonymous) | /lib/jquery-3.5.1.min.js:2 | 1.67 | 84.07 |
| (anonymous) | /lib.js:2 | 1.64 | 82.69 |
| se.attr | /lib/jquery-3.5.1.min.js:2 | 1.44 | 72.28 |
| getAttribute | (native):0 | 1.42 | 71.27 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 5033.85 |
| getChatResult | /script.js:7868 | 48.16 | 2424.43 |
| printMessages | /script.js:1549 | 47.61 | 2396.66 |
| redisplayChat | /script.js:1571 | 47.60 | 2396.36 |
| (anonymous) | /script.js:1585 | 35.05 | 1764.26 |
| updateMessageElement | /script.js:2703 | 34.68 | 1745.67 |
| getMessageTextHTML | /script.js:2593 | 18.44 | 928.18 |
| messageFormatting | /script.js:1872 | 18.37 | 924.79 |
| querySelectorAll | (native):0 | 16.13 | 811.93 |
| processNodeChanges | /scripts/keyboard.js:67 | 12.84 | 646.20 |
| handleNodeChange | /scripts/keyboard.js:88 | 12.80 | 644.55 |
| initializeInteractables | /scripts/keyboard.js:197 | 11.93 | 600.44 |
| (program) | (native):0 | 11.69 | 588.41 |
| getAllInteractables | /scripts/keyboard.js:208 | 10.61 | 534.34 |
| (anonymous) | /scripts/keyboard.js:210 | 10.53 | 530.12 |

### Self time by file

| File | % |
|---|---:|
| (native) | 59.88 |
| /lib.js | 16.51 |
| /script.js | 10.40 |
| /lib/jquery-3.5.1.min.js | 8.88 |
| /scripts/keyboard.js | 1.25 |
| /scripts/chats.js | 0.47 |
| /scripts/i18n.js | 0.47 |
| /scripts/utils.js | 0.43 |
| /scripts/reasoning.js | 0.39 |
| /scripts/tags.js | 0.36 |
| /scripts/a11y.js | 0.34 |
| /scripts/extensions/regex/engine.js | 0.16 |
| /lib/jquery-ui.min.js | 0.11 |
| /scripts/util/showdown-patch.js | 0.09 |
| /scripts/preset-manager.js | 0.03 |

### Inclusive time by file (overlapping)

| File | % |
|---|---:|
| (native) | 100.00 |
| /script.js | 58.18 |
| /lib/jquery-3.5.1.min.js | 25.11 |
| /lib.js | 20.81 |
| /scripts/keyboard.js | 12.86 |
| /lib/jquery-ui.min.js | 5.78 |
| /scripts/tags.js | 5.48 |
| /scripts/a11y.js | 4.67 |
| /scripts/utils.js | 2.65 |
| /scripts/reasoning.js | 1.14 |
| /scripts/i18n.js | 0.66 |
| /scripts/chats.js | 0.55 |
| /lib/eventemitter.js | 0.51 |
| /scripts/power-user.js | 0.33 |
| /scripts/RossAscends-mods.js | 0.27 |

### Self time by library/category

| Category | % |
|---|---:|
| markdown/formatting | 0.33 |
| DOMPurify | 0.00 |
| highlight.js | 0.00 |
| jQuery | 9.02 |
| message rendering | 0.21 |
| save/JSON | 0.00 |
| tokenization | 0.01 |
| webpack bundle (unresolved) | 16.51 |
| other/idle/native | 73.92 |
