# 颜色工具箱（color-toolbox）字段级功能清单

> 版本：v0.1.0 · 定稿日期：2026-11-20（R8；吸管取色为同日增补，改为整屏截图取色）· 工具 id：`color-toolbox` · 里程碑 M29
> 本文件为该里程碑验收附件；实现与本文件不一致时以本文件为准，变更须走 R8 流程。

## 1. 范围与边界

**做**：HEX / RGB / HSL 三种格式互转与实时校验、原生取色器与随机取色、**屏幕吸管取色（整屏截图 + 应用内预览点选，2026-11-20 增补）**、**图片调色板（本地选图 → canvas 采样 → 主色与占比，2026-11-21 增补）**、10 级色阶生成、四组调和色（互补 / 类似 / 三角 / 分裂互补）、前景/背景 WCAG 2.1 对比度计算与 AA/AAA 判定、各颜色值复制。

**不做**：CSS 颜色名称识别（CSS named colors）、色盲模拟、调色板文件导入导出（ASE/ACO）、历史记录持久化、联网能力。

**形态**：renderer + 主进程 `node.ts`（单通道 `color-toolbox:capture-display`，`desktopCapturer` 截屏）；**图片调色板完全在 renderer 内用 canvas 解析，不新增 IPC 通道**；仅复用 vue / naive-ui / @lucide/vue / @lumin/shared / zod 与 Electron 内置模块，**零新增运行时第三方依赖**（`electron` 仅作类型 devDependency）。

## 2. 页面字段清单

单页（无页签），自上而下 6 个卡片；所有计算同步完成（<1ms，图片解码除外），无任务队列。

### 2.1 主颜色卡片

| 区域     | 控件                           | 行为                                                                                                | 空/默认                  |
| -------- | ------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------ |
| 取色行   | 原生 `<input type="color">`    | 拖动/点选后立即生效（`input` 事件），同步 HEX 输入框与全部结果                                      | `#3B82F6`（蓝 500）      |
| 格式选择 | `NSelect`（HEX / RGB / HSL）   | 切换输入格式，并把当前主色按新格式回填输入框、清空错误                                              | HEX                      |
| 输入框   | `NInput`                       | 随格式变化 placeholder：`#3B82F6` / `rgb(59, 130, 246)` / `hsl(217, 91%, 60%)`；实时解析            | 当前主色 HEX             |
| 操作     | `[随机]`（`Dices` 图标）       | 生成随机 RGB 并同步全部结果                                                                         | 可点                     |
| 操作     | `[吸管取色]`（`Pipette` 图标） | 主进程截取当前显示器 → 应用内全屏预览层，点击任意位置取色（**支持应用窗口外**）；Esc 或取消按钮关闭；多显示器可下拉切换 | 可点                     |
| 错误行   | `role="alert"` 文本 + 错误码   | 输入非空且解析失败 → `CT_INVALID_COLOR` 中文文案 + 码；主色保持不变                                 | 隐藏                     |
| 提示行   | 文本                           | 无错误时显示三种输入示例 + 吸管取色说明                                                             | 常显                     |
| 示例色   | 5 个圆形色块按钮               | `#3B82F6` 蓝 / `#EF4444` 红 / `#22C55E` 绿 / `#F59E0B` 橙 / `#8B5CF6` 紫；点击设为主色              | 常显（空态引导与主操作） |

### 2.2 颜色值卡片（只读三行）

| 行  | 内容                           | 操作                               |
| --- | ------------------------------ | ---------------------------------- |
| HEX | `#RRGGBB`（大写）              | `[复制]`，成功后按钮文案「已复制」 |
| RGB | `rgb(r, g, b)`                 | 同上                               |
| HSL | `hsl(h, s%, l%)`（h/s/l 取整） | 同上                               |

剪贴板失败 → 卡片内 `CT_CLIPBOARD_FAILED` 中文提示（不阻塞其它操作）。

### 2.3 色阶卡片

- 基于主色生成 **10 个色块**：5 个浅色（与白色按 90/72/54/36/18% 混合）→ 主色 → 4 个深色（与黑色按 18/36/54/72% 混合）。
- 每块显示颜色 + HEX 小字；点击色块 → 设为主色（联动全部结果）。
- `[复制整组]` → 复制 `#A, #B, …`（10 个 HEX，逗号分隔）。

### 2.4 配色方案卡片

