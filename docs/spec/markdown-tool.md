# Markdown 工具（markdown-tool）字段级功能清单

> 版本：v0.1.0 · 定稿日期：2026-11-21（R8）· 工具 id：`markdown-tool` · 里程碑 M39
> 决策：plan §1 Q39 / §4.39；本文件为该里程碑验收附件，实现与本文件不一致时以本文件为准，变更须走 R8。
> 新增依赖：`marked`（Markdown 解析）、`js-yaml`（YAML 解析/序列化），均精确钉版，登记于 plan §1.1。

## 1. 范围与边界

**做**：

1. **Markdown 预览 + MD→HTML**：输入 Markdown，右侧沙箱 iframe 实时预览；复制 HTML 片段、导出完整 HTML 文件。
2. **JSON→TypeScript 类型生成**：对象/数组/联合推断，输出 `interface` 或 `type` 声明，支持嵌套命名、可选字段与字段名引号化。
3. **YAML 工具**：YAML→JSON、JSON→YAML、YAML 格式化（缩进 2）。

**不做**：Markdown 编辑器工具栏（粗体/插入表格按钮）、导出 PDF/Word、图片上传与本地图片引用、外链图片代理、YAML 锚点保留（格式化后锚点展开）、多文档 YAML、JSON Schema 生成、历史记录持久化、联网。

**形态**：解析与生成全部在 renderer（同步纯函数）；主进程仅 3 个同步短通道（`config` / `set-output-dir` / `save`）做输出目录记忆与原子写盘，无三段式长任务。

**安全口径**：

- 预览使用 `<iframe sandbox="" :srcdoc="…">`（无 `allow-scripts`，不开放同源），文档内脚本无法执行。
- 预览与导出 HTML 均注入 CSP `<meta>`：预览 `default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:`（不加载外链图片，离线安全）；导出 `default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`（浏览器打开时脚本仍被拦截）。
- 用户 Markdown 中的原始 HTML 会被渲染，但脚本受上述 CSP 拦截；`javascript:` 链接在 `default-src 'none'` 下不执行。

## 2. 页面字段清单

单页 + 3 个页签（`NTabs` 仅作切换器，内容 `v-if` 渲染，标签走 `#tab` 插槽——与 text-toolbox 同范式）。

### 2.1 Tab1 Markdown 预览

| 区域     | 控件                                          | 行为                                                                  | 空/默认           |
| -------- | --------------------------------------------- | --------------------------------------------------------------------- | ----------------- |
| 输入     | `NInput` textarea，等宽字体，最小 16 行       | 输入即渲染（防抖 150ms）；超过 2,000,000 字符 → `MD_INPUT_TOO_LONG`   | 空                |
| 示例     | `[载入示例]`                                  | 填入内置示例 Markdown（标题/列表/表格/代码块/引用/链接）              | —                 |
| 清空     | `[清空]`                                      | 清空输入与预览                                                        | —                 |
| 预览     | `iframe[data-md-preview]`（sandbox 空值）     | 始终渲染最新 HTML；无输入时展示引导文案「在左侧输入 Markdown」        | 空态引导          |
| 统计     | 文本                                          | 字符数 / 行数                                                         | 0                 |
| 复制     | `[复制 HTML]`                                 | 复制渲染后的片段 HTML；失败 → `MD_CLIPBOARD_FAILED`                   | —                 |
| 导出     | 输出目录显示 + `[选择目录]` + 文件名 + `[导出 HTML]` | 文件名默认 `document`（≤80 字，禁 `\ / : * ? " < > \|`）；产物冲突 `(n)` 递增；写盘失败 → `MD_SAVE_FAILED` | `userData/markdown` |

### 2.2 Tab2 JSON→TypeScript

