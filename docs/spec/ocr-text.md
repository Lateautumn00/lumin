# 图片文字识别（ocr-text）字段级功能清单

> 里程碑：M20（待登记 plan §1 Q24 / §4.20 / §6）
> 状态：**待用户批准后实施**
> 关联规范：`AGENTS.md` §2（零耦合/公共代码上提）、§5（三态/tokens/图标）、§6（IPC 三段式）、§7（测试门禁）、§8（性能）

---

## 1. 目标与边界

### 1.1 目标

新增独立工具包 `ocr-text`（名称「图片文字识别」）：选择**一张图片**（PNG / JPG / WebP，含截图），离线 OCR 识别 → 可编辑文本预览 → 一键复制 / 导出 TXT。全程无网络请求，不新增第三方依赖。

### 1.2 做

| 能力       | 说明                                                                  |
| ---------- | --------------------------------------------------------------------- |
| 输入       | 拖拽或选择单张图片；`.png/.jpg/.jpeg/.webp`，大小写不敏感，≤20MB       |
| 识别       | 主进程 worker 复用 PP-OCR（det 行检测 + rec 文本识别）                |
| 阅读顺序   | 识别行按「先行后列」重排（同行按 x），文本以换行拼接                  |
| 预览编辑   | `NInput` textarea 可自由编辑识别结果                                  |
| 复制       | `navigator.clipboard.writeText`，成功后提示「已复制」                 |
| 导出 TXT   | 选择目录 → 主进程原子写盘（临时文件 + rename），重名自动 `(n)`，UTF-8 无 BOM |
| 目录记忆   | settings `outputDir`，缺省 `userData/ocr-text`                        |
| 取消       | 长任务三段式（invoke → progress → done/error），`lumin:task:cancel`   |

### 1.3 不做（防范围膨胀）

- PDF 输入、多图批量识别、截图热键/框选截图
- 版面还原（表格、段落缩进、坐标可视化）、翻译、竖排/手写专项优化
- 语言切换（仅中文 + 英文 + 数字的通用 PP-OCR 字典）
- 历史记录、云同步

### 1.4 与既有工具边界

- 与 `exam-split`（试卷切割）能力重叠仅限「OCR 引擎」，**必须上提公共包**，禁止 `tools/*` 互相 import。
- 本工具只做「整图 → 文本」；不做切题、不做 PDF 拆分。
- 复用：`@lumin/ui/DropZone.vue`、`@lumin/ui/TaskProgress.vue`、`@lumin/node-kit`（`runTask`/`resolveConflictPath`/`classifyPrecheckError`）、`@lumin/shared`（结构化错误）。

---

## 2. 工具清单（manifest）

| 字段        | 值                                                     |
| ----------- | ------------------------------------------------------ |
| id          | `ocr-text`                                             |
| name        | `图片文字识别`                                         |
| description | `图片 OCR：提取文字、可编辑预览、复制与导出 TXT`        |
| icon        | `scan-text`（壳 `AppSidebar` iconMap 注册 `ScanText`）  |
| order       | `90`                                                   |
| version     | `0.1.0`                                                |

settings 命名空间：`tools.ocr-text.outputDir`（键名 `outputDir`）。

---

## 3. OCR 引擎上提（`packages/ocr-kit`）

### 3.1 动因

AGENTS §2.2/§2.3：工具间禁止互相 import；两个及以上工具复用的逻辑必须上提根 `packages/`。`ocr-text` 与 `exam-split` 共用 PP-OCR 引擎，故新建 `packages/ocr-kit`。

### 3.2 迁移清单（代码原样搬移，行为零回归）

| 源（`packages/tools/exam-split/src/`） | 目标（`packages/ocr-kit/src/`） | 说明 |
| -------------------------------------- | ------------------------------ | ---- |
| `ocr-preproc.ts`                       | `preproc.ts`                   | 纯函数，逐字搬移 |
| `ocr-post.ts`                          | `post.ts`                      | 纯函数，逐字搬移 |
| `ocr-model.ts`                         | `model.ts`                     | onnxruntime-node 动态 import，逐字搬移 |
| `ocr-assets.ts`                        | `assets.ts`                    | 资产表 + SHA256 预检，逐字搬移 |
| `ocr-render.ts`                        | `render.ts`                    | 仅 `scale` 改为 `options.scale ?? DEFAULT_RENDER_SCALE`（默认 2） |

