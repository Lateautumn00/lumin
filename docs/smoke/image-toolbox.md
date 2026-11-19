# 图片工具箱冒烟记录（M6）

> 环境：Windows · Electron 45.3.1 · ffmpeg/ffprobe 6.1（`binaries/download/`，fetch 脚本 SHA256 校验） · 分支：`feature/m6-image`
> 日期：2026-11-18 · 工具：`@lumin/tool-image-toolbox` v0.1.0

## 1. 冒烟总览

| #   | 冒烟项                                 | 方式                          | 结果                                                                                                                    |
| --- | -------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | 单测（参数映射/缩放/命名/分类/schema） | `pnpm test`                   | ✅ image-toolbox 90 tests；全仓 **747 tests / 64 文件** 全绿                                                            |
| 2   | 覆盖率（R1 核心 ≥80%、全仓 ≥60%）      | `pnpm coverage`               | ✅ 全仓 Statements 93.11% / Branches 84.48% / Functions 91.28% / Lines 95.65%；image-toolbox 分组 80% 阈值强制通过      |
| 3   | 质量门禁                               | `pnpm gate`                   | ✅ lint / typecheck / test / boundary 全绿；audit 已知例外 picomatch（GHSA-fc5q-39xc-vjpf，上游无修复版，见 plan §4.4） |
| 4   | e2e 冒烟（R3 IPC 冒烟 + R2 六类）      | `pnpm test:e2e` 全量          | ✅ **35 passed / 1 skipped**（update-smoke 需打包环境，一贯跳过）；image-toolbox 套件 4/4（probe+损坏+占用+并发+动画）  |
| 5   | R2.4 超大文件                          | 210MB 稀疏 jpg                | ✅ probe 与 process 双通道均拒入 → `IT_FILE_UNSUPPORTED`（spec §4 上限 200MB）                                          |
| 6   | R2.7 磁盘满等价                        | 输出目录 deny `(WD)` ACL 现场 | ✅ `IT_OUTPUT_WRITE_FAILED` /「输出目录不可写或磁盘空间不足」                                                           |
| 7   | chunk 体积（R5 无求值库 <200KB gzip）  | 构建产物实测                  | ✅ `image-toolbox-*.js` **30.5KB gzip**，无独占依赖 chunk、无运行时资产，远低于基线                                     |

## 2. R2 八类异常清单（逐条真实验证）

| 类别             | 验证级别 | 记录                                                                                                                                                                                                                                                                                        |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 中文/空格路径 | e2e      | ✅ 输出目录 `lumin d2p 中文 输出`（中文+空格）+ 输入 `保真 样例.png`（中文+空格）→ probe 尺寸正确、convert → `保真 样例.jpg` 落盘成功；progress→done 事件链完整                                                                                                                             |
| 2. 文件被占用    | e2e      | ✅ PowerShell `FileShare.None` 独占句柄持有输入文件 → ffprobe 打开失败 → `IT_PROBE_FAILED` /「探测失败」；单张失败不中断批次（spec §7）                                                                                                                                                     |
| 3. 加密/损坏文件 | e2e      | ✅ 垃圾字节文件（伪 `.jpg`，加密文件同路径归并）→ ffprobe exit 0 但返回 0×0 流 → `IT_FILE_CORRUPT` /「文件损坏或格式不受支持」；顺带修复原实现 zod 正宽度约束误分类为 `IT_FILE_UNSUPPORTED` 的缺陷                                                                                          |
| 4. 超大文件      | 真实验收 | ✅ `fstruncate` 生成 210MB 稀疏文件 → probe 侧 `IT_FILE_UNSUPPORTED`（>200MB 上限拒入）；process 侧同样拒入，无产物、无临时文件残留                                                                                                                                                         |
| 5. 任务取消      | e2e      | ✅ convert avif 批量 4 文件，首个 progress 后 `lumin:task:cancel`（AbortSignal 杀树）→ 终态 `CANCELLED` /「任务已取消」；已完成文件保留，失败清单不含取消项                                                                                                                                 |
| 6. 并发溢出      | e2e      | ✅ 并发提交两任务 → 壳队列串行执行，两任务各自完整 done（A→out-a、B→out-b）；顺带暴露并修复壳级 **settings 并发 rename EPERM 竞态**（写队列串行化 + EPERM/EACCES 短重试，50 并发 set 单测覆盖）                                                                                             |
| 7. 磁盘满        | 真实验收 | ✅ 输出目录 `icacls /deny <user>:(WD)` → ffmpeg stderr「Could not open file : <输出>」+「Error muxing a packet」（Windows deny-ACL 无 Permission denied 字样）→ `classifyFfmpegFailure(stderr, outputPath)` 按输出路径归类 → `IT_OUTPUT_WRITE_FAILED`；输入侧占用仍正确归 `IT_FILE_CORRUPT` |
| 8. 断电恢复      | e2e      | ✅ 处理中 `taskkill /F /T` 强杀主进程 → 重启后 probe 正常返回 3 items；输出目录无 `lumin-it-tmp-*` 残留；settings `outputDir` 记忆完好                                                                                                                                                      |

