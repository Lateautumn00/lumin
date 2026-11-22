# M49 PDF 基础操作收敛 + OCR 双模式合并（字段级规格）

> 状态：**已实施**（2026-11-22 回写；`docs/spec/m49-pdf-ocr-consolidate-tasks.md` 全 [x]）
> 分支：`feature/m49-pdf-ocr-consolidate`（自 `feature/m48-dedupe-cleanup` 切出，堆叠不合并）
> 关联：plan §1 Q49 / §4.49 / 里程碑 M49；AGENTS §2（零耦合）、§5.3（三态）、§7（覆盖率）、§8（chunk）
> 背景：M48 §4.48 明确「PDF 基础操作（exam-split vs pdf-toolkit）、OCR 三入口包级合并另行排期」，本里程碑落地该两项。

---

## 0. 目标与不做项

### 0.1 目标

1. **exam-split PDF 页签收敛**：只保留 OCR 前置所需的「按页范围拆分」与「裁剪」，合并/删页/旋转从工具内移除并引导至 `pdf-toolkit`。
2. **OCR 双模式合并**：`ocr-text`（单张）与 `batch-ocr`（批量）合并为**单一工具** `ocr-text`，同一页面内提供「单张识别 / 批量识别」两种模式；删除 `batch-ocr` 包与全部壳接线。

### 0.2 不做项

- 不把裁剪迁入 `pdf-toolkit`（plan Q19 已定：裁剪归 exam-split）。
- 不改 OCR 引擎与模型资产（继续 `@lumin/ocr-kit` + onnxruntime-node）。
- 不改变 `pdf-toolkit` 现有任何能力与入口。
- 不新增第三方依赖，不改安全基线，不动 IPC 信封。

---

## 1. exam-split PDF 页签收敛

### 1.1 保留与移除矩阵

| 操作           | 处理     | 说明                                                                    |
| -------------- | -------- | ----------------------------------------------------------------------- |
| 拆分（按区间） | **保留** | OCR 前置：把多页卷拆成单页/小节                                         |
| 裁剪           | **保留** | plan Q19 明确归 exam-split；用于裁去页边                                |
| 合并           | **移除** | 引导「PDF 工具集 → 合并」                                               |
| 删页           | **移除** | 引导「PDF 工具集 → 删页」                                               |
| 旋转           | **移除** | 引导「PDF 工具集 → 旋转」（OCR 自身仍有 `rotation` 渲染参数，不受影响） |
| OCR 切题       | **保留** | 本工具主能力，不动                                                      |

### 1.2 字段级 UI（PDF 页签）

| 字段/控件        | 类型                 | 默认 | 约束                               | 变更                                                       |
| ---------------- | -------------------- | ---- | ---------------------------------- | ---------------------------------------------------------- |
| 操作选择         | `NRadioGroup`        | 拆分 | 仅 `split` / `crop` 两项           | 由 5 项减为 2 项                                           |
| 输入文件         | `DropZone`（单文件） | 空   | `.pdf`                             | 移除合并多选分支                                           |
| 页码区间         | `NInput`             | 空   | `split` 必填；`crop` 选填=全部页   | 文案随操作切换                                             |
| 裁剪框 X/Y/宽/高 | `NInputNumber`       | 整页 | mm，`crop` 时显示                  | 不变                                                       |
| 产物命名模板     | `NInput`             | 空   | 含 `{name}`，白名单占位符          | 不变                                                       |
| 引导文案         | `NText`              | —    | 固定展示                           | **新增**：`合并、删页、旋转、重排等请使用「PDF 工具集」。` |
| 开始按钮         | `NButton`            | —    | `split` 需文件+区间；`crop` 需文件 | 移除 merge 条件                                            |
| 进度/取消        | `TaskProgress`       | —    | 可取消                             | 不变                                                       |
| 结果卡           | `ResultCard`         | —    | 产物路径 + 打开文件夹              | 不变                                                       |
| 错误卡           | `ErrorCard`          | —    | 结构化码 + 重试/重选               | `REREINPUT_CODES` 仅保留区间类                             |

