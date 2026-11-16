# CPU profile summaries

Requested interval 100 µs. Percentages include idle/native/harness work; inclusive totals overlap.
JSON.stringify may be charged to its caller. Categories are heuristic; an absent sample is not proof of zero work.

## 2000-0-1-send-profile

Sampled duration: 2582.4 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (program) | (native):0 | 54.03 | 1395.28 |
| getBoundingClientRect | (native):0 | 8.74 | 225.57 |
| querySelectorAll | (native):0 | 7.32 | 188.96 |
| (idle) | (native):0 | 6.67 | 172.12 |
| query | (native):5816 | 4.00 | 103.28 |
| getPropertyValue | (native):0 | 3.77 | 97.28 |
| closest | (native):0 | 2.01 | 51.83 |
| (garbage collector) | (native):0 | 1.87 | 48.19 |
| se | /lib/jquery-3.5.1.min.js:2 | 1.77 | 45.80 |
| makeKeyboardInteractableCollection | /scripts/keyboard.js:153 | 1.33 | 34.47 |
| (anonymous) | /scripts/keyboard.js:210 | 1.15 | 29.67 |
| matches | (native):0 | 1.11 | 28.57 |
| fetch | (native):0 | 0.85 | 21.91 |
| saveChat | /script.js:7529 | 0.39 | 10.08 |
| hasDisabledOrNotFocusableAncestor | /scripts/keyboard.js:188 | 0.35 | 9.06 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 2582.39 |
| (program) | (native):0 | 54.03 | 1395.28 |
| (anonymous) | (native):1 | 13.90 | 358.83 |
| (anonymous) | (native):1 | 13.88 | 358.54 |
| evaluate | (native):364 | 13.88 | 358.51 |
| processNodeChanges | /scripts/keyboard.js:67 | 12.86 | 332.02 |
| handleNodeChange | /scripts/keyboard.js:88 | 12.83 | 331.25 |
| initializeInteractables | /scripts/keyboard.js:197 | 12.35 | 318.87 |
| getBoundingClientRect | (native):0 | 8.74 | 225.57 |
| querySelectorAll | (native):0 | 7.32 | 188.96 |
| (anonymous) | /scripts/keyboard.js:210 | 7.27 | 187.75 |
| (idle) | (native):0 | 6.67 | 172.12 |
| refreshSwipeButtons | /script.js:9499 | 6.15 | 158.75 |
| showSwipeButtons | /script.js:9562 | 5.57 | 143.72 |
| each | /lib/jquery-3.5.1.min.js:2 | 5.43 | 140.22 |

### Self time by file

| File | % |
|---|---:|
| (native) | 92.41 |
| /scripts/keyboard.js | 3.36 |
| /lib/jquery-3.5.1.min.js | 2.55 |
| /script.js | 1.07 |
| /lib.js | 0.15 |
| /scripts/autocomplete/AutoComplete.js | 0.06 |
| /scripts/slash-commands/SlashCommandParser.js | 0.06 |
| /scripts/extensions/regex/engine.js | 0.05 |
| /scripts/utils.js | 0.05 |
| /scripts/slash-commands/SlashCommandClosure.js | 0.03 |
| /scripts/RossAscends-mods.js | 0.03 |
| /scripts/slash-commands/SlashCommandCommandAutoCompleteOption.js | 0.02 |
| /scripts/slash-commands/SlashCommand.js | 0.02 |
| /scripts/slash-commands.js | 0.02 |
| /scripts/tokenizers.js | 0.02 |

### Inclusive time by file (overlapping)

| File | % |
|---|---:|
| (native) | 100.00 |
| /scripts/keyboard.js | 13.51 |
| /script.js | 9.28 |
| /lib/jquery-3.5.1.min.js | 7.60 |
| /lib/jquery-ui.min.js | 4.08 |
| /scripts/RossAscends-mods.js | 0.40 |
| /scripts/autocomplete/AutoComplete.js | 0.35 |
| /scripts/slash-commands.js | 0.28 |
| /scripts/utils.js | 0.26 |
| /scripts/slash-commands/SlashCommandCommandAutoCompleteOption.js | 0.18 |
| /lib.js | 0.17 |
| /scripts/slash-commands/SlashCommand.js | 0.15 |
| /scripts/tags.js | 0.13 |
| /scripts/slash-commands/SlashCommandClosure.js | 0.09 |
| /scripts/slash-commands/SlashCommandParser.js | 0.08 |

### Self time by library/category

