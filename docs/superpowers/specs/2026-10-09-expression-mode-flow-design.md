# Expression mode flow design

Base: `0b2bdbc9d17433b191f921b5a946772c7676dc2f`. Local synthetic-only worktree; no production access, deployment or dependency installation. Existing files backed up outside Git.

The expressions worker currently uses `#visual-novel-wrapper.is(':visible')` to infer the previously applied mode. This performs geometry reads while newly rendered chat DOM can be dirty. CSS-hidden ancestors or wrappers without layout boxes (for example display:contents) also misidentify stable visual-novel mode as a transition and repeatedly clear sprites and reset drag positions.

Decision: retain a private last-applied visual-novel boolean initialized false, matching the initially hidden wrapper. Determine transition before the first await and update the state after the existing show/hide operations. Stable mode does not clear the container or reset holder geometry, regardless of dimensions or ancestor visibility. Actual mode changes retain their existing invalidation, clearing and drag-style resets. Every worker still enforces wrapper show/hide styles. No extra yield, changed message formatting, classification request logic, interval, public API or dependency.

No-character home returns before applying a mode, so retains the last applied value. CHAT_CHANGED already explicitly invalidates expressions, clears VN sprites when requested and requests new-chat refresh; preserve it. Reopening the same mode keeps drag positions, switching group/single/mobile/waifu mode resets once. Manual sprite override clearing and resize regeneration remain independent and unchanged.

Alternatives considered: delaying the worker merely shifts required layout; inline display shortcuts conflict with CSS overrides; changing message rendering introduces ownership and macro timing hazards. Retaining explicit mode state is bounded to the transition semantics.

Verification: actual-source Node worker execution against original Git source, expected RED proving redundant geometry/clearing, and GREEN covering stable/transition/home/reopen/mobile/empty/CSS-hidden behavior. Keep offline connectivity visibility behavior unchanged. Native Chrome contracts use real jQuery and DOM with synthetic context and mock expression validation, including dirty chat DOM to prove the VN predicate no longer reads geometry. Full local synthetic application open/close A/B checks preserve message HTML, scroll and history. Timings are experimental, do not imply production or phone speedup. Node20/24 safe perf suites, source syntax, source/protection hashes, artifact restoration, graceful own-lab shutdown and fresh independent spec/quality/final review are release gates.

Remaining limitation: layout is still required to paint chat and other jQuery visibility/show operations remain. This does not solve all long-message rendering or in-flight expression classification ownership races.

Native jQuery 3.5.1 considers a zero-width/height element visible if it still has a client rect. The no-layout-box fixture explicitly uses display:contents; zero dimensions alone are not proof of the original transition bug.