### 1.3 代码收敛点（精确）

- `packages/tools/exam-split/src/manifest.ts`
  - `description` 改为：`试卷 OCR 自动切题；PDF 拆页与裁剪作为 OCR 前置处理（其余 PDF 操作见「PDF 工具集」）`
- `src/schema.ts`
  - 删除 `mergePayloadSchema` / `MergePayload`、`deletePayloadSchema` / `DeletePayload`、`rotatePayloadSchema` / `RotatePayload`。
  - 保留 `splitPayloadSchema`、`cropPayloadSchema`、`nameTemplateSchema`、`opResultSchema`、全部 OCR schema。
- `src/pdf-ops.ts`
  - 删除 `mergePdf`、`deletePages`、`rotatePages`。
  - 删除对应 import：`degrees`、`MergePayload`/`DeletePayload`/`RotatePayload`、`mergeDesiredPath`/`deleteDesiredPath`/`rotateDesiredPath`。
  - `WorkerRequest` 联合类型减为 `split | crop`；`runOp` 删除三 case。
  - 保留 `splitPdf`、`cropPages`、`loadSource`、`resolveOutput`、`writeOutput`（`resolveOutput` 仍被 `ocr-ops.ts` 复用）。
- `src/naming.ts`
  - 删除 `mergeDesiredPath`、`deleteDesiredPath`、`rotateDesiredPath` 及其单测；`splitDesiredPaths`/`cropDesiredPath` 保留。
- `src/node.ts`
  - 删除 `merge` / `delete` / `rotate` 三个 `ctx.registerTask`。
  - 删除对应 schema import；注释改为「注册四个任务通道（split/crop/ocr-detect/ocr-export）」。
- `src/renderer/client.ts`
  - 删除 `submitMerge` / `submitDelete` / `submitRotate` 与类型 import。
- `src/renderer/ToolView.vue`
  - `type Op = 'split' | 'crop'`；`OPS` 两项。
  - 删除 `MergeItem`、`mergeItems`、`dragIndex`、`onMergeSelect`、`removeItem`、`moveItem`、`onDropItem` 与合并列表模板、合并提示。
  - 删除 `degrees` 与旋转 UI、`canSubmit` 的 merge 分支、`submit()` 的 merge/delete/rotate 分支、`resetForResult` 的角度重置。
  - 左栏固定 `PdfPreview`；右栏固定单文件 `DropZone`。
  - 新增引导文案（见 §1.2）。
- `src/pdf.worker.ts`：类型随 `WorkerRequest` 收窄，无需逻辑改动。

### 1.4 测试同步

