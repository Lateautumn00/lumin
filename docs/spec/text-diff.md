# 文本对比（text-diff）字段级功能清单

> 版本：v0.1.0 · 定稿日期：2026-11-20（R8）· 工具 id：`text-diff` · 里程碑 M32
> 本文件为该里程碑验收附件；实现与本文件不一致时以本文件为准，变更须走 R8 流程。

## 1. 范围与边界

**做**：左右两段文本逐行对比；忽略空白（去除全部空白字符后比较，与 `git diff -w` 同口径）与忽略大小写开关；并排 / 统一两种视图；新增/删除/相同行数统计；变更行字符级差异高亮；统一 diff 文本复制；示例 / 交换 / 清空操作。

**不做**：文件选择与读写、三路合并、语法高亮、行折叠、词级 diff、二进制对比、历史记录持久化、联网、编码探测。

**形态**：**纯 renderer、零 IPC、零主进程逻辑、零新增运行时第三方依赖**；仅复用 vue / naive-ui / `@lucide/vue` / `@lumin/shared`（`StructuredError`）。对比为同步纯函数，输入变更即时重算；LCS 设单元格预算，超预算降级为整块删除 + 整块插入，保证大文本下有界耗时。

## 2. 页面字段清单

单页，自上而下：标题区 → 工具条 → 双输入区 → 统计/错误 → 对比结果区。

### 2.1 工具条

| 控件          | 类型                 | 行为                                                                         | 默认   |
| ------------- | -------------------- | ---------------------------------------------------------------------------- | ------ |
| 视图模式      | `NRadioGroup`        | `side-by-side` 并排 / `unified` 统一，仅切换结果区渲染                       | 并排   |
| 忽略空白      | `NCheckbox`          | 勾选后 `normalizeLine` 去除全部空白字符再比较；展示文本仍保留原样            | 不勾选 |
| 忽略大小写    | `NCheckbox`          | 勾选后比较键转小写；展示文本保留原样                                         | 不勾选 |
| 示例          | `NButton`            | 填入固定示例（4 行 vs 5 行），并复位复制反馈                                 | —      |
| 交换          | `NButton`            | 左右文本互换                                                                 | —      |
| 清空          | `NButton`            | 双输入置空并复位反馈；双输入已空时禁用                                       | 禁用   |
| 复制统一 diff | `NButton`（primary） | 把 `toUnifiedDiff` 文本写入剪贴板；无差异时禁用；成功文案 `已复制` 1.2s 复位 | 禁用   |

### 2.2 输入区

| 区域     | 控件                           | 行为                             |
| -------- | ------------------------------ | -------------------------------- |
| 左侧文本 | `NInput type="textarea"` 12 行 | 占位 `粘贴左侧文本…`；输入即重算 |
| 右侧文本 | `NInput type="textarea"` 12 行 | 占位 `粘贴右侧文本…`；输入即重算 |

上限（任一侧越界即报错，不进入 LCS）：20,000 行或 1,000,000 字符。

### 2.3 结果区

| 区域     | 行为                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------- |
| 统计     | `data-stat-added` / `data-stat-removed` / `data-stat-unchanged`，分别展示 `+新增` / `-删除` / `相同`                      |
| 并排视图 | 双列，行号独立；删除行左侧淡红、插入行右侧淡绿；连续删除/新增按序配对并做字符级差异（左侧隐藏新增片段、右侧隐藏删除片段） |
| 统一视图 | 每行：左行号 + 右行号 + 前缀（` `/`-`/`+`）+ 文本；删除/插入行按类型着色与淡色底                                          |
| 空态     | 双输入均为空时展示引导：`粘贴或输入左右两段文本开始对比` + 示例提示，禁止白屏                                             |
| 超限报错 | `role="alert"` 行内展示 `TD_TOO_LARGE` + 中文文案；统计与结果区隐藏，输入内容保留                                         |
| 复制失败 | 独立 `role="alert"` 行内展示 `TD_CLIPBOARD_FAILED`                                                                        |

### 2.4 三态

| 状态   | 实现                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------- |
| 空态   | 双输入为空时展示引导卡片 + 占位文案；点击示例即可产生结果                                          |
| 加载态 | **不适用**：全部为同步纯函数，无长任务 / 无进度与取消语义（spec 登记豁免，与 text-toolbox 同口径） |
| 报错态 | 超限 `TD_TOO_LARGE`（行内码 + 中文，结果区隐藏）；复制失败 `TD_CLIPBOARD_FAILED`；两处错误互不阻塞 |

## 3. 纯函数契约（`src/diff.ts`，≥80% 覆盖）