| 区域     | 控件                                             | 行为                                                                 | 空/默认   |
| -------- | ------------------------------------------------ | -------------------------------------------------------------------- | --------- |
| 输入     | `NInput` textarea，等宽字体                      | JSON 文本；超过 2,000,000 字符 → `MD_INPUT_TOO_LONG`                 | 空        |
| 根类型名 | `NInput`（默认 `Root`）                          | 必须匹配 `^[A-Za-z_$][A-Za-z0-9_$]*$` 且非 TS 保留字，否则 `MD_TS_NAME_INVALID` | `Root`    |
| 声明方式 | `NRadioGroup`：`interface` / `type`              | 切换即重算                                                           | `interface` |
| 输出     | 只读 textarea（等宽）                            | 生成代码；JSON 非法 → `MD_JSON_INVALID`（含解析位置），输出区隐藏为空态引导 | —   |
| 复制     | `[复制代码]`                                     | 复制生成代码；失败 → `MD_CLIPBOARD_FAILED`                           | —         |
| 导出     | 同 Tab1 目录/文件名机制                          | 扩展名固定 `.ts`；冲突递增；失败 → `MD_SAVE_FAILED`                  | —         |

### 2.3 Tab3 YAML

| 区域   | 控件                                              | 行为                                                                 | 空/默认       |
| ------ | ------------------------------------------------- | -------------------------------------------------------------------- | ------------- |
| 模式   | `NRadioGroup`：`YAML→JSON` / `JSON→YAML` / `格式化 YAML` | 切换模式清空输出、保留输入；输入框占位文案随模式变化                 | `YAML→JSON`   |
| 输入   | `NInput` textarea，等宽字体                       | 超过 2,000,000 字符 → `MD_INPUT_TOO_LONG`                            | 空            |
| 输出   | 只读 textarea（等宽）                             | 转换/格式化结果；语法错误 → `MD_YAML_INVALID`（含行/列）；JSON 模式非法 → `MD_JSON_INVALID` | — |
| 提示   | 文本                                              | 「格式化会移除注释、展开锚点」常驻                                   | —             |
| 复制   | `[复制结果]`                                      | 失败 → `MD_CLIPBOARD_FAILED`                                         | —             |
| 导出   | 同 Tab1 目录/文件名机制                          | 扩展名按模式 `.json` / `.yaml`；冲突递增；失败 → `MD_SAVE_FAILED`     | —             |

### 2.4 三态

| 状态   | 实现                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| 空态   | 三页签均有引导文案与主操作（Markdown 示例/清空；JSON 输入占位；YAML 模式 + 占位），无白屏                        |
| 加载态 | **不适用**（同步纯函数，单次 <50ms；spec 登记豁免，与 text-toolbox / life-calculator 同口径）；导出按钮写入中显示 loading |
| 报错态 | 各页签独立 `role="alert"` 行内错误（错误码 + 中文文案），互不阻塞；导出失败保留输入与输出                         |

## 3. 纯函数契约（`src/*.ts`，≥80% 覆盖）

### 3.1 `src/markdown.ts`

| 函数                                   | 入参 / 输出                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `renderMarkdown(input)`                | `string` → `{ ok:true, value:{ html, chars, lines } }` 或 `{ ok:false, message }`            |
| `buildHtmlDocument(bodyHtml, title)`   | 生成完整 HTML 文档（含 `<meta charset>`、CSP meta、内嵌预览样式、转义后的 `<title>`）        |
| `escapeHtml(value)`                    | `& < > " '` 转义                                                                             |
| `MARKDOWN_LIMIT = 2_000_000`           | 输入字符上限                                                                                 |

解析口径：`marked`（`gfm: true`、`breaks: false`）；空输入返回空 HTML；`chars` 为输入字符数、`lines` 为按 `\n` 计数。

### 3.2 `src/json-to-ts.ts`

| 函数                            | 入参 / 输出                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `generateTypes(input, options)` | `{ rootName: string; style: 'interface' \| 'type' }` → `{ ok:true, value:{ code } }` 或 `{ ok:false, message }` |
| 值类型                          | `null` → `null`；string/number/boolean → 原语；数组 → `T[]`；对象 → 具名声明       |
| 对象合并（数组元素联合）        | 键在全部元素中出现 → 必选；部分出现 → `?`；同名键类型不同 → 联合 `A \| B`         |
| 命名                            | 根类型名按用户输入；嵌套对象 `根名 + PascalCase(键路径)`；冲突追加 `2/3…`          |
| 字段名                          | 合法标识符原样；否则单引号包裹（`'a-b': string`）                                  |
| 边界                            | 空对象 → `Record<string, never>`；空数组 → `unknown[]`；嵌套深度 >64 → `MD_JSON_INVALID`（detail「嵌套过深」） |
| 输出                            | 2 空格缩进、声明间空行、文件末尾换行；`interface` 模式 `export interface X {…}`，`type` 模式 `export type X = {…}` |

