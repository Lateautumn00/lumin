# 文件预览（file-preview）· M56 规格

> 状态：**已实施（I1，2026-11-22）**（plan §4.56 / Q57）· 增量 I1
> 目标：单窗口内预览文本 / Markdown / HTML / JSON / CSV / PDF / 图片，以及 doc/docx/xls/xlsx/ppt/pptx（LibreOffice → PDF）。

## 1. 清单与分类

- id `file-preview` · name「文件预览」· category `document` · icon `eye` · 主进程：有
- 复用：`@lumin/ui/DropZone.vue`、`@lumin/ui/TaskProgress.vue`、`@lumin/node-kit/pdf`、`@lumin/node-kit/office`（新增）、`@lumin/ui/markdown.ts`（新增）、`@lumin/shared/csv.ts`（新增）、`@lumin/shared/text-file.ts`（新增）。

## 2. 字段级功能清单

| 区域 | 按钮/控件 | 输入项 | 行为 |
| --- | --- | --- | --- |
| 空态 | 选择文件 / 拖拽区 | 文件路径 | 支持全格式；不支持进错误态 |
| 文本类 | — | 只读 `<pre>` | 2MiB 截断提示「已截断」 |
| Markdown | 预览 / 源码 | — | sandbox iframe，禁脚本 |
| HTML | 预览 / 源码 | — | 严格 CSP `default-src 'none'` |
| JSON | 格式化 / 源码 | — | 解析失败回源 + 错误行 |
| CSV | — | 表格（前 1000 行） | RFC4180，失败显示行号 |
| PDF | 上一页 / 下一页 / 页码框 / 缩放 ± | 页码 | 逐页 PNG，LRU 5 页 |
| 图片 | — | — | `asset-url` 展示 |
| Office | 转为预览 / 取消 / 重试 | 文件路径 | 转换任务（可取消）→ PDF 视图 |
| 错误态 | 重试 / 详情 / 设置 soffice 路径 | 路径输入 | 错误码中文 + 操作入口 |

## 3. IPC

| action | 类型 | 入参 → 出参 |
| --- | --- | --- |
| `inspect` | sync | `{path}` → `{previewId,kind,ext,name,size,pageCount?}` |
| `read-text` | sync | `{path,maxBytes?}` → `{text,encoding,eol,truncated}` |
| `asset-url` | sync | `{path}` → `{url}`（仅图片，`lumin-media://` 协议 URL） |
| `convert-office` | task | `{path}` → progress → `{previewId,pageCount}` |
| `render-pdf-page` | sync | `{previewId,page,scale?}` → `{png,width,height}` |
| `release-preview` | sync | `{previewId}` → `{released}` |
| `soffice-status` | sync | — → `{found,path?}` |
| `set-soffice-path` | sync | `{path}` → `{found,path?}` |

## 4. 错误码

`FP_UNSUPPORTED / FP_NOT_FOUND / FP_LOCKED / FP_TOO_LARGE / FP_READ_FAILED / FP_TEXT_DECODE_FAILED / FP_PARSE_FAILED / FP_PDF_PASSWORD / FP_PDF_RENDER_FAILED / FP_SOFFICE_MISSING / FP_CONVERT_FAILED / FP_CONVERT_TIMEOUT / FP_INVALID_PATH`

## 5. 三态

- 空态：DropZone + 支持格式说明。
- 加载态：Office 转换 `TaskProgress`（可取消）；PDF 页渲染骨架。
- 错误态：结构化错误码 + 中文 + 重试/详情；`FP_SOFFICE_MISSING` 提供自定义路径。

## 6. 资源与清理

- 临时 PDF：`ctx.paths.temp/lumin-file-preview/<taskId>.pdf`；`release-preview` 删除；启动清理 >24h。
- soffice 串行（工具内 mutex + 任务队列），超时 60s，取消终止子进程。
- 渲染层不打包 pdfjs（主进程渲染为 PNG 回传）。

## 7. 验收

- 纯函数单测 ≥80%（formats/schema/errors/client）。
- e2e `file-preview-smoke.spec.ts`：文本/Markdown/HTML/JSON/CSV/图片/PDF 翻页/不支持格式；Office 转换以 `LUMIN_E2E_SOFFICE=1` 门控。
- chunk <200KB gzip；R2 八类见 `docs/smoke/file-preview.md`。
