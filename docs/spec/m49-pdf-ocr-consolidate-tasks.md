# M49 实施任务清单（PDF 收敛 + OCR 双模式合并）

> 配套规格：`docs/spec/m49-pdf-ocr-consolidate.md`
> 分支：`feature/m49-pdf-ocr-consolidate`（自 `feature/m48-dedupe-cleanup`）
> 前置：**用户批准本清单**；不 push、不合并 master
> 顺序：先 exam-split 收敛 → 再 OCR 包合并 → 壳接线 → 测试 → 文档 → 门禁提交

---

## [x] T1 exam-split PDF 收敛（代码）

**修改**

- `packages/tools/exam-split/src/manifest.ts`：description 收敛（见规格 §1.3）
- `src/schema.ts`：删除 merge/delete/rotate 三组 schema 与类型
- `src/pdf-ops.ts`：删除 `mergePdf` / `deletePages` / `rotatePages`；`WorkerRequest` 收窄为 `split | crop`；清理 import
- `src/naming.ts`：删除 `mergeDesiredPath` / `deleteDesiredPath` / `rotateDesiredPath`
- `src/node.ts`：删除 merge/delete/rotate 通道与 schema import；注释改为四通道
- `src/renderer/client.ts`：删除 `submitMerge` / `submitDelete` / `submitRotate`
- `src/renderer/ToolView.vue`：
  - `Op = 'split' | 'crop'`；`OPS` 两项
  - 删除合并列表、拖拽排序、旋转角度及全部相关状态/模板
  - 左栏固定 `PdfPreview`；右栏固定单文件 `DropZone`
  - 新增「合并、删页、旋转、重排等请使用『PDF 工具集』」引导文案

**验证**

- `pnpm --filter @lumin/tool-exam-split typecheck`
- `pnpm vitest run --project @lumin/tool-exam-split --coverage.enabled=false`

## [x] T2 exam-split 测试同步

**修改**

- `src/schema.test.ts`：删 merge/delete/rotate 用例
- `src/pdf-ops.test.ts`：删 merge/delete/rotate 用例
- `src/pdf-ops.writefail.test.ts`：删相关写失败用例
- `src/naming.test.ts`：删三个命名函数用例
- `src/node.test.ts`：通道集合改为 `split/crop/ocr-detect/ocr-export`
- `src/renderer/client.test.ts`：删三个 submit 用例
- `apps/desktop/e2e/exam-split-smoke.spec.ts`：PDF 段仅保留 split/crop；断言无合并/删页/旋转按钮与引导文案可见

**验证**

- exam-split 全量单测零失败
- e2e 用例语法与选择器自检（无沙箱时标注待 CI）

## [x] T3 OCR 包合并（迁移）

**执行**

1. `git rm -r packages/tools/ocr-text`
2. `git mv packages/tools/batch-ocr packages/tools/ocr-text`
3. 包内重命名：
   - `package.json` name → `@lumin/tool-ocr-text`
   - `src/manifest.ts` → id `ocr-text` / 名称 `图片文字识别` / 描述见规格 / icon `scan-text` / order 90
   - `src/batch.worker.ts` → `src/ocr.worker.ts`，`handleBatchOcrTask` → `handleOcrTextTask`
   - `src/node.ts` → `OcrTextDeps`、worker import、默认目录 `ocr-text`、日志名
   - `src/errors.ts` → 全部 `BO_*` 改 `OCR_*`（含 `BO_OCR_FAILED` → `OCR_FAILED`、`BO_TOO_MANY_FILES` → `OCR_TOO_MANY_FILES`），导出名改 `OCR_TEXT_ERROR_CODES` / `OcrTextErrorCode`
   - `src/recognize.ts` / `src/schema.ts`：错误码与注释同步
   - `src/renderer/client.ts`：通道 `ocr-text:*`

**验证**

- `pnpm --filter @lumin/tool-ocr-text typecheck`

## [x] T4 OCR 双模式 UI

**修改 `src/renderer/ToolView.vue`**

- 新增 `mode: 'single' | 'batch'`，默认 `single`；运行中禁用切换；切换时清空列表/结果/错误并释放 objectURL
- 单张模式：
  - 单选 `DropZone`，选择后自动 `startRecognize([path])`
  - 结果区：缩略图、名称、宽高、字数、可编辑 textarea
  - 操作：复制文本、导出 TXT（per-file）、重新识别、重新选择
