# clipboard-history 冒烟记录

- **状态**：自动化验证已过（单测/类型/Lint/覆盖率，2026-11-23）；e2e 4/4 已通过（2026-11-23）；R5 chunk 已补录；R2 手工项待人工补录
- **规格**：`docs/spec/clipboard-history.md`（字段级验收附件）
- **验证人**：AI（自动化部分）+ 待人工补录

| 环境     | 值         |
| -------- | ---------- |
| 系统     | Windows 11 |
| 应用版本 | 0.9.6      |
| Node     | v24.18.0   |
| pnpm     | 12.22.2    |

## 1. R2 八类异常对照与记录

| 类别        | 本工具映射（spec §4）                                              | 验证方式 / 证据                                                                                                                         | 状态                                   |
| ----------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1 中文/空格 | 中文/空格剪贴板文本入库与持久化往返（存储路径固定名、经 userData） | 单测 `storage.test.ts`/`node.test.ts` 中文条目断言；e2e 用例 1 含中文/多行剪贴板回读                                                    | 自动化已覆盖，手工往返待人工补录       |
| 2 文件占用  | 存储写失败 → `CH_STORAGE_FAILED` 错误态 + 重试                     | 单测 `node.test.ts`「存储写失败 → 结构化 CH_STORAGE_FAILED」mock 分支；渲染端重试按钮由 `ToolView` `isRetryable` 分支                   | 单测覆盖，手工置只读目录验证待人工补录 |
| 3 加密      | 不适用（无加密输入）                                               | —                                                                                                                                       | 不适用                                 |
| 4 超大      | 单条 >100KB 跳过 + 一次性提示                                      | 单测 `node.test.ts`「>100KB 跳过：返回 skipped TOO_LARGE 且不入库」「恰好 100KB 仍入库」；e2e 用例 2 断言 `role=alert` 单条提示且不入库 | 自动化已覆盖                           |
| 5 任务取消  | 离开页面 `clearInterval` 停轮询（轮询即任务取消口径）              | 单测 `renderer` 无；e2e 用例 3「切页停轮询：离开工具页后剪贴板变化不入库」；单测 `client` 无关                                          | e2e 已编写待运行                       |
| 6 并发      | 单实例 + 页内单定时器；pin/remove/clear 主进程同步串行             | ipc-bus sync 注册单例；单测 pin/remove/clear 并发顺序断言                                                                               | 单测覆盖                               |
| 7 磁盘满    | 原子写失败 → `CH_STORAGE_FAILED`，内存态继续                       | 单测 `node.test.ts` 写失败 mock 分支（同第 2 类证据）；内存态继续由 poll 独立于落盘保证                                                 | 单测覆盖，VHD 磁盘满实测待人工补录     |
| 8 断电恢复  | 原子写防半写；损坏 JSON → 重建空表 + warn                          | 单测 `storage.test.ts`「损坏 JSON → 删除重建空表且 logger.warn」「半截尾字节同损坏路径」；`writeAtomic`（node-kit）tmp+rename           | 单测覆盖，断电实测待人工补录           |

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

| 项             | 值                                  | 备注                                                         |
| -------------- | ----------------------------------- | ------------------------------------------------------------ |
| 工具 chunk     | `16,490 B raw / 5,255 B gzip`       | 零新增第三方依赖（仅 `@lucide/vue` 图标），远低于 200KB gzip |
| 独占依赖 chunk | 0                                   | 无 mathjs 类求值库，维持 200KB gzip 口径                     |
| 运行时资产     | 无                                  | 不涉 pdfjs worker / wasm / OCR 模型                          |
| IPC 冒烟耗时   | 4/4 通过（5.0–6.5s/例，2026-11-23） | `clipboard-history-smoke.spec.ts`                            |

## 4. R3 IPC 冒烟记录

### 4.1 壳级（M0 起，CI 恒跑）

`apps/desktop/e2e/ipc-smoke.spec.ts` 4 用例：①清单渲染（启动 → 默认工具路由，验证 `window.lumin` 契约挂载）→ ②同步 invoke 回包断言 → ③三段式长任务（submit → progress → done）→ ④任务取消。该套件覆盖 spec §7.2「启动 → invoke → 断言回包」最低要求，**默认路由（日历）冒烟已覆盖**，与本工具无直接通道交集。

