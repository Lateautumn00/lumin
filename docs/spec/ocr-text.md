# ocr-text（图片文字识别）功能规格

> 工具 id：`ocr-text` · 包：`packages/tools/ocr-text` · 版本：0.1.0
> 里程碑：M20（单张，2026-11-19）· **M49 合并 batch-ocr（双模式，2026-11-21）**
> 决策依据：`docs/opencode/plan.md` Q24/Q30/Q49 / §4.20 / §4.49 · 规范：`AGENTS.md` §2/§5/§6/§7
> 冒烟记录：`docs/smoke/ocr-text.md` · 自动化：`apps/desktop/e2e/ocr-text-smoke.spec.ts`

## 0. 范围

- 单一工具提供「单张识别 / 批量识别」双模式：单张选择后自动识别；批量 1–50 张逐张识别、单张失败不中断。
- 结果可编辑、复制；单张导出 `{原名}-OCR.txt`；批量支持逐张导出与合并导出。
- 全程离线，无网络请求；模型来自随包 `binaries/ocr`。
- 不做：PDF 识别（用 exam-split / pdf-images）、图片预处理、云端识别、目录批量导入、多语言切换。

## 1. 入口与权限

- 侧边栏分类：图片处理 · 排序 90 · 图标 `scan-text`（`@lucide/vue` 的 `ScanText`）。
- 无网络请求；不新增第三方依赖（OCR 引擎来自 `@lumin/ocr-kit`）。
- M49 起原 `batch-ocr`（`file-scan` / 排序 91）入口删除，能力并入本工具。

## 2. 字段级功能清单（双模式）

| 区域/控件  | 单张模式                                                               | 批量模式                                                                   |
| ---------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 模式切换   | `NRadioGroup`「单张识别 / 批量识别」，默认单张；运行中禁用             | 同左                                                                       |
| 选择区     | `DropZone` 单选                                                        | `DropZone` 多选                                                            |
| 扩展名     | `.png/.jpg/.jpeg/.webp`（大小写不敏感），不符 → 行内提示               | 同左                                                                       |
| 选择后行为 | **自动提交识别**                                                       | 加入列表，等待「开始识别」                                                 |
| 列表       | 不显示                                                                 | 缩略图 + 文件名 + 状态标签（待识别/识别中/完成/失败）+ 移除                |
| 数量限制   | 1                                                                      | 50（超出提示「单次最多 50 张图片，请分批处理」）                           |
| 体积限制   | ≤20MB/张                                                               | ≤20MB/张                                                                   |
| 边界提示   | 「支持 PNG / JPG / WebP，单张不超过 20MB；选择后自动识别，全程离线。」 | 「支持 PNG / JPG / WebP，单张不超过 20MB，单次最多 50 张；识别全程离线。」 |
| 结果编辑   | textarea 可编辑；显示宽高与字数                                        | 选中项 textarea 可编辑；显示宽高与字数                                     |
| 复制       | 「复制文本」                                                           | 「复制当前」/「复制全部」                                                  |
| 导出       | 「导出 TXT」逐张                                                       | 「导出全部 TXT」/「合并导出 TXT」                                          |
| 重试       | 「重试」/「重新识别」                                                  | 「重试失败项」/「全部重新识别」                                            |
| 重置       | 「重新选择图片」                                                       | 「清空列表」                                                               |
| 目录记忆   | 「更改导出目录」                                                       | 同左                                                                       |
| 进度       | `TaskProgress`，可取消                                                 | `TaskProgress`，显示当前/总数，可取消                                      |
| 完成提示   | 「识别完成：1 张全部成功」                                             | 「识别完成：M 张成功，N 张失败」                                           |
| 模式切换   | 清空列表、结果与错误（运行中不可切换）                                 | 同左                                                                       |

## 3. IPC 契约

通道前缀 `ocr-text:`，入参全部 zod 校验；`shared` 只提供信封。

| 通道                 | 类型 | 入参                                                                     | 回包                         |
| -------------------- | ---- | ------------------------------------------------------------------------ | ---------------------------- |
| `ocr-text:recognize` | task | `{ inputPaths: string[] }`（1..50，唯一）                                | `{ items: OcrItemResult[] }` |
| `ocr-text:export`    | sync | `{ outputDir, mode: 'per-file'\|'merged', items: { fileName, text }[] }` | `{ outputs: string[] }`      |
| `ocr-text:config`    | sync | `{}`                                                                     | `{ outputDir: string }`      |

```ts
type OcrItemResult =
  | { status: 'done'; inputPath: string; width: number; height: number; text: string }
  | { status: 'failed'; inputPath: string; error: StructuredError }
```

