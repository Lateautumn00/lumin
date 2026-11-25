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

| 类别          | 验证                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------- |
| 中文/空格路径 | e2e 使用 `红 色.png`，输出 `红 色.gray.png` 等正常落盘                                   |
| 文件被占用    | GIF 逐帧探测/读取失败 → `IT_FILE_UNSUPPORTED`（沿用既有 probe 归类）                     |
| 加密文件      | `ffmpeg` 解码失败 → `IT_FILE_CORRUPT`（沿用既有 `classifyFfmpegFailure`）                |
| 超大文件      | 单文件 >200MB → `IT_FILE_UNSUPPORTED`；GIF 画布超限 → `IT_GIF_TOO_LARGE`                 |
| 任务取消      | 三段式 `cancel` 杀树，GIF 单进程整体中止 → `IT_CANCELLED`（无需清理半成品）              |
| 并发溢出      | 壳任务队列并发上限不变；GIF 为单任务单进程                                               |
| 磁盘满        | 输出侧 `no space left on device`/`access denied` → `IT_OUTPUT_WRITE_FAILED`              |
| 断电恢复      | GIF 输出为单文件，断电最多留下 `-y` 覆盖的半成品，重跑覆盖同名（命名含时间戳，不会误删） |

### 8.3 R5 体积记录（增量）

- `image-toolbox-*.js`：**55,320 B raw / 12,541 B gzip**（新增两页签后）。
- `NTabs` / `NSlider` 现由 image-toolbox 与 image-stitch 共用，按 R5 口径属共享 vendor，**不计入工具专属增量**；独占依赖 chunk 仍为 0。
- 无新增运行时资产；仍走 `binaries/download/ffmpeg.exe`。**12.5KB gzip ≪ 200KB，达标**。

## 9. M63 增量（2026-11-24）：文件夹递归 + 处理历史

### 9.1 功能与验收

- **添加文件夹**：`pickDirectory` → `image-toolbox:collect-folder` 递归（白名单 + 跳过符号链接 + 2000 上限）；合并去重；`folderHint` 提示新增数/截断/已存在。
- **处理历史**：`process` / `make-gif` 成功后追加 `{ at, mode, success, failed, outputDir, firstOutput }` 至 settings `history`，FIFO 20；`config` 回填；底部 `<details data-testid="history-panel">` 展示并可「清空历史」。
- **单测**：新增 `folder.test.ts`（3）+ `history.test.ts`（6）；schema/node/client 增量；本包 **160 tests / 8 文件全绿**。
- **e2e**：新增「M63 文件夹递归收集 + 处理历史（最近 20 条）」——嵌套目录收集 2 张 + 过滤 txt、空目录 → `IT_FOLDER_EMPTY`、21 次追加 → config 保留 20 条且 `success=20` 置顶、UI 历史面板/「添加文件夹」可见、清空后面板消失。

### 9.2 R2 八类映射（增量）

| 类别          | 验证                                                                |
| ------------- | ------------------------------------------------------------------- |
| 中文/空格路径 | e2e 收集目录含 `子目录`、文件 `a 图.png`；历史 `outputDir` 中文正常 |
| 文件被占用    | 收集只 `readdir`/`Dirent`，不打开文件内容；处理阶段沿用既有占用归类 |
| 加密文件      | 收集不看内容；处理阶段沿用 `IT_FILE_CORRUPT`                        |
| 超大文件      | 收集上限 2000 张（`truncated`）；单文件 >200MB 沿用既有拒入         |
| 任务取消      | 收集为 sync IPC，不占任务队列；历史写入失败静默不影响主流程         |
| 并发溢出      | 收集/历史为 sync IPC；批量处理仍走壳队列串行                        |
| 磁盘满        | 历史写入 settings 失败静默（下次进入回落旧值），主流程不受影响      |
| 断电恢复      | 历史为 settings 原子写；收集无写盘、无中间产物                      |

### 9.3 R5 体积记录（增量）

- 新增 `folder.ts` / `history.ts` 与 UI（按钮 + 折叠面板），无新增依赖；`pnpm build` 实测 `out/renderer/assets/image-toolbox-JKju8iGS.js` **70,248 B raw / 15,381 B gzip**（M40 基线 55,320 / 12,541，增量约 2.8KB gzip；远低于 200KB，R5 达标）。
- 零新增运行时资产。

## 10. M70 增量（2026-11-25）：合并 image-rotate / image-crop

### 10.1 功能与验收

