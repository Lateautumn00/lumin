# 文件扫描（file-scanner）字段级功能清单

> 里程碑：M71（2026-11-25 R8 登记，plan Q72 / §4.71）· 工具 id：`file-scanner` · 包：`@lumin/tool-file-scanner`
> 来源：原 `file-hasher`（M13）/ `duplicate-finder`（M18）/ `folder-compare`（M24）三工具**整包合并**为单入口三页签
> 依据：`AGENTS.md` §2/§5/§6/§7/§8；`docs/opencode/plan.md` Q72 / §4.71

## 1. 范围与边界

**做**：一个侧边栏入口「文件扫描」，内含三个页签：

| 页签     | 原工具           | 能力                                                                                                               |
| -------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| 文件校验 | file-hasher      | 批量计算 MD5 / SHA-1 / SHA-256 / SHA-512（可多选），结果表 + 复制 TSV + 期望哈希比对                               |
| 重复文件 | duplicate-finder | 单目录扫描（可含子目录）+ 最小大小阈值 → 大小分组 + 两段 SHA-256 → 重复组；默认保留每组最早一份；定位 / 移入回收站 |
| 目录对比 | folder-compare   | 左右目录按相对路径配对，比较大小 / 修改时间（容差 2s），可选内容哈希；四类分类 + 筛选 + 定位；**只读**             |

**不做**：跨页签组合自动化（例如「对比后自动去重」）、跨工具 import、目录同步/写入、永久删除、逐字节差异定位、i18n（工具页中文直写）。

## 2. 页面规格（单页 + NTabs 三页签，三态强制）

- 父视图：标题「文件扫描」+ 说明 + `NTabs`（`display-directive="show"`，切换页签保留状态，不中断在跑任务）。
- 三页签各自实现空态 / 加载态（进度 + 取消）/ 报错态（结构化错误码 → 中文文案 + 重试/详情）。

### 2.1 文件校验页签

| 区域 | 控件                                                           | 行为                                                                                                                   | 空/默认               |
| ---- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 输入 | 拖拽区 + [选择文件]                                            | `@lumin/ui` DropZone 多选；`getPathForFile` 取绝对路径                                                                 | 空态引导              |
| 输入 | 已选列表                                                       | 文件名 + 大小 + 移除；超 200 个 / 单文件 >20GB 忽略并提示                                                              | 0 项隐藏              |
| 输入 | [清空]                                                         | 清空已选、结果与提示                                                                                                   | 执行中禁用            |
| 算法 | MD5 / SHA-1 / SHA-256 / SHA-512 复选                           | 默认仅 SHA-256；全不选禁用 [开始校验]                                                                                  | 读取 `hash-config`    |
| 操作 | [开始校验] / [取消] / [重试失败项（N）]                        | `hash` 任务；同时记忆算法                                                                                              | 执行中禁用/仅显示取消 |
| 进度 | 阶段（准备/计算）+ 已处理/总字节 + 当前文件名                  | `prepare` 按文件数、`hash` 按字节                                                                                      | 执行中显示            |
| 结果 | 文件名/大小/修改时间/算法列/状态/[复制本行]；摘要 + [复制全部] | TSV 含表头；列序 = 已选算法序                                                                                          | 无结果隐藏            |
| 比对 | 期望哈希输入                                                   | 支持 `md5:`/`sha1:`/`sha256:`/`sha512:`（含 `sha-1:` 等）前缀，或无前缀按 32/40/64/128 长度识别；大小写/空白/`0x` 归一 | 非法红字提示          |

### 2.2 重复文件页签

| 项           | 控件                  | 取值 / 校验                        | 默认     |
| ------------ | --------------------- | ---------------------------------- | -------- |
| 扫描目录     | 只读输入 + [选择目录] | 空时 [开始扫描] 禁用；记住上次目录 | 上次目录 |
| 包含子目录   | 复选框                | 开 / 关                            | 开       |
| 最小文件大小 | 下拉                  | 1KB / 100KB / 1MB / 10MB           | 1MB      |

按钮集：[开始扫描] / [取消] / [定位] / [全选] / [全不选] / [保留每组最早一份] / [移入回收站（n）]（`NPopconfirm` 二次确认 → `window.lumin.trashPaths`）/ [重试]。

清理语义：仅经壳通用通道 `lumin:shell:trash` 进系统回收站；单批 ≤200 路径；成功项从前端结果移除，组内剩余 <2 项整组移除并重算 `wastedBytes`。

