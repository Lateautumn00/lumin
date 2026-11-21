# ocr-text（M20）实施任务清单

> 配套规格：`docs/spec/ocr-text.md`（已含字段级契约）
> 前置：用户批准本清单；新建分支 `feature/m20-ocr-text`
> 顺序：先上提引擎并验证 exam-split 零回归，再新建工具，最后文档与门禁

---

## [x] T1 OCR 引擎上提（`packages/ocr-kit`）

**新建**

- `packages/ocr-kit/package.json`（`@lumin/ocr-kit`；依赖 node-kit/shared/canvas/onnxruntime-node；devDep pdfjs-dist）
- `packages/ocr-kit/tsconfig.json`（extends `../../tsconfig.base.json`）
- `packages/ocr-kit/src/errors.ts`：`OCR_KIT_ERROR_CODES`、`ocrToolError(code, detail?)`、`isOcrKitError`
- `packages/ocr-kit/src/preproc.ts`、`post.ts`、`model.ts`、`assets.ts`、`render.ts`
- `packages/ocr-kit/src/index.ts`：统一 re-export

**搬移规则**

- 逐字搬移 exam-split 的 `ocr-preproc/ocr-post/ocr-model/ocr-assets`；仅改 import 路径与错误来源（`./errors` → kit `errors`）
- `render.ts`：`RenderOptions` 新增可选 `scale`；PDF 渲染用 `options.scale ?? DEFAULT_RENDER_SCALE`（`DEFAULT_RENDER_SCALE = 2`）；不再依赖 `preview.ts`

**接线**

- `packages/tools/exam-split/package.json`：加 `@lumin/ocr-kit: workspace:*`
- `apps/desktop/electron.vite.config.ts`：加 `@lumin/ocr-kit` 别名
- `.dependency-cruiser.cjs`：`tools-only-allowed-deps` 白名单加 `ocr-kit`
- `vitest.config.ts`：加 `packages/ocr-kit/src/**/*.ts` 80% 阈值
- `AGENTS.md` §2.2：允许依赖加 `ocr-kit`（同步 plan）

## [x] T2 exam-split 薄壳化

**修改**

- `src/ocr-preproc.ts`、`src/ocr-post.ts`、`src/ocr-model.ts`、`src/ocr-assets.ts` → `export * from '@lumin/ocr-kit'`
- `src/ocr-render.ts` → re-export kit + 本地 `renderOcrInput` 包装注入 `scale: PDF_RENDER_SCALE`；保留 `export { PDF_RENDER_SCALE } from './preview'`、`export { ensureCjkFont } from '@lumin/node-kit/pdf'`

**验证（不改任何 exam-split 测试文件）**

- `pnpm install`
- `pnpm exec vitest run --project @lumin/tool-exam-split`

## [x] T3 新工具骨架

**新建**

- `packages/tools/ocr-text/package.json`（exports `manifest`/`node`/`renderer/*`；依赖 ocr-kit/node-kit/plugin-api/shared/ui/vue/naive-ui/zod/@lucide/vue）
- `packages/tools/ocr-text/tsconfig.json`
- `src/manifest.ts`：`defineManifest({ id:'ocr-text', name:'图片文字识别', description:'图片 OCR：提取文字、可编辑预览、复制与导出 TXT', icon:'scan-text', order:90, version:'0.1.0' })`
- `src/errors.ts`：§6 错误码 + `toolError` + `isRetryable`（`isStructuredError/errnoCode` 委托 shared）
- `src/schema.ts`：§5.1 全部 schema 与类型
- `src/text-lines.ts`：`sortReadingOrder(lines)`（按行聚类：纵向重叠 >50% 视为同行，行内按 x）、`composeText(lines)`（`\n` 拼接）
- `src/recognize.ts`：`runRecognize(request, deps, emit)` 编排（render → engine.detectLines → sort → compose；0 行 → `OCR_NO_TEXT`；非结构化异常 → `OCR_FAILED`）
- `src/ocr.worker.ts`：真实 deps（`renderOcrInput`/`createOcrEngine`）+ `exposeTask`
- `src/node.ts`：`OcrTextDeps`、`registerWith(ctx, deps)`（recognize/save-txt/config）、`createNodeDeps(binariesRoot)`、`registerMain`

## [x] T4 shell 注册（每处 1 行）