### 4.2 本工具通道冒烟

| 通道                       | 载荷     | 返回                                        | 冒烟证据                                                       |
| -------------------------- | -------- | ------------------------------------------- | -------------------------------------------------------------- |
| `clipboard-history:list`   | `{}`     | `{ items: Entry[] }`                        | e2e 用例 1/4（含关闭重开磁盘直读）；单测 `client.test.ts` 透传 |
| `clipboard-history:poll`   | `{}`     | `{ entry, skipped?: 'TOO_LARGE' }`          | e2e 用例 1/2/3；单测 `node.test.ts` 判定矩阵                   |
| `clipboard-history:pin`    | `{ id }` | `{ ok: true }`（未知 id → `INVALID_INPUT`） | 单测切换/未知 id 分支；e2e 用例 1 置顶断言                     |
| `clipboard-history:remove` | `{ id }` | `{ ok: true }`                              | 单测删除断言；e2e 用例 1 删除断言                              |
| `clipboard-history:clear`  | `{}`     | `{ ok: true }`                              | 单测清空断言；e2e 用例 1 清空后计数归零                        |

- 全 5 通道为 sync（`registerSync`，非三段式长任务），经 `window.lumin.invoke` 白名单 bridge；轮询取消口径 = 卸载 `clearInterval`（spec §1.3）。
- 手工逐通道记录（dev 运行点检）：待人工补录。

## M61 图片扩展增量验证

> 范围：Q63 决策「文本 500 / 图片 100 独立上限」+ 图片条目（缩略图内联、SHA-1 去重、孤儿 PNG 清理）+ `image`/`copy` 两通道。规格：`docs/spec/clipboard-history.md` §1.2/§1.3/§2/§3/§6。自动化由 AI 执行并回填（2026-11-24，全绿）。

### 字段级手工增量步骤（spec §6 对照）

| #   | 步骤（字段级）                                                                  | 预期断言（可复现）                                                                                        |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | 复制任意图片（截图/文件管理器复制图片）                                         | ≤1s 出现图片卡：缩略图 ≤160 宽内联、徽标 `宽×高 · 字节`（如 `1920×1080 · 2.1MB`）、相对时间、无「已置顶」 |
| 2   | 同一张图再次复制（复制后未被其他内容覆盖）                                      | 不重复入库：头部图片条目 SHA-1 相同 → 跳过，列表仍 1 张图片                                               |
| 3   | 连续复制第 101 张不同图片（其中最早 1 张已置顶）                                | 图片卡恒 ≤100：淘汰最旧未置顶图片；置顶图片永不淘汰；文本条目计数不受影响（文本仍独立 500 上限）          |
| 4   | 顶栏分段筛选依次点 全部 / 文本 / 图片                                           | 列表与计数徽标随筛选变化：文本模式隐藏图片卡，图片模式隐藏文本卡，全部两者可见                            |
| 5   | 搜索框输入非空词（同时存在文本与图片条目）                                      | 图片不参与搜索（图片卡隐藏）；清空搜索恢复                                                                |
| 6   | 点图片缩略图                                                                    | NModal 打开时才调 `image` 通道取原图：加载中 NSpin → 原图展示（非缩略图）                                 |
| 7   | 预览打开时手动删除 `userData/clipboard-history/images/{id}.png` 后点缩略图/重试 | 中文文案「图片文件已丢失」+ 错误码 `CH_IMAGE_MISSING` + 重试按钮；重试仍失败不白屏；`list` 不受影响       |
| 8   | 图片卡点「复制」                                                                | 走 `copy` 通道回写系统剪贴板：截图工具/任意编辑器可粘贴出该图；按钮「已复制」1.5s；置顶序不因复制前移     |
| 9   | 复制 >5MB 图片（如高分辨率长图）                                                | 一次性提示「剪贴板内容过大（文本>100KB / 图片>5MB），已跳过」，不入库；后续正常剪贴板提示复位             |
| 10  | 删除单张图片条目 / 清空全部历史                                                 | `images/{id}.png` 同步删除（目录只剩仍引用的文件）；清空后 images 目录为空、计数归零                      |
| 11  | 工具页关闭期间手动往 images 目录丢一个无主 PNG，重开应用                        | 启动加载后孤儿 PNG 被清理（electron-log warn「已清理孤儿剪贴板图片 N 个」），有主文件保留                 |
| 12  | 图片条目入库后关闭重开应用（未清历史）                                          | 图片卡从磁盘恢复（JSON 持久化字段完整：type/width/height/bytes/sha1/thumb）                               |