### 2.3 目录对比页签

| 能力     | 说明                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| 输入     | 左右各一目录选择器（取消保持原值）+ 一键交换                                                                      |
| 比较     | 大小；修改时间差 > 2s（`MTIME_TOLERANCE_MS`）视为不同，可关闭                                                     |
| 内容比较 | 可选（默认关）：两侧均存在且大小相同的配对做 64KB SHA-256 预筛 → 全量；不同 → 归入 `different` + `contentChanged` |
| 分类     | `only-left` / `only-right` / `different` / `same`                                                                 |
| 汇总     | 四类计数 + 左右文件数 + 跳过数 + 耗时；`共 X 条 · 展示 Y 条`                                                      |
| 筛选     | 状态（全部 / 仅差异 / 仅左侧 / 仅右侧 / 相同）+ 相对路径关键字                                                    |
| 折叠     | 单页最多 500 条；worker 结果上限 20,000 条（超出计 `truncated`）                                                  |
| 定位     | 行内左/右「定位」→ `window.lumin.revealPath`（根目录 + 相对路径）                                                 |

## 3. IPC 契约（统一前缀 `file-scanner:{action}`）

| 通道                              | 类型 | 入参                                                       | 出参                                                                                    |
| --------------------------------- | ---- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `file-scanner:hash`               | task | `{ paths: string[1..200], algorithms: Algorithm[1..4] }`   | `{ taskId }`；进度 `{stage:'prepare'\|'hash', current, total, message?}`                |
| `file-scanner:hash-config`        | sync | `{}`                                                       | `{ algorithms: Algorithm[] }`（缺省 `['sha256']`）                                      |
| `file-scanner:hash-set-config`    | sync | `{ algorithms: Algorithm[1..4] }`                          | 同上                                                                                    |
| `file-scanner:dup-scan`           | task | `{ root, recursive, minBytes }`                            | `{ taskId }`；进度 `{stage:'scan'\|'partial'\|'full', …}`                               |
| `file-scanner:dup-config`         | sync | `{}`                                                       | `{ root: string \| null, recursive, minBytes }`                                         |
| `file-scanner:dup-set-config`     | sync | `{ root?: string, recursive, minBytes }`（`root:''` 清空） | 同上                                                                                    |
| `file-scanner:compare`            | task | `{ leftRoot, rightRoot, compareMtime, compareContent }`    | `{ taskId }`；进度 `{stage:'left'\|'right'\|'content', …}`                              |
| `file-scanner:compare-config`     | sync | `{}`                                                       | `{ leftRoot: string \| null, rightRoot: string \| null, compareMtime, compareContent }` |
| `file-scanner:compare-set-config` | sync | `{ leftRoot?, rightRoot?, compareMtime, compareContent }`  | 同上                                                                                    |

结果形状（zod 定义于各页签 `schema.ts`，值限制常量不变）：

```ts
// hash done
{ results: { path, size, mtimeMs, hashes: {md5?,sha1?,sha256?,sha512?}, status:'ok'|'failed', code?, message? }[], failedCount, totalBytes, elapsedMs }

// dup-scan done
{ groups: { size, hash, files:{path,size,mtimeMs}[], wastedBytes }[], scannedFiles, skipped, totalWastedBytes, elapsedMs }

// compare done
{ leftRoot, rightRoot, entries: CompareEntry[], onlyLeft, onlyRight, different, same,
  leftFiles, rightFiles, skipped, truncated, compareMtime, compareContent, contentDifferent, elapsedMs }
```

常量：`MAX_FILES=200`、`MAX_FILE_BYTES=20GB`、`HASH_TIMEOUT_MS=1_800_000`；`MAX_SCAN_FILES=200_000`、`PARTIAL_BYTES=65_536`、`SCAN_TIMEOUT_MS=900_000`；`MTIME_TOLERANCE_MS=2_000`、`MAX_FILES_PER_SIDE=200_000`、`MAX_RESULT_ENTRIES=20_000`、`MAX_VISIBLE_ENTRIES=500`、`COMPARE_TIMEOUT_MS=900_000`。

三个 task 均走 `?modulePath` + `runTask/exposeTask` worker 三段式（invoke → progress/log/done/error → cancel），取消由壳 `terminate`，终态 `CANCELLED`。

## 4. 错误码

原三套前缀**保留不变**（降低回归风险，页面按页签展示各自文案）：

