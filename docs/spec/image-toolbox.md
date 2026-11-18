# 图片工具箱 — 字段级功能清单（M6 验收附件）

> 依据 AGENTS §11：开工前定稿。变更须同步更新本文件与 `docs/opencode/plan.md` §4.6。
> 工具 id：`image-toolbox` · 显示名：**图片工具箱** · 包：`@lumin/tool-image-toolbox` · 图标：`image`（壳 AppSidebar `iconMap` 需注册 `Image`）
> 引擎：**复用 M4 已拉取的 `binaries/download/ffmpeg.exe` + `ffprobe.exe`**（零新增依赖、零新增二进制）；`ffmpeg -version` 探测，缺失 → `IT_ENGINE_MISSING`。
> 决策拍板（2026-11-18）：引擎 = ffmpeg · 一期范围 = **压缩 + 转换 + 缩放**（一工具三 Tab）· 格式矩阵**含 AVIF**（慢 5–30s，UI 标注）· 冲突**自动重命名** · GIF **转 webp 保留动画**。

## 1. 输入项（三 Tab 共享）

| 字段     | 类型                      | 约束                                                                                                                   | 默认值            |
| -------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 文件列表 | 多选文件（拖拽 + 选择器） | 扩展名白名单 `jpg/jpeg/png/webp/avif/gif/bmp/tiff`（zod 校验，大小写不敏感）；自动去重；拖拽非法文件即时行内提示并过滤 | 空                |
| 输出目录 | string（目录路径）        | 必须存在且可写（precheck）；`lumin:shell:pick-directory` 系统选择器 + 手输双入口，选中即记忆（`set-output-dir`）       | `userData/images` |

- 单文件体积上限 200MB（超出 → `IT_FILE_UNSUPPORTED` 专项文案）；一期不做文件夹递归（二期候选）。

## 2. 三 Tab 参数

### 2.1 压缩 Tab

| 字段     | 类型                                        | 约束                                                  | 默认值 |
| -------- | ------------------------------------------- | ----------------------------------------------------- | ------ |
| 质量     | 滑杆 1–100                                  | 越高质量越好体积越大；png 忽略质量（重编码）          | 75     |
| 目标格式 | enum `原格式 \| jpg \| png \| webp \| avif` | gif「原格式」自动走 webp 动画路径并标注；png 置灰质量 | 原格式 |

### 2.2 转换 Tab

| 字段     | 类型                                             | 约束                                                        | 默认值 |
| -------- | ------------------------------------------------ | ----------------------------------------------------------- | ------ |
| 目标格式 | enum `jpg \| png \| webp \| avif \| bmp \| tiff` | avif 选项标注「编码较慢（5–30s/张）」；JPG 标签含 JPEG 别名 | jpg    |
| 质量     | 滑杆 1–100                                       | jpg/webp/avif 生效；png/bmp/tiff 置灰禁用                   | 75     |

- gif → webp 保留动画；gif → 其他格式 = 仅取首帧，结果列表行内标注「动图已转静态图」。

### 2.3 缩放 Tab

| 字段     | 类型                                                           | 约束                                                  | 默认值    |
| -------- | -------------------------------------------------------------- | ----------------------------------------------------- | --------- |
| 缩放模式 | enum `百分比 \| 指定宽 \| 指定高 \| 适配框`                    | 百分比 1–500；宽/高 1–32768 px；适配框 W/H 均 1–32768 | 百分比 50 |
| 不放大   | boolean                                                        | 开启时目标尺寸大于原图则保持原尺寸（纯函数判定）      | 开        |
| 目标格式 | enum `jpg \| png \| webp \| avif \| bmp \| tiff`（同转换 Tab） | 同 2.2（gif → webp 保留动画，其他取首帧）             | jpg       |
| 质量     | 滑杆 1–100（同转换 Tab）                                       | 同 2.2（png/bmp/tiff 置灰）                           | 75        |

## 3. 页面结构