| 文件                                        | 变更                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/schema.test.ts`                        | 删除 merge/delete/rotate schema 用例                                           |
| `src/pdf-ops.test.ts`                       | 删除 merge/delete/rotate 用例，保留 split/crop                                 |
| `src/pdf-ops.writefail.test.ts`             | 删除已移除算子的写失败用例，保留 split/crop                                    |
| `src/naming.test.ts`                        | 删除三个已删命名函数用例                                                       |
| `src/node.test.ts`                          | 通道集合改为 `split/crop/ocr-detect/ocr-export`；删除三通道用例                |
| `src/renderer/client.test.ts`               | 删除三个 submit 用例                                                           |
| `apps/desktop/e2e/exam-split-smoke.spec.ts` | PDF 段删除 merge/delete/rotate 调用；保留 split/crop；断言页面无这三项操作按钮 |

### 1.5 验收断言（可复现）

1. PDF 页签仅出现「拆分」「裁剪」两个操作，且可见引导文案。
2. `exam-split:split` 正常产出多文件；`exam-split:crop` 正常产出裁剪后 PDF。
3. `exam-split:merge` / `delete` / `rotate` 已不再注册（调用失败）。
4. OCR 页签全部用例零回归。

---

## 2. OCR 双模式合并（ocr-text）

### 2.1 包与身份决策

**保留 `ocr-text` 身份，采用 `batch-ocr` 架构（超集），删除 `batch-ocr` 包。**

理由：批量架构已支持 1–50 张、逐项结果、单张失败不中断、逐张/合并导出与目录记忆；单张 = 批量 1 项，改造成本最低，同时保留用户熟悉的工具名与 `scan-text` 图标。

| 项                | 合并后                                                        |
| ----------------- | ------------------------------------------------------------- |
| 包目录            | `packages/tools/ocr-text`（原 `batch-ocr` 内容迁入）          |
| 包名              | `@lumin/tool-ocr-text`                                        |
| manifest id       | `ocr-text`                                                    |
| 名称              | `图片文字识别`                                                |
| 描述              | `图片 OCR（单张/批量）：提取文字、可编辑预览、复制与导出 TXT` |
| icon              | `scan-text`                                                   |
| category / order  | `image` / `90`                                                |
| IPC 通道          | `ocr-text:recognize` / `ocr-text:export` / `ocr-text:config`  |
| userData 缺省目录 | `userData/ocr-text`                                           |
| 错误码前缀        | `OCR_*`                                                       |

### 2.2 字段级 UI（模式矩阵）

| 字段/控件  | 单张模式                                       | 批量模式                                    |
| ---------- | ---------------------------------------------- | ------------------------------------------- |
| 模式切换   | `NRadioGroup`「单张识别 / 批量识别」，默认单张 | 同左；运行中禁用                            |
| 输入       | `DropZone` 单选，`.png/.jpg/.jpeg/.webp`       | `DropZone` 多选，同扩展名                   |
| 选择后行为 | **自动提交识别**                               | 加入列表，等待「开始识别」                  |
| 列表       | 不显示                                         | 左栏列表：缩略图/文件名/尺寸或状态标签/移除 |
| 数量上限   | 1                                              | 50（超出提示 `OCR_TOO_MANY_FILES`）         |
| 单张体积   | ≤20MB                                          | ≤20MB                                       |
| 进度       | `TaskProgress`，可取消                         | `TaskProgress`，`current/total`，可取消     |
| 结果编辑   | 大号 `textarea`（8–18 行）                     | 选中项 `textarea`（8–18 行）                |
| 统计       | 宽高像素 + 字数                                | 宽高像素 + 字数                             |
| 复制       | 复制文本                                       | 复制当前 / 复制全部                         |
| 导出       | 导出 TXT（`{原名}-OCR.txt`）                   | 逐张导出 / 合并导出                         |
| 重试       | 重新识别                                       | 重试失败项 / 全部重新识别                   |
| 重置       | 重新选择图片                                   | 清空列表                                    |
| 目录记忆   | 复用 `export` 选择目录                         | 更改导出目录                                |
| 空态       | DropZone + 支持格式说明                        | DropZone + 数量上限说明                     |
| 报错态     | 码 + 中文文案 + detail + 重试/重选             | 码 + 中文文案 + detail + 重试/清空          |
| 模式切换   | 清空列表、结果与错误；运行中不可切换           | 同左                                        |

### 2.3 代码迁移与重命名

1. 删除旧 `packages/tools/ocr-text`（单张实现），将 `packages/tools/batch-ocr` 整目录迁入 `packages/tools/ocr-text`（`git rm` + `git mv`，保留文件内容）。
2. 包内重命名：
   - `package.json`：`name` → `@lumin/tool-ocr-text`。
   - `src/manifest.ts`：见 §2.1。
   - `src/batch.worker.ts` → `src/ocr.worker.ts`；导出函数 `handleBatchOcrTask` → `handleOcrTextTask`；`exposeTask` 不变。
   - `src/node.ts`：`BatchOcrDeps` → `OcrTextDeps`；`registerMain` 仍导出；worker 路径 import 改为 `./ocr.worker.ts?modulePath`；`defaultOutputDir` → `join(ctx.paths.userData, 'ocr-text')`；日志 `ocr-text registered`。
   - `src/errors.ts`：
     - `BO_INVALID_PAYLOAD` → `OCR_INVALID_PAYLOAD`
     - `BO_FILE_NOT_FOUND` → `OCR_FILE_NOT_FOUND`
     - `BO_FILE_LOCKED` → `OCR_FILE_LOCKED`
     - `BO_IMAGE_TOO_LARGE` → `OCR_IMAGE_TOO_LARGE`
     - `BO_INPUT_INVALID` → `OCR_INPUT_INVALID`
     - `BO_NO_TEXT` → `OCR_NO_TEXT`
     - `BO_TOO_MANY_FILES` → `OCR_TOO_MANY_FILES`
     - `BO_OCR_FAILED` → `OCR_FAILED`
     - 其余 `MODEL_MISSING` / `OP_TIMEOUT` / `OUTPUT_WRITE_FAILED` / `CANCELLED` 不变
     - 导出名 `BATCH_OCR_ERROR_CODES` → `OCR_TEXT_ERROR_CODES`，`BatchOcrErrorCode` → `OcrTextErrorCode`
   - `src/recognize.ts` / `src/schema.ts`：错误码引用同步；类型名与载荷形状不变（仍为 `inputPaths` + 逐项 `items`）。
   - `src/renderer/client.ts`：通道改为 `ocr-text:*`。
   - `src/naming.ts`：保留 `mergedFileName`。
3. 双模式 UI 改造 `src/renderer/ToolView.vue`（见 §2.2）；单张模式复用 `startRecognize([path])`，批量模式沿用现有列表逻辑。

### 2.4 壳接线删除清单

| 文件                                                  | 变更                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `apps/desktop/src/tool-manifests.ts`                  | 删除 `batchOcrManifest` import 与数组项；`ocrTextManifest` 保留 |
| `apps/desktop/src/main/tool-mains.ts`                 | 删除 `batch-ocr` import 与 `'batch-ocr'` 映射                   |
| `apps/desktop/electron.vite.config.ts`                | 删除 `@lumin/tool-batch-ocr/*` 三组别名                         |
| `apps/desktop/package.json`                           | 删除 `@lumin/tool-batch-ocr` 依赖                               |
| `apps/desktop/src/renderer/src/tools/batch-ocr.vue`   | 删除文件                                                        |
| `apps/desktop/src/renderer/src/layout/AppSidebar.vue` | 删除 `FileScan` import 与 `'file-scan'` 映射；`ScanText` 保留   |
| `vitest.config.ts`                                    | 删除 `packages/tools/batch-ocr/src/**/*.ts` 阈值                |
| `pnpm-lock.yaml`                                      | `pnpm install` 自动更新                                         |

### 2.5 测试同步

| 文件                                                  | 变更                                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/batch.worker.test.ts` → `src/ocr.worker.test.ts` | 文件重命名；`handleBatchOcrTask` → `handleOcrTextTask`；`BO_*` → `OCR_*`                                              |
| `src/errors.test.ts`                                  | 错误码与可重试集合更新                                                                                                |
| `src/manifest.test.ts`                                | id/name/icon/description 断言更新                                                                                     |
| `src/node.test.ts`                                    | 通道、默认目录、错误码映射更新                                                                                        |
| `src/recognize.test.ts` / `src/schema.test.ts`        | 错误码引用更新                                                                                                        |
| `src/renderer/client.test.ts`                         | 通道断言改为 `ocr-text:*`                                                                                             |
| `apps/desktop/e2e/batch-ocr-smoke.spec.ts`            | **删除**，内容并入下一条                                                                                              |
| `apps/desktop/e2e/ocr-text-smoke.spec.ts`             | **重写**：单张自动识别、单张导出、批量两张逐项结果（含 1 张损坏不中断）、逐张/合并导出、取消、空态；通道 `ocr-text:*` |

