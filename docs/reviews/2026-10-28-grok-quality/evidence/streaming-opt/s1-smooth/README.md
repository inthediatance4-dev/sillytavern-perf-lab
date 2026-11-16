# S1 smooth A/B — incomplete (harness flake)

`--base ee771bb --head WORKTREE --scenario smooth --runs 7` started after S1 merge.
Warmups completed on both sides; **smooth-01-base failed** with `Required measurement has no samples`.

Correction during M4: the earlier explanation attributed this failure to first paint landing after the provider's last chunk. That ordering is expected when smooth streaming has a backlog. The rAF sampler starts before generation and is independent of first paint, so late first paint alone cannot empty its network-window samples. Keyboard sampling formerly waited for a DOM hook, while every metric was restricted to the network window; healthy delayed DOM/typing work could therefore leave those required series empty. Only the warmup raw files were retained here, so the exact empty series or clock/navigation cause of the failed run cannot be established from this historical evidence. The failure is not a valid product comparison. See the [M4 diagnosis, window definition, and rerun](../m4/README.md).

## Warmup medians (discarded, not acceptance)

| Side | frame p95 | typing p95 | finish ms | updates/s | scroll stolen |
| --- | ---: | ---: | ---: | ---: | ---: |
| base (ee771bb) | 16.7 | 35.1 | 340553 | 11.0 | 60 |
| head (S1) | 16.7 | 31.9 | 350847 | 11.2 | 23 |

Smooth finish latency is the existing per-character smooth-streaming backlog after the network ends (plan forbids changing those delays). Smooth was optional ("if time permits") for S1 acceptance; the main/short/reasoning/continue A/B already met the targets. Not retried here to free the machine for S2; leave a full smooth A/B for a later pass if desired.