| 页签 | 码                   | 文案                                                   | 可重试 |
| ---- | -------------------- | ------------------------------------------------------ | ------ |
| 校验 | `FH_FILE_INVALID`    | 无法读取文件（不存在、非普通文件、超过 20GB 或无权限） | 是     |
| 校验 | `FH_HASH_FAILED`     | 计算失败，文件可能被占用或读取中断                     | 是     |
| 校验 | `FH_INVALID_PAYLOAD` | 参数无效                                               | 否     |
| 重复 | `DF_ROOT_INVALID`    | 无法读取扫描目录（不存在、不是目录或无权限）           | 是     |
| 重复 | `DF_TOO_MANY_FILES`  | 目录文件超过 20 万个，请缩小范围或提高大小阈值         | 否     |
| 重复 | `DF_SCAN_FAILED`     | 扫描失败（任务超时或异常中断）                         | 是     |
| 重复 | `DF_INVALID_PAYLOAD` | 参数无效                                               | 否     |
| 对比 | `FC_ROOT_INVALID`    | 无法读取对比目录（不存在或无权限）                     | 是     |
| 对比 | `FC_TOO_MANY_FILES`  | 单侧文件超过 20 万个，请缩小对比范围                   | 否     |
| 对比 | `FC_COMPARE_FAILED`  | 对比失败（任务超时或异常中断）                         | 是     |
| 对比 | `FC_INVALID_PAYLOAD` | 参数无效                                               | 否     |
| 壳   | `CANCELLED`          | 任务已取消                                             | 否     |

## 5. 设置记忆（`tools.file-scanner.*`）

| 页签 | 键                                                           | 类型                                      | 默认                               |
| ---- | ------------------------------------------------------------ | ----------------------------------------- | ---------------------------------- |
| 校验 | `algorithms`                                                 | `Algorithm[]`                             | `['sha256']`                       |
| 重复 | `lastRoot` / `recursive` / `minBytes`                        | `string\|null` / `boolean` / `number`     | `null` / `true` / 1MB              |
| 对比 | `leftRoot` / `rightRoot` / `compareMtime` / `compareContent` | `string\|null` ×2 / `boolean` / `boolean` | `null` / `null` / `true` / `false` |

存量非法值一律回落默认（各页签 `readConfig` 归一）。

## 6. 文件表

