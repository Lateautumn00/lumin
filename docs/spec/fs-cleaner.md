# fs-cleaner 文件清理 · 字段级功能清单（M41）

> 依据：`.trae/documents/Lumin 功能清单差距审计与后续路线图.md` §5 M41（D3/D4/D5/D6）。
> 规范：`AGENTS.md` §2/§5/§6/§7/§8；零新增第三方依赖。
> 本文为该里程碑**验收附件**，文案与错误码改动必须同步本文件（R8）。

---

## 1. 工具定位

| 项 | 值 |
| --- | --- |
| 工具 id | `fs-cleaner` |
| 名称 | 文件清理 |
| 分类 | `file` |
| 图标 | `folder-cog`（壳 `AppSidebar.iconMap` 补注册 `FolderCog`） |
| 排序 | `order: 66` |
| 形态 | 单一工具包四页签，`packages/tools/fs-cleaner`（`manifest.ts` + `renderer/` + `node.ts`） |
| 主进程 | `node.ts` 直用 `node:fs/promises`（无外部进程、无 worker） |
| 渲染层 | Vue 3 + Naive UI + Tailwind，纯前端，chunk 远低于 200KB gzip |

**安全总则**

1. 所有删除动作只走壳 bridge `window.lumin.trashPaths(paths)`（Windows 回收站），**禁止 `fs.rm`/`unlink` 删除用户文件**。
2. 扫描类任务只产候选列表，**用户勾选并二次确认后**才回收；禁止静默删除。
3. 回收调用渲染层分批，单批 ≤ 200 条；失败项逐条回显，不中断剩余批次。
4. 不跟随符号链接（`dirent.isSymbolicLink()` 一律跳过）；根目录不可读报 `FC_ROOT_INVALID`。
5. 写盘一律 `.tmp` + rename（`@lumin/node-kit` `writeAtomic`）——本工具仅 D3 需要写盘，且默认不写盘。

---

## 2. 页签一：目录树导出（D3）

**输入项**

| 字段 | 控件 | 约束 | 默认 |
| --- | --- | --- | --- |
| 根目录 | 输入框（只读）+ [选择目录] | 绝对路径，可读目录 | 上次记忆 |
| 最大深度 | 数字输入 1–10 | 整数 | 3 |
| 排除规则 | 文本域，一行一条（也接受逗号/分号分隔） | ≤ 50 条，每条 ≤ 100 字符；支持 `*` 通配（如 `node_modules`、`*.log`），大小写不敏感 | 空 |

**按钮集**

- [选择目录]：打开系统目录选择框；取消保持原值。
- [生成目录树]：提交 `tree` 任务；生成中按钮禁用、显示进度与 [取消]。
- [复制]：把结果文本写入剪贴板（`navigator.clipboard.writeText`），成功提示「已复制到剪贴板」。
- [重新生成]：清空结果后重新提交。

**输出**：等宽只读 `<pre>` 树文本（Box-drawing 字符 `├── / └── / │  `），顶部摘要「N 个目录 · M 个文件 · 耗时 x.xs」，超上限时摘要追加「已截断」。

**错误分支**

- 根目录为空 → [生成目录树] 禁用。
- `FC_ROOT_INVALID`：中文文案 + [重试]。
- `FC_TOO_MANY_FILES`：文案提示缩小范围/降低深度。
- 复制失败 → 提示「复制失败，请手动选择文本复制」（不抛错误态）。

---

## 3. 页签二：空文件夹清理（D4）

**输入项**

| 字段 | 控件 | 约束 | 默认 |
| --- | --- | --- | --- |
| 根目录 | 输入框 + [选择目录] | 同上 | 上次记忆 |

**按钮集**

- [扫描空文件夹]：提交 `empty-dirs` 任务；显示进度 + [取消]。
- [全选] / [全不选]：结果列表勾选切换。
- [移入回收站]（危险色 + `NPopconfirm` 二次确认）：分批 `trashPaths`，深度优先（先子后父）。
- [重新扫描]：清空后重跑。

**判定规则**：自底向上遍历；目录内无任何条目，或所有子条目均为「本轮判定为空且已列入回收」的子目录，则该目录判为空。列表按路径深度降序（深层在前）。

