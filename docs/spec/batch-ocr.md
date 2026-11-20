# batch-ocr（图片批量识别）功能规格

> 工具 id：`batch-ocr` · 包：`packages/tools/batch-ocr` · 版本：0.1.0 · 里程碑：M28（2026-11-20）
> 决策依据：`docs/opencode/plan.md` Q30 / §4.28 · 规范：`AGENTS.md` §2/§5/§6/§7
> 冒烟记录：`docs/smoke/batch-ocr.md` · 自动化：`apps/desktop/e2e/batch-ocr-smoke.spec.ts`

## 0. 范围

- 多选图片（1–50 张）批量离线 PP-OCR，逐张展示结果，可编辑后复制或导出 TXT。
- 与 `ocr-text`（单图识别）互补：本工具面向「一批截图/扫描件 → 一份或一组 TXT」。
- 不做：PDF 识别（用 exam-split / pdf-images）、图片预处理、云端识别、目录批量导入。

## 1. 入口与权限

- 侧边栏分类：图片处理 · 排序 91 · 图标 `file-scan`。
- 图标来自 `@lucide/vue` 的 `FileScan`，禁止内置图标/手写 SVG。
- 无网络请求；模型来自随包 `binaries/ocr`。

## 2. 字段级功能清单

| 区域       | 控件                         | 规则 / 行为                                                                 |
| ---------- | ---------------------------- | --------------------------------------------------------------------------- |
| 选择区     | 拖拽/点击添加（多选）        | 扩展名白名单 `.png/.jpg/.jpeg/.webp`（大小写不敏感）；不支持 → 行内提示      |
| 选择区     | 边界提示                     | 「支持 PNG / JPG / WebP，单张不超过 20MB，单次最多 50 张；识别全程离线。」   |
| 列表       | 行缩略图 + 文件名 + 状态标签 | 状态：待识别 / 识别中 / 完成 / 失败；完成行显示宽高                       |
| 列表       | 移除按钮（行内）             | 运行中禁用；移除当前项后自动选中下一项                                      |
| 列表       | 重复/超量添加                | 行内提示「已在列表中」「单次最多 50 张图片，请分批处理」，不入列表          |
| 详情区     | 原图预览                     | 最大 40 高 / 56 宽（rem 级），`object-contain`                              |
| 详情区     | 结果文本框                   | 可编辑；失败项禁用并展示错误文案；完成项显示宽高与去空白字数                |
| 详情区     | 复制当前                     | 复制当前项编辑后文本                                                        |
| 详情区     | 重试失败项                   | 仅当选中失败项且错误可重试时出现                                            |
| 工具栏     | 开始识别（N 张）             | 仅识别「待识别」项；运行中隐藏                                              |
| 工具栏     | 重试失败项（N）              | 仅重跑失败项，成功项结果保留                                                |
| 工具栏     | 全部重新识别                 | 重跑列表全部图片（清空旧文本）                                              |
| 工具栏     | 复制全部 / 导出全部 TXT / 合并导出 TXT | 仅「完成且有文本」项参与；无完成项时隐藏                           |
| 工具栏     | 更改导出目录 / 清空列表      | 清空运行中禁用；清空后回到空态                                              |
| 进度区     | TaskProgress                 | 显示「当前/总数 + 阶段文案」，可取消                                        |
| 结果区     | 完成提示 / 导出产物          | 「识别完成：M 张成功，N 张失败」；导出后显示产物数与首个路径 + 打开文件夹   |

## 3. IPC 契约

通道前缀 `batch-ocr:`，入参全部 zod 校验；`shared` 只提供信封。

| 通道                          | 类型 | 入参                                                                 | 回包                                  |
| ----------------------------- | ---- | -------------------------------------------------------------------- | ------------------------------------- |
| `batch-ocr:recognize`         | 任务 | `{ inputPaths: string[] }`（1..50，唯一）                            | `{ items: BatchItemResult[] }`        |
| `batch-ocr:export`            | sync | `{ outputDir, mode: 'per-file'\|'merged', items: { fileName, text }[] }` | `{ outputs: string[] }`           |
| `batch-ocr:config`            | sync | `{}`                                                                 | `{ outputDir: string }`               |

`BatchItemResult`：

```ts
type BatchItemResult =
  | { status: 'done'; inputPath: string; width: number; height: number; text: string }
  | { status: 'failed'; inputPath: string; error: StructuredError }
```

## 4. 任务模型与边界

