# M39 Markdown 工具 任务单

> 里程碑：M39（plan §4.39 / §6）· 规格：`docs/spec/markdown-tool.md`
> 分支：`feature/m39-markdown-tool` · 提交粒度：feat → test → docs（小步、不混编）

## 1. 规格与依赖

- [x] `docs/spec/markdown-tool.md` 定稿并经用户确认
- [x] plan §1 决策表新增 Q39、§1.1 版本基线登记 `marked 18.2.1` / `js-yaml 5.5.0`、§4.39、§6 M39 行
- [x] `AGENTS.md` §1 锁定技术栈同步新增依赖（R8）
- [x] `pnpm-workspace.yaml` 无需 `allowBuilds`（两个依赖均无 postinstall）

## 2. 工具包骨架

- [x] `packages/tools/markdown-tool/package.json`（exports manifest/node/renderer，精确钉版依赖）
- [x] `packages/tools/markdown-tool/tsconfig.json`
- [x] `src/manifest.ts`（id/name/icon/category/order/version 按 spec §6）
- [x] `src/errors.ts`（6 个 `MD_*` 错误码 + `toolError`/`errorMessage`）
- [x] `src/schema.ts`（zod：save/config/set-output-dir）

## 3. 纯函数

- [x] `src/markdown.ts`：`renderMarkdown` / `buildHtmlDocument` / `escapeHtml` / 上限常量
- [x] `src/json-to-ts.ts`：`generateTypes`（对象/数组/联合/可选/命名冲突/引号键/深度上限/根名校验）
- [x] `src/yaml.ts`：`yamlToJson` / `jsonToYaml` / `formatYaml`（行列错误定位）
- [x] `src/save.ts`：`sanitizeBaseName` / `EXTENSIONS` / `isSaveExtension`

## 4. 主进程

- [x] `src/node.ts`：`config` / `set-output-dir` / `save` 三通道（`registerWith` 可注入 fs）
- [x] 默认输出目录 `userData/markdown`；冲突递增复用 `@lumin/node-kit`；原子写 UTF-8

## 5. 渲染层

- [x] `src/renderer/ToolView.vue`：三页签（Markdown / JSON→TS / YAML）+ 三态 + 复制/导出
- [x] Markdown 预览 iframe（`sandbox` 空值 + srcdoc），示例/清空/统计
- [x] JSON→TS：根类型名、声明方式、输出只读区、报错行
- [x] YAML：三模式切换、输出扩展名联动
- [x] 复制失败 / 导出失败的结构化错误展示

## 6. 单测

- [x] `markdown.test.ts`、`json-to-ts.test.ts`、`yaml.test.ts`、`save.test.ts`
- [x] `schema.test.ts`、`node.test.ts`、`errors.test.ts`、`manifest.test.ts`
- [x] 本包覆盖率 lines/functions/statements/branches ≥80%

## 7. 壳接线

- [x] `electron.vite.config.ts` 三条别名
- [x] `apps/desktop/package.json` 依赖 1 行
- [x] `src/tool-manifests.ts` import + 数组 1 行
- [x] `src/main/tool-mains.ts` import + 数组 1 行
- [x] `src/renderer/src/tools/markdown-tool.vue` 薄页面
- [x] `AppSidebar.vue` iconMap 新增 `file-code`
- [x] `vitest.config.ts` 覆盖率阈值新增本包

## 8. 端到端与冒烟

- [x] `apps/desktop/e2e/markdown-tool-smoke.spec.ts` 4 用例（预览 / JSON→TS / YAML / 导出冲突）
- [x] `docs/smoke/markdown-tool.md`（总览 + R2 八类映射 + chunk 实测）
- [x] 实测 `pnpm --filter @lumin/desktop build` 后工具 chunk 与独占依赖 chunk gzip，记入 smoke

## 9. 收尾

- [x] `CHANGELOG.md` 新增 M39 条目
- [x] `README.md` / `README.en.md` 工具清单新增 1 行
- [x] `pnpm coverage`、`pnpm gate`、e2e 全绿
- [x] 清理临时文件与调试残留
- [x] 三次提交：`feat(markdown-tool)` / `test(markdown-tool)` / `docs(markdown-tool)`
