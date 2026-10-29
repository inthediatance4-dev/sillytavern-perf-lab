# P0 baseline（S2 / S3 × B-warm）

工具提交：`28b7940`（含测量 harness）。产品与 harness 同为该 tip。旧 10-05 / 10-07 数字**不**作基线。

## 环境

- OS：Linux 6.12 x86_64（无头实验室）
- Node：v24.22.1（`/tmp/node-v24.22.1-linux-x64`）
- Chromium：Playwright 156.0.8078.4
- 启动命令：`node server.js` + lab 隔离配置（`exclusiveDataRoot`，listen=false，127.0.0.1）。本仓库无 `Start.bat` / `start.sh`。
- 数据：合成 1 角色 + 1 短聊天；仅内置扩展；`extensions.autoUpdate=false`
- 浏览器：B-warm（共享持久 user-data-dir）
- S2：每次样本前 `sync; echo 3 > /proc/sys/vm/drop_caches`（sudo）
- S3：OS 与 Webpack 缓存保持热态；每边先丢弃一次 warmup
- 统计：两侧均为 WORKTREE，交替采样后**合并**报告中位数/p95（同码 A/B 的 CI 仅作噪声参考，不作加速结论）

## 计时

与 `p0-harness/README.md` 相同：T0 → T_http（csrf-token + lib.js）→ T_ui（APP_READY+角色可见）→ T_send（假 OpenAI 收到生成请求）。

## 结果（中位数 / p95，ms）

| 场景 | n | T_http | T_ui | T_send | ui−http | send−ui |
|---|---:|---:|---:|---:|---:|---:|
| S3 B-warm | 20 | 1433 / 2504 | 3652 / 6003 | 4333 / 7226 | 2174 | 689 |
| S2 B-warm | 14 | 1966 / 3642 | 4361 / 7370 | 5245 / 8384 | 2359 | 684 |

### 服务端阶段中位数（来自 ST_STARTUP_TRACE）

| 阶段 | S3 ms（占 T_send） | S2 ms（占 T_send） | ≥10% 或 ≥200ms？ |
|---|---:|---:|---|
| webpack | 787（18%） | 979（19%） | **是** |
| server_main_import | 365（8%，≥200） | 606（12%） | **是** |
| lifecycle / scan / migrations / lock / identity / plugins | ≤11 | ≤12 | 否 |

Linux 上 identity_probe ≈0.3ms（无 PowerShell）。Windows 串行探测仍按计划保留为候选，但不以本 Linux 基线证明收益。

## 后续做 / 不做

**做**

1. **P2-a** Webpack 输入+输出身份一致则跳过编译（webpack 阶段）
2. **P2-c** Node ≥22.1 `module.enableCompileCache()`（import 阶段）
3. **P4** 针对 ui−http（约一半 T_send）：先画请求时间线，只改无依赖的并行；扩展只出耗时报告、不改激活顺序
4. 可选 **P2-b** Windows 身份探测与导入并行（本 Linux 基线不证明；为 Windows CI/日常保留）

**不做 / 暂缓**

- **P1** install stamp：仓库无 Start.bat/start.sh，实验室用 `node server.js`
- **P2-d** 启动扫描：≤12ms
- **P3** 按需加载：先看 `--profile` 再决定；import 大头也可能被 compile cache 吃掉
- 不削弱 fsync/锁/身份/独占对账；不改扩展激活语义；不以“输出存在”跳过 Webpack

原始数据：`s3-bwarm/`、`s2-bwarm/`。
