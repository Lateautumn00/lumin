# 图片旋转（image-rotate）字段级功能清单 — M33

> 版本：v0.1.0 · 定稿日期：2026-11-20（R8）· 工具 id：`image-rotate` · 里程碑 M33
> 本文件为该里程碑验收附件；实现与本文件不一致时以本文件为准，变更须走 R8 流程。

## 1. 范围与边界

**做**：多选静态图片（PNG/JPG/WebP/BMP/TIFF）批量旋转（顺时针 90°/180°/270°）与翻转（水平/垂直），两种操作可组合；输出到指定目录（记忆上次目录）、命名 `{原名}_旋转{角度}[_水平翻转|_垂直翻转].{ext}`、同目录冲突 ` (n)` 递增；原图只读、绝不覆盖；主进程串行批量任务，进度可见、可取消；单张失败不中断整批并逐张汇总。

**不做**：GIF/AVIF 等动图或新格式、任意角度旋转（非 90° 倍数）、裁剪、缩放、格式转换、质量调节、EXIF 方向重写、预览图渲染、元数据保留（ffmpeg 重编码，仅保留像素）、历史记录持久化、联网。

**形态**：`packages/tools/image-rotate`，主进程 `node.ts` 注册 3 通道；复用 `binaries/download/ffmpeg.exe`（M4 已拉取）与 `@lumin/node-kit` 的 `runProcess`（超时/abort 杀树），**零新增第三方依赖**。

## 2. 页面字段清单

单页，自上而下：标题区 → 文件选择区 → 操作参数区 → 操作按钮 → 进度区 → 结果汇总区 → 报错区。

### 2.1 标题区

| 元素 | 行为                                            |
| ---- | ----------------------------------------------- |
| 标题 | `图片旋转`（`h1`）                              |
| 说明 | `批量旋转与翻转图片（基于 ffmpeg，原图不修改）` |

### 2.2 文件选择区

| 控件         | 类型                         | 行为                                                                | 默认 |
| ------------ | ---------------------------- | ------------------------------------------------------------------- | ---- |
| 空态引导     | `NEmpty` + `DropZone`        | 无文件时展示引导 `添加图片开始处理`，禁止白屏                       | 展示 |
| 拖拽/选择    | `DropZone`（`multiple`）     | 追加文件、按绝对路径去重；运行中禁用                                | —    |
| 文件行       | 列表（滚动区 `max-h-56`）    | 展示文件名；行尾移除按钮（运行中禁用）                              | —    |
| 计数         | 文本                         | `已选 N 张`（上限 500）                                             | —    |
| 清空         | `NButton`（tiny/quaternary） | 清空文件、结果与错误；运行中禁用；无文件时禁用                      | 禁用 |
| 非法文件提示 | 行内 `NText type="warning"`  | 扩展名不在白名单 → `仅支持 PNG/JPG/WebP/BMP/TIFF 图片`，3s 自动消失 | —    |

### 2.3 操作参数区

| 控件     | 类型                                 | 行为                                                                                 | 默认   |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------ | ------ |
| 旋转     | 四选一按钮组（`NRadioGroup` 按钮式） | `不旋转` / `顺时针 90°` / `180°` / `顺时针 270°`                                     | 不旋转 |
| 翻转     | 三选一按钮组（`NRadioGroup` 按钮式） | `不翻转` / `水平翻转` / `垂直翻转`                                                   | 不翻转 |
| 组合说明 | `NText depth="3"`                    | `先翻转后旋转；旋转与翻转至少选一项`                                                 | —      |
| 输出目录 | `NInput` + `选择` 按钮               | 回填 settings 记忆目录；选择器取消保持原值；选中即 `set-output-dir` 记忆；运行中禁用 | 记忆值 |

**禁用规则**：旋转与翻转均选择「不旋转/不翻转」时，`开始处理` 按钮禁用（同时 zod schema refine 兜底拒绝）。

### 2.4 操作按钮

| 控件     | 类型              | 行为                                                        |
| -------- | ----------------- | ----------------------------------------------------------- |
| 开始处理 | `NButton primary` | 提交 `image-rotate:process` 任务；`phase !== 'idle'` 时禁用 |
| 取消     | `TaskProgress` 内 | 调用 `lumin:task:cancel`；已完成产物保留                    |

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
| 报错态 | 结构化错误码 + 中文文案行内展示（`IR_*` / `INVALID_PAYLOAD`），可重试错误保留文件列表；详情折叠展示 stderr |