| 方案     | 色数 | 构成                    |
| -------- | ---- | ----------------------- |
| 互补色   | 2    | 主色 + 色相 +180°       |
| 类似色   | 3    | 色相 −30° + 主色 + +30° |
| 三角配色 | 3    | 主色 + +120° + +240°    |
| 分裂互补 | 3    | 主色 + +150° + +210°    |

每张方案卡展示色块行 + HEX 列表；点击任一色块 → 设为主色。

### 2.5 对比度卡片

| 区域     | 控件                                   | 行为                                                                                         |
| -------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| 背景色   | 原生 `<input type="color">` + HEX 文本 | 默认 `#FFFFFF`；改动实时重算                                                                 |
| 交换     | `[⇄]`（`ArrowLeftRight` 图标）         | 主色 ↔ 背景色互换（主色同步输入框格式）                                                      |
| 对比度   | 大号数值 `X.XX : 1`                    | WCAG 2.1 相对亮度公式，保留 2 位小数                                                         |
| 判定徽标 | 4 枚                                   | 正文 AA（≥4.5）/ 正文 AAA（≥7）/ 大字 AA（≥3）/ 大字 AAA（≥4.5），通过=success、未通过=error |
| 预览区   | 背景色底 + 主色文字的示例段落          | 含普通字号与大字两行，直观验证                                                               |

### 2.6 图片调色板卡片（2026-11-21 增补）

| 区域     | 控件                                                                | 行为                                                                                                                        |
| -------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 选图     | `[选择图片]` / `[换一张]`（`Image` 图标）→ 隐藏 `<input type="file" accept="image/*">` | 本地 `createImageBitmap` 解码 → canvas 下采样（最长边 ≤480px）→ 读取 RGBA 像素；单张 ≤20MB；非图片/超大/解码失败 → `CT_PALETTE_FAILED` |
| 预览     | 图片缩略图（max-h-40）+ 文件名 + 参与统计像素数                     | 选图成功后展示；换图或卸载时 `URL.revokeObjectURL` 释放旧预览                                                               |
| 色板     | 最多 8 个色块（2 列 / 4 列网格），每块下 `#RRGGBB` + 占比            | 按占比降序；点击色块 → 设为主色（联动颜色值/色阶/配色方案/对比度）                                                          |
| 复制     | `[复制整组]`                                                        | 复制 `#A, #B, …`（与色阶同款，成功后按钮文案「已复制」）；剪贴板失败 → `CT_CLIPBOARD_FAILED`                              |
| 空态     | 说明行                                                              | 未选图时显示支持格式、≤20MB、仅本地解析不上传                                                                               |
| 结果为空 | 提示文本                                                            | 图片全透明、无可统计像素时提示换图（非错误码，不算报错态）                                                                  |
| 报错     | `role="alert"` 文本 + 错误码                                        | `CT_PALETTE_FAILED` 中文文案 + 码；已展示的旧结果保留，可继续换图                                                           |

### 2.7 三态

| 状态   | 实现                                                                                                                                                           |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 空态   | 默认主色 `#3B82F6` + 示例色块 + 提示行，页面无白屏；不属于「无输入」页面，默认即出结果；图片调色板未选图时显示格式/体积/本地解析说明                            |
| 加载态 | 主体计算**不适用**（同步纯函数 <1ms）；吸管取色截屏走 IPC，按钮 loading + 预览层内显示器切换禁用，无进度/取消语义（Esc 即时关闭）；图片解码/采样期间 `[选择图片]` 按钮 loading 且不可重入 |
| 报错态 | 非法颜色 → `CT_INVALID_COLOR` 行内结构化提示（码 + 中文文案）；复制失败 → `CT_CLIPBOARD_FAILED`；截屏失败 → `CT_CAPTURE_FAILED`，Esc 取消不报错；图片解析失败 → `CT_PALETTE_FAILED` |

## 3. 纯函数契约（`src/color.ts` / `src/palette.ts` / `src/picker.ts` / `src/schema.ts`，≥80% 覆盖）

