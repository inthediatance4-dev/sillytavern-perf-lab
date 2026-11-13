# 启动优化 P0 基线总结

- **分支：** `opus-startup`（自 `codex-improvements` / `c3a1b34`）
- **工具+文档提交：** `28b7940`（harness 自检通过后推送）；基线证据随后提交
- **CI（harness）：** run 40816598904，6/6 通过
- **环境：** Linux 无头、Node 24.22.1、Chromium 156、合成 lab 数据、`node server.js`（无 Start.bat）
- **自检：** 同提交 24 对交替，六项指标中位数差 95% CI 均含 0；连续 30 次启动退出 0 且锁文件删除

## 基线表（中位数 / p95，ms）

| 场景 | n | T_http | T_ui | T_send | ui−http | send−ui |
|---|---:|---:|---:|---:|---:|---:|
| S3 B-warm | 20 | 1433 / 2504 | 3652 / 6003 | 4333 / 7226 | 2174 | 689 |
| S2 B-warm（drop_caches） | 14 | 1966 / 3642 | 4361 / 7370 | 5245 / 8384 | 2359 | 684 |

## 阶段占比与候选（规则：占 T_send ≥10% 或 ≥200ms）

| 阶段 | S3 | S2 | 决策 |
|---|---|---|---|
| webpack | 787ms（18%） | 979ms（19%） | **P2-a** 做 |
| server_main_import | 365ms（≥200） | 606ms（12%） | **P2-c** compile cache 做 |
| ui−http（前端到 APP_READY） | 2174ms（50%） | 2359ms（45%） | **P4** 做（先时间线，谨慎并行） |
| send−ui | 689ms（16%） | 684ms（13%） | 观察；假 OpenAI+UI 发送路径，先不改产品语义 |
| lifecycle / 扫描 / 迁移 / 锁 | ≤11ms | ≤12ms | **跳过 P2-d** |
| identity_probe（Linux） | 0.3ms | 0.3ms | Linux 跳过；**P2-b** 仅作 Windows 向优化可做 |
| npm install（Start.bat） | — | — | **跳过 P1**（本仓库无启动脚本） |

证据：`docs/reviews/2026-10-28-grok-quality/evidence/startup-opt/p0-baseline/`  
方法沿用 10-05/10-07；**未**复用旧数字。
