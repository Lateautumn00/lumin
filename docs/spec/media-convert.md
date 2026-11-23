# 音视频处理 — 字段级功能清单（M14 验收附件 / M50 音频互转 / M57 格式转换增强）

> 依据 AGENTS §11：开工前定稿。变更须同步更新本文件与 `docs/opencode/plan.md` §4.14 / §4.50 / §4.57。
> 工具 id：`media-convert` · 显示名：**音视频处理** · 包：`@lumin/tool-media-convert` · 图标：`film`（壳 AppSidebar `iconMap` 注册 `Film`）
> 引擎：**复用 `binaries/download/ffmpeg.exe`**（M4 已拉取、M10 已瘦身；零新增依赖、零新增二进制、无联网）。
> 决策拍板（2026-11-19）：一工具四 Tab = 格式转换 / 截取 / 提取音频 / 压缩；批量串行、单文件失败不中断；无硬件编码、无字幕、无视频合并。
> **M50（2026-11-21）**：新增第五 Tab「音频互转」（独立音频文件互转，spec §2.4），复用提取音频的编码参数与批次语义，零新增依赖。
> **M57（2026-11-23）**：视频目标容器 3→8、音频目标 5→7；新增 remux（`-c copy`）、H.265、分辨率/帧率/视频码率自定义、去音轨、采样率/声道；新增错误码 `MC_CONTAINER_INCOMPATIBLE`。工具版本 `0.3.0`，零新增依赖/二进制，通道不新增。

## 1. 输入项（五 Tab 共享）

| 字段     | 类型                      | 约束                                                                                                                           | 默认值           |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 文件列表 | 多选文件（拖拽 + 选择器） | 扩展名白名单见 §1.1（zod 校验，大小写不敏感）；自动去重；单批 1–50；拖拽非法文件即时行内提示并过滤                             | 空               |
| 输出目录 | string（目录路径）        | 不存在则递归创建；不可写 → `MC_OUTPUT_WRITE_FAILED`；`lumin:shell:pick-directory` + 手输双入口，选中即记忆（`set-output-dir`） | `userData/media` |

### 1.1 扩展名白名单

- 视频：`mp4 m4v mov mkv webm avi flv wmv ts mpg mpeg 3gp`
- 音频：`mp3 wav flac aac m4a ogg opus wma aiff`

- 单文件体积上限 **4GB**（超出 → `MC_FILE_UNSUPPORTED`）；不做文件夹递归。
- 「提取音频」Tab 两者都可作为输入；「音频互转」Tab 仅音频扩展名可提交（视频提交 → 单文件失败 `MC_FILE_UNSUPPORTED`）；其余三个 Tab 仅视频扩展名可提交（音频文件提交 → 单文件失败 `MC_NO_STREAM`）。

## 2. 五 Tab 参数

### 2.1 格式转换 Tab（原「转码」，M57）

| 字段     | 类型                                                        | 约束                                                                      | 默认值   |
| -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- | -------- |
| 目标格式 | enum `mp4 \| mkv \| webm \| mov \| avi \| flv \| ts \| m4v` | 容器×编码矩阵见 §5；webm 固定 VP9+Opus                                    | mp4      |
| 转换方式 | enum `重新编码 \| 仅换封装（快速）`                         | remux = `-c copy`；选择后质量/编码器/分辨率/帧率/码率/去音轨联动禁用      | 重新编码 |
| 编码器   | enum `H.264 \| H.265`                                       | 仅 `mp4/m4v/mov/mkv` 显示；其余容器固定 H.264；H.265 标注兼容性较差且较慢 | H.264    |
| 质量档   | enum `高 \| 中 \| 低`                                       | CRF 档（H.264/H.265 = 18/23/28；VP9 = 28/32/36）；remux 禁用              | 中       |
| 分辨率   | enum `原始 \| 480p \| 720p \| 1080p \| 自定义`              | 高度上限只缩不放；自定义显示宽×高（16–7680、必须偶数）；remux 禁用        | 原始     |
| 帧率     | enum `原始 \| 24 \| 25 \| 30 \| 60`                         | 非原始 → `-r`；remux 禁用                                                 | 原始     |
| 视频码率 | number（kbps）                                              | 0–50000；0 = 按质量档 CRF；>0 → `-b:v` 且忽略 CRF                         | 0        |
| 音频码率 | enum `64 \| 96 \| 128 \| 160 \| 192 \| 256 \| 320`          | remux 或去音轨时禁用                                                      | 192      |
| 去音轨   | boolean                                                     | 开 → `-an`；remux 禁用                                                    | 关       |

