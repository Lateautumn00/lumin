# 文件打印（print）— 字段级功能清单

> 里程碑：M68（plan Q69 / §4.68）· 状态：已定稿（2026-11-25）
> 用途：本工具验收附件，R8 要求先行定稿；实现变更须同步本文件与 plan。

## 0. 定位与边界

- 独立工具 `@lumin/tool-print`（id `print`，分类 `document`，图标 `printer`，order 72）。
- 一次只做「把本地文件交给系统打印」，**不提供**应用内预览、打印机选择、份数/双面/纸型参数、静默打印、打印历史。
- 不做：网页/HTML 输入、OFD、CAD、压缩包内文件、扫描仪、导出 PDF（归 `docx2pdf`/`pdf-toolkit`）。

## 1. 输入

| 项         | 规则                                                                                |
| ---------- | ----------------------------------------------------------------------------------- |
| 支持扩展名 | Office：`doc/docx/xls/xlsx/ppt/pptx`；PDF：`pdf`；图片：`png/jpg/jpeg/webp/bmp/gif` |
| 选择方式   | 拖拽（DropZone 多选）/ 点击选择；`getPathForFile` 取绝对路径                        |
| 数量       | 1–50，超出 → `PR_TOO_MANY_FILES`                                                    |
| 单文件体积 | ≤ 500 MiB，超出 → `PR_TOO_LARGE`                                                    |
| 去重       | 同一路径只保留首次出现                                                              |
| 清单       | 每项显示序号、文件名、类型徽标（Office/PDF/图片）、大小、移除按钮                   |
| 清空       | 「清空」按钮一次移除全部；打印中禁用                                                |

## 2. 操作区（按钮集）

| 按钮     | 位置            | 行为                                                 | 禁用条件                                                        |
| -------- | --------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| 添加文件 | 空态 / 清单下方 | 打开文件选择器（多选）                               | 打印中                                                          |
| 清空     | 清单工具栏      | 移除全部条目并调用 `print:cleanup`                   | 打印中 / 清单为空                                               |
| 开始打印 | 底部主操作      | 提交 `print:prepare` → 逐份 `print:show`             | 清单为空 / 列表含无效项 / 打印中 / soffice 缺失且含 Office 文件 |
| 取消     | 加载态          | 取消当前任务（prepare 或 show）                      | 无任务                                                          |
| 重试     | 报错态          | 按最后一次失败阶段重跑（prepare 整批 / show 当前份） | 错误码不可重试                                                  |
| 详情     | 报错态          | 展开/收起 `detail`                                   | 无 detail                                                       |
| 移除     | 每行            | 从清单删除该项                                       | 打印中                                                          |
| 重新选择 | 成功态          | 清空结果回空态                                       | —                                                               |

## 3. 状态机

```
idle ──开始打印──▶ preparing ──done──▶ printing ──全部完成──▶ done
  ▲                    │                  │
  │                    └─error/cancel─────┴─error/cancel──▶ error / idle(取消)
  └──────────────── 重新选择 / 清空 ─────────────────────┘
```

- `preparing`：单个任务（`print:prepare`），进度按文件数推进，阶段文案：`定位转换组件…` → `正在准备第 N/M 份…`。
- `printing`：逐份串行调用 `print:show`；每份独立 task，进度文案 `正在准备打印…` → `请在系统打印对话框中确认（第 N/M 份）…`。
- 取消：`preparing` 取消 → 任务终态 `CANCELLED`，清空临时产物，回 `idle`；`printing` 取消 → 关闭打印窗口，回 `idle` 并中止后续份。
- 用户关闭打印对话框（取消打印）→ `PR_PRINT_CANCELLED`，**不计入失败**，继续下一份；全部结束若没有任何失败则回 `done` 并提示「已取消」。
- 成功态展示：成功份数 / 失败份数 / 已取消份数 + 失败项错误码与文案列表。

## 4. 三态

| 态     | 要求                                                                                                                             |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 空态   | DropZone + 支持格式与数量上限说明 +「Office 文件需要 LibreOffice 转换组件」提示                                                  |
| 加载态 | `TaskProgress`：带 `current/total` 百分比 + 阶段文案 + 取消按钮；等待系统对话框时**不确定进度**（NSpin），**禁止固定超时判失败** |
| 报错态 | `role="alert"` 卡片：中文文案 + 错误码 + 详情折叠 + 可重试码显示「重试」                                                         |

## 5. 错误码