| 区域       | 内容                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| Tab 栏     | 压缩 / 转换 / 缩放（n-tabs，切换不丢文件列表与输出目录）                                                                    |
| 文件列表区 | 拖拽区（空态引导「拖入图片或点击添加」）+ 已选列表（文件名/格式/尺寸/大小 + [移除]）+ [添加文件] [清空]                     |
| 参数区     | 随 Tab 变化的字段集（§2）+ 输出目录（[选择] 系统目录对话框 或手输）                                                         |
| 操作区     | [开始处理]（主按钮，触发 task）+ 进行中 [取消]                                                                              |
| 进度区     | `第 N / M 张 · 当前文件名` + 总进度条 + 可取消（R4 加载态强制）                                                             |
| 结果区     | 逐文件结果（成功：输出文件名/前后体积/压缩率 + [打开所在文件夹]；失败：错误码 + [详情]）+ 底部 [打开所在文件夹]（全部输出） |
| 空态       | 拖拽引导 + [添加文件] 主操作；无白屏                                                                                        |

- 复用 `ui` 包组件；图标只用 `@lucide/vue`（`image/images/folder-open/x/trash-2/zap/scale` 等按需加壳 iconMap 外的工具内直接 import，工具内组件用包内 import 不经壳 iconMap——iconMap 仅服务 manifest.icon）。

## 4. IPC 与数据

