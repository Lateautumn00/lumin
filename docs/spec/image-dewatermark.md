# 图片去水印（image-dewatermark）字段级功能清单

> 里程碑：M65（已登记 `docs/opencode/plan.md` §1 Q67 / §4.65 / §6）
> 状态：**2026-11-24 实施**（冒烟见 `docs/smoke/image-dewatermark.md`）
> 关联规范：`AGENTS.md` §2（零耦合）、§5（三态/tokens/图标）、§6（IPC 三段式）、§7（测试门禁）、§8（性能）

---

## 1. 目标与边界

### 1.1 目标

新增独立工具包 `image-dewatermark`（名称「图片去水印」）：单图导入后**手动框选多个矩形区域**，按所选模式填充：**快速修复（默认）/ 模糊 / 纯色**；原图不修改，输出 `{原名}_去水印{原扩展名}`，冲突 `(n)` 递增；长任务进度 + 取消；三态 UI；全程离线，**零新增第三方依赖、零模型**（复用既有 `@napi-rs/canvas@1.1.1`）。

### 1.2 做

| 能力     | 说明                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| 输入     | 拖拽或选择**单张**图片；`.png/.jpg/.jpeg/.webp`；≤40MB、≤10000×10000                                                 |
| 框选     | 图片上拖拽新建矩形；点击选中；拖动已选区域移动；删除选中/清空；最多 **20** 个；最小 2×2                              |
| 快速修复 | Telea 近似（纯 TS，RGBA + 二值掩码，由外向内推进、邻域加权填充），默认模式                                           |
| 模糊     | 半径 4–40px（默认 12），分离式盒式模糊，仅作用于区域                                                                 |
| 纯色     | 取区域外 1px 边缘均值色填充                                                                                          |
| 降级     | 快速修复单区域面积 > 2M 像素 → 自动改用模糊并回传提示                                                                |
| 输出     | 目录选择器 + 记忆（settings `outputDir`，缺省 `userData/image-dewatermark`）；PNG/JPG/WebP 原格式编码（有损质量 90） |
| 取消     | 三段式 `invoke → progress → done/error` + `lumin:task:cancel`（硬终止 worker）                                       |
| 不覆盖   | 输出同名一律 `(n)` 递增；绝不改写原图                                                                                |

### 1.3 不做（明确冻结）

- 自动识别水印（后续里程碑，不阻塞本批）
- 批量处理、处理历史、模板库、撤销栈
- 非矩形/画笔蒙版、ML inpainting 模型
- 格式转码、尺寸缩放、元数据写入

### 1.4 与既有工具边界

- 与 `image-watermark`（加水印）职责分离，不共享代码、不互相 import。
- 复用：`@lumin/ui/DropZone.vue`、`@lumin/ui/TaskProgress.vue`、`@lumin/shared`（`baseName` / `uniqueFileName` / 结构化错误）、`@lumin/node-kit`（`runTask` / `classifyPrecheckError` / `tail`）。

---

## 2. 工具清单（manifest）

| 字段        | 值                                                     |
| ----------- | ------------------------------------------------------ |
| id          | `image-dewatermark`                                    |
| name        | `图片去水印`                                           |
| description | `框选水印区域后用快速修复、模糊或纯色填充，原图不修改` |
| icon        | `eraser`（壳 `AppSidebar` iconMap 注册 `Eraser`）      |
| category    | `image`                                                |
| order       | `86`（紧随 image-watermark 85）                        |
| version     | `0.1.0`                                                |

settings 命名空间：`tools.image-dewatermark.outputDir`（键名 `outputDir`）。

---

## 3. 界面规格（单页，三态强制）

页面标题「图片去水印」，副标题「框选水印区域后自动填充，原图不修改，全程离线」。

### 3.1 空态

- `DropZone`：`accept=".png,.jpg,.jpeg,.webp"`，提示「拖拽图片到此处，或点击选择」。
- 辅助说明：「支持 PNG / JPG / WebP，单张不超过 40MB，尺寸不超过 10000×10000。」
- 不渲染空白区域/白屏。