### 3.3 `src/yaml.ts`

| 函数              | 入参 / 输出                                                                 |
| ----------------- | ---------------------------------------------------------------------------- |
| `yamlToJson(text)` | YAML → 美化 JSON（2 空格）；多文档/语法错误 → `MD_YAML_INVALID`（detail 行/列） |
| `jsonToYaml(text)` | JSON → YAML（`indent: 2`、`lineWidth: 120`、`noRefs: true`）；JSON 非法 → `MD_JSON_INVALID` |
| `formatYaml(text)` | YAML → YAML（同 dump 口径；注释丢失、锚点展开）                              |

空输入统一返回 `{ ok:true, value:{ text: '' } }`（UI 保持空态）。

### 3.4 `src/save.ts`

`sanitizeBaseName(name)`：去首尾空白 → 替换 `\ / : * ? " < > |` 与控制字符为 `_` → 去尾部点/空格 → 空回退 `document` → 截断 80 字符。
`EXTENSIONS = ['html', 'ts', 'json', 'yaml'] as const`，`isSaveExtension(value)` 供 schema 复用。

### 3.5 `src/schema.ts`（主进程 zod）

`savePayloadSchema = { outputDir: string(1..4096), baseName: string(1..80), extension: enum(EXTENSIONS), content: string }`；
`configResultSchema = { outputDir: string }`；`setOutputDirPayloadSchema = { outputDir: string }`。

## 4. 错误码（`src/errors.ts`）

| 码                    | 中文文案                                   | 触发来源                                       |
| --------------------- | ------------------------------------------ | ---------------------------------------------- |
| `MD_INPUT_TOO_LONG`   | 输入内容过长（上限 200 万字符）            | 任一页签输入超限                               |
| `MD_JSON_INVALID`     | JSON 格式不合法，请检查语法                | JSON 解析失败 / 嵌套过深                       |
| `MD_TS_NAME_INVALID`  | 根类型名不合法，需为合法 TypeScript 标识符 | 根类型名不符规则或为保留字                     |
| `MD_YAML_INVALID`     | YAML 格式不合法，请检查语法                | YAML 解析失败 / 多文档                         |
| `MD_CLIPBOARD_FAILED` | 复制失败，请手动选择文本复制               | 渲染层剪贴板写入失败                           |
| `MD_SAVE_FAILED`      | 导出失败，请检查输出目录                   | 目录创建/写盘失败、同名文件超过 99 个、载荷非法 |

## 5. 主进程通道（`src/node.ts`）

| 通道                        | 类型 | 入参                                                      | 返回                 |
| --------------------------- | ---- | --------------------------------------------------------- | -------------------- |
| `markdown-tool:config`      | 同步 | —                                                         | `{ outputDir }`      |
| `markdown-tool:set-output-dir` | 同步 | `{ outputDir }`                                        | `void`               |
| `markdown-tool:save`        | 同步 | `{ outputDir, baseName, extension, content }`             | `{ output }`         |

`save` 流程：zod 校验 → `mkdirSync(recursive)` → 基名清洗 → `resolveConflictPath` 冲突递增 → `writeAtomic`（UTF-8）→ 记忆 `outputDir`；缺省目录 `userData/markdown`。

## 6. 壳接线（固定 7 处 + tool-mains）

