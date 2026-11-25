# 图片工具箱 — 字段级功能清单（M6 验收附件）

> 依据 AGENTS §11：开工前定稿。变更须同步更新本文件与 `docs/opencode/plan.md` §4.6。
> **M40 增补（2026-11-21，用户拍板）**：新增「调整」Tab（灰度/反色/黑白二值）与「GIF」Tab（多图生成 GIF），零新增依赖，登记 plan §4.40。
> 工具 id：`image-toolbox` · 显示名：**图片工具箱** · 包：`@lumin/tool-image-toolbox` · 图标：`image`（壳 AppSidebar `iconMap` 需注册 `Image`）
> 引擎：**复用 M4 已拉取的 `binaries/download/ffmpeg.exe`**（零新增依赖、零新增二进制）；`ffmpeg -version` 探测，缺失 → `IT_ENGINE_MISSING`。
> **2026-11-19 变更（plan §4.10 体积优化）**：不再依赖 `ffprobe.exe`，元信息改由 `ffmpeg -hide_banner -i <file>` 的 stderr 解析（`parseFfmpegStream` 纯函数）。
> 决策拍板（2026-11-18）：引擎 = ffmpeg · 一期范围 = **压缩 + 转换 + 缩放**（一工具三 Tab）· 格式矩阵**含 AVIF**（慢 5–30s，UI 标注）· 冲突**自动重命名** · GIF **转 webp 保留动画**。

## 1. 输入项（三 Tab 共享）

| 字段     | 类型                      | 约束                                                                                                                   | 默认值            |
| -------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 文件列表 | 多选文件（拖拽 + 选择器） | 扩展名白名单 `jpg/jpeg/png/webp/avif/gif/bmp/tiff`（zod 校验，大小写不敏感）；自动去重；拖拽非法文件即时行内提示并过滤 | 空                |
| 输出目录 | string（目录路径）        | 必须存在且可写（precheck）；`lumin:shell:pick-directory` 系统选择器 + 手输双入口，选中即记忆（`set-output-dir`）       | `userData/images` |

- 单文件体积上限 200MB（超出 → `IT_FILE_UNSUPPORTED` 专项文案）；文件夹递归已于 M63 解冻（见文末 M63 追加节）。

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

### 2.4 调整 Tab（M40）

| 字段     | 类型                              | 约束                                                                                    | 默认值 |
| -------- | --------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| 效果     | enum `灰度 \| 反色 \| 黑白二值`   | 灰度 `hue=s=0`；反色 `negate`；黑白 = 灰度后按阈值二值化（扫描件/文字图常见）           | 灰度   |
| 二值阈值 | 滑杆 0–255                        | 仅「黑白二值」显示；数值钳制到 0–255                                                    | 128    |
| 质量     | 滑杆 1–100                        | jpg/webp/avif 生效；png/bmp/tiff 置灰                                                   | 75     |

- 输出格式固定「保持原格式」，复用压缩 Tab 的 `compressOutputExt` 映射：gif/webp 逐帧处理并保留动画（webp 动画路径），其余格式取首帧重编码。
- 命名见 §6；调整不改变尺寸与元数据以外的内容。

### 2.5 GIF Tab（M40）

| 字段     | 类型                                | 约束                                                                       | 默认值 |
| -------- | ----------------------------------- | -------------------------------------------------------------------------- | ------ |
| 图片列表 | 多选（拖拽 + 选择器）               | 顺序 = 帧顺序；行内 [↑][↓] 调整顺序、[按文件名排序]；1–100 张               | 空     |
| 帧时长   | 数字输入（毫秒）                    | 50–5000，步进 50；换算帧率 `fps = 1000 / 帧时长`（GIF 时间片 10ms）        | 500    |
| 循环     | enum `无限 \| 不循环 \| 2–10 次`    | 无限 → `-loop 0`；不循环 → `-loop -1`；N 次 → `-loop N`                    | 无限   |
| 宽度     | 数字输入（px）                      | 0 = 按首张图片宽；64–4096                                                   | 0      |
| 高度     | 只读（自动）                        | 全部图片按目标宽等比缩放后的最大高（≤4096），界面实时展示                    | —      |