- 新增 `packages/ocr-kit/src/errors.ts`：`OcrErrorCode` / `ocrToolError(code, detail?)`，**码值与中文文案与 exam-split 现有表逐字一致**（`MODEL_MISSING`/`OCR_INPUT_INVALID`/`OCR_FAILED`/`PDF_NOT_FOUND`/`PDF_LOCKED`/`PDF_ENCRYPTED`/`PDF_INVALID`/`INVALID_PAYLOAD`），保证 exam-split 行为零回归。
- 新增 `packages/ocr-kit/src/index.ts`：统一 re-export（`preproc`/`post`/`model`/`assets`/`render`/`errors`）。

### 3.3 exam-split 改造（薄壳化，测试路径不变）

将以下文件改为仅 re-export `@lumin/ocr-kit`（保留原导出名，既有单测与 import 路径不动）：

- `src/ocr-preproc.ts`、`src/ocr-post.ts`、`src/ocr-model.ts`、`src/ocr-assets.ts`
- `src/ocr-render.ts`：re-export 全部，并**保留本地包装** `renderOcrInput`，注入 `scale: PDF_RENDER_SCALE`（来自 `./preview`），保证 PDF 渲染倍率与现状一致；继续 re-export `PDF_RENDER_SCALE`、`ensureCjkFont`。

`ocr-ops.ts` / `ocr.worker.ts` / `node.ts` / `schema.ts` 不动。

### 3.4 工程接线

- `packages/ocr-kit/package.json`：`@lumin/ocr-kit`，exports `.`；依赖 `@lumin/node-kit`、`@lumin/shared`、`@napi-rs/canvas@1.1.1`、`onnxruntime-node@1.31.1`；devDep `pdfjs-dist@6.5.438`。
- `packages/ocr-kit/tsconfig.json`：extends 根 `tsconfig.base.json`。
- `packages/tools/exam-split/package.json`：新增 `"@lumin/ocr-kit": "workspace:*"`。
- `.dependency-cruiser.cjs`：`tools-only-allowed-deps` 白名单加入 `ocr-kit`。
- `apps/desktop/electron.vite.config.ts`：新增 `@lumin/ocr-kit` 别名 → `packages/ocr-kit/src/index.ts`。
- `vitest.config.ts`：新增 `packages/ocr-kit/src/**/*.ts` 与 `packages/tools/ocr-text/src/**/*.ts` 的 80% 阈值（`packages/tools/*` 已自动纳入 projects，`packages/ocr-kit` 不单独建 project——其代码由 exam-split/ocr-text 测试覆盖，纳入 coverage include 统计）。
- `AGENTS.md` §2.2：允许依赖列表加入 `ocr-kit`（仅 OCR 类工具），并同步 `plan.md`。

---

## 4. 界面规格（单页，三态强制）

页面标题「图片文字识别」，副标题「离线识别图片中的文字，可编辑后复制或导出 TXT」。

### 4.1 空态

- `DropZone`：accept `.png,.jpg,.jpeg,.webp`，提示「拖拽图片到此处，或点击选择」。
- 辅助说明：「支持 PNG / JPG / WebP，单张不超过 20MB；识别全程离线」。
- 不渲染空白区域/白屏。

### 4.2 加载态

- 选中图片后立即提交 `ocr-text:recognize`，展示 `TaskProgress`（`cancellable`）。
- 进度文案：`读取图片…`（render）→ `识别文字…`（detect）；无 total 时显示不确定进度。
- 「取消」调用 `lumin:task:cancel`，回包错误 `CANCELLED` 时回到空态并保留已选图片。

### 4.3 报错态

- 卡片展示 `error.message`（中文）+ 错误码；`isRetryable(code)` 为真时显示「重试」，否则显示「重新选择图片」。
- 结构化错误码见 §6。

### 4.4 结果态

