# P1 step 1: remove unbounded spread arguments

> **JS-Slash-Runner source claims superseded by [review-fix-m1](../review-fix-m1/README.md).** The two extension TS files are restored byte-for-byte to `37a4818` / `f6c0053^`; their three spread-call changes never affected the shipped `dist/`. All extension-source implementation descriptions, audit verdicts, source hashes and the 15 VM-check results below (including `extension-source-check*.json` and the extension entries in `validation.json`, `summary.json` and `spread-audit.json`) describe the historical, now-reverted source only. They are retained as history, are not current acceptance evidence, and must not be rerun expecting the reverted TS behavior. The six core tests in `tests/longchat-spread.test.mjs` do not depend on those TS edits and remain applicable. Other P1-1 product fixes are retained. The upstream issue draft is in the linked M1 report.

Implemented against base `b1cf0e956105d2da7a3edeca4e3e5d84b8c147b4`; head is WORKTREE on `opus-longchat`. The 3000-message/load-all **full workflow passes 5/5**, with no RangeError, page errors, forbidden network requests or timeouts. Exact DOM and dynamic Tab-order comparisons pass at 2000/100. The expected historical browser failure **was not reproduced** in the two base open-only attempts; these are successful observations, not failed samples. A separate browser-free 300k-control negative control fails with RangeError on base and completes on head.

The exported `makeKeyboardInteractable(...interactables)` signature remains a compatibility wrapper. It and both collection call sites use one private iterable loop; the collection never becomes the call's positional arguments. Selector order, duplicate visits, existing tabindex behavior, synchronous execution and observer behavior remain intact. No observer/incremental/frame-coalescing change is included.

The audit found 19 affected call sites across 10 product files. Loaded chat replacement clears and fills the existing exported array. Message flattening, swipe append and DOM moves use bounded-argument loops; extrema use reductions with the original empty/signed-zero semantics. Swipe input is snapshotted with array-literal spread to retain the original behavior when input aliases the destination. The swipe picker still replaces its children once, using a detached fragment. Extension-source insertion/rotation detach the existing tail and append both parts before the original refresh/events; variable assignment evaluates the Lodash chain once, merges each message into its backing object in precedence order, and wraps once. No public function signature or event call was removed/reordered.

| Changed file | Change |
|---|---|
| public/scripts/keyboard.js | Shared collection loop; variadic compatibility wrapper; both array/NodeList callers |
| public/script.js | Loaded chat, swipe payload/metadata arrays, displayed-message minimum |
| public/scripts/group-chats.js | Whole group-chat replacement |
| public/scripts/chats.js | Neutral-chat restore and assistant-note import |
| public/scripts/openai.js | Nested history flattening and API chat assembly |
| public/scripts/power-user.js | Style-tag NodeList moves |
| public/scripts/swipe-picker.js | Arbitrary swipe-block DOM replacement |
| public/scripts/extensions/expressions/index.js | Maximum of expression-holder widths |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/chat_message.ts | Unbounded message insertion and rotation, source only |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/variables.ts | Chat-length variable merge, source only |
| tests/longchat-spread.test.mjs | Six deterministic, browser-free compatibility/large-input cases |
| package.json | Register only the fast new unit file in test:perf |

The extension TypeScript sources are audited and fixed, but their generated/minified bundle is explicitly excluded and unchanged. They are not loaded by the browser matrix because extensions are disabled. Separate actual-source VM checks cover those changes; rebuilding/testing the enabled third-party extension is outside this core-browser evidence.

All measurements use Linux, Node 24.22.1, headless Chromium 156.0.8078.4, 1440×1000, seed 20261028 and the P0 end-relative data shape (ten swipe messages per final 100). No CPU profiles were needed or collected. [summary.json](summary.json) gives sample counts, raw-record links, source hashes and shutdown metadata.

| Scenario / metric | Base median / p95 ms (n) | Head median / p95 ms (n) |
|---|---:|---:|
| 3000/0 open-only, open | 9863.65 / 9918.40 (2) | 9672.40 / 9752.80 (5) |
| 3000/0 full workflow, open | — | 9712.90 / 10601.20 (5) |
| 3000/0 full workflow, send through save | — | 8026.71 / 8850.29 (5) |
| 2000/100 equivalence run, open observation | 842.50 / 842.50 (1) | 917.00 / 917.00 (1) |

