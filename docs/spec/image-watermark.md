# 图片批量水印（image-watermark）字段级功能清单

> 里程碑：M21（已登记 plan §1 Q25 / §4.21 / §6）
> 状态：**已批准并于 2026-11-20 实施**（冒烟见 `docs/smoke/image-watermark.md`）
> 关联规范：`AGENTS.md` §2（零耦合/公共代码上提）、§5（三态/tokens/图标）、§6（IPC 三段式）、§7（测试门禁）、§8（性能）

---

## 1. 目标与边界

### 1.1 目标

新增独立工具包 `image-watermark`（名称「图片批量水印」）：**多选图片**（PNG / JPG / WebP）批量叠加**文字水印**或**图片水印**，位置九宫格、边距、透明度、大小、旋转、平铺均可调；输出到指定目录（**绝不覆盖原图**），重名自动递增；长任务进度 + 取消；三态 UI。全程离线，**零新增第三方依赖**（复用仓库既有 `@napi-rs/canvas@1.1.1`）。

### 1.2 做

| 能力     | 说明                                                                         |
| -------- | ---------------------------------------------------------------------------- |
| 输入     | 拖拽或选择**多张**图片；`.png/.jpg/.jpeg/.webp`，大小写不敏感；单次 1–100 张、单张 ≤40MB |
| 文字水印 | 内容 1–100 字（支持中文）、颜色可调、字号按图片短边百分比（2–50%）            |
| 图片水印 | 单张 PNG/JPG/WebP（≤5MB）、宽度按图片短边百分比（2–50%），等比缩放            |
| 位置     | 九宫格（左上/上/右上/左/中/右/左下/下/右下），默认右下                        |
| 几何     | 边距 0–20%（短边百分比）、不透明度 5–100%、旋转 -180–180°（顺时针为正）       |
| 平铺     | 开关（默认关）；开启后按固定步长斜向网铺，忽略位置与边距                      |
| 预览     | renderer Canvas 展示第一张图缩略图 + 按当前参数绘制的水印（防抖 200ms，不写盘） |
| 输出     | 目录选择器 + 记忆（settings `outputDir`，缺省 `userData/image-watermark`）；命名 `{原名}_水印.{ext}`，冲突 `(n)` 递增；PNG/JPG/WebP 原格式编码 |
| 批量     | worker 串行逐张处理；单张失败记入 `failures` 不中断整批；`progress` 逐张上报  |
| 取消     | 长任务三段式（invoke → progress → done/error）+ `lumin:task:cancel`          |
| 不覆盖   | 输出同名时一律递增；输出目录与源目录相同时也只新增文件，绝不改写原图          |

### 1.3 不做（防范围膨胀）

- PDF 水印 / 页码（`pdf-toolkit` M17 范围）
- 图片转码、压缩、缩放、裁剪（`image-toolbox` 范围）
- 同时叠加多个水印、水印模板库、单个水印位置微调
- 平铺步长/角度自定义、字体选择、描边/阴影
- EXIF 元数据写入（仅像素处理）
- 历史记录、撤销、云同步

### 1.4 与既有工具边界

- 与 `image-toolbox`（转码/压缩/缩放）能力不重叠：本工具只做「叠加水印」。
- 与 `pdf-toolkit` 水印不共享代码：后者面向 PDF（pdf-lib 栅格图嵌入），本工具面向位图（canvas 直绘）。
- 复用：`@lumin/ui/DropZone.vue`（`multiple`）、`@lumin/ui/TaskProgress.vue`、`@lumin/shared`（`baseName`/`uniqueFileName`/结构化错误）、`@lumin/node-kit`（`runTask`/`classifyPrecheckError`/`tail`）、`@lumin/node-kit/pdf` 的 `ensureCjkFont`（字体注册单一来源）。

---

## 2. 工具清单（manifest）