### 2.6 验收断言（可复现）

1. 侧边栏只保留一个「图片文字识别」入口；原「图片批量识别」入口消失。
2. 单张模式：选择图片后自动开始识别，结果可编辑、复制、导出 `{原名}-OCR.txt`。
3. 批量模式：选 2 张（1 张正常、1 张损坏）→ 正常项 `done`、损坏项 `failed`，整批不中断；逐张导出 1 个 TXT，合并导出 1 个 `OCR-合并-*.txt`。
4. 加载态可取消；取消后回到空闲且可重试。
5. 错误码均为 `OCR_*`；`OCR_TOO_MANY_FILES` 在第 51 张时给出中文提示。
6. 两工具均无 `any`、无 `console`、无死代码。

---

## 3. 文档与登记

| 文件                          | 内容                                                                |
| ----------------------------- | ------------------------------------------------------------------- |
| `docs/spec/exam-split.md`     | §1 能力矩阵/§3 字段矩阵/§5 错误入口改为拆分+裁剪，新增引导说明      |
| `docs/smoke/exam-split.md`    | 删除 merge/delete/rotate 行，保留 R2 八类中适用项                   |
| `docs/spec/ocr-text.md`       | 以 `batch-ocr.md` 为基础重写：双模式字段矩阵、IPC、错误码、导出规则 |
| `docs/spec/batch-ocr.md`      | 删除（内容并入 ocr-text）                                           |
| `docs/smoke/ocr-text.md`      | 合并原 batch-ocr 冒烟记录与单张记录，R2 八类覆盖                    |
| `docs/smoke/batch-ocr.md`     | 删除                                                                |
| `docs/spec/ocr-text-tasks.md` | 追加 M49 小节（历史任务保留）                                       |
| `docs/opencode/plan.md`       | §1 新增 Q49；新增 §4.49；§6 里程碑表新增 M49                        |
| `CHANGELOG.md`                | `[Unreleased]` 新增 M49 条目                                        |
| `README.md`                   | 两行 OCR 合并为一行；exam-split 描述收敛                            |
| `README.en.md`                | 如含对应条目则同步（执行时核对）                                    |