- remux 兼容预检：所选容器与任一文件源编码不兼容时行内提示并禁用 [开始处理]（§5.2）。
- 非法组合（如 webm+H.265、avi+H.265）在前端/主进程 schema 双层拦截 → `MC_PARAM_INVALID`。

### 2.2 截取 Tab

| 字段     | 类型                                   | 约束                                                              | 默认值 |
| -------- | -------------------------------------- | ----------------------------------------------------------------- | ------ |
| 开始时间 | string（`90` / `1:30` / `01:02:03.5`） | 必填；`parseTimecode` 解析失败 → `MC_PARAM_INVALID`；总时长 ≤ 24h | 空     |
| 结束时间 | string（同上）                         | 必填；必须 `结束 > 开始`；超出源时长按源尾截断（不报错，UI 提示） | 空     |
| 快速模式 | boolean                                | 开启 = `-c copy` 流复制（关键帧对齐，UI 标注「起点可能偏移」）    | 关     |

- 输出容器恒为 `mp4`；精确模式重编码 H.264/AAC。

### 2.3 提取音频 Tab

| 字段     | 类型                                    | 约束                                                  | 默认值 |
| -------- | --------------------------------------- | ----------------------------------------------------- | ------ |
| 目标格式 | enum `mp3 \| m4a \| wav \| flac \| ogg` | mp3=libmp3lame；m4a=AAC；ogg=libvorbis；wav/flac 无损 | mp3    |
| 码率     | enum `128 \| 192 \| 320`（kbps）        | 仅 mp3/m4a/ogg 生效；wav/flac 控件置灰                | 192    |

- 输入无音频轨 → 单文件失败 `MC_NO_STREAM`。

### 2.4 音频互转 Tab（M50 / M57 扩展）

| 字段     | 类型                                                   | 约束                                                                 | 默认值 |
| -------- | ------------------------------------------------------ | -------------------------------------------------------------------- | ------ |
| 目标格式 | enum `mp3 \| m4a \| wav \| flac \| ogg \| aac \| opus` | mp3=libmp3lame；m4a/aac=AAC；ogg=Vorbis；opus=libopus；wav/flac 无损 | mp3    |
| 码率     | enum `128 \| 192 \| 320`（kbps）                       | 仅有损格式生效；wav/flac 控件置灰                                    | 192    |
| 采样率   | enum `原始 \| 44100 \| 48000`                          | 非原始 → `-ar`                                                       | 原始   |
| 声道     | enum `原始 \| 单声道 \| 立体声`                        | 单声道 → `-ac 1`；立体声 → `-ac 2`                                   | 原始   |

- 输入口径：仅音频扩展名（§1.1 音频白名单）；视频请走「提取音频」Tab。
- 无音频轨（如扩展名伪装）→ `MC_NO_STREAM`；编码时 `-vn` 丢弃封面等附加视频轨。
- 切换 Tab 保留已选格式/码率与文件列表；「提取音频」Tab 仍为 5 种格式，不含采样率/声道。

### 2.5 压缩 Tab

| 字段       | 类型                                   | 约束                                                         | 默认值 |
| ---------- | -------------------------------------- | ------------------------------------------------------------ | ------ |
| 质量档     | enum `高 \| 中 \| 低`                  | 见 §5（CRF + preset + 音频码率）                             | 中     |
| 分辨率上限 | enum `原尺寸 \| 1080p \| 720p \| 480p` | 只缩不放（`force_original_aspect_ratio=decrease`），等比缩放 | 原尺寸 |

- 输出容器恒为 `mp4`。

## 3. 页面结构

