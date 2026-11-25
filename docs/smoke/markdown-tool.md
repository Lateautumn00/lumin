# markdown-tool（Markdown 工具）冒烟与验收记录

> 版本：v0.1.0 · 日期：2026-11-21 · 里程碑 M39（plan §4.39）
> 规格：`docs/spec/markdown-tool.md` · 任务单：`docs/spec/markdown-tool-m39-tasks.md`

## 1. 结论

| 项          | 结果                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| 单测        | 64 通过（8 个测试文件，本包 lines/functions/statements/branches ≥80% 阈值启用并通过）                |
| e2e         | 4/4 通过（`apps/desktop/e2e/markdown-tool-smoke.spec.ts`）                                           |
| 全仓覆盖率  | statements 93.51% / branches 85.91% / functions 91.73% / lines 95.36%（`pnpm coverage` 通过）        |
| chunk（R5） | 工具 chunk + 独占依赖（marked + js-yaml）**228,922 B raw / 56,261 B gzip（55.0 KiB）**，< 200KB gzip |
| 运行时资产  | 无（无 worker/wasm/模型/字体）                                                                       |
| 依赖        | `marked` 18.2.1、`js-yaml` 5.5.0（精确钉版，plan §1.1）                                              |

## 2. 功能冒烟（e2e）

| #   | 场景                         | 断言                                                                                                                         |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | 页面加载 / 三页签 / 示例预览 | 标题、`Markdown`/`JSON→TS`/`YAML` 三页签可见；空态引导存在；载入示例后 iframe 内 `h1` 与 `table` 可见，统计非 0              |
| 2   | JSON→TS                      | 合法 JSON 生成 `export interface Root` 与 `name: string`；输入 `{` 报 `MD_JSON_INVALID` 且输出清空；恢复合法 JSON 后错误消失 |
| 3   | YAML                         | YAML→JSON 产出 `"a": 1` 与数组元素；JSON→YAML 产出 `a: 1`；`a: [` 报 `MD_YAML_INVALID`                                       |
| 4   | 导出 HTML                    | 中文+空格文件名成功写盘，内容含 `<!doctype html>`；同名二次导出生成 `中文 空格(1).html`                                      |

## 3. R2 八类异常映射

| #   | 异常          | 本工具处理                                                                                                | 验证                                                                                   |
| --- | ------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | 中文/空格路径 | 输出目录与文件名均支持中文、空格（不清洗空格，仅替换非法字符）                                            | e2e 4；`node.test.ts`「中文空格目录」                                                  |
| 2   | 文件被占用    | `writeAtomic` 失败（rename EPERM/EBUSY）→ `MD_SAVE_FAILED` + errno detail；输入与输出保留                 | `node.test.ts`「rename 失败归 MD_SAVE_FAILED 并带 errno」                              |
| 3   | 加密文件      | 不适用：本工具无文件输入（仅文本输入与文本导出）                                                          | —                                                                                      |
| 4   | 超大文件      | 渲染输入上限 2,000,000 字符 → `MD_INPUT_TOO_LONG`；导出内容上限 8,000,000 字符 → 主进程 `INVALID_PAYLOAD` | `markdown.test.ts` / `json-to-ts.test.ts` / `yaml.test.ts` / `schema.test.ts` 超限用例 |
| 5   | 任务取消      | 不适用：同步纯函数，无长任务与三段式通道；导出按钮写盘期间 `loading` 且禁用重复点击                       | spec §2.4 登记豁免                                                                     |
| 6   | 并发溢出      | 无队列；连续导出由 `resolveConflictPath` 串行递增 `(1)…(99)`，超限报 `MD_SAVE_FAILED`                     | e2e 4；`node.test.ts`「重名递增」「同名占用达上限」                                    |
| 7   | 磁盘满        | `mkdirSync`/`writeAtomic` 失败 → `MD_SAVE_FAILED` + errno detail（如 `ENOSPC`）                           | `node.test.ts`「目录不可建」「rename 失败」                                            |
| 8   | 断电恢复      | 原子写（临时文件 + rename），不存在半成品目标文件；崩溃残留临时文件不影响下次导出                         | `writeAtomic` 复用 `node-kit` 既有实现（同 qr-code/pdf-toolkit）                       |

