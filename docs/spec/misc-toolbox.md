# misc-toolbox 字段级功能清单（M43 首版 · M51 增屏幕标尺）

> 规范源：`AGENTS.md`（强制执行）。路线图：`.trae/documents/Lumin 功能清单差距审计与后续路线图.md` G1；方案 `docs/opencode/plan.md` §4.51。
> 分支 `feature/m51-screen-ruler`（自 `feature/m50-audio-convert` 切出）。
> IP / 计时器为**纯 renderer**；屏幕标尺新增**单通道 IPC**（`misc-toolbox:capture-display`），截屏能力复用 `@lumin/node-kit/screen.ts`。

---

## 0. 工具元信息

| 项 | 值 |
| --- | --- |
| id | `misc-toolbox` |
| name | 实用工具 |
| description | 子网/IP 计算器、屏幕标尺与秒表、倒计时、番茄钟 |
| icon | `timer`（`@lucide/vue` 的 `Timer`） |
| category | `misc` |
| order | 71 |
| version | `0.2.0` |

包名 `@lumin/tool-misc-toolbox`，目录 `packages/tools/misc-toolbox`，形态 `manifest.ts + renderer/ + node.ts`（node 仅注册屏幕标尺截屏通道）。

---

## 1. 页签一：子网 / IP 计算（`ip`）

### 输入

| 控件 | 说明 |
| --- | --- |
| CIDR 输入框 | `192.168.1.10/24` 或 `192.168.1.10/255.255.255.0`；回车或 [计算] 触发 |
| 预设按钮 | `10.0.0.0/8`、`172.16.0.0/12`、`192.168.1.0/24`、`0.0.0.0/0` |

### 输出（键值表）

网络地址、广播地址、子网掩码、反掩码（wildcard）、前缀长度、可用主机范围（首/末）、可用主机数、IP 类别（A/B/C/D/E）、是否私有、是否回环、掩码二进制。

### 规则

- 仅 IPv4；IPv6 输入 → `MT_CIDR_INVALID`（文案「暂只支持 IPv4」）。
- 主机位非 0 时允许（按掩码取网络地址），并在结果中提示「已按掩码归一化网络地址」。
- `/31` 可用主机数 2（点对点，首末均可用）、`/32` 可用主机数 1；`/0` 可用主机数 4294967294，不得溢出（用 `>>> 0` 与除法计算，禁止 `2**32` 直接减后溢出）。
- 非法输入（空、掩码非 0–32、段值越界、多余字符）→ `MT_CIDR_INVALID`，detail 指明哪一段越界。

### 错误码

| 错误码 | 触发 |
| --- | --- |
| `MT_CIDR_INVALID` | 格式非法 / IPv6 / 掩码越界 |

---

## 2. 页签二：屏幕标尺（`ruler`，M51 新增）

### 输入

| 控件 | 说明 |
| --- | --- |
| 名义 DPI | `NInputNumber`，48–600，默认 96；仅用于 cm / inch 名义换算 |
| [开始测量] | 调用 `captureDisplay` 截取当前（或所选）显示器，打开全屏预览层 |
| 显示器选择 | 截屏后若 `displays.length > 1` 显示 `NSelect`，切换即重新截屏 |
| [重新截屏] | 以当前显示器重新截取 |
| [关闭] / `Esc` | 退出预览层并清空选区 |
| [复制结果] | 四行文本写入剪贴板，成功 1.2s 内按钮显示「已复制」 |
| [清除选区] | 仅清空选区，保留截图 |

### 拖拽测量

- 在截图上 `pointerdown` 记起点，`pointermove` 实时更新终点，`pointerup` 固化；越界坐标夹紧到截图边缘。
- 选区以 SVG 覆盖层绘制（`viewBox = 截图原始像素`），描边 `vector-effect="non-scaling-stroke"`。
- 单击（宽高均为 0）不产生选区。

### 输出