- `apps/desktop/src/tool-manifests.ts`：import + 数组追加 `ocrTextManifest`
- `apps/desktop/src/main/tool-mains.ts`：import + `'ocr-text': ocrTextRegisterMain`
- `apps/desktop/src/renderer/src/tools/ocr-text.vue`：薄壳 import `@lumin/tool-ocr-text/renderer/ToolView.vue`
- `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：import `ScanText` + iconMap `'scan-text': ScanText`
- `apps/desktop/package.json`：devDep `@lumin/tool-ocr-text: workspace:*`
- `apps/desktop/electron.vite.config.ts`：`manifest`/`node`/`renderer/*` 三组别名

## [x] T5 渲染端 UI

- `src/renderer/client.ts`：`recognize` / `saveTxt` / `config` / `cancelTask` / `pickDirectory` / `revealPath`
- `src/renderer/ToolView.vue`：空态（DropZone）→ 加载态（TaskProgress 可取消）→ 报错态（文案 + 重试/重选）→ 结果态（缩略图、可编辑 textarea、统计、复制、导出、重新识别/选择）
- 任务事件订阅/清理、objectURL 释放、卸载时取消订阅

## [x] T6 单测（新增）

- `src/manifest.test.ts`、`src/schema.test.ts`、`src/errors.test.ts`
- `src/text-lines.test.ts`：同行乱序、跨行、纵向重叠、空数组
- `src/recognize.test.ts`：假 engine/render（正常、0 行→`OCR_NO_TEXT`、异常→`OCR_FAILED`、结构化透传、进度事件）
- `src/node.test.ts`：假 deps（zod 拒绝、>20MB、ENOENT/EBUSY 映射、kit 码归一、超时/崩溃映射、save-txt 重名递增与写失败、config 缺省/记忆）

## [x] T7 e2e（`apps/desktop/e2e/ocr-text-smoke.spec.ts`）

- 页面加载/空态/导航
- 损坏图片 → `OCR_INPUT_INVALID`（R2.3）
- 空白图 → `OCR_NO_TEXT`
- 中文+空格目录导出 TXT（R2.1），编辑后内容一致
- 并发 save-txt（R2.6）文件名不冲突
- 正向识别：canvas 合成大号黑字图，断言文本框非空且包含关键字；`binaries/ocr` 缺失时 `test.skip`

## [x] T8 文档登记

- `docs/smoke/ocr-text.md`：R2 八类逐条（中文路径/占用/加密(不适用说明)/超大/取消/并发/磁盘满/断电恢复）+ chunk 与单图耗时记录
- `docs/opencode/plan.md`：§1 加 Q24；新增 §4.20；§3 目录树加 `ocr-kit` 与 `tools/ocr-text`；§6 加 M20
- `AGENTS.md` §2.2（若 T1 未改）
- `CHANGELOG.md`、`README.md`、`README.en.md`（若存在）工具列表与能力说明
- `vitest.config.ts`：`packages/tools/ocr-text/src/**/*.ts` 80% 阈值

## [x] T9 门禁与提交

顺序执行：

1. `pnpm install`
2. `pnpm --filter @lumin/desktop typecheck`
3. `pnpm exec vitest run --project @lumin/tool-exam-split`
4. `pnpm exec vitest run --project @lumin/tool-ocr-text`
5. `pnpm --filter @lumin/desktop build`
6. `pnpm --filter @lumin/desktop exec playwright test e2e/ocr-text-smoke.spec.ts`
7. `pnpm coverage`
8. `pnpm gate`

全绿后 3 个中文提交（不推送）：

- `feat: 新增图片文字识别工具并上提 OCR 引擎共享包`
- `test: ocr-text 单测与 e2e 冒烟`
- `docs: 登记 M20 ocr-text 规格、冒烟与规划`

---

## 完成定义（DoD）

- 规格 §8 八条验收全部可复现通过
- exam-split 全量测试零回归
- 门禁全绿；无 `any`、无 console、无新增第三方依赖
- 仅新增/修改本清单列出的文件

---

## M49 附加任务（双模式合并，2026-11-21）

> 主清单：`docs/spec/m49-pdf-ocr-consolidate-tasks.md` T3–T6；本文件登记 ocr-text 侧变更。

- [x] 包迁移：删除旧单张实现，`batch-ocr` 目录内容整体迁入 `packages/tools/ocr-text`（`@lumin/tool-ocr-text`）
- [x] 身份恢复：manifest `id: 'ocr-text'` / `图片文字识别` / icon `scan-text` / order 90；通道前缀 `ocr-text:*`；目录记忆键 `tools.ocr-text.outputDir`
- [x] 错误码归一：`BO_*` → `OCR_*`（含 `BO_OCR_FAILED → OCR_FAILED`、`BO_TOO_MANY_FILES → OCR_TOO_MANY_FILES`），导出 `OCR_TEXT_ERROR_CODES` / `OcrTextErrorCode`
- [x] worker 重命名：`batch.worker.ts` → `ocr.worker.ts`，`handleBatchOcrTask` → `handleOcrTextTask`
- [x] UI 双模式：`mode: 'single' | 'batch'`（默认单张、运行中禁切换、切换清空）；单张选图自动识别；批量列表 + 逐项状态 + 失败不中断
- [x] 测试同步：`ocr.worker.test.ts`、`schema/manifest/errors/recognize/node/client` 断言更新；删除 `batch-ocr-smoke.spec.ts`，重写 `ocr-text-smoke.spec.ts` 为双模式 4 用例
- [x] 文档同步：`docs/spec/ocr-text.md` 重写为双模式；`docs/spec/batch-ocr.md`、`docs/smoke/batch-ocr.md` 删除；`docs/smoke/ocr-text.md` 合并重写
