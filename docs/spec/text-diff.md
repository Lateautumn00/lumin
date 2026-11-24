# 文本对比（text-diff）字段级功能清单

> 版本：v0.2.0 · 定稿日期：2026-11-24（R8）· 工具 id：`text-diff` · 里程碑 M62
> v0.2.0 按 **Q64**（plan §4.62）解冻增补：词级高亮粒度开关、文件选择与读写、二进制对比与文件比较页签（两同步主进程通道）。
> 本文件为该里程碑验收附件；实现与本文件不一致时以本文件为准，变更须走 R8 流程。

## 1. 范围与边界

**做**：左右两段文本逐行对比；忽略空白（去除全部空白字符后比较，与 `git diff -w` 同口径）与忽略大小写开关；并排 / 统一两种视图；新增/删除/相同行数统计；变更行**词级（默认）/ 字符级**差异高亮（行内粒度开关）；统一 diff 文本复制；示例 / 交换 / 清空操作；**文件比较页签**——文件选择与读写（单选对话框 + 读入比较）、两文件文本模式逐行对比（复用统计/并排/统一）、二进制模式流式 SHA-256 对比（相同判定 + 首个差异偏移）。

**不做**：三路合并、语法高亮、行折叠、历史记录持久化、联网、编码探测与转码（仅按 BOM 判定，UTF-16/32 等非 UTF-8 编码直接报 `TD_UNSUPPORTED_ENCODING`，不自动转码）。

**形态**：**文本比较纯 renderer；文件比较经 2 个同步主进程通道**（`text-diff:pick-file` / `text-diff:compare-files`，zod schema 归包 `src/schema.ts`，通道实现 `src/node.ts`）；零新增运行时第三方依赖（`zod` / `electron` 为项目既有基线声明，`node:fs` / `node:crypto` / Electron `dialog` 均为内置）。文本比较仅复用 vue / naive-ui / `@lucide/vue` / `@lumin/shared`（`StructuredError`）；对比为同步纯函数，输入变更即时重算；LCS 设单元格预算，超预算降级为整块删除 + 整块插入，保证大文本下有界耗时。文件比较为同步短阻塞通道（最坏 200MB 流式约 1–2s），**不走** invoke→progress→cancel 三段式任务模型。

## 2. 页面字段清单

单页两个页签（`NTabs` type="line"）：**文本比较**（默认）与**文件比较**（`data-name="file"`），互斥切换。

### 2.1 文本比较工具条

| 控件            | 类型                       | 行为                                                                       | 默认   |
| --------------- | -------------------------- | -------------------------------------------------------------------------- | ------ |
| 视图模式        | `NRadioGroup`              | `side-by-side` 并排 / `unified` 统一，仅切换结果区渲染                     | 并排   |
| 行内高亮粒度    | `NRadioGroup`（size small） | `词级`（默认）/ `字符级`，仅切换变更行配对的行内高亮算法（`diffWords` / `diffChars`），结果区结构不变 | 词级   |
| 忽略空白        | `NCheckbox`                | 勾选后 `normalizeLine` 去除全部空白字符再比较；展示文本仍保留原样          | 不勾选 |
| 忽略大小写      | `NCheckbox`                | 勾选后比较键转小写；展示文本保留原样                                       | 不勾选 |
| 示例            | `NButton`                  | 填入固定示例（4 行 vs 5 行），并复位复制反馈                               | —      |
| 交换            | `NButton`                  | 左右文本互换                                                               | —      |
| 清空            | `NButton`                  | 双输入置空并复位反馈；双输入已空时禁用                                     | 禁用   |
| 复制统一 diff   | `NButton`（primary）       | 把 `toUnifiedDiff` 文本写入剪贴板；无差异时禁用；成功文案 `已复制` 1.2s 复位 | 禁用   |

### 2.2 输入区

| 区域     | 控件                           | 行为                             |
| -------- | ------------------------------ | -------------------------------- |
| 左侧文本 | `NInput type="textarea"` 12 行 | 占位 `粘贴左侧文本…`；输入即重算 |
| 右侧文本 | `NInput type="textarea"` 12 行 | 占位 `粘贴右侧文本…`；输入即重算 |

上限（任一侧越界即报错，不进入 LCS）：20,000 行或 1,000,000 字符。

### 2.3 文本比较结果区