### 3.2 输入与框选区（选中图片后）

| 元素      | 控件 / 范围 / 默认值                                                            |
| --------- | ------------------------------------------------------------------------------- |
| 图片预览  | 显示原图（等比缩放），叠加半透明区域框与序号；`data-testid="dewatermark-stage"` |
| 新建区域  | 在空白处按下拖动 → 实时虚线框 → 松开生成区域；小于 2×2 丢弃                     |
| 选中/移动 | 点击区域选中（高亮）；按住区域拖动改变位置，自动夹取在图像内                    |
| 删除      | 区域列表逐项「移除」；「清空区域」；「删除选中」                                |
| 区域上限  | 20 个；达到上限后新框选忽略并提示「最多框选 20 个区域」                         |
| 区域列表  | 每项显示序号 + `x, y, w×h`（原图像素），点击定位选中                            |
| 填充模式  | `NRadioGroup`：快速修复（默认）/ 模糊 / 纯色                                    |
| 模糊半径  | `NSlider` 4–40px，默认 12；仅模糊模式显示                                       |
| 输出目录  | 只读输入框 + 「选择目录」（`window.lumin.pickDirectory`），选中即记忆           |
| 开始按钮  | 「开始去水印」；无图片 / 无区域 / 输出目录为空 / 运行中时禁用                   |

### 3.3 加载态

- 提交 `image-dewatermark:dewatermark`，展示 `TaskProgress`：`current/total`（区域数）+ `message`。
- 「取消」调用 `lumin:task:cancel`；`CANCELLED` 回到可操作态，图片与区域保留。

### 3.4 报错态

- `NAlert` 展示中文文案 + 错误码 + `detail`。
- `isRetryable(code)` 为真显示「重试」，否则显示「重新选择图片」。

### 3.5 结果态

- 成功：产物路径 + 「打开输出目录」（`window.lumin.revealPath`）+ 「再处理一张」。
- 降级提示：`warnings` 逐条展示（如「区域 3 面积过大，已改用模糊填充」）。

---

## 4. 纯函数契约

### 4.1 `contract.ts`

| 函数                                     | 行为                                                           |
| ---------------------------------------- | -------------------------------------------------------------- |
| `clampRegion(region, W, H)`              | 越界收敛 + 取整；宽或高 < 2 → `null`                           |
| `normalizeRegions(regions, W, H, max)`   | 逐个 `clampRegion` + 丢弃非法 + 截断到 20                      |
| `expandRegion(region, margin, W, H)`     | 外扩并夹取到图像内（inpaint 边缘采样）                         |
| `regionArea(region)`                     | `width × height`                                               |
| `isRegionOversized(region, limit)`       | 面积 > 2M                                                      |
| `normalizeDraftRegion(start, end, W, H)` | 两点 → 归一矩形（框选）                                        |
| `moveRegion(region, dx, dy, W, H)`       | 平移并夹取在图内                                               |
| `toImagePoint(point, display, image)`    | 显示坐标 → 原图坐标                                            |
| `rectToPercent(region, image)`           | 原图矩形 → 预览百分比定位                                      |
| `outputName(inputPath)`                  | `{baseName}_去水印{ext}`（ext 原样保留）                       |
| `encoderFor(pathOrName)`                 | `.png`→`png`；`.jpg/.jpeg`→`jpeg`；`.webp`→`webp`；其余 `null` |

常量：`INPAINT_MAX_AREA = 2_000_000`、`INPAINT_MARGIN = 4`（≤16）。

### 4.2 `inpaint.ts`

| 函数                                       | 行为                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `teleaInpaint(pixels, W, H, mask)`         | 边界种子入堆 → 按距离由外向内；8 邻域已知像素按 `1/d²` 加权填充；全掩码无已知像素时保持原样 |
| `averageEdgeColor(pixels, W, H, region)`   | 区域外 1px 环均值色（夹取到图像边界）                                                       |
| `fillSolid(pixels, W, H, region, color)`   | 区域填纯色（含 alpha）                                                                      |
| `blurRegion(pixels, W, H, region, radius)` | 可分离盒式模糊（水平 + 垂直滑窗，边界夹取），只写回区域                                     |