- 三段式：`invoke → { taskId }` → 事件 `progress|done|error` → `lumin:task:cancel`。
- 超时 `OP_TIMEOUT_MS = 600_000`（50 张 × 单张 ≤3s 留足余量）；取消即终止 worker。
- 预检（主进程逐张）：可读 → 独占打开探测 → `stat` 体积；失败项直接生成 `failed` 结果，不启动 worker。
- 模型资产预检在存在可识别图片后执行；缺失 → 任务级 `MODEL_MISSING`。
- worker：引擎只创建一次；逐张 render（首帧）+ det/rec；单张异常归一为 `failed`，不中断整批；结果按输入顺序合回（预检失败项占用原位置）。
- 数量/体积上限：50 张、20MB/张、1,000,000 字符/导出项；不满足 → `BO_*` 结构化错误。

## 5. 错误码

| 码                   | 文案                                     | 可重试 | 归属     |
| -------------------- | ---------------------------------------- | ------ | -------- |
| `BO_INVALID_PAYLOAD` | 参数无效（含 zod 首条 issue）            | 否     | 任务/同步 |
| `BO_FILE_NOT_FOUND`  | 图片不存在，请重新选择                   | 否     | 单项     |
| `BO_FILE_LOCKED`     | 图片被其他程序占用，请关闭后重试         | 是     | 单项     |
| `BO_IMAGE_TOO_LARGE` | 图片超过 20MB，请压缩后重试              | 否     | 单项     |
| `BO_INPUT_INVALID`   | 图片无法读取，请换一张清晰的图片         | 否     | 单项     |
| `BO_NO_TEXT`         | 未识别到文字，请换更清晰的图片           | 是     | 单项     |
| `BO_TOO_MANY_FILES`  | 单次最多 50 张图片                       | 否     | 预留     |
| `MODEL_MISSING`      | 识别模型缺失，请重新安装应用后重试       | 是     | 任务     |
| `BO_OCR_FAILED`      | 识别失败，请重试或查看详情               | 是     | 单项/任务 |
| `OP_TIMEOUT`         | 处理超时（10 分钟），已终止              | 是     | 任务     |
| `OUTPUT_WRITE_FAILED`| 无法写出 TXT，请检查目录权限与剩余空间   | 是     | 同步     |
| `CANCELLED`          | 已取消                                   | 否     | 任务     |

`ocr-kit` 的 `PDF_NOT_FOUND/PDF_LOCKED/PDF_ENCRYPTED/PDF_INVALID/INVALID_PAYLOAD` 在主进程边界归一为图片语义。

## 6. 导出

- 逐张：`{原名}-OCR.txt`，每个完成项一个文件；同名 `(1)…(99)` 递增。
- 合并：`OCR-合并-{yyyyMMdd-HHmmss}.txt`，每段以 `===== 文件名 =====` 开头，段间空行。
- 原子写：`node-kit.writeAtomic`（临时文件 + rename）；目录不存在时递归创建。
- 目录记忆：`tools.batch-ocr.outputDir`，缺省 `userData/batch-ocr`；每次导出后回写。
- 空文本项不参与导出（UI 层过滤）；导出后提供首个产物「打开所在文件夹」。

## 7. 三态

- 空态：DropZone 引导 + 列表空提示 + 边界提示，禁止白屏。
- 加载态：进度条（当前/总数 + 文案）+ 取消；当前项标签切「识别中」。
- 报错态：任务级错误 NAlert（码 + detail）+ 可重试则「重试」+「清空列表」；单项失败在列表/详情展示并可重试失败项。

## 8. 性能与体积（R5）

- 工具代码 chunk（含页面 UI）须 < 200KB gzip（本工具不引第三方渲染/OCR 依赖，引擎在主进程 worker）。
- worker 与模型资产不计入 renderer chunk 口径，按 AGENTS §8 在冒烟单列。
- 实测数值记录于 `docs/smoke/batch-ocr.md` §4。

## 9. 测试点

- schema：扩展名白名单、数量上限、路径去重、导出载荷（路径分隔符/空文本）。
- recognize 编排：引擎单次创建、逐张失败不中断、结果同序、空页面/无文字/异常归一、进度阶段。
- node：预检四类、无可用图片不启动 worker、worker 缺项补失败、超时/崩溃映射、导出两模式、冲突递增、写盘失败、config 缺省与记忆。
- renderer client：三通道名与壳契约一致。
- e2e：空态/类型不符/超大图逐张失败、真实推理→编辑→导出、并发导出。