| 元素         | 行为                                                                 |
| ------------ | -------------------------------------------------------------------- |
| 图片缩略图   | `URL.createObjectURL(file)`，切换/卸载时 `revokeObjectURL`           |
| 文本框       | `NInput type="textarea"`，行数 ≥10，绑定识别文本，可编辑              |
| 行/字统计    | 只读文案：`识别 {n} 行 · {m} 字`                                      |
| 复制文本     | `navigator.clipboard.writeText`；成功提示「已复制到剪贴板」           |
| 导出 TXT     | `window.lumin.pickDirectory('选择 TXT 导出目录')` → `ocr-text:save-txt`；成功显示输出路径 |
| 重新识别     | 用当前图片重跑一次任务                                               |
| 重新选择     | 清空结果回到空态                                                     |

---

## 5. IPC 契约（通道 `ocr-text:{action}`）

| 通道                | 类型 | 入参（zod）                                        | 回包 |
| ------------------- | ---- | -------------------------------------------------- | ---- |
| `ocr-text:recognize`| task | `{ inputPath: string }`                            | `{ width, height, lines: OcrTextLine[] }` |
| `ocr-text:save-txt` | sync | `{ outputDir, inputPath, text }`                   | `{ output: string }` |
| `ocr-text:config`   | sync | `{}`                                               | `{ outputDir: string }` |

### 5.1 schema（`packages/tools/ocr-text/src/schema.ts`）

- `IMAGE_INPUT_RE = /\.(png|jpe?g|webp)$/i`
- `recognizePayloadSchema = { inputPath: z.string().min(1).regex(IMAGE_INPUT_RE, '仅支持 PNG/JPG/WebP 图片') }`
- `ocrTextLineSchema = { text: z.string().min(1), x/y/width/height: 0–1 ratio, x+width ≤ 1+1e-9, y+height ≤ 1+1e-9 }`
- `recognizeResultSchema = { width: int>0, height: int>0, lines: z.array(ocrTextLineSchema).min(1) }`
- `saveTxtPayloadSchema = { outputDir: min(1), inputPath: 同图片校验, text: min(1,'文本不能为空').max(1_000_000) }`
- `saveTxtResultSchema = { output: min(1) }`
- `configResultSchema = { outputDir: min(1) }`

### 5.2 主进程（`node.ts`）

- `recognize`（task）：zod 校验 → `stat` 体积 >20MB 抛 `OCR_IMAGE_TOO_LARGE` → `access(R_OK)`/`open('r')` 预检（ENOENT→`OCR_FILE_NOT_FOUND`，EBUSY/EPERM/EACCES→`OCR_FILE_LOCKED`）→ `verifyOcrAssets(ocrModelDir(paths.binaries))` → `runTask({ workerPath: ocrWorkerPath, payload: { inputPath, binariesDir }, timeoutMs: 120_000, signal, onUpdate })`。
- 错误映射：`TaskTimeoutError`→`OP_TIMEOUT`；`TaskCrashError`→`OCR_FAILED`（detail=尾部）；kit 错误码归一（`PDF_NOT_FOUND`→`OCR_FILE_NOT_FOUND`、`PDF_LOCKED`→`OCR_FILE_LOCKED`、`PDF_INVALID`/`PDF_ENCRYPTED`→`OCR_INPUT_INVALID`）；其余结构化错误透传。
- `save-txt`（sync）：zod 校验 → `mkdirSync(outputDir, { recursive: true })` → 基名 `path.parse(inputPath).name + '-OCR'` → `resolveConflictPath(join(outputDir, base + '.txt'))` → 写 `${target}.tmp` 后 `rename`；任一步失败清理临时文件并抛 `OUTPUT_WRITE_FAILED`（detail=errno）→ `settings.set('outputDir', outputDir)`。
- `config`（sync）：读取 settings `outputDir`，缺省 `join(paths.userData, 'ocr-text')`。
- 依赖注入：`OcrTextDeps { workerPath, checkReadable, checkExclusive, statSize, run, ocrBinariesDir, fs? }`，`registerWith(ctx, deps)` 供单测注入假件。

### 5.3 worker（`packages/tools/ocr-text/src/ocr.worker.ts` + `recognize.ts`）