1. `apps/desktop/electron.vite.config.ts`：`manifest` / `node` / `renderer/*` 三条别名。
2. `apps/desktop/package.json`：`"@lumin/tool-markdown-tool": "workspace:*"`（devDependencies，字母序）。
3. `apps/desktop/src/tool-manifests.ts`：import + 数组新增 1 行（`textToolboxManifest` 之后）。
4. `apps/desktop/src/main/tool-mains.ts`：import + 数组新增 1 行。
5. `apps/desktop/src/renderer/src/tools/markdown-tool.vue`：薄页面转发 `ToolView.vue`。
6. `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：iconMap 新增 `'file-code': FileCode`。
7. 根 `vitest.config.ts`：新增 `packages/tools/markdown-tool/src/**/*.ts` 80% 阈值。

清单：`id: markdown-tool`、`name: Markdown 工具`、`description: Markdown 预览与 HTML 转换、JSON 转 TypeScript 类型、YAML 格式化与互转`、`icon: file-code`、`category: document`、`order: 80`、`version: 0.1.0`。

## 7. 依赖与安全（R8）

| 依赖      | 版本   | 用途                 | 体积口径                     |
| --------- | ------ | -------------------- | ---------------------------- |
| `marked`  | 18.2.1 | Markdown → HTML      | 纯 JS、MIT、无原生、无网络   |
| `js-yaml` | 5.5.0  | YAML 解析与序列化    | 纯 JS、MIT、无原生、无网络   |

`js-yaml` 使用 `load`/`dump`（v4+ 已移除 `!!js/function` 等可执行类型），不接受自定义 schema；渲染安全由 §1 的 CSP + sandbox iframe 兜底。

## 8. R5 体积口径

无 worker / wasm / 模型 / 字体资产；`marked` 与 `js-yaml` 为该工具独占依赖，计入工具增量（预期 ≈50–70KB gzip，上限 200KB gzip）。交付时以 `pnpm build` 产物实测工具 chunk 与其独占依赖 chunk，记入 `docs/smoke/markdown-tool.md`。

## 9. 验收

- 单测：`markdown.test.ts`（标题/列表/表格/代码块/链接/XSS 转义与 CSP 注入/超限）、`json-to-ts.test.ts`（嵌套对象/数组联合/可选字段/字段名引号/声明方式/根名非法/嵌套过深）、`yaml.test.ts`（三模式/语法错误行列/空输入）、`save.test.ts`（清洗与扩展名）、`schema.test.ts`、`node.test.ts`（注入假 fs：写入/冲突/写失败/记忆目录）、`errors.test.ts`、`manifest.test.ts`；本包覆盖率 ≥80%。
- e2e `apps/desktop/e2e/markdown-tool-smoke.spec.ts` 4 用例：
  1. 页面加载 → 三页签可见 → 载入示例 → 预览 iframe 出现标题与表格 → 字符/行统计；
  2. JSON→TS：合法 JSON 生成 `export interface Root` → 非法 JSON 报 `MD_JSON_INVALID` → 恢复；
  3. YAML→JSON 得到美化 JSON → 切「JSON→YAML」输入 `{a:1}` 得到 `a: 1` → 非法 YAML 报 `MD_YAML_INVALID`；
  4. 导出 HTML：选目录 → 文件名 `中文 空格` → 产物存在且含 `<!doctype html>`；同名再导出生成 `(1)`。
- R2 八类映射记录于 `docs/smoke/markdown-tool.md`。
- `pnpm gate` / `pnpm coverage` / `pnpm build` / e2e 全绿；CHANGELOG 与 README 登记。

---

## M55 追加节（2026-11-22 R8 登记：plan Q56 / §4.55）

> 状态：待实施。原 spec 冻结项「JSON Schema 生成」解冻（Q56 拍板）。

- **字段级清单（JSON→TS 页签输出模式扩展）**
  1. 输出模式三选：`interface`（默认，现状）/ `type` / `json-schema`（JSON Schema draft-07）
  2. `json-schema` 模式规则：对象 → `type: object` + `properties` + `required`（出现过的键）；嵌套递归 `$defs` 引用；数组 → `items` 取首个元素类型并标注；整数 → `integer`；小数 → `number`；`null` → `{ "type": ["string","null"] }` 类 union；布尔各自独立；**字符串不猜 `format`**（不产生 format 字段）
  3. 复制/导出沿用既有 save 通道；非法 JSON 仍报 `MD_JSON_INVALID`（无新错误码）
  4. 空数组/空对象 → 照实输出 `type: array`（无 items）/ `type: object`（无 properties）
- **实现**：与 `json-to-ts` 同源遍历，新增 `jsonToSchema(value)` 纯函数；纯 renderer、零 IPC、零新增依赖
- **验收**：`jsonToSchema` 单测（嵌套/数组/整数/小数/null/布尔/空容器/required 集合/$defs 引用不重复）本包 ≥80%；e2e 新增「合法对象数组 → json-schema 模式 → 输出含 draft-07 与 properties」用例；R2 记入 `docs/smoke/markdown-tool.md` M55 增量节；chunk <200KB gzip
