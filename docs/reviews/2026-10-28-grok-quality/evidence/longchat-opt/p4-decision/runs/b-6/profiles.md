# CPU profile summaries

Requested interval 100 µs. Percentages include idle/native/harness work; inclusive totals overlap.
JSON.stringify may be charged to its caller. Categories are heuristic; an absent sample is not proof of zero work.

## 2000-100-1-send-profile

Sampled duration: 1634.3 ms.

### Top self time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (program) | (native):0 | 50.61 | 827.20 |
| getBoundingClientRect | (native):0 | 9.38 | 153.32 |
| (idle) | (native):0 | 8.25 | 134.87 |
| querySelectorAll | (native):0 | 7.85 | 128.32 |
| query | (native):5816 | 3.78 | 61.84 |
| closest | (native):0 | 2.68 | 43.76 |
| (garbage collector) | (native):0 | 1.97 | 32.17 |
| se | /lib/jquery-3.5.1.min.js:2 | 1.86 | 30.36 |
| getPropertyValue | (native):0 | 1.52 | 24.80 |
| makeKeyboardInteractableCollection | /scripts/keyboard.js:153 | 1.49 | 24.30 |
| fetch | (native):0 | 1.45 | 23.78 |
| (anonymous) | /scripts/keyboard.js:210 | 1.07 | 17.46 |
| matches | (native):0 | 1.02 | 16.63 |
| setItem | (native):0 | 0.61 | 10.04 |
| saveChat | /script.js:7602 | 0.59 | 9.71 |

### Top total time

| Function | File:line | % | ms |
|---|---|---:|---:|
| (root) | (native):0 | 100.00 | 1634.33 |
| (program) | (native):0 | 50.61 | 827.20 |
| processNodeChanges | /scripts/keyboard.js:67 | 14.69 | 240.12 |
| handleNodeChange | /scripts/keyboard.js:88 | 14.65 | 239.47 |
| initializeInteractables | /scripts/keyboard.js:197 | 14.04 | 229.52 |
| (anonymous) | (native):1 | 9.80 | 160.12 |
| evaluate | (native):364 | 9.78 | 159.78 |
| (anonymous) | (native):1 | 9.78 | 159.78 |
| getBoundingClientRect | (native):0 | 9.38 | 153.32 |
| (idle) | (native):0 | 8.25 | 134.87 |
| querySelectorAll | (native):0 | 7.85 | 128.32 |
| (anonymous) | /scripts/keyboard.js:210 | 7.65 | 125.06 |
| makeKeyboardInteractableCollection | /scripts/keyboard.js:153 | 6.17 | 100.80 |
| (anonymous) | /scripts/utils.js:578 | 5.60 | 91.54 |
| updateDetailsPosition | /scripts/autocomplete/AutoComplete.js:599 | 4.64 | 75.86 |

### Self time by file

| File | % |
|---|---:|
| (native) | 90.84 |
| /scripts/keyboard.js | 3.89 |
| /lib/jquery-3.5.1.min.js | 2.59 |
| /script.js | 1.44 |
| /lib.js | 0.52 |
| /scripts/autocomplete/AutoComplete.js | 0.15 |
| /scripts/slash-commands.js | 0.12 |
| /scripts/slash-commands/SlashCommandParser.js | 0.09 |
| /scripts/slash-commands/SlashCommandClosure.js | 0.08 |
| /scripts/macros/engine/MacroEnvBuilder.js | 0.05 |
| /scripts/utils.js | 0.04 |
| /scripts/RossAscends-mods.js | 0.04 |
| /scripts/extensions/regex/engine.js | 0.03 |
| /scripts/stats.js | 0.03 |
| /scripts/slash-commands/SlashCommandCommandAutoCompleteOption.js | 0.03 |

### Inclusive time by file (overlapping)

| File | % |
|---|---:|
| (native) | 100.00 |
| /scripts/keyboard.js | 15.21 |
| /script.js | 7.69 |
| /scripts/utils.js | 5.68 |
| /scripts/autocomplete/AutoComplete.js | 5.25 |
| /lib/jquery-3.5.1.min.js | 4.86 |
| /lib/jquery-ui.min.js | 1.54 |
| /scripts/RossAscends-mods.js | 1.11 |
| /lib.js | 0.53 |
| /scripts/slash-commands.js | 0.52 |
| /scripts/slash-commands/SlashCommandCommandAutoCompleteOption.js | 0.31 |
| /scripts/slash-commands/SlashCommand.js | 0.28 |
| /scripts/slash-commands/SlashCommandClosure.js | 0.18 |
| /scripts/slash-commands/SlashCommandParser.js | 0.12 |
| /scripts/stats.js | 0.11 |

### Self time by library/category

| Category | % |
|---|---:|
| markdown/formatting | 0.00 |
| DOMPurify | 0.00 |
| highlight.js | 0.00 |
| jQuery | 2.59 |
| message rendering | 0.00 |
| save/JSON | 0.62 |
| tokenization | 0.00 |
| webpack bundle (unresolved) | 0.52 |
| other/idle/native | 96.27 |
