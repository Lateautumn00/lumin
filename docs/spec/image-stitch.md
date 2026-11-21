# 图片拼接（image-stitch）字段级功能清单

> 里程碑：M22（已登记 plan §1 Q26 / §4.22 / §6）；**M40 增补「长图分割」Tab（2026-11-21 用户拍板，登记 plan §4.40）**
> 状态：**已批准并于 2026-11-20 实施**（冒烟见 `docs/smoke/image-stitch.md`）；M40 增补项待实施后回写冒烟
> 关联规范：`AGENTS.md` §2（零耦合）、§5（三态/tokens/图标）、§6（IPC 三段式）、§7（测试门禁）、§8（性能）

---

## 1. 目标与边界

### 1.1 目标

新增独立工具包 `image-stitch`（名称「图片拼接」）：**多选图片**（PNG / JPG / WebP）拼成**单张**图片，支持**纵向长图**、**横向长图**、**网格拼图**三种布局；基准尺寸、间距、外边距、背景色、输出格式与质量可调；长任务进度 + 取消；三态 UI。全程离线，**零新增第三方依赖**（复用仓库既有 `@napi-rs/canvas@1.1.1`）。

### 1.2 做

| 能力     | 说明                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| 输入     | 拖拽或选择**多张**图片；`.png/.jpg/.jpeg/.webp`，大小写不敏感；单次 1–100 张、单张 ≤40MB      |
| 纵向长图 | 按基准宽度等比缩放后自上而下排列                                                          |
| 横向长图 | 按基准高度等比缩放后自左向右排列                                                          |
| 网格拼图 | 列数 2–8，等宽正方形单元格，图片按比例 contain 居中，行数按图片数上取整                    |
| 基准尺寸 | `首图`（第一张） / `最大`（全部图最大边） / `固定`（100–10,000 px）                         |
| 间距     | 图片之间 0–100 px（网格为行/列间距）                                                       |
| 外边距   | 画布四周 0–100 px                                                                          |
| 背景色   | `#RRGGBB`（JPEG/WebP 有损输出同样填充，避免透明变黑）                                      |
| 输出格式 | PNG（无损） / JPG（q 60–100） / WebP（q 60–100），默认 PNG，质量默认 90                      |
| 上限     | 输出单边 ≤30,000 px 且总像素 ≤100,000,000；超限报 `IS_OUTPUT_TOO_LARGE`                     |
| 预览     | renderer Canvas 缩略预览（防抖 200ms，按同一 `planLayout` 缩比绘制，不写盘）                 |
| 输出     | 目录选择器 + 记忆（settings `outputDir`，缺省 `userData/image-stitch`）；命名 `拼接_{yyyyMMdd-HHmmss}.{ext}`，冲突 `(n)` 递增 |
| 进度     | worker 两阶段：`measure`（逐张量尺寸）→ `draw`（逐张绘制），`progress` 逐张上报              |
| 取消     | 长任务三段式（invoke → progress → done/error）+ `lumin:task:cancel`                       |
| 长图分割（M40） | 单张长图按**固定高度**（50–30000px）或**按份数**（2–50）切成多张；输出沿用原格式（png 无损 / jpg、webp q60–100）；命名 `{原名}_part01.{ext}` |
| 分割上限 | 单边 ≤30,000px；份数 ≤ 图高；输出段数 ≤ 100                                                |

### 1.3 不做（防范围膨胀）

- 自由画布 / 拖拽排版 / 旋转 / 圆角 / 边框 / 阴影
- 水印叠加（`image-watermark` 范围）、格式转换与压缩（`image-toolbox` 范围）
- 拖拽排序（顺序 = 选择顺序，可逐条移除后重选）
- 历史记录、撤销、模板保存

### 1.4 与既有工具边界

| 工具              | 边界                                                     |
| ----------------- | -------------------------------------------------------- |
| `image-watermark` | 给单张图叠加水印；本工具只拼接，不叠加                    |
| `image-toolbox`   | 转码/压缩/缩放；本工具输出单张合成图，不逐张转码          |
| `pdf-images`      | PDF ↔ 图片互转；与本工具无交集                            |

---

## 2. 工具清单（manifest）