| 码                      | 文案                                                | 可重试         |
| ----------------------- | --------------------------------------------------- | -------------- |
| `PR_UNSUPPORTED_FORMAT` | 不支持的文件类型                                    | 否             |
| `PR_NOT_FOUND`          | 文件不存在，请重新选择                              | 否             |
| `PR_LOCKED`             | 文件被其他程序占用，请关闭后重试                    | 是             |
| `PR_TOO_LARGE`          | 文件超过 500 MiB，无法打印                          | 否             |
| `PR_SOFFICE_MISSING`    | 未检测到 LibreOffice 转换组件，无法打印 Office 文件 | 否             |
| `PR_CONVERT_FAILED`     | Office 转 PDF 失败                                  | 是             |
| `PR_CONVERT_TIMEOUT`    | Office 转 PDF 超时（60 秒），已终止                 | 是             |
| `PR_PDF_PASSWORD`       | PDF 已加密，请先解除密码保护                        | 否             |
| `PR_PDF_BROKEN`         | PDF 无法解析（可能已损坏）                          | 否             |
| `PR_PRINT_FAILED`       | 打印失败，请重试或检查打印机                        | 是             |
| `PR_PRINT_CANCELLED`    | 已取消打印                                          | 否（不计失败） |
| `PR_PRINT_BUSY`         | 已有打印任务进行中，请等待完成                      | 是             |
| `PR_INVALID_PATH`       | 文件路径无效                                        | 否             |
| `PR_TOO_MANY_FILES`     | 单次最多打印 50 个文件                              | 否             |

## 6. IPC 契约

| 通道            | 形态 | 入参                                            | 回参                                             |
| --------------- | ---- | ----------------------------------------------- | ------------------------------------------------ |
| `print:status`  | sync | `{}` 或 `{ customPath?: string }`（传值即保存） | `{ soffice: { available, path?, customPath } }`  |
| `print:prepare` | task | `{ inputPaths: string[] }`                      | `{ jobs: PrintJob[], failures: PrintFailure[] }` |
| `print:show`    | task | `{ jobId: string }`                             | `{ jobId, name, pageCount? }`                    |
| `print:cleanup` | sync | `{ jobIds?: string[] }`                         | `{ removed: number }`                            |

`PrintJob = { jobId, name, sourcePath, kind: 'office'|'pdf'|'image', pageCount? }`
`PrintFailure = { inputPath, code, message, detail? }`

- 所有入参 zod 校验；路径必须为绝对路径（`PR_INVALID_PATH`）。
- `jobId` 为 `[a-z0-9-]{8,64}`，映射仅存主进程内存（不落盘），应用重启后失效。
- 临时产物：`<userData>/temp/lumin-print/<jobId>.pdf|.html`；注册时清理 mtime >24h 的残留；`print:cleanup` 删除指定/全部 job 产物。

## 7. 打印实现口径

- PDF：隐藏 `BrowserWindow`（`plugins:true`、`sandbox:true`、`contextIsolation:true`、`nodeIntegration:false`、无 preload、`setWindowOpenHandler` deny、`will-navigate` 拦截）加载 `file://` → `showInactive()` → `webContents.print({ silent:false })`；`did-fail-load` → `PR_PDF_BROKEN`。
- 栅格兜底：视图装载失败时用 `node-kit/pdf` 按 scale 2 逐页渲染 PNG 落盘 → 生成 `@page` A4 的 HTML → 同一窗口打印。
- PDF 页面尺寸：视图窗口忽略 `pageSize`，按原页面尺寸；HTML 图片固定 A4、`object-fit: contain`。
- Office：`node-kit/office` 定位 `soffice`（自定义路径 / 系统 / 便携三级）+ 串行锁 + 60s 超时 + `%PDF-` 产物校验；转出 PDF 落 job 目录。
- 打印前置预检：PDF 与 Office 产物用 `node-kit/pdf` 打开取页数；`PasswordException` → `PR_PDF_PASSWORD`，其余解析失败 → `PR_PDF_BROKEN`。
- 同一时刻仅允许一份 `print:show`，并发 → `PR_PRINT_BUSY`。

## 8. 验收断言

1. 拖入 1 个 PDF → 点击开始 → 弹出系统打印对话框；取消对话框 → UI 回空态并提示「已取消」，无错误码卡片。
2. 拖入 2 个图片 + 1 个 docx → 逐份弹框，序号与文件名匹配，全部完成后显示成功 3 份。
3. 文件不存在 → 该份失败 `PR_NOT_FOUND`，其余份继续；结果区列出失败项。
4. 加密 PDF → `PR_PDF_PASSWORD`；损坏 PDF → `PR_PDF_BROKEN`。
5. 未安装 LibreOffice 且含 Office 文件 → `PR_SOFFICE_MISSING`，页面给出安装引导。
6. 打印中点击取消 → 任务终态 `CANCELLED`，打印窗口关闭，临时产物清理。
7. 51 个文件 → `PR_TOO_MANY_FILES`；>500 MiB → `PR_TOO_LARGE`。
8. dry-run 模式：`print:show` 产出 PDF 文件且非空，UI 正常回「完成」。