| 区域       | 内容                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Tab 栏     | 格式转换 / 截取 / 提取音频 / 音频互转 / 压缩（`NTabs` 仅作切换器 + `v-if` 内容 + `#tab` 插槽，规避 naive-ui 2.45.3 的 `NTabPane` 缺陷） |
| 文件列表区 | 拖拽区（空态引导「拖入音视频或点击添加」）+ 已选列表（文件名/时长/分辨率/大小 + [移除]）+ [添加文件] [清空]                             |
| 参数区     | 随 Tab 变化的字段集（§2）+ 输出目录（[选择] 系统目录对话框 或手输）                                                                     |
| 操作区     | [开始处理]（主按钮，触发 task）+ 进行中 `TaskProgress`（百分比 + 当前文件 + [取消]）                                                    |
| 结果区     | 成功项：输出文件名/时长/前后体积 + [打开所在文件夹]；失败项：错误码文案 + [详情] + 可重试项 [重试失败项]                                |
| 空态       | 拖拽引导 + [添加文件] 主操作；无白屏                                                                                                    |
| 报错态     | 结构化错误文案 + [重试] / [详情]                                                                                                        |

- 图标只用 `@lucide/vue`（工具内直接 import，manifest.icon 走壳 iconMap）。

## 4. IPC 与数据

