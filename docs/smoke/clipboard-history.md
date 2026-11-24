# clipboard-history 冒烟记录

- **状态**：自动化验证已过（单测/类型/Lint/覆盖率，2026-11-23）；e2e 4/4 已通过（2026-11-23）；R5 chunk 已补录；R2 手工项待人工补录
- **规格**：`docs/spec/clipboard-history.md`（字段级验收附件）
- **验证人**：AI（自动化部分）+ 待人工补录

| 环境     | 值                  |
| -------- | ------------------- |
| 系统     | Windows 11          |
| 应用版本 | 0.9.6               |
| Node     | v24.18.0            |
| pnpm     | 12.22.2             |

## 1. R2 八类异常对照与记录

| 类别         | 本工具映射（spec §4）                                             | 验证方式 / 证据                                                                                                  | 状态                                        |
| ------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1 中文/空格  | 中文/空格剪贴板文本入库与持久化往返（存储路径固定名、经 userData） | 单测 `storage.test.ts`/`node.test.ts` 中文条目断言；e2e 用例 1 含中文/多行剪贴板回读                              | 自动化已覆盖，手工往返待人工补录            |
| 2 文件占用   | 存储写失败 → `CH_STORAGE_FAILED` 错误态 + 重试                    | 单测 `node.test.ts`「存储写失败 → 结构化 CH_STORAGE_FAILED」mock 分支；渲染端重试按钮由 `ToolView` `isRetryable` 分支 | 单测覆盖，手工置只读目录验证待人工补录      |
| 3 加密       | 不适用（无加密输入）                                               | —                                                                                                                | 不适用                                      |
| 4 超大       | 单条 >100KB 跳过 + 一次性提示                                      | 单测 `node.test.ts`「>100KB 跳过：返回 skipped TOO_LARGE 且不入库」「恰好 100KB 仍入库」；e2e 用例 2 断言 `role=alert` 单条提示且不入库 | 自动化已覆盖                                |
| 5 任务取消   | 离开页面 `clearInterval` 停轮询（轮询即任务取消口径）              | 单测 `renderer` 无；e2e 用例 3「切页停轮询：离开工具页后剪贴板变化不入库」；单测 `client` 无关           | e2e 已编写待运行                            |
| 6 并发       | 单实例 + 页内单定时器；pin/remove/clear 主进程同步串行              | ipc-bus sync 注册单例；单测 pin/remove/clear 并发顺序断言                                                      | 单测覆盖                                    |
| 7 磁盘满     | 原子写失败 → `CH_STORAGE_FAILED`，内存态继续                       | 单测 `node.test.ts` 写失败 mock 分支（同第 2 类证据）；内存态继续由 poll 独立于落盘保证                         | 单测覆盖，VHD 磁盘满实测待人工补录          |
| 8 断电恢复   | 原子写防半写；损坏 JSON → 重建空表 + warn                           | 单测 `storage.test.ts`「损坏 JSON → 删除重建空表且 logger.warn」「半截尾字节同损坏路径」；`writeAtomic`（node-kit）tmp+rename | 单测覆盖，断电实测待人工补录                |

## 2. 自动化验证记录（2026-11-23，AI 执行）

### 2.1 单测（vitest）

- `pnpm exec vitest run packages/tools/clipboard-history` → **Test Files 5 passed (5)、Tests 62 passed (62)**
- 覆盖文件与断言面：`node.test.ts`（poll 判定/去重前插/上限淘汰/置顶不淘汰/写失败结构化错误）、`storage.test.ts`（原子写/损坏重建/校验）、`entries.test.ts`（排序/过滤/摘要/文本统计/相对时间）、`errors.test.ts`（错误码表/中文文案）、`renderer/client.test.ts`（invoke 转发/错误透传）

### 2.2 覆盖率（`vitest run … --coverage --coverage.include='packages/tools/clipboard-history/src/**'`）

- 汇总：**statements 99.05% / branches 93.61% / functions 100% / lines 99.42%**，退出码 0（根 `vitest.config.ts` `packages/tools/clipboard-history/src/**/*.ts` 阈值 80% 口径通过）
- 逐文件（lcov）：`entries.ts` lines 100%（57/57）branches 98%（48/49）；`errors.ts` 100%（6/6）branches 100%；`node.ts` lines 100%（83/83）branches 91%（30/33）；`schema.ts` 100%（10/10）；`storage.ts` lines 100%（13/13）branches 75%（6/8，IO 边界未注入分支）；`renderer/client.ts` 100%（5/5）；`manifest.ts` 未被测试加载（0/1，清单静态导出）