- 编码链路：每张图以 `-framerate fps` 单帧输入 → `filter_complex` 逐路 `scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1` → `concat=n=N:v=1:a=0` → `split` → `palettegen` → `paletteuse` → 单个 GIF。
- 画布上限：宽/高 ≤4096 且总像素 ≤16,777,216；超出 → `IT_GIF_TOO_LARGE`。
- 输出 `动图_{yyyyMMdd-HHmmss}.gif`（冲突 `(n)` 递增）；进度：读取尺寸 `i/n` → 编码 GIF（单进程一次出片）。

## 3. 页面结构

| 区域       | 内容                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| Tab 栏     | 压缩 / 转换 / 缩放 / 调整 / GIF（n-tabs，切换不丢文件列表与输出目录）                                                       |
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
| `image-toolbox:probe`          | sync | `{files: string[]}` → `{items: [{file, format, width, height, sizeBytes, animated}]}`；单文件探测（`ffmpeg -i` stderr）超时 10s；选后即探测，列表实时展示尺寸/大小                                                              |
| `image-toolbox:process`        | task | `{mode: compress\|convert\|resize\|effect, files, outputDir, options}`（options 形状随 mode zod discriminated union）→ `{taskId}`；progress `{current, total, message}`；done → `{outputs: [{input, output, beforeBytes, afterBytes}]}` |
| `image-toolbox:make-gif`       | task | `{files: string[1..100], outputDir, options: {durationMs, loop, width}}` → `{taskId}`；progress `{current, total, message}`；done → `{outputPath, width, height, frames, sizeBytes}` |
| `image-toolbox:config`         | sync | `{}` → `{outputDir}`（settings 记忆回填，缺省 `userData/images`）                                                                                                                                                               |
| `image-toolbox:set-output-dir` | sync | `{outputDir: string}` → void；选择目录后即时记忆（空串 → `INVALID_PAYLOAD`）                                                                                                                                                    |
| `lumin:shell:pick-directory`   | sync | `{title?: string}` → `string \| null`（壳通用能力；用户取消 → null）                                                                                                                                                            |

- 长任务三段式（提交 → progress/done/error 事件 → cancel 取消）：批量逐文件串行执行（单文件 ffmpeg 秒级，无需并发；取消 = AbortSignal 杀进程树，已完成文件保留）。
- 入参全部 zod 校验；错误 `makeError`/`toolError` 结构化；输出命名与编码参数映射均为纯函数（可测）。
- settings 记忆 `tools.image-toolbox.outputDir`（下次进入回填）与 `tools.image-toolbox.history`（M63：最近 20 条处理历史）。

## 5. 编码参数映射（纯函数 `buildEncodeArgs`，ffmpeg 命令按格式分发）

| 输出格式 | 编码器       | 质量映射（1–100）                                                                                 | 动图支持                                       |
| -------- | ------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| jpg      | `mjpeg`      | `-q:v`：质量 q → qscale `2 + (100 - q) * 29 / 99`（2–31）                                         | 首帧                                           |
| png      | `png`        | 忽略质量（固定 `-compression_level 6`）                                                           | 首帧                                           |
| webp     | `libwebp`    | `-quality q`                                                                                      | ✅ 动画（`-loop 0`，动图输入逐帧转 webp 动画） |
| avif     | `libaom-av1` | `-crf`：质量 q → crf `63 - q * 63 / 100`（0–63），`-cpu-used 6`、`-aend-usage 0`（still picture） | 首帧                                           |

- 缩放：`scale=W:H` 表达式（指定宽 = `-1:H`，指定高 = `W:-1`，适配框 = `w='min(iw,W)':h='min(iw*dar,H)'` 等比取小；「不放大」= 目标 > 原尺寸时跳过缩放直接重编码）。尺寸链路 `probe → 纯函数 resolveTargetSize(原宽高, 模式, 参数, 不放大) → scale 参数`，单测覆盖四模式 + 不放大边界。
- gif → webp 动画与 gif → 静态（首帧 `-frames:v 1`）在 `buildEncodeArgs` 内按 `animated` 标志分发。
- 调整（M40）滤镜链（纯函数 `buildEffectFilter`）：