## 3. 通道契约（`src/schema.ts`）

| 通道                          | 类型 | 入参                                                      | 出参                                             |
| ----------------------------- | ---- | --------------------------------------------------------- | ------------------------------------------------ |
| `image-rotate:config`         | sync | `{}`                                                      | `{ outputDir: string }`                          |
| `image-rotate:set-output-dir` | sync | `{ outputDir: string }`（非空）                           | `void`                                           |
| `image-rotate:process`        | task | `{ files: string[](1..500), outputDir: string, options }` | `{ outputs: OutputItem[], failures: Failure[] }` |

`options`：

```ts
{
  rotation: 'none' | '90' | '180' | '270' // 顺时针
  flip: 'none' | 'horizontal' | 'vertical'
}
```

- `rotation` 与 `flip` 同时为 `none` → schema refine 失败 → `INVALID_PAYLOAD`（文案 `请选择旋转角度或翻转方式`）。
- `OutputItem = { input: string; output: string }`
- `Failure = { input: string; code: string; message: string }`
- 常量：`SUPPORTED_EXTENSIONS = ['jpg','jpeg','png','webp','bmp','tiff']`、`MAX_FILE_BYTES = 200MB`、`MAX_BATCH_FILES = 500`。

## 4. 纯函数契约（`src/rotate.ts`，≥80% 覆盖）

