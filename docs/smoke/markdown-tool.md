# markdown-tool（Markdown 工具）冒烟与验收记录

> 版本：v0.1.0 · 日期：2026-11-21 · 里程碑 M39（plan §4.39）
> 规格：`docs/spec/markdown-tool.md` · 任务单：`docs/spec/markdown-tool-m39-tasks.md`

## 1. 结论

| 项 | 结果 |
| --- | --- |
| 单测 | 64 通过（8 个测试文件，本包 lines/functions/statements/branches ≥80% 阈值启用并通过） |
| e2e | 4/4 通过（`apps/desktop/e2e/markdown-tool-smoke.spec.ts`） |
| 全仓覆盖率 | statements 93.51% / branches 85.91% / functions 91.73% / lines 95.36%（`pnpm coverage` 通过） |
| chunk（R5） | 工具 chunk + 独占依赖（marked + js-yaml）**228,922 B raw / 56,261 B gzip（55.0 KiB）**，< 200KB gzip |
| 运行时资产 | 无（无 worker/wasm/模型/字体） |
| 依赖 | `marked` 18.2.1、`js-yaml` 5.5.0（精确钉版，plan §1.1） |

## 2. 功能冒烟（e2e）

| # | 场景 | 断言 |
| --- | --- | --- |
| 1 | 页面加载 / 三页签 / 示例预览 | 标题、`Markdown`/`JSON→TS`/`YAML` 三页签可见；空态引导存在；载入示例后 iframe 内 `h1` 与 `table` 可见，统计非 0 |
| 2 | JSON→TS | 合法 JSON 生成 `export interface Root` 与 `name: string`；输入 `{` 报 `MD_JSON_INVALID` 且输出清空；恢复合法 JSON 后错误消失 |
| 3 | YAML | YAML→JSON 产出 `"a": 1` 与数组元素；JSON→YAML 产出 `a: 1`；`a: [` 报 `MD_YAML_INVALID` |
| 4 | 导出 HTML | 中文+空格文件名成功写盘，内容含 `<!doctype html>`；同名二次导出生成 `中文 空格(1).html` |

## 3. R2 八类异常映射

| # | 异常 | 本工具处理 | 验证 |
| --- | --- | --- | --- |
| 1 | 中文/空格路径 | 输出目录与文件名均支持中文、空格（不清洗空格，仅替换非法字符） | e2e 4；`node.test.ts`「中文空格目录」 |
| 2 | 文件被占用 | `writeAtomic` 失败（rename EPERM/EBUSY）→ `MD_SAVE_FAILED` + errno detail；输入与输出保留 | `node.test.ts`「rename 失败归 MD_SAVE_FAILED 并带 errno」 |
| 3 | 加密文件 | 不适用：本工具无文件输入（仅文本输入与文本导出） | — |
| 4 | 超大文件 | 渲染输入上限 2,000,000 字符 → `MD_INPUT_TOO_LONG`；导出内容上限 8,000,000 字符 → 主进程 `INVALID_PAYLOAD` | `markdown.test.ts` / `json-to-ts.test.ts` / `yaml.test.ts` / `schema.test.ts` 超限用例 |
| 5 | 任务取消 | 不适用：同步纯函数，无长任务与三段式通道；导出按钮写盘期间 `loading` 且禁用重复点击 | spec §2.4 登记豁免 |
| 6 | 并发溢出 | 无队列；连续导出由 `resolveConflictPath` 串行递增 `(1)…(99)`，超限报 `MD_SAVE_FAILED` | e2e 4；`node.test.ts`「重名递增」「同名占用达上限」 |
| 7 | 磁盘满 | `mkdirSync`/`writeAtomic` 失败 → `MD_SAVE_FAILED` + errno detail（如 `ENOSPC`） | `node.test.ts`「目录不可建」「rename 失败」 |
| 8 | 断电恢复 | 原子写（临时文件 + rename），不存在半成品目标文件；崩溃残留临时文件不影响下次导出 | `writeAtomic` 复用 `node-kit` 既有实现（同 qr-code/pdf-toolkit） |

## 4. 安全与已知限制

- 预览 `<iframe sandbox="">`（无 `allow-scripts`）+ 文档 CSP `default-src 'none'`，Markdown 内原始 HTML/脚本不执行；预览不加载外链图片（仅 `data:`/`blob:`）。
- 导出 HTML 注入 CSP（`default-src 'none'`、`form-action 'none'`、`base-uri 'none'`），浏览器打开亦禁止脚本；`img-src` 允许 `https:`/`http:`/`data:` 以便查看图片。
- YAML 使用 js-yaml `load`/`dump`，不注册自定义 schema；格式化会移除注释、展开锚点（页内已提示）。
- JSON→TS 不生成字面量类型（字符串/数字统一为 `string`/`number`）；嵌套命名按路径派生，冲突自动追加序号。
- 纯函数为同步计算，2MB 输入的单次耗时会随内容增长（Markdown 页签已 150ms 防抖；JSON/YAML 页签按输入变更即时计算）。