| 字段        | 值                                                                    |
| ----------- | --------------------------------------------------------------------- |
| id          | `image-watermark`                                                     |
| name        | `图片批量水印`                                                        |
| description | `批量给图片添加文字或图片水印（位置/透明度/大小/旋转/平铺）`          |
| icon        | `stamp`（壳 `AppSidebar` iconMap 注册 `Stamp`）                       |
| order       | `85`（介于 qr-code 80 与 ocr-text 90 之间）                           |
| version     | `0.1.0`                                                               |

settings 命名空间：`tools.image-watermark.outputDir`（键名 `outputDir`）。

---

## 3. 界面规格（单页，三态强制）

页面标题「图片批量水印」，副标题「批量叠加文字或图片水印，原图不修改，全程离线」。

### 3.1 空态

- `DropZone`：`multiple` + `accept=".png,.jpg,.jpeg,.webp"`，提示「拖拽图片到此处，或点击选择（可多选）」。
- 辅助说明：「支持 PNG / JPG / WebP，单次最多 100 张，单张不超过 40MB；水印全程离线处理。」
- 不渲染空白区域/白屏。

### 3.2 输入区（选中文件后）

| 元素         | 控件 / 范围 / 默认值                                                      |
| ------------ | ------------------------------------------------------------------------- |
| 文件列表     | 缩略图（`URL.createObjectURL`，切换/卸载时 revoke）+ 文件名 + 大小；逐行「移除」+「清空」；超出 100 张时忽略并提示「单次最多 100 张」 |
| 水印类型     | `NRadioGroup`：`文字水印` / `图片水印`，默认文字                          |
| 文字内容     | `NInput`，1–100 字，默认「内部资料」；仅文字水印显示                       |
| 文字颜色     | `NColorPicker`，默认 `#ffffff`；仅文字水印显示                             |
| 字号         | `NSlider` 2–50（% 图片短边），默认 8；仅文字水印显示                       |
| 水印图片     | `DropZone` 单选 PNG/JPG/WebP，≤5MB，显示缩略图与文件名；仅图片水印显示     |
| 图片宽度     | `NSlider` 2–50（% 图片短边），默认 20；仅图片水印显示                      |
| 位置         | 九宫格按钮组，默认右下；平铺开启时禁用                                     |
| 边距         | `NSlider` 0–20（% 图片短边），默认 3；平铺开启时禁用                       |
| 不透明度     | `NSlider` 5–100（%），默认 30                                              |
| 旋转         | `NInputNumber` -180–180（°，顺时针为正），默认 0                           |
| 平铺         | `NSwitch`，默认关                                                          |
| 预览         | `canvas` 显示第一张图缩略图（高 ≤320px）+ 按参数绘制水印；参数变化防抖 200ms 重绘 |
| 输出目录     | 只读输入框 + 「选择目录」（`window.lumin.pickDirectory`），选中即记忆       |
| 开始按钮     | 「开始加水印」；无文件 / 文字为空 / 图片水印未选 / 输出目录为空时禁用      |

### 3.3 加载态

- 点击开始后提交 `image-watermark:watermark`，展示 `TaskProgress`：`current/total` + `message = 当前文件名`。
- 「取消」调用 `lumin:task:cancel`；回包 `CANCELLED` 回到可操作态，已选文件与参数保留。

### 3.4 报错态

- `NAlert` 展示中文文案 + 错误码 + 可折叠 `detail`。
- `isRetryable(code)` 为真显示「重试」，否则显示「重新选择图片」。

### 3.5 结果态

- 汇总：`成功 {n} 张 · 失败 {m} 张`。
- 成功列表：输出路径（超 20 条折叠为「共 n 个文件」）+「打开所在文件夹」（`window.lumin.revealPath`）。
- 失败列表：文件名 + 错误码 + 文案（逐条）。
- 「再处理一批」：清空文件列表与结果，保留水印参数与输出目录。

---

## 4. 水印几何与命名（纯函数 `contract.ts`）

纯函数是唯一布局真相源，renderer 预览与 worker 出图共用，单测 ≥80%。

