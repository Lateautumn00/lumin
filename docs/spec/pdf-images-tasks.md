# PDF 图片转换 M34 增强任务单

> 规格：`docs/spec/pdf-images.md` §10 · 分支：`feature/m34-pdf-images-pages` · 日期：2026-11-21
> 范围：仅增强 `packages/tools/pdf-images` 的「图片转 PDF」页签，**不新建工具包**、零新增第三方依赖。

## 任务清单

| 编号 | 任务 | 文件 | 验收 |
| ---- | ---- | ---- | ---- |
| [x] T0 | 分支与契约设计 | `git checkout -b feature/m34-pdf-images-pages` | 工作区干净，规格 §10 落盘 |
| [x] T1 | schema 扩展 | `src/schema.ts` | `PAGE_SIZES` 含 `letter`；`orientation` 默认 `auto`；`outputNameSchema` 拒绝路径分隔符/非法字符/结尾点；payload/request 类型同步 |
| [x] T2 | 布局与命名纯函数 | `src/contract.ts` | `LETTER_*_PT`；`pageLayout` 替换 `a4Layout`（auto 忽略方向/边距，fixed 方向取长短边、contain 居中、可用区不足 `null`）；`pdfOutputName` |
| [x] T3 | worker 出页与命名 | `src/images.worker.ts` | 统一用 `pageLayout`；`outputName` 经 `pdfOutputName` + `basename` + `uniqueFileName` |
| [x] T4 | node 请求透传 | `src/node.ts` | `orientation` / `outputName` 透传；未填 `outputName` 不写入请求；预检与引擎逻辑不变 |
| [x] T5 | UI 控件 | `src/renderer/ToolView.vue` | 纸型下拉（auto/a4/letter）、方向单选、边距单选（0/10/20/40）、输出文件名输入；auto 模式隐藏方向/边距；运行中全部禁用 |
| [x] T6 | 单测 | `src/contract.test.ts` / `src/images.worker.test.ts` / `src/node.test.ts` | `pageLayout` 分支全覆盖；Letter 横版 MediaBox `792×612`；自定义名与冲突 `(1)`；非法入参 `INVALID_PAYLOAD`；本包核心纯函数 ≥80% |
| [x] T7 | e2e | `apps/desktop/e2e/pdf-images-smoke.spec.ts` | 新增 1 例（Letter + 横版 + 20mm + `自定义 名称`），断言 2 页 MediaBox、文件名、重复递增 |
| [x] T8 | 文档同步 | `docs/spec/pdf-images.md`（已完成）/ `docs/smoke/pdf-images.md` / `docs/opencode/plan.md`（Q36、§4.34、M34）/ `CHANGELOG.md` / `README.md`+`README.en.md` | 记录实测覆盖率、chunk、e2e 结果 |
| [x] T9 | 全量验证与提交 | — | `vitest` → `typecheck` → `lint` → `coverage` → `gate` → `build` → e2e；3 个中文提交（feat/test/docs），不推送 |

## 提交计划

1. `feat(pdf-images): 图片转 PDF 支持 Letter/方向/边距预设与自定义文件名（M34）` —— T1–T5
2. `test(pdf-images): 补布局/命名/透传单测与 Letter e2e 用例` —— T6–T7
3. `docs(pdf-images): 登记 M34 规格、任务单、冒烟与路线图` —— T8

## 验证命令

```powershell
pnpm exec vitest run packages/tools/pdf-images
pnpm typecheck
pnpm lint
pnpm coverage
pnpm gate
pnpm build
pnpm --filter @lumin/desktop exec playwright test e2e/pdf-images-smoke.spec.ts
```

## 风险与回退

- 现有 e2e/单测请求体不含 `orientation`：zod 默认 `auto` 兜底，行为与旧版一致（`auto` 页型忽略方向/边距）
- 未自定义文件名时输出仍为 `{首图基名}_合并.pdf`，不改变既有断言
- 纯前端/纯函数改动，无数据库/依赖/壳契约变更；回退 = revert 三个提交
