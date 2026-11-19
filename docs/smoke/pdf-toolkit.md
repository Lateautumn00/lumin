# pdf-toolkit（PDF 工具集）冒烟记录

> 工具：`pdf-toolkit`（M15，2026-11-19；M17 水印/页码追加，2026-11-19）
> 规格：`docs/spec/pdf-toolkit.md` · 自动化：`apps/desktop/e2e/pdf-toolkit-smoke.spec.ts`
> 手工复现环境：Windows x64 · Electron 45.3.1 · 本地离线
> 结论：八类异常全部有覆盖路径；不可实测项（磁盘满、真实断电）如实标注并以等价手段验证。

## 1. 自动化结果（e2e 8 用例）

| #   | 用例                                             | 断言                                                                                                                                            | 结果 |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | 页面加载 + 空态 + 八 Tab + 合并（中文/空格路径） | 八个页签可见；`第一份 卷_合并.pdf` 存在、`%PDF-` 头、6 页                                                                                       | 通过 |
| 2   | 拆分 / 删页 / 越界 / 删光                        | `1-2,4-5` 两产物各 2 页；`1-9`→`PT_RANGE_INVALID`；`2,4`→3 页；`1-5`→`PT_NO_PAGES_LEFT`                                                         | 通过 |
| 3   | 旋转 / 重排 / 元数据 / 损坏 / 不存在             | 三个产物命名与页数正确；非全排列→`PT_ORDER_INVALID`；元数据回读一致；空元数据→`INVALID_PAYLOAD`；损坏→`PT_PDF_CORRUPT`；缺失→`PT_INPUT_INVALID` | 通过 |
| 4   | 占用 PDF                                         | PowerShell 独占句柄下 `info`→`PT_PDF_LOCKED`                                                                                                    | 通过 |
| 5   | 取消 + 并发排队                                  | 合并 60 文件首个 progress 后取消→`CANCELLED`；3 个重排并发全部 `done`                                                                           | 通过 |
| 6   | 水印（中文空格路径 + 损坏图片）                  | `水印 卷_水印.pdf` 3 页、`%PDF-`；平铺再跑→`水印 卷_水印(1).pdf`；图片缺失/损坏→`PT_WATERMARK_INVALID`；未选 PDF 时按钮禁用                     | 通过 |
| 7   | 页码（起始页/模板拦截）                          | `page-numbers` `{n}/{total}`+`startPage=2`→`页码 卷_页码.pdf` 3 页；中文模板/缺 `{n}`→`INVALID_PAYLOAD`；无目标页→`PT_PAGE_NUMBER_INVALID`       | 通过 |
| 8   | 源目录不可写 + 强杀恢复                          | `icacls` deny 后写盘→`PT_OUTPUT_WRITE_FAILED`；合并中 `taskkill /T` 强杀，重启后重排成功                                                        | 通过 |

## 2. R2 八类异常逐条

| 类别             | 场景与验证                                                                                                                           | 结果             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1. 中文/空格路径 | 用例 1/2/3：`第一份 卷.pdf`、`五页卷_p1-2.pdf`、`期末 试卷` 元数据；用例 6：`水印 卷.pdf`/`印章.png`                                    | 通过             |
| 2. 文件被占用    | 用例 4：`FileShare.None` 独占句柄 → 预检读打开失败 → `PT_PDF_LOCKED`（可重试）；水印图片占用同分支 → `PT_WATERMARK_INVALID`          | 通过             |
| 3. 加密文件      | 单测：`pdf-lib` 抛 `is encrypted` → `PT_PDF_ENCRYPTED`；e2e 未加密样本（与 pdf-images/exam-split 同库同判定，加密样本由其 e2e 覆盖） | 通过（单测）     |
| 4. 超大文件      | 60 页合并/拆分（单测 5 页 + e2e 60 页）；水印/页码按页循环 + 120 秒超时保护；未做 GB 级手工验证                                      | 通过（限定规模） |
| 5. 任务取消      | 用例 5：首个 progress 后 `lumin:task:cancel` → `CANCELLED`，worker 被 terminate（水印/页码同任务模型）                                | 通过             |
| 6. 并发溢出      | 用例 5：3 个任务同时提交，队列串行执行，全部 `done`；并发上限由壳统一配置                                                            | 通过             |
| 7. 磁盘满        | 无法安全制造 ENOSPC；用 ACL deny 写/删（用例 8）覆盖同一条写盘失败分支 → `PT_OUTPUT_WRITE_FAILED`，并清理半成品                      | 等价覆盖         |
| 8. 断电恢复      | 无法真实断电；用例 8 用 `taskkill /F /T` 模拟进程树被强杀，重启后对同一输入再次重排成功；残留半成品不阻塞后续（冲突命名 `(n)`）      | 等价覆盖         |

## 3. 单元测试与覆盖率

- `pnpm exec vitest run --project @lumin/tool-pdf-toolkit`：schema/errors/naming/pdf-ops/node/client/watermark-text 全绿。
- 包覆盖率阈值 80%（lines/functions/statements/branches），`pnpm coverage` 通过。
- 纯函数（范围解析、命名、全排列校验、颜色换算、旋转锚点、页码位置/模板）与八种 PDF 操作均以真实 `pdf-lib` 样本验证。

## 4. 性能与体量

- renderer 仅含 UI 与 client，`pdf-lib` 全部在主进程 worker 侧；实测 `pdf-toolkit-*.js` 55,864 B raw / 12,198 B gzip（远低于 200KB gzip，R5）。
- 单页级操作毫秒级；60 页合并/拆分为秒级，满足常规试卷/文档整理。
- 水印/页码按页循环 + 单次写盘；文字水印栅格化固定 160px 高画布，base64 通常 < 100KB（上限 4MB 保护）。
