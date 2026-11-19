# PDF 图片转换（pdf-images）字段级功能清单

> 工具 id：`pdf-images` · 名称：PDF 图片转换 · 图标：`file-image` · 版本：0.1.0 · 里程碑：M11（2026-11-19，R8）
> 通道前缀：`pdf-images:*`；本文件为验收附件，实现变更须同步回写本节表格（AGENTS §11）。

---

## 1. 范围与边界

- **PDF → 图片**：单个 PDF 按页渲染为 PNG / JPG，可指定页码范围与 72/150/300 DPI
- **图片 → PDF**：多张图片（1–200）按列表顺序合成单个 PDF，页面模式 `跟随图片尺寸` / `A4 等比居中`
- **不做**：PDF 加密 / 解密、PDF 合并 / 拆分（属 exam-split 范围）、图片压缩 / 格式转换（属 image-toolbox 范围）、OCR
- 离线优先、数据不出本机；合成 PDF 仅调用本地 `@napi-rs/canvas` 与 `pdf-lib`，非 png/jpg 图片转码复用 `binaries/download/ffmpeg.exe`

## 2. 页面结构

单页两 Tab（`NTabs` 仅作切换器，内容 `v-if` 渲染，页签走 `#tab` 插槽——当前 naive-ui 构建的已知缺陷规避）：

### 2.1 PDF 转图片

| 元素     | 类型        | 默认值 | 约束 / 行为                                                       |
| -------- | ----------- | ------ | ----------------------------------------------------------------- |
| 文件入口 | DropZone    | 空     | `accept=.pdf`，单选；选中即调 `pdf-info` 读取页数                 |
| 文件卡片 | 只读展示    | —      | 文件名 + 「共 N 页」；`X` 移除（运行中禁用）                      |
| 页码范围 | 文本输入    | 空     | `1-3,5` 语法；留空 = 全部页；越界/语法错 → `PI_RANGE_INVALID`     |
| 输出格式 | 下拉        | `PNG`  | `PNG`（无损）/ `JPG`（有损，落盘 `.jpg`）                         |
| 分辨率   | 下拉        | `150`  | `72`（屏幕预览）/ `150`（推荐）/ `300`（印刷，较慢）              |
| 输出目录 | 输入 + 选择 | 记忆值 | 壳 `pickDirectory` 选择后即时记忆；留空走记忆目录 / userData 默认 |
| 开始转换 | 主按钮      | —      | 无文件、读取页数中、任务运行中禁用                                |
| 结果区   | 列表        | —      | 「完成 N 页（失败 M 项）」+ 逐文件打开所在文件夹                  |

### 2.2 图片转 PDF

| 元素     | 类型        | 默认值 | 约束 / 行为                                                     |
| -------- | ----------- | ------ | --------------------------------------------------------------- |
| 文件入口 | DropZone    | 空     | `accept=.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.avif,.gif`，多选 |
| 文件列表 | 有序列表    | —      | 序号 + 文件名；上移/下移（`moveItem`）/ 单条移除 / 清空         |
| 数量上限 | —           | —      | 200 张（`MAX_IMAGES`），超出截断并提示                          |
| 页面模式 | 下拉        | `auto` | `auto` 跟随图片像素尺寸 / `a4` A4 等比 contain + 居中           |
| 页边距   | 数字输入    | `0`    | 仅 A4 模式显示；0–50 mm（`MAX_MARGIN_MM`）                      |
| 输出目录 | 输入 + 选择 | 记忆值 | 同 2.1                                                          |
| 开始合并 | 主按钮      | —      | 无图片、任务运行中禁用                                          |
| 结果区   | 单条结果    | —      | 输出 PDF 名 + 打开所在文件夹 + 失败项汇总（逐图失败不中断整批） |

## 3. 输入约束

| 项         | 规则                                                                 |
| ---------- | -------------------------------------------------------------------- |
| PDF 白名单 | `\.pdf$`（大小写不敏感）                                             |
| 图片白名单 | `png/jpg/jpeg/webp/bmp/tif/tiff/avif/gif`                            |
| 页码范围   | 1-based 闭区间，`1-3,5`；重复页去重；空文本 = 全部页；上限 2000 字符 |
| DPI        | 仅 72 / 150 / 300（对应 pdfjs 缩放倍率 = DPI / 72）                  |
| 页边距     | 0–50 mm；A4 可用区不足 → `PI_PAGE_SIZE_INVALID`                      |
| 图片数量   | 1–200                                                                |
| 预检       | 逐个检查存在可读 + 非独占占用（读方式 `open('r')` 探测共享冲突）     |
| 输出目录   | 请求值 > 记忆值 > `userData/pdf-images-output`；不可建/不可写即失败  |

## 4. IPC 契约