- worker 保持工具本地（`?modulePath` 语义不变），只编排：`render(单页)` → `createEngine` → `detectLines` → `sortReadingOrder` → `composeText`。
- 进度：`{ stage: 'render'|'detect', current, total }`。
- 空结果（0 行）→ `OCR_NO_TEXT`。
- 纯函数 `sortReadingOrder(lines)` / `composeText(lines)` 放 `src/text-lines.ts`，单测 ≥80%。

---

## 6. 错误码表（`packages/tools/ocr-text/src/errors.ts`）

| 码                    | 文案                                         | 可重试 |
| --------------------- | -------------------------------------------- | ------ |
| `OCR_INVALID_PAYLOAD` | 参数无效                                     | 否     |
| `OCR_FILE_NOT_FOUND`  | 图片不存在，请重新选择                       | 否     |
| `OCR_FILE_LOCKED`     | 图片被其他程序占用，请关闭后重试             | 是     |
| `OCR_IMAGE_TOO_LARGE` | 图片超过 20MB，请压缩后重试                  | 否     |
| `OCR_INPUT_INVALID`   | 图片无法读取，请换一张清晰的图片             | 否     |
| `OCR_NO_TEXT`         | 未识别到文字，请换更清晰的图片               | 是     |
| `MODEL_MISSING`       | 识别模型缺失，请重新安装应用后重试           | 是     |
| `OCR_FAILED`          | 识别失败，请重试或查看详情                   | 是     |
| `OP_TIMEOUT`          | 处理超时（120 秒），已终止                   | 是     |
| `OUTPUT_WRITE_FAILED` | 无法写出 TXT，请检查目录权限与剩余空间       | 是     |
| `CANCELLED`           | 已取消                                       | 否     |

---

## 7. 性能与规范符合

| 项             | 要求                                                             |
| -------------- | ---------------------------------------------------------------- |
| 单图识别       | ≤3s（R1；PP-OCR det 960 长边 + rec 前缀裁剪，与 exam-split 同口径） |
| renderer chunk | 工具页仅 UI + 类型封装，<200KB gzip（实测记入 smoke）             |
| 二进制/模型    | 复用 `binaries/ocr`，不新增资产；`fetch-binaries.mjs` 不改         |
| 样式           | 仅 Tailwind + tokens；无硬编码色值                               |
| 图标           | `@lucide/vue` 的 `ScanText`                                      |
| 日志           | 主进程 `ctx.log.info` 记录注册；禁止 console                     |

---

## 8. 验收标准

1. 空态/加载（可取消）/报错三态齐全，无白屏。
2. 识别中文截图（含空格/中文路径）→ 文本非空，可编辑，复制成功。
3. 导出 TXT：中文/空格目录成功；同名自动 `(1)`；文本内容与编辑框一致（UTF-8）。
4. 损坏图片 → `OCR_INPUT_INVALID`；>20MB → `OCR_IMAGE_TOO_LARGE`；纯空白图 → `OCR_NO_TEXT`。
5. 取消任务后无结果回写、回到可操作态。
6. exam-split 全部既有单测/e2e 通过（引擎上提零回归）。
7. `pnpm coverage` 全仓 ≥60%、核心纯函数 ≥80%；`pnpm gate` 退出码 0。
8. `docs/smoke/ocr-text.md` R2 八类逐条记录。

---

## 9. 风险与回滚

| 风险 | 处置 |
| ---- | ---- |
| 引擎搬移导致 exam-split 回归 | 代码逐字搬移 + 保留原文件 re-export；先跑 exam-split 全量单测再继续 |
| `?modulePath` 打包路径失效 | worker 仍留在工具包内，不搬移；构建后 e2e 验证 |
| OCR 结果偶发乱序 | `sortReadingOrder` 纯函数单测覆盖同行/跨行/重叠 |
| 真实图片 e2e 不稳定 | 正向用例用大号黑字合成图；失败路径（损坏/超大/空白）为必测；`binaries/ocr` 缺失时正例标注 skip |

回滚：删除 `packages/tools/ocr-text` 与壳 3 处注册，恢复 exam-split 原文件（git revert 单 commit 即可）。

---

## 10. 审批

- [ ] 用户批准本清单与 `ocr-text-tasks.md` 后开始实施（Spec 模式要求）。
