# pdf-toolkit（PDF 工具集）冒烟记录

> 工具：`pdf-toolkit`（M15，2026-11-19；M17 水印/页码追加，2026-11-19；M38 文本/图片提取与压缩追加，2026-11-21；M63 PDF→HTML 结构化导出追加，2026-11-24）
> 规格：`docs/spec/pdf-toolkit.md` · 自动化：`apps/desktop/e2e/pdf-toolkit-smoke.spec.ts`
> 手工复现环境：Windows x64 · Electron 45.3.1 · 本地离线
> 结论：八类异常全部有覆盖路径；不可实测项（磁盘满、真实断电）如实标注并以等价手段验证。

## 1. 自动化结果（e2e 10 用例）

| #   | 用例                                             | 断言                                                                                                                                                                          | 结果 |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | 页面加载 + 空态 + 八 Tab + 合并（中文/空格路径） | 八个页签可见；`第一份 卷_合并.pdf` 存在、`%PDF-` 头、6 页                                                                                                                     | 通过 |
| 2   | 拆分 / 删页 / 越界 / 删光                        | `1-2,4-5` 两产物各 2 页；`1-9`→`PT_RANGE_INVALID`；`2,4`→3 页；`1-5`→`PT_NO_PAGES_LEFT`                                                                                       | 通过 |
| 3   | 旋转 / 重排 / 元数据 / 损坏 / 不存在             | 三个产物命名与页数正确；非全排列→`PT_ORDER_INVALID`；元数据回读一致；空元数据→`INVALID_PAYLOAD`；损坏→`PT_PDF_CORRUPT`；缺失→`PT_INPUT_INVALID`                               | 通过 |
| 4   | 占用 PDF                                         | PowerShell 独占句柄下 `info`→`PT_PDF_LOCKED`                                                                                                                                  | 通过 |
| 5   | 取消 + 并发排队                                  | 合并 60 文件首个 progress 后取消→`CANCELLED`；3 个重排并发全部 `done`                                                                                                         | 通过 |
| 6   | 水印（中文空格路径 + 损坏图片）                  | `水印 卷_水印.pdf` 3 页、`%PDF-`；平铺再跑→`水印 卷_水印(1).pdf`；图片缺失/损坏→`PT_WATERMARK_INVALID`；未选 PDF 时按钮禁用                                                   | 通过 |
| 7   | 页码（起始页/模板拦截）                          | `page-numbers` `{n}/{total}`+`startPage=2`→`页码 卷_页码.pdf` 3 页；中文模板/缺 `{n}`→`INVALID_PAYLOAD`；无目标页→`PT_PAGE_NUMBER_INVALID`                                    | 通过 |
| 8   | 源目录不可写 + 强杀恢复                          | `icacls` deny 后写盘→`PT_OUTPUT_WRITE_FAILED`；合并中 `taskkill /T` 强杀，重启后重排成功                                                                                      | 通过 |
| 9   | 文本/图片提取 + 压缩                             | 无文本层→`PT_NO_TEXT_LAYER`；加页码后抽文本含「第 1 页」与 `1/2`；图片目录 `提取 卷_图片` 下 PNG 签名正确；压缩产物 `提取 卷_压缩.pdf` 页数不变                               | 通过 |
| 10  | PDF→HTML 结构化导出（M63）                       | 图片型 PDF→`PT_PDF_NO_TEXT`；加页码后导出第 1 页→`网页 卷_页码.html`，含 doctype/`<title>`/`第 1 页` 区块、无 `第 2 页` 与 `<script>`；UI 第十二页签可见、未选 PDF 时按钮禁用 | 通过 |

## 2. R2 八类异常逐条