| 通道                           | 类型 | payload → 返回                                                                                                                                                                                                                  |
| ------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image-toolbox:probe`          | sync | `{files: string[]}` → `{items: [{file, format, width, height, sizeBytes, animated}]}`；单文件 ffprobe 超时 10s；选后即探测，列表实时展示尺寸/大小                                                                               |
| `image-toolbox:process`        | task | `{mode: compress\|convert\|resize, files, outputDir, options}`（options 形状随 mode zod discriminated union）→ `{taskId}`；progress `{current, total, message}`；done → `{outputs: [{input, output, beforeBytes, afterBytes}]}` |
| `image-toolbox:config`         | sync | `{}` → `{outputDir}`（settings 记忆回填，缺省 `userData/images`）                                                                                                                                                               |
| `image-toolbox:set-output-dir` | sync | `{outputDir: string}` → void；选择目录后即时记忆（空串 → `INVALID_PAYLOAD`）                                                                                                                                                    |
| `lumin:shell:pick-directory`   | sync | `{title?: string}` → `string \| null`（壳通用能力；用户取消 → null）                                                                                                                                                            |

- 长任务三段式（提交 → progress/done/error 事件 → cancel 取消）：批量逐文件串行执行（单文件 ffmpeg 秒级，无需并发；取消 = AbortSignal 杀进程树，已完成文件保留）。
- 入参全部 zod 校验；错误 `makeError`/`toolError` 结构化；输出命名与编码参数映射均为纯函数（可测）。
- settings 只记忆 `tools.image-toolbox.outputDir`（下次进入回填）；一期不做历史列表（结果会话内展示，二期候选）。

## 5. 编码参数映射（纯函数 `buildEncodeArgs`，ffmpeg 命令按格式分发）

| 输出格式 | 编码器       | 质量映射（1–100）                                                                                 | 动图支持                                       |
| -------- | ------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| jpg      | `mjpeg`      | `-q:v`：质量 q → qscale `2 + (100 - q) * 29 / 99`（2–31）                                         | 首帧                                           |
| png      | `png`        | 忽略质量（固定 `-compression_level 6`）                                                           | 首帧                                           |
| webp     | `libwebp`    | `-quality q`                                                                                      | ✅ 动画（`-loop 0`，动图输入逐帧转 webp 动画） |
| avif     | `libaom-av1` | `-crf`：质量 q → crf `63 - q * 63 / 100`（0–63），`-cpu-used 6`、`-aend-usage 0`（still picture） | 首帧                                           |

- 缩放：`scale=W:H` 表达式（指定宽 = `-1:H`，指定高 = `W:-1`，适配框 = `w='min(iw,W)':h='min(iw*dar,H)'` 等比取小；「不放大」= 目标 > 原尺寸时跳过缩放直接重编码）。尺寸链路 `probe → 纯函数 resolveTargetSize(原宽高, 模式, 参数, 不放大) → scale 参数`，单测覆盖四模式 + 不放大边界。
- gif → webp 动画与 gif → 静态（首帧 `-frames:v 1`）在 `buildEncodeArgs` 内按 `animated` 标志分发。

## 6. 输出命名（纯函数 `buildOutputName` / `uniqueName`）

| 模式 | 命名模板（`.ext` = 目标格式扩展名）                                                                          | 示例                                |
| ---- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| 压缩 | `{原名}.q{质量}.{ext}`                                                                                       | `photo.q75.jpg`                     |
| 转换 | `{原名}.{ext}`                                                                                               | `photo.avif`                        |
| 缩放 | 百分比 `{原名}.{p}%.{ext}`；宽 `{原名}.w{W}.{ext}`；高 `{原名}.h{H}.{ext}`；适配框 `{原名}.fit{W}x{H}.{ext}` | `photo.50%.jpg` / `photo.w1280.jpg` |

- **冲突策略（拍板）**：目标已存在 → 自动重命名 `{base} ({n}){suffix}`（`photo.q75 (1).jpg`，n 从 1 起递增）；纯函数 `uniqueName(existing: Set<string>, candidate)`。
- 同批次内同名输出同样进 `existing` 集合防互覆。

## 7. 错误码（`errors.ts`，`IT_` 前缀）

| 错误码                   | 触发                                                 | 中文文案                                           |
| ------------------------ | ---------------------------------------------------- | -------------------------------------------------- |
| `IT_ENGINE_MISSING`      | `binaries/download/ffmpeg.exe` / `ffprobe.exe` 缺失  | 处理引擎未就绪，请运行 fetch 脚本获取 ffmpeg       |
| `IT_FILE_UNSUPPORTED`    | 扩展名不在白名单 / 单文件超 200MB / 输入非文件       | 不支持该文件（仅支持常见图片格式，单文件 ≤ 200MB） |
| `IT_FILE_CORRUPT`        | ffprobe/ffmpeg 解码失败（损坏/加密/截断）            | 文件无法解析，可能已损坏或加密                     |
| `IT_OUTPUT_WRITE_FAILED` | 输出目录不存在/不可写；errno ENOSPC → 磁盘满专项文案 | 输出目录不可写或磁盘空间不足                       |
| `IT_SCALE_INVALID`       | 缩放参数非法（≤0 / 超上限 / 适配框缺边）             | 缩放参数不正确，请检查后重试                       |
| `IT_PROBE_FAILED`        | ffprobe 超时/非零退出/JSON 不可解析                  | 无法读取图片信息                                   |
| `IT_NO_FILES`            | 空文件列表提交（renderer 拦截为主，主进程兜底）      | 请先添加图片文件                                   |
| `IT_CANCELLED`           | 用户取消（复用 shared `CANCELLED` 语义）             | 已取消（已完成的 N 张保留）                        |

- 批量语义：单张失败不中断批次，结果区逐文件标失败（`IT_FILE_CORRUPT` 等），批次终态 done；仅引擎缺失/目录不可写/取消为批次级 error。

## 8. 验收标准

1. jpg/png/webp 压缩与互转真实文件成功；avif 输出成功（结果区显示单张耗时）；gif → webp 动画帧数一致（ffprobe 断言）、gif → jpg 仅首帧
2. 缩放四模式尺寸断言正确；「不放大」边界（目标 > 原图）保持原尺寸
3. 冲突自动重命名；同批次互不覆盖
4. 性能：单张 jpg 压缩 < 1s（avif 除外，UI 标注慢）；批量可取消，取消后已完成文件保留
5. 三态强制 + tokens + `@lucide/vue`；renderer chunk < 200KB gzip（无重依赖，预算宽松）
6. 核心纯函数（`buildEncodeArgs`/`resolveTargetSize`/`buildOutputName`/`uniqueName`/probe 解析/schema）≥80%；全仓 ≥60%
7. R2 八类异常逐条真实记录 `docs/smoke/image-toolbox.md`；`pnpm gate` 全绿