## 4. 安全与已知限制

- 预览 `<iframe sandbox="">`（无 `allow-scripts`）+ 文档 CSP `default-src 'none'`，Markdown 内原始 HTML/脚本不执行；预览不加载外链图片（仅 `data:`/`blob:`）。
- 导出 HTML 注入 CSP（`default-src 'none'`、`form-action 'none'`、`base-uri 'none'`），浏览器打开亦禁止脚本；`img-src` 允许 `https:`/`http:`/`data:` 以便查看图片。
- YAML 使用 js-yaml `load`/`dump`，不注册自定义 schema；格式化会移除注释、展开锚点（页内已提示）。
- JSON→TS 不生成字面量类型（字符串/数字统一为 `string`/`number`）；嵌套命名按路径派生，冲突自动追加序号。
- 纯函数为同步计算，2MB 输入的单次耗时会随内容增长（Markdown 页签已 150ms 防抖；JSON/YAML 页签按输入变更即时计算）。

## 5. M55 ⑤ JSON Schema 增量（2026-11-22）

### 5.1 冒烟记录

| #   | 冒烟项            | 方式                                                | 结果                                                                                                         |
| --- | ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | 单测              | `pnpm exec vitest run packages/tools/markdown-tool` | ✅ 73 tests / 9 files（新增 `json-schema.test.ts` 9 例）                                                     |
| 2   | 覆盖率（R1 ≥80%） | `pnpm coverage`                                     | ✅ 通过；全仓 93.69 / 86.15 / 92.19 / 95.57（语句/分支/函数/行）                                             |
| 3   | 质量门禁          | `pnpm gate`（lint→typecheck→test→audit→boundary）   | ✅ 2526 passed / 1 skipped；audit 2 moderate（无 high/critical）；边界 0 违规                                |
| 4   | e2e 冒烟（R3）    | `playwright test e2e/markdown-tool-smoke.spec.ts`   | ⏳ 已新增第 3 条「json-schema → draft-07/$defs → 切回 interface」；本机沙箱无法启动 Electron，待 CI/本机验证 |
| 5   | 构建              | `pnpm --filter @lumin/desktop build`                | ✅ 正常产出                                                                                                  |
| 6   | chunk 体积（R5）  | 构建产物实测                                        | ✅ `markdown-tool-*.js` **57,159 B gzip < 200KB**                                                            |

### 5.2 R2 八类（JSON Schema 增量适用性）

| 类别             | 适用性 / 验证                                                            | 级别     |
| ---------------- | ------------------------------------------------------------------------ | -------- |
| 1. 中文/空格路径 | 导出路径逻辑未改；JSON Schema 仅影响文本生成                             | 静态审查 |
| 2. 文件被占用    | 沿用既有 `MD_SAVE_FAILED` + errno detail（导出 `.json` 同 `.ts` 通道）   | 既有单测 |
| 3. 加密文件      | 不涉及文件输入                                                           | —        |
| 4. 超大文件      | JSON 输入上限 2MB → `MD_INPUT_TOO_LONG`；嵌套 >64 层 → `MD_JSON_INVALID` | 单测     |
| 5. 任务取消      | 同步纯计算，无长任务                                                     | —        |
| 6. 并发溢出      | 无队列；连续导出沿用重名递增                                             | 既有单测 |
| 7. 磁盘满        | 沿用 `MD_SAVE_FAILED`                                                    | 既有单测 |
| 8. 断电恢复      | 导出沿用原子写                                                           | 既有实现 |

### 5.3 人工目视（待补录）