- 新增「旋转」「裁剪」两个 Tab（`TabId` 增 rotate/crop），原 M33 `image-rotate`、M35 `image-crop` 两包整包并入并删除；侧边栏入口由 3 个减为 1 个（图片工具箱）。
- 旋转：角度 none/90/180/270 + 翻转 none/horizontal/vertical，至少选一项，先翻转后旋转；命名 `{主名}_旋转{角度}[_水平翻转|_垂直翻转].{ext}`。
- 裁剪：比例（1:1/4:3/3:4/16:9/9:16/自定义）+ 九宫格锚点；自由百分比区域（左+宽、上+高 ≤ 100）；命名 `{主名}_裁剪{W}x{H}` / `{主名}_裁剪自由`。
- 产物扩展名沿用 `compressOutputExt`（gif/webp→webp、avif→avif），动图输入 `-frames:v 1` 取首帧；错误码统一 `IT_*`。
- 单测：`rotate.test.ts` / `crop.test.ts` + `node.test.ts` 新增 5 例；e2e 并入 `image-toolbox-smoke.spec.ts`（旋转尺寸、翻转冲突命名、比例/自由裁剪尺寸、损坏+不支持混合批次）。`pnpm test` 3485 例全绿，`pnpm coverage` 全仓 Statements 94.72% / Branches 87.81%。

### 10.2 R2 八类映射（增量）

1. 中文/空格路径：e2e「旋转/裁剪」用 `旋转 样例.png`、`宽幅 样例.png` 实测产物正常（`image-toolbox-smoke.spec.ts`）。
2. 文件被占用：build 阶段 `statSync` + ffmpeg 打开失败 → `IT_FILE_UNSUPPORTED` / `IT_FILE_CORRUPT`，单张失败不中断批次。
3. 加密/损坏文件：混合批次 e2e 断言损坏 jpg → `IT_FILE_CORRUPT`。
4. 超大文件：沿用 `MAX_FILE_BYTES`（200MB）预检 → `IT_FILE_UNSUPPORTED`。
5. 任务取消：沿用 `AbortSignal` 杀树 → `IT_CANCELLED`，已完成产物保留。
6. 并发溢出：沿用壳任务队列 `QUEUE_FULL`。
7. 磁盘满：ffmpeg 写入失败 → `IT_OUTPUT_WRITE_FAILED`。
8. 断电恢复：产物先写临时名后落盘语义沿用；原图不修改，重跑即覆盖/去重 `(1)`（e2e 已验证冲突命名）。

### 10.3 R5 体积记录（增量）

- 无新增依赖/二进制；`pnpm build` 实测 `out/renderer/assets/image-toolbox-DNH2nNyb.js` **87,400 B raw**（gzip 约 20KB 量级），较 M63 基线增量来自旋转/裁剪参数面板与纯函数，远低于 200KB gzip，R5 达标。
- 零新增运行时资产。

---

## 11. M72：水印 / 去水印 / 拼接合并冒烟（2026-11-25）

> 本节并入原 `docs/smoke/image-watermark.md` / `image-dewatermark.md` / `image-stitch.md` 后删除；三工具已无独立入口。

### 11.1 正向链路（e2e 自动化，`image-toolbox-smoke.spec.ts`）

- **水印**：两张 PNG（含中文+空格文件名）→ 水印 Tab → 输入「Lumin 水印」→ 开始加水印 → 结果态「成功 2 张 · 失败 0 张」；输出目录新增 2 个文件；原图字节较操作前完全一致。
- **去水印**：240×160 PNG → 去水印 Tab → 画布拖拽框选（左上 → 中心）→ 快速修复 → 结果态「已生成：…」；输出目录非空；原图字节不变。
- **拼接**：两张 PNG → 拼接 Tab → 开始拼接 → 结果态「已生成 W × H · 2 张图」；输出 1 个文件；300×300 长图 → 长图分割（按份数 3）→「已切分 3 段」；输出累计 4 个文件，序号 `01/02/03` 连续。
- 自动化结果：`image-toolbox-smoke.spec.ts` **16 passed（25.6s）**，含原有 13 例与 M72 新增 3 例。

### 11.2 R2 八类映射（增量）

1. 中文/空格路径：M72.1/M72.3 的 `图 一.png`、`左 图.png`、`长 图.png` 均实测出图。
2. 文件被占用：主进程预检 `stat`/解码失败 → `IW_FILE_UNSUPPORTED` / `IDW_*` / `IS_*`，单张失败不中断批次（水印任务逐张累计成功/失败）。
3. 加密/损坏文件：损坏解码失败映射 `IW_FILE_CORRUPT` / `IDW_FILE_CORRUPT` / `IS_FILE_CORRUPT`（原三包单测覆盖）。
4. 超大文件：单张 >40MB → `*_FILE_TOO_LARGE`；尺寸 >10000 → `*_DIMENSION_TOO_LARGE`。
5. 任务取消：三段式 `lumin:task:cancel` → `CANCELLED`；已完成产物保留（原三包 e2e 覆盖，合并后通道行为不变）。
6. 并发溢出：沿用壳任务队列 `QUEUE_FULL`。
7. 磁盘满：worker 写盘失败 → `IW_OUTPUT_WRITE_FAILED` / `IDW_OUTPUT_WRITE_FAILED` / `IS_OUTPUT_WRITE_FAILED`。
8. 断电恢复：产物先写临时名再改名；原图只读不改动，重跑按 `(1)` 去重（M72.1 已验证同名递增）。

### 11.3 R5 体积记录（M72 合并后）