```ts
{
  id: 'image-stitch',
  name: '图片拼接',
  description: '多张图片拼成纵向/横向长图或网格拼图，或将长图按高度/份数分割',
  icon: 'layout-grid',
  order: 86,
  version: '0.1.0'
}
```

设置命名空间 `tools.image-stitch.*`；壳侧需在 `AppSidebar` iconMap 注册 `layout-grid → LayoutGrid`。

---

## 3. 界面规格（单页，三态强制）

### 3.1 空态

- DropZone（多选）+ 引导文案「拖拽图片到此处，或点击选择（可多选）」
- 辅助说明：「支持 PNG / JPG / WebP，单次最多 100 张，单张不超过 40MB」

### 3.2 输入区（选中文件后）

- 已选列表：缩略图 + 文件名 + 体积 + 行内移除 + 清空；数量 ≥1 且有输出目录才允许开始
- 布局模式：`纵向拼接` / `横向拼接` / `网格`（单选）
- 基准尺寸：`首图` / `最大` / `固定`（固定时显示 100–10,000 px 数字输入）
- 网格列数 2–8（仅网格模式显示）
- 间距滑杆 0–100 px；外边距滑杆 0–100 px
- 背景色 `NColorPicker`（关闭 alpha）
- 输出格式：PNG / JPG / WebP；质量滑杆 60–100（PNG 时置灰）
- 预览 Canvas（第一屏可见，最大 480×320 缩略）
- 输出目录：只读输入框 + 「选择目录」

### 3.3 加载态

- `TaskProgress`：`current/total` + 阶段文案（`量尺寸 i/n` / `绘制 i/n`）+ `[取消]`

### 3.4 报错态

- `NAlert` 展示 `error.message` + `code · detail`
- `isRetryable(code)` 为真时显示 `[重试]`，否则只显示 `[返回重新选择]`

### 3.5 结果态

- 成功：`NAlert success`「已生成 2400 × 5600 · 5 张图」
- 显示输出绝对路径 + `[打开输出目录]` + `[再拼一次]` + `[再处理一批]`

### 3.6 长图分割 Tab（M40）

- 页签：`拼接` / `长图分割`（默认拼接；`#tab` 插槽写法，规避 naive-ui 自闭合 pane 不渲染标签）
- 输入：单张 PNG/JPG/WebP（拖拽 + 选择器）；≤40MB；选中后展示宽高
- 切分方式：`固定高度` / `按份数`（单选）
  - 固定高度：数字输入 50–30000px（默认 1000）；段数 = `ceil(图高 / 高度)`，末段不足保留实际高度
  - 按份数：数字输入 2–50（默认 3）；`base = floor(高/份数)`，余数依次摊到前几段（`base + 1`），份数不得超过图高
- 输出格式：沿用输入扩展名（png 无损；jpg/webp 质量滑杆 60–100，默认 90）
- 输出目录：与拼接 Tab 共用（settings 记忆，缺省 `userData/image-stitch`）
- 命名：`{原名}_part01.{ext}`（序号按段数补零，至少 2 位；冲突 `(1)` 递增）
- 加载态：`读取 i/1` → `切分 i/n` + `[取消]`；取消后不留 `.tmp`
- 结果态：「已生成 N 段 · 源图 W×H」+ 逐段尺寸列表 + `[打开输出目录]`

---

## 4. 布局纯函数（`contract.ts`）

| 函数                                     | 语义                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `clampInt(value, min, max)`              | 数值夹取并取整                                                        |
| `scaleToWidth(w, h, targetW)`            | 等比缩放到目标宽（至少 1px 高）                                       |
| `scaleToHeight(w, h, targetH)`           | 等比缩放到目标高（至少 1px 宽）                                       |
| `fitInBox(w, h, boxW, boxH)`             | contain 缩放（取较小比例、**不放大**，至少 1px）                        |
| `baseExtent(sizes, sizeMode, fixedSize, axis)` | 基准边长：`first` / `max` / `fixed`，非法返回 null              |
| `planLayout(sizes, layout)`              | **单一真相源**：返回 `{ width, height, placements[] }`；入参非法返回 null |
| `planOverLimit(plan)`                    | 单边 >30,000 或总像素 >1 亿                                          |
| `timestampName(date)`                    | `yyyyMMdd-HHmmss`                                                    |
| `outputFileName(date, ext)`              | `拼接_{timestamp}.{ext}`                                              |
| `extForEncoder(encoder)`                 | `png` / `jpg` / `webp`                                               |
| `planSplit(height, mode, param)`         | **M40**：`{mode:'height', height}`/`{mode:'parts', parts}` → `{slices:[{y,h}]}`；非法（份数>图高/高度≤0/段数>100）返回 null |
| `splitFileName(inputName, index, total, ext)` | **M40**：`{原名}_part{序号补零}.{ext}`（补零位 = max(2, 段数位数)）           |

