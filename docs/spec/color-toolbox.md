# 颜色工具箱（color-toolbox）字段级功能清单

> 版本：v0.1.0 · 定稿日期：2026-11-20（R8；吸管取色为同日增补）· 工具 id：`color-toolbox` · 里程碑 M29
> 本文件为该里程碑验收附件；实现与本文件不一致时以本文件为准，变更须走 R8 流程。

## 1. 范围与边界

**做**：HEX / RGB / HSL 三种格式互转与实时校验、原生取色器与随机取色、**屏幕吸管取色（EyeDropper API，2026-11-20 增补）**、10 级色阶生成、四组调和色（互补 / 类似 / 三角 / 分裂互补）、前景/背景 WCAG 2.1 对比度计算与 AA/AAA 判定、各颜色值复制。

**不做**：从图片文件取色（读取图片像素）、CSS 颜色名称识别（CSS named colors）、色盲模拟、调色板文件导入导出（ASE/ACO）、历史记录持久化、联网能力。

**形态**：纯 renderer 工具，**零 IPC、零主进程代码、零新增第三方依赖**（仅复用 vue / naive-ui / @lucide/vue / @lumin/shared）。

## 2. 页面字段清单

单页（无页签），自上而下 5 个卡片；所有计算同步完成（<1ms），无任务队列。

### 2.1 主颜色卡片

| 区域     | 控件                           | 行为                                                                                                | 空/默认                  |
| -------- | ------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------ |
| 取色行   | 原生 `<input type="color">`    | 拖动/点选后立即生效（`input` 事件），同步 HEX 输入框与全部结果                                      | `#3B82F6`（蓝 500）      |
| 格式选择 | `NSelect`（HEX / RGB / HSL）   | 切换输入格式，并把当前主色按新格式回填输入框、清空错误                                              | HEX                      |
| 输入框   | `NInput`                       | 随格式变化 placeholder：`#3B82F6` / `rgb(59, 130, 246)` / `hsl(217, 91%, 60%)`；实时解析            | 当前主色 HEX             |
| 操作     | `[随机]`（`Dices` 图标）       | 生成随机 RGB 并同步全部结果                                                                         | 可点                     |
| 操作     | `[吸管取色]`（`Pipette` 图标） | 调用 `EyeDropper.open()` 在屏幕任意位置拾色（Esc 取消视为正常，不报错）；环境不支持时按钮禁用并提示 | 支持时可点               |
| 错误行   | `role="alert"` 文本 + 错误码   | 输入非空且解析失败 → `CT_INVALID_COLOR` 中文文案 + 码；主色保持不变                                 | 隐藏                     |
| 提示行   | 文本                           | 无错误时显示三种输入示例；吸管不可用时追加说明                                                      | 常显                     |
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

### 2.6 三态

| 状态   | 实现                                                                                                                                                           |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 空态   | 默认主色 `#3B82F6` + 示例色块 + 提示行，页面无白屏；不属于「无输入」页面，默认即出结果                                                                         |
| 加载态 | **不适用**：全部为同步纯函数计算（<1ms），无长任务、无进度/取消语义（与 text-toolbox §4 同口径）；吸管取色为系统模态交互，按钮自带 loading 态但无进度/取消概念 |
| 报错态 | 非法颜色 → `CT_INVALID_COLOR` 行内结构化提示（码 + 中文文案）；复制失败 → `CT_CLIPBOARD_FAILED`；吸管异常 → `CT_EYEDROPPER_FAILED`（Esc 取消不报错）           |

## 3. 纯函数契约（`src/color.ts` / `src/eyedropper.ts`，≥80% 覆盖）

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
| `getEyeDropper(source?)`          | 可选检测源      | 运行时探测 `EyeDropper` 构造器（`src/eyedropper.ts`）；缺失/非函数 → `null`        |
| `isEyedropperCancel(error)`       | 吸管异常        | `name === 'AbortError'` → `true`（用户 Esc 取消，不展示错误）                      |

常量：`DEFAULT_COLOR`（`{ r: 59, g: 130, b: 246 }`）、`COLOR_FORMATS`。

## 4. 错误码（`src/errors.ts`）

| 码                     | 中文文案                                  | 触发来源                              |
| ---------------------- | ----------------------------------------- | ------------------------------------- |
| `CT_INVALID_COLOR`     | 颜色格式不正确，请输入 HEX / RGB / HSL 值 | 输入框实时解析失败（detail 带格式名） |
| `CT_CLIPBOARD_FAILED`  | 复制失败，请手动选择文本复制              | 渲染层剪贴板写入失败                  |
| `CT_EYEDROPPER_FAILED` | 吸管取色失败，请重试或改用取色器          | `EyeDropper.open()` 非取消异常        |

## 5. 壳接线（固定 5 处）

1. `apps/desktop/electron.vite.config.ts`：`@lumin/tool-color-toolbox/manifest`、`/renderer/*` 两条别名（无 node 别名）。
2. `apps/desktop/package.json`：`"@lumin/tool-color-toolbox": "workspace:*"`。
3. `apps/desktop/src/tool-manifests.ts`：import + 数组末尾新增 1 行（`example` 之前）。
4. `apps/desktop/src/renderer/src/tools/color-toolbox.vue`：薄页面。
5. `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：iconMap 新增 `palette: Palette`。

清单：`id: color-toolbox`、`name: 颜色工具箱`、`icon: palette`、`category: misc`、`order: 80`、`version: 0.1.0`。

## 6. R5 体积口径

纯 renderer，无 worker / wasm / 模型 / 图片资产；仅复用共享 vendor（naive-ui / vue）。交付时以 `pnpm build` 产物实测 `color-toolbox-*.js` 的 raw/gzip 记录到 `docs/smoke/color-toolbox.md`，独占依赖 chunk 预期为 0，上限 200KB gzip。

## 7. 验收

- 本包单测（color / errors / manifest / eyedropper）通过，覆盖率 ≥80%（root `vitest.config.ts` 增加 `packages/tools/color-toolbox/src/**/*.ts` 阈值）。
- e2e `apps/desktop/e2e/color-toolbox-smoke.spec.ts` 3 用例：默认色三格式展示（含吸管按钮可见）、非法输入报错与恢复、示例色/色阶联动 + 对比度数值与徽标；吸管真实拾色依赖系统交互，列入 smoke 人工项。
- R2 八类映射记录于 `docs/smoke/color-toolbox.md`。
- `pnpm gate` / `pnpm coverage` / `pnpm build` 全绿。