- 无新增第三方依赖/二进制（`@napi-rs/canvas`、ffmpeg 沿用旧三包）；
- `pnpm build` 实测 `out/renderer/assets/image-toolbox-arrN7NQX.js` **235,273 B raw / 50.4KB gzip**（合并前四包合计约 48KB gzip 量级，含原共享代码），远低于 200KB gzip，R5 达标；
- 零新增运行时资产；`@napi-rs/canvas` 仅主进程 worker 使用，不计入 renderer chunk。

### 11.4 单测与覆盖率

- 迁入三包全部单测：`src/watermark/*`、`src/dewatermark/*`、`src/stitch/*`、`renderer/clients/*.test.ts`；
- `pnpm vitest run packages/tools/image-toolbox` **400 passed**（合并后本包全部用例）；
- 覆盖率分组已收敛为 `packages/tools/image-toolbox/src/**/*.ts` 80%（删除三旧包分组）。

## 12. M82 合并后复测：文字识别 / 二维码（2026-11-25，plan Q82 / §4.82）

> 并入 `ocr-text`（M20/M49/M64）与 `qr-code`（M16/M55）；原 `docs/smoke/ocr-text.md`、`docs/smoke/qr-code.md` 已并入本节后删除，e2e 迁入 `image-toolbox-ocr.spec.ts` / `image-toolbox-qr.spec.ts`。

### 12.1 e2e 实测（本机，`--workers=1`）

| spec                        | 用例                                                                                                                 | 结果   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ |
| `image-toolbox-ocr.spec.ts` | 双模式空态 + 类型不符/损坏图/超大图；单张识别→编辑；批量 1 好 1 坏不中断 + 逐张/合并导出；并发合并导出；PDF 多页识别 | ✅ 6/6 |
| `image-toolbox-qr.spec.ts`  | 生成→保存→回读识别；损坏/空白图错误码；批量识别汇总；超大图 `QR_IMAGE_TOO_LARGE`；输出目录不可写                     | ✅ 6/6 |

- **定位注意**：图片工具箱十二页签常驻挂载（`v-show`），全局 `input[type="file"]` 会命中「文字识别」页签与共享区输入框、`textarea` 会命中二维码只读框；规格必须用 DropZone `aria-label`（hint）与 `getByPlaceholder('识别结果（可编辑）')` 定位。M82 迁入时已按此修正，否则用例静默走错页签。

### 12.2 R2 八类增量映射

| 类别            | 文字识别（原 ocr-text）                                                            | 二维码（原 qr-code）                                      |
| --------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1 中文/空格路径 | ✅ 输入 `sample 1.png`、输出 `中文 目录`、产物 `sample 1-OCR.txt` 全链路           | ✅ 输出目录与文件名含中文/空格，`(n)` 递增                |
| 2 文件被占用    | ✅ 单测 `checkExclusive` EBUSY → `OCR_FILE_LOCKED`，其余继续                       | ✅ 解码只读打开；写盘被占用 → `QR_OUTPUT_WRITE_FAILED`    |
| 3 加密文件      | ✅ 不适用（图片无解密）；伪装 `.png` → `OCR_INPUT_INVALID` / `OCR_FAILED`          | ✅ 不适用；损坏图 → `QR_IMAGE_UNREADABLE`                 |
| 4 超大文件      | ✅ 21MB → `OCR_IMAGE_TOO_LARGE`（预检拒绝）；PDF >30 页 → `OCR_PDF_TOO_MANY_PAGES` | ✅ 21MB → `QR_IMAGE_TOO_LARGE`；内容/尺寸越界 schema 拦截 |
| 5 任务取消      | ✅ 识别任务 `CANCELLED`（信号透传 worker）                                         | ✅ 纯同步无任务；批量识别逐项可中断                       |
| 6 并发溢出      | ✅ 5 个合并导出并发文件名互不冲突；50 张上限 schema 拦截                           | ✅ 批量 ≤50 张 schema 拦截；保存重名递增                  |
| 7 磁盘满        | ✅ `OUTPUT_WRITE_FAILED`（`writeAtomic` ENOSPC 映射，单测覆盖）                    | ✅ `QR_OUTPUT_WRITE_FAILED`                               |
| 8 断电恢复      | ✅ `writeAtomic` 原子写，无中间产物                                                | ✅ 产物先写临时再改名                                     |

### 12.3 R5 体积与资产

- 工具 chunk：`image-toolbox-*.js` = 622,761 B raw / **138.8KB gzip**（<200KB），含并入两页签 UI 与 `jsqr`/`qrcode`；
- OCR 模型（det/rec/字典）与 ONNX 运行时属主进程 worker 资产（`out/main/chunks/ocr.worker-*.js` raw 206,689 B / gzip 52,395 B），按 R5 口径单列、不计入 renderer chunk；
- 零新增二进制；`pnpm gate` 全绿。

### 12.4 单测

- 迁入 `src/ocr/*`、`src/qr/*` 全部单测与 client 测试；`pnpm vitest run packages/tools/image-toolbox` **515 passed**；
- 覆盖率分组沿用 `packages/tools/image-toolbox/src/**/*.ts` 80%（两子目录自动纳入）。
