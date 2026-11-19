# 音视频处理 — 字段级功能清单（M14 验收附件）

> 依据 AGENTS §11：开工前定稿。变更须同步更新本文件与 `docs/opencode/plan.md` §4.14。
> 工具 id：`media-convert` · 显示名：**音视频处理** · 包：`@lumin/tool-media-convert` · 图标：`film`（壳 AppSidebar `iconMap` 注册 `Film`）
> 引擎：**复用 `binaries/download/ffmpeg.exe`**（M4 已拉取、M10 已瘦身；零新增依赖、零新增二进制、无联网）。
> 决策拍板（2026-11-19）：一工具四 Tab = 转码 / 截取 / 提取音频 / 压缩；批量串行、单文件失败不中断；无硬件编码、无字幕、无视频合并。

## 1. 输入项（四 Tab 共享）

| 字段     | 类型                      | 约束                                                                                                                           | 默认值           |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 文件列表 | 多选文件（拖拽 + 选择器） | 扩展名白名单见 §1.1（zod 校验，大小写不敏感）；自动去重；单批 1–50；拖拽非法文件即时行内提示并过滤                             | 空               |
| 输出目录 | string（目录路径）        | 不存在则递归创建；不可写 → `MC_OUTPUT_WRITE_FAILED`；`lumin:shell:pick-directory` + 手输双入口，选中即记忆（`set-output-dir`） | `userData/media` |

### 1.1 扩展名白名单

- 视频：`mp4 m4v mov mkv webm avi flv wmv ts mpg mpeg 3gp`
- 音频：`mp3 wav flac aac m4a ogg opus wma aiff`

- 单文件体积上限 **4GB**（超出 → `MC_FILE_UNSUPPORTED`）；不做文件夹递归。
- 「提取音频」Tab 两者都可作为输入；其余三个 Tab 仅视频扩展名可提交（音频文件提交 → 单文件失败 `MC_NO_STREAM`）。

## 2. 四 Tab 参数

### 2.1 转码 Tab

| 字段     | 类型                      | 约束                                     | 默认值 |
| -------- | ------------------------- | ---------------------------------------- | ------ |
| 目标格式 | enum `mp4 \| webm \| mkv` | mp4/mkv = H.264 + AAC；webm = VP9 + Opus | mp4    |
| 质量档   | enum `高 \| 中 \| 低`     | 见 §5 编码映射                           | 中     |

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

### 2.4 压缩 Tab

| 字段       | 类型                                   | 约束                                                         | 默认值 |
| ---------- | -------------------------------------- | ------------------------------------------------------------ | ------ |
| 质量档     | enum `高 \| 中 \| 低`                  | 见 §5（CRF + preset + 音频码率）                             | 中     |
| 分辨率上限 | enum `原尺寸 \| 1080p \| 720p \| 480p` | 只缩不放（`force_original_aspect_ratio=decrease`），等比缩放 | 原尺寸 |

- 输出容器恒为 `mp4`。

## 3. 页面结构

| 区域       | 内容                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Tab 栏     | 转码 / 截取 / 提取音频 / 压缩（`NTabs` 仅作切换器 + `v-if` 内容 + `#tab` 插槽，规避 naive-ui 2.45.3 的 `NTabPane` 缺陷） |
| 文件列表区 | 拖拽区（空态引导「拖入音视频或点击添加」）+ 已选列表（文件名/时长/分辨率/大小 + [移除]）+ [添加文件] [清空]              |
| 参数区     | 随 Tab 变化的字段集（§2）+ 输出目录（[选择] 系统目录对话框 或手输）                                                      |
| 操作区     | [开始处理]（主按钮，触发 task）+ 进行中 `TaskProgress`（百分比 + 当前文件 + [取消]）                                     |
| 结果区     | 成功项：输出文件名/时长/前后体积 + [打开所在文件夹]；失败项：错误码文案 + [详情] + 可重试项 [重试失败项]                 |
| 空态       | 拖拽引导 + [添加文件] 主操作；无白屏                                                                                     |
| 报错态     | 结构化错误文案 + [重试] / [详情]                                                                                         |

- 图标只用 `@lucide/vue`（工具内直接 import，manifest.icon 走壳 iconMap）。

## 4. IPC 与数据

