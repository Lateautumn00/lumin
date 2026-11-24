# 时间工具箱（time-toolbox）字段级功能清单

> 版本：v0.3.0 · 定稿日期：2026-11-21（R8）· 工具 id：`time-toolbox` · 里程碑 M30（M36 增日期差；M48 移除倒计时页签，统一由 misc-toolbox 计时器承担）
> 本文件为该里程碑验收附件；实现与本文件不一致时以本文件为准，变更须走 R8 流程。

## 1. 范围与边界

**做**：Unix 时间戳（秒/毫秒，自动识别 + 手动切换）与本地时间 / UTC / ISO 8601 互转；日期时间 → 时间戳反查；常用 IANA 时区当前时间与 UTC 偏移（含自定义时区校验）；两个日期时间的时长差（天/时/分/秒 + 总秒/总分/总时/总天）；两个本地日期的日历差（年/月/日 + 总天数）；5 字段 Cron 表达式（分 时 日 月 周）校验、中文描述与未来 5 次触发时间。

**不做**：农历/节假日、闹钟与提醒、时区换算的历史规则数据库（仅用运行时 `Intl` 数据）、Cron 反向生成、秒级 Cron（6/7 字段）、系统时区修改、历史记录持久化、联网；倒计时（M48 起统一由 misc-toolbox 计时器提供时长倒计时与蜂鸣提醒）。

**形态**：**纯 renderer、零 IPC、零主进程逻辑、零新增运行时第三方依赖**；仅复用 vue / naive-ui / `@lucide/vue` / `@lumin/shared`（`StructuredError` 与 `toStructuredError`）。所有计算为同步纯函数（<1ms），无任务队列。

## 2. 页面字段清单

单页 + 5 个页签（`NTabs` 仅作切换器，内容 `v-if` 渲染，标签走 `#tab` 插槽——与 text-toolbox 同范式）。

### 2.1 Tab1 时间戳转换

| 区域       | 控件                                     | 行为                                                                                        | 空/默认                      |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------- |
| 时间戳输入 | `NInput`                                 | 实时解析；接受 10 位秒、13 位毫秒、可选负号（1970 前）；非数字/空 → 空态不报错              | 挂载时填入当前毫秒时间戳     |
| 单位选择   | `NSelect`（自动 / 秒 / 毫秒）            | 自动：去符号后长度 ≤11 视为秒，>11 视为毫秒；手动：按所选单位解释                           | 自动                         |
| 结果卡片   | 4 行只读 + `[复制]`                      | 本地时间 `YYYY-MM-DD HH:mm:ss`、UTC 时间 `YYYY-MM-DD HH:mm:ss`、ISO 8601、UTC 偏移 `±HH:mm` | 随输入实时更新               |
| 错误行     | `role="alert"` 文案 + 错误码             | 非数字 → `TT_INVALID_INPUT`；超出 `Date` 可表示范围（±8.64e15ms）→ `TT_OUT_OF_RANGE`        | 隐藏                         |
| 反向转换   | `<input type="datetime-local" step="1">` | 选择本地日期时间 → 秒 / 毫秒时间戳两行，各带 `[复制]`                                       | 挂载时填当前本地时间（到秒） |
| 提示行     | 文本                                     | 说明自动识别规则与支持范围                                                                  | 常显                         |

### 2.2 Tab2 时区查看

| 区域       | 控件                                     | 行为                                                                                                                                                      |
| ---------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 时区列表   | 只读表格（时区名 / 当前日期时间 / 偏移） | 内置 8 个：`Asia/Shanghai`、`UTC`、`Asia/Tokyo`、`Europe/London`、`Europe/Paris`、`America/New_York`、`America/Los_Angeles`、`Australia/Sydney`；每秒刷新 |
| 自定义时区 | `NInput` + `[添加]`                      | 输入 IANA 名称（如 `Asia/Kolkata`），`Intl` 校验通过则追加到列表并去重；失败 → `TT_INVALID_INPUT` 行内提示                                                |
| 空态       | —                                        | 默认已有时区行与当前时间，无白屏                                                                                                                          |
| 清理       | —                                        | `onUnmounted` 清除 1s 定时器                                                                                                                              |

### 2.3 Tab3 时长计算