---

## 5. IPC 契约（通道 `image-dewatermark:{action}`）

| 通道                               | 类型 | 入参（zod）                                            | 回包                   |
| ---------------------------------- | ---- | ------------------------------------------------------ | ---------------------- |
| `image-dewatermark:config`         | sync | `{}`                                                   | `{ outputDir }`        |
| `image-dewatermark:set-output-dir` | sync | `{ outputDir }`                                        | `{ outputDir }`        |
| `image-dewatermark:dewatermark`    | task | `{ inputPath, regions, mode, blurRadius, outputDir? }` | `{ output, warnings }` |

### 5.1 schema

- `IMAGE_INPUT_RE = /\.(png|jpe?g|webp)$/i`；`MAX_IMAGE_BYTES = 40MB`；`MAX_DIMENSION = 10000`。
- `MAX_REGIONS = 20`；`MIN_REGION_SIZE = 2`；`INPAINT_MAX_AREA = 2_000_000`。
- `FILL_MODES = ['inpaint','blur','solid']`；`MIN_BLUR_RADIUS = 4`、`MAX_BLUR_RADIUS = 40`、`DEFAULT_BLUR_RADIUS = 12`。
- `regionSchema = { x,y: int ≥0；width,height: int ≥2 }`。
- `dewatermarkPayloadSchema = { inputPath: 图片白名单；regions: 1–20；mode；blurRadius: 4–40 默认 12；outputDir?: 非空 }`。
- `dewatermarkResult = { output: string；warnings: string[] }`。

### 5.2 主进程（`node.ts`）

- `config`：settings `outputDir`，缺省 `join(paths.userData, 'image-dewatermark')`。
- `set-output-dir`：`mkdir(recursive)` 失败 → `IDW_OUTPUT_DIR_INVALID`；成功后写 settings。
- `dewatermark`（task）：zod 校验 → `access(R_OK)` + `open('r')` 预检（ENOENT → `IDW_INPUT_INVALID`；EBUSY/EPERM/EACCES → `IDW_FILE_LOCKED`）→ `stat` >40MB → `IDW_IMAGE_TOO_LARGE` → 解析输出目录 → `runTask({ timeoutMs: 600_000, signal, onUpdate })`。
- 错误映射：`TaskTimeoutError` → `OP_TIMEOUT`；`TaskCrashError` → `IDW_INPAINT_FAILED`；结构化错误透传。
- 依赖注入：`ImageDewatermarkDeps { workerPath, run, checkReadable, checkExclusive, statSize, makeDir }`，`registerWith(ctx, deps)` 供单测。

### 5.3 worker（`dewatermark.worker.ts`）

- `exposeTask` 注册；`runDewatermark(payload, ctx, deps?)` 导出供单测。
- 解码 → `getImageData` → `normalizeRegions`（空 → `IDW_NO_REGIONS`）→ 逐区域填充（每区域前上报 progress）→ `putImageData` → 原格式编码 → `.tmp` + `rename`。
- 尺寸 > `MAX_DIMENSION` → `IDW_IMAGE_TOO_LARGE`；解码失败 → `IDW_IMAGE_CORRUPT`；填充异常 → `IDW_INPAINT_FAILED`；写盘异常 → `IDW_WRITE_FAILED`。
- 快速修复：外扩 `INPAINT_MARGIN` 子图 + 相对二值掩码 → `teleaInpaint` → 只回写掩码像素；面积超限降级模糊并写入 `warnings`。
- 取消：`runTask` 硬终止 worker；写盘发生在全部填充之后，取消不产生 `.tmp`。

---

## 6. 错误码表（`packages/tools/image-dewatermark/src/errors.ts`）

