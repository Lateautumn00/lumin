# 压缩包工具（zip-tool）字段级功能清单

> 里程碑：M25（已登记 plan §1 Q29 / §4.25 / §6）
> 状态：**待用户确认后实施**
> 关联规范：`AGENTS.md` §2（零耦合）、§5（三态/tokens/图标）、§6（IPC 三段式）、§7（测试门禁）、§8（性能）、§10（依赖治理）

---

## 1. 目标与边界

### 1.1 目标

新增独立工具包 `zip-tool`（名称「压缩包工具」）：**ZIP 打包**与**ZIP 解压**双模式；离线、纯本机、零后端；长任务 worker 流式读写 + 进度 + 取消；三态 UI；结构化错误码。新增唯一第三方依赖 `fflate@0.8.3`（纯 JS、MIT、无原生，已于 2026-11-20 `npm view` 复核并登记 plan §1.1）。

### 1.2 做

| 能力     | 说明                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| 打包输入 | 多选源（文件或文件夹，拖拽 + 「添加文件夹」），1–200 项，去重；源不存在/不可读 → `ZP_SOURCE_INVALID`          |
| 条目结构 | 文件源 → 条目名 = 文件名；目录源 → 条目名 = `{目录名}/{相对路径}`，保留子目录结构                            |
| 条目规范 | 条目名一律 `/` 分隔（Windows `\` 归一）、UTF-8 标志；不跟随符号链接；非常规条目跳过                          |
| 同名冲突 | 同一压缩包内条目名大小写不敏感冲突 → `{base} (1){ext}` 递增（`uniqueFileName` 复用）                         |
| 产物路径 | 输出目录 + 文件名（`.zip` 必填）；目标已存在 → `{base} (1).zip` 递增；递增 99 次仍冲突 → `ZP_TARGET_INVALID` |
| 打包进度 | 两阶段：先枚举条目（含字节总数）→ 再压缩；上报 `current/total`（已完成条目）+ `message` 当前文件             |
| 解压输入 | 单个 `.zip`（拖拽），扩展名不区分大小写；非 zip/损坏 → `ZP_ARCHIVE_INVALID`                                 |
| 解压目标 | 目标目录，默认 `{压缩包所在目录}/{压缩包名去 .zip}`；目录不存在自动创建                                       |
| 路径安全 | **zip slip 防护**：拒绝绝对路径、盘符（`C:`）、UNC、任意 `..` 段；非法条目跳过并计入 `skipped`                |
| 条目类型 | 目录条目自动建目录；**符号链接条目拒绝**（跳过并计数）；不写任何指向压缩包外的路径                            |
| 容量上限 | 打包/解压条目 ≤ `MAX_ENTRIES = 100_000`（超 → `ZP_TOO_MANY_ENTRIES`）；解压累计声明大小 ≤ `MAX_UNPACK_BYTES = 10 GiB`（超 → `ZP_ARCHIVE_TOO_LARGE`） |
| 冲突策略 | `rename`（默认，`{base} (n){ext}` 递增）/ `skip`（存在即跳过并计数）；**不提供覆盖**                         |
| 结果     | 打包：输出路径 / 文件数 / 目录数 / 字节数 / 耗时；解压：目标目录 / 文件数 / 目录数 / 字节数 / 跳过 / 重命名 / 耗时 |
| 记忆     | 模式、源列表、输出目录与文件名、压缩包、目标目录、冲突策略（settings `tools.zip-tool.*`）                    |

### 1.3 不做（防范围膨胀）

- 7z / RAR / tar / gzip 单文件压缩（仅 ZIP）
- 加密压缩包（密码输入/解密）、分卷、注释、自解压
- 覆盖写入、删除源文件（打包后源文件保留）
- 压缩包内预览、增删改单条（重新打包请重新选择源）
- GBK 老 zip 文件名转码（先按 UTF-8 解析，无法解码/非法条目跳过并计数；见 §9 限制）

### 1.4 与既有工具边界

| 工具                | 边界                                                     |
| ------------------- | -------------------------------------------------------- |
| `file-hasher`       | 计算哈希；本工具不计算哈希                               |
| `duplicate-finder`  | 找重复文件；本工具仅打包/解压                             |
| `folder-compare`    | 目录元数据对比；本工具产物为 zip                          |

---

## 2. 工具清单（manifest）

```ts
{
  id: 'zip-tool',
  name: '压缩包工具',
  description: 'ZIP 打包与解压（保留目录结构、冲突自动重命名、路径穿越防护）',
  icon: 'archive',
  order: 68,
  version: '0.1.0'
}
```

设置命名空间 `tools.zip-tool.*`；壳侧需在 `AppSidebar` iconMap 注册 `archive → Archive`（`@lucide/vue` 已导出）。

---

## 3. 界面规格（单页双 Tab，三态强制）

### 3.1 打包 Tab

- 空态：拖拽区（`DropZone` multiple，accept 空）+「添加文件夹」按钮 + 引导文案「添加文件或文件夹后点击「开始打包」；目录会保留相对结构」
- 源列表：每行 `文件名/文件夹名`（`fileNameOf`）+ 移除按钮；显示 `共 N 项`；上限 200 项，超限提示
- 输出：目录（只读输入 + 选择按钮，`pickDirectory`）+ 文件名 `NInput`（默认 `{源目录名}.zip` 或 `{源文件名}.zip`）
- 开始打包：源为空 / 输出目录为空 / 文件名不以 `.zip` 结尾 → 按钮禁用
- 结果：`已生成 {zip 路径}` + `文件 X · 目录 Y · Z 字节 · 耗时 T` + 「定位产物」（`revealPath`）

### 3.2 解压 Tab

- 空态：拖拽区（`DropZone` single，accept `.zip`）+ 引导文案「拖入 .zip 压缩包或点击选择；解压不会覆盖同目录已有文件」
- 压缩包行：只读路径 + 「重新选择」
- 目标目录：只读输入 + 选择按钮；选中压缩包后若目标为空则自动填 `{父目录}/{zip 名去扩展名}`
- 冲突策略：`NSelect`「自动重命名（推荐）/ 跳过同名文件」
- 开始解压：压缩包为空 / 目标目录为空 → 按钮禁用
- 结果：`已解压到 {目标目录}` + `文件 X · 目录 Y · Z 字节 · 跳过 S · 重命名 R · 耗时 T` + 「打开目标目录」（`revealPath`）

### 3.3 加载态

- `TaskProgress`：`正在打包 · 已完成 N / M 个条目` 或 `正在解压 · 已完成 N / M 个条目` + `[取消]`
- 任务期间禁用源编辑、目录切换、Tab 切换与两个提交按钮

### 3.4 报错态

- 展示 `error.message`；`isRetryable(code)` 为真时显示 `[重试]`；`detail` 折叠展示
- 取消（`CANCELLED`）显示中性提示「已取消」，不进入报错态

---

## 4. 纯函数（`contract.ts`）

| 函数                                              | 语义                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `normalizeArchivePath(raw)`                       | `\` → `/`、合并重复分隔符、去首尾 `/` 与 `./`；空结果 / 绝对路径 / 盘符 / UNC / 含 `..` 段 → `null` |
| `entryKey(name)`                                  | 条目比较键（小写），实现 Windows 大小写不敏感去重                                             |
| `joinArchivePath(parent, name)`                   | 条目路径拼接（`/` 分隔，空段安全）                                                            |
| `isZipFileName(name)`                             | 扩展名 `.zip`（大小写不敏感）且非空                                                            |
| `defaultArchiveName(sourcePaths)`                 | 依据首个源推导默认 zip 文件名（目录/文件基名 + `.zip`）                                        |
| `defaultTargetDir(archivePath)`                   | zip 同目录同名文件夹（去 `.zip`）；无扩展名时追加 `-解压`                                     |
| `joinFsPath(dir, name)`                           | 按目录分隔符风格拼接绝对路径（renderer 展示/组装）                                             |
| `partitionSourcePaths(sources)`                   | 源列表去重（大小写不敏感）、过滤空串，保持顺序                                                 |
| `progressPercent(current, total)`                 | 百分比（0–100，total ≤ 0 → 0，溢出截断）                                                       |

`fflate` 调用与 fs 读写全部收敛在 `archive.ts`（可注入 fs 便于单测），worker 只做协议编排。

---

## 5. IPC 契约（通道 `zip-tool:{action}`）

### 5.1 schema（`packages/tools/zip-tool/src/schema.ts`）

```ts
export const CONFLICT_POLICIES = ['rename', 'skip'] as const
export const conflictPolicySchema = z.enum(CONFLICT_POLICIES)