Median is arithmetic (two base observations are averaged); p95 is nearest-rank. Open includes the existing 500 ms quiet window. Full workflow covers both scroll sweeps and a real `/send` save/render assertion; at truncation 0 there are no older-message batches. Base send was not measured. These counts are for functional acceptance, not a seven-pair timing experiment: no speedup or confidence-interval claim is made. Some independent head/equivalence jobs overlapped, so machine contention is an additional timing caveat. The equivalence harness mechanically emits a degenerate n=1 bootstrap interval; it has no inferential value.

| Raw browser group | Successful / attempted | Page errors | Exit code |
|---|---:|---:|---:|
| base-3000 (open only) | 2 / 2 | 0 | 0 |
| head-3000 (open only) | 5 / 5 | 0 | 0 |
| head-3000-workflow | 5 / 5 | 0 | 0 |
| equivalence base + head | 2 / 2 | 0 | 0 |

The initial choice of open-only checks did not reproduce the historical base failure. To close the head workflow coverage gap, five additional full head workflows were run; the initial successful five are retained separately. Base 3000/0 was not run again, respecting the requested two-attempt cap. These are additional coverage runs, not replacement attempts after a failure. No failing browser sample was discarded or retried.

[comparison.json](equivalence/comparison.json) reports exact equality. Each DOM snapshot is normalized using the existing P0 rules, stored as deterministic gzip, and verified against its recorded decompressed byte length and SHA-256. P0 captures `#chat` after open and after one real older-message batch; the dynamic scenarios below are full real-Tab walks, not additional DOM snapshots.

| Equivalence check | Base / head observations | Result |
|---|---:|---|
| DOM after open | 1 / 1 | Identical |
| DOM after showMoreMessages | 1 / 1 | Identical |
| Tab after older messages | 565 / 565 | Identical |
| Tab after real message append | 565 / 565 | Identical |
| Tab after late interactable class | 567 / 567 | Identical |
| Tab after ancestor disabled class | 566 / 566 | Identical |
| Tab after ancestor enabled class | 567 / 567 | Identical |
| Tab with popup open | 4 / 4 | Identical |
| Tab after popup close | 567 / 567 | Identical |

Total: 3401 actual Tab presses per side, with focus descriptors compared exactly. Snapshots cover 100 messages at open and 200 after older loading; append scenarios use the real upstream send/save path. [keyboard-stress.json](keyboard-stress.json) retains the base/head 300k-control negative control. Its fake controls are disabled, so the hasAttribute visit counter stays zero on both sides; the new unit test independently verifies all 300k enabled visits through initialization and NodeList-like extension registration.

| Validation | Tests | Pass | Skip | Fail |
|---|---:|---:|---:|---:|
| New unit file, Node 20 | 6 | 6 | 0 | 0 |
| New unit file, Node 22 | 6 | 6 | 0 | 0 |
| New unit file, Node 24 | 6 | 6 | 0 | 0 |
| Existing focused tests, Node 22 | 58 | 57 | 1 | 0 |
| Extension-source VM checks | 15 | 15 | 0 | 0 |
| ESLint | 9 JS + 2 TS files | exit 0 | — | 0 |

[validation.json](validation.json) retains commands/methods and logs. Existing focused files are longchat-measurement, chat-load-ownership, group-history-path and expression-mode-flow; the skip is the native Windows console test on Linux. The new tests execute actual keyboard module/function/class code, stress 300k controls/IDs/messages, preserve chat identity and order, check empty/NaN/signed-zero minimum behavior, and check aliased swipe input plus render event order/count/arguments. Runtime was about 1.1–1.3 seconds per Node version; no browser/network/dependency beyond built-in Node modules is used by this new CI file. An earlier five-case version and a post-swipe-edit affected-test run also passed; final results above use the six-case file.

[extension-source-checks.json](extension-source-checks.json) covers six insertion positions, five rotations, variable precedence versus base, and 300k-message insertion (including 300k events), rotation and variable merge. The actual TypeScript declarations were transpiled and executed with real Lodash, with managed refresh/event boundaries stubbed. Two intermediate diagnostics are retained: an assertion initially rejected equal data from different VM realms because their prototypes differed (fixed by comparing JSON data while retaining explicit reference assertions); then the 300k-variable check exposed quadratic deferred Lodash chain copying in the first source-loop implementation (interrupted with SIGINT, then fixed by merging into one backing object). These were root-cause fixes, not retries of a flaky assertion. No lab server was part of either diagnostic.

ESLint uses the normal root config for JavaScript. The root config ignores third-party sources and its default parser cannot parse TypeScript; TS lint therefore uses `--no-ignore` and a temporary parseForESLint adapter to the already installed typescript-estree/visitor-keys/scope-manager packages. The adapter is recorded in validation JSON; no parser/dependency/config was added to the repository.

