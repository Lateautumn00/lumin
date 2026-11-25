# 文件打印冒烟记录（M68）

> 环境：Windows 11 · Electron 45.3.1 · Node 24 · 分支：`master`
> 日期：2026-11-25 · 工具：`@lumin/tool-print` v0.1.0（id `print`）
> 说明：除 §4 的人工项外，其余各项均为本轮真实执行记录；§4 已于 2026-11-25 由用户真机实测全部通过。

## 1. 冒烟总览

| #   | 冒烟项                               | 方式                                                | 结果                                                                                 |
| --- | ------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | 单测（格式/错误码/HTML/契约/主进程） | `pnpm vitest run packages/tools/print-tool/src`     | ✅ **6 文件 / 73 tests** 全绿                                                        |
| 2   | 覆盖率（本包组 80% 门禁）            | `pnpm vitest run ... --coverage`                    | ✅ 语句 95.79% / 分支 87.58% / 函数 98.57% / 行 99.06%                               |
| 3   | 类型检查                             | `pnpm --filter @lumin/tool-print exec tsc --noEmit` | ✅ exit 0                                                                            |
| 4   | e2e 冒烟（R3 链路 + dry-run）        | `pnpm test:e2e -- e2e/print-smoke.spec.ts`          | ✅ **3/3 passed（4.0s）**：页面空态、dry-run 全链路、缺失文件错误码                  |
| 5   | chunk 体积（R5 <200KB gzip）         | 构建产物实测                                        | ✅ `print-*.js` **21,866 B raw / 6,522 B gzip**，独占依赖 chunk = 0（复用 node-kit） |
| 6   | 真机出纸 / 系统对话框（人工）        | 物理打印机 + Microsoft Print to PDF                 | ✅ 用户真机实测通过（2026-11-25，明细见 §4）                                         |

## 2. 自动化可验证的 R2 八类映射（真实执行）

| 类别             | 验证级别 | 记录                                                                                                                      |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1. 中文/空格路径 | e2e      | ✅ `%TEMP%\lumin-print-e2e\打印 样例.png`（中文+空格）→ prepare → show → `dry-run.pdf` 头 `%PDF-` 且非空 → cleanup 删目录 |
| 2. 文件被占用    | 单测     | ✅ `checkExclusive` 抛 `EBUSY` → `PR_LOCKED`（`node.test.ts`「占用/缺失/超大/读取失败分别映射错误码」）                   |
| 3. 加密文件      | 单测     | ✅ `openPdf` 抛 `PasswordException` → `PR_PDF_PASSWORD`；其余解析失败 → `PR_PDF_BROKEN`                                   |
| 4. 超大文件      | 单测     | ✅ `statSize` > 500 MiB → `PR_TOO_LARGE`；`stat` 失败 → `PR_NOT_FOUND`                                                    |
| 5. 任务取消      | 单测     | ✅ prepare 预取消不继续；show 等对话框时 abort → `PR_PRINT_CANCELLED` 且窗口销毁（`取消信号中止等待并关闭窗口`）          |
| 6. 并发溢出      | 单测     | ✅ 第二份 show 并发 → `PR_PRINT_BUSY`（`同一时刻只允许一份`）；批次 >50 → `PR_TOO_MANY_FILES`                             |
| 7. 磁盘满        | 单测     | ✅ 转换失败 + 临目录清理失败仍上报原错误；cleanup 删除失败仅告警不抛出（等价「不可写」路径）                              |
| 8. 断电恢复      | 单测     | ✅ `cleanupStaleJobs` 仅删 mtime >24h 残留目录，新目录保留；job 映射仅存内存，重启自动失效                                |

> 说明：Office 转换链路（soffice 定位/串行锁/60s 超时/`%PDF-` 产物校验）复用 `@lumin/node-kit/office`，其 R2 真机记录见 `docs/smoke/docx2pdf.md` §5，本工具仅在 `prepare` 层做同样的预检与错误映射。上表中 R2.2/2.3/2.4/2.7/2.8 已在 §4 真机复验通过（2026-11-25）。

## 3. e2e 真实执行明细（2026-11-25）

```text
✓ 1 页面加载 + 空态拖拽引导 (1.2s)
✓ 2 dry-run 全链路：中文+空格图片 → prepare → show 落盘 PDF → cleanup (1.2s)
✓ 3 缺失文件 → PR_NOT_FOUND（任务 error 事件）(985ms)
3 passed (4.0s)
```

- dry-run 入口：启动参数 `--lumin-print-dry-run`（或环境变量 `LUMIN_PRINT_DRY_RUN=1`），`print:show` 走 `webContents.printToPDF` 落盘 `<userData>/temp/lumin-print/<jobId>/dry-run.pdf`，不弹系统对话框。
- 断言：产物头 `%PDF-`、体积 > 0、`print:cleanup` 返回 `removed: 1` 且目录已删除。

## 4. 人工验证记录（2026-11-25 用户真机实测，7/7 通过）

> 执行人：用户（真实 Windows 桌面 + 物理打印机）；结论：全部通过，未出现阻断性异常。

| #   | 人工项                        | 断言                                                                                              | 结果 |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------- | ---- |
| 1   | PDF 打印                      | 弹出**系统打印对话框**；选 Microsoft Print to PDF 输出 → 打开产物页数与源一致、页面尺寸为原始尺寸 | ✅   |
| 2   | 图片打印                      | A4 等比缩放、无拉伸；GIF/WebP/BMP 均可打开                                                        | ✅   |
| 3   | Office 打印（docx/xlsx/pptx） | 经 soffice 转 PDF 后弹框；中文与表格不丢内容                                                      | ✅   |
| 4   | 对话框点「取消」              | UI 提示「已取消」，不出现错误码卡片；连续多份时继续下一份                                         | ✅   |
| 5   | 真实打印机（如有）            | 出纸 1 份、内容完整；spike 记录：隐藏窗口弹框 7.16s → `showInactive()` 后 1.98s                   | ✅   |
| 6   | 真机 R2.2/2.3/2.4/2.7         | 用 Word 独占打开 docx / 加密 PDF / 600 MiB 图片 / 只读目录，逐项核对错误码文案                    | ✅   |
| 7   | 真机 R2.8 断电                | 打印中 `taskkill /F /T` 强杀 → 重启后残留目录 >24h 由启动清理移除，重复打印正常                   | ✅   |

## 5. R5 体积记录

- 口径：gzip；工具专属增量 = `out/renderer/assets/print-*.js` **21,866 B raw / 6,522 B gzip**。
- 直接依赖（plugin-api / shared / ui / node-kit/pdf / node-kit/office）均为壳与其它工具共享，**独占依赖 chunk = 0**。
- 无求值库工具基线 <200KB gzip → **6.5KB，达标**。零新增依赖、零新增二进制。