| 类别             | 场景与验证                                                                                                                                                                                                                                                          | 结果             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1. 中文/空格路径 | 用例 1/2/3：`第一份 卷.pdf`、`五页卷_p1-2.pdf`、`期末 试卷` 元数据；用例 6：`水印 卷.pdf`/`印章.png`；用例 9：`提取 卷.pdf` → `提取 卷_页码.pdf`/`提取 卷_页码_文本.txt`/`提取 卷_图片/`/`提取 卷_压缩.pdf`；用例 10：`网页 卷.pdf` → `网页 卷_页码.html`           | 通过             |
| 2. 文件被占用    | 用例 4：`FileShare.None` 独占句柄 → 预检读打开失败 → `PT_PDF_LOCKED`（可重试）；水印图片占用同分支 → `PT_WATERMARK_INVALID`；提取/压缩/HTML 导出同走 `openPdf` 预检，占用同样归 `PT_PDF_LOCKED`                                                                     | 通过             |
| 3. 加密文件      | 单测：`pdf-lib` 抛 `is encrypted` → `PT_PDF_ENCRYPTED`；e2e 未加密样本（与 pdf-images/exam-split 同库同判定，加密样本由其 e2e 覆盖）；M38 提取/压缩复用 `openPdf`，加密同样提前失败；M63 HTML 导出按 plan §4.63.3 将加密/无文本层统一归 `PT_PDF_NO_TEXT`            | 通过（单测）     |
| 4. 超大文件      | 60 页合并/拆分（单测 5 页 + e2e 60 页）；水印/页码按页循环 + 120 秒超时保护；压缩按页栅格化、每页检查取消；图片提取另有 2000 张上限→`PT_TOO_MANY_IMAGES`；HTML 导出为纯文本重建，无额外内存峰值，未做 GB 级手工验证                                                 | 通过（限定规模） |
| 5. 任务取消      | 用例 5：首个 progress 后 `lumin:task:cancel` → `CANCELLED`，worker 被 terminate（水印/页码/提取/压缩/HTML 导出同任务模型，逐页检查 `signal`）                                                                                                                       | 通过             |
| 6. 并发溢出      | 用例 5：3 个任务同时提交，队列串行执行，全部 `done`；并发上限由壳统一配置；提取/压缩/HTML 导出与其他 op 共用队列                                                                                                                                                    | 通过             |
| 7. 磁盘满        | 无法安全制造 ENOSPC；用 ACL deny 写/删（用例 8）覆盖同一条写盘失败分支 → `PT_OUTPUT_WRITE_FAILED`，并清理半成品；M38 文本/压缩写盘同样清理半成品文件，图片目录创建/写图失败会 `rm -rf` 清理半成品目录；M63 HTML 写盘失败清理半成品并归 `PT_EXPORT_FAILED`（可重试） | 等价覆盖         |
| 8. 断电恢复      | 无法真实断电；用例 8 用 `taskkill /F /T` 模拟进程树被强杀，重启后对同一输入再次重排成功；残留半成品不阻塞后续（冲突命名 `(n)`，图片目录与 HTML 产物亦按 `(n)` 递增）                                                                                                | 等价覆盖         |

## 3. 单元测试与覆盖率

- `pnpm exec vitest run --project @lumin/tool-pdf-toolkit`：schema/errors/naming/pdf-ops/node/client/watermark-text/pdf-html 全绿；M38 新增用例覆盖三载荷 schema 边界、三命名函数、三错误码、三 op（加页码后抽文本、内嵌 PNG 抽图、压缩页数不变）；M63 新增 `pdf-html.test.ts`（转义/拼接/标题分位/段落分段/列表/空页）+ op 导出（转义/指定页/无文本层/重名递增）。
- `@lumin/node-kit` 新增 `src/pdf/extract.test.ts`（12 用例）：`buildPageText` 换行/空页/裁空白、`decodeRawImage` 1bpp/RGB/RGBA/bitmap/非法长度、`extractPdfText`/`extractPdfImages`（假 doc 句柄）；M63 追加 `toRawTextItems`/`buildTextLines`/`extractPdfLines`（真实 PDF + 空白页 + 取页失败）。
- 包覆盖率阈值 80%（lines/functions/statements/branches），`pnpm coverage` 通过（M38 增量后仍 ≥80%）。
- 纯函数（范围解析、命名、全排列校验、颜色换算、旋转锚点、页码位置/模板、文本行拼接、原始位图解码）与十一类 PDF 操作均以真实 `pdf-lib` 样本验证。

## 4. 性能与体量

- renderer 仅含 UI 与 client，`pdf-lib` 全部在主进程 worker 侧；M38 实测（`pnpm --filter @lumin/desktop build`）：`out/renderer/assets/pdf-toolkit-CZrZr1V1.js` 62,800 B raw / 13,633 B gzip（含三新 Tab 表单；远低于 200KB gzip，R5）。
- M38 新增逻辑全部在主进程 worker 侧：文本提取走 `pdfjs-dist` legacy 构建的 `getTextContent`，图片提取走 `getOperatorList` + `@napi-rs/canvas` PNG 编码，压缩复用既有 `renderPageToCanvas` + `encodeCanvas('jpeg')`；pdfjs/canvas 产物 `out/main/chunks/pdf.worker-*.js`（约 1.1MB raw）走主进程 worker，不属 R5 renderer chunk 口径。
- M63 实测（2026-11-24）：`out/renderer/assets/pdf-toolkit-Dj1R2gBl.js` **64,720 B raw / 13,800 B gzip**（含 PDF→HTML 的页码范围表单；文本行抽取与 HTML 构建全部在 worker 侧，无新增 renderer 依赖；**13.8KB gzip ≪ 200KB，R5 达标**）。
- renderer 侧仅新增表单 UI（页码范围输入、档位下拉、三个提交按钮），无新增第三方依赖。
- 单页级操作毫秒级；60 页合并/拆分为秒级，满足常规试卷/文档整理。
- 水印/页码按页循环 + 单次写盘；文字水印栅格化固定 160px 高画布，base64 通常 < 100KB（上限 4MB 保护）。
- 压缩按页渲染 + JPEG 编码，耗时随 DPI 与页数增长（低档 96 DPI 优先）；图片提取按内容 SHA256 去重，重复图片只写一份。