| 区域     | 行为                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------- |
| 统计     | `data-stat-added` / `data-stat-removed` / `data-stat-unchanged`，分别展示 `+新增` / `-删除` / `相同`                      |
| 并排视图 | 双列，行号独立；删除行左侧淡红、插入行右侧淡绿；连续删除/新增按序配对并按粒度开关做**词级（默认）或字符级**差异（左侧隐藏新增片段、右侧隐藏删除片段） |
| 统一视图 | 每行：左行号 + 右行号 + 前缀（` `/`-`/`+`）+ 文本；删除/插入行按类型着色与淡色底                                          |
| 空态     | 双输入均为空时展示引导：`粘贴或输入左右两段文本开始对比` + 示例提示，禁止白屏                                             |
| 超限报错 | `role="alert"` 行内展示 `TD_TOO_LARGE` + 中文文案；统计与结果区隐藏，输入内容保留                                         |
| 复制失败 | 独立 `role="alert"` 行内展示 `TD_CLIPBOARD_FAILED`                                                                        |

### 2.4 文本比较三态

| 状态   | 实现                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------- |
| 空态   | 双输入为空时展示引导卡片 + 占位文案；点击示例即可产生结果                                          |
| 加载态 | **不适用**：全部为同步纯函数，无长任务 / 无进度与取消语义（spec 登记豁免，与 text-toolbox 同口径） |
| 报错态 | 超限 `TD_TOO_LARGE`（行内码 + 中文，结果区隐藏）；复制失败 `TD_CLIPBOARD_FAILED`；两处错误互不阻塞 |

### 2.5 文件比较页签（第三页签）

**路径操作区**：

| 控件          | 类型                  | 行为                                                                                 | 默认   |
| ------------- | --------------------- | ------------------------------------------------------------------------------------ | ------ |
| 页签          | `NTabPane` name=file  | 标签 `文件比较`，`data-name="file"`；与文本比较互斥切换                              | 非默认 |
| 左侧路径      | `NInput`（readonly）  | 展示所选文件绝对路径，由「选择」回填                                                 | 空     |
| 左侧选择      | `NButton`             | 调 `text-diff:pick-file`；返回 `path` 非空则回填，`null`（取消）保持原值              | —      |
| 右侧路径/选择 | 同左                  | 回填右侧路径                                                                         | 空     |
| 比较          | `NButton`（primary）  | 调 `text-diff:compare-files`；任一路径为空时禁用                                     | 禁用   |
| 交换          | `NButton`             | 左右路径互换（已比较结果保留，重新点击「比较」生效）                                 | —      |

**结果区**（按回包 `mode` 分支）：

| 区域     | 行为                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 文本模式 | 复用统计（`data-stat-*`）/ 并排 / 统一渲染，`leftLabel` / `rightLabel` = 文件名；行内高亮跟随粒度开关；复用优先，耦合处抽 computed 参数化 |
| 二进制模式 | 信息卡：`same` → `两文件完全相同`；否则 `二进制不同，首个差异位于偏移 X（块 N/M）`（`firstDiffOffset` + `totalChunks`）                 |
| 空态     | 未选择文件/未比较时展示引导 `选择两个文件开始比较`，禁止白屏                                                                            |
| 加载态   | **不适用**：同步通道无进度语义（最坏 200MB 约 1–2s 短阻塞），登记豁免                                                                    |
| 报错态   | 行内 `role="alert"` 结构化码 + 中文 + 「重试」（重新点击「比较」）：`TD_FILE_TOO_LARGE` / `TD_FILE_READ_FAILED` / `TD_UNSUPPORTED_ENCODING` / `INVALID_INPUT`；错误互不阻塞，已选路径保留 |

## 3. 纯函数契约（`src/diff.ts`，≥80% 覆盖）

