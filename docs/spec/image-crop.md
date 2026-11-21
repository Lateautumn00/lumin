# 图片裁剪（image-crop）字段级功能清单 — M35

> 版本：v0.1.0 · 定稿日期：2026-11-21（R8）· 工具 id：`image-crop` · 里程碑 M35
> 本文件为该里程碑验收附件；实现与本文件不一致时以本文件为准，变更须走 R8 流程。

## 1. 范围与边界

**做**：多选静态图片（PNG/JPG/WebP/BMP/TIFF）批量裁剪，两种方式：

- **比例裁剪**：预设 `1:1 / 4:3 / 3:4 / 16:9 / 9:16` + 自定义 `宽:高`（1–100 整数）；九宫格锚点决定裁剪窗口在图片中的位置，默认居中；取原图内**能容纳该比例的最大矩形**。
- **自由裁剪**：按百分比指定区域 `x / y / 宽 / 高`（整数 0–100，宽高 ≥1，`x+宽 ≤100`、`y+高 ≤100`）。

输出到指定目录（记忆上次目录）、命名见 §5、同目录冲突 ` (n)` 递增；原图只读、绝不覆盖；主进程串行批量任务，进度可见、可取消；单张失败不中断整批并逐张汇总。

**不做**：GIF/AVIF 动图与新格式、交互式鼠标框选预览、任意角度旋转、缩放、格式转换、质量调节、EXIF 方向重写、元数据保留（ffmpeg 重编码，仅保留像素）、裁剪后尺寸校验/放大、历史记录持久化、联网。

**形态**：`packages/tools/image-crop`，主进程 `node.ts` 注册 3 通道；复用 `binaries/download/ffmpeg.exe` 与 `@lumin/node-kit` 的 `runProcess`（超时/abort 杀树），**零新增第三方依赖**。

## 2. 页面字段清单

单页，自上而下：标题区 → 文件选择区 → 裁剪参数区 → 操作按钮 → 进度区 → 结果汇总区 → 报错区。

### 2.1 标题区

| 元素 | 行为                                              |
| ---- | ------------------------------------------------- |
| 标题 | `图片裁剪`（`h1`）                                |
| 说明 | `批量按比例或区域裁剪图片（基于 ffmpeg，原图不修改）` |

### 2.2 文件选择区

| 控件         | 类型                         | 行为                                                                | 默认 |
| ------------ | ---------------------------- | ------------------------------------------------------------------- | ---- |
| 空态引导     | `NEmpty` + `DropZone`        | 无文件时展示引导 `添加图片开始裁剪`，禁止白屏                       | 展示 |
| 拖拽/选择    | `DropZone`（`multiple`）     | 追加文件、按绝对路径去重；运行中禁用                                | —    |
| 文件行       | 列表（滚动区 `max-h-56`）    | 展示文件名；行尾移除按钮（运行中禁用）                              | —    |
| 计数         | 文本                         | `已选 N 张`（上限 500）                                             | —    |
| 清空         | `NButton`（tiny/quaternary） | 清空文件、结果与错误；运行中禁用；无文件时禁用                      | 禁用 |
| 非法文件提示 | 行内 `NText type="warning"`  | 扩展名不在白名单 → `仅支持 PNG/JPG/WebP/BMP/TIFF 图片`，3s 自动消失 | —    |

### 2.3 裁剪参数区

| 控件     | 类型                                 | 行为                                                                 | 默认   |
| -------- | ------------------------------------ | -------------------------------------------------------------------- | ------ |
| 裁剪方式 | 二选一按钮组（`NRadioGroup` 按钮式） | `比例裁剪` / `自由裁剪`                                              | 比例   |
| 比例预设 | 六选一按钮组（`NRadioGroup` 按钮式） | `1:1` / `4:3` / `3:4` / `16:9` / `9:16` / `自定义`（仅比例模式可见）  | 1:1    |
| 自定义比 | 两个 `NInputNumber`（1–100 整数）    | 仅选 `自定义` 时可见；宽/高，`:` 分隔                                | 1 / 1  |
| 锚点     | `NSelect` 九项                       | 左上/上/右上/左/中/右/左下/下/右下（仅比例模式可见）                  | 中     |
| 自由区域 | 四个 `NInputNumber`（0–100 整数）    | 左 `x`、上 `y`、宽、高，单位 `%`；仅自由模式可见                     | 0/0/100/100 |
| 区域校验 | 行内 `NText type="warning"`          | `x+宽` 或 `y+高` 超过 100 时提示 `裁剪区域超出图片范围` 并禁用开始   | —      |
| 输出目录 | `NInput` + `选择` 按钮               | 回填 settings 记忆目录；选择器取消保持原值；选中即 `set-output-dir`；运行中禁用 | 记忆值 |