| 函数                       | 行为                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `shortEdge(width, height)` | `min(W, H)`                                                                               |
| `percentToPx(pct, edge)`   | `max(1, round(pct/100 × edge))`                                                           |
| `textFontSize(sizePct, edge)` | 字号像素（`percentToPx`，2–50%）                                                       |
| `imageWatermarkSize(naturalW, naturalH, sizePct, edge)` | 宽度像素 + 等比高度；尺寸非法返回 `null`                                 |
| `anchorPosition(canvasW, canvasH, wmW, wmH, position, marginPx)` | 返回水印中心点坐标（九宫格贴边/居中，旋转围绕中心） |
| `tilePositions(canvasW, canvasH, wmW, wmH, rotationDeg)` | 平铺中心点数组：步长 `wmW × 1.6` / `wmH × 2.0`，从左上起铺满并覆盖四角；数量上限 **2000**，超出截断 |
| `normalizeRotation(deg)`   | 归一到 (-180, 180]                                                                        |
| `clampOpacity(pct)`        | 5–100 → 0.05–1                                                                            |
| `outputName(inputPath)`    | `{baseName}_水印{ext}`（ext 原样保留，不转小写）                                          |
| `encoderFor(inputPath)`    | `.png`→`png`；`.jpg/.jpeg`→`jpeg`；`.webp`→`webp`；其余 `null`                            |

几何规则：

- 尺寸基准一律为**图片短边**；文字水印先 `measureText` 得宽高再参与位置/平铺计算。
- 九宫格：`margin = marginPct% × shortEdge`；中列/中行居中；旋转围绕水印包围盒中心。
- 平铺：忽略位置与边距；旋转按水印包围盒近似后的步长铺设；右侧/底部允许部分出画。
- 绘制顺序：原图 → `globalAlpha = opacity` → 水印（平铺逐点绘制）。
- 编码：`png` 保留 alpha；`jpeg` / `webp` 质量 90（`canvas.encode`）。

---

## 5. IPC 契约（通道 `image-watermark:{action}`）

| 通道                          | 类型 | 入参（zod）                                                              | 回包 |
| ----------------------------- | ---- | ------------------------------------------------------------------------- | ---- |
| `image-watermark:config`      | sync | `{}`                                                                      | `{ outputDir: string }` |
| `image-watermark:set-output-dir` | sync | `{ outputDir: string }`                                                | `{ outputDir: string }` |
| `image-watermark:watermark`   | task | `{ inputPaths: string[], watermark: Watermark, outputDir?: string }`      | `{ outputs: string[], failures: Failure[] }` |

### 5.1 schema（`packages/tools/image-watermark/src/schema.ts`）

- `IMAGE_INPUT_RE = /\.(png|jpe?g|webp)$/i`；`MAX_IMAGES = 100`；`MAX_IMAGE_BYTES = 40 * 1024 * 1024`；`MAX_WATERMARK_BYTES = 5 * 1024 * 1024`。
- `POSITIONS = ['top-left','top-center','top-right','middle-left','center','middle-right','bottom-left','bottom-center','bottom-right'] as const`。
- `watermarkBase = { sizePct: 2–50, opacity: 5–100, rotation: -180–180, position: enum, marginPct: 0–20, tile: boolean }`。
- `textWatermarkSchema = watermarkBase + { type: 'text', text: 1–100 字（trim 非空）, color: /^#[0-9a-fA-F]{6}$/ }`。
- `imageWatermarkSchema = watermarkBase + { type: 'image', watermarkPath: 非空 + 图片白名单 }`。
- `watermarkSchema = z.discriminatedUnion('type', [...])`。
- `watermarkPayloadSchema = { inputPaths: 1–100 张 + 白名单, watermark: watermarkSchema, outputDir?: 非空 }`。
- `setOutputDirPayloadSchema = { outputDir: 非空 }`；`configResultSchema = { outputDir: 非空 }`。
- 结果类型：`{ outputs: string[], failures: { file, code, message, detail? }[] }`。

