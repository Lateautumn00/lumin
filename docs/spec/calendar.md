# 日历（calendar）字段级功能清单

> 版本：v0.1.0 · 定稿日期：2026-11-23（R8）· 工具 id：`calendar` · 里程碑 M57
> 本文件为该里程碑验收附件；实现与本文件不一致时以本文件为准，变更须走 R8 流程。

## 1. 范围与边界

**做**：月历展示（公历 + 农历 + 节气 + 法定节假日/调休标记）；日详情（公历/农历/星期/干支/生肖/星座/节日）；黄历（宜忌、建除、值神、冲煞、吉神/凶煞）；用户纪念日（公历 + 农历两种每年重复，含倒数日与 N 周年）；法定节假日查询（2023–2027 本地数据 + 库兜底）。

**不做**：日程/提醒/通知、宜忌择时指导性解读、万年历联网数据、公历转农历手动输入反查、节假日调休政策更新推送、多用户/多设备同步、IPC 与主进程逻辑。

**形态**：**纯 renderer、零 IPC、零主进程逻辑**；新增唯一运行时依赖 `lunar-javascript@1.7.8`（MIT，零传递依赖，动态 import 分包）。复用 vue / naive-ui / `@lucide/vue` / `@lumin/shared`（`StructuredError`）。

## 2. 页面字段清单

单页两栏：左侧月格（`flex-1`）+ 右侧当日详情（`xl:w-84`；`xl` 以下与 720×520 窗口换行到月格下方，整列 `overflow-y-auto`）。

### 2.1 头部

| 控件                                | 行为                                                   | 空/默认  |
| ----------------------------------- | ------------------------------------------------------ | -------- |
| `[‹]` `[›]`（aria-label 上月/下月） | 切换展示月份，年月标题同步变化；跨年 12→1 年份自动进退 | 当月     |
| 年月标题（h2，如 `2026 年 11 月`）  | 随视图月份更新                                         | 当前年月 |
| `[今天]`                            | 视图与选中日同时复位到今天                             | —        |
| `[纪念日管理]`（`Plus` 图标）       | 打开 `AnniversaryModal`                                | —        |

### 2.2 月格（MonthGrid.vue）

| 区域     | 结构                                                                         | 行为                                                                                                 |
| -------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 星期头   | 7 列，周一 → 周日（`一 二 三 四 五 六 日`）                                  | 常显                                                                                                 |
| 日期格   | `grid grid-cols-7` 恒 **42 格**（6 行 ×7 列），`button role="gridcell"`      | `aria-label=YYYY-MM-DD`；点击选中该日 → 右侧详情更新；非当月日期视觉弱化但仍可点击（选中后视图跟随） |
| 格内首行 | 公历日数字；今天高亮（primary 底色）；选中态描边                             | —                                                                                                    |
| 格内次行 | 节气（primary 色，优先）/ 节日（danger 色）/ 农历（默认色，`初一` 显示月名） | 节气与节日互斥展示，均无才显示农历                                                                   |
| 标记点   | 4 类 6px 圆点，位于格底部                                                    | 放假红点 / 调休橙点（`holiday.off=false`）/ 法定节日黄点 / 纪念日蓝点（`flags[index]`）              |

### 2.3 当日详情（DayDetail.vue，`<section aria-label="当日详情">`）

| 区域   | 内容                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| 标题   | 公历日期 + 星期（如 `2026-11-23 星期一`）                                                                         |
| 信息表 | `<dl>`：公历 / 农历（如 `丙午年十月初四`）/ 星期 / 干支（年月日三柱）/ 生肖 / 星座；节日行（无节日不渲染该行）    |
| 节假日 | 有则显示名称 badge：放假（success）/ 调休上班（warning，文案「调休上班」）；无则不渲染                            |
| 黄历   | 「宜」`NTag success` 列表 / 「忌」`NTag error` 列表；建除 · 值神 · 冲煞 · 节气行；吉神（success）/ 凶煞（danger） |
| 纪念日 | 当日命中的纪念日列表：名称 + 倒数文案（`今天` / `今天 · N 周年` / `还有 N 天`）；无 → 「这一天没有纪念日」        |

### 2.4 纪念日管理（AnniversaryModal.vue，`NModal preset="card"`）