| 效果     | ffmpeg `-vf`                                                                  |
| -------- | ----------------------------------------------------------------------------- |
| 灰度     | `hue=s=0`                                                                     |
| 反色     | `negate`                                                                      |
| 黑白二值 | `format=gray,lut=y='if(gt(val,{阈值}),255,0)'`（阈值钳制 0–255，默认 128）    |

- GIF（M40）：`-framerate fps -i <帧1> … -framerate fps -i <帧N>` + `filter_complex`（逐路 scale/pad → concat → split → palettegen → paletteuse），`-loop` 见 §2.5；纯函数 `planGifCanvas(尺寸, 宽度)` 求画布与超限判定。

## 6. 输出命名（纯函数 `buildOutputName` / `uniqueName`）

| 模式 | 命名模板（`.ext` = 目标格式扩展名）                                                                          | 示例                                |
| ---- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| 压缩 | `{原名}.q{质量}.{ext}`                                                                                       | `photo.q75.jpg`                     |
| 转换 | `{原名}.{ext}`                                                                                               | `photo.avif`                        |
| 缩放 | 百分比 `{原名}.{p}%.{ext}`；宽 `{原名}.w{W}.{ext}`；高 `{原名}.h{H}.{ext}`；适配框 `{原名}.fit{W}x{H}.{ext}` | `photo.50%.jpg` / `photo.w1280.jpg` |
| 调整 | 灰度 `{原名}.gray.{ext}`；反色 `{原名}.invert.{ext}`；黑白 `{原名}.bw{阈值}.{ext}`                          | `photo.gray.jpg` / `photo.bw128.png` |
| GIF  | `动图_{yyyyMMdd-HHmmss}.gif`                                                                                 | `动图_20261121-153000.gif`           |

- **冲突策略（拍板）**：目标已存在 → 自动重命名 `{base} ({n}){suffix}`（`photo.q75 (1).jpg`，n 从 1 起递增）；纯函数 `uniqueName(existing: Set<string>, candidate)`。
- 同批次内同名输出同样进 `existing` 集合防互覆。

## 7. 错误码（`errors.ts`，`IT_` 前缀）

| 错误码                   | 触发                                                 | 中文文案                                           |
| ------------------------ | ---------------------------------------------------- | -------------------------------------------------- |
| `IT_ENGINE_MISSING`      | `binaries/download/ffmpeg.exe` 缺失                  | 处理引擎未就绪，请运行 fetch 脚本获取 ffmpeg       |
| `IT_FILE_UNSUPPORTED`    | 扩展名不在白名单 / 单文件超 200MB / 输入非文件       | 不支持该文件（仅支持常见图片格式，单文件 ≤ 200MB） |
| `IT_FILE_CORRUPT`        | 探测无视频流且 stderr 报损坏特征（加密/截断/非图片） | 文件无法解析，可能已损坏或加密                     |
| `IT_OUTPUT_WRITE_FAILED` | 输出目录不存在/不可写；errno ENOSPC → 磁盘满专项文案 | 输出目录不可写或磁盘空间不足                       |
| `IT_SCALE_INVALID`       | 缩放参数非法（≤0 / 超上限 / 适配框缺边）             | 缩放参数不正确，请检查后重试                       |
| `IT_PROBE_FAILED`        | 探测超时 / stderr 无法解析出视频流                   | 无法读取图片信息                                   |
| `IT_NO_FILES`            | 空文件列表提交（renderer 拦截为主，主进程兜底）      | 请先添加图片文件                                   |
| `IT_GIF_TOO_LARGE`       | GIF 画布宽/高 >4096 或总像素 >1600 万                 | GIF 尺寸超出上限，请减小宽度或图片数量             |
| `IT_CANCELLED`           | 用户取消（复用 shared `CANCELLED` 语义）             | 已取消（已完成的 N 张保留）                        |

- 批量语义：单张失败不中断批次，结果区逐文件标失败（`IT_FILE_CORRUPT` 等），批次终态 done；仅引擎缺失/目录不可写/取消为批次级 error。

## 8. 验收标准