| 函数                                                        | 入参 / 输出                                                                                                                                                                            |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalizeExtension(raw)`                                   | 小写、剥点、`jpeg→jpg`；白名单外 → `null`                                                                                                                                              |
| `extensionOf(filePath)`                                     | 取最后一个点之后的归一扩展名；无扩展名/目录名带点 → `null`                                                                                                                             |
| `buildFilterArgs(options)`                                  | 返回 ffmpeg `-vf` 参数数组；**先翻转后旋转**：`hflip/vflip` → `transpose=1`（90°）/`transpose=1,transpose=1`（180°）/`transpose=2`（270°）；空操作 → `[]`（schema 已拒绝，函数保持纯） |
| `buildRotateOutputName({ inputName, rotation, flip, ext })` | 命名模板见 §5；`ext` 由调用方给出归一扩展名                                                                                                                                            |
| `buildEncodeArgs(ext)`                                      | `jpg→['-q:v','2']`、`webp→['-quality','92']`、`png→['-compression_level','6']`、`bmp/tiff→[]`                                                                                          |
| `classifyFfmpegFailure(stderr, outputPath?)`                | stderr 含磁盘满/权限/输出打开失败 → `IR_OUTPUT_WRITE_FAILED`；其余 → `IR_FILE_CORRUPT`                                                                                                 |

## 5. 输出命名

| 操作组合           | 输出名示例（输入 `照片.JPG`）             |
| ------------------ | ----------------------------------------- |
| 仅旋转 90          | `照片_旋转90.jpg`                         |
| 仅旋转 180/270     | `照片_旋转180.jpg` / `照片_旋转270.jpg`   |
| 仅水平/垂直翻转    | `照片_水平翻转.jpg` / `照片_垂直翻转.jpg` |
| 旋转 + 翻转        | `照片_旋转90_水平翻转.jpg`                |
| 冲突（同名已存在） | `照片_旋转90 (1).jpg`、` (2)`…            |

规则：取输入最后一个小数点前的部分为主名；`jpeg→jpg`、其余扩展名保持；比较键 lowercase（Windows 大小写不敏感），同批次已分配名也纳入占用集合；输出目录不存在则递归创建。

## 6. 错误码（`src/errors.ts`）

| 码                       | 中文文案                                                     | 可重试 | 触发来源                |
| ------------------------ | ------------------------------------------------------------ | ------ | ----------------------- |
| `IR_ENGINE_MISSING`      | 处理引擎未就绪，请运行 fetch 脚本获取 ffmpeg                 | 否     | 引擎路径缺失            |
| `IR_FILE_UNSUPPORTED`    | 不支持该文件（仅支持 PNG/JPG/WebP/BMP/TIFF，单文件 ≤ 200MB） | 否     | 扩展名/体积/非文件      |
| `IR_FILE_CORRUPT`        | 文件无法解析，可能已损坏或加密                               | 是     | ffmpeg 解码失败         |
| `IR_OUTPUT_WRITE_FAILED` | 输出目录不可写或磁盘空间不足                                 | 是     | mkdir/写盘 ENOSPC/EPERM |
| `IR_CANCELLED`           | 已取消（已完成的文件保留）                                   | 否     | AbortSignal 杀树        |

## 7. 批量与取消语义

- 逐文件串行；每张开始前 `emit progress { current, total, message: basename }`，结束补一条 `current=total`。
- 单张失败记入 `failures` 并继续下一张；用户取消立即 `break`，不记失败项，已完成产物保留，任务终态 `CANCELLED`。
- 提交前 `mkdirSync(outputDir, { recursive: true })`，失败 → `IR_OUTPUT_WRITE_FAILED`（errno 入 detail）。
- ffmpeg 参数：`-y -v error -i <input> [-vf <filter>] <encodeArgs> <output>`，无 `signal` 超时（由取消控制），`maxOutputChars` 256KB。

## 8. 壳接线（固定 7 处，含 `node.ts`）

1. `apps/desktop/electron.vite.config.ts`：`@lumin/tool-image-rotate/{manifest,node}` + `/renderer/*` 三条别名。
2. `apps/desktop/package.json`：`"@lumin/tool-image-rotate": "workspace:*"`（devDependencies，字母序）。
3. `apps/desktop/src/tool-manifests.ts`：import + 清单数组新增 `imageRotateManifest`（`image-toolbox` 之后）。
4. `apps/desktop/src/main/tool-mains.ts`：import `registerMain as imageRotateRegisterMain` + 注册表新增 `'image-rotate'`。
5. `apps/desktop/src/renderer/src/tools/image-rotate.vue`：薄页面转发 `ToolView.vue`。
6. `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：iconMap 新增 `'rotate-cw': RotateCw`（补 import）。
7. 根 `vitest.config.ts`：新增 `packages/tools/image-rotate/src/**/*.ts` 80% 阈值。

清单：`id: image-rotate`、`name: 图片旋转`、`icon: rotate-cw`、`category: image`、`order: 51`、`version: 0.1.0`。
另需 `pnpm install --no-frozen-lockfile --prefer-offline` 生成 workspace 链接。

## 9. R5 体积口径

无 worker / wasm / 模型资产；仅共享 vendor（vue / naive-ui / `@lucide/vue`）。`pnpm build` 后实测 `image-rotate-*.js` raw/gzip 并记录，上限 **200KB gzip**。

## 10. 验收

- 单测（本包 ≥80%）：
  - `rotate.test.ts`：扩展名归一（大小写/点/jpeg/非法/路径变体）、`buildFilterArgs` 全组合与顺序、`buildRotateOutputName`（四旋转/两翻转/组合/无点文件名/多点数）、`buildEncodeArgs`、失败归类（磁盘满/权限/输出打开/损坏）。
  - `schema.test.ts`：合法 payload、空文件列表、超 500、`rotation/flip` 均 none、非法枚举。
  - `errors.test.ts`：码集合、中文文案、可重试集合、detail 省略。
  - `node.test.ts`：假 `runProcess` 注入——引擎缺失、目录创建失败、逐文件成功/失败、冲突命名递增、取消不记失败、输出目录记忆。
  - `renderer/client.test.ts`：三通道名与入参透传。
  - `manifest.test.ts`：契约固定字段。
- e2e `apps/desktop/e2e/image-rotate-smoke.spec.ts` 4 用例：
  1. 页面加载 + 空态引导 + 开始按钮禁用；
  2. 旋转 90°（320×240 PNG → 产物 240×320，progress 事件存在）；
  3. 水平翻转保持尺寸 + 重复执行冲突命名 ` (1)`；
  4. 好图 + 损坏文件 + 不支持扩展名混合批次 → 1 成功 2 失败（`IR_FILE_CORRUPT` / `IR_FILE_UNSUPPORTED`）。
- R2 八类映射记录于 `docs/smoke/image-rotate.md`（真实 ffmpeg 环境）。
- `pnpm gate` / `pnpm coverage` / `pnpm build` / e2e 全绿。