| 区域      | 控件                                                                  | 行为                                                                             |
| --------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 列表      | `ul aria-label="纪念日列表"`；每项名称 + 类型 badge + 倒数 + `[删除]` | 删除即刻生效并刷新月格标记点                                                     |
| 空态      | `NEmpty`（引导文案）+ 「在下方添加」内联按钮                          | 点击聚焦表单（`scrollIntoView`）                                                 |
| 名称      | `NInput`，placeholder `名称，如：结婚纪念日`                          | 必填（去空白后非空），否则行内提示「请输入名称」                                 |
| 类型      | `NRadio`：公历 / 农历                                                 | 默认公历                                                                         |
| 月份/日期 | `NInputNumber`（aria-label 月份/日期），范围 1–12 / 1–31              | 校验：4/31、2/30、6/31 等非法日期拒绝；农历日 >30 拒绝（`validate()`）           |
| 起始年    | `NInputNumber` 可选，1900–2100                                        | 用于「N 周年」文案；不填则只显示「还有 N 天」/「今天」                           |
| 闰月      | `NSwitch`（仅农历类型可见）                                           | `leap=true` 表示农历闰月生日；目标年无闰月 → 降级（见 §3.3）                     |
| 提交      | `[添加]`                                                              | 生成 `id`（`crypto.randomUUID()`）追加并 `saveAnniversaries`；成功关闭表单并提示 |

### 2.5 三态（R4）

| 状态   | 实现                                                                                                                                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 空态   | 纪念日列表为空 → `NEmpty` + 引导 + 主操作按钮；月格打开即有数据无白屏                                                                                                                                                |
| 加载态 | `Promise.all([import('../lunar'), import('../anniversaries'), import('../holidays')])` 期间 `NSpin` 覆盖；**动态分包属瞬时加载（<100ms 级），无可取消长任务，按 time-toolbox 同口径豁免「可取消」**；失败可 `[重试]` |
| 报错态 | `CALENDAR_LIB_LOAD_FAILED`（加载失败 → NAlert + 重试）/ `CALENDAR_COMPUTE_FAILED`（计算异常 → NAlert + 重试）；纪念日 localStorage 配额满 → 页内 closable 提示「保存失败：存储空间已满」且内存数据不丢               |

## 3. 纯函数契约（≥80% 覆盖）

### 3.1 `src/lunar.ts`

| 函数           | 入参 / 输出                                                                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getDayInfo`   | `(date: Date) => DayInfo`：`{ solar, week, lunarText, jieqi, festivals[], ganzhi, shengXiao, xingZuo, lunarMonth, lunarDay, lunarLeap }`；日期一律**本地时区构造**（禁 `Date.UTC`） |
| `getMonthGrid` | `(year, month) => MonthCell[]` 恒 42 格、周一起始；`MonthCell = { date, info, inMonth, holiday }`；`holiday` 由 `getHolidayInfo` 注入                                               |
| `getHuangJi`   | `(date: Date) => HuangJi`：`{ yi[], ji[], zhiXing, tianShen, tianShenLuck, chong, sha, jiShen[], xiongSha[] }`；宜忌取 `getDayYi(1)/getDayJi(1)` 第 1 段                            |
| `findJieQi`    | 当日节气名或 `null`；节气表**中文键与拼音别名键并存**，跨年节气（冬至/小寒/大寒/立春/雨水/惊蛰/大雪）当日落在拼音键 → `JIEQI_ALIAS` 映射，中文字优先返回                            |

### 3.2 `src/holidays.ts`

`getHolidayInfo(y, m, d): HolidayInfo | null`（`{ name, off }`，`off=false` 表示调休上班）——**双轨**：

1. `src/data/holidays.json`（2023–2027 法定假期区间 + 关联调休 `workdays[]`，自 HolidayUtil 权威导出）全量展开为每日 Map，**跨年区间按天登记**，命中即返回；
2. miss → `HolidayUtil.getHoliday()`（库内置 2001–2027）兜底；
3. 均无 → `null`（不报错）。

### 3.3 `src/anniversaries.ts`

| 函数                | 行为                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nextOccurrence`    | `solar`：今年 (m,d)，2/29 非闰年退 2/28，早于 today 年+1；`lunar`：从今日农历年起逐年 `Lunar.fromYmd`，降级链 **闰月→同号普通月→日超月长→月末（29→28）** |
| `daysUntil`         | 两日期日历日差（取整）                                                                                                                                   |
| `formatCountdown`   | `今天` / `今天 · N 周年`（需 `startYear`）/ `还有 N 天`                                                                                                  |
| `matchesDay`        | `solar` 按公历月日；`lunar` 按 `lunarMonth/lunarDay`（`lunarLeap=true` 仅匹配闰月，否则普通月也命中）                                                    |
| `loadAnniversaries` | localStorage key `lumin.tool.calendar.anniversaries`；损坏 JSON 回退 `[]`；可注入 `StorageLike`                                                          |
| `saveAnniversaries` | 写入失败（配额满）返回 `false`，由 UI 提示，不丢内存数据                                                                                                 |