| 函数                                              | 入参 / 输出                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `splitLines(text)`                                | 按 `CRLF/CR/LF` 拆行；末尾换行不产生空行；空串 → `[]`                                                                                 |
| `normalizeLine(line, options)`                    | `ignoreWhitespace` 去除全部空白字符；`ignoreCase` 转小写；返回比较键                                                                  |
| `diffLines(left, right, options)`                 | 行数/字符数校验 → 剥离公共前后缀 → 中段 LCS（预算 `4,000,000` 单元格，超出降级整块删除+插入）→ `LineChange[]` 或 `{ok:false,message}` |
| `diffStats(changes)`                              | 统计 `added` / `removed` / `unchanged`                                                                                                |
| `toUnifiedDiff(changes, leftLabel?, rightLabel?)` | 无差异返回空串；否则 `--- 左侧` / `+++ 右侧` 头 + ` `/`-`/`+` 前缀正文                                                                |
| `diffChars(left, right)`                          | 按码点（`Array.from`）先剥离公共前后缀，再做 LCS（预算 `1,000,000`）；单行 >2,000 字符直接整行替换；合并相邻同类型片段                |
| `sideSegments(segments, side)`                    | 左侧剔除 `insert`、右侧剔除 `delete`，用于并排渲染                                                                                    |
| `prefixOf(type)`                                  | `equal → ' '`、`insert → '+'`、`delete → '-'`                                                                                         |

常量：`DIFF_LINE_LIMIT = 20_000`、`DIFF_CHAR_LIMIT = 1_000_000`、`DIFF_LCS_MAX_CELLS = 4_000_000`、`INLINE_LCS_MAX_CELLS = 1_000_000`、`INLINE_CHAR_LIMIT = 2_000`。

## 4. 错误码（`src/errors.ts`）

| 码                    | 中文文案                                      | 触发来源                    |
| --------------------- | --------------------------------------------- | --------------------------- |
| `TD_TOO_LARGE`        | 文本过大，单侧最多 20,000 行或 1,000,000 字符 | `diffLines` 行数/字符数超限 |
| `TD_CLIPBOARD_FAILED` | 复制失败，请手动选择文本复制                  | 渲染层剪贴板写入失败        |

## 5. 壳接线（固定 6 处，无 node.ts）

1. `apps/desktop/electron.vite.config.ts`：`@lumin/tool-text-diff/manifest`、`/renderer/*` 两条别名。
2. `apps/desktop/package.json`：`"@lumin/tool-text-diff": "workspace:*"`（devDependencies，字母序）。
3. `apps/desktop/src/tool-manifests.ts`：import + 清单数组新增 1 行。
4. `apps/desktop/src/renderer/src/tools/text-diff.vue`：薄页面转发 `ToolView.vue`。
5. `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：iconMap 新增 `'file-diff': FileDiff`。
6. 根 `vitest.config.ts`：新增 `packages/tools/text-diff/src/**/*.ts` 80% 阈值。

清单：`id: text-diff`、`name: 文本对比`、`icon: file-diff`、`category: text`、`order: 100`、`version: 0.1.0`。

## 6. R5 体积口径

无 worker / wasm / 模型 / 图片 / 字体资产；仅共享 vendor（vue / naive-ui / `@lucide/vue`）。`pnpm build` 实测 `text-diff-*.js` 为 **27,941 B raw / 7,774 B gzip**，独占依赖 chunk 为 0，上限 200KB gzip。

## 7. 验收

- 单测：`diff.test.ts`（拆行/归一化/行级 LCS 与行号/忽略选项/空与超限/预算降级/统计/统一 diff/字符级含 emoji 与合并/单侧过滤/前缀）、`errors.test.ts`、`manifest.test.ts`，共 33 例；本包覆盖率 ≥80%（实测 `diff.ts` lines 92.6% / branches 86.0%）。
- e2e `apps/desktop/e2e/text-diff-smoke.spec.ts` 4 用例：
  1. 页面加载 → 空态引导 → 示例 → 统计 `+3/-2/2` 与并排 5 行；
  2. 双输入 → 区分大小写统计 → 忽略大小写联动 → 统一视图行数与 `-Beta`/`+Gamma`；
  3. 示例 → 统一视图复制到系统剪贴板（读取校验）→ 交换 → 清空恢复空态；
  4. 20,001 行 → `TD_TOO_LARGE` 且结果区隐藏 → 清空恢复空态。
- R2 八类映射记录于 `docs/smoke/text-diff.md`。
- `pnpm gate` / `pnpm coverage` / `pnpm build` / e2e 全绿。