**输出**：列表（目录路径 + 深度标识 + 勾选框），摘要「N 个空文件夹」；空结果提示「未发现空文件夹」。

**错误分支**：`FC_ROOT_INVALID` / `FC_TOO_MANY_FILES` / 回收失败按条回显 `{path, message}`。

---

## 4. 页签三：批量改文件时间（D5）

**输入项**

| 字段 | 控件 | 约束 | 默认 |
| --- | --- | --- | --- |
| 根目录 | 输入框 + [选择目录] | 同上 | 上次记忆 |
| 包含子目录 | 开关 | — | 开 |
| 扩展名过滤 | 输入框 | 逗号分隔，可带点可不带；空 = 全部文件 | 空 |
| 修改时间 | 日期时间选择 | `YYYY-MM-DD HH:mm` | 当前时间 |

**说明（必须明示）**：Windows 的「创建时间」Node 无原生 API，**本页只设置修改时间（mtime）与访问时间（atime），不改创建时间**；页内以 `NText depth=3` 常驻一行说明，不引入依赖。

**按钮集**

- [预演]：提交 `touch` 任务但 `dryRun=true`，只统计命中文件数与样例前 20 条。
- [应用]（主色 + 二次确认）：`dryRun=false`，逐文件 `fs.utimes`；显示进度 + [取消]。
- [取消]：终止任务（已完成的文件不回滚，结果中如实计为已更新）。

**输出**：预演摘要「将修改 N 个文件的修改时间」+ 样例列表；应用结果「已更新 N 个 · 失败 M 个」+ 失败明细（`FC_TOUCH_FAILED` + errno）。

**错误分支**：`FC_ROOT_INVALID` / `FC_TOO_MANY_FILES` / 单文件失败不中断（计入失败列表）。

---

## 5. 页签四：临时文件清理（D6）

**输入项**

| 字段 | 控件 | 约束 | 默认 |
| --- | --- | --- | --- |
| 根目录 | 输入框 + [选择目录] | 同上 | 上次记忆 |
| 扩展名规则 | 输入框 | 逗号分隔；默认 `tmp,temp,log,bak,old,cache` | 见左 |
| 包含子目录 | 开关 | — | 开 |

**按钮集**

- [扫描匹配文件]：提交 `temp-clean` 任务（只扫不删）；显示进度 + [取消]。
- [全选] / [全不选] / [仅选 7 天前]（按 mtime 过滤）
- [移入回收站]（危险色 + 二次确认，分批 ≤200）：回收成功后从列表剔除。
- [重新扫描]

**输出**：列表（文件名 + 完整路径 + 大小 + 修改时间 + 勾选），摘要「N 个文件 · 合计 X」。

**错误分支**：`FC_ROOT_INVALID` / `FC_TOO_MANY_FILES` / 回收失败逐条回显。

---

## 6. IPC 契约（通道 `fs-cleaner:{action}`）

| 通道 | 类型 | 入参 | 出参 |
| --- | --- | --- | --- |
| `fs-cleaner:config` | sync | `{}` | `ConfigResult` |
| `fs-cleaner:set-config` | sync | `SetConfigPayload`（部分字段） | `ConfigResult` |
| `fs-cleaner:tree` | task | `TreePayload` | `TreeResult` |
| `fs-cleaner:empty-dirs` | task | `EmptyDirsPayload` | `EmptyDirsResult` |
| `fs-cleaner:touch` | task | `TouchPayload` | `TouchResult` |
| `fs-cleaner:temp-clean` | task | `TempCleanPayload` | `TempCleanResult` |

**schema（zod，全部在 `src/schema.ts`）**

