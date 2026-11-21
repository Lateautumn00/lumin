# pdf-toolkit（PDF 工具集）冒烟记录

> 工具：`pdf-toolkit`（M15，2026-11-19；M17 水印/页码追加，2026-11-19；M38 文本/图片提取与压缩追加，2026-11-21）
> 规格：`docs/spec/pdf-toolkit.md` · 自动化：`apps/desktop/e2e/pdf-toolkit-smoke.spec.ts`
> 手工复现环境：Windows x64 · Electron 45.3.1 · 本地离线
> 结论：八类异常全部有覆盖路径；不可实测项（磁盘满、真实断电）如实标注并以等价手段验证。

## 1. 自动化结果（e2e 9 用例）

| #   | 用例                                             | 断言                                                                                                                                            | 结果 |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | 页面加载 + 空态 + 八 Tab + 合并（中文/空格路径） | 八个页签可见；`第一份 卷_合并.pdf` 存在、`%PDF-` 头、6 页                                                                                       | 通过 |
| 2   | 拆分 / 删页 / 越界 / 删光                        | `1-2,4-5` 两产物各 2 页；`1-9`→`PT_RANGE_INVALID`；`2,4`→3 页；`1-5`→`PT_NO_PAGES_LEFT`                                                         | 通过 |
| 3   | 旋转 / 重排 / 元数据 / 损坏 / 不存在             | 三个产物命名与页数正确；非全排列→`PT_ORDER_INVALID`；元数据回读一致；空元数据→`INVALID_PAYLOAD`；损坏→`PT_PDF_CORRUPT`；缺失→`PT_INPUT_INVALID` | 通过 |
| 4   | 占用 PDF                                         | PowerShell 独占句柄下 `info`→`PT_PDF_LOCKED`                                                                                                    | 通过 |
| 5   | 取消 + 并发排队                                  | 合并 60 文件首个 progress 后取消→`CANCELLED`；3 个重排并发全部 `done`                                                                           | 通过 |
| 6   | 水印（中文空格路径 + 损坏图片）                  | `水印 卷_水印.pdf` 3 页、`%PDF-`；平铺再跑→`水印 卷_水印(1).pdf`；图片缺失/损坏→`PT_WATERMARK_INVALID`；未选 PDF 时按钮禁用                     | 通过 |
| 7   | 页码（起始页/模板拦截）                          | `page-numbers` `{n}/{total}`+`startPage=2`→`页码 卷_页码.pdf` 3 页；中文模板/缺 `{n}`→`INVALID_PAYLOAD`；无目标页→`PT_PAGE_NUMBER_INVALID`      | 通过 |
| 8   | 源目录不可写 + 强杀恢复                          | `icacls` deny 后写盘→`PT_OUTPUT_WRITE_FAILED`；合并中 `taskkill /T` 强杀，重启后重排成功                                                        | 通过 |
| 9   | 文本/图片提取 + 压缩                             | 无文本层→`PT_NO_TEXT_LAYER`；加页码后抽文本含「第 1 页」与 `1/2`；图片目录 `提取 卷_图片` 下 PNG 签名正确；压缩产物 `提取 卷_压缩.pdf` 页数不变 | 通过 |

## 2. R2 八类异常逐条

