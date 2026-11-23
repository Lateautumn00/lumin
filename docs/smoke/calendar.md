# 日历冒烟记录（M58）

> 环境：Windows · Electron 45 · 日期：2026-11-23 · 工具：`@lumin/tool-calendar` v0.1.0

## 1. 冒烟总览

| #   | 冒烟项                       | 方式                                                | 结果                                                                                            |
| --- | ---------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | 单测（lunar/节假日/纪念日）  | `pnpm exec vitest run packages/tools/calendar`      | ✅ 36 tests 全绿（lunar / holidays / anniversaries 三文件）                                     |
| 2   | 覆盖率（R1 核心 ≥80%）       | `vitest run --coverage packages/tools/calendar`     | ✅ lunar.ts 100/83.3/100/100 · holidays.ts 100/100/100/100 · anniversaries.ts 91.7/92/100/94.3  |
| 3   | 质量门禁                     | `pnpm gate`                                         | ✅ lint / typecheck / test / audit / boundary 全绿                                              |
| 4   | e2e 冒烟（R3）               | `pnpm -F @lumin/desktop test:e2e -- calendar-smoke` | ✅ 6/6：月格+详情+黄历、切月与今天复位、点日详情更新、纪念日增删往返、720×520、极端分辨率可达性 |
| 5   | 构建                         | `pnpm -F @lumin/desktop build`                      | ✅ renderer 产物正常，calendar 五 chunk 生成                                                    |
| 6   | chunk 体积（R5 <200KB gzip） | 构建产物实测                                        | ✅ 增量合计 **123,405 B gzip（≈120.5KB）**，见 §5                                               |

## 2. R2 八类异常清单

> 本工具为纯 renderer 日期计算 + localStorage 持久化，无文件 IO、无长任务、无联网；按 `docs/smoke/shell.md` §2 约定逐类映射。

| 类别             | 适用性                                                                 | 验证级别   | 记录                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 中文/空格路径 | 不适用（无文件路径）                                                   | 单测 + e2e | 等价边界：纪念日中文名/空格名保存与展示正常（e2e「测试纪念日」）✅；`loadAnniversaries` 名称不去空白但 trim 判空校验 ✅               |
| 2. 文件被占用    | 不适用（无文件 IO）                                                    | —          | —                                                                                                                                     |
| 3. 加密文件      | 不适用（无文件 IO）                                                    | —          | —                                                                                                                                     |
| 4. 超大文件      | 不适用（无文件输入）                                                   | 单测       | 等价边界：非法日期拒绝——公历 2/30、4/31 表单校验拒收 ✅；农历日 >30 拒收 ✅；月份越界（0/13）拒收 ✅；起始年 1900–2100 范围校验 ✅    |
| 5. 任务取消      | 不适用（全同步纯函数；动态 import 加载 <100ms，spec §2.5 豁免）        | —          | —                                                                                                                                     |
| 6. 并发溢出      | 不适用（无队列；连点上月/下月 50 次状态正确——e2e 切月 + 复位用例覆盖） | 单测 + e2e | 加载竞态防护：`loadSeq` 序号丢弃过期结果，重复点「重试」不产生双写 ✅（代码分支）                                                     |
| 7. 磁盘满        | 不适用（不落盘）                                                       | 单测       | 相关兜底：localStorage 配额满 `saveAnniversaries` 返回 `false`，UI 显示「保存失败：存储空间已满」且内存列表不丢 ✅（单测 + 代码分支） |
| 8. 断电恢复      | 持久化 = localStorage（浏览器级原子写）                                | 单测 + e2e | 存储往返：保存 → 读取内容一致 ✅；损坏 JSON（截断/非数组）回退 `[]` 不崩溃 ✅；e2e 删除后重开列表状态正确 ✅；重开应用数据完好 ✅     |

补充手工验证（2026-11-23）：