- `recognize` 三段式：`invoke → { taskId }` → 事件 `progress|done|error` → `lumin:task:cancel`。
- 超时 `OP_TIMEOUT_MS = 600_000`；取消即终止 worker。
- 预检（主进程逐张）：存在 → 独占打开探测 → `stat` 体积；失败项直接生成 `failed` 结果，不启动 worker。
- 模型资产预检在存在可识别图片后执行；缺失 → 任务级 `MODEL_MISSING`。
- worker：引擎只创建一次；逐张 render + det/rec；单张异常归一为 `failed`，不中断整批；结果按输入顺序合回。
- 上限：50 张、20MB/张、1,000,000 字符/导出项。

## 4. 导出

- 逐张：`{原名}-OCR.txt`，每个完成项一个文件；同名 `(1)…(99)` 递增。
- 合并：`OCR-合并-{yyyyMMdd-HHmmss}.txt`，每段以 `===== 文件名 =====` 开头，段间空行。
- 原子写：`node-kit.writeAtomic`（临时文件 + rename）；目录不存在时递归创建。
- 目录记忆：`tools.ocr-text.outputDir`，缺省 `userData/ocr-text`；每次导出后回写。
- 空文本项不参与导出（UI 层过滤）；导出后显示产物数与首个路径，并提供「打开所在文件夹」。

## 5. 错误码

| 码                    | 文案                                   | 可重试 | 归属      |
| --------------------- | -------------------------------------- | ------ | --------- |
| `OCR_INVALID_PAYLOAD` | 参数无效                               | 否     | 任务/同步 |
| `OCR_FILE_NOT_FOUND`  | 图片不存在，请重新选择                 | 否     | 单项      |
| `OCR_FILE_LOCKED`     | 图片被其他程序占用，请关闭后重试       | 是     | 单项      |
| `OCR_IMAGE_TOO_LARGE` | 图片超过 20MB，请压缩后重试            | 否     | 单项      |
| `OCR_INPUT_INVALID`   | 图片无法读取，请换一张清晰的图片       | 否     | 单项      |
| `OCR_NO_TEXT`         | 未识别到文字，请换更清晰的图片         | 是     | 单项      |
| `OCR_TOO_MANY_FILES`  | 单次最多 50 张图片                     | 否     | 预留      |
| `MODEL_MISSING`       | 识别模型缺失，请重新安装应用后重试     | 是     | 任务      |
| `OCR_FAILED`          | 识别失败，请重试或查看详情             | 是     | 单项/任务 |
| `OP_TIMEOUT`          | 处理超时（10 分钟），已终止            | 是     | 任务      |
| `OUTPUT_WRITE_FAILED` | 无法写出 TXT，请检查目录权限与剩余空间 | 是     | 同步      |
| `CANCELLED`           | 已取消                                 | 否     | 任务      |

`ocr-kit` 的 `PDF_NOT_FOUND/PDF_LOCKED/PDF_ENCRYPTED/PDF_INVALID/INVALID_PAYLOAD` 在主进程边界归一为图片语义（`OCR_*`）。

## 6. 三态

- 空态：模式切换 + DropZone 引导 + 边界提示；批量模式另有列表空提示，禁止白屏。
- 加载态：进度条（单张：阶段文案；批量：当前/总数 + 文案）+ 取消；当前项标签切「识别中」。
- 报错态：任务级错误 NAlert（码 + detail）+ 可重试则「重试」+「重新选择/清空列表」；单项失败在列表/详情展示并可重试。

## 7. 性能与体积（R5）

- 工具代码 chunk（含页面 UI）须 < 200KB gzip（不引第三方渲染/OCR 依赖，引擎在主进程 worker）。
- worker 与模型资产不计入 renderer chunk 口径，按 AGENTS §8 在冒烟单列。
- 单图 OCR ≤3s（与 exam-split 同口径）。
- 实测数值记录于 `docs/smoke/ocr-text.md` §4。

## 8. 测试点

- schema：扩展名白名单、数量上限、路径去重、导出载荷（路径分隔符/空文本）。
- recognize 编排：引擎单次创建、逐张失败不中断、结果同序、空页面/无文字/异常归一、进度阶段。
- node：预检四类、无可用图片不启动 worker、worker 缺项补失败、超时/崩溃映射、导出两模式、冲突递增、写盘失败、config 缺省与记忆。
- renderer client：三通道名与壳契约一致。
- e2e：双模式空态、类型不符、损坏图、超大图、单张自动识别→编辑→导出、批量 1 好 1 坏不中断、逐张/合并导出、并发导出。

## 9. M49 验收标准

1. 侧边栏只有一个「图片文字识别」入口；原「图片批量识别」入口消失。
2. 单张模式选择后自动识别，结果可编辑、复制、导出 `{原名}-OCR.txt`。
3. 批量模式 2 张（1 好 1 坏）→ 1 成功 1 失败，整批不中断；逐张与合并导出均成功。
4. 加载态可取消；取消后回到空闲且可重试。
5. 错误码均为 `OCR_*`；第 51 张提示 `OCR_TOO_MANY_FILES`。
6. `pnpm gate` 全绿，限包覆盖率 ≥80%，chunk <200KB gzip。