| 类别             | 场景与验证                                                                                                                                                                                                  | 结果             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1. 中文/空格路径 | 用例 1/2/3：`第一份 卷.pdf`、`五页卷_p1-2.pdf`、`期末 试卷` 元数据；用例 6：`水印 卷.pdf`/`印章.png`；用例 9：`提取 卷.pdf` → `提取 卷_页码.pdf`/`提取 卷_页码_文本.txt`/`提取 卷_图片/`/`提取 卷_压缩.pdf` | 通过             |
| 2. 文件被占用    | 用例 4：`FileShare.None` 独占句柄 → 预检读打开失败 → `PT_PDF_LOCKED`（可重试）；水印图片占用同分支 → `PT_WATERMARK_INVALID`；提取/压缩同走 `openPdf` 预检，占用同样归 `PT_PDF_LOCKED`                       | 通过             |
| 3. 加密文件      | 单测：`pdf-lib` 抛 `is encrypted` → `PT_PDF_ENCRYPTED`；e2e 未加密样本（与 pdf-images/exam-split 同库同判定，加密样本由其 e2e 覆盖）；M38 提取/压缩复用 `openPdf`，加密同样提前失败                         | 通过（单测）     |
| 4. 超大文件      | 60 页合并/拆分（单测 5 页 + e2e 60 页）；水印/页码按页循环 + 120 秒超时保护；压缩按页栅格化、每页检查取消；图片提取另有 2000 张上限→`PT_TOO_MANY_IMAGES`；未做 GB 级手工验证                                | 通过（限定规模） |
| 5. 任务取消      | 用例 5：首个 progress 后 `lumin:task:cancel` → `CANCELLED`，worker 被 terminate（水印/页码/提取/压缩同任务模型，逐页检查 `signal`）                                                                         | 通过             |
| 6. 并发溢出      | 用例 5：3 个任务同时提交，队列串行执行，全部 `done`；并发上限由壳统一配置；提取/压缩与其他 op 共用队列                                                                                                      | 通过             |
| 7. 磁盘满        | 无法安全制造 ENOSPC；用 ACL deny 写/删（用例 8）覆盖同一条写盘失败分支 → `PT_OUTPUT_WRITE_FAILED`，并清理半成品；M38 文本/压缩写盘同样清理半成品文件，图片目录创建/写图失败会 `rm -rf` 清理半成品目录       | 等价覆盖         |
| 8. 断电恢复      | 无法真实断电；用例 8 用 `taskkill /F /T` 模拟进程树被强杀，重启后对同一输入再次重排成功；残留半成品不阻塞后续（冲突命名 `(n)`，图片目录亦按 `(n)` 递增）                                                    | 等价覆盖         |

## 3. 单元测试与覆盖率

- `pnpm exec vitest run --project @lumin/tool-pdf-toolkit`：schema/errors/naming/pdf-ops/node/client/watermark-text 全绿；M38 新增用例覆盖三载荷 schema 边界、三命名函数、三错误码、三 op（加页码后抽文本、内嵌 PNG 抽图、压缩页数不变）。
- `@lumin/node-kit` 新增 `src/pdf/extract.test.ts`（12 用例）：`buildPageText` 换行/空页/裁空白、`decodeRawImage` 1bpp/RGB/RGBA/bitmap/非法长度、`extractPdfText`/`extractPdfImages`（假 doc 句柄）。
- 包覆盖率阈值 80%（lines/functions/statements/branches），`pnpm coverage` 通过（M38 增量后仍 ≥80%）。
- 纯函数（范围解析、命名、全排列校验、颜色换算、旋转锚点、页码位置/模板、文本行拼接、原始位图解码）与十一类 PDF 操作均以真实 `pdf-lib` 样本验证。

## 4. 性能与体量

- renderer 仅含 UI 与 client，`pdf-lib` 全部在主进程 worker 侧；M38 实测（`pnpm --filter @lumin/desktop build`）：`out/renderer/assets/pdf-toolkit-CZrZr1V1.js` 62,800 B raw / 13,633 B gzip（含三新 Tab 表单；远低于 200KB gzip，R5）。
- M38 新增逻辑全部在主进程 worker 侧：文本提取走 `pdfjs-dist` legacy 构建的 `getTextContent`，图片提取走 `getOperatorList` + `@napi-rs/canvas` PNG 编码，压缩复用既有 `renderPageToCanvas` + `encodeCanvas('jpeg')`；pdfjs/canvas 产物 `out/main/chunks/pdf.worker-*.js`（约 1.1MB raw）走主进程 worker，不属 R5 renderer chunk 口径。
- renderer 侧仅新增表单 UI（页码范围输入、档位下拉、三个提交按钮），无新增第三方依赖。
- 单页级操作毫秒级；60 页合并/拆分为秒级，满足常规试卷/文档整理。
- 水印/页码按页循环 + 单次写盘；文字水印栅格化固定 160px 高画布，base64 通常 < 100KB（上限 4MB 保护）。
- 压缩按页渲染 + JPEG 编码，耗时随 DPI 与页数增长（低档 96 DPI 优先）；图片提取按内容 SHA256 去重，重复图片只写一份。
