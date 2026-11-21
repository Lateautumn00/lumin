# misc-toolbox 字段级功能清单（M43）

> 规范源：`AGENTS.md`（强制执行）。路线图：`.trae/documents/Lumin 功能清单差距审计与后续路线图.md` §M43。
> 分支 `feature/m43-misc-toolbox`（自 `feature/m41-fs-cleaner` 的 `50cf650` 切出）。
> **纯 renderer、零 IPC、零新增依赖**；不扩展壳能力。

---

## 0. 工具元信息

| 项 | 值 |
| --- | --- |
| id | `misc-toolbox` |
| name | 实用工具 |
| description | 子网/IP 计算器与秒表、倒计时、番茄钟 |
| icon | `timer`（`@lucide/vue` 的 `Timer`） |
| category | `misc` |
| order | 71 |
| version | `0.1.0` |

包名 `@lumin/tool-misc-toolbox`，目录 `packages/tools/misc-toolbox`，形态 `manifest.ts + renderer/`（**无 `node.ts`**，不注册任何主进程通道）。

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

## 2. 页签二：计时器（`timer`）

`NRadioGroup` 三选一：秒表 / 倒计时 / 番茄钟。切换模式时弹确认（运行中）或直接重置（未运行）。

### 2.1 秒表

- [开始]/[暂停]/[重置]/[计次]；显示 `mm:ss.cs`（>1h 显示 `h:mm:ss`）。
- 计次列表最多 20 条（新的在上），每条显示分段与累计。
- 计时基于 `performance.now()` 差值，`setInterval` 50ms 仅用于刷新显示。

### 2.2 倒计时

- 输入：时/分/秒三个 `NInputNumber`（0–99 / 0–59 / 0–59），默认 5 分钟；[开始]/[暂停]/[重置]。
- 结束：页面内 `NAlert` 提示「时间到」+ 用 `AudioContext` 短蜂鸣（无音频文件），并在 `document.title` 追加 `⏰`。
- 暂停后可继续；归零后按钮恢复为「开始」。

### 2.3 番茄钟

- 预设：专注 25 / 短休 5 / 长休 15（分钟），均可自定义。
- 流程：专注 → 短休，每完成 4 个专注后进入长休；自动进入下一阶段需用户点 [开始下一阶段]（默认不自动，避免误计时）。
- 显示：当前阶段、剩余时间、已完成专注数（第 N 个）、进度环（可用 `NProgress type="circle"`）。
- 按钮：[开始]/[暂停]/[跳过]（跳过当前阶段）/ [重置]（清空计数）。

### 规则

- 所有计时器在组件 `onUnmounted` 清理 interval 与 AudioContext。
- 计时的纯逻辑（`formatClock`、`nextPhase`、`splitLap`）放独立纯函数文件，便于单测。

---

## 3. 无 IPC 说明

工具不注册任何主进程通道；`tool-mains.ts` 不新增条目（该工具 `registerMain` 可省略）。清单仍按「新包 + 清单 1 行」注册。

---

## 4. 三态与 UI 约束

| 页签 | 空态 | 加载态 | 报错态 |
| --- | --- | --- | --- |
| IP 计算 | 引导「输入 CIDR，如 192.168.1.0/24」+ 预设按钮 | 无（同步计算） | 错误码 → 中文 + 明确原因，不弹窗 |
| 计时器 | 显示初始 `00:00.00` 与 [开始] | 无 | 无错误分支（输入越界由控件约束） |

- 样式只用 Tailwind + tokens；图标只用 `@lucide/vue`（如 `Play`/`Pause`/`RotateCcw`/`Flag`）。
- 不引入图表库；进度环用 Naive `NProgress`。

---

## 5. 测试与验收

### 单测（`packages/tools/misc-toolbox/src`）

- `ip.ts`：`parseCidr`/`computeSubnet` ≥22 例（/24、/31、/32、/0、/8、/30、掩码点数写法、主机位非 0、私有/回环判定、非法输入 6 类）。
- `clock.ts`：`formatClock`（含 >1h）、`formatDuration`、`nextPhase`（含第 4 轮进长休）、`splitLap` ≥12 例。
- `errors.ts` 与 schema：≥4 例。
- 包覆盖率 ≥80%（statements/branches/functions/lines）。

### e2e（`apps/desktop/e2e/misc-toolbox-smoke.spec.ts`）

1. 侧栏「实用工具」可进入，两页签均可见。
2. IP：输入 `192.168.1.10/24` → 结果含 `192.168.1.0`、`192.168.1.255`、`254`。
3. IP 错误：输入 `192.168.1.0/33` → `MT_CIDR_INVALID` 中文文案可见。
4. 秒表：[开始] 后等待 1.2s → 显示的数字不再是 `00:00.00`；[重置] 后回到 `00:00.00`。
5. 番茄钟：切换后显示 `25:00`；[开始] 后剩余时间递减。

### 门禁

`pnpm --filter @lumin/tool-misc-toolbox typecheck` → `pnpm exec vitest run packages/tools/misc-toolbox` → `pnpm --filter @lumin/desktop build`（记录 chunk raw/gzip）→ e2e（由主会话串行执行）。
