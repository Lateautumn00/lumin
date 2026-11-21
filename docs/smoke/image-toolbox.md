# 图片工具箱冒烟记录（M6）

> 环境：Windows · Electron 45.3.1 · ffmpeg 6.1（`binaries/download/`，fetch 脚本 SHA256 校验；ffprobe 于 2026-11-19 移除，见 §7） · 分支：`feature/m6-image`
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
| 2. 文件被占用    | e2e      | ✅ PowerShell `FileShare.None` 独占句柄持有输入文件 → 探测（现为 `ffmpeg -i`，见 §7）打开失败 → `IT_PROBE_FAILED` /「探测失败」；单张失败不中断批次（spec §7）                                                                                                                              |
| 3. 加密/损坏文件 | e2e      | ✅ 垃圾字节文件（伪 `.jpg`，加密文件同路径归并）→ 探测无可用尺寸 → `IT_FILE_CORRUPT` /「文件损坏或格式不受支持」（2026-11-19 前由 ffprobe 0×0 流判定，见 §7）；顺带修复原实现 zod 正宽度约束误分类为 `IT_FILE_UNSUPPORTED` 的缺陷                                                           |
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
- **无运行时资产**（ffmpeg 属 `binaries/download/` 外部二进制，走 fetch 脚本，不入 renderer 包；ffprobe 已于 2026-11-19 移除）。
- 无求值库工具基线 <200KB gzip → **30.5KB，达标**（对照：单位换算 37.9KB、docx2pdf 13.3KB）。

## 5. 本里程碑附带修复（壳级缺陷，CHANGELOG 同步）

1. **Electron 45 `app.isPackaged` 语义变化**：`electron .`（含 e2e、pnpm dev）恒为 true → updater 改用 `process.defaultApp === true` 判定 dev，`isDev` 可注入。
2. **settings 并发写竞态**：Windows 并发 `rename(tmp→settings.json)` 抛 EPERM → 写队列串行化 + EPERM/EACCES 短重试（5 次×50ms）+ `renameImpl` 依赖注入（50 并发 set 单测覆盖）。
3. **损坏图片误分类**：ffprobe 对损坏 jpg 返回 exit 0 + 0×0 流 → probeStream 增加零尺寸校验抛 `IT_FILE_CORRUPT`，不再落入 schema 兜底误报 `IT_FILE_UNSUPPORTED`。

## 6. 页签标签渲染修复（2026-11-19，M8 期间附带）

- **现象**：三 Tab（压缩/转换/缩放）标签文字空白、页签宽度 0 —— 当前 `naive-ui@2.45.3` 构建下，自闭合 `NTabPane` 的 `tab` 文本不会被渲染（`normalizeSlots(undefined)` 产出空 default slot，走 comment 分支）。
- **修复**：标签改走 `<template #tab>` 插槽（`packages/tools/image-toolbox/src/renderer/ToolView.vue`），与 `text-toolbox` 同范式。
- **回归**：新增 e2e 用例「页签标签可见（naive-ui 自闭合 pane 渲染回归）」——断言三个页签 visible、文本正确、`getBoundingClientRect().width > 0`；image-toolbox 套件 **5/5 通过**（2026-11-19，`pnpm build` 产物）。

## 7. 移除 ffprobe 依赖（2026-11-19，M10 体积优化）

