# PDF 文本提取 / 图片提取 / 压缩（M38）实施任务

> 状态：**已实施**（M38 交付 2026-11-20；任务全部 [x]，验收记录见 `docs/smoke/pdf-toolkit.md`）。
> 规格：`docs/spec/pdf-toolkit.md` §11；计划：plan §4.38 / §6 M38
> 完成标准：单测/覆盖率 ≥80%、e2e 12/12（原 8 + 新 4）、smoke 增量记录、`pnpm gate` 全绿、3 个提交（不推送）。
> 边界：零新包、零新增依赖；加密 PDF 直接报错；不做 OCR / 不写文本层。

## 任务顺序

- [x] 1. **规格登记（R8 先行）**
  - `docs/spec/pdf-toolkit.md` §11（已写）
  - `docs/opencode/plan.md`：§4.38 + §6 M38 行
  - 验证：人工核对与本节字段一致

- [x] 2. **抽取原语（node-kit）**
  - `packages/node-kit/src/pdf/render.ts`：`PdfPageHandle` 增可选 `getTextContent` / `getOperatorList` / `objs`；导出 `loadPdfjs`
  - `packages/node-kit/src/pdf/extract.ts`：`buildPageText`、`extractPdfText`、`decodeRawImage`、`extractPdfImages`、`ExtractedImageLimitError`
  - `packages/node-kit/src/pdf/index.ts`：导出新原语与类型
  - `+ extract.test.ts`：换行/空页/裁空白；1bpp/RGB/RGBA/bitmap/非法长度；假 doc 句柄（≤16px 跳过、sha256 去重、上限抛错、单张失败跳过）
  - 验证：`pnpm exec vitest run --project @lumin/node-kit`

- [x] 3. **契约与错误码**
  - `src/schema.ts`：`COMPRESS_LEVELS` / `COMPRESS_PRESETS` / 三载荷
  - `src/errors.ts`：`PT_NO_TEXT_LAYER` / `PT_NO_IMAGES` / `PT_TOO_MANY_IMAGES`（均不可重试）
  - `src/naming.ts`：`extractTextDesiredPath` / `extractImagesDesiredDir` / `compressDesiredPath`
  - `+ schema.test.ts / errors.test.ts / naming.test.ts`
  - 验证：`pnpm exec vitest run --project @lumin/tool-pdf-toolkit`

- [x] 4. **PDF 内核**
  - `src/pdf-ops.ts`：`extractTextOp`（页分隔行 + 全空报错）、`extractImagesOp`（目录递增 + 逐张写 PNG + 2000 上限）、`compressPdf`（渲染 → JPEG → 按原 pt 尺寸重建）
  - `WorkerRequest` 与 `runOp` 扩至十一种 op
  - `+ pdf-ops.test.ts`：真实 pdf-lib 样本（加页码后抽文本、内嵌 PNG 抽图、压缩页数不变、`%PDF-`、越界/空文本层/无图片错误码）
  - 验证：同上

- [x] 5. **主进程通道**
  - `src/node.ts`：`extract-text` / `extract-images` / `compress` 三任务（zod → 预检 → worker）
  - `+ node.test.ts`：通道映射、非法载荷、预检失败、`registerMain` 十一任务
  - 验证：同上

- [x] 6. **渲染层**
  - `src/renderer/client.ts`：`extractText` / `extractImages` / `compress`
  - `src/renderer/ToolView.vue`：十一 Tab、档位下拉、`canSubmit`、`submitTask` 分支、按钮文案、压缩有损提示
  - `+ client.test.ts`
  - 验证：`pnpm --filter @lumin/desktop typecheck`

- [x] 7. **e2e 与冒烟**
  - `apps/desktop/e2e/pdf-toolkit-smoke.spec.ts`：追加 4 用例（文本含页码、图片 ≥1 PNG、压缩页数不变、空文本层报错）
  - `docs/smoke/pdf-toolkit.md`：M38 增量、R2 八类映射、e2e 表、chunk/资产实测
  - 验证：`pnpm --filter @lumin/desktop build` 后 playwright 12/12

- [x] 8. **登记文档**
  - `CHANGELOG.md`、`README.md` / `README.en.md` 工具描述补三项能力
  - 验证：人工核对

- [x] 9. **门禁与提交**
  - `pnpm coverage`（包 80% / 全仓 60%）、`pnpm gate` 全绿
  - 3 个提交：feat → test → docs（不推送）