- [ ] 切 `json-schema` 后根名标签变「根标题」、文件名自动 `schema`、按钮变「导出 .json」
- [ ] 嵌套对象输出 `$defs/$ref`，数组 items 取首元素，整数/小数/null 类型符合预期
- [ ] 切回 `interface` 文件名回 `types`、导出扩展名回 `.ts`

## 6. M67 CodeMirror 编辑 + 已有 .md 读写（2026-11-24）

> 规格：`docs/spec/markdown-tool.md` §M67 · 决策：用户拍板「换 CodeMirror 编辑区」「覆盖原文件 + 另存为」

### 6.1 冒烟记录

| #   | 冒烟项            | 方式                                                       | 结果                                                                                                                               |
| --- | ----------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 单测              | `pnpm vitest run packages/tools/markdown-tool packages/ui` | ✅ markdown 109 例（11 文件，含 `editor-format` 19 例）/ ui 21 例（create-editor 7 例：语法高亮 2 + 选区读写与撤销重做 2）全绿     |
| 2   | 覆盖率（R1 ≥80%） | `pnpm coverage`                                            | ✅ 退出码 0；全仓 语句 94.66% / 分支 87.97% / 函数 93.08% / 行 96.15%（本包 80% 分组阈值通过）                                     |
| 3   | 质量门禁          | `pnpm gate`                                                | ✅ lint → typecheck → test（3433 passed / 310 files）→ audit（2 条 moderate 已知例外）→ boundary（0 违规）                         |
| 4   | e2e 冒烟（R3）    | `playwright test e2e/markdown-tool-smoke.spec.ts`          | ✅ 7 例全绿（含 `cm-line span` 语法高亮断言、工具栏粗体后正文出现 `**`、编辑区随窗口拉伸、open-file/save-file mtime 冲突与 force） |
| 5   | 构建              | `pnpm build`                                               | ✅ 通过                                                                                                                            |
| 6   | chunk 体积（R5）  | 构建产物实测（`node zlib` level 9）                        | ✅ 见 6.2                                                                                                                          |

### 6.2 R5 体积实测

> 2026-11-24 工具栏 + 状态栏落地后重新构建实测（`node zlib` level 9）；chunk 文件名含内容哈希，仅作本次记录。

| 文件                                                                                                           | raw (B)     | gzip (B)    | 归属                                    |
| -------------------------------------------------------------------------------------------------------------- | ----------- | ----------- | --------------------------------------- |
| `markdown-tool-EDnngAJA.js`（工具代码 + js-yaml + editor-format）                                              | 194,593     | 46,271      | 本工具独占                              |
| `markdown-4EOiH1Rs.js`（marked 18.2.1）                                                                        | 68,261      | 19,126      | 本工具独占                              |
| `create-editor-BilfY0bc.js`（`@lumin/ui/create-editor` 包装）                                                  | 3,538       | 1,383       | 本工具 + text-editor 共享，首次加载计入 |
| `dist-Cd5Ehdq0.js`（@codemirror/lang-markdown + @lezer/markdown，含 lang-html/css/javascript 与 autocomplete） | 323,526     | 103,045     | 本工具独占（仅 Markdown 语法高亮加载）  |
| **本工具增量合计**                                                                                             | **589,918** | **169,825** | **< 200KB gzip（占 82.9%），达标**      |
| `dist-ChOqyWHd.js`（@codemirror/view）                                                                         | 377,367     | 99,976      | 共享 vendor，不计入                     |
| `dist-B1D0oc76.js`（@codemirror/state + find-cluster-break）                                                   | 121,707     | 32,923      | 共享 vendor，不计入                     |
| `dist-BsaIz2DD.js`（@codemirror/commands）                                                                     | 76,534      | 16,369      | 共享 vendor，不计入                     |
| `dist-_5SobO52.js`（@codemirror/search）                                                                       | 41,325      | 10,996      | 共享 vendor，不计入                     |
| `dist-q2NQ4DsZ.js`（@codemirror/language + @lezer/highlight）                                                  | 173,337     | 48,480      | 共享 vendor，不计入                     |