### 5.2 主进程（`node.ts`）

- `config`：读 settings `outputDir`，缺省 `join(paths.userData, 'image-watermark')`。
- `set-output-dir`：`mkdir(recursive)` 失败 → `IW_OUTPUT_DIR_INVALID`；成功后写 settings。
- `watermark`（task）：zod 校验 → 逐张 `access(R_OK)` + `open('r')` 预检（ENOENT→`IW_INPUT_INVALID`；EBUSY/EPERM/EACCES→`IW_FILE_LOCKED`）→ `stat` 体积 >40MB → `IW_IMAGE_TOO_LARGE`；图片水印预检（缺失 → `IW_WATERMARK_MISSING`，>5MB/解码失败 → `IW_WATERMARK_INVALID`）→ 解析输出目录（请求 > 记忆 > 默认，`mkdir` 失败 → `IW_OUTPUT_DIR_INVALID`）→ `runTask({ workerPath, payload, timeoutMs: 600_000, signal, onUpdate })`。
- 错误映射：`TaskTimeoutError` → `OP_TIMEOUT`；`TaskCrashError` → `IW_PROCESS_FAILED`（detail=尾部）；其余结构化错误透传（队列再归一 `CANCELLED`）。
- 依赖注入：`ImageWatermarkDeps { workerPath, checkReadable, checkExclusive, statSize, fileExists, makeDir, run }`，`registerWith(ctx, deps)` 供单测注入假件。

### 5.3 worker（`packages/tools/image-watermark/src/watermark.worker.ts`）

- `exposeTask` 注册；`runWatermark(payload, ctx, deps?)` 导出供单测。
- 逐张：`readFile → loadImage → createCanvas(W,H) → drawImage(原图) → 绘制水印 → canvas.encode → .tmp 写入 → rename`；单张失败 `failures.push` 不中断，`progress { current, total, stage: 'watermark', message: 文件名 }`。
- 文字水印：`ensureCjkFont()`（`@lumin/node-kit/pdf`，与 pdf-toolkit 同源）→ `font = '600 {size}px YaHei, "Microsoft YaHei", sans-serif'`、`textBaseline='middle'`。
- 图片水印：水印 Buffer 每任务只解码一次并复用。
- 全部失败 → 抛首个结构化错误；`.tmp` best-effort 清理（磁盘满/取消无残留）。
- 取消：`runTask` terminate worker，渲染进程无结果回写。

---

## 6. 错误码表（`packages/tools/image-watermark/src/errors.ts`）

| 码                    | 文案                                         | 可重试 |
| --------------------- | -------------------------------------------- | ------ |
| `IW_INVALID_PAYLOAD`  | 参数无效                                     | 否     |
| `IW_INPUT_INVALID`    | 图片不存在或不受支持                         | 否     |
| `IW_FILE_LOCKED`      | 图片被其他程序占用，请关闭后重试             | 是     |
| `IW_IMAGE_TOO_LARGE`  | 图片超过 40MB，请压缩后重试                  | 否     |
| `IW_IMAGE_CORRUPT`    | 图片无法解码，可能已损坏                     | 是     |
| `IW_WATERMARK_MISSING`| 水印图片不存在，请重新选择                   | 否     |
| `IW_WATERMARK_INVALID`| 水印图片无效（需 PNG / JPG / WebP，≤5MB）    | 否     |
| `IW_OUTPUT_DIR_INVALID` | 输出目录不可用或不可写                     | 是     |
| `IW_WRITE_FAILED`     | 写入失败，请检查磁盘空间与目录权限           | 是     |
| `IW_PROCESS_FAILED`   | 处理失败，请重试或查看详情                   | 是     |
| `OP_TIMEOUT`          | 处理超时（10 分钟），已终止                  | 是     |
| `CANCELLED`           | 已取消                                       | 否     |

---

## 7. 工程接线