| 区域     | 控件                                          | 行为                                                                    |
| -------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| 起止时间 | 两个 `<input type="datetime-local" step="1">` | 默认为当前时间（取整到分钟）与 +1 小时；任一侧非法 → `TT_INVALID_INPUT` |
| 交换     | `[⇄]`（`ArrowLeftRight` 图标）                | 交换起止时间                                                            |
| 结果主行 | 大号文本                                      | `X 天 X 小时 X 分钟 X 秒`；结束早于开始时前置「−」并取绝对差            |
| 结果明细 | 4 行只读 + `[复制]`                           | 总秒数 / 总分钟 / 总小时 / 总天（保留 2 位小数）；相同起止 → 全 0       |

### 2.4 Tab4 Cron 解析

| 区域       | 控件                         | 行为                                                                                                                            |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 表达式输入 | `NInput`，placeholder 示例   | 实时解析 5 字段：分 0–59 / 时 0–23 / 日 1–31 / 月 1–12 / 周 0–7（0 与 7 均为周日）；支持 `*`、`a`、`a-b`、`a,b`、`*/n`、`a-b/n` |
| 预设       | 4 个快捷按钮                 | `*/5 * * * *`（每 5 分钟）、`0 9 * * 1-5`（工作日 9 点）、`0 0 1 * *`（每月 1 日 0 点）、`0 0 1 1 *`（每年 1 月 1 日）          |
| 中文描述   | 文本                         | 如「每 5 分钟」「每天 09:00」「每周一 09:00」「每月 1 日 00:00」「每年 1 月 1 日 00:00」                                        |
| 触发时间   | 列表（未来 5 次）            | 本地时区，从下一分钟起搜索，最多向后 60 天；找不到 → 结构化提示「60 天内无触发时间」+ `TT_OUT_OF_RANGE`                         |
| 错误行     | `role="alert"` 文案 + 错误码 | 字段数不为 5 / 非法字符 / 越界 / 区间倒置 → `TT_INVALID_INPUT`（detail 指明第几个字段）                                         |

### 2.5 Tab5 日期差

| 区域     | 控件                       | 行为                                                      |
| -------- | -------------------------- | --------------------------------------------------------- |
| 起止日期 | 两个 `<input type="date">` | 默认均为今天；任一侧非法/空 → `TT_INVALID_INPUT`          |
| 结果主行 | 大号文本                   | `X 年 X 个月 X 天`；结束早于开始时前置「−」               |
| 结果明细 | 只读行 + `[复制]`          | 总天数（按 UTC 日历日归一，避免夏令时 23/25 小时偏差）    |
| 借位规则 | 文本                       | 月末按「加月截断」：2026-01-31 → 2026-03-01 = 1 个月 1 天 |

### 2.6 三态

| 状态   | 实现                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| 空态   | 5 个 Tab 均有默认值（当前时间戳 / 内置时区 / 当前起止时间 / 今天日期 / `*/5 * * * *`），打开即出结果，无白屏 |
| 加载态 | **不适用**（全部同步纯函数 <1ms；时区仅为 1s 定时刷新）。按 text-toolbox 同口径在 spec 登记豁免                    |
| 报错态 | 每个 Tab 独立 `role="alert"` 行内结构化错误（错误码 + 中文文案），其余 Tab 与页面不阻塞；复制失败 → `TT_CLIPBOARD_FAILED`  |

## 3. 纯函数契约（`src/time.ts` / `src/cron.ts`，≥80% 覆盖）

### 3.1 `src/time.ts`

| 函数                                   | 入参 / 输出                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `detectTimestampUnit(raw)`             | 去符号后长度 ≤11 → `'seconds'`，否则 `'milliseconds'`                                                             |
| `parseTimestamp(input, mode)`          | `mode: 'auto' \| 'seconds' \| 'milliseconds'`；去空白、允许前导 `-`、仅整数；返回毫秒或 `null`（含范围校验）      |
| `parseLocalDateTime(input)`            | 接受 `YYYY-MM-DDTHH:mm[:ss]` / `YYYY-MM-DD HH:mm[:ss]`；按本地时区构造并用分量回读校验（拒绝 2026-02-30）；`null` |
| `parseLocalDate(input)`                | 接受 `YYYY-MM-DD`；按本地时区构造零点并用分量回读校验（拒绝 2026-02-30）；`null`                                  |
| `diffCalendar(startMs, endMs)`         | `{ negative, years, months, days, totalDays }`；结束早于开始自动交换；月末按加月截断借位                          |
| `formatDateTime(ms, timeZone='local')` | `YYYY-MM-DD HH:mm:ss`（24 小时制，`formatToParts` 组装，避免本地化差异）                                          |
| `formatIso(ms)`                        | `new Date(ms).toISOString()`                                                                                      |
| `formatOffset(ms, timeZone)`           | `+08:00` / `-04:00` / `+00:00`（`timeZoneName: 'longOffset'` 解析，`GMT` 归一为 `+00:00`）                        |
| `isValidTimeZone(timeZone)`            | `new Intl.DateTimeFormat('en-US', { timeZone })` 不抛错                                                           |
| `formatDuration(diffMs)`               | `{ negative, days, hours, minutes, seconds, totalSeconds, totalMinutes, totalHours, totalDays }`，绝对差分解      |
| `COMMON_TIME_ZONES`                    | 8 项 `{ id, label }` 常量，供 Tab2 初始列表                                                                       |