- 批量模式：保留现有列表、状态标签、逐项移除、重试失败项、复制全部、逐张/合并导出、更改目录、清空
- 空态/加载态（可取消）/报错态（码+文案+detail+重试）两模式齐全
- 第 51 张或超 20MB 时给出中文提示

**验证**

- `pnpm --filter @lumin/tool-ocr-text typecheck`
- 手动冒烟（开发态）：单张自动识别、批量 2 张一好一坏、两种导出

## [x] T5 OCR 测试同步

**修改**

- `src/batch.worker.test.ts` → `src/ocr.worker.test.ts`（重命名 + handler/错误码）
- `src/errors.test.ts`、`src/manifest.test.ts`、`src/node.test.ts`、`src/recognize.test.ts`、`src/schema.test.ts`、`src/renderer/client.test.ts`：错误码/通道/身份断言更新
- `apps/desktop/e2e/batch-ocr-smoke.spec.ts`：删除
- `apps/desktop/e2e/ocr-text-smoke.spec.ts`：重写为双模式（单张自动识别/导出；批量 2 张含损坏项；逐张与合并导出；取消；空态）

**验证**

- `pnpm vitest run --project @lumin/tool-ocr-text --coverage.enabled=false`

## [x] T6 壳接线清理

**修改/删除**

- `apps/desktop/src/tool-manifests.ts`：删 `batchOcrManifest`
- `apps/desktop/src/main/tool-mains.ts`：删 `'batch-ocr'`
- `apps/desktop/electron.vite.config.ts`：删 batch-ocr 三组别名
- `apps/desktop/package.json`：删 `@lumin/tool-batch-ocr`
- `apps/desktop/src/renderer/src/tools/batch-ocr.vue`：删除
- `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：删 `FileScan` / `'file-scan'`
- `vitest.config.ts`：删 batch-ocr 阈值
- `pnpm install` 更新 lockfile

**验证**

- `pnpm --filter @lumin/desktop typecheck`
- `pnpm --filter @lumin/desktop build`

## [x] T7 文档登记

**修改/删除**

- `docs/spec/exam-split.md`：能力矩阵/字段/错误入口收敛 + 引导说明
- `docs/smoke/exam-split.md`：删 merge/delete/rotate 记录
- `docs/spec/ocr-text.md`：按双模式重写（字段矩阵、IPC、错误码、导出规则）
- `docs/spec/batch-ocr.md`：删除
- `docs/smoke/ocr-text.md`：合并 batch 冒烟与单张记录
- `docs/smoke/batch-ocr.md`：删除
- `docs/spec/ocr-text-tasks.md`：追加 M49 小节
- `docs/opencode/plan.md`：§1 Q49、§4.49、§6 M49
- `CHANGELOG.md`：`[Unreleased]` 新增 M49
- `README.md`：OCR 两行合一；exam-split 描述收敛
- `README.en.md`：核对后同步（如含对应条目）

## [x] T8 门禁与提交

**按序执行并记录**

1. `pnpm install`
2. `pnpm --filter @lumin/tool-exam-split typecheck`
3. `pnpm --filter @lumin/tool-ocr-text typecheck`
4. `pnpm --filter @lumin/desktop typecheck`
5. `pnpm vitest run --project @lumin/tool-exam-split --coverage.enabled=false`
6. `pnpm vitest run --project @lumin/tool-ocr-text --coverage.enabled=false`
7. 限包覆盖率 ≥80%
8. `pnpm gate`
9. `pnpm --filter @lumin/desktop build` + chunk raw/gzip 记录
10. e2e 两条（沙箱阻断则标注待 CI）

**提交（中文、分次、不推送）**

- `refactor: 收敛 exam-split PDF 能力并合并 OCR 双模式（M49）`
- `test: 同步 M49 单测与 e2e 用例`
- `docs: 登记 M49（Q49/§4.49/spec/smoke/README/CHANGELOG）`

---

## 完成定义（DoD）

- 规格 §1.5 / §2.6 断言全部通过
- 全仓 grep 无 `batch-ocr` / `BO_` / `file-scan` 残留（历史文档与 lockfile 按需保留除外）
- 两包覆盖率 ≥80%，`pnpm gate` 全绿，chunk <200KB gzip
- 文档五处同步；工作区干净；不 push、不合并 master