All five lab servers exited 0, reported no incomplete shutdown, and removed their own owner lock. Playwright browsers were closed by the harness, and each driver exited 0. Each lab had its own fresh synthetic root; no two servers shared a data directory. Server logs retain thumbnail WASM/path warnings on both revisions with the shared node_modules symlink; these caused no page exceptions and were not hidden or changed in this step. No persistence/lifecycle/retention/identity code was edited, no synthetic/user data was deleted, and no Git refs, commits or pushes were made.

| Acceptance item | Status |
|---|---|
| Head 3000/0 full workflow succeeds 5/5, no RangeError/page errors | Met |
| DOM after open/older and all specified dynamic Tab scenarios equal at 2000/100 | Met |
| Variadic compatibility, iterable 300k-controls, focused deterministic unit coverage | Met |
| Frontend spread audit and only unbounded chat/DOM fixes | Met: 112 spread calls audited, 19 fixed |
| Historical browser RangeError on base at 3000/0 | Not reproduced in the two open-only attempts; explicit limitation |
| Native Windows/manual real chat and six remote CI jobs | Not run: Linux environment and no push; local Node 20/22/24 unit coverage supplied |
| Enabled third-party generated bundle | Not tested/rebuilt: minified files excluded; source changes checked separately |

Reproduction uses the existing harness. `PYTHON` means the installed Playwright Python, `NODE24` the installed Node 24 binary, `BASE_ARCHIVE` a read-only archive of b1cf0e9 with the shared node_modules symlink, and `OUT` a fresh output directory. The archive was created by the harness with `git archive | tar -x`, then made read-only; no worktree/checkout/stash/reset/ref mutation was used.

```sh
"$PYTHON" tests/browser-longchat-perf.py --product-root "$BASE_ARCHIVE" --product-revision b1cf0e9 --sizes 3000 --settings 0 --runs 2 --no-profiles --open-only --output "$OUT/base-3000" --node "$NODE24"
"$PYTHON" tests/browser-longchat-perf.py --sizes 3000 --settings 0 --runs 5 --no-profiles --open-only --output "$OUT/head-3000" --node "$NODE24"
"$PYTHON" tests/browser-longchat-perf.py --sizes 3000 --settings 0 --runs 5 --no-profiles --output "$OUT/head-3000-workflow" --node "$NODE24"
"$PYTHON" tests/browser-longchat-perf.py --base b1cf0e9 --head WORKTREE --sizes 2000 --settings 100 --runs 1 --equivalence --run-timeout 600 --combo-timeout 900 --output "$OUT/equivalence" --node "$NODE24"
node --test tests/longchat-spread.test.mjs
node --test tests/longchat-measurement.test.mjs tests/chat-load-ownership.test.mjs tests/group-history-path.test.mjs tests/expression-mode-flow.test.mjs
```

The source audit used `rg --files` followed by Espree AST inspection of 262 JS/MJS files and TypeScript AST inspection of 89 additional TS/TSX/JSX/CJS/Vue source files. There were zero parse errors. `lib/`, `*.min.js`, generated minified `dist/` and declaration files were excluded. Inline HTML ellipses were checked and were text/labels/placeholders, not spread calls. The regex hit at script.js:3353 is inside a block comment and is not executable. Remaining calls below are explicitly bounded, positional forwarding, or outside the requested chat/DOM-growth scope; “out of scope” does not claim that arbitrary settings/input could never reach an argument limit. All locations below are in the base revision. Full machine-readable verdicts are in [spread-audit.json](spread-audit.json).