---

## 4. 质量门禁与验证步骤（执行时逐条记录）

1. `pnpm install`（更新 lockfile 与 workspace 链接）
2. `pnpm --filter @lumin/tool-exam-split typecheck`
3. `pnpm --filter @lumin/tool-ocr-text typecheck`
4. `pnpm --filter @lumin/desktop typecheck`
5. `pnpm vitest run --project @lumin/tool-exam-split --coverage.enabled=false`
6. `pnpm vitest run --project @lumin/tool-ocr-text --coverage.enabled=false`
7. 限包覆盖率（≥80%）：`pnpm vitest run --coverage.enabled=true --coverage.include="packages/tools/exam-split/src/**" --coverage.include="packages/tools/ocr-text/src/**"`
8. `pnpm gate`（lint → typecheck → test → audit → dependency-cruiser）
9. `pnpm --filter @lumin/desktop build`，用 Node `zlib` 记录两个工具 chunk 的 raw/gzip；要求 <200KB gzip
10. e2e：`pnpm --filter @lumin/desktop exec playwright test e2e/exam-split-smoke.spec.ts e2e/ocr-text-smoke.spec.ts`（本机沙箱若阻断，记录并标注待 CI）

**提交（不推送、不合并）**：

- `refactor: 收敛 exam-split PDF 能力并合并 OCR 双模式（M49）`
- `test: 同步 M49 单测与 e2e 用例`
- `docs: 登记 M49（Q49/§4.49/spec/smoke/README/CHANGELOG）`

---

## 5. 完成定义（DoD）

- §1.5、§2.6 全部断言可复现通过。
- `batch-ocr` 包、壳接线、别名、依赖、图标映射、覆盖率阈值、e2e 文件全部清理干净（全仓 grep 无残留）。
- 两包限包覆盖率 ≥80%，`pnpm gate` 全绿，chunk <200KB gzip。
- 文档五处同步（spec/smoke/plan/README/CHANGELOG）。
- 工作区仅含本规格列出的变更；不 push、不合并 master。