| 文件                                                          | 职责                                                                          |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/manifest.ts`                                             | 工具清单（id `file-scanner` / name 文件扫描 / icon `scan-search` / order 60） |
| `src/node.ts`                                                 | 汇总注册三组通道（`registerAll` / `registerMain`）                            |
| `src/hash/{schema,contract,errors,hash.worker,node}.ts`       | 文件校验契约 / 纯函数 / 错误码 / worker / 通道                                |
| `src/duplicate/{schema,contract,errors,scan.worker,node}.ts`  | 重复文件同上                                                                  |
| `src/compare/{schema,contract,errors,compare.worker,node}.ts` | 目录对比同上                                                                  |
| `src/renderer/client.ts`                                      | 9 通道类型化 invoke 封装                                                      |
| `src/renderer/ToolView.vue`                                   | 父视图（标题 + NTabs）                                                        |
| `src/renderer/tabs/{HashTab,DuplicateTab,CompareTab}.vue`     | 三页签页面与三态                                                              |

## 7. 验收断言

1. `abc` 四算法结果等于 RFC 测试向量（`900150…` / `a9993e…` / `ba7816…` / `ddaf35…`）；中文 + 空格路径全链路无损；结果保持入参顺序。
2. 缺失 / 目录 / 超 20GB / ACL 拒读 → 该行失败且码正确，其余文件照常完成。
3. 期望哈希（带前缀 / 大写 / 带空格）命中行高亮 + 「匹配」；长度 / 字符非法红字提示。
4. 重复：递归分组、非递归仅一层、阈值过滤、`DF_ROOT_INVALID` 正确。
5. 对比：四类分类正确；关闭修改时间比较后时间差不再产生差异；内容比较可识别 >64KB 前缀相同的尾部差异；汇总计数不受截断影响；`FC_ROOT_INVALID` 正确。
6. 页签切换不丢结果、不中断任务；三任务并发互不干扰；取消后无残留。
7. 单测覆盖三页签 schema / contract / errors / worker / node / client；本包 ≥80%；e2e `apps/desktop/e2e/file-scanner-smoke.spec.ts`。
8. R2 八类异常逐条记录于 `docs/smoke/file-scanner.md`；chunk gzip 计入 R5 口径；`pnpm gate` 全绿。

## 8. M81 并入：压缩包（原 zip-tool，2026-11-25，plan Q81 / §4.81）

> 原 `docs/spec/zip-tool.md` 已并入本节后删除；工具 id `zip-tool` 不再存在，能力成为 `file-scanner` 第 7 页签「压缩包」（`version 0.3.0`）。
> 依赖仅继承 `fflate 0.8.3`（M25 已登记 plan §1.1），**零新增二进制**；长任务仍走 `runTask`/`exposeTask` worker，取消与其他页签同口径。

### 8.1 页签与通道对照

| Tab（`TabKey`） | 视图                                                      | 通道（`file-scanner:{action}`）                                          | 错误码前缀 |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ | ---------- |
| `zip`           | `renderer/tabs/ZipTab.vue`（内含「打包 / 解压」二级 Tab） | `zip-pack`、`zip-unpack`（任务）、`zip-config`、`zip-set-config`（同步） | `ZP_*`     |

- settings 键：`tools.file-scanner.zip.*`（模式、源列表、输出目录与文件名、压缩包、目标目录、冲突策略）。
- `src/node.ts` 的 `MergedPrefix` 扩为 `rename | clean | disk | zip`，经适配器注册，通道与设置统一加前缀。

### 8.2 压缩包页签字段级清单

| 能力     | 规则                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 打包输入 | 多选源（文件或文件夹，拖拽 + 「添加文件夹」），1–200 项去重；源不存在/不可读 → `ZP_SOURCE_INVALID`                            |
| 条目结构 | 文件源条目名 = 文件名；目录源 = `{目录名}/{相对路径}`；条目名一律 `/` 分隔 + UTF-8 标志；不跟随符号链接                       |
| 同名冲突 | 包内条目名大小写不敏感冲突 → `{base} (1){ext}` 递增；产物同名 → `{base} (1).zip`；递增 99 次仍冲突 → `ZP_TARGET_INVALID`      |
| 打包进度 | 两阶段（枚举条目/字节总数 → 压缩），上报 `current/total` + 当前文件名                                                         |
| 解压输入 | 单个 `.zip`（扩展名大小写不敏感）；非 zip/损坏 → `ZP_ARCHIVE_INVALID`                                                         |
| 解压目标 | 默认 `{压缩包所在目录}/{压缩包名去 .zip}`，目录不存在自动创建                                                                 |
| 路径安全 | **zip slip 防护**：拒绝绝对路径、盘符、UNC、任意 `..` 段；非法条目跳过并计入 `skipped`；符号链接条目拒绝                      |
| 容量上限 | 条目 ≤ `MAX_ENTRIES = 100_000`（`ZP_TOO_MANY_ENTRIES`）；解压累计声明 ≤ `MAX_UNPACK_BYTES = 10 GiB`（`ZP_ARCHIVE_TOO_LARGE`） |
| 冲突策略 | `rename`（默认，`{base} (n){ext}` 递增）/ `skip`（存在即跳过并计数）；**不提供覆盖**                                          |
| 结果态   | 打包：输出路径/文件数/目录数/字节数/耗时；解压：目标目录/文件数/目录数/字节数/跳过/重命名/耗时                                |
| 三态     | 空态 DropZone + 模式说明；加载态 `TaskProgress`（两阶段，可取消）；报错态 `role="alert"` + `ZP_*` 中文文案 + 重试/详情        |

### 8.3 不做（边界不变）

7z/RAR/tar/gzip 单文件、加密包/分卷/注释/自解压、覆盖写入、删除源文件、包内预览与单条增删改；GBK 条目名转码按 M55 口径仅限解压侧自动识别。

### 8.4 验收（M81）

1. 七页签标签渲染与切换正常，切换不丢其他页签结果、不中断在跑任务。
2. 打包 → 解压回读字节一致；GBK 条目名自动转码为中文；zip slip 条目跳过且计数正确（e2e 断言 `{ files: 1, skipped: 3 }`）。
3. 非法/损坏 zip → `ZP_ARCHIVE_INVALID`；`ZP_TARGET_INVALID` / `ZP_TOO_MANY_ENTRIES` 分支单测覆盖。
4. chunk 复测：`file-scanner-*.js` **229,129 B raw / 46.1KB gzip**（<200KB）；本包覆盖率 ≥80%；`pnpm gate` 全绿。