## 4. 错误码

| 码                         | 中文文案                 | 触发来源                                     |
| -------------------------- | ------------------------ | -------------------------------------------- |
| `CALENDAR_LIB_LOAD_FAILED` | 日历引擎加载失败，请重试 | 动态 import lunar-javascript/本地模块失败    |
| `CALENDAR_COMPUTE_FAILED`  | 日期计算失败，请重试     | `getMonthGrid` / `getDayInfo` / 黄历计算抛错 |

## 5. 壳接线（固定 5 处，无 node.ts）

1. `apps/desktop/electron.vite.config.ts`：`@lumin/tool-calendar/manifest`、`/renderer/(.+)` 两条别名。
2. `apps/desktop/package.json`：`"@lumin/tool-calendar": "workspace:*"`.
3. `apps/desktop/src/tool-manifests.ts`：import + 数组 `calendarManifest,` 1 行。
4. `apps/desktop/src/renderer/src/tools/calendar.vue`：薄页面转发 `ToolView.vue`.
5. `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：iconMap `'calendar-days': CalendarDays`.
6. 根 `vitest.config.ts`：`lunar.ts|holidays.ts|anniversaries.ts` 80% 阈值条目。

清单：`id: calendar`、`name: 日历`、`description: 公历/农历/节假日/纪念日/黄历`、`icon: calendar-days`、`category: compute`、`order: 71`、`version: 0.1.0`.

## 6. R5 体积口径

- 依赖 `lunar-javascript` 经**动态 import 独立分包**，与工具 chunk 一并计入增量；上限 **200KB gzip**（无数学求值库，不适用 300KB 例外）。
- 无 worker / wasm / 模型 / 图片 / 字体资产。交付实测记入 `docs/smoke/calendar.md` §5。

## 7. 验收

- 单测：`lunar.test.ts`（春节 2024-02-10 / 2026-02-17、除夕 2023-01-21、中秋 2025-10-06、清明 2024-04-04 / 2026-04-05、冬至 2024-12-21 拼音键、立春 2026-02-04、42 格、建除∈十二值星、值神∈十二神）、`holidays.test.ts`（双轨、跨年区间、调休）、`anniversaries.test.ts`（2/29 退化、闰月/腊月三十降级、存储往返/损坏/配额满、matchesDay）；本包 36 tests 全绿、核心文件 ≥80%。
- e2e `apps/desktop/e2e/calendar-smoke.spec.ts` 6 用例：
  1. 打开 → 42 格 + 详情农历 `dd` 非空 + 黄历宜忌吉神可见；
  2. 切月标题变化 + 「今天」复位；
  3. 点今日格 `aria-label=YYYY-MM-DD` → 详情更新 + 干支 `dd` 以「日」结尾；
  4. 清 localStorage → 进工具 → 弹窗空态 → 默认月日 = 今天直接填名添加 → 详情出现名称与「今天」→ 重开弹窗删除 → 详情「这一天没有纪念日」；
  5. 窗口 `720×520` → 42 格 + 详情 + 按钮仍可见；
  6. 极端分辨率（`720×520` / `1920×520` / `2560×1440`）→ 无横向溢出、42 格与详情末块可滚入视口（可达性）、头部按钮在视口。
- R2 八类映射记录于 `docs/smoke/calendar.md`。
- `pnpm gate` / `pnpm build` / e2e 全绿；chunk 实测 <200KB gzip。
