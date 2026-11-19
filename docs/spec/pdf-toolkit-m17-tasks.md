# PDF 水印与页码（M17）实施任务

> 规格：`docs/spec/pdf-toolkit.md`（M17 部分）；计划：plan §1 Q21 / §4.17 / §6 M17
> 完成标准：单测/覆盖率、e2e 8/8、smoke 记录、`pnpm gate` 全绿、3 个提交（不推送）。

## 任务顺序

- [x] 1. **契约与错误码**
  - `src/schema.ts`：`watermarkPayloadSchema`（text/image 判别联合）、`pageNumberPayloadSchema`、常量
  - `src/errors.ts`：`PT_WATERMARK_INVALID` / `PT_PAGE_NUMBER_INVALID`（不可重试）
  - `src/naming.ts`：`watermarkDesiredPath` / `pageNumbersDesiredPath`
  - `+ schema.test.ts / errors.test.ts / naming.test.ts`
  - 验证：`pnpm exec vitest run --project @lumin/tool-pdf-toolkit`

- [x] 2. **PDF 内核**
  - `src/pdf-ops.ts`：`hexToRgb` / `centerImageAnchor` / `pageNumberText` / `pageNumberPosition`
  - `watermarkPdf`（单张居中旋转 + 平铺）、`addPageNumbers`（`startPage`/`{total}`/6 位置）
  - `WorkerRequest` 与 `runOp` 扩至八种 op
  - `+ pdf-ops.test.ts`（真实 pdf-lib 样本 + 损坏/缺失图片 + 区间边界）

- [x] 3. **主进程通道**
  - `src/node.ts`：`watermark` / `page-numbers` 两任务；水印图片预检 → `PT_WATERMARK_INVALID`
  - `+ node.test.ts`（通道映射、非法载荷、图片预检失败、`registerMain` 八任务）

- [x] 4. **渲染层**
  - `src/renderer/watermark-text.ts`（Canvas 栅格化，支持中文）+ `watermark-text.test.ts`
  - `src/renderer/client.ts`：`watermark` / `pageNumbers`
  - `src/renderer/ToolView.vue`：八个 Tab、水印/页码表单、按钮文案、`submitTask` 组装
  - `src/manifest.ts` description 更新

- [x] 5. **e2e 与冒烟**
  - `apps/desktop/e2e/pdf-toolkit-smoke.spec.ts`：新增水印/页码 2 用例（共 8）
  - `docs/smoke/pdf-toolkit.md`：e2e 表、R2 八类、chunk 实测
  - 验证：`pnpm --filter @lumin/desktop build` 后 playwright 8/8

- [x] 6. **登记文档**
  - `docs/opencode/plan.md`：§1 Q21、§4.17、§6 M17（Q1–Q21）
  - `docs/spec/pdf-toolkit.md` update、本文件、`CHANGELOG.md`、`README.md` / `README.en.md`
  - 验证：人工核对表格列数与链接一致

- [x] 7. **门禁与提交**
  - `pnpm coverage`（包 80% / 全仓 60%）、`pnpm gate` 全绿
  - 3 个提交：feat → test → docs（不推送）