| 项 | 说明 |
| --- | --- |
| 宽 / 高 | 截图原始物理像素（整数） |
| 对角线 | `round(hypot(w, h))` 物理像素 |
| cm / inch | `px / dpi × 2.54`、`px / dpi`，保留两位小数；宽高各一组，对角线各一组 |
| 逻辑尺寸 | `round(px / scaleFactor)`，并显示缩放百分比 |
| 复制文本 | `宽 … px / … cm / … in`、`高 …`、`对角线 …`、`逻辑尺寸 …` 四行 |

### 规则

- DPI 非法（空 / 越界 / 非有限数）→ `MT_RULER_INVALID`，且不显示测量值。
- 截屏失败（无显示器、空缩略图、底层异常、入参非法）→ `MT_CAPTURE_FAILED`，detail 保留原因。
- 剪贴板写入失败 → `MT_CLIPBOARD_FAILED`。
- 截屏为整屏合成画面，提示用户先移开/最小化 Lumin 窗口，避免遮挡目标区域。
- 截屏与坐标映射为公共实现：`@lumin/node-kit/screen.ts`、`@lumin/shared/geometry.ts`；`color-toolbox` 同源委托。

---

## 3. 页签三：计时器（`timer`）

`NRadioGroup` 三选一：秒表 / 倒计时 / 番茄钟。切换模式时弹确认（运行中）或直接重置（未运行）。

### 3.1 秒表

- [开始]/[暂停]/[重置]/[计次]；显示 `mm:ss.cs`（>1h 显示 `h:mm:ss`）。
- 计次列表最多 20 条（新的在上），每条显示分段与累计。
- 计时基于 `performance.now()` 差值，`setInterval` 50ms 仅用于刷新显示。

### 3.2 倒计时

- 输入：时/分/秒三个 `NInputNumber`（0–99 / 0–59 / 0–59），默认 5 分钟；[开始]/[暂停]/[重置]。
- 结束：页面内 `NAlert` 提示「时间到」+ 用 `AudioContext` 短蜂鸣（无音频文件），并在 `document.title` 追加 `⏰`。
- 暂停后可继续；归零后按钮恢复为「开始」。

### 3.3 番茄钟

- 预设：专注 25 / 短休 5 / 长休 15（分钟），均可自定义。
- 流程：专注 → 短休，每完成 4 个专注后进入长休；自动进入下一阶段需用户点 [开始下一阶段]（默认不自动，避免误计时）。
- 显示：当前阶段、剩余时间、已完成专注数（第 N 个）、进度环（可用 `NProgress type="circle"`）。
- 按钮：[开始]/[暂停]/[跳过]（跳过当前阶段）/ [重置]（清空计数）。

### 规则

- 所有计时器在组件 `onUnmounted` 清理 interval 与 AudioContext。
- 计时的纯逻辑（`formatClock`、`nextPhase`、`splitLap`）放独立纯函数文件，便于单测。

---

## 4. IPC 契约（屏幕标尺）

| 项 | 值 |
| --- | --- |
| 通道 | `misc-toolbox:capture-display` |
| 模式 | `invoke`（短任务） |
| 入参 | `{ displayId?: string }`（zod：非空串或省略） |
| 回包 | `{ displayId, displayName, width, height, scaleFactor, dataUrl(png dataURL), displays[] }` |
| 主进程 | `node.ts` → `@lumin/node-kit` `captureDisplay`；Electron 实例由 `createNodeDeps` 注入 |

---

## 5. 三态与 UI 约束

| 页签 | 空态 | 加载态 | 报错态 |
| --- | --- | --- | --- |
| IP 计算 | 引导「输入 CIDR，如 192.168.1.0/24」+ 预设按钮 | 无（同步计算） | 错误码 → 中文 + 明确原因，不弹窗 |
| 屏幕标尺 | 「尚未截屏」引导 + DPI + [开始测量] | [开始测量] loading，预览层内显示「重新截屏」loading | `MT_CAPTURE_FAILED` / `MT_RULER_INVALID` / `MT_CLIPBOARD_FAILED` → 中文 + 重试入口 |
| 计时器 | 显示初始 `00:00.00` 与 [开始] | 无 | 无错误分支（输入越界由控件约束） |