| 函数                              | 入参            | 输出 / 行为                                                                        |
| --------------------------------- | --------------- | ---------------------------------------------------------------------------------- |
| `parseHex(text)`                  | 字符串          | 接受 `#RGB`/`#RRGGBB`（`#` 可省、大小写不敏感）→ `Rgb`；否则 `null`                |
| `parseRgb(text)`                  | 字符串          | 接受 `rgb(r, g, b)` 或裸 `r, g, b`（逗号/空白分隔）→ `Rgb`；分量越界/非数 → `null` |
| `parseHsl(text)`                  | 字符串          | 接受 `hsl(h, s%, l%)` 或裸值（s/l 的 `%` 可省）→ `Hsl`；h 取模 360；非法 → `null`  |
| `parseColor(text, format)`        | 字符串 + 格式   | 按格式分派；HSL 输入经 `hslToRgb` 归一为 `Rgb`；失败 `null`                        |
| `rgbToHex(rgb)`                   | `Rgb`           | `#RRGGBB` 大写；分量先 clamp 到 0–255 并取整                                       |
| `formatColor(rgb, format)`        | `Rgb` + 格式    | `#RRGGBB` / `rgb(r, g, b)` / `hsl(h, s%, l%)`（HSL 取整）                          |
| `rgbToHsl(rgb)` / `hslToRgb(hsl)` | 颜色            | 标准 HSL 互转；内部保留精度，展示时取整；h 归一 [0,360)                            |
| `relativeLuminance(rgb)`          | `Rgb`           | WCAG 2.1：分量 sRGB 线性化后按 0.2126/0.7152/0.0722 加权                           |
| `contrastRatio(a, b)`             | 两个 `Rgb`      | `(L亮+0.05)/(L暗+0.05)`，保留 2 位小数；同色 = 1                                   |
| `wcagVerdict(ratio, largeText)`   | 比值 + 是否大字 | `'AAA'` / `'AA'` / `'FAIL'`（大字阈值 4.5/3，正文 7/4.5）                          |
| `mix(base, target, weight)`       | 两色 + 0–1 权重 | 线性混合，权重越界自动 clamp                                                       |
| `generateScale(base)`             | `Rgb`           | 固定 10 色：5 浅 + 主色 + 4 深（权重见 §2.3）                                      |
| `rotateHue(rgb, degrees)`         | `Rgb` + 角度    | 仅旋转 HSL 色相，s/l 不变                                                          |
| `harmonies(base)`                 | `Rgb`           | 四组方案数组（`id/name/colors`），顺序与 §2.4 一致                                 |
| `randomColor(random?)`            | 可选随机源      | 三分量 `floor(random()*256)`（clamp 255）；注入随机源便于单测                      |
| `extractPalette(pixels, options?)` | RGBA `Uint8ClampedArray` + `{ maxColors?: 1–32, alphaThreshold?: 0–255 }` | 每通道取高 4 位量化为 4096 桶后聚合；返回 `{ colors, totalPixels }`，`colors` 含 `rgb/hex/count/percent`（percent 保留 1 位小数），按占比降序、同占比按桶升序（可复现）；alpha < 阈值（默认 128）忽略（`src/palette.ts`） |
| `paletteText(colors)`             | 调色板颜色数组  | 拼成 `#A, #B, …` 逗号分隔文本（`src/palette.ts`）                                   |
| `mapPointToPixel(point, rect, size)` | 点击坐标 + 图片矩形 + 截图像素尺寸 | 按比例换算原始像素坐标；越界/无效矩形 → `null`（`src/picker.ts`）        |
| `selectDisplay(displays, requestedId, currentId)` | 显示器列表 + 请求 id + 当前 id | 请求命中 → 当前窗口所在 → 首个；空列表 → `null`（`src/node.ts`） |
| `captureDisplayPayloadSchema` / `captureDisplayResultSchema` | zod | 入参 `{ displayId?: string }`；回包 `{ displayId, displayName, width, height, dataUrl, displays[] }`，dataUrl 必须 `data:image/png;base64,` 前缀（`src/schema.ts`） |

常量：`DEFAULT_COLOR`（`{ r: 59, g: 130, b: 246 }`）、`COLOR_FORMATS`、`DEFAULT_MAX_PALETTE_COLORS`（8）、`DEFAULT_ALPHA_THRESHOLD`（128）。

## 4. 错误码（`src/errors.ts`）

| 码                    | 中文文案                                  | 触发来源                                       |
| --------------------- | ----------------------------------------- | ---------------------------------------------- |
| `CT_INVALID_COLOR`    | 颜色格式不正确，请输入 HEX / RGB / HSL 值 | 输入框实时解析失败（detail 带格式名）          |
| `CT_CLIPBOARD_FAILED` | 复制失败，请手动选择文本复制              | 渲染层剪贴板写入失败                           |
| `CT_CAPTURE_FAILED`   | 屏幕取色失败，请重试                      | 截屏通道 zod 校验失败 / 无显示器 / 截图异常    |
| `CT_PALETTE_FAILED`   | 图片解析失败，请换一张图片重试            | 非图片文件 / 超过 20MB / 解码或 canvas 取样失败 |