1. jpg/png/webp 压缩与互转真实文件成功；avif 输出成功（结果区显示单张耗时）；gif → webp 动画帧数一致（`ffmpeg` 复读帧数断言）、gif → jpg 仅首帧
2. 缩放四模式尺寸断言正确；「不放大」边界（目标 > 原图）保持原尺寸
3. 冲突自动重命名；同批次互不覆盖
4. 性能：单张 jpg 压缩 < 1s（avif 除外，UI 标注慢）；批量可取消，取消后已完成文件保留
5. 三态强制 + tokens + `@lucide/vue`；renderer chunk < 200KB gzip（无重依赖，预算宽松）
6. 核心纯函数（`buildEncodeArgs`/`resolveTargetSize`/`buildOutputName`/`uniqueName`/probe 解析/schema）≥80%；全仓 ≥60%
7. R2 八类异常逐条真实记录 `docs/smoke/image-toolbox.md`；`pnpm gate` 全绿
8. 调整：灰度输出三通道近似相等、反色输出取反、黑白输出仅 0/255 两值（e2e 像素断言）；gif 输入逐帧调整且保留动画
9. GIF：3 张图生成 GIF89a，帧率/循环与参数一致（`NETSCAPE2.0` 循环块存在），画布尺寸等于 `planGifCanvas` 结果，冲突 `(n)` 递增
10. GIF 超限（宽度致高 >4096 或像素 >1600 万）命中 `IT_GIF_TOO_LARGE`；取消后无半成品
11. 新增纯函数（`buildEffectFilter`/`planGifCanvas`/`gifOutputName`/GIF schema）单测覆盖，本包 ≥80%

---

## M55 追加节（2026-11-22 R8 登记：plan Q56 / §4.55）

> 状态：已实施（2026-11-22）。调整页由「灰度/反色/黑白二值」三效果扩展为完整调色（M40 范围收敛解除，Q56 拍板）。

- **字段级清单（调整页调色组）**
  1. 亮度 `brightness`：滑杆 -100..100，步进 1，默认 0（不生效）
  2. 对比度 `contrast`：滑杆 -100..100，步进 1，默认 0
  3. 饱和度 `saturation`：滑杆 -100..100，步进 1，默认 0
  4. 锐化 `sharpen`：滑杆 0..100，步进 1，默认 0
  5. 模糊 `blur`：滑杆 0..100，步进 1，默认 0
  6. 「复位调色」按钮一键回 0；调色组与既有效果选择可叠加（灰度/反色/二值 + 调色滤镜链串联）
  7. 无新错误码（ffmpeg 参数由 zod 值域保证）；无参/全 0 路径输出与 M40 逐字节一致（回归零风险）
- **实现**：`effectOptionsSchema` 增 5 个可选数值字段（默认 0）；`buildEffectFilter` 改滤镜链拼接（`eq`/`unsharp`/`gblur`），与既有 `hue=s=0`/`negate`/阈值串联
- **验收**：`buildEffectFilter` 链式单测（全 0 链 == 旧输出、单参、多参串联、越界钳制）本包 ≥80%；e2e 像素断言新增「亮度 +50 变亮」用例；R2 八类映射记入 `docs/smoke/image-toolbox.md` M55 增量节；chunk <200KB gzip、零新增依赖

---

## M63 追加节（2026-11-24 R8 登记：plan Q65 / §4.63.4）

> 状态：一期「不做文件夹递归 / 不做历史列表」解除（本节即字段级清单）。
> 边界：只扩展本包（`schema.ts` / `folder.ts` / `history.ts` / `node.ts` / `ToolView.vue`），**零新增依赖**。

### 字段级清单

1. **添加文件夹（递归）**
   * 入口：文件列表上方「添加文件夹」按钮（`data-testid="add-folder"`）；运行/收集中禁用，文案切换「正在收集…」。
   * 交互：`window.lumin.pickDirectory('选择图片文件夹')` → `image-toolbox:collect-folder` → 结果并入列表（已有路径去重）。
   * 收集规则：仅白名单扩展名（沿用 `extensionOf`）；跳过符号链接；子目录递归；结果按路径本地化排序；上限 `MAX_BATCH_FILES = 2000`，触达即停并回传 `truncated`。
   * 提示：`folderHint` 显示「已新增 N 张 / 已在列表中 / 已达 2000 张上限 / 列表已达上限」；空目录或不可读 → `IT_FOLDER_EMPTY`。
   * 列表容量：合并后行数不得超过 2000（超出部分丢弃并提示），与 `process` 载荷上限同口径。