- 样式只用 Tailwind + tokens；图标只用 `@lucide/vue`（如 `Play`/`Pause`/`RotateCcw`/`Flag`/`Ruler`/`Copy`）。
- 不引入图表库；进度环用 Naive `NProgress`。

---

## 6. 测试与验收

### 单测（`packages/tools/misc-toolbox/src`）

- `ip.ts`：`parseCidr`/`computeSubnet` ≥22 例。
- `clock.ts`：`formatClock`（含 >1h）、`formatDuration`、`nextPhase`、`splitLap` ≥12 例。
- `ruler.ts`：DPI 边界、矩形归一化（反向/小数）、px→cm/inch、measureRect（完整换算/回退/零尺寸）、摘要 ≥12 例。
- `node.test.ts`：截屏成功、指定显示器、入参非法、无显示器、空缩略图、底层异常、createNodeDeps/registerMain ≥8 例。
- `errors.ts` 与 schema：新增三个错误码与截屏契约校验 ≥8 例。
- 包覆盖率 ≥80%（statements/branches/functions/lines）。

### e2e（`apps/desktop/e2e/misc-toolbox-smoke.spec.ts`）

1. 侧栏「实用工具」可进入，三页签均可见。
2. IP：输入 `192.168.1.10/24` → 结果含 `192.168.1.0`、`192.168.1.255`、`254`。
3. IP 错误：输入 `192.168.1.0/33` → `MT_CIDR_INVALID` 中文文案可见。
4. 秒表：[开始] 后等待 1.2s → 数字不再是 `00:00.00`；[重置] 后回到 `00:00.00`。
5. 番茄钟：切换后显示 `25:00`；[开始] 后剩余时间递减。
6. 屏幕标尺：[开始测量] → 预览层出现 → 拖拽 → 宽/高/对角线/逻辑尺寸可见 → `Esc` 关闭。

### 门禁

`pnpm --filter @lumin/tool-misc-toolbox typecheck` → `pnpm exec vitest run packages/tools/misc-toolbox` → `pnpm --filter @lumin/desktop build`（记录 chunk raw/gzip）→ e2e（由主会话串行执行）。

---

## M55 追加节（2026-11-22 R8 登记：plan Q56 / §4.55）

> 状态：待实施。原 spec「暂不支持 IPv6」解冻（Q56 拍板）；7z/RAR/加密/分卷等 zip 项与本节无关，维持冻结。

- **字段级清单（子网计算器增 IPv6）**
  1. 输入含 `:` 即分派 IPv6（如 `2001:db8::/32`、`fe80::1/64`、`::1/128`）；纯 IPv4 路径零回归（原「暂只支持 IPv4」分支移除）
  2. 支持 `::` 零段压缩与省略前导零；前缀 /0–/128；非法 → 沿用 `MT_CIDR_INVALID`（无新错误码）
  3. 输出项：网络地址（压缩形式）/ 前缀长度 / 广播（末地址）/ 首末可用地址 / **可用主机数 = `2^n`（BigInt 运算，一律字符串输出，如 `18446744073709551616` 或 `2^64` 展示为完整十进制字符串）** / 地址类型判定（回环 `::1` / 链路本地 `fe80::` / 唯一本地 `fc00::` / 组播 `ff00::` / 全局 / 未指定 `::`）
  4. /127、/128 边界：首末可用与网络/末地址一致（无「可用主机」概念退化说明文案）
  5. 复制结果沿用既有 TSV/文本复制
- **实现**：`ip.ts` 新增 `parseCidr6`/`computeSubnet6`（BigInt 128 位位运算），输入按 `:` 自动分派；纯函数、零 IPC
- **验收**：单测（`::` 压缩往返 /0 与 /128 边界 /64 主机数字符串 / 各地址类型判定 / 非法前缀与非法字符 / IPv4 回归）本包 ≥80%；e2e 新增「输入 `2001:db8::/32` → 网络地址与主机数可见」用例；R2 记入 `docs/smoke/misc-toolbox.md` M55 增量节；chunk <200KB gzip、零新增依赖
