# file-preview（文件预览）冒烟记录

> 工具：`file-preview`（M56，2026-11-22）· 规格：`docs/spec/file-preview.md`
> 自动化：`apps/desktop/e2e/file-preview-smoke.spec.ts`（真实 Electron + 真实主进程）
> 手工复现环境：Windows x64 · Electron · 本地离线
> 结论：**I1 通过**；Office 真实转换由 `LUMIN_E2E_SOFFICE=1` 门控（CI 无 LibreOffice 时跳过）。

## 1. 自动化结果

`pnpm --filter @lumin/desktop test:e2e -- file-preview-smoke`：**5 passed / 1 skipped**（跳过项为 Office 真实转换门控）。

| # | 用例 | 断言 | 结果 |
| --- | --- | --- | --- |
| 1 | 页面加载 + 空态 | 侧栏可进入；拖拽区文案可见；`accept` 含 `.md`/`.docx` | 通过 |
| 2 | 文本类五格式 | `inspect` 类型正确；`read-text` 文本/编码/EOL/截断 | 通过 |
| 3 | GBK / UTF-8 BOM / 编码判定 | GBK 字节 → `gbk`；BOM 识别并剥离 | 通过 |
| 4 | 图片预览 | `inspect` 为 image；`asset-url` 为 `file:///` | 通过 |
| 5 | PDF 翻页 | 页数正确；页 1/2 返回 PNG；越界/释放后渲染 → `FP_PDF_RENDER_FAILED` | 通过 |
| 6 | 不支持/缺失/目录/损坏 PDF | `FP_UNSUPPORTED`/`FP_NOT_FOUND`/`FP_INVALID_PATH`/`FP_READ_FAILED` | 通过 |
| 7 | Office 类型 + 缺失预检 + 非 Office 拒绝 | `office`；缺失 → `FP_NOT_FOUND`；`.txt` → `FP_UNSUPPORTED` | 通过 |
| 8 | Office 真实转换（门控） | `LUMIN_E2E_SOFFICE=1` 且本机有 soffice 时转换 → 渲染 → 释放 | 已门控跳过 |

## 2. R2 八类异常逐条

| 类别 | 场景与验证 | 结果 |
| --- | --- | --- |
| 1. 中文/空格路径 | e2e：`中文 目录/说明 文档.txt` 等五格式 + `图片 样张.png` | 通过（自动化） |
| 2. 文件被占用 | e2e：独占句柄 → `read-text` 返回 `FP_LOCKED`；PDF/Office 预检同码 | 通过（自动化） |
| 3. 加密/损坏文件 | 单测：加密 PDF → `FP_PDF_PASSWORD`（含转换产物加密）；e2e：损坏 PDF → `FP_READ_FAILED` | 通过（自动化） |
| 4. 超大文件 | 单测 + e2e：文本 >2 MiB 截断（`truncated=true`），`maxBytes` 上限生效；PDF/Office 未设体积上限，由 60s 超时 + 取消兜底 | 通过（现状记录） |
| 5. 任务取消 | 单测：转换任务 `aborted` → 抛 `aborted`、临时 PDF 清理；e2e 真实转换取消受门控 | 通过（单测） |
| 6. 并发溢出 | 共享 `sofficeMutex` 单例串行（`packages/node-kit/src/office/mutex.test.ts`；docx2pdf 并发用例验证 maxActive=1），file-preview 与 docx2pdf 跨工具全局串行 | 通过（单测） |
| 7. 磁盘满 | 临时 PDF/工作目录写失败映射 `FP_CONVERT_FAILED`（可重试）；未做 ENOSPC 注入 e2e | 待手工复核 |
| 8. 断电恢复 | 单测：启动清理仅删 >24h 的临时 PDF，跳过非 PDF/新文件/异常项 | 通过（单测） |

> 待手工项（发布前复核）：真实磁盘满（写只读/满盘目录）观察错误码与 [重试] 入口；真实 LibreOffice 下取消/并发（`LUMIN_E2E_SOFFICE=1`）。

## 3. 单测 / 覆盖率 / chunk

- `pnpm exec vitest run packages/tools/file-preview`：**68 tests passed**（6 文件）。
- 包覆盖率（v8）：语句 **95.93%** / 分支 **88.63%** / 函数 **89.28%** / 行 **97.03%**（阈值 80%）。
- 工具 chunk：`file-preview-*.js` **≈40.3 KB raw / ≈10.0 KB gzip**（共享 markdown vendor 另计 ≈18.6 KB gzip，与 markdown-tool 共用，不属增量）。
- 全量门禁：`pnpm gate` 通过（lint/typecheck/test/audit/boundary）；`pnpm coverage` 通过（全仓语句 93.95% / 分支 86.79%）。