**禁用规则**：文件为空、输出目录为空、自由区域越界时 `开始裁剪` 禁用（zod schema 同步兜底拒绝）。

### 2.4 操作按钮

| 控件     | 类型              | 行为                                                          |
| -------- | ----------------- | ------------------------------------------------------------- |
| 开始裁剪 | `NButton primary` | 提交 `image-crop:process` 任务；`phase !== 'idle'` 时禁用      |
| 取消     | `TaskProgress` 内 | 调用 `lumin:task:cancel`；已完成产物保留                      |

### 2.5 结果汇总区

| 区域   | 行为                                                                             |
| ------ | -------------------------------------------------------------------------------- |
| 汇总头 | `完成 N 张，失败 M 张` + `打开所在文件夹`（取首个产物路径经 `lumin.revealPath`） |
| 成功行 | 产物文件名 + 行尾「定位」按钮                                                    |
| 失败行 | 输入文件名（`error` 色）+ 结构化错误码中文文案                                   |

### 2.6 三态（AGENTS §5.3，缺一不验收）

| 状态   | 实现                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| 空态   | 无文件时 `NEmpty` 引导 + `DropZone` 主操作，禁止白屏                                                       |
| 加载态 | `TaskProgress` 展示 `current/total` 与当前文件名，**可取消**（`lumin:task:cancel`）                        |
| 报错态 | 结构化错误码 + 中文文案行内展示（`IC_*` / `INVALID_PAYLOAD`），可重试错误保留文件列表；详情折叠展示 stderr |

## 3. 通道契约（`src/schema.ts`）

| 通道                        | 类型 | 入参                                                      | 出参                                             |
| --------------------------- | ---- | --------------------------------------------------------- | ------------------------------------------------ |
| `image-crop:config`         | sync | `{}`                                                      | `{ outputDir: string }`                          |
| `image-crop:set-output-dir` | sync | `{ outputDir: string }`（非空）                           | `void`                                           |
| `image-crop:process`        | task | `{ files: string[](1..500), outputDir: string, options }` | `{ outputs: OutputItem[], failures: Failure[] }` |

`options`（扁平对象，`superRefine` 跨字段校验；默认值便于后续扩展）：

```ts
{
  mode: 'ratio' | 'free'
  ratioW: number   // 1..100 整数，仅 ratio 生效
  ratioH: number   // 1..100 整数，仅 ratio 生效
  anchor: 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'
  x: number        // 0..99 整数，仅 free 生效
  y: number        // 0..99 整数，仅 free 生效
  width: number    // 1..100 整数，仅 free 生效
  height: number   // 1..100 整数，仅 free 生效
}
```

- `mode === 'free'` 且 `x + width > 100` 或 `y + height > 100` → schema 失败 → `INVALID_PAYLOAD`（文案 `裁剪区域超出图片范围`）。
- `OutputItem = { input: string; output: string }`
- `Failure = { input: string; code: string; message: string }`
- 常量：`SUPPORTED_EXTENSIONS = ['jpg','jpeg','png','webp','bmp','tiff']`、`MAX_FILE_BYTES = 200MB`、`MAX_BATCH_FILES = 500`。
- 扩展名归一：`normalizeExtension(raw)`（小写、剥点、`jpeg→jpg`）+ `extensionOf(path)`（委托 `shared` 的通用 `extensionOf`，见 §4.0）。

## 4. 纯函数契约

### 4.0 公共代码上提（AGENTS §2.3，两个工具复用）