| 通道                           | 类型 | payload → 返回                                                                                                                                                                                                   |
| ------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media-convert:probe`          | sync | `{files: string[]}` → `{items:[{file, durationSec, sizeBytes, video:{codec,width,height,fps}\|null, audio:{codec,sampleRate,channels}\|null}], failures:[{file,code,message}]}`；单文件探测 `ffmpeg -i` 超时 10s |
| `media-convert:config`         | sync | `{}` → `{outputDir}`（settings `tools.media-convert.outputDir`，缺省 `userData/media`）                                                                                                                          |
| `media-convert:set-output-dir` | sync | `{outputDir: string}` → void；空串 → `INVALID_PAYLOAD`                                                                                                                                                           |
| `media-convert:process`        | task | discriminatedUnion（§2 四模式）→ `{taskId}`；progress `{current, total, message}`；done → `{outputs:[{input,output,durationSec,beforeBytes,afterBytes}], failures:[{input,code,message}]}`                       |
| `lumin:task:cancel`            | sync | 壳通用取消；`AbortSignal` → 杀 ffmpeg 进程树                                                                                                                                                                     |
| `lumin:shell:pick-directory`   | sync | 壳通用目录选择（取消 → null）                                                                                                                                                                                    |

- 批量逐文件**串行**：单文件失败记入 `failures` 不中断；取消/引擎缺失/输出目录不可写为批次级 error。
- 单文件超时 30 分钟 → `MC_TIMEOUT`；`runProcess` 注入 `signal` 与 `onStdoutLine` 解析 `-progress pipe:1`。
- 进度节流：同一文件内百分比变化 < 1% 且距上次 < 200ms 不 emit；总进度 = `(已完成数 + 当前文件进度) / 总数`。

## 5. 编码映射（纯函数 `encode.ts`）

| 用例                  | 编码参数                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 转码 mp4（高/中/低）  | `-c:v libx264 -preset medium -crf 18/23/28 -c:a aac -b:a 256k/192k/128k -movflags +faststart`                                                   |
| 转码 webm（高/中/低） | `-c:v libvpx-vp9 -crf 28/32/36 -b:v 0 -c:a libopus -b:a 160k/128k/96k`                                                                          |
| 转码 mkv（高/中/低）  | 同 mp4 视频/音频编码，容器 mkv（不加 `-movflags`）                                                                                              |
| 截取 精确             | `-ss S -to E -i <in> -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 192k -movflags +faststart`                                               |
| 截取 快速             | `-ss S -to E -i <in> -c copy`                                                                                                                   |
| 提取 mp3/m4a/ogg      | `-vn -c:a libmp3lame                                                                                                                            | aac | libvorbis -b:a {128 | 192 | 320}k` |
| 提取 wav / flac       | `-vn -c:a pcm_s16le` / `-vn -c:a flac`                                                                                                          |
| 压缩（高/中/低）      | `-c:v libx264 -preset medium/veryfast/veryfast -crf 20/26/32 -c:a aac -b:a 192k/128k/96k -movflags +faststart`                                  |
| 压缩 + 分辨率上限     | 追加 `-vf scale=w='min(iw,1920)':h='min(ih,1080)':force_original_aspect_ratio=decrease:force_divisible_by=2 -pix_fmt yuv420p`（720p/480p 同理） |

- 统一前置：`-y -v error -progress pipe:1 -nostats`。
- 流校验：视频目标要求存在视频轨；提取音频要求存在音频轨；缺失 → `MC_NO_STREAM`。

## 6. 输出命名（纯函数 `naming.ts` / `shared.uniqueFileName`）

| 模式     | 命名模板                                   | 示例                         |
| -------- | ------------------------------------------ | ---------------------------- |
| 转码     | `{stem}.{ext}`                             | `demo.webm`                  |
| 截取     | `{stem}.cut_{开始HHMMSS}-{结束HHMMSS}.mp4` | `demo.cut_000010-000030.mp4` |
| 提取音频 | `{stem}.audio.{ext}`                       | `demo.audio.mp3`             |
| 压缩     | `{stem}.c{high                             | medium                       | low}.mp4` | `demo.c.medium.mp4` |

- 冲突 → `{base} ({n}){suffix}`（`shared.uniqueFileName`）；同批次已分配名进入 `existing`（lowercase 键，Windows 大小写不敏感）。

## 7. 错误码（`errors.ts`，`MC_` 前缀）

| 错误码                   | 触发                                        | 中文文案                                           | 可重试 |
| ------------------------ | ------------------------------------------- | -------------------------------------------------- | ------ |
| `MC_ENGINE_MISSING`      | `binaries/download/ffmpeg.exe` 缺失         | 处理引擎未就绪，请运行 fetch 脚本获取 ffmpeg       | 否     |
| `MC_FILE_UNSUPPORTED`    | 扩展名不在白名单 / 单文件超 4GB / 非文件    | 不支持该文件（仅支持常见音视频格式，单文件 ≤ 4GB） | 否     |
| `MC_FILE_CORRUPT`        | 探测/解码报损坏特征（加密/截断/非音视频）   | 文件无法解析，可能已损坏或加密                     | 是     |
| `MC_PROBE_FAILED`        | 探测超时 / stderr 无法解析                  | 无法读取音视频信息                                 | 是     |
| `MC_NO_STREAM`           | 缺少所需音/视频轨                           | 文件缺少所需的音视频轨道                           | 否     |
| `MC_PARAM_INVALID`       | 时间格式/区间非法、码率档非法、参数越界     | 参数不正确，请检查后重试                           | 否     |
| `MC_OUTPUT_WRITE_FAILED` | 输出目录不可写 / ENOSPC                     | 输出目录不可写或磁盘空间不足                       | 是     |
| `MC_TIMEOUT`             | 单文件超 30 分钟                            | 处理超时（已输出文件保留）                         | 是     |
| `MC_NO_FILES`            | 空文件列表（renderer 拦截为主，主进程兜底） | 请先添加音视频文件                                 | 否     |
| `MC_CANCELLED`           | 用户取消（批次内部终止信号）                | 已取消（已完成文件保留）                           | 否     |

- 批次语义：单文件失败不中断，终态 done 汇总；仅引擎缺失/目录不可写/取消为批次级 error。

## 8. 验收标准

1. 转码 mp4/webm/mkv 真实文件成功，输出可用 `ffmpeg -i` 复读时长≈源时长。
2. 截取 `0.5→2.0` 输出时长 1.5s ± 0.35s；快速模式输出可播。
3. 提取 wav/mp3 成功，输出无视频流；无音频轨输入 → `MC_NO_STREAM`。
4. 压缩 720p 输出高 ≤720、宽 ≤1280（源 1280x720），不放大。
5. 冲突自动重命名；同批次互不覆盖；中文/空格路径可处理。
6. 三态强制 + tokens + `@lucide/vue`；renderer chunk < 200KB gzip。
7. 核心纯函数（`parseMediaInfo`/`parseTimecode`/`parseProgressLine`/四个 args 构造/命名/schema）≥80%；全仓 ≥60%。
8. R2 八类异常逐条真实记录 `docs/smoke/media-convert.md`；`pnpm gate` 全绿。