---

## 并入页签：pdf-images（M76 合并，原独立工具文档）

# PDF 图片转换（pdf-images）冒烟记录

> 里程碑 M11（2026-11-19）/ M34（2026-11-21 增强）· 工具 `pdf-images` · 规格 `docs/spec/pdf-images.md`
> 验证环境：Windows 11 x64 · Electron 45.3.1 · `pnpm -F @lumin/desktop build` 产物
> 自动化：`pnpm -F @lumin/desktop exec playwright test e2e/pdf-images-smoke.spec.ts` → **6/6 通过**

---

## 1. 验收总览

| 项  | 检查点                                         | 方式     | 结果                                                                                                           |
| --- | ---------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | 页面加载 / 两 Tab / 空态                       | e2e      | ✅ 侧边栏「PDF 图片转换」→ 标题 + 两个页签可见，空态有引导                                                     |
| 2   | 图片→PDF（中文+空格路径 R2.1）                 | e2e      | ✅ `第一张 图.png`+`第二张.png` → `第一张 图_合并.pdf`，2 页，`%PDF-`                                          |
| 3   | PDF→图片（jpeg）                               | e2e      | ✅ `单页_合并.pdf` + 范围 `1` + 150DPI → `单页_合并_p1.jpg`，`ffd8ff`                                          |
| 4   | R2.3 损坏 / 加密 PDF                           | e2e      | ✅ 损坏 → `PI_PDF_CORRUPT`；RC4-40 加密 → `PI_PDF_ENCRYPTED`                                                   |
| 5   | 页码越界 / 文件不存在                          | e2e      | ✅ 范围 `9`（1 页 PDF）→ `PI_RANGE_INVALID`；不存在 → `PI_INPUT_INVALID`                                       |
| 6   | R2.2 占用 PDF                                  | e2e      | ✅ PowerShell 独占打开 → `pdf-info` 返回 `PI_PDF_LOCKED`                                                       |
| 7   | R2.5 任务取消                                  | e2e      | ✅ 120 张合并，首个 progress 后 cancel → `CANCELLED`                                                           |
| 8   | R2.4 多页大文件                                | e2e      | ✅ 100 页 PDF（600×400/页）→ `ranges=1-100` 全量渲染 **100/100**                                               |
| 9   | R2.6 并发排队                                  | e2e      | ✅ 同时提交 3 个任务（含排队）→ 3 × `done`                                                                     |
| 10  | R2.7 输出目录不可写                            | e2e      | ✅ `icacls /deny <user>:(WD,AD)` → `PI_OUTPUT_DIR_INVALID`，目录无残留                                         |
| 11  | R2.8 强杀恢复                                  | e2e      | ✅ 100 张任务中 `taskkill /F /T` → 重启后再次转换成功、产物 `%PDF-`                                            |
| 12  | R5 chunk（<200KB gzip）                        | 构建实测 | ✅ `pdf-images-*.js` **30,842 B raw / 7,825 B gzip**                                                           |
| 13  | 运行时资产单列（R5 口径）                      | 构建实测 | ℹ️ pdfjs worker `pdf.worker.min-*.mjs` 1,271,915 B raw / 379,243 B gzip（exam-split 已单列的同一资产，非新增） |
| 14  | 打包态实测（`release/win-unpacked/Lumin.exe`） | 打包冒烟 | ✅ 图片→PDF（`%PDF-`、1 页）+ PDF→图片（`89504e47`）均成功——asar 内 pdfjs 与解包 `@napi-rs/canvas` 加载正常    |
| 15  | M34 Letter/横版/边距/自定义名（R2.1）          | e2e      | ✅ Letter + 横版 + 20mm + `自定义 名称` → 2 页 MediaBox **792×612**，重名 `(1)` 递增、不覆盖                   |

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