| Category | % |
|---|---:|
| markdown/formatting | 0.00 |
| DOMPurify | 0.00 |
| highlight.js | 0.00 |
| jQuery | 2.56 |
| message rendering | 0.01 |
| save/JSON | 0.40 |
| tokenization | 0.02 |
| webpack bundle (unresolved) | 0.15 |
| other/idle/native | 96.86 |

## 2000-100-1-send-profile

Sampled duration: 1551.8 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (program) | (native):0 | 39.01 | 605.35 |
| (idle) | (native):0 | 24.63 | 382.27 |
| getBoundingClientRect | (native):0 | 7.47 | 115.91 |
| querySelectorAll | (native):0 | 4.90 | 75.97 |
| query | (native):5816 | 4.09 | 63.46 |
| fetch | (native):0 | 2.88 | 44.64 |
| (garbage collector) | (native):0 | 2.54 | 39.39 |
| closest | (native):0 | 1.71 | 26.59 |
| se | /lib/jquery-3.5.1.min.js:2 | 1.60 | 24.76 |
| getPropertyValue | (native):0 | 1.49 | 23.10 |
| saveChat | /script.js:7529 | 1.03 | 16.02 |
| makeKeyboardInteractableCollection | /scripts/keyboard.js:153 | 0.97 | 14.99 |
| (anonymous) | /scripts/keyboard.js:210 | 0.88 | 13.71 |
| matches | (native):0 | 0.55 | 8.48 |
| Generate | /script.js:4358 | 0.54 | 8.40 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 1551.81 |
| (program) | (native):0 | 39.01 | 605.35 |
| (idle) | (native):0 | 24.63 | 382.27 |
| processNodeChanges | /scripts/keyboard.js:67 | 9.96 | 154.63 |
| handleNodeChange | /scripts/keyboard.js:88 | 9.91 | 153.71 |
| initializeInteractables | /scripts/keyboard.js:197 | 9.65 | 149.77 |
| evaluate | (native):364 | 8.51 | 132.13 |
| (anonymous) | (native):1 | 8.51 | 132.13 |
| (anonymous) | (native):1 | 8.50 | 131.92 |
| getBoundingClientRect | (native):0 | 7.47 | 115.91 |
| (anonymous) | /scripts/keyboard.js:210 | 5.54 | 85.97 |
| getAllInteractables | /scripts/keyboard.js:208 | 5.52 | 85.65 |
| querySelectorAll | (native):0 | 4.90 | 75.97 |
| _cached | (native):5597 | 4.13 | 64.08 |
| (anonymous) | (native):5635 | 4.13 | 64.08 |

### Self time by file

| File | % |
|---|---:|
| (native) | 90.98 |
| /scripts/keyboard.js | 2.84 |
| /lib/jquery-3.5.1.min.js | 2.81 |
| /script.js | 2.37 |
| /scripts/i18n.js | 0.39 |
| /lib.js | 0.13 |
| /scripts/slash-commands/SlashCommandClosure.js | 0.12 |
| /scripts/slash-commands.js | 0.06 |
| blob:/64117f7c-b28b-4fc2-b41a-4ae6db5696b7 | 0.04 |
| /scripts/autocomplete/AutoComplete.js | 0.04 |
| /scripts/stats.js | 0.04 |
| /scripts/RossAscends-mods.js | 0.03 |
| /lib/eventemitter.js | 0.03 |
| /scripts/utils.js | 0.02 |
| /scripts/macros/engine/MacroEngine.js | 0.02 |

### Inclusive time by file (overlapping)

| File | % |
|---|---:|
| (native) | 100.00 |
| /scripts/keyboard.js | 10.22 |
| /script.js | 9.67 |
| /lib/jquery-3.5.1.min.js | 5.63 |
| /scripts/autocomplete/AutoComplete.js | 4.20 |
| /scripts/utils.js | 3.86 |
| /lib/jquery-ui.min.js | 1.34 |
| /scripts/RossAscends-mods.js | 0.81 |
| /scripts/slash-commands/SlashCommand.js | 0.50 |
| /scripts/slash-commands/SlashCommandCommandAutoCompleteOption.js | 0.50 |
| /scripts/slash-commands.js | 0.42 |
| /scripts/i18n.js | 0.39 |
| /scripts/stats.js | 0.37 |
| /scripts/slash-commands/SlashCommandClosure.js | 0.22 |
| /lib.js | 0.16 |

### Self time by library/category

| Category | % |
|---|---:|
| markdown/formatting | 0.00 |
| DOMPurify | 0.00 |
| highlight.js | 0.00 |
| jQuery | 2.81 |
| message rendering | 0.00 |
| save/JSON | 1.06 |
| tokenization | 0.00 |
| webpack bundle (unresolved) | 0.13 |
| other/idle/native | 95.99 |