| 通道                           | 类型 | payload → 返回                                                                                                                                                                                                   |
| ------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media-convert:probe`          | sync | `{files: string[]}` → `{items:[{file, durationSec, sizeBytes, video:{codec,width,height,fps}\|null, audio:{codec,sampleRate,channels}\|null}], failures:[{file,code,message}]}`；单文件探测 `ffmpeg -i` 超时 10s |
| `media-convert:config`         | sync | `{}` → `{outputDir}`（settings `tools.media-convert.outputDir`，缺省 `userData/media`）                                                                                                                          |
| `media-convert:set-output-dir` | sync | `{outputDir: string}` → void；空串 → `INVALID_PAYLOAD`                                                                                                                                                           |
| `media-convert:process`        | task | discriminatedUnion（§2 五模式）→ `{taskId}`；progress `{current, total, message}`；done → `{outputs:[{input,output,durationSec,beforeBytes,afterBytes}], failures:[{input,code,message}]}`                       |
| `lumin:task:cancel`            | sync | 壳通用取消；`AbortSignal` → 杀 ffmpeg 进程树                                                                                                                                                                     |
| `lumin:shell:pick-directory`   | sync | 壳通用目录选择（取消 → null）                                                                                                                                                                                    |

- 批量逐文件**串行**：单文件失败记入 `failures` 不中断；取消/引擎缺失/输出目录不可写为批次级 error。
- 单文件超时 30 分钟 → `MC_TIMEOUT`；`runProcess` 注入 `signal` 与 `onStdoutLine` 解析 `-progress pipe:1`。
- 进度节流：同一文件内百分比变化 < 1% 且距上次 < 200ms 不 emit；总进度 = `(已完成数 + 当前文件进度) / 总数`。

## 5. 编码映射（纯函数 `encode.ts` / `compat.ts`）

### 5.1 容器 × 编码矩阵

| 容器      | 视频编码              | 音频编码          | 额外参数               |
| --------- | --------------------- | ----------------- | ---------------------- |
| mp4 / m4v | H.264 / H.265         | AAC               | `-movflags +faststart` |
| mov       | H.264 / H.265         | AAC               | `-movflags +faststart` |
| mkv       | H.264 / H.265         | AAC               | —                      |
| webm      | VP9（固定，无选择器） | Opus              | CRF 模式 `-b:v 0`      |
| avi       | H.264（固定）         | MP3（libmp3lame） | —                      |
| flv       | H.264（固定）         | AAC               | —                      |
| ts        | H.264（固定）         | AAC               | —                      |

### 5.2 remux 兼容表（`canRemux`，源编码名归一 `hevc→h265`、`pcm_*→pcm_s16le`）

| 容器      | 允许源视频编码                                     | 允许源音频编码                                            |
| --------- | -------------------------------------------------- | --------------------------------------------------------- |
| mp4 / m4v | h264 / h265 / mpeg4                                | aac / mp3 / alac / ac3                                    |
| mov       | h264 / h265 / mpeg4                                | aac / mp3 / alac / ac3                                    |
| mkv       | h264 / h265 / vp8 / vp9 / av1 / mpeg4 / mpeg2video | aac / mp3 / opus / vorbis / flac / alac / ac3 / pcm_s16le |
| webm      | vp8 / vp9 / av1                                    | opus / vorbis                                             |
| avi       | h264 / mpeg4 / mjpeg                               | mp3 / ac3 / pcm_s16le                                     |
| flv       | h264                                               | aac / mp3                                                 |
| ts        | h264 / h265 / mpeg2video                           | aac / mp3 / ac3                                           |

- 不兼容 → 单文件失败 `MC_CONTAINER_INCOMPATIBLE`（不中断批次）；无音轨文件只要视频兼容即可 remux。
- ffmpeg stderr 兜底：`Could not find tag for codec` / `not currently supported in container` 等统一映射该错误码。

### 5.3 命令行参数

| 用例               | 编码参数                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| 重编码 mp4/m4v/mov | `-c:v libx264\|libx265 -preset medium -crf 18/23/28 -c:a aac -b:a {n}k -movflags +faststart`                   |
| 重编码 mkv         | 同上但不加 `-movflags`                                                                                         |
| 重编码 webm        | `-c:v libvpx-vp9 -crf 28/32/36 -b:v 0 -c:a libopus -b:a {n}k`                                                  |
| 重编码 avi         | `-c:v libx264 -preset medium -crf 18/23/28 -c:a libmp3lame -b:a {n}k`                                          |
| 重编码 flv / ts    | `-c:v libx264 -preset medium -crf 18/23/28 -c:a aac -b:a {n}k`                                                 |
| 视频码率 > 0       | 以 `-b:v {n}k` 替换 `-crf`（webm 同时去掉 `-b:v 0`）                                                           |
| 分辨率（高度上限） | `-vf scale=w='min(iw,W)':h='min(ih,H)':force_original_aspect_ratio=decrease:force_divisible_by=2`（只缩不放）  |
| 分辨率（自定义）   | `-vf scale={w}:{h}`（精确尺寸，宽高偶数）                                                                      |
| 帧率非原始         | `-r 24\|25\|30\|60`                                                                                            |
| 去音轨             | `-an`（忽略音频码率）                                                                                          |
| remux              | `-i <in> -c copy` + mp4/m4v/mov 的 `-movflags +faststart`                                                      |
| 截取 精确          | `-ss S -to E -i <in> -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 192k -movflags +faststart`              |
| 截取 快速          | `-ss S -to E -i <in> -c copy`                                                                                  |
| 提取 / 互转 有损   | `-vn -c:a libmp3lame\|aac\|libvorbis\|libopus -b:a {128\|192\|320}k`                                           |
| 提取 / 互转 无损   | `-vn -c:a pcm_s16le`（wav）/ `-vn -c:a flac`（flac），忽略码率                                                 |
| 互转采样率 / 声道  | 追加 `-ar {44100\|48000}` / `-ac {1\|2}`                                                                       |
| 压缩（高/中/低）   | `-c:v libx264 -preset medium/veryfast/veryfast -crf 20/26/32 -c:a aac -b:a 192k/128k/96k -movflags +faststart` |
| 压缩 + 分辨率上限  | 追加 `-vf scale=...:force_original_aspect_ratio=decrease:force_divisible_by=2 -pix_fmt yuv420p`                |

- 统一前置：`-y -v error -progress pipe:1 -nostats`。
- 流校验：视频目标要求存在视频轨；提取音频要求存在音频轨；音频互转要求音频扩展名 + 音频轨；缺失 → 对应 `MC_NO_STREAM` / `MC_FILE_UNSUPPORTED`。

## 6. 输出命名（纯函数 `naming.ts` / `shared.uniqueFileName`）

| 模式               | 命名模板                                   | 示例                         |
| ------------------ | ------------------------------------------ | ---------------------------- |
| 格式转换（重编码） | `{stem}.{ext}`                             | `demo.mov`                   |
| 格式转换（remux）  | `{stem}.remux.{ext}`                       | `demo.remux.mkv`             |
| 截取               | `{stem}.cut_{开始HHMMSS}-{结束HHMMSS}.mp4` | `demo.cut_000010-000030.mp4` |
| 提取音频           | `{stem}.audio.{ext}`                       | `demo.audio.mp3`             |
| 音频互转           | `{stem}.{ext}`                             | `demo.flac`                  |
| 压缩               | `{stem}.c{high\|medium\|low}.mp4`          | `demo.cmedium.mp4`           |

- remux 强制 `.remux` 中缀：避免源与目标同名（如同一目录 mp4→mp4）被 `-y` 覆盖读取中的输入。

- 冲突 → `{base} ({n}){suffix}`（`shared.uniqueFileName`）；同批次已分配名进入 `existing`（lowercase 键，Windows 大小写不敏感）。

## 7. 错误码（`errors.ts`，`MC_` 前缀）

| 错误码                      | 触发                                                       | 中文文案                                           | 可重试 |
| --------------------------- | ---------------------------------------------------------- | -------------------------------------------------- | ------ |
| `MC_ENGINE_MISSING`         | `binaries/download/ffmpeg.exe` 缺失                        | 处理引擎未就绪，请运行 fetch 脚本获取 ffmpeg       | 否     |
| `MC_FILE_UNSUPPORTED`       | 扩展名不在白名单 / 单文件超 4GB / 非文件                   | 不支持该文件（仅支持常见音视频格式，单文件 ≤ 4GB） | 否     |
| `MC_FILE_CORRUPT`           | 探测/解码报损坏特征（加密/截断/非音视频）                  | 文件无法解析，可能已损坏或加密                     | 是     |
| `MC_PROBE_FAILED`           | 探测超时 / stderr 无法解析                                 | 无法读取音视频信息                                 | 是     |
| `MC_NO_STREAM`              | 缺少所需音/视频轨                                          | 文件缺少所需的音视频轨道                           | 否     |
| `MC_PARAM_INVALID`          | 时间格式/区间非法、码率档非法、参数越界、非法容器×编码组合 | 参数不正确，请检查后重试                           | 否     |
| `MC_CONTAINER_INCOMPATIBLE` | remux 源编码与目标容器不兼容 / ffmpeg 容器拒绝             | 当前文件编码与目标格式不兼容，请改用重新编码       | 否     |
| `MC_OUTPUT_WRITE_FAILED`    | 输出目录不可写 / ENOSPC                                    | 输出目录不可写或磁盘空间不足                       | 是     |
| `MC_TIMEOUT`                | 单文件超 30 分钟                                           | 处理超时（已输出文件保留）                         | 是     |
| `MC_NO_FILES`               | 空文件列表（renderer 拦截为主，主进程兜底）                | 请先添加音视频文件                                 | 否     |
| `MC_CANCELLED`              | 用户取消（批次内部终止信号）                               | 已取消（已完成文件保留）                           | 否     |

- 批次语义：单文件失败不中断，终态 done 汇总；仅引擎缺失/目录不可写/取消为批次级 error。

## 8. 验收标准

1. 8 种目标容器（mp4/mkv/webm/mov/avi/flv/ts/m4v）各出一条真实转换，输出可 `ffmpeg -i` 复读且时长与源差 ≤1s。
2. remux：mp4(H.264/AAC) → mkv/mov/ts/mp4 成功，输出流编码与源一致，命名含 `.remux`；avi 等不兼容组合 → `MC_CONTAINER_INCOMPATIBLE` 单文件失败且批次继续。
3. H.265：mp4/mkv 输出 `hevc` 视频流，可复读。
4. 自定义分辨率 640×360 输出精确 640×360；源 320×180 选 720p 不放大；帧率 24/30/60 生效；视频码率 2000k 生效；去音轨输出无音频流。
5. 截取 `0.5→2.0` 输出时长 1.5s ± 0.35s；快速模式输出可播。
6. 提取 wav/mp3 成功，输出无视频流；无音频轨输入 → `MC_NO_STREAM`。
7. 音频互转 7 格式（含 aac/opus）成功且无视频流；采样率 44100/48000 与单/立体声生效；wav/flac 忽略码率；视频输入 → `MC_FILE_UNSUPPORTED`。
8. 压缩 720p 输出高 ≤720、宽 ≤1280（源 1280x720），不放大。
9. 冲突自动重命名；同批次互不覆盖；中文/空格路径可处理。
10. 三态强制 + tokens + `@lucide/vue`；renderer chunk < 200KB gzip（M57 实测 media-convert chunk 14.27KB + Switch 4.01KB + RadioButton 0.77KB gzip）。
11. 核心纯函数（`parseMediaInfo`/`parseTimecode`/`parseProgressLine`/args 构造/命名/schema/compat）≥80%；全仓 ≥60%。
12. R2 八类异常逐条真实记录 `docs/smoke/media-convert.md`；`pnpm gate` 全绿。