| 状态   | 记录                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 空态   | 两个 Tab 均有 `NEmpty` 引导 + `DropZone` 主操作，无白屏                                                                                                 |
| 加载态 | `TaskProgress` 显示 `当前/总数 + 文件名`，取消按钮可用（e2e 已验证可中断）                                                                              |
| 报错态 | 结构化错误码 → 中文文案；可重试码显示 `[重试]`，`detail` 折叠「详情」                                                                                   |
| 选项   | DPI 72/150/300；格式 PNG/JPG；页码范围留空=全部页；纸型 auto/A4/Letter；方向 自动/竖版/横版；边距预设 无/小/中/大；自定义输出文件名；图片上移/下移/移除 |

## 4. 实现注记

- **渲染链路**：`node-kit/pdf`（pdfjs-dist legacy + `@napi-rs/canvas`）在 worker 内逐页渲染；白底补白后 `canvas.toBuffer('image/png')` / `canvas.encode('jpeg', q)`（spike 结论：无需 ffmpeg 编码兜底）
- **合并链路**：png/jpg 直接 `pdf-lib.embedPng/embedJpg`；webp/bmp/tiff/avif/gif 走 ffmpeg `-frames:v 1` 转 PNG 中间件；`pageLayout` 统一出页（auto = 原图尺寸；A4/Letter 按方向取长短边、等比 contain 居中并留边距）
- **落盘**：`.tmp` + `rename` 原子写；最终名冲突 `{base} ({n}).pdf`（Windows 大小写不敏感）
- **命名修复**：`mergedPdfName` 保留目录前缀（供契约单测），worker 侧用 `path.basename` 收敛为纯文件名后再 `join(outputDir, name)`（首轮 e2e 前的 ENOENT 缺陷回归点）
- **页签渲染**：沿用 naive-ui 2.45.3 规避方案——`NTabs` 仅作切换器、内容 `v-if`、页签走 `#tab` 插槽

## 5. 遗留 / 已知限制

- 未做 GB 级单文件压力测试（R2.4 以 100 页多页 PDF 覆盖；超时上限 10 分钟）
- 加密 PDF 仅覆盖「有打开密码」路径；权限密码（仅限制编辑）按 pdfjs 语义直接可读，未单列
- 输出目录默认 `userData/pdf-images-output`，首次使用不自动创建直到开始任务（避免空目录）

## 6. M34 增强记录（2026-11-21）

| 项    | 记录                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 能力  | 纸型 `auto/A4/Letter`；方向 `自动/竖版/横版`（仅固定纸型）；边距预设 `无/小 10/中 20/大 40mm`；自定义输出文件名（≤80 字、非法字符行内提示） |
| 单测  | `pnpm exec vitest run packages/tools/pdf-images` **52/52**；`contract.ts` lines 100% / branches 97.9%，`schema.ts` 100/100/100              |
| e2e   | **6/6 通过**；新增例：Letter + 横版 + 20mm + `自定义 名称` → 2 页 MediaBox `792×612`，重名 `(1)` 递增且原文件保留                           |
| chunk | `pdf-images-*.js` **34,966 B raw / 8,712 B gzip**（R5 <200KB gzip）                                                                         |
| 兼容  | 旧请求不含 `orientation` 时 zod 默认 `auto`，`auto` 页型忽略方向/边距；未填 `outputName` 仍输出 `{首图基名}_合并.pdf`                       |

## 7. M63 附带修复（2026-11-24）

- **现象**：并发排队用例（3 任务同毫秒提交）偶发首个任务返回 `INTERNAL`，单独复跑稳定复现。
- **根因**：`images.worker.ts` 临时目录用 `lumin-pdf-images-${process.pid}-${Date.now()}` 命名；worker 线程共享主进程 pid，同毫秒启动的任务生成同名目录，先完成方 `finally` 递归清理时另一方仍在建/用目录 → `rm` EPERM，异常冒出 `finally` 后未结构化 → 壳归为 `INTERNAL`。
- **修复**：临时目录改 `lumin-pdf-images-${randomUUID()}`；清理改 `rm(...).catch(() => undefined)`，使清理失败不影响已完成任务的结果。
- **回归**：`pdf-images-smoke.spec.ts` 全量通过（含并发排队 3×`done`）。

## M76 合并后 chunk / 资产复测（2026-11-25）

- 工具 chunk：`pdf-toolkit-*.js` 97.3KB raw / **19.4KB gzip** → R5 达标（<200KB gzip）
- 运行时资产：pdfjs worker 沿用宿主既有资产口径；并入 PDF↔图片页签复用同一 worker 与 canvas 原生库，无新增资产
- 异常场景映射：并入页签沿用本节前文 pdf-images 的 R2 记录