### 2.3 类型 / Lint / e2e 类型

- `pnpm --filter @lumin/tool-clipboard-history typecheck`（`tsc --noEmit -p tsconfig.json`）→ 退出码 0，无输出
- `pnpm exec eslint packages/tools/clipboard-history apps/desktop/e2e/clipboard-history-smoke.spec.ts apps/desktop/src/renderer/src/tools/clipboard-history.vue --max-warnings 0` → 退出码 0，无告警
- `pnpm --filter @lumin/desktop exec tsc -p tsconfig.e2e.json --noEmit` → 退出码 0，无 clipboard 相关报错

### 2.4 e2e（`apps/desktop/e2e/clipboard-history-smoke.spec.ts`，已编写待运行）

实际用例名（4 条）：

1. `空态 → 轮询入库 → 搜索过滤 → 复制回写 → 置顶 → 删除 → 清空`（含关闭重开 `list` 持久化恢复断言，磁盘直读）
2. `>100KB 跳过：一次性提示且不入库`（写 100KB+1 字节，`role=alert` 计数 1，清空剪贴板后提示消失）
3. `切页停轮询：离开工具页后剪贴板变化不入库`
4. `关闭重开：list 持久化恢复（磁盘直读）`

> 状态：用例已按 spec §6 编写并通过 `tsconfig.e2e.json` 类型检查；本次收尾按任务约束未运行 desktop e2e，待主会话执行后回填结果。

## 3. R5 性能/体积记录

| 项                | 值                              | 备注                                        |
| ----------------- | ------------------------------- | ------------------------------------------- |
| 工具 chunk        | `16,490 B raw / 5,255 B gzip`   | 零新增第三方依赖（仅 `@lucide/vue` 图标），远低于 200KB gzip |
| 独占依赖 chunk    | 0                               | 无 mathjs 类求值库，维持 200KB gzip 口径     |
| 运行时资产        | 无                              | 不涉 pdfjs worker / wasm / OCR 模型          |
| IPC 冒烟耗时      | 4/4 通过（5.0–6.5s/例，2026-11-23） | `clipboard-history-smoke.spec.ts`        |

## 4. R3 IPC 冒烟记录

### 4.1 壳级（M0 起，CI 恒跑）

`apps/desktop/e2e/ipc-smoke.spec.ts` 4 用例：①清单渲染（启动 → 默认工具路由，验证 `window.lumin` 契约挂载）→ ②同步 invoke 回包断言 → ③三段式长任务（submit → progress → done）→ ④任务取消。该套件覆盖 spec §7.2「启动 → invoke → 断言回包」最低要求，**默认路由（日历）冒烟已覆盖**，与本工具无直接通道交集。

### 4.2 本工具通道冒烟

| 通道                     | 载荷    | 返回                          | 冒烟证据                                                                        |
| ------------------------ | ------- | ----------------------------- | ------------------------------------------------------------------------------- |
| `clipboard-history:list` | `{}`    | `{ items: Entry[] }`          | e2e 用例 1/4（含关闭重开磁盘直读）；单测 `client.test.ts` 透传                   |
| `clipboard-history:poll` | `{}`    | `{ entry, skipped?: 'TOO_LARGE' }` | e2e 用例 1/2/3；单测 `node.test.ts` 判定矩阵                              |
| `clipboard-history:pin`  | `{ id }` | `{ ok: true }`（未知 id → `INVALID_INPUT`） | 单测切换/未知 id 分支；e2e 用例 1 置顶断言                     |
| `clipboard-history:remove` | `{ id }` | `{ ok: true }`              | 单测删除断言；e2e 用例 1 删除断言                                               |
| `clipboard-history:clear` | `{}`    | `{ ok: true }`               | 单测清空断言；e2e 用例 1 清空后计数归零                                         |

- 全 5 通道为 sync（`registerSync`，非三段式长任务），经 `window.lumin.invoke` 白名单 bridge；轮询取消口径 = 卸载 `clearInterval`（spec §1.3）。
- 手工逐通道记录（dev 运行点检）：待人工补录。