- **背景**：随包 `ffprobe.exe` 78.8MB，与 `ffmpeg.exe` 同源重复；plan §4.10 决策移除（setup 304.2MB → 203.6MB）。
- **改造**：`probeStream` 改跑 `ffmpeg -hide_banner -i <file>`（无输出文件，引擎以 code 1 退出，流信息在 stderr），纯函数 `parseFfmpegStream` 解析首个 `Video:` 行的 codec 与 `WxH`；`R2.3 损坏文件` 判定改为「有 Video 行但取不到尺寸」或 stderr 命中损坏特征 → `IT_FILE_CORRUPT`。
- **实测（真实 ffmpeg，2026-11-19）**：
  - 正常 jpg/png/gif/webp/bmp/tiff/avif → 尺寸与 codec 解析正确（单测覆盖真实行样例，含 `Stream #0:0[0x1]: Video:` 与 `mjpeg (Baseline)` 变体）
  - 损坏 jpg（文本改名）→ `No JPEG data found in image` + 无尺寸 Video 行 → `IT_FILE_CORRUPT` ✅
  - 无法解析 stderr → `IT_PROBE_FAILED` ✅；探测超时 10s 杀树不变
- **回归**：单测 28 全绿；e2e 套件 **5/5 通过**（probe 元信息 / 压缩 / 占用+损坏混合批次 / gif 动画 / 页签渲染）。

## 8. M40 图片增强（2026-11-21）：调整 + GIF

### 8.1 功能与验收

- **调整页签**：灰度 `hue=s=0` / 反色 `negate` / 黑白二值 `format=gray,lut=y='if(gt(val,T),255,0)'`（阈值 0–255 可调，默认 128）；输出沿用原格式映射，命名 `{原名}.gray|.invert|.bw{T}.{ext}`。
- **GIF 页签**：1–100 帧，帧时长 50–5000ms（`fps = 1000/帧时长`）、循环 `-1|0|2..10`、宽度 0（首图宽）或 64–4096；高度按目标宽等比自动取最大；画布超 4096px 或 16,777,216 像素 → `IT_GIF_TOO_LARGE`。
- **实测（真实 ffmpeg，2026-11-21）**：红色 32×32 → 灰度三通道 76/76/76、反色 2/255/255、二值阈值 100 → 0/0/0、阈值 50 → 255/255/255（e2e 像素断言）；3 帧 64×64 → GIF89a + `NETSCAPE2.0`（循环扩展位于全局色板后，偏移约 784）。
- **e2e**：`image-toolbox-smoke.spec.ts` 新增 2 用例；页签回归扩展为 5 个页签（压缩/转换/缩放/调整/GIF）。

### 8.2 R2 八类映射（增量）

| 类别         | 验证                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 中文/空格路径 | e2e 使用 `红 色.png`，输出 `红 色.gray.png` 等正常落盘                                                                                  |
| 文件被占用   | GIF 逐帧探测/读取失败 → `IT_FILE_UNSUPPORTED`（沿用既有 probe 归类）                                                                    |
| 加密文件     | `ffmpeg` 解码失败 → `IT_FILE_CORRUPT`（沿用既有 `classifyFfmpegFailure`）                                                               |
| 超大文件     | 单文件 >200MB → `IT_FILE_UNSUPPORTED`；GIF 画布超限 → `IT_GIF_TOO_LARGE`                                                                 |
| 任务取消     | 三段式 `cancel` 杀树，GIF 单进程整体中止 → `IT_CANCELLED`（无需清理半成品）                                                             |
| 并发溢出     | 壳任务队列并发上限不变；GIF 为单任务单进程                                                                                              |
| 磁盘满       | 输出侧 `no space left on device`/`access denied` → `IT_OUTPUT_WRITE_FAILED`                                                             |
| 断电恢复     | GIF 输出为单文件，断电最多留下 `-y` 覆盖的半成品，重跑覆盖同名（命名含时间戳，不会误删）                                                |

### 8.3 R5 体积记录（增量）

- `image-toolbox-*.js`：**55,320 B raw / 12,541 B gzip**（新增两页签后）。
- `NTabs` / `NSlider` 现由 image-toolbox 与 image-stitch 共用，按 R5 口径属共享 vendor，**不计入工具专属增量**；独占依赖 chunk 仍为 0。
- 无新增运行时资产；仍走 `binaries/download/ffmpeg.exe`。**12.5KB gzip ≪ 200KB，达标**。
