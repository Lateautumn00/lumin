# PDF 图片转换（pdf-images）冒烟记录

> 里程碑 M11（2026-11-19）· 工具 `pdf-images` · 规格 `docs/spec/pdf-images.md`
> 验证环境：Windows 11 x64 · Electron 45.3.1 · `pnpm -F @lumin/desktop build` 产物
> 自动化：`pnpm -F @lumin/desktop exec playwright test e2e/pdf-images-smoke.spec.ts` → **5/5 通过（23.2s）**

---

## 1. 验收总览

| 项  | 检查点                         | 方式     | 结果                                                                                                           |
| --- | ------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | 页面加载 / 两 Tab / 空态       | e2e      | ✅ 侧边栏「PDF 图片转换」→ 标题 + 两个页签可见，空态有引导                                                     |
| 2   | 图片→PDF（中文+空格路径 R2.1） | e2e      | ✅ `第一张 图.png`+`第二张.png` → `第一张 图_合并.pdf`，2 页，`%PDF-`                                          |
| 3   | PDF→图片（jpeg）               | e2e      | ✅ `单页_合并.pdf` + 范围 `1` + 150DPI → `单页_合并_p1.jpg`，`ffd8ff`                                          |
| 4   | R2.3 损坏 / 加密 PDF           | e2e      | ✅ 损坏 → `PI_PDF_CORRUPT`；RC4-40 加密 → `PI_PDF_ENCRYPTED`                                                   |
| 5   | 页码越界 / 文件不存在          | e2e      | ✅ 范围 `9`（1 页 PDF）→ `PI_RANGE_INVALID`；不存在 → `PI_INPUT_INVALID`                                       |
| 6   | R2.2 占用 PDF                  | e2e      | ✅ PowerShell 独占打开 → `pdf-info` 返回 `PI_PDF_LOCKED`                                                       |
| 7   | R2.5 任务取消                  | e2e      | ✅ 120 张合并，首个 progress 后 cancel → `CANCELLED`                                                           |
| 8   | R2.4 多页大文件                | e2e      | ✅ 100 页 PDF（600×400/页）→ `ranges=1-100` 全量渲染 **100/100**                                               |
| 9   | R2.6 并发排队                  | e2e      | ✅ 同时提交 3 个任务（含排队）→ 3 × `done`                                                                     |
| 10  | R2.7 输出目录不可写            | e2e      | ✅ `icacls /deny <user>:(WD,AD)` → `PI_OUTPUT_DIR_INVALID`，目录无残留                                         |
| 11  | R2.8 强杀恢复                  | e2e      | ✅ 100 张任务中 `taskkill /F /T` → 重启后再次转换成功、产物 `%PDF-`                                            |
| 12  | R5 chunk（<200KB gzip）        | 构建实测 | ✅ `pdf-images-*.js` **30,842 B raw / 7,825 B gzip**                                                           |
| 13  | 运行时资产单列（R5 口径）      | 构建实测 | ℹ️ pdfjs worker `pdf.worker.min-*.mjs` 1,271,915 B raw / 379,243 B gzip（exam-split 已单列的同一资产，非新增） |

## 2. R2 八类异常清单（逐条实测证据）

| 编号             | 方式   | 记录                                                                                                                                                                                                                                  |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 中文/空格路径 | e2e #1 | 输入 `第一张 图.png` / `第二张.png`，输出 `第一张 图_合并.pdf`；再作为 PDF→图片输入读取页数成功                                                                                                                                       |
| 2. 文件被占用    | e2e #3 | PowerShell `[System.IO.File]::Open(..., 'ReadWrite', 'None')` 独占 `锁定.pdf` → `PI_PDF_LOCKED` /「PDF 正被其他程序占用…」                                                                                                            |
| 3. 加密文件      | e2e #4 | 现场生成 RC4 40-bit 加密 PDF（用户密码 `secret`，标准 `/Filter /Standard /V 1 /R 2`）→ pdfjs `PasswordException` → `PI_PDF_ENCRYPTED`                                                                                                 |
| 4. 超大文件      | e2e #4 | 同一 PNG 重复 100 次合成 100 页 PDF，`ranges=1-100`、72DPI 渲染 **100 张全部成功**，`failures=[]`；单任务超时 10 分钟兜底                                                                                                             |
| 5. 任务取消      | e2e #3 | 120 张 1000×1000 PNG，首个 `progress` 后 `lumin:task:cancel` → 终态 `CANCELLED`（worker terminate，无半成品最终文件）                                                                                                                 |
| 6. 并发溢出      | e2e #5 | 3 个任务同时提交，超出并发上限的排队执行，全部 `done`（队列不丢任务）                                                                                                                                                                 |
| 7. 磁盘满        | e2e #4 | 输出目录 `icacls /deny <user>:(WD,AD)` → 写 `.tmp` `EACCES` → `PI_OUTPUT_DIR_INVALID`，目录无残留；`ENOSPC` 分支由 `images.worker.test.ts`/`pdf.worker.test.ts` 的 `classifyWriteError` 单测覆盖（与 image-toolbox 同口径，未建 VHD） |
| 8. 断电恢复      | e2e #5 | 100 张合任务执行中 `taskkill /PID <main> /F /T` 强杀 → 重启应用后再次转换成功，输出 `%PDF-` 完整；可能残留 `.tmp`，下次写同名文件时截断覆盖，不污染设置与最终产物                                                                     |

## 3. 三态与交互（R4）

| 状态   | 记录                                                                                  |
| ------ | ------------------------------------------------------------------------------------- |
| 空态   | 两个 Tab 均有 `NEmpty` 引导 + `DropZone` 主操作，无白屏                               |
| 加载态 | `TaskProgress` 显示 `当前/总数 + 文件名`，取消按钮可用（e2e 已验证可中断）            |
| 报错态 | 结构化错误码 → 中文文案；可重试码显示 `[重试]`，`detail` 折叠「详情」                 |
| 选项   | DPI 72/150/300；格式 PNG/JPG；页码范围留空=全部页；A4 边距 0–50mm；图片上移/下移/移除 |

## 4. 实现注记

- **渲染链路**：`node-kit/pdf`（pdfjs-dist legacy + `@napi-rs/canvas`）在 worker 内逐页渲染；白底补白后 `canvas.toBuffer('image/png')` / `canvas.encode('jpeg', q)`（spike 结论：无需 ffmpeg 编码兜底）
- **合并链路**：png/jpg 直接 `pdf-lib.embedPng/embedJpg`；webp/bmp/tiff/avif/gif 走 ffmpeg `-frames:v 1` 转 PNG 中间件；A4 模式按 `a4Layout` 等比 contain 居中
- **落盘**：`.tmp` + `rename` 原子写；最终名冲突 `{base} ({n}).pdf`（Windows 大小写不敏感）
- **命名修复**：`mergedPdfName` 保留目录前缀（供契约单测），worker 侧用 `path.basename` 收敛为纯文件名后再 `join(outputDir, name)`（首轮 e2e 前的 ENOENT 缺陷回归点）
- **页签渲染**：沿用 naive-ui 2.45.3 规避方案——`NTabs` 仅作切换器、内容 `v-if`、页签走 `#tab` 插槽

## 5. 遗留 / 已知限制

- 未做 GB 级单文件压力测试（R2.4 以 100 页多页 PDF 覆盖；超时上限 10 分钟）
- 加密 PDF 仅覆盖「有打开密码」路径；权限密码（仅限制编辑）按 pdfjs 语义直接可读，未单列
- 输出目录默认 `userData/pdf-images-output`，首次使用不自动创建直到开始任务（避免空目录）
