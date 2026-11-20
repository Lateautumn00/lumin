# 磁盘空间分析（disk-analyzer）字段级功能清单

> 里程碑：M23（已登记 plan §1 Q27 / §4.23 / §6）
> 状态：**已批准并于 2026-11-20 实施**（冒烟见 `docs/smoke/disk-analyzer.md`）
> 关联规范：`AGENTS.md` §2（零耦合）、§5（三态/tokens/图标）、§6（IPC 三段式）、§7（测试门禁）、§8（性能）

---

## 1. 目标与边界

### 1.1 目标

新增独立工具包 `disk-analyzer`（名称「磁盘空间分析」）：选择一个目录后**递归扫描**，按**直接子项**展示空间占用（子目录含全部后代汇总、文件为单项），大小降序 + 占比条，支持**逐级下钻**与面包屑返回；长任务进度 + 取消；三态 UI。全程离线、**只读**，零新增第三方依赖。

### 1.2 做

| 能力     | 说明                                                                                       |
| -------- | ------------------------------------------------------------------------------------------ |
| 输入     | 目录选择器（取消保持原值）；目录可含子目录                                                  |
| 扫描     | 迭代栈遍历；不跟随符号链接；单文件 stat 失败计入 `skipped` 不中断                            |
| 聚合     | 每个直接子目录递归汇总大小与文件数；直接文件为单项                                           |
| 排序     | 大小降序；同大小目录优先、再按名称升序                                                       |
| 占比     | `size / 当前层总大小 × 100`，保留 1 位小数；0 总大小安全返回 0                               |
| 下钻     | 点击目录行 → 以该目录为 root 重新发起扫描；面包屑逐级返回                                    |
| 阈值     | 最小文件大小 0 / 1KB / 100KB / 1MB（默认 0）：仅过滤文件行，目录行始终展示                    |
| 折叠     | 单层最多展示前 100 项，其余折叠为「其余 N 项 · 共 X」                                        |
| 汇总     | 当前层总大小、文件总数、目录总数、跳过数、耗时                                               |
| 进度     | worker 按文件计数节流上报（每 200 个文件）；取消 terminate                                   |
| 记忆     | 上次目录与阈值（settings `lastRoot` / `minFileBytes`）                                       |

### 1.3 不做（防范围膨胀）

- 删除 / 清理 / 移动 / 回收站操作（只读分析）
- 磁盘分区/容量图、Treemap 可视化、文件类型统计
- 多根目录并行扫描、定时扫描、增量缓存
- 文件内容哈希或重复文件识别（`duplicate-finder` 范围）

### 1.4 与既有工具边界

| 工具                | 边界                                                     |
| ------------------- | -------------------------------------------------------- |
| `duplicate-finder`  | 找内容重复并移入回收站；本工具只看占用，不判内容、不删改 |
| `file-hasher`       | 计算文件哈希；本工具不读文件内容                         |

---

## 2. 工具清单（manifest）

```ts
{
  id: 'disk-analyzer',
  name: '磁盘空间分析',
  description: '扫描目录查看各子项占用大小，按大小排序并逐级下钻（只读，不改文件）',
  icon: 'hard-drive',
  order: 66,
  version: '0.1.0'
}
```

设置命名空间 `tools.disk-analyzer.*`；壳侧需在 `AppSidebar` iconMap 注册 `hard-drive → HardDrive`。

---

## 3. 界面规格（单页，三态强制）

### 3.1 空态

- 目录只读输入框 + 「选择目录」
- 引导文案「先选择要分析的目录，再点击「开始扫描」」；未选目录时「开始扫描」禁用

### 3.2 输入区

- 目录行：`NInput`（只读）+「选择目录」
- 阈值：`NSelect`（0 / 1 KB / 100 KB / 1 MB）
- 操作：`[开始扫描]`；扫描中禁用目录与阈值

### 3.3 加载态

- `TaskProgress`：`正在扫描目录 · 已检查 N 个文件` + `[取消]`

### 3.4 报错态

- `NAlert`/错误行展示 `error.message` + `code · detail`
- `isRetryable(code)` 为真时显示 `[重试]`；始终可重新选择目录

### 3.5 结果态

- 汇总行：`共 X · Y 个文件 · Z 个目录（跳过 S）· 耗时 T`
- 面包屑：`根目录名 / 子目录 / …`，每段可点击回到该层
- 列表行：类型图标 + 名称（目录显示文件数）+ 大小 + 占比条 + 百分比
- 目录行点击下钻；文件行「定位」调 `window.lumin.revealPath`
- 折叠提示：「其余 N 项 · 共 X」+ 「单层仅展示最大 100 项」

---

## 4. 纯函数（`contract.ts`）