| 码                       | 文案                                 | 可重试 |
| ------------------------ | ------------------------------------ | ------ |
| `IDW_INVALID_PAYLOAD`    | 参数无效                             | 否     |
| `IDW_INPUT_INVALID`      | 图片不存在或不受支持                 | 否     |
| `IDW_FILE_LOCKED`        | 图片被其他程序占用，请关闭后重试     | 是     |
| `IDW_IMAGE_TOO_LARGE`    | 图片超过 40MB 或尺寸超过 10000×10000 | 否     |
| `IDW_IMAGE_CORRUPT`      | 图片无法解码，可能已损坏             | 是     |
| `IDW_NO_REGIONS`         | 请先框选至少一个去水印区域           | 否     |
| `IDW_OUTPUT_DIR_INVALID` | 输出目录不可用或不可写               | 是     |
| `IDW_INPAINT_FAILED`     | 去水印处理失败，请调整区域后重试     | 是     |
| `IDW_WRITE_FAILED`       | 写入失败，请检查磁盘空间与目录权限   | 是     |
| `OP_TIMEOUT`             | 处理超时（10 分钟），已终止          | 是     |
| `CANCELLED`              | 已取消                               | 否     |

---

## 7. 工程接线

- `packages/tools/image-dewatermark/package.json`：exports `./manifest`、`./node`、`./schema`、`./errors`、`./contract`、`./renderer/*`；devDep `@napi-rs/canvas@1.1.1`。
- 壳注册：`apps/desktop/src/tool-manifests.ts`、`src/main/tool-mains.ts`、`AppSidebar.vue` iconMap（`eraser` → `Eraser`）、`apps/desktop/package.json` devDeps、`electron.vite.config.ts` 三端 alias。
- 页面：`apps/desktop/src/renderer/src/tools/image-dewatermark.vue`（薄壳，glob 路由自动发现）。
- `vitest.config.ts`：新增 `packages/tools/image-dewatermark/src/**/*.ts` 80% 阈值。

---

## 8. 性能与规范符合

| 项                      | 要求                                                        |
| ----------------------- | ----------------------------------------------------------- |
| 单区域 500×500 快速修复 | 秒级以内（Telea 距离推进 + 堆）                             |
| 整图 4000×3000          | 端到端 ≤10s（e2e 粗测），任务超时 10 分钟                   |
| renderer chunk          | <200KB gzip（工具页仅 UI + 纯函数）                         |
| 内存                    | 单图单缓冲（RGBA）；快速修复超 2M 像素降级，防内存/耗时爆炸 |
| 样式                    | 仅 Tailwind + tokens；无硬编码色值                          |
| 图标                    | `@lucide/vue` 的 `Eraser`                                   |
| 日志                    | 主进程 `ctx.log.info` 记录注册；禁止 console                |

---

## 9. 验收标准

1. 空态 / 加载（可取消）/ 报错三态齐全，无白屏。
2. 三模式：合成图红块区域经快速修复/模糊/纯色后不再为纯红（单测像素断言 + e2e）。
3. 中文/空格路径可用；原图 SHA-256 不变；同名 `(1)` 递增。
4. 损坏图 → `IDW_IMAGE_CORRUPT`；>40MB → `IDW_IMAGE_TOO_LARGE`；无区域 → `IDW_NO_REGIONS`（UI 侧禁用）；取消无 `.tmp` 残留。
5. 单测覆盖 `contract/inpaint/schema/errors/node/worker/client` ≥80%；e2e 冒烟通过。
6. `pnpm gate` 退出码 0；coverage 全仓 ≥60%。
7. `docs/smoke/image-dewatermark.md` R2 八类逐条记录。

---

## 10. 风险与回滚

| 风险                      | 处置                                                         |
| ------------------------- | ------------------------------------------------------------ |
| Telea 大面积填充耗时/内存 | 单区域 >2M 像素降级模糊并提示                                |
| 纯色取色受水印本体干扰    | 取区域外 1px 环均值；UI 提示可扩大框选范围                   |
| 边缘区域夹取后尺寸过小    | `normalizeRegions` 丢弃 <2×2，worker 空集 → `IDW_NO_REGIONS` |
| 预览与出图坐标不一致      | 预览/框选/worker 共用 `contract.ts` 换算函数                 |

回滚：删除 `packages/tools/image-dewatermark` 与壳 6 处注册即可（单 commit revert）。