**纵向**：`contentW = base`；每张 `scaleToWidth`；`contentH = Σh + gutter×(n-1)`。
**横向**：`contentH = base`；每张 `scaleToHeight`；`contentW = Σw + gutter×(n-1)`。
**网格**：`cell = floor((base - gutter×(cols-1)) / cols)`；`cell < 1` → null；每张 `fitInBox(cell, cell)` 居中；`rows = ceil(n/cols)`；`contentW = base`；`contentH = rows×cell + gutter×(rows-1)`。
**画布**：`width = contentW + padding×2`，`height = contentH + padding×2`。

---

## 5. IPC 契约（通道 `image-stitch:{action}`）

### 5.1 schema（`packages/tools/image-stitch/src/schema.ts`）

```ts
const layoutSchema = z.object({
  mode: z.enum(['vertical', 'horizontal', 'grid']),
  sizeMode: z.enum(['first', 'max', 'fixed']),
  fixedSize: z.number().int().min(100).max(10_000),
  columns: z.number().int().min(2).max(8),
  gutter: z.number().int().min(0).max(100),
  padding: z.number().int().min(0).max(100)
})

const stitchPayloadSchema = z.object({
  inputPaths: z.array(白名单 1..100),
  layout: layoutSchema,
  encoder: z.enum(['png', 'jpeg', 'webp']),
  quality: z.number().int().min(60).max(100),
  bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  outputDir: z.string().min(1).optional()
})

// M40 长图分割
const splitPayloadSchema = z.object({
  inputPath: z.string().min(1).regex(/\.(png|jpe?g|webp)$/i),
  mode: z.enum(['height', 'parts']),
  height: z.number().int().min(50).max(30_000),
  parts: z.number().int().min(2).max(50),
  quality: z.number().int().min(60).max(100),
  outputDir: z.string().min(1).optional()
})
```

### 5.2 主进程（`node.ts`）

- `config` → `{ outputDir }`（记忆值，缺省 `userData/image-stitch`）
- `set-output-dir` → 建目录并记忆；失败 `IS_OUTPUT_DIR_INVALID`
- `stitch` → 逐张预检（可读 / 独占 / ≤40MB）→ 解析输出目录 → `runTask`（600s、可取消）
- `split`（M40）→ 单张预检 → 解析输出目录 → `runTask`（split worker，600s、可取消）
- 预检错误分类：`ENOENT → IS_INPUT_INVALID`、占用 → `IS_FILE_LOCKED`、超限 → `IS_IMAGE_TOO_LARGE`

### 5.3 worker（`stitch.worker.ts`）

- 第一遍：`readFile → loadImage` 记录宽高（progress `measure`）
- `planLayout` → 非法 `IS_INPUT_INVALID`；超限 `IS_OUTPUT_TOO_LARGE`
- `createCanvas` 填充 `bgColor` → 第二遍逐张解码绘制（progress `draw`）
- `encode`（png 无损 / jpeg、webp q=quality）→ `.tmp` + `rename` 原子写；`uniqueFileName` 冲突递增
- done `{ outputPath, width, height, count }`

### 5.4 split worker（`split.worker.ts`，M40）

- `readFile → loadImage` 得源图宽高（progress `读取`）
- `planSplit` → 非法 `IS_SPLIT_INVALID`；单边 >30,000px 同样 `IS_SPLIT_INVALID`（源图异常）
- 逐段 `createCanvas(源宽, 段高)` + `drawImage(源, 0, -y)` → 按输入扩展名编码（png 无损 / jpeg、webp q=quality）→ `.tmp` + `rename` 原子写；progress `切分 i/n`
- 命名 `{原名}_part{序号}.{ext}`，`uniqueFileName` 冲突递增（逐段加入占用集合）
- done `{ outputs: [{ path, width, height }], sourceWidth, sourceHeight }`