- `packages/tools/image-watermark/package.json`：`@lumin/tool-image-watermark`，exports `./manifest`、`./node`、`./schema`、`./errors`、`./contract`、`./renderer/*`；依赖 `plugin-api / shared / ui / node-kit`、`vue`、`naive-ui`、`@lucide/vue`、`zod`，devDep `@napi-rs/canvas@1.1.1`（与 pdf-images 同口径）。
- 壳注册 5 处：`apps/desktop/src/tool-manifests.ts`、`apps/desktop/src/main/tool-mains.ts`、`AppSidebar.vue` iconMap（`stamp` → `Stamp`）、`apps/desktop/package.json` devDeps、`apps/desktop/electron.vite.config.ts` 别名。
- 页面：`apps/desktop/src/renderer/src/tools/image-watermark.vue`（薄壳，glob 路由自动发现，懒加载）。
- `vitest.config.ts`：新增 `packages/tools/image-watermark/src/**/*.ts` 80% 阈值。
- 原生依赖随包：`@napi-rs/canvas` 已在 `apps/desktop` dependencies 且 `asarUnpack` 解包，无构建改动。

---

## 8. 性能与规范符合

| 项             | 要求                                                             |
| -------------- | ---------------------------------------------------------------- |
| 单张 1080p     | ≤200ms（含解码/编码）                                            |
| 单批 100 张    | ≤30s；任务超时 10 分钟                                           |
| renderer chunk | <200KB gzip（工具页仅 UI + 纯函数，实测记入 smoke）               |
| 内存           | 逐张处理不并发，单张画布处理完即释放；平铺点数上限 2000/张       |
| 样式           | 仅 Tailwind + tokens；无硬编码色值                               |
| 图标           | `@lucide/vue` 的 `Stamp`（壳 iconMap 注册）                      |
| 日志           | 主进程 `ctx.log.info` 记录注册；禁止 console                     |

---

## 9. 验收标准

1. 空态 / 加载（可取消）/ 报错三态齐全，无白屏。
2. 九宫格 9 个位置 + 平铺 + 旋转 + 透明度：用合成图断言水印像素落在预期区域（单测 + e2e）。
3. 中文/空格路径可用；输出目录与源目录相同时原图**字节不变**，新增 `{原名}_水印.{ext}`；同名 `(1)` 递增。
4. 损坏图 → `IW_IMAGE_CORRUPT`；>40MB → `IW_IMAGE_TOO_LARGE`；被占用 → `IW_FILE_LOCKED`；水印图缺失 → `IW_WATERMARK_MISSING`；单张失败不影响其余。
5. 取消任务后无 `.tmp` 残留、回到可操作态。
6. 单测覆盖 `contract/schema/errors/node/worker` ≥80%；e2e 冒烟通过。
7. `pnpm gate` 退出码 0；coverage 全仓 ≥60%。
8. `docs/smoke/image-watermark.md` R2 八类逐条记录。

---

## 10. 风险与回滚

| 风险 | 处置 |
| ---- | ---- |
| `@napi-rs/canvas` 的 JPEG EXIF 方向 | 实现时用带 EXIF 的样图验证：若解码不自动应用朝向，则在 smoke 记录限制（不新增依赖），不擅自引入 sharp |
| 平铺点数爆炸导致内存增长 | `tilePositions` 硬上限 2000/张并在单测断言 |
| worker 崩溃残留 `.tmp` | 写入前登记临时路径，`finally` best-effort 清理（沿用 pdf-images 口径） |
| 大图（>40MB）解码慢 | 预检拒入并给出中文文案；单批串行避免内存峰值叠加 |
| 预览与出图不一致 | 预览与 worker 共用 `contract.ts` 同一套纯函数；单测锁定几何结果 |

回滚：删除 `packages/tools/image-watermark` 与壳 5 处注册即可（单 commit revert）。

---

## 11. 审批

- [x] 用户批准本清单与 `image-watermark-tasks.md` 后开始实施（Spec 模式要求）。
- [x] 实施完成：单测 51、e2e 2/2、工具 chunk 21,132 B gzip、零新增第三方依赖。