| 通道                        | 类型 | payload                                          | 返回 / 事件                                                   |
| --------------------------- | ---- | ------------------------------------------------ | ------------------------------------------------------------- |
| `pdf-images:pdf-info`       | 同步 | `{ inputPath }`                                  | `{ pageCount, fileName }`                                     |
| `pdf-images:config`         | 同步 | `{}`                                             | `{ outputDir }`（记忆值或默认目录）                           |
| `pdf-images:set-output-dir` | 同步 | `{ outputDir }`                                  | `{ outputDir }`（建目录 + 落 settings）                       |
| `pdf-images:pdf-to-images`  | 任务 | `{ inputPath, ranges, format, dpi, outputDir? }` | `{ taskId }` → `done { outputs, pages, outputDir, failures }` |
| `pdf-images:images-to-pdf`  | 任务 | `{ inputPaths, pageSize, marginMm, outputDir? }` | `{ taskId }` → `done { output, pages, failures }`             |

- 所有 payload 经 `schema.ts` zod 校验，失败统一 `INVALID_PAYLOAD`（取首条 issue 文案）
- `progress`：`{ current, total, stage: 'render' | 'embed', message: 文件名 }`
- 取消：壳 `lumin:task:cancel` → 队列 abort → worker terminate → `CANCELLED`
- 结构化错误：`{ code, message, detail? }`（UPPER_SNAKE，`detail` 仅技术细节）

## 5. 命名与输出

- PDF → 图片：`{PDF 基名}_p{页码}.{png|jpg}`（如 `试卷_p3.jpg`），输出到指定目录
- 图片 → PDF：`{首图基名}_合并.pdf`；同名冲突自动 `{base} ({n}).pdf`（Windows 大小写不敏感）
- 写盘一律 `.tmp` + `rename` 原子落盘；失败 best-effort 删除半成品
- 单页/单图失败记入 `failures`（`{ file, code, message, detail? }`）并继续；全部失败抛首个结构化错误

## 6. 性能与时限

| 项             | 基线                                                                 |
| -------------- | -------------------------------------------------------------------- |
| 渲染引擎       | pdfjs-dist legacy + `@napi-rs/canvas`（worker 线程）                 |
| 单任务超时     | 10 分钟（`CONVERT_TIMEOUT_MS`），超时杀 worker → `PI_CONVERT_FAILED` |
| 渲染倍率       | DPI/72；150 DPI ≈ 2.08×，300 DPI ≈ 4.17×                             |
| 图片直嵌       | png/jpg 直接用 `pdf-lib` 嵌入，无重编码                              |
| 其他图片       | ffmpeg `-frames:v 1` 转 PNG 中间件（单张超时 120s）                  |
| renderer chunk | 30.8KB raw / **7.8KB gzip**（R5 基线 <200KB gzip）                   |

## 7. 错误码

| 错误码                  | 中文文案                                         | 可重试 | 触发点                         |
| ----------------------- | ------------------------------------------------ | ------ | ------------------------------ |
| `PI_INPUT_INVALID`      | 输入文件不存在或不受支持                         | 否     | 白名单不符 / ENOENT            |
| `PI_PDF_ENCRYPTED`      | PDF 已加密，请先解除密码保护                     | 否     | pdfjs `PasswordException`      |
| `PI_PDF_CORRUPT`        | PDF 无法解析，可能已损坏                         | 是     | pdfjs 解析异常                 |
| `PI_PDF_LOCKED`         | PDF 正被其他程序占用，请关闭后重试               | 是     | `EBUSY/EPERM/EACCES` 预检      |
| `PI_RANGE_INVALID`      | 页码范围不正确，请检查后重试                     | 是     | 语法错 / 越界                  |
| `PI_OUTPUT_DIR_INVALID` | 输出目录不可用或不可写                           | 是     | `ENOSPC/EROFS/EACCES/ENOTDIR…` |
| `PI_DPI_INVALID`        | 分辨率参数不正确（仅支持 72 / 150 / 300）        | 是     | zod 校验                       |
| `PI_PAGE_SIZE_INVALID`  | 页面尺寸参数不正确                               | 是     | 边距过大 / 图片尺寸非法        |
| `PI_IMAGE_UNSUPPORTED`  | 不支持的图片格式                                 | 否     | 扩展名白名单                   |
| `PI_IMAGE_CORRUPT`      | 图片无法解码，可能已损坏                         | 是     | 解码/转码失败                  |
| `PI_ENGINE_MISSING`     | 图片处理引擎未就绪，请运行 fetch 脚本获取 ffmpeg | 否     | 非 png/jpg 且缺 ffmpeg         |
| `PI_CONVERT_FAILED`     | 转换失败，请检查输入后重试                       | 是     | worker 超时/崩溃/写盘未知错误  |

## 8. 三态（R4）

| 状态   | 实现                                                           |
| ------ | -------------------------------------------------------------- |
| 空态   | `NEmpty` 引导 + `DropZone` 主操作，禁止白屏                    |
| 加载态 | `TaskProgress` 显示 `current/total` + 文件名，可取消           |
| 报错态 | 结构化错误中文文案 + 可重试项 `[重试]` + `详情`（detail 折叠） |

## 9. 验收

- 单测：contract / schema / node / 两个 worker（真实 PNG/JPEG 编码、真实 PDF 落盘）
- e2e：`apps/desktop/e2e/pdf-images-smoke.spec.ts`（3 用例，真实 Electron + worker）
- R2 八类：`docs/smoke/pdf-images.md`
- gate：lint / typecheck / test / audit / boundary 全绿；chunk < 200KB gzip