- **跨年翻月**：12 月 → 次年 1 月、1 月 → 去年 12 月，年份进退正确、42 格无空洞 ✅
- **节假日双轨**：2026-02-17 春节（holidays.json 命中）、2027 未收录日回落 HolidayUtil、2001–2027 外返回 null 不报错 ✅（单测）
- **农历边界**：2025 年腊月仅 29 天，`day30` 降级不抛错；闰六月（2025 -6）纪念日降级链单测锁死 ✅
- **节气跨年键**：2024-12-21 冬至（拼音键 DONG_ZHI）、2026-02-04 立春（LI_CHUN）命中 ✅（单测）
- **快速操作**：连续切月 + 点日 + 开关弹窗无残留状态、无重复弹窗 ✅（e2e）
- **极端分辨率**（2026-11-23 Playwright 实测）：720×520 / 1024×520 / 1280×520 / 1920×520 / 1280×900 / 2560×1440 全部 `hOverflow=0`（无横向溢出）、42 格齐全、头部按钮在视口；发现并修复缺陷——xl 横排矮窗口（≥1280 视口宽 × 低高）下详情列无滚动能力，末块（当日纪念日）被 `xl:overflow-hidden` 裁剪不可达，详情列补 `xl:min-h-0 xl:overflow-y-auto` 后 1920×520 / 1440×520 复验可达 ✅；纪念日长列表弹窗 720×520 下按钮初始在视口（NModal 自带滚动）✅（e2e 第 6 用例锁死）

## 3. 数据与口径说明

- **节假日**：`src/data/holidays.json` 2023–2027（自 `HolidayUtil` 权威导出：放假区间 + 按 target 关联的调休 workdays，导出时 UNASSIGNED 检查为空）；查询时全量展开每日 Map（跨年区间按天登记），miss 回落 `HolidayUtil.getHoliday()`（2001–2027），均无返回 `null`。
- **黄历宜忌**：`getDayYi(1)/getDayJi(1)` 第 1 段；建除 `getZhiXing()`、值神 `getDayTianShen()` 属十二神集合，单测断言 ∈ 权威集合。
- **纪念日存储**：localStorage key `lumin.tool.calendar.anniversaries`，零 IPC。

## 4. 验证记录（2026-11-23）

| 命令                                                | 结果                  |
| --------------------------------------------------- | --------------------- |
| `pnpm exec vitest run packages/tools/calendar`      | ✅ 36 tests 全绿      |
| `pnpm -F @lumin/tool-calendar typecheck`            | ✅ 通过               |
| `pnpm exec eslint packages/tools/calendar`          | ✅ 0 告警             |
| `pnpm -F @lumin/desktop typecheck`                  | ✅ 通过               |
| `pnpm -F @lumin/desktop build`                      | ✅ 产物正常           |
| `pnpm -F @lumin/desktop test:e2e -- calendar-smoke` | ✅ 6 passed（约 21s） |
| `pnpm gate`                                         | ✅ 全绿               |

## 5. R5 体积记录

- 口径：gzip（`node zlib.gzipSync level 9` 实测）；增量 = 工具 chunk + 独占依赖 chunk：

| chunk                           | raw (B)     | gzip (B)                |
| ------------------------------- | ----------- | ----------------------- |
| `calendar-*.js`                 | 34,796      | 8,355                   |
| `lunar-*.js`（纯函数层）        | 2,842       | 1,437                   |
| `anniversaries-*.js`            | 4,905       | 2,158                   |
| `holidays-*.js`                 | 4,938       | 1,529                   |
| `lunar-javascript-*.js`（依赖） | 448,038     | 109,926                 |
| **合计**                        | **495,519** | **123,405（≈120.5KB）** |

- **123,405 B gzip < 200KB 达标**（lunar-javascript 动态 import 独立分包，raw 448KB 不影响 gzip 口径）。
- 无运行时资产（无 worker/wasm/模型/字体），无需单列。