| 位置                                    | 变更                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/node-kit/src/ffmpeg.ts`（新增） | `buildImageEncodeArgs(ext)`（jpg `-q:v 2` / webp `-quality 92` / png `-compression_level 6` / 其余 `[]`）与 `classifyFfmpegFailure(stderr, outputPath?)`（磁盘满/权限/输出打开失败 → `OUTPUT_WRITE_FAILED`，其余 → `FILE_CORRUPT`） |
| `packages/node-kit/src/index.ts`          | 导出上述两个函数与类型 `FfmpegImageFailure`                                                                              |
| `packages/shared/src/naming.ts`           | 新增 `extensionOf(filePath): string \| null`（小写、去点、无白名单），`image-rotate` 与 `image-crop` 共用                  |
| `image-rotate/src/rotate.ts`              | `buildEncodeArgs` 委托 `buildImageEncodeArgs`；`classifyFfmpegFailure` 把 `OUTPUT_WRITE_FAILED` 映射为 `IR_OUTPUT_WRITE_FAILED`、其余映射 `IR_FILE_CORRUPT`（导出签名与返回值不变，既有测试零改动） |
| `image-rotate/src/schema.ts`              | `extensionOf` 改为 `shared.extensionOf` + `normalizeExtension`，行为与现实现逐条一致                                       |

### 4.1 `src/crop.ts`（≥80% 覆盖）

| 函数                                   | 入参 / 输出                                                                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anchorFactors(anchor)`                | 返回 `{ ax, ay }`（0/0.5/1 组合，九宫格）                                                                                                                                              |
| `buildCropFilter(options)`             | 返回 ffmpeg `crop` 滤镜字符串；比例：`crop=w=min(iw\,ih*W/H):h=min(ih\,iw*H/W):x=(iw-ow)*AX:y=(ih-oh)*AY`；自由：`crop=w=iw*W/100:h=ih*H/100:x=iw*X/100:y=ih*Y/100`                    |
| `buildCropFilterArgs(options)`         | 有滤镜 → `['-vf', filter]`                                                                                                                                                            |
| `cropTag(options)`                     | 比例 → `${ratioW}x${ratioH}`；自由 → `自由`                                                                                                                                           |
| `buildCropOutputName({ inputName, options, ext })` | `{主名}_裁剪${tag}.{ext}`（取最后一个小数点前为主名）                                                                                                                        |
| `buildEncodeArgs(ext)`                 | 直接 re-export `@lumin/node-kit` 的 `buildImageEncodeArgs`（保持工具内调用点单一）                                                                                                     |
| `classifyCropFailure(stderr, outputPath?)` | 委托 `classifyFfmpegFailure`，`OUTPUT_WRITE_FAILED → IC_OUTPUT_WRITE_FAILED`、`FILE_CORRUPT → IC_FILE_CORRUPT`                                                                     |

比例滤镜的 `min()` 内逗号必须转义为 `\,`（ffmpeg filtergraph 语法）；`ow/oh` 是 crop 输出宽高，可直接用于 `x/y` 表达式。

## 5. 输出命名

| 模式            | 输出名示例（输入 `照片.JPG`） |
| --------------- | ----------------------------- |
| 比例 1:1        | `照片_裁剪1x1.jpg`            |
| 比例 16:9       | `照片_裁剪16x9.jpg`           |
| 自定义 3:2      | `照片_裁剪3x2.jpg`            |
| 自由区域        | `照片_裁剪自由.jpg`           |
| 冲突（同名）    | `照片_裁剪1x1 (1).jpg`、` (2)`… |

规则：取输入最后一个小数点前的部分为主名；`jpeg→jpg`、其余扩展名保持；比较键 lowercase（Windows 大小写不敏感），同批次已分配名也纳入占用集合；输出目录不存在则递归创建。

## 6. 错误码（`src/errors.ts`）

| 码                       | 中文文案                                                     | 可重试 | 触发来源                |
| ------------------------ | ------------------------------------------------------------ | ------ | ----------------------- |
| `IC_ENGINE_MISSING`      | 处理引擎未就绪，请运行 fetch 脚本获取 ffmpeg                 | 否     | 引擎路径缺失            |
| `IC_FILE_UNSUPPORTED`    | 不支持该文件（仅支持 PNG/JPG/WebP/BMP/TIFF，单文件 ≤ 200MB） | 否     | 扩展名/体积/非文件      |
| `IC_FILE_CORRUPT`        | 文件无法解析，可能已损坏或加密                               | 是     | ffmpeg 解码失败         |
| `IC_OUTPUT_WRITE_FAILED` | 输出目录不可写或磁盘空间不足                                 | 是     | mkdir/写盘 ENOSPC/EPERM |
| `IC_CANCELLED`           | 已取消（已完成的文件保留）                                   | 否     | AbortSignal 杀树        |

## 7. 批量与取消语义