### R2 八类映射补图片场景

| 类别        | 图片场景增补                                                                       | 验证方式 / 证据                                                                                    | 状态                           |
| ----------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1 中文/空格 | 图片文件名固定 UUID（无中文），存储路径固定名；中文文本与图片条目共存              | 单测 `node.test.ts` 图片入库/通道断言（路径不参与拼接用户输入）                                    | 单测覆盖，手工往返待人工补录   |
| 2 文件占用  | PNG 被占用时 `remove` 删除失败 → 仅 log.warn 不阻断（条目与后续流程不受影响）      | 单测 `node.test.ts`「remove 图片条目：同步删 PNG，删除失败仅 warn 不阻断」                         | 单测覆盖，手工占用实测待补录   |
| 3 加密      | 不适用（无加密输入）                                                               | —                                                                                                  | 不适用                         |
| 4 超大      | 单张图片 >5MB → `skipped TOO_LARGE` 不入库不写文件；与文本 100KB 口径并列提示      | 单测 `node.test.ts`「>5MB → TOO_LARGE」+ 5MB 边界入库；`entries.test.ts` 恰好 5MB 边界             | 单测覆盖，>5MB 真机复制待补录  |
| 5 任务取消  | 离开页面停轮询后复制图片不入库（同文本口径，图片分支同一定时器）                   | e2e 用例 3「切页停轮询」已运行通过（图片共用 `clearInterval`，同一挂载生命周期）                      | e2e 覆盖   |
| 6 并发      | 图片轮询单定时器串行；SHA-1 与头部图片去重防同图重复写文件；先写 PNG 再防抖写 JSON | 单测 `node.test.ts` SHA-1 去重（不写文件不写盘）、先写 PNG 后落盘顺序断言                          | 单测覆盖                       |
| 7 磁盘满    | PNG 同步写失败 → `withStorage` 统一包装 `CH_STORAGE_FAILED`（与文本落盘同路径）    | 单测存储写失败结构化分支（图片与文本同一 `withStorage` 包装器）                                      | 单测覆盖                       |
| 8 断电恢复  | 图片 JSON 走同原子写防半写；崩溃残留孤儿 PNG 启动加载即清理                        | 单测 `storage.test.ts` `cleanupOrphanImages`（孤儿删/引用保留/ENOENT 静默/其他错误抛出）+ 损坏重建 | 单测覆盖，断电实测待人工补录   |

### 自动化结果（2026-11-24 主会话回填，全绿）

| 项                   | 结果                                                                            | 备注                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 单测（`vitest run`） | ✅ 109/109 通过（6 文件，含 M61 新增 `schema.test.ts`）                         | `pnpm -F @lumin/tool-clipboard-history test`                                                                              |
| 覆盖率（本包 ≥80%）  | ✅ statements 99.10% / branches 95.42% / functions 100% / lines 99.28%          | 与根 `vitest.config.ts` 阈值（80%）一致，达标                                                                             |
| typecheck / eslint   | ✅ 包 `tsc --noEmit`、desktop typecheck、`eslint --max-warnings 0`、prettier 均退出码 0 | 含 `apps/desktop` vue-tsc（ToolView 模板）与 e2e tsconfig                                                          |
| e2e（新增 2 用例）   | ✅ 6/6 通过（38.1s，4 旧 + 2 新）：`M61 图片：轮询入库 → 类型筛选 → 预览原图 → copy 通道回写`、`M61 图片：PNG 文件丢失 → 预览提示 CH_IMAGE_MISSING（可重试）` | `pnpm -F @lumin/desktop test:e2e -- clipboard-history`（先 build）                                       |
| R5 chunk 增量        | ✅ 24,417 B raw / **7,226 B gzip**（M61 +1,971 B gzip，独占依赖 0）              | 仍按 gzip 口径、限 200KB gzip，达标                                                                                       |