2. **处理历史（最近 20 条）**
   * 记录时机：`process` / `make-gif` 任务 `done` 后追加（失败/取消不记录）。
   * 条目：`{ at, mode, success, failed, outputDir, firstOutput }`；`mode ∈ compress|convert|resize|effect|gif`；`at` 由主进程 `Date.now()` 补齐；`firstOutput` 为首个产物绝对路径或 `null`。
   * 存储：settings `tools.image-toolbox.history`，FIFO 20（新 → 旧），非法存量逐条丢弃。
   * UI：底部 `<details data-testid="history-panel">`「处理历史（最近 N 条）」，每行「时间 · 模式 · 成功 x（失败 y）+ 输出目录」，首个产物存在时显示定位按钮；「清空历史」二次操作即清空并折叠面板。
3. **设置**：`config` 回包增 `history`，其余不变。

### 契约（`schema.ts`）

```ts
export const MAX_BATCH_FILES = 2000
export const HISTORY_LIMIT = 20
export const historyModeSchema = z.enum(['compress', 'convert', 'resize', 'effect', 'gif'])
export const historyEntrySchema = z.object({
  at: z.number().int().nonnegative(),
  mode: historyModeSchema,
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  outputDir: z.string().min(1),
  firstOutput: z.string().min(1).nullable()
})
export const configResultSchema = z.object({
  outputDir: z.string(),
  history: z.array(historyEntrySchema).max(20)
})
export const collectFolderPayloadSchema = z.object({ dir: z.string().min(1).max(32767) })
export const collectFolderResultSchema = z.object({
  files: z.array(z.string().min(1)).max(2000),
  truncated: z.boolean()
})
```

### IPC

| 通道 | 类型 | 入参 | 回包 |
| --- | --- | --- | --- |
| `image-toolbox:collect-folder` | sync | `{ dir }` | `{ files, truncated }`；空/不可读 → `IT_FOLDER_EMPTY` |
| `image-toolbox:append-history` | sync | `{ mode, success, failed, outputDir, firstOutput }` | `{ history }`（20 条） |
| `image-toolbox:clear-history` | sync | `{}` | `{ history: [] }` |

### 纯函数

| 文件 | 函数 | 语义 |
| --- | --- | --- |
| `folder.ts` | `collectImages(root)` | 迭代递归 + 白名单 + 跳过符号链接 + 2000 上限 + 排序 |
| `history.ts` | `appendHistory(current, entry, limit=20)` | 置顶追加 + 截断（不改原数组） |
| `history.ts` | `parseHistory(raw)` | 逐条 zod 校验 + 上限截断 |

### 错误码

| 码 | 文案 | 可重试 |
| --- | --- | --- |
| `IT_FOLDER_EMPTY` | 文件夹不可读或未找到支持的图片 | 否 |

### 验收

1. 递归收集：嵌套子目录、白名单过滤、大小写扩展名、排序稳定；空目录/不存在目录 → `IT_FOLDER_EMPTY`；2000 上限返回 `truncated`。
2. 合并去重：重复路径不重复入列；合并后不超过 2000。
3. 历史：21 次追加保留最近 20 条且新 → 旧；`config` 回填；`clear-history` 清空；非法存量丢弃。
4. `process` / `make-gif` 成功后历史新增；失败/取消不新增。
5. 单测：`folder.test.ts` / `history.test.ts` / schema / node / client；本包 ≥80%。
6. e2e：文件夹收集 + 空目录错误 + 历史 20 条 + UI 面板/按钮/清空。
7. chunk <200KB gzip；零新增依赖；`pnpm gate` 全绿。

## M70 追加节（2026-11-25 R8 登记：plan Q71 / §4.48）

> 状态：已实施（2026-11-25）。原独立工具 `image-rotate`（M33）与 `image-crop`（M35）**整包合并**为本工具「旋转」「裁剪」两个 Tab，删除两个工具包与侧边栏入口（用户可感知的入口精简），**零新增依赖/二进制**，引擎仍为 `binaries/download/ffmpeg.exe`。
> 模式标识：`processPayloadSchema` 增加 `mode: 'rotate' | 'crop'`；`historyModeSchema` 同步增加 `rotate` / `crop`。