- CodeMirror 共享 vendor 合计 208,744 B gzip：`commands` 静态依赖 `@codemirror/language`，text-editor 同样加载，故按 R5「增量不含共享 vendor」口径不计入本工具。
- `@codemirror/lang-markdown` 静态引入 `@codemirror/lang-html` → `lang-css`/`lang-javascript`（代码块内嵌高亮与 HTML 标签补全），是该 chunk 103,045 B gzip 的主因；无更小公开入口，暂接受。
- 语法高亮前（55 行旧记录）的 42,851 B gzip 仅含工具 chunk + create-editor，未计入独立的 marked chunk（19,126 B gzip）；本次一并纠正口径。

### 6.3 R2 八类（M67 增量适用性）

| #   | 异常          | 本工具处理                                                                                            | 验证                                                    |
| --- | ------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | 中文/空格路径 | 打开/另存为路径含中文与空格均可读写；文件名去扩展名用于 HTML 导出默认名                               | `node.test.ts`「显式路径读取 UTF-8 文件」               |
| 2   | 文件被占用    | 读/写遇 EBUSY/EPERM/EACCES → `MD_LOCKED`（保留当前正文与修改）                                        | `node.test.ts`「读取期 errno 映射」「写盘 errno 映射」  |
| 3   | 加密文件      | 无法按 UTF-8 解码时返回乱码文本（不报错），由用户自行判断；不写入                                     | 静态审查（Markdown 为纯文本，无解密能力）               |
| 4   | 超大文件      | 打开 >5 MiB → `MD_FILE_TOO_LARGE` 且不读入内存；编辑内容上限 8,000,000 字符                           | `node.test.ts`「超过 5 MiB」；`schema.test.ts` 超限用例 |
| 5   | 任务取消      | 打开/保存为同步短通道（`stat`+读/写），对话框取消返回 `null` 不改状态；无长任务                       | `node.test.ts`「取消返回 null」                         |
| 6   | 并发溢出      | 无队列；`mdOpening/mdSaving` 防重复触发；外部程序同时改文件 → mtime 冲突 `MD_FILE_CHANGED` 弹覆盖确认 | `node.test.ts`「mtime 冲突 + force」                    |
| 7   | 磁盘满        | `writeAtomic` 失败 → `MD_SAVE_FAILED` + errno detail                                                  | 既有 `node.test.ts` 写失败用例                          |
| 8   | 断电恢复      | 覆盖保存与另存为均走 `.tmp` + rename 原子写，不产生半成品；编辑器脏状态由 `beforeunload` 拦截关闭     | `writeAtomic` 既有实现 + UI 守卫                        |

### 6.4 人工目视（待补录）

- [ ] 点击「打开 .md」→ 系统对话框选中中文路径文件 → 编辑区出现正文、文件路径显示、预览同步
- [ ] 修改后出现「未保存 ●」；`Ctrl+S` 覆盖原文件，磁盘内容更新、标记消失
- [ ] 外部程序修改同一文件后再保存 → 弹「文件已被修改」→ 选「覆盖保存」落盘
- [ ] 未命名文档点「保存」→ 弹系统保存对话框（另存为）→ 落盘后路径与文件名更新
- [ ] 有未保存修改时点「打开 .md」→ 先确认放弃；有未保存修改时关闭窗口 → 拦截提示
- [ ] 点「查找」→ CodeMirror 搜索面板出现，可定位文本
- [ ] 工具栏逐项目视：粗体/斜体/删除线/行内代码包裹后可再次点击取消；标题/引用/无序/有序/任务列表按整行加前缀并可取消（有序列表逐行递增）；代码块/表格/分隔线按模板插入；撤销/重做生效
- [ ] 状态栏：初始显示「已保存」；输入后变「未保存 ●」；移动光标时「行 x, 列 y」实时更新；保存后回到「已保存」
- [ ] 拉伸窗口：编辑卡片与预览区高度同步增减（不再固定高度），窗口较矮时在页签内滚动而不挤压工具栏