```
MAX_SCAN_FILES = 200_000
DEFAULT_TREE_DEPTH = 3，MIN_TREE_DEPTH = 1，MAX_TREE_DEPTH = 10
DEFAULT_TEMP_EXTENSIONS = ['tmp','temp','log','bak','old','cache']

configResultSchema   = { lastRoot: string|null, treeDepth: int 1..10, treeExclude: string[], tempExtensions: string[] }
setConfigPayloadSchema = { lastRoot?: string(max 32767), treeDepth: int 1..10, treeExclude: string[] (max 50, item max 100), tempExtensions: string[] (max 50, item max 32) }

treePayloadSchema    = { root: string(1..32767), maxDepth: int 1..10, exclude: string[] (max 50, item max 100) }
treeResultSchema     = { text: string, dirs: int>=0, files: int>=0, truncated: boolean, elapsedMs: number>=0 }

emptyDirsPayloadSchema = { root }
emptyDirsResultSchema  = { dirs: string[], scannedDirs: int>=0, elapsedMs }

touchPayloadSchema   = { root, recursive: boolean, extensions: string[] (max 50, item max 32), mtimeMs: int 0..4102444800000, dryRun: boolean }
touchResultSchema    = { updated: int>=0, total: int>=0, sample: string[] (max 20), failures: {path,code,message}[], elapsedMs }

tempCleanPayloadSchema = { root, recursive: boolean, extensions: string[] (min 1, max 50) }
tempCleanResultSchema  = { files: {path,size,mtimeMs}[], matchedBytes: int>=0, scannedFiles: int>=0, skipped: int>=0, elapsedMs }
```

**settings 键**（命名空间 `tools.fs-cleaner.*`）：`lastRoot` / `treeDepth` / `treeExclude` / `tempExtensions`；非法存量读回归一为默认值。

---

## 7. 错误码（`src/errors.ts`，UPPER_SNAKE + 中文文案）

| 码 | 文案 | 可重试 |
| --- | --- | --- |
| `FC_INVALID_PAYLOAD` | 参数无效 | 否 |
| `FC_ROOT_INVALID` | 无法读取目录（不存在、不是目录或无权限） | 是 |
| `FC_TOO_MANY_FILES` | 目录文件超过 20 万个，请缩小范围 | 是 |
| `FC_TASK_FAILED` | 操作失败（任务异常中断） | 是 |
| `FC_TOUCH_FAILED` | 修改时间失败 | 是 |

取消统一由壳返回 `CANCELLED`（renderer 文案「已取消」）。

---

## 8. 三态强制（R4）

| 状态 | 目录树导出 | 空文件夹清理 | 批量改时间 | 临时文件清理 |
| --- | --- | --- | --- | --- |
| 空态 | 未选目录时引导「选择目录后生成」 | 引导 + [扫描空文件夹] | 引导 + 说明创建时间不支持 | 引导 + 默认扩展名提示 |
| 加载态 | 进度 + [取消] | 进度 + [取消] | 进度 + [取消] | 进度 + [取消] |
| 报错态 | 错误码 → 中文 + [重试]/详情 | 同左 | 同左 | 同左 |

四个页签共享错误/进度展示组件（`renderer/TaskState.vue` 内部复用同包 `@lumin/ui` 的 `TaskProgress.vue`）。

---

## 9. 性能与体积

- 递归一律迭代栈（防爆栈）；文件/目录计数超 `MAX_SCAN_FILES` 抛 `FC_TOO_MANY_FILES`。
- 进度节流：每 200 个条目推送一次 `progress`。
- chunk 口径：工具 renderer chunk（含四页签代码）gzip < 200KB；实测值写入 `docs/smoke/fs-cleaner.md`。
- 无运行时资产文件。

---

## 10. 验收断言（可复现）

1. 目录树：3 层样例目录 + 排除 `node_modules`，输出不含该目录且层级符号正确；深度 1 只列一层。
2. 空文件夹：`a/b/c` 全空时列表含 `a/b/c`、`a/b`、`a`（深层在前）且总数为 3；含一个文件的目录不入选。
3. 批量改时间：预演 `dryRun` 不改盘（用 stat 前后断言）；应用后目标文件 mtime 等于设定值。
4. 临时清理：默认扩展名规则命中 `.log/.tmp`，不命中 `.txt`；回收后列表剔除成功项。
5. 安全：所有删除路径均来自 `window.lumin.trashPaths`，源码中不存在 `rm(`/`unlink(` 调用。
6. 取消：长任务运行中点 [取消] → 状态回 idle + 提示「已取消」。
7. 门禁：`pnpm coverage`（工具包纯函数 ≥80%，全仓 ≥60%）、`pnpm --filter @lumin/desktop build`、`pnpm gate` 全绿。