## 3. 动图保留（spec §2.2 定稿口径）

- e2e ANIM 用例：真 gif → webp `-loop 0` 全帧动画，产物头部含 `ANIM`/`ANMF` chunk（动图特征）。
- 其余格式（jpg/png/bmp/tiff/avif）`-frames:v 1` 取首帧；静态 webp 误标 codec 仅影响 `-loop 0` 与 UI 标签，无视觉差异（node.ts 注释口径）。

## 4. R5 体积记录

- 口径：gzip；工具专属增量 = `image-toolbox-*.js` **30.5KB gzip**。
- 全部直接依赖（plugin-api / shared / node-kit / ui）均为壳与其它工具共享，**独占依赖 chunk = 0**。
- **无运行时资产**（ffmpeg/ffprobe 属 `binaries/download/` 外部二进制，走 fetch 脚本，不入 renderer 包）。
- 无求值库工具基线 <200KB gzip → **30.5KB，达标**（对照：单位换算 37.9KB、docx2pdf 13.3KB）。

## 5. 本里程碑附带修复（壳级缺陷，CHANGELOG 同步）

1. **Electron 45 `app.isPackaged` 语义变化**：`electron .`（含 e2e、pnpm dev）恒为 true → updater 改用 `process.defaultApp === true` 判定 dev，`isDev` 可注入。
2. **settings 并发写竞态**：Windows 并发 `rename(tmp→settings.json)` 抛 EPERM → 写队列串行化 + EPERM/EACCES 短重试（5 次×50ms）+ `renameImpl` 依赖注入（50 并发 set 单测覆盖）。
3. **损坏图片误分类**：ffprobe 对损坏 jpg 返回 exit 0 + 0×0 流 → probeStream 增加零尺寸校验抛 `IT_FILE_CORRUPT`，不再落入 schema 兜底误报 `IT_FILE_UNSUPPORTED`。

## 6. 页签标签渲染修复（2026-11-19，M8 期间附带）

- **现象**：三 Tab（压缩/转换/缩放）标签文字空白、页签宽度 0 —— 当前 `naive-ui@2.45.3` 构建下，自闭合 `NTabPane` 的 `tab` 文本不会被渲染（`normalizeSlots(undefined)` 产出空 default slot，走 comment 分支）。
- **修复**：标签改走 `<template #tab>` 插槽（`packages/tools/image-toolbox/src/renderer/ToolView.vue`），与 `text-toolbox` 同范式。
- **回归**：新增 e2e 用例「页签标签可见（naive-ui 自闭合 pane 渲染回归）」——断言三个页签 visible、文本正确、`getBoundingClientRect().width > 0`；image-toolbox 套件 **5/5 通过**（2026-11-19，`pnpm build` 产物）。