### 旋转 Tab（原 `image-rotate`）

- 参数：旋转角度（不旋转 / 顺时针 90° / 180° / 顺时针 270°）+ 翻转（不翻转 / 水平翻转 / 垂直翻转），**两者至少选一项**（schema refine 兜底）；顺序固定「先翻转后旋转」。
- 滤镜：`hflip` / `vflip`；90° `transpose=1`、180° `transpose=1,transpose=1`、270° `transpose=2`。
- 命名：`{主名}_旋转{角度}[_水平翻转|_垂直翻转].{ext}`；仅翻转时无旋转段。
- 产物扩展名：沿用压缩「保持原格式」映射 `compressOutputExt`（`jpeg→jpg`；`gif/webp→webp`；`avif→avif`；其余保持）；动图输入（gif/webp）追加 `-frames:v 1` 取首帧静态化。
- 纯函数：`src/rotate.ts`（`buildFilterChain` / `buildFilterArgs` / `buildRotateOutputName` / `buildRotateEncodeArgs`）。

### 裁剪 Tab（原 `image-crop`）

- 参数：比例裁剪（1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 自定义，1–100）+ 九宫格锚点（决定裁剪窗口位置）；自由裁剪（左/上/宽/高百分比，`左+宽 ≤ 100` 且 `上+高 ≤ 100`）。
- 滤镜：比例取原图内最大同比例矩形（`min(iw\,ih*W/H)`，逗号转义），`x/y` 按锚点 `(iw-ow)*ax`；自由按百分比取区域。
- 命名：比例 `{主名}_裁剪{W}x{H}.{ext}`；自由 `{主名}_裁剪自由.{ext}`；产物扩展名同 `compressOutputExt`（gif/webp 输入 → webp，取首帧）。
- 纯函数：`src/crop.ts`（`ANCHOR_FACTORS` / `anchorFactors` / `buildCropFilter` / `buildCropFilterArgs` / `cropTag` / `buildCropOutputName` / `buildCropEncodeArgs`）。

### 错误码

沿用本工具 `IT_` 前缀（原 `IR_*` / `IC_*` 全部归并）：扩展名不支持 `IT_FILE_UNSUPPORTED`、损坏 `IT_FILE_CORRUPT`、磁盘/写入 `IT_OUTPUT_WRITE_FAILED`、引擎缺失 `IT_ENGINE_MISSING`、取消 `IT_CANCELLED`、入参非法 `INVALID_PAYLOAD`。

### 验收

1. 旋转：`rotate.test.ts` 覆盖滤镜链顺序、`-vf`、命名、至少选一项；`node.test.ts` 覆盖 90°+翻转、gif→webp 取首帧、命名与体积。
2. 裁剪：`crop.test.ts` 覆盖锚点、比例/自由滤镜、标签、越界拒绝；`node.test.ts` 覆盖比例/自由命名与滤镜串。
3. e2e：并入 `image-toolbox-smoke.spec.ts`（旋转尺寸变化、翻转冲突命名、比例/自由裁剪尺寸、损坏+不支持混合批次）；页签标签清单含「旋转」「裁剪」。
4. 注册点清理：`tool-manifests.ts` / `tool-mains.ts` / `electron.vite.config.ts` / `apps/desktop/package.json` / `vitest.config.ts` 移除两包；删除薄壳页与两个 e2e 文件。
5. chunk 增量 <200KB gzip；`pnpm gate` 全绿。

---

## M72 追加：水印 / 去水印 / 拼接三 Tab（2026-11-25，plan Q72/§4.72）

> 原 `docs/spec/image-watermark.md`、`image-dewatermark.md`、`image-stitch.md` 已并入本节后删除；三个旧工具 id 不再存在。

### 页签与通道对照