| Baseline location | Spread call | Verdict |
|---|---|---|
| public/script.js:3061 | <code>substituteParamsLegacy.call(this, ...arguments)</code> | Leave: forwards an existing positional argument list; count does not grow with chat history. |
| public/script.js:3121 | <code>result.push(...names)</code> | Out of scope: group-member names for stopping strings, not chat messages or DOM nodes. |
| public/script.js:3126 | <code>result.push(...getInstructStoppingSequences())</code> | Out of scope: instruct-template stopping sequences. |
| public/script.js:3127 | <code>result.push(...getCustomStoppingStrings())</code> | Out of scope: user-configured stopping strings. |
| public/script.js:3844 | <code>message.swipes.push(...this.swipes)</code> | Fixed: swipe payload array has no enforced cardinality bound; snapshot then append individually (also safe for aliased input). |
| public/script.js:3845 | <code>message.swipe_info.push(...swipeInfoArray)</code> | Fixed: metadata array has the same unbounded cardinality as incoming swipes. |
| public/script.js:3957 | <code>this.messageLogprobs.push(...(Array.isArray(logprobs) ? logprobs : [logprobs]))</code> | Out of scope: logprobs from one streaming response chunk; not accumulated chat/DOM input to the call. |
| public/script.js:4719 | <code>mesExamplesArray.unshift(...cleanedExample)</code> | Out of scope: parsed world-info example text, not accumulated chat history. |
| public/script.js:4721 | <code>mesExamplesArray.push(...cleanedExample)</code> | Out of scope: parsed world-info example text, not accumulated chat history. |
| public/script.js:5735 | <code>messages.splice(injectIdx, 0, ...roleMessages)</code> | Bounded: roleMessages has at most the three fixed system/user/assistant roles per depth. |
| public/script.js:5737 | <code>injectedMessages.push(...roleMessages)</code> | Bounded: same at-most-three roleMessages array. |
| public/script.js:6896 | <code>item.swipes.push(...swipes)</code> | Fixed: public saveReply accepts an unbounded swipe array; snapshot then append individually, preserving alias behavior. |
| public/script.js:6897 | <code>item.swipe_info.push(...swipeInfoArray)</code> | Fixed: incoming swipe metadata has no enforced cardinality bound. |
| public/script.js:7169 | <code>chat.splice(0, chat.length, ...SAFETY_CHAT)</code> | Bounded: SAFETY_CHAT is a fixed one-message constant. |
| public/script.js:7838 | <code>chat.splice(0, chat.length, ...data)</code> | Fixed: whole loaded chat array; clear and append individually, preserving exported chat identity. |
| public/script.js:9732 | <code>Math.min(...allIds)</code> | Fixed: IDs cover every displayed message; reduce Math.min from Infinity, retaining empty and signed-zero semantics. |
| public/script.js:12366 | <code>importedFileNames.push(...result)</code> | Out of scope: filenames returned by one character/chat import, not message or DOM arrays. |
| public/scripts/util/SimpleMutex.js:38 | <code>this.callback(...args)</code> | Leave: forwards an existing callback argument list; no collection expansion. |
| public/scripts/i18n.js:186 | <code>missingData.push(...Array.from(trackMissingDynamicTranslate).map(key => ({ key, language: localeFile, value: key })))</code> | Out of scope: set of missing translation keys, not chat history or a DOM collection. |
| public/scripts/textgen-settings.js:474 | <code>banned_tokens.push(...tokens)</code> | Out of scope: configured raw banned token IDs. |
| public/scripts/textgen-settings.js:488 | <code>banned_tokens.push(...tokens)</code> | Out of scope: tokenization of configured banned text. |
| public/scripts/textgen-settings.js:1815 | <code>logitBiasArray.push(...tokenBans.map(x => [Number(x), false]))</code> | Out of scope: configured token bans for provider parameters. |
| public/scripts/secrets.js:517 | <code>String.fromCharCode(...hashBytes)</code> | Bounded: SHA-256 hash bytes (32). |
| public/scripts/variables.js:686 | <code>Math.min(...array)</code> | Out of scope: slash-command numeric operands from explicit input/scoped variable, not the chat array or DOM. |
| public/scripts/variables.js:690 | <code>Math.max(...array)</code> | Out of scope: slash-command numeric operands from explicit input/scoped variable, not the chat array or DOM. |
| public/scripts/nai-settings.js:477 | <code>result.push(...permutations)</code> | Bounded: fixed spelling/case/space permutations per banned word. |
| public/scripts/nai-settings.js:542 | <code>stoppingStrings.push(...additionalStopStrings)</code> | Out of scope: expanded configured stopping strings, not chat history or DOM. |
| public/scripts/power-user.js:1534 | <code>pinsElement.append(...Array.from(styleTags))</code> | Fixed: arbitrary style-tag NodeList in formatted message; move nodes one at a time into detached pins container. |
| public/scripts/macros.js:708 | <code>macro.replace(...args)</code> | Leave: forwards regex replacer positional arguments; not a chat/DOM collection. |
| public/scripts/popup.js:294 | <code>buttonElement.classList.add(...(button.classes ?? []))</code> | Out of scope: configured CSS class names of one custom button. |
| public/scripts/popup.js:967 | <code>toastContainer.classList.remove(...toastPositionClasses)</code> | Bounded: toast position class list from fixed toast-positions mapping. |
| public/scripts/group-chats.js:321 | <code>chat.splice(0, chat.length, ...data)</code> | Fixed: whole group-chat history; clear and append individually, preserving chat identity. |
| public/scripts/reasoning.js:1657 | <code>reasoning_templates.splice(0, reasoning_templates.length, ...data.reasoning)</code> | Out of scope: imported reasoning-template settings, not chat history or DOM. |
| public/scripts/logprobs.js:141 | <code>tokenSpans.push(...withVirtualWhitespace(token, span))</code> | Bounded: withVirtualWhitespace returns one span and at most a few whitespace/break nodes per token. |
| public/scripts/keyboard.js:101 | <code>makeKeyboardInteractable(...interactables)</code> | Fixed: registered selector can match an unbounded NodeList; call shared collection loop directly. |
| public/scripts/keyboard.js:168 | <code>makeKeyboardInteractable(...interactables)</code> | Fixed: all matched interactables can grow with DOM; call shared collection loop directly. |
| public/scripts/keyboard.js:179 | <code>[].concat(...interactableSelectors.map(selector => Array.from(element.querySelectorAll(&#96;${selector}&#96;))))</code> | Leave: concat receives one array per registered selector, not one argument per matched element; selector count does not grow with chat/DOM size. Preserve selector order and duplicates. |
| public/scripts/slash-commands.js:223 | <code>UNIQUE_APIS.push(...new Set(Object.values(CONNECT_API_MAP).map(x => x.selected)))</code> | Bounded: values of fixed CONNECT_API_MAP. |
| public/scripts/slash-commands.js:3226 | <code>text.slice(...[Number(arg.start), arg.end && Number(arg.end)])</code> | Bounded: literal two-element start/end array. |
| public/scripts/slash-commands.js:6414 | <code>list.push(...Array.isArray(parsedArg) ? parsedArg : [arg])</code> | Out of scope: explicitly supplied prompt identifiers/names. |
| public/scripts/slash-commands.js:6483 | <code>list.push(...Array.isArray(parsedArg) ? parsedArg : [arg])</code> | Out of scope: explicitly supplied prompt identifiers/names. |
| public/scripts/macros/engine/MacroCstWalker.js:836 | <code>Math.min(...allRanges.map(r => r.startOffset))</code> | Out of scope: lexical token/nested-macro ranges within a variable expression, not chat history or DOM. |
| public/scripts/macros/engine/MacroCstWalker.js:837 | <code>Math.max(...allRanges.map(r => r.endOffset))</code> | Out of scope: lexical token/nested-macro ranges within a variable expression, not chat history or DOM. |
| public/scripts/PromptManager.js:24 | <code>func(...args)</code> | Leave: generic debounce argument forwarding. |
| public/scripts/PromptManager.js:220 | <code>this.add(...prompts)</code> | Leave: forwards constructor positional prompt arguments; not a growing history collection. |
| public/scripts/PromptManager.js:243 | <code>this.checkPromptInstance(...prompts)</code> | Leave: forwards existing add() positional prompt arguments for validation. |
| public/scripts/PromptManager.js:244 | <code>this.collection.push(...prompts)</code> | Leave: appends existing positional prompt arguments, not the accumulated chat array. |
| public/scripts/world-info.js:1134 | <code>books.push(...extraCharLore.extraBooks.filter(onlyUnique).filter(Boolean))</code> | Out of scope: explicitly configured character lorebook names. |
| public/scripts/world-info.js:4793 | <code>console.debug(&#96;[WI] Entry ${entry.uid}&#96;, ...args)</code> | Leave: diagnostic positional argument forwarding. |
| public/scripts/world-info.js:5092 | <code>console.debug(args.shift(), ...args)</code> | Leave: diagnostic positional argument forwarding. |
| public/scripts/world-info.js:5308 | <code>Math.max(...scores)</code> | Out of scope: world-info entry-group scores; count follows lorebook settings, not chat/DOM size. |
| public/scripts/autocomplete/MacroAutoCompleteHelper.js:736 | <code>options.push(...varOptions)</code> | Out of scope: variable-name autocomplete options; not message/DOM entries. |
| public/scripts/tags.js:1153 | <code>Math.max(0, ...tags.map(t => t.sort_order))</code> | Out of scope: tag settings sort order, not chat/DOM. |
| public/scripts/openai.js:868 | <code>messages.splice(injectIdx, 0, ...roleMessages)</code> | Bounded: at most three role messages per depth. |
| public/scripts/openai.js:3234 | <code>state.images.push(...inlineData.map(x => &#96;data:${x.mimeType};base64,${x.data}&#96;).filter(isDataURL))</code> | Out of scope: image parts in one streaming chunk; not an accumulated chat/DOM collection. |
| public/scripts/openai.js:3262 | <code>state.images.push(...imageUrls.filter(isDataURL))</code> | Out of scope: image URLs in one streaming chunk; not an accumulated chat/DOM collection. |
| public/scripts/openai.js:3824 | <code>this.collection.push(...items)</code> | Leave: constructor positional Message/MessageCollection arguments already passed individually; internal callers construct empty collections. |
| public/scripts/openai.js:3898 | <code>acc.push(...message.flatten())</code> | Fixed: nested MessageCollection.flatten can contain whole history; append each flattened message. |
| public/scripts/openai.js:4124 | <code>chat.push(...item.getChat())</code> | Fixed: API history collection can contain whole chat; append each serialized message. |
| public/scripts/chats.js:1876 | <code>chat.splice(0, chat.length, ...neutralChatData)</code> | Fixed: whole neutral-chat history from session storage; preserve chat identity and order. |
| public/scripts/chats.js:2167 | <code>chat.splice(0, chat.length, ...messages)</code> | Fixed: whole assistant-note chat imported from JSONL; preserve chat identity and order. |
| public/scripts/utils.js:1142 | <code>x.callback(...rgxMatch)</code> | Leave: regex capture arguments forwarded to replacer callback; not chat/DOM entries. |
| public/scripts/utils.js:1706 | <code>String.fromCharCode(...utf8Bytes.subarray(i, i + chunkSize))</code> | Bounded: explicit 8192-byte chunks before String.fromCharCode. |
| public/scripts/slash-commands/SlashCommandParser.js:531 | <code>options.push(...qrApi.listSets() .map(set => qrApi.listQuickReplies(set).map(qr => &#96;${set}.${qr}&#96;)) .flat() .map(qr => new SlashCommandQuickReplyAutoCompleteOption(qr)), )</code> | Out of scope: configured quick-reply autocomplete entries, not chat/DOM. |
| public/scripts/slash-commands/SlashCommandParser.js:841 | <code>cmd.unnamedArgumentList.push(...this.parseUnnamedArgument())</code> | Out of scope: parsed command argument values, not chat/DOM. |
| public/scripts/slash-commands/SlashCommandClosure.js:200 | <code>listValues.push(...(Array.isArray(rest) ? rest : [rest]))</code> | Out of scope: recursively substituted command pieces, not chat/DOM collections. |
| public/scripts/extensions.js:614 | <code>paths.push(...startupTemplates[name].map(template => &#96;scripts/extensions/${name}/${template}.html&#96;))</code> | Bounded: fixed startupTemplates entry per extension. |
| public/scripts/extensions.js:1042 | <code>icon.classList.add(...iconClasses.split(' '))</code> | Out of scope: configured icon CSS class names. |
| public/scripts/swipe-picker.js:284 | <code>listContainer.replaceChildren(...swipeBlocks)</code> | Fixed: one DOM block per swipe, no enforced limit; build a detached fragment and replace once, retaining child order and one replacement. |
| public/scripts/extensions/quick-reply/index.js:18 | <code>console.debug('[QR2]', ...msg)</code> | Leave: diagnostic positional argument forwarding. |
| public/scripts/extensions/quick-reply/index.js:19 | <code>console.log('[QR2]', ...msg)</code> | Leave: diagnostic positional argument forwarding. |
| public/scripts/extensions/quick-reply/index.js:20 | <code>console.warn('[QR2]', ...msg)</code> | Leave: diagnostic positional argument forwarding. |
| public/scripts/extensions/quick-reply/index.js:136 | <code>functionToCall(...args)</code> | Leave: forwards queued API positional arguments; no chat/DOM collection. |
| public/scripts/extensions/quick-reply/index.js:139 | <code>functionToCall(...args)</code> | Leave: forwards queued API positional arguments; no chat/DOM collection. |
| public/scripts/extensions/stable-diffusion/index.js:3648 | <code>sizesData.push(...sizes)</code> | Out of scope: supported image-size options returned by provider. |
| public/scripts/extensions/stable-diffusion/index.js:3662 | <code>sizesData.push(...result.sizes)</code> | Out of scope: supported image-size options returned by provider. |
| public/scripts/extensions/expressions/index.js:353 | <code>Math.max(...imagesWidth)</code> | Fixed: widths from expression-holder DOM collection; reduce maximum from -Infinity. |
| public/scripts/extensions/third-party/st-memory-enhancement/core/manager.js:328 | <code>cb(...args)</code> | Leave: callback positional argument forwarding. |
| public/scripts/extensions/third-party/st-memory-enhancement/scripts/settings/standaloneAPI.js:97 | <code>String.fromCharCode(...bytes.map((b, i) => b ^ deviceId.charCodeAt(i % deviceId.length) ))</code> | Out of scope: encoded API-key bytes, not chat history or DOM. |
| public/scripts/extensions/third-party/st-memory-enhancement/scripts/runtime/absoluteRefresh.js:894 | <code>bookNames.push(...charLorebooks.additional)</code> | Out of scope: configured additional character lorebook names. |
| public/scripts/extensions/third-party/st-memory-enhancement/external-data-adapter.js:31 | <code>console.log(&#96;[ExternalDataAdapter] ${message}&#96;, ...args)</code> | Leave: diagnostic positional argument forwarding. |
| public/scripts/extensions/third-party/st-memory-enhancement/external-data-adapter.js:34 | <code>console.warn(&#96;[ExternalDataAdapter] ⚠️ ${message}&#96;, ...args)</code> | Leave: diagnostic positional argument forwarding. |
| public/scripts/extensions/third-party/st-memory-enhancement/external-data-adapter.js:37 | <code>console.error(&#96;[ExternalDataAdapter] ❌ ${message}&#96;, ...args)</code> | Leave: diagnostic positional argument forwarding. |
| public/scripts/extensions/third-party/st-memory-enhancement/external-data-adapter.js:42 | <code>console.log(&#96;[ExternalDataAdapter] 🔍 ${message}&#96;, ...args)</code> | Leave: diagnostic positional argument forwarding. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/iframe/predefine.js:14 | <code>result.merge( ...Object.entries(_.get(window.parent, 'TavernHelper')._bind).map(([key, value]) => ({ [key.replace('_', '')]: value.bind(window), })), )</code> | Out of scope: fixed helper bindings exposed to iframe, not chat/DOM elements. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/util/algorithm.ts:30 | <code>destination.push(...new_array)</code> | Leave: generic assignInplace has no callers in this frontend source (rg); no actual chat/DOM path. Not a chat-sized call site. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/util/compatibility.ts:23 | <code>world_names.push(...(data.world_names?.length ? data.world_names : []))</code> | Out of scope: worldbook-name settings migration. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/util/color.ts:86 | <code>determineTextColorFromRgba(...rgba)</code> | Bounded: four RGBA channels. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/slash_command/audio.ts:76 | <code>store.playlist.push(...urls)</code> | Out of scope: explicit audio playlist URLs. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/slash_command/event.ts:11 | <code>eventSource.emit(event, ...data)</code> | Leave: explicitly supplied event positional arguments; not a collection of chat messages or nodes. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/tavern_regex.ts:54 | <code>macro.replace( { role: ( { user_input: 'user', ai_output: 'assistant', slash_command: 'system', world_info: 'system', reasoning: 'system', } as const )[source], message_id: depth !== undefined ? chat.length - depth - 1 : undefined, }, substring, ...args, )</code> | Leave: regex replacer positional argument forwarding. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/lorebook_entry.ts:299 | <code>_.merge( {}, default_original_lorebook_entry, ...Object.entries(entry) .filter(([_, value]) => value !== undefined) // @ts-expect-error 未知类型报错 .map(([key, value]) => transformers[key]?.(value)), )</code> | Out of scope: transformed fields of a lorebook entry. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/lorebook_entry.ts:346 | <code>_.merge( {}, ...handleLorebookEntriesCollision(entries) .map(fromPartialLorebookEntry) .map(entry => ({ [entry.uid]: entry })), )</code> | Out of scope: explicit lorebook entries; count follows lorebook settings, not chat history or DOM. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/util.ts:31 | <code>fn(...args)</code> | Leave: callback positional argument forwarding. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/util.ts:61 | <code>fn(...args)</code> | Leave: callback positional argument forwarding. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/audio.ts:63 | <code>store.playlist.push( ...audio_list.map((item: AudioWithOptionalTitle) => ({ title: item.title &#124;&#124; handle_url_to_title(item.url), url: item.url })), )</code> | Out of scope: explicit audio playlist entries. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/panel/script/use_resolve_id_conflict.ts:18 | <code>getFlattenedScriptTrees(...stores.map(store => store.script_trees))</code> | Leave: one array per explicitly passed script store; argument count is not the number of script nodes or chat messages. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/generate/generateRaw.ts:416 | <code>processedMessages.splice(injectIdx, 0, ...roleMessages)</code> | Bounded: one message per fixed system/user/assistant role at each depth. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/generate/dataProcessor.ts:377 | <code>mesExamplesArray.unshift(...cleanedExample)</code> | Out of scope: parsed world-info example text, not chat history. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/generate/dataProcessor.ts:379 | <code>mesExamplesArray.push(...cleanedExample)</code> | Out of scope: parsed world-info example text, not chat history. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/panel/render/macro_like.ts:10 | <code>macro.replace(context, substring, ...args)</code> | Leave: regex replacer positional argument forwarding. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/panel/render/macro_like.ts:34 | <code>macro.replace({ role: message.role }, substring, ...args)</code> | Leave: regex replacer positional argument forwarding. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/panel/render/macro_like.ts:42 | <code>macro.replace({ role: message.role }, substring, ...args)</code> | Leave: regex replacer positional argument forwarding. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/event.ts:55 | <code>listener(...args)</code> | Leave: listener positional argument forwarding. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/event.ts:119 | <code>eventSource.emit(event_type, ...data)</code> | Leave: event positional argument forwarding. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/event.ts:127 | <code>eventSource.emitAndWait(event_type, ...data)</code> | Leave: event positional argument forwarding. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/lorebook.ts:121 | <code>selected_world_info.push(...value)</code> | Out of scope: selected worldbook names in settings. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/variables.ts:119 | <code>result.assign( ...chat .slice(0, _getCurrentMessageId.call(this) + 1) .map((chat_message: any) => chat_message?.variables?.[chat_message?.swipe_id ?? 0]), )</code> | Fixed (extension source): one variable object per chat message can grow with history; assign each in original precedence order. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/worldbook.ts:41 | <code>selected_world_info.push(...worldbook_names)</code> | Out of scope: selected worldbook names in settings. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/worldbook.ts:391 | <code>_.merge( {}, ..._(handleWorldbookEntriesCollision(worldbook)) .map(fromWorldbookEntry) .map(entry => ({ [entry.uid]: entry })) .value(), )</code> | Out of scope: explicit worldbook entry settings, not chat history or DOM. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/chat_message.ts:379 | <code>chat.splice(insert_before, 0, ...converted)</code> | Fixed (extension source): unbounded newly converted message array; detach tail, append messages and tail individually before original refresh/events. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/function/chat_message.ts:480 | <code>chat.splice(begin, 0, ...right_part)</code> | Fixed (extension source): rotation can reinsert most of the chat; detach tail and append both parts in order, preserving chat identity and original refresh boundary. |

An additional `.apply` audit found only existing positional argument forwarding (no chat/DOM collection expansion):

| Baseline location | Call | Verdict |
|---|---|---|
| public/scripts/utils.js:578 | <code>timer = setTimeout(() => { func.apply(this, args); }, timeout);</code> | Leave: forwards existing positional arguments; no chat/DOM collection expansion. |
| public/scripts/utils.js:606 | <code>debounceResolver(func.apply(this, args));</code> | Leave: forwards existing positional arguments; no chat/DOM collection expansion. |
| public/scripts/utils.js:637 | <code>func.apply(this, args);</code> | Leave: forwards existing positional arguments; no chat/DOM collection expansion. |
| public/scripts/utils.js:656 | <code>db.apply(this, args);</code> | Leave: forwards existing positional arguments; no chat/DOM collection expansion. |
| public/scripts/utils.js:659 | <code>func.apply(this, args);</code> | Leave: forwards existing positional arguments; no chat/DOM collection expansion. |
| public/scripts/utils.js:663 | <code>func.apply(this, args);</code> | Leave: forwards existing positional arguments; no chat/DOM collection expansion. |
| public/scripts/extensions/third-party/JS-Slash-Runner/ds-cache-viewer.js:163 | <code>const response = await originalFetch.apply(this, args);</code> | Leave: forwards existing positional arguments; no chat/DOM collection expansion. |
| public/scripts/extensions/third-party/JS-Slash-Runner/ds-cache-optimizer.js:125 | <code>return originalFetch.apply(this, args);</code> | Leave: forwards existing positional arguments; no chat/DOM collection expansion. |
| public/scripts/extensions/third-party/JS-Slash-Runner/ds-worldbook-cache.js:133 | <code>return originalFetch.apply(this, args);</code> | Leave: forwards existing positional arguments; no chat/DOM collection expansion. |
| public/scripts/extensions/third-party/JS-Slash-Runner/src/iframe/cleanup_protector.js:263 | <code>const result = originalMethod.apply(this, convertedArgs);</code> | Leave: forwards existing positional arguments; convertedArgs maps one result per existing argument, without expanding a DOM collection. |

[privacy-snapshot-audit.json](privacy-snapshot-audit.json) verifies all four stored snapshots and scans plain/gzip evidence for unredacted machine hostname, home-directory usernames and absolute temporary paths. No CPU profiles were produced. [raw-index.json](raw-index.json) records the final artifact hashes.