常量：`MIN_DATE_MS = -8640000000000000`、`MAX_DATE_MS = 8640000000000000`。

### 3.2 `src/cron.ts`

| 函数                                                | 行为                                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseCronField(field, min, max, normalizeDow?)`    | 支持 `*` / 数字 / `a-b` / `a,b` / `*/n` / `a-b/n`；周字段 7 → 0；越界、`a>b`、步长 ≤0 → `{ ok:false, message }`                                                     |
| `parseCron(expr)`                                   | 按空白切分必须 5 段，逐段解析 → `{ ok:true, value: ParsedCron }` 或 `{ ok:false, message }`                                                                         |
| `describeCron(parsed)`                              | 中文描述：先按「分/时」出频率句（每分钟 / 每 n 分钟 / 每小时第 m 分 / 每天 HH:mm / 每天 HH:mm, HH:mm），再按「日/月/周」叠加（每天 / 每周X / 每月X日 / 每年X月X日） |
| `nextCronRuns(parsed, fromMs, count=5, maxDays=60)` | 从下一整分钟起逐分钟匹配，最多 `maxDays*1440` 次；日与周同时受限时取「或」语义；返回毫秒数组（可能为空）                                                            |

`ParsedCron = { minutes, hours, daysOfMonth, months, daysOfWeek }`，字段形状 `{ values: ReadonlySet<number>, wildcard: boolean }`。

## 4. 错误码（`src/errors.ts`）

| 码                    | 中文文案                     | 触发来源                                                                  |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `TT_INVALID_INPUT`    | 输入格式不正确，请检查后重试 | 时间戳非数字、日期时间非法、时区名非法、Cron 语法/越界（detail 带字段位） |
| `TT_OUT_OF_RANGE`     | 数值超出可表示范围           | 时间戳超出 `Date` 范围；Cron 60 天内无触发时间                            |
| `TT_CLIPBOARD_FAILED` | 复制失败，请手动选择文本复制 | 渲染层剪贴板写入失败                                                      |

## 5. 壳接线（固定 6 处，无 node.ts）

1. `apps/desktop/electron.vite.config.ts`：`@lumin/tool-time-toolbox/manifest`、`/renderer/*` 两条别名。
2. `apps/desktop/package.json`：`"@lumin/tool-time-toolbox": "workspace:*"`（devDependencies，按字母序）。
3. `apps/desktop/src/tool-manifests.ts`：import + 数组 `exampleManifest` 之前新增 1 行。
4. `apps/desktop/src/renderer/src/tools/time-toolbox.vue`：薄页面转发 `ToolView.vue`。
5. `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：iconMap 新增 `clock: Clock`。
6. 根 `vitest.config.ts`：新增 `packages/tools/time-toolbox/src/**/*.ts` 80% 阈值。

清单：`id: time-toolbox`、`name: 时间工具箱`、`description`、`icon: clock`、`category: compute`、`order: 70`、`version: 0.2.0`。

## 6. R5 体积口径

无 worker / wasm / 模型 / 图片 / 字体资产；仅共享 vendor（vue / naive-ui / @lucide/vue）。交付时以 `pnpm build` 产物实测 `time-toolbox-*.js` 的 raw/gzip 记入 `docs/smoke/time-toolbox.md`；独占依赖 chunk 预期为 0，上限 200KB gzip。

## 7. 验收

- 单测：`time.test.ts`（时间戳识别/解析边界、日期时间与纯日期校验、格式化、偏移、时长分解、日历差借位）、`cron.test.ts`（字段语法/边界、日与周「或」语义、描述、next runs 含无解）、`errors.test.ts`、`manifest.test.ts`；本包覆盖率 ≥80%。
- M36 增补：`parseLocalDate` 非法日期、`diffCalendar` 同日/跨月/跨年/闰年/月末借位/反向。
- M48：移除 `countdownTo` 及其 3 例单测、倒计时页签与 `Countdown` 类型（去重决策见 plan Q48）。
- e2e `apps/desktop/e2e/time-toolbox-smoke.spec.ts` 3 用例：
  1. 页面加载 → 5 页签可见 → 默认时间戳得到 ISO/UTC/偏移结果；
  2. 输入 `1700000000` → ISO `2023-11-14T22:13:20.000Z`、UTC `2023-11-14 22:13:20`；输入 `abc` → `TT_INVALID_INPUT` 并恢复；
  3. Cron 页签：默认 `*/5 * * * *` → 描述「每 5 分钟」+ 5 条触发时间；输入 `99 * * * *` → `TT_INVALID_INPUT` 并恢复。
- R2 八类映射记录于 `docs/smoke/time-toolbox.md`。
- `pnpm gate` / `pnpm coverage` / `pnpm build` / e2e 全绿。

---

## M55 追加节（2026-11-22 R8 登记：plan Q56 / §4.55）

> 状态：已实施（2026-11-22）。原 spec 冻结项「Cron 反向生成」解冻（Q56 拍板）。

- **字段级清单（Cron 页签「反向生成」子区）**
  1. 五组勾选矩阵：分钟（0–59，含「每 N 分钟」「整点」「工作时段」快捷组）/ 小时（0–23）/ 日（1–31）/ 月（1–12 中文名）/ 周（周一–周日）
  2. 快捷预设：每 5 分钟、每小时、每天 9 点、每周一 9 点、每月 1 日 —— 点击回填勾选状态
  3. 「生成」按钮 → `buildCron(selection)` → 表达式回填既有解析框并自动触发 `parseCron` 联动（描述 + 未来 5 次触发即时刷新）
  4. 空勾选 → 不可生成（按钮禁用态）；生成结果可一键复制
- **实现**：纯函数 `buildCron`（五字段选择 → cron 表达式），与既有 `parseCron`/`describeCron` 构成往返；零 IPC、纯 renderer
- **验收**：往返单测（`parseCron(buildCron(x))` 字段语义等价、各快捷预设、空选/全选边界）本包 ≥80%；e2e 新增「勾选每 5 分钟 → 生成 → 解析联动」用例；R2 记入 `docs/smoke/time-toolbox.md` M55 增量节；chunk <200KB gzip、零新增依赖

## M60 扩展（速赢档一 · Q62/M60，2026-11-23 登记）：日期计算器

- **子模式**（`NRadioGroup`：间隔 / 加减）。
- **间隔**：起/止日期（`NDatePicker type=date`，默认今/明）；含头含尾开关（默认关，开启则天数 +1）；输出卡 = 总天数、自然周数（天数 ÷7 保留 1 位）、**工作日天数（仅跳过周六日口径，法定节假日调休列为后续候选，界面注明）**、起止星期；止早于起 → 取绝对值并标「（绝对值）」。
- **加减**：基准日期（默认今天）+ `NInputNumber` 数量（整数 |N| ≤ 36500）+ 单位单选（天/周/月/年）；输出 = 结果日期 `YYYY-MM-DD` + 星期X；月/年按日历进位、日溢出钳制月末（1/31 + 1 月 → 2/28，闰年 → 2/29）；N=0 → 原日期。
- **分支**：非法日期/越界 → `TT_INVALID_INPUT` 中文文案 + 恢复上一有效值。
- **实现**：纯函数 `calcInterval(start, end, inclusive)`、`addDays(base, n, unit)`，零 IPC、零依赖。
- **验收**：单测锚点（跨年总天数、含头含尾、跨年周末计数、2024-01-31+1 月=2024-02-29、2023-01-31+1 月=2023-02-28、负数、周单位、时区无关以 UTC 正午构造）本包 ≥80%；e2e ≥1 用例；R2 记入 `docs/smoke/time-toolbox.md` M60 增量节；chunk <200KB gzip。