- 逐文件串行；每张开始前 `emit progress { current: index, total, message: basename }`，结束补一条 `current=total`。
- 单张失败记入 `failures` 并继续下一张；用户取消立即 `break`，不记失败项，已完成产物保留，任务终态 `CANCELLED`。
- 提交前 `mkdirSync(outputDir, { recursive: true })`，失败 → `IC_OUTPUT_WRITE_FAILED`（errno 入 detail）。
- ffmpeg 参数：`-y -v error -i <input> -vf <crop-filter> <encodeArgs> <output>`，`maxOutputChars` 256KB。

## 8. 壳接线（固定 7 处，含 `node.ts`）

1. `apps/desktop/electron.vite.config.ts`：`@lumin/tool-image-crop/{manifest,node}` + `/renderer/*` 三条别名。
2. `apps/desktop/package.json`：`"@lumin/tool-image-crop": "workspace:*"`（devDependencies，字母序）。
3. `apps/desktop/src/tool-manifests.ts`：import + 清单数组新增 `imageCropManifest`（`imageRotateManifest` 之后）。
4. `apps/desktop/src/main/tool-mains.ts`：import `registerMain as imageCropRegisterMain` + 注册表新增 `'image-crop'`。
5. `apps/desktop/src/renderer/src/tools/image-crop.vue`：薄页面转发 `ToolView.vue`。
6. `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：iconMap 新增 `crop: Crop`（补 `@lucide/vue` import）。
7. 根 `vitest.config.ts`：新增 `packages/tools/image-crop/src/**/*.ts` 80% 阈值。

清单：`id: image-crop`、`name: 图片裁剪`、`icon: crop`、`category: image`、`order: 52`、`version: 0.1.0`。
另需 `pnpm install --no-frozen-lockfile --prefer-offline` 生成 workspace 链接。

## 9. R5 体积口径

无 worker / wasm / 模型资产；仅共享 vendor（vue / naive-ui / `@lucide/vue`）。`pnpm build` 后实测 `image-crop-*.js` raw/gzip 并记录，上限 **200KB gzip**。

## 10. 验收

- 单测（本包 ≥80%）：
  - `crop.test.ts`：九宫格锚点系数、比例滤镜（1:1 / 16:9 / 3:2 自定义 / 全部锚点 `x/y` 因子）、自由滤镜、命名（比例/自由/无点文件名/多点数/`jpeg`）、失败归类（磁盘满/权限/输出打开/损坏）。
  - `schema.test.ts`：扩展名归一与路径变体、合法 payload、空列表、超 500、自由区域越界、非法枚举/超出范围。
  - `errors.test.ts`：码集合、中文文案、可重试集合、detail 省略。
  - `node.test.ts`：假 `runProcess` 注入——引擎缺失、目录创建失败、逐文件成功/失败、冲突命名递增、取消不记失败、输出目录记忆、滤镜参数断言。
  - `renderer/client.test.ts`：三通道名与入参透传。
  - `manifest.test.ts`：契约固定字段。
  - `packages/node-kit/src/ffmpeg.test.ts`：编码参数矩阵 + 失败归类四类。
  - `packages/shared/src/naming.test.ts`：`extensionOf` 通用实现。
- e2e `apps/desktop/e2e/image-crop-smoke.spec.ts` 5 用例：
  1. 页面加载 + 空态引导 + 开始禁用；
  2. 比例 1:1 居中（400×300 PNG → 300×300，`_裁剪1x1.png`，progress 事件存在）；
  3. 比例 16:9 + 左下锚点（400×300 → 400×225，`_裁剪16x9.png`）；
  4. 自由区域 25/25/50/50（400×300 → 200×150），重复执行冲突命名 ` (1)`；
  5. 好图 + 损坏文件 + 不支持扩展名混合批次 → 1 成功 2 失败（`IC_FILE_CORRUPT` / `IC_FILE_UNSUPPORTED`）。
- R2 八类映射记录于 `docs/smoke/image-crop.md`（真实 ffmpeg 环境）。
- `pnpm gate` / `pnpm coverage` / `pnpm build` / e2e 全绿。

## 11. 风险与回退

- ffmpeg 表达式逗号转义错误会导致滤镜解析失败：单测锁定滤镜字符串，e2e 真实出图兜底。
- 自由模式百分比裁剪对不同尺寸图片产生不同像素结果，属既定口径（UI 文案标注 `%`）。
- 公共代码上提会触及 `image-rotate`：以「既有单测零改动 + 全绿」为回归门槛；如异常，可先回退上提、在工具内保留局部实现并记录技术债（需评审）。
- 纯前端/纯函数改动，无数据库/依赖/壳契约变更；回退 = revert 三个提交。