---

## 6. 错误码表（`packages/tools/image-stitch/src/errors.ts`）

| 码                      | 文案                                     | 可重试 |
| ----------------------- | ---------------------------------------- | ------ |
| `IS_INVALID_PAYLOAD`    | 参数无效                                 | 否     |
| `IS_INPUT_INVALID`      | 图片不存在或不受支持                     | 否     |
| `IS_FILE_LOCKED`        | 图片被其他程序占用，请关闭后重试         | 是     |
| `IS_IMAGE_TOO_LARGE`    | 图片超过 40MB，请压缩后重试              | 否     |
| `IS_IMAGE_CORRUPT`      | 图片无法解码，可能已损坏                 | 是     |
| `IS_OUTPUT_TOO_LARGE`   | 拼接结果超出画布上限，请减少图片或尺寸   | 否     |
| `IS_SPLIT_INVALID`      | **M40** 切分参数非法（份数超过图高/段数>100/源图异常） | 否 |
| `IS_OUTPUT_DIR_INVALID` | 输出目录不可用或不可写                   | 是     |
| `IS_WRITE_FAILED`       | 写入失败，请检查磁盘空间与目录权限       | 是     |
| `IS_PROCESS_FAILED`     | 处理失败，请重试或查看详情               | 是     |
| `OP_TIMEOUT`            | 处理超时（10 分钟），已终止              | 是     |
| `CANCELLED`             | 已取消                                   | 否     |

---

## 7. 工程接线

- 工具包：`packages/tools/image-stitch`（`manifest.ts` + `renderer/` + `node.ts` + `stitch.worker.ts`）
- 壳注册五处：`tool-manifests.ts`、`main/tool-mains.ts`、`AppSidebar.vue` iconMap、`apps/desktop/package.json` devDeps、`electron.vite.config.ts` 别名
- 页面薄壳：`apps/desktop/src/renderer/src/tools/image-stitch.vue`
- 覆盖率阈值：`vitest.config.ts` 新增 `packages/tools/image-stitch/src/**/*.ts` 80%
- 壳 CSP：`img-src` 追加 `blob:`（DEV/PROD 同改），供 renderer 用 ObjectURL 生成缩略图/预览；其余安全基线不变

---

## 8. 性能与规范符合

- 工具页懒加载分包；chunk + 独占依赖 <200KB gzip
- worker 串行（两遍），单张图片内存不累计（第一遍只保留宽高）
- 100 张 4000×3000 拼接：画布 ≤1 亿像素时应在 10s 量级；超时上限 600s
- 图标只用 `@lucide/vue`；样式只走 Tailwind + tokens；无 `any`

---

## 9. 验收标准

1. 纵向/横向/网格三种模式产物尺寸与 `planLayout` 断言一致
2. 中文 + 空格路径可正常读取与输出
3. 原图不被改写（sha256 前后一致）；同名冲突 `(1)` 递增
4. 超大/损坏/占用/缺失图片分别命中对应错误码
5. 取消后无 `.tmp` 残留
6. 预览与正式出图布局一致（同一 `planLayout`）
7. 单测覆盖 contract / schema / errors / node / worker / client；本包 ≥80%
8. e2e 2/2；`pnpm gate` 全绿
9. **M40**：固定高度切分（200×900、高 300 → 3 段 200×300）与按份数切分（2 份 → 200×450 两段）尺寸断言一致；`{原名}_part01` 命名与冲突 `(1)` 递增；中文+空格路径可用；取消无 `.tmp` 残留

---

## 10. 风险与回滚

- 风险：超高长图触发画布上限 → 已用 `IS_OUTPUT_TOO_LARGE` 前置拦截，文案给出可操作建议
- 风险：100 张解码耗时 → 两遍串行 + 进度可见 + 可取消
- 回滚：删除工具包与壳注册 5 处即可，无数据迁移

---

## 11. 审批

- [x] 用户确认功能方向（2026-11-20，AskUserQuestion「图片拼接（推荐）」）
- [x] plan 决策总表 Q26 / §4.22 / 里程碑 M22 登记
- [x] 字段级清单（本文）先行
- [x] 实施完成（代码 + 单测 + e2e + 冒烟文档）