| 函数                                              | 入参 / 输出                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `splitLines(text)`                                | 按 `CRLF/CR/LF` 拆行；末尾换行不产生空行；空串 → `[]`                                                                                 |
| `normalizeLine(line, options)`                    | `ignoreWhitespace` 去除全部空白字符；`ignoreCase` 转小写；返回比较键                                                                  |
| `diffLines(left, right, options)`                 | 行数/字符数校验 → 剥离公共前后缀 → 中段 LCS（预算 `4,000,000` 单元格，超出降级整块删除+插入）→ `LineChange[]` 或 `{ok:false,message}` |
| `diffStats(changes)`                              | 统计 `added` / `removed` / `unchanged`                                                                                                |
| `toUnifiedDiff(changes, leftLabel?, rightLabel?)` | 无差异返回空串；否则 `--- 左侧` / `+++ 右侧` 头 + ` `/`-`/`+` 前缀正文                                                                |
| `diffChars(left, right)`                          | 按码点（`Array.from`）先剥离公共前后缀，再做 LCS（预算 `1,000,000`）；单行 >2,000 字符直接整行替换；合并相邻同类型片段                |
| `tokenizeWords(line)`                             | 行分词：连续拉丁字母 → 一词、连续数字 → 一词、CJK 逐字成词、其余非空白字符单成词；空白保留为独立 token（原样保留）                    |
| `diffWords(left, right)`                          | 词级行内对比：剥离公共词前后缀 → 中段词级 LCS（预算 `WORD_LCS_MAX_CELLS`，超限降级整词替换）；单行 >`WORD_LIMIT` 词直接整行替换；输出 `InlineSegment[]`（与 `diffChars` 同形状，渲染层零改动） |
| `classifyFile(head, size)`                        | 模式判定（纯函数；`head` = 文件头 ≤8KB 字节，`size` = 文件总字节）：`size ≤ 1,048,576` **且** head 内行数 ≤ 20,000 **且** 前 8KB 无 `0x00` → `'text'`，否则 `'binary'`；UTF-16/32 BOM → 抛 `TD_UNSUPPORTED_ENCODING`；UTF-8 BOM 视为文本（读入侧剥离）；head 行数为估算，全量行数由 `diffLines` 兜底（超限 → `TD_TOO_LARGE`） |
| `sideSegments(segments, side)`                    | 左侧剔除 `insert`、右侧剔除 `delete`，用于并排渲染                                                                                    |
| `prefixOf(type)`                                  | `equal → ' '`、`insert → '+'`、`delete → '-'`                                                                                         |

常量：`DIFF_LINE_LIMIT = 20_000`、`DIFF_CHAR_LIMIT = 1_000_000`、`DIFF_LCS_MAX_CELLS = 4_000_000`、`INLINE_LCS_MAX_CELLS = 1_000_000`、`INLINE_CHAR_LIMIT = 2_000`、`WORD_LCS_MAX_CELLS = 1_000_000`、`WORD_LIMIT = 2_000`。

## 4. 主进程通道契约（`src/schema.ts` + `src/node.ts`，同步通道）