export const packPayloadSchema = z.object({
  sources: z.array(z.string().min(1).max(32767)).min(1).max(MAX_SOURCES),
  outputDir: z.string().min(1).max(32767),
  outputName: z.string().min(1).max(255)
})

export const unpackPayloadSchema = z.object({
  archive: z.string().min(1).max(32767),
  targetDir: z.string().min(1).max(32767),
  conflict: conflictPolicySchema
})

export const packDoneSchema = z.object({
  outputZip: z.string().min(1),
  files: z.number().int().nonnegative(),
  dirs: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative()
})

export const unpackDoneSchema = z.object({
  targetDir: z.string().min(1),
  files: z.number().int().nonnegative(),
  dirs: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  renamed: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative()
})

export const configResultSchema = z.object({
  mode: z.enum(['pack', 'unpack']),
  packSources: z.array(z.string()),
  outputDir: z.string().nullable(),
  outputName: z.string().nullable(),
  archive: z.string().nullable(),
  targetDir: z.string().nullable(),
  conflict: conflictPolicySchema
})

export const setConfigPayloadSchema = z.object({
  mode: z.enum(['pack', 'unpack']),
  packSources: z.array(z.string().max(32767)).max(MAX_SOURCES),
  outputDir: z.string().max(32767).nullable(),
  outputName: z.string().max(255).nullable(),
  archive: z.string().max(32767).nullable(),
  targetDir: z.string().max(32767).nullable(),
  conflict: conflictPolicySchema
})
```

常量：`MAX_SOURCES = 200`、`MAX_ENTRIES = 100_000`、`MAX_UNPACK_BYTES = 10 * 1024 ** 3`、`PROGRESS_STEP_ENTRIES = 20`、`DEFAULT_CONFLICT = 'rename'`、`PACK_TIMEOUT_MS = 900_000`（node.ts）。

### 5.2 主进程（`node.ts`）

- `config` → 读取六项记忆（非法存量回落：`mode='pack'`、`packSources=[]`、目录 `null`、`conflict='rename'`）
- `set-config` → 校验后全量写入
- `pack` → zod 校验 → 记忆参数 → `runTask`（900s、可取消）→ `packDoneSchema.parse`
- `unpack` → 同上 → `unpackDoneSchema.parse`
- 错误映射：`TaskTimeoutError` / `TaskCrashError` → `ZP_TASK_FAILED`（detail 取尾 200 字符）；结构化错误透传
- deps 注入：`{ archiveWorkerPath, run }`，vitest 传假 worker 运行器

### 5.3 worker（`archive.worker.ts` → 委托 `archive.ts`）

- 打包：
  1. 校验每个源存在（`stat`；失败 → `ZP_SOURCE_INVALID`，detail 标源路径）
  2. 迭代栈枚举条目（目录优先精确校验条目上限，超 → `ZP_TOO_MANY_ENTRIES`），记录 `name/size/mtimeMs/absPath`；符号链接等非常规条目跳过
  3. 冲突去重：同批条目名经 `uniqueFileName` 递增
  4. 用 fflate `Zip` + `ZipDeflate(level 6)` 流式压缩；按 64KB 分块读取文件并 `push(chunk, final)`，回调分块写入 `createWriteStream`
  5. 产物冲突：`resolveConflictPath`（`@lumin/node-kit`）选可用路径，全部占用 → `ZP_TARGET_INVALID`
  6. 进度：每 `PROGRESS_STEP_ENTRIES` 个条目上报 `{ kind:'progress', current, total, stage:'pack', message: 当前条目名 }`
- 解压：
  1. 校验压缩包可读且以 `PK\x03\x04` 开头（失败 → `ZP_ARCHIVE_INVALID`）
  2. 用 fflate `Unzip` + `UnzipInflate` 流式解压；中央目录声明 `originalSize` 累计超 `MAX_UNPACK_BYTES` → `ZP_ARCHIVE_TOO_LARGE`；条目数超上限 → `ZP_TOO_MANY_ENTRIES`
  3. 每个条目先 `normalizeArchivePath`；`null` / 符号链接 / 绝对路径 → 跳过并 `skipped += 1`
  4. 目录条目（尾部 `/`）建目录；文件条目按 `conflict` 策略选最终路径（`rename`：`uniqueFileName` 基于同批已占用集合 + 磁盘 `existsSync`；`skip`：存在则跳过）
  5. 分块 `writeSync` 落盘；写入失败（`EACCES`/`ENOSPC` 等）→ `ZP_TARGET_INVALID`（detail 含 errno 与条目名）
  6. 进度：每 `PROGRESS_STEP_ENTRIES` 个条目上报 `{ kind:'progress', current, total, stage:'unpack', message: 当前条目名 }`

---

## 6. 错误码表（`packages/tools/zip-tool/src/errors.ts`）

| 码                      | 文案                                          | 可重试 |
| ----------------------- | --------------------------------------------- | ------ |
| `ZP_INVALID_PAYLOAD`    | 参数无效                                      | 否     |
| `ZP_SOURCE_INVALID`     | 无法读取源文件或文件夹（不存在或无权限）      | 是     |
| `ZP_ARCHIVE_INVALID`    | 压缩包无法读取或已损坏                        | 是     |
| `ZP_TARGET_INVALID`     | 无法写入目标位置（不存在、无权限或磁盘空间不足） | 是     |
| `ZP_TOO_MANY_ENTRIES`   | 条目数超过 10 万个上限，请拆分后再试          | 否     |
| `ZP_ARCHIVE_TOO_LARGE`  | 解压后总大小超过 10GB 上限（疑似压缩炸弹）    | 否     |
| `ZP_TASK_FAILED`        | 任务失败（超时或异常中断）                    | 是     |
| `CANCELLED`             | 已取消（壳统一）                              | 否     |

---

## 7. 工程接线

- 工具包：`packages/tools/zip-tool`（`manifest.ts` + `renderer/` + `node.ts` + `archive.worker.ts` + `archive.ts`）
- 依赖：`fflate@0.8.3`（仅本包 `dependencies`；已登记 plan §1.1）
- 壳注册五处：`tool-manifests.ts`、`main/tool-mains.ts`、`AppSidebar.vue` iconMap（`archive`）、`apps/desktop/package.json` devDeps、`electron.vite.config.ts` 三条别名
- 页面薄壳：`apps/desktop/src/renderer/src/tools/zip-tool.vue`
- 覆盖率阈值：`vitest.config.ts` 新增 `packages/tools/zip-tool/src/**/*.ts` 80%
- lockfile：`pnpm install --config.frozen-lockfile=false`

---

## 8. 性能与规范符合

- 工具页懒加载分包；工具 chunk + fflate 独占依赖 < 200KB gzip（fflate ≈30KB gzip）
- 打包/解压均流式（64KB 分块），不将整个压缩包读入内存；条目元数据仅保留路径与大小
- 10 万条目 + 10GB 解压上限防资源耗尽；同名冲突不覆盖，杜绝数据丢失
- 图标只用 `@lucide/vue`；样式只走 Tailwind + tokens；无 `any`

---

## 9. 已知限制

- 仅 UTF-8 文件名的 zip：GBK 编码条目可能乱码或解码失败，失败条目跳过并计入 `skipped`（不做转码）
- 不解析加密 zip：加密条目解压失败 → `ZP_ARCHIVE_INVALID`
- 不保留空目录以外的权限/ACL/所有者/时间戳（时间戳仅写入条目 mtime）

---

## 10. 验收标准

1. 打包目录保留完整相对结构；多源同名条目自动 `(1)` 递增
2. 产物同名不覆盖，冲突递增；99 次冲突后报 `ZP_TARGET_INVALID`
3. 解压后文件内容与源一致（e2e 回读断言）
4. zip slip 条目（`../evil`、绝对路径、盘符）零落盘，计入 `skipped`
5. 同目标重复解压：`rename` 策略生成 `(1)` 副本并计数；`skip` 策略跳过并计数
6. 非法 zip → `ZP_ARCHIVE_INVALID`；源不存在 → `ZP_SOURCE_INVALID`
7. 取消后无残留任务与半成品残留（解压半成品保留已写条目，不做回滚，UI 明确提示）
8. 单测覆盖 contract / schema / errors / node / archive / client；本包 ≥80%
9. e2e 2/2；`pnpm gate` 全绿

---

## 11. 风险与回滚

- 风险：超大目录打包耗时 → 条目上限 + 进度可见 + 可取消
- 风险：解压半途失败留下部分文件 → 结果/报错明确目标目录，用户可自行清理；不实现回滚（范围控制）
- 风险：压缩炸弹 → 声明大小累计上限 + 条目上限
- 回滚：删除工具包与壳注册 5 处 + 还原 lockfile 即可，无数据迁移

---

## 12. 审批

- [ ] 用户确认功能方向（2026-11-20，选定「压缩包工具（ZIP 打包/解压）」）
- [x] plan 决策总表 Q29 / §4.25 / 里程碑 M25 登记
- [x] 字段级清单（本文）先行

---

## M55 追加节（2026-11-22 R8 登记：plan Q56 / §4.55）

> 状态：待实施。原 spec 冻结项「GBK 条目名转码」解冻（Q56 拍板，替代低价值的 text-diff 词级高亮）；7z/RAR/加密/分卷维持冻结。

- **背景**：Windows 老工具（WinRAR 中文版/7-Zip 旧版/资源管理器 zip）打包的 ZIP 常用本地代码页（GBK/CP936）存条目名且不置通用标志位 bit11（EFS），fflate 按 UTF-8 解码产生 U+FFFD 乱码
- **字段级清单（解压条目名转码）**
  1. 解压时逐条目：通用标志位 bit11 未置位 **且** 解码名含 U+FFFD → 用 `TextDecoder('gbk')` 对原始名字节重解码（Node 24 full-icu 原生，零依赖）
  2. 转码后仍含 U+FFFD（真乱码/非 GBK）→ 维持既有「跳过计数 + 汇总提示」行为，不误改
  3. 打包侧零改动（仍写 UTF-8 名 + bit11 置位）；已有 UTF-8 条目零回归
  4. 无新错误码；进度/取消/冲突递增语义不变
- **实现触点**：`archive.ts` 流式 `Unzip` 段（L514–586）。**开工首日 spike：fflate `Unzip` 元数据是否保留原始名字节**；不保留则自解析中央目录取名字节（+0.5d，预算内）
- **验收**：构造 GBK zip fixture（`strToU8` 无法直接产出，用 Buffer 拼本地头/中央目录）单测（bit11 置位不转码 / 未置位含 U+FFFD 转码 / 非 GBK 乱码维持跳过 / UTF-8 中文名零回归）本包 ≥80%；e2e 新增「GBK 中文名 zip 解压 → 条目名无乱码且落盘正确」用例；R2 记入 `docs/smoke/zip-tool.md` M55 增量节（中文/空格路径类）；chunk 不变、零新增依赖