| 函数                                  | 语义                                                             |
| ------------------------------------- | ---------------------------------------------------------------- |
| `percentOf(size, total)`              | 百分比（0–100，保留 1 位小数；`total <= 0` 返回 0）               |
| `sortEntries(entries)`                | 大小降序 → 目录优先 → 名称升序（不改原数组）                      |
| `summarize(entries)`                  | `{ totalBytes, fileCount, dirCount }`（直接子项口径）             |
| `filterEntries(entries, minBytes)`    | 过滤 `kind === 'file' && size < minBytes`；目录始终保留           |
| `limitEntries(entries, limit)`        | 截取前 N 项并返回 `{ shown, hiddenCount, hiddenBytes }`           |
| `breadcrumbParts(root, current)`      | 根 → 当前的相对段名数组；`current` 不在 `root` 下时返回 `[]`       |
| `isInside(root, target)`              | 路径前缀判断（大小写不敏感，分隔符统一，防 `C:\ab` 误判 `C:\a`）  |

---

## 5. IPC 契约（通道 `disk-analyzer:{action}`）

### 5.1 schema（`packages/tools/disk-analyzer/src/schema.ts`）

```ts
const scanPayloadSchema = z.object({
  root: z.string().min(1).max(32767),
  minFileBytes: z.number().int().min(0).max(1024 ** 4)
})

const diskEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['dir', 'file']),
  size: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative()
})

const scanDoneSchema = z.object({
  root: z.string().min(1),
  entries: z.array(diskEntrySchema),
  totalBytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  dirCount: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative()
})
```

### 5.2 主进程（`node.ts`）

- `config` → `{ root: string | null, minFileBytes }`（非法存量回落 `null` / 0）
- `set-config` → 记忆目录与阈值（`root` 省略时保留上次）
- `scan` → zod 校验 → 记忆本次参数 → `runTask`（900s、可取消）
- 错误映射：超时 / 崩溃 → `DA_SCAN_FAILED`；结构化错误透传

### 5.3 worker（`scan.worker.ts`）

- 迭代栈遍历 root：每个直接子项单独累计；子目录递归汇总 `size`/`fileCount`
- 根目录 `readdir` 失败 → `DA_ROOT_INVALID`；子目录失败计入 `skipped`
- 普通文件计数超过 200,000 → `DA_TOO_MANY_FILES`
- 每 200 个文件上报 `progress { kind: 'progress', current, stage: 'scan' }`
- done：排序后的 `entries` + 汇总 + `skipped` + `elapsedMs`

---

## 6. 错误码表（`packages/tools/disk-analyzer/src/errors.ts`）

| 码                     | 文案                                  | 可重试 |
| ---------------------- | ------------------------------------- | ------ |
| `DA_INVALID_PAYLOAD`   | 参数无效                              | 否     |
| `DA_ROOT_INVALID`      | 无法读取扫描目录（不存在或无权限）    | 是     |
| `DA_TOO_MANY_FILES`    | 目录文件超过 20 万个，请缩小扫描范围  | 否     |
| `DA_SCAN_FAILED`       | 扫描失败（任务超时或异常中断）        | 是     |
| `CANCELLED`            | 已取消（壳统一）                      | 否     |

---

## 7. 工程接线

- 工具包：`packages/tools/disk-analyzer`（`manifest.ts` + `renderer/` + `node.ts` + `scan.worker.ts`）
- 壳注册五处：`tool-manifests.ts`、`main/tool-mains.ts`、`AppSidebar.vue` iconMap、`apps/desktop/package.json` devDeps、`electron.vite.config.ts` 别名
- 页面薄壳：`apps/desktop/src/renderer/src/tools/disk-analyzer.vue`
- 覆盖率阈值：`vitest.config.ts` 新增 `packages/tools/disk-analyzer/src/**/*.ts` 80%

---

## 8. 性能与规范符合

- 工具页懒加载分包；chunk + 独占依赖 <200KB gzip（本工具零独占依赖）
- worker 内单次只保留条目与计数，不缓存文件内容；20 万文件上限防内存爆炸
- 扫描 10 万文件应控制在秒级（同机 I/O 相关）；超时上限 900s
- 图标只用 `@lucide/vue`；样式只走 Tailwind + tokens；无 `any`

---

## 9. 验收标准

1. 子目录递归汇总大小与文件数正确；排序口径与 `sortEntries` 一致
2. 中文 + 空格路径可正常扫描；不下钻符号链接
3. 阈值仅过滤文件行，目录行与汇总不变
4. 根目录不存在 → `DA_ROOT_INVALID`；21 万文件 → `DA_TOO_MANY_FILES`
5. 取消后无残留任务；UI 恢复空闲
6. 下钻与面包屑返回的 root 正确
7. 单测覆盖 contract / schema / errors / node / worker / client；本包 ≥80%
8. e2e 2/2；`pnpm gate` 全绿

---

## 10. 风险与回滚

- 风险：超大目录扫描耗时 → 20 万文件上限 + 进度可见 + 可取消
- 风险：无权限子目录 → 计入 `skipped`，不中断整体扫描
- 回滚：删除工具包与壳注册 5 处即可，无数据迁移、无文件改动风险

---

## 11. 审批

- [x] 用户确认功能方向（2026-11-20，AskUserQuestion「磁盘空间分析（推荐）」）
- [x] plan 决策总表 Q27 / §4.23 / 里程碑 M23 登记
- [x] 字段级清单（本文）先行
- [ ] 实施完成（代码 + 单测 + e2e + 冒烟文档）