| Tab（`TabId`） | 视图                                  | 通道（`image-toolbox:{action}`）                                       | 错误码前缀 |
| -------------- | ------------------------------------- | ---------------------------------------------------------------------- | ---------- |
| `watermark`    | `renderer/tabs/WatermarkTab.vue`      | `watermark`（任务）、`watermark-config`、`watermark-set-output-dir`    | `IW_*`     |
| `dewatermark`  | `renderer/tabs/DewatermarkTab.vue`    | `dewatermark`（任务）、`dewatermark-config`、`dewatermark-set-output-dir` | `IDW_*`    |
| `stitch`       | `renderer/tabs/StitchTab.vue`（内含「拼接 / 长图分割」二级 Tab） | `stitch`、`split`（任务）、`stitch-config`、`stitch-set-output-dir` | `IS_*`     |

- 设置键（`tools.image-toolbox.*`）：`watermarkOutputDir`、`dewatermarkOutputDir`、`stitchOutputDir`（默认分别为 `userData/image-watermark`、`userData/image-dewatermark`、`userData/image-stitch`）。
- 三页签与原有 7 页签同页共存；`v-show` 保留文件选择、框选与在跑任务状态；新页签不参与原有共享处理链路（`runProcess`）。

### 水印 Tab（原 image-watermark）

| 项       | 规则                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| 输入     | 多选 PNG/JPG/WebP，单次 ≤100 张，单张 ≤40MB；DropZone 与追加选择                          |
| 水印类型 | 文字（1–100 字）或图片（PNG/JPG/WebP ≤5MB）                                              |
| 位置     | 九宫格锚点（默认右下）+ 平铺模式（`tile`）                                                |
| 参数     | 透明度 0–100%（钳制）、旋转角度（归一化 0–359）、文字字号百分比 / 图片宽度百分比          |
| 输出     | 指定输出目录；同名自动 `(1)` 递增；扩展名沿用输入编码；原图不改动                        |
| 界面     | 空态 DropZone；加载态逐张进度 + 取消；报错态 `IW_*` 中文文案 + 重试/详情；结果态「成功 N 张 · 失败 M 张」 |

### 去水印 Tab（原 image-dewatermark）

| 项       | 规则                                                                       |
| -------- | -------------------------------------------------------------------------- |
| 输入     | 单张 PNG/JPG/WebP ≤40MB、≤10000×10000                                      |
| 框选     | 预览画布拖拽新建；选中后移动 / 删除；最多 20 个区域，最小 2px              |
| 填充模式 | `inpaint` 快速修复 / `blur` 模糊（半径 4–40，默认 12）/ `solid` 纯色       |
| 输出     | 指定目录；编码 png/jpeg/webp 可选；原图不改动                              |
| 界面     | 空态选择图片引导；加载态进度 + 取消；报错态 `IDW_*` + 重试/详情；结果态展示产物路径 |

### 拼接 Tab（原 image-stitch，含 M40 长图分割）

| 项       | 规则                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------- |
| 拼接输入 | 多选 PNG/JPG/WebP，≤100 张，单张 ≤40MB；顺序可调整                                                     |
| 拼接模式 | `vertical` 纵向 / `horizontal` 横向 / `grid` 网格（列数 2–8）                                          |
| 尺寸模式 | `first` 以首图 / `max` 以最大 / `fixed` 固定边长（100–10000px）                                        |
| 版式参数 | 间距 0–100px、外边距 0–100px、编码 png/jpeg/webp、质量 60–100                                          |
| 长图分割 | 单张长图；`height` 按高度（50–30000px）或 `parts` 按份数（2–20）；输出 `名称-01.ext` 序列             |
| 输出     | 指定目录；拼接与分割均原图不改动                                                                      |
| 界面     | 空态 DropZone；加载态「量尺寸 / 绘制」两阶段进度 + 取消；报错态 `IS_*` + 重试/详情；结果态含尺寸与张数、分割段数 |

### 验收（M72）

1. 三 Tab 标签渲染与切换正常，切换后原文件选择与在跑任务不丢失
2. 水印批量出图数量正确、同名递增、原图字节不变
3. 去水印框选出图，产物落盘，原图字节不变
4. 拼接出图尺寸与模式一致；长图按份数切 3 段且 `01/02/03` 序号连续
5. 缺参/编码不支持/目录不可写分别映射 `IW_*` / `IDW_*` / `IS_*`；取消为 `CANCELLED`
6. 本包覆盖率 ≥80%，e2e 全绿，`pnpm gate` 全绿
