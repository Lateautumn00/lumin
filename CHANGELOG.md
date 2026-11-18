# Changelog

本项目所有重要变更均记录于此文件。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- M0 阶段 0–1：版本基线锁定（全部最新稳定版 + 精确钉版；TypeScript 7.0.2 实测因 `typescript-eslint` 未适配按方案 A 回退至 6.0.3，例外记录于 plan.md §1.1）；pnpm 12 + Turborepo 工作区与质量工具链（ESLint 10 / Vitest 5 / dependency-cruiser / Prettier）
- M0 阶段 2：`shared` IPC 信封/错误码/任务事件 schema 与 `plugin-api` 插拔契约（ToolManifest / MainPluginContext / LuminBridge）；dependency-cruiser 五条架构边界规则（R7）
- M0 阶段 3：`desktop` 三端骨架——安全基线（CSP 双保险/导航拦截/单实例锁）、`lumin:invoke` 单通道 IPC 总线、任务队列（并发上限/取消）、动态路由侧边栏与 example 占位工具（三段式长任务）；设置原子写 + electron-log 滚动日志
- M0 阶段 4：R3 IPC 冒烟自动化（Playwright 4 用例：清单渲染/同步 invoke/三段式/取消）与 Gitee Go MR 门禁工作流（lint→typecheck→coverage→xvfb e2e→audit→boundary）
- M0 阶段 5：electron-builder 双目标出包（NSIS setup + portable 分名产物、latest.yml/blockmap）与 electron-updater generic provider 自动更新链路（检查/进度/静默安装，关于页三态 UI）
- M0 阶段 6：冒烟记录 `docs/smoke/shell.md`；**更新冒烟卡点通过**（0.0.0 → 0.0.1 检测/下载/静默安装/新版运行 33.3s）；R2 八类异常 shell 层映射与安全基线确认
- M1 计算器：`@lumin/tool-calculator` 科学计算器——`mathjs/number` 求值 + AST 白名单三重校验、DEG/RAD 角度、基础/科学双档与全键盘、本地历史（100 条/去重/刷新恢复）；字段级清单 `docs/spec/calculator.md`、冒烟 `docs/smoke/calculator.md`；naive-ui 主题改传 tokens 解析值修复 `var()` 颜色崩溃；`formatNumber` 上提 `shared`
- M1 单位换算：`@lumin/tool-unit-converter`——10 类 63 单位双向换算（线性 + 温度偏移模型）、实时换算与单位互换、按类别收藏置顶（localStorage 持久化）、换算表全量断言 56 测试；字段级清单 `docs/spec/unit-converter.md`、冒烟 `docs/smoke/unit-converter.md`
- M1 记录：R5 修订（2026-11-13 决策）——chunk 口径定为 gzip、求值类工具例外上限 300KB gzip；计算器专属增量 977.6KB raw / 214.3KB gzip 达标（mathjs 官方最优入口，不换库），单位换算 37.9KB gzip 达标（见 AGENTS §8 / plan.md R5）
- M2 Word 转 PDF：`@lumin/tool-docx2pdf`——soffice 三级定位（自定义/注册表/便携）+ `status`/`set-path` 同步通道、convert/install 双 mutex 串行三段任务、每任务独立 profile + 60s 超时杀进程树、输出命名 `(1)…(99)` 与 `%PDF-` 产物校验、组件下载固定 URL + SHA256 钉死 + 断点续传 + `msiexec /a` 便携解包；字段级清单 `docs/spec/docx2pdf.md`、冒烟 `docs/smoke/docx2pdf.md`（R2 八类真实记录 + 保真人工目视）
- M2 修复：结构化错误透传漏洞——errno 码（`EPERM` 等）同为 UPPER_SNAKE 曾把原始 fs `Error` 冒充结构化错误泄漏给渲染进程，`shared.toStructuredError` 与 `docx2pdf.isStructuredError` 改为 **`Error` 实例一票否决**并补测试；R2.7 磁盘满类新增错误码 `OUTPUT_WRITE_FAILED`（spec §5 已回写）
- M3a 试卷切割（PDF 操作）：`@lumin/tool-exam-split`——五算子（区间拆分/多文件合并/删页/旋转/矩形裁剪 `setCropBox`）+ pdfjs 缩略图预览（点选/shift 连选回写区间、裁剪框拖拽、file:// worker 兜底）、命名模板 `{原名}_p1-3.pdf` + 冲突递增、结构化错误（`PDF_ENCRYPTED`/`PDF_LOCKED`/`OUTPUT_WRITE_FAILED`…）；100 页拆分 <2s 集成断言；字段级清单 `docs/spec/exam-split.md`、冒烟 `docs/smoke/exam-split.md`（R2 八类真实记录 + 人工目视 + chunk 189.5KB gzip）
- M3a 加固：`writeOutput` 失败 best-effort 清理截断半成品（R2.7 磁盘满 VHD 实测 ENOSPC 后无残留）；pdfjs v6 `page.render` 只传 `canvas`、缩略图 ref 经 script setter 登记、`defineModel` 赋值后立即读取取旧值三处预览链路修复（spec §7.4/§9 已回写）
- M3b OCR 切题（P0–P3）：`@lumin/tool-exam-split` OCR Tab——两段式 IPC（`ocr-detect` → 微调 → `ocr-export`）、PP-OCR det/rec 行级检测（det 960 长边/阈值 0.3 + rec 前缀裁剪 3.5×行高、CTC blank=0 映射）、`OcrPreview` overlay + `OcrPanel` 三态/任务、分界线拖拽与键盘微调、`NO_REGIONS` 手动模式、模型/字典 `fetch-binaries.mjs` SHA256 钉死；错误码 `OCR_INPUT_INVALID`/`MODEL_MISSING`/`NO_REGIONS`/`OCR_FAILED`；chunk 收口改 pdfjs 官方压缩入口（gzip 177.6KB）；字段级清单 `docs/spec/exam-split.md` §10、冒烟 `docs/smoke/exam-split.md` §5
- M3b P4 真实样卷量化验收（R1 关闭）：9 文件 11 页样卷入库 `fixtures/ocr/`；新增**页面旋转**（0/90/180/270，detect/export 同变换）与**跨页展开拆分**（列检测改覆盖率谷底 + 密度护栏）能力；**命中率 90.5%（95/105）≥90% 与单页 1.10–1.54s ≤3s 双达标**；**OCR 引擎由 onnxruntime-web（wasm，真实卷 3.3–4.7s/页超限）按 R1 流程切换为 onnxruntime-node 1.31.1**（CPU EP，提速 2.6–3.8×，native ≈68.6MB 单列 smoke §4，AGENTS/plan §1.1 已同步）；修复 pnpm `.pnpm` 布局下 Electron 误判 `isPackaged` 导致的 binaries 根解析错误；e2e 13/13、全仓 539 测试、coverage 全仓 93.71/84.95/91.60/95.92
- 已知外部风险：`pnpm audit` high advisory GHSA-fc5q-39xc-vjpf（picomatch ≤4.0.7 ReDoS，上游无修复版），仅构建期依赖、不进运行时产物，记录为已知例外（plan §4.4）