| 通道                     | payload（zod 校验）                                                              | 回包                                                                                                             | 说明                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text-diff:pick-file`    | `{}`（空对象）                                                                   | `{ path: string \| null }`                                                                                      | `dialog.showOpenDialogSync` 单文件选择；用户取消 → `path: null`；非法载荷 → `INVALID_INPUT`                                                                  |
| `text-diff:compare-files` | `{ left: string, right: string }`（均非空）；可选 `ignoreWhitespace` / `ignoreCase`（默认 `false`） | 文本：`{ mode: 'text', changes, stats, leftLabel, rightLabel, leftLines, rightLines }`；二进制：`{ mode: 'binary', same, firstDiffOffset?, totalChunks }` | `stat` 预检（>200MB → `TD_FILE_TOO_LARGE`；不存在/不可读 → `TD_FILE_READ_FAILED`）→ `classifyFile` 分支 → 文本模式剥 UTF-8 BOM 读入复用 `diffLines`（忽略选项取 payload，缺省 false）返回行级结果（`leftLabel`/`rightLabel` = 文件名）；二进制模式 `node:crypto` 1MB/块流式 SHA-256 两文件逐块同位比对，块不同 → 块内字节级定位首个差异偏移（内存 O(1)）；行数超限由 `diffLines` 兜底报 `TD_TOO_LARGE` |

注：两通道均为同步短阻塞通道（最坏约 1–2s），不走三段式任务模型；所有入参经 zod `safeParse` 后才进 handler，失败抛 `INVALID_INPUT`。

## 5. 错误码（`src/errors.ts`）

| 码                         | 中文文案                                                   | 触发来源                                       | 恢复                                             |
| -------------------------- | ---------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `TD_TOO_LARGE`             | 文本过大，单侧最多 20,000 行或 1,000,000 字符              | `diffLines` 行数/字符数超限（含文件文本模式）  | 精简文本或拆分后分段对比                         |
| `TD_CLIPBOARD_FAILED`      | 复制失败，请手动选择文本复制                               | 渲染层剪贴板写入失败                           | 手动框选文本复制                                 |
| `TD_FILE_READ_FAILED`      | 文件读取失败，请检查路径是否存在及读取权限                 | `stat` 预检不存在/不可读；读入失败             | 确认路径与权限后点「重试」                       |
| `TD_FILE_TOO_LARGE`        | 文件过大，单文件最大 200MB                                 | `stat` size > 200MB                            | 换用更小文件或拆分后分段对比                     |
| `TD_UNSUPPORTED_ENCODING`  | 不支持的文件编码，请另存为 UTF-8 后重试                    | `classifyFile` 命中 UTF-16/32 BOM；读入解码失败 | 另存为 UTF-8 编码后点「重试」                    |

## 6. 壳接线（7 处；M62 新增 `tool-mains.ts` 注册，manifest/清单/vite alias/workspace 依赖不变）

1. `apps/desktop/electron.vite.config.ts`：`@lumin/tool-text-diff/manifest`、`/renderer/*` 两条别名。
2. `apps/desktop/package.json`：`"@lumin/tool-text-diff": "workspace:*"`（devDependencies，字母序）。
3. `apps/desktop/src/tool-manifests.ts`：import + 清单数组新增 1 行。
4. `apps/desktop/src/renderer/src/tools/text-diff.vue`：薄页面转发 `ToolView.vue`。
5. `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：iconMap 新增 `'file-diff': FileDiff`。
6. 根 `vitest.config.ts`：新增 `packages/tools/text-diff/src/**/*.ts` 80% 阈值（含 M62 新增 `schema.ts` / `node.ts`）。
7. `apps/desktop/src/main/tool-mains.ts`：import `registerMain`（`@lumin/tool-text-diff/node`）+ `registerMains()` 内按字母序（插 `text-editor` 之前）调用 1 行；失败走既有 try/catch 中文日志。

包侧配套：`packages/tools/text-diff/package.json` exports 增 `"./node": "./src/node.ts"`；新增 `src/schema.ts`（zod 信封与回包 schema）、`src/node.ts`（`registerMain` 两通道，deps 可注入）；`manifest.ts` / 清单 / vite alias / workspace 依赖均不变。

清单：`id: text-diff`、`name: 文本对比`、`icon: file-diff`、`category: text`、`order: 100`、`version: 0.1.0`。

## 7. R5 体积口径

无 worker / wasm / 模型 / 图片 / 字体资产；仅共享 vendor（vue / naive-ui / `@lucide/vue`）。M32 实测 `text-diff-*.js` 为 **27,941 B raw / 7,774 B gzip**，独占依赖 chunk 为 0，上限 200KB gzip。M62 复测（2026-11-24，词级函数 + DiffResultPanel 抽取 + 文件比较页签）：`text-diff-*.js` 为 **41,849 B raw / 10,782 B gzip**（较 M32 +13,908 raw / +3,008 gzip），仍无独占依赖 chunk；主进程 `schema.ts`/`node.ts` 与 zod 不进 renderer chunk，达标。

## 8. 验收

- 单测：`diff.test.ts`（拆行/归一化/行级 LCS 与行号/忽略选项/空与超限/预算降级/统计/统一 diff/字符级含 emoji 与合并/单侧过滤/前缀/**分词规则中英混排/词级 LCS 预算降级/单行 >2,000 词整行替换**）、`errors.test.ts`、`manifest.test.ts`、`schema.test.ts`（两通道信封与回包）、`node.test.ts`（通道注册/`classifyFile` 三条件/二进制首差异偏移/BOM 与 UTF-16 分支/错误码注入，deps 注入不触真实对话框与磁盘）；本包（`src/**/*.ts`）覆盖率 ≥80%。
- e2e `apps/desktop/e2e/text-diff-smoke.spec.ts` 6 用例：
  1. 页面加载 → 空态引导 → 示例 → 统计 `+3/-2/2` 与并排 5 行；
  2. 双输入 → 区分大小写统计 → 忽略大小写联动 → 统一视图行数与 `-Beta`/`+Gamma`；
  3. 示例 → 统一视图复制到系统剪贴板（读取校验）→ 交换 → 清空恢复空态；
  4. 20,001 行 → `TD_TOO_LARGE` 且结果区隐藏 → 清空恢复空态；
  5. **（M62）** 文本页签切「词级」→ 断言行内词级高亮 span 结构（与字符级切换对照）；
  6. **（M62）** 文件页签经 `page.evaluate` 调 `window.lumin.invoke('text-diff:compare-files', …)`（ASCII 临时文件，e2e 免 dialog）→ 文本模式出 diff 断言；NUL 二进制对断言偏移信息卡；不存在路径断言 `TD_FILE_READ_FAILED` 中文错误。
- R2 八类映射记录于 `docs/smoke/text-diff.md`（含 M62 文件比较增量节）。
- `pnpm gate` / `pnpm coverage` / `pnpm build` / e2e 全绿。