## 5. 壳接线（固定 6 处）

1. `apps/desktop/electron.vite.config.ts`：`@lumin/tool-color-toolbox/manifest`、`/node`、`/renderer/*` 三条别名。
2. `apps/desktop/package.json`：`"@lumin/tool-color-toolbox": "workspace:*"`。
3. `apps/desktop/src/main/tool-mains.ts`：import `colorToolboxRegisterMain` 并映射 `'color-toolbox'`。
4. `apps/desktop/src/tool-manifests.ts`：import + 数组末尾新增 1 行（`example` 之前）。
5. `apps/desktop/src/renderer/src/tools/color-toolbox.vue`：薄页面。
6. `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：iconMap 新增 `palette: Palette`。

清单：`id: color-toolbox`、`name: 颜色工具箱`、`icon: palette`、`category: misc`、`order: 80`、`version: 0.2.0`（M55 色觉模拟升级）。

## 6. R5 体积口径

无 worker / wasm / 模型 / 图片资产（图片调色板在 renderer 用 canvas 采样，不随包内置图片）；仅复用共享 vendor（naive-ui / vue）。交付时以 `pnpm build` 产物实测 `color-toolbox-*.js` 的 raw/gzip 记录到 `docs/smoke/color-toolbox.md`，独占依赖 chunk 预期为 0，上限 200KB gzip。

## 7. 验收

- 本包单测（color / palette / errors / manifest / picker / schema / node / client）通过，覆盖率 ≥80%（root `vitest.config.ts` 增加 `packages/tools/color-toolbox/src/**/*.ts` 阈值）。
- e2e `apps/desktop/e2e/color-toolbox-smoke.spec.ts` 基础 5 用例：默认色三格式展示、非法输入报错与恢复、示例色/色阶联动 + 对比度数值与徽标、图片调色板选图统计与色块联动、非图片文件 `CT_PALETTE_FAILED`；第 1 用例覆盖吸管：点击 → 预览层提示可见 → Esc 关闭；M55 增 1 条色觉模拟用例（共 6 条）。
- 图片调色板断言：2×2 半红半蓝 PNG → 出现 `调色板 #FF0000` / `调色板 #0000FF` 且占比 50%；点击 `#FF0000` 后颜色值卡片显示 `rgb(255, 0, 0)`。
- R2 八类映射记录于 `docs/smoke/color-toolbox.md`。
- `pnpm gate` / `pnpm coverage` / `pnpm build` 全绿。

---

## M55 追加节（2026-11-22 R8 登记：plan Q56 / §4.55）

> 状态：已实施（2026-11-22）。原 spec 冻结项「色盲模拟」解冻（Q56 拍板）。

- **字段级清单（色盲模拟）**
  1. 新增「色觉缺陷模拟」下拉：正常（默认）/ 红色弱（protanomaly）/ 红色盲（protanopia）/ 绿色弱（deuteranomaly）/ 绿色盲（deuteranopia）/ 蓝黄色弱（tritanomaly）/ 蓝黄色盲（tritanopia）/ 全色盲（achromatopsia）/ 全色弱（achromatomaly），共 8 类缺陷 + 正常
  2. 作用域：主色对比卡、配色列表叠加显示（切换即变、点「还原」恢复）；对比度数值与 AA/AAA 徽标同步按模拟后颜色计算
  3. 附「本页颜色在该缺陷下的近似色值」提示（HEX/RGB/HSL 模拟值）；点击色块设为主色仍使用原始颜色
  4. 纯 canvas 3×3 矩阵变换，零 IPC、零新增依赖；无新错误码
- **实现**：新增 `vision.ts`——8 组 Viénot/Brettel/Machado 仿真矩阵常量（UPPER_SNAKE 命名）+ `simulateColor(rgb, id)` 纯函数（sRGB → 线性 → 矩阵 → sRGB 回转，输出取整并钳制 0–255）；`ToolView.vue` 用原生 `<select aria-label="色觉缺陷模拟">` 切换，`simulatedMain/simulatedSchemes/simulatedValues/contrast` 统一走模拟色
- **验收**：`vision.test.ts` 6 用例（8 类清单、黑/白/中性灰不变量、8 类红色回归向量、全色盲通道相等、越界钳制与入参不变、重复调用稳定）本包 ≥80%；e2e 新增「红色盲 → 主色 `#FF0000` 模拟 `#6D5F00` + 对比度 `6.39 : 1` → 还原」；R2 记入 `docs/smoke/color-toolbox.md` M55 增量节；chunk <200KB gzip
