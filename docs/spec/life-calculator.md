# 生活计算器（life-calculator）字段级功能清单

> 版本：v0.1.0 · 定稿日期：2026-11-21（R8）· 工具 id：`life-calculator` · 里程碑 M37
> 本文件为该里程碑验收附件；实现与本文件不一致时以本文件为准，变更须走 R8 流程。

## 1. 范围与边界

**做**：房贷（等额本息 / 等额本金，月供、支付利息、还款总额、完整还款计划）；工资个税（月度口径：起征点 5000 元 + 五险一金 + 专项附加扣除 + 七档累进税率）；百分比与折扣（按百分比增减、变化率、按力度算折后价、折后价反推原价）。

**不做**：公积金/组合贷分别计息、提前还款、LPR 浮动重定价、年终奖单独计税、年度汇算清缴、个税专项附加扣除明细分类校验、汇率/投资复利、历史记录持久化、联网。

**形态**：**纯 renderer、零 IPC、零主进程逻辑、零新增运行时第三方依赖**；仅复用 vue / naive-ui / `@lucide/vue` / `@lumin/plugin-api` / `@lumin/shared`（`StructuredError` 类型）。全部为同步纯函数，无任务队列。

## 2. 页面字段清单

单页 + 3 个页签（`NTabs` 仅作切换器，内容 `v-if` 渲染，标签走 `#tab` 插槽——与 text-toolbox 同范式）。

### 2.1 Tab1 房贷

| 区域     | 控件                                                | 行为                                                                                    | 空/默认      |
| -------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------ |
| 还款方式 | `NRadioGroup` + `NRadioButton`：等额本息 / 等额本金 | 切换即重算；结果首卡标题随方式变为「每月月供」或「首月还款」                            | 等额本息     |
| 贷款本金 | `NInputNumber`（元，1–100,000,000）                 | 越界/为空/NaN → `LC_MORTGAGE_INVALID`，结果区隐藏                                       | 1,000,000    |
| 年利率   | `NInputNumber`（%，0–24，步进 0.05）                | 越界 → `LC_MORTGAGE_INVALID`                                                            | 4.9          |
| 贷款年限 | `NInputNumber`（年，1–50 整数）                     | 非整数/越界 → `LC_MORTGAGE_INVALID`                                                     | 30           |
| 汇总卡   | 4 个指标块（`data-mortgage-metric`）                | 月供（等额本息）或首月还款（等额本金）/ 支付利息 / 还款总额 / 还款期数                  | 挂载即出结果 |
| 还款计划 | 表格（`data-mortgage-row`）                         | 展示前 12 期：期数 / 月供 / 本金 / 利息 / 剩余本金；末行注明总期数                      | 前 12 期     |
| 操作     | `[复制结果]`                                        | 复制月供/首月、总利息、还款总额与期数；成功文案 1.2s 复位，失败 → `LC_CLIPBOARD_FAILED` | —            |

### 2.2 Tab2 个税

| 区域         | 控件                               | 行为                                                     | 空/默认      |
| ------------ | ---------------------------------- | -------------------------------------------------------- | ------------ |
| 税前月薪     | `NInputNumber`（元，0–10,000,000） | 越界/为空/NaN → `LC_TAX_INVALID`，结果区隐藏             | 10,000       |
| 五险一金     | `NInputNumber`（元，≥0）           | 大于税前月薪 → `LC_TAX_INVALID`                          | 1,000        |
| 专项附加扣除 | `NInputNumber`（元，≥0）           | 大于税前月薪 → `LC_TAX_INVALID`                          | 0            |
| 说明行       | 文本                               | 明示「月度口径 + 起征点 5000 元 + 不含年终奖与年度汇算」 | 常驻         |
| 汇总卡       | 4 个指标块（`data-tax-metric`）    | 应纳税所得额 / 应缴个税 / 税后收入 / 实际税负率          | 挂载即出结果 |
| 辅助行       | 文本 + `[复制结果]`                | 适用税率档位；复制三项金额，失败 → `LC_CLIPBOARD_FAILED` | —            |

### 2.3 Tab3 百分比

| 小节         | 控件                                                          | 行为                                                               | 空/默认           |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------- |
| 按百分比增减 | 基数 × 百分比（%）→ 结果 `data-percent-apply`                 | 百分比绝对值 ≤ 10,000；非法 → `LC_PERCENT_INVALID`（本节独立报错） | 100 / 20 → 120    |
| 变化率       | 原值 × 新值 → `data-percent-rate`                             | 原值不得为 0；非法 → `LC_PERCENT_INVALID`                          | 100 / 120 → 20%   |
| 折扣         | 原价 × 折扣力度（0–100%）→ `data-percent-discount`            | 原价 ≥0、力度 0–100；非法 → `LC_PERCENT_INVALID`                   | 199 / 20 → 159.20 |
| 反推原价     | 折后价 × 折扣力度（0–100，不含 100）→ `data-percent-original` | 力度 100 无法反推，报错；非法 → `LC_PERCENT_INVALID`               | 159.2 / 20 → 199  |

### 2.4 三态

| 状态   | 实现                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------- |
| 空态   | 三个页签均有默认参数并实时出结果（房贷 100 万/4.9%/30 年、个税 10000/1000/0、百分比三组默认值），打开即出结果，无白屏 |
| 加载态 | **不适用**（全部同步纯函数，单次计算 <5ms；spec 登记豁免，与 text-toolbox / password-generator 同口径）               |
| 报错态 | 各页签/各小节独立 `role="alert"` 行内结构化错误（错误码 + 中文文案），互不阻塞；复制失败 → `LC_CLIPBOARD_FAILED`      |

## 3. 纯函数契约（`src/*.ts`，≥80% 覆盖）

### 3.1 `src/mortgage.ts`

| 函数                  | 入参 / 输出                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `calcMortgage(input)` | `{ principal, annualRate, years, method }` → `{ ok:true, value }` 或 `{ ok:false, message }`                                 |
| 等额本息              | 月利率 `r = annualRate / 100 / 12`；`月供 = P·r·(1+r)^n / ((1+r)^n − 1)`，`r = 0` 时 `月供 = P / n`；总利息 `= 月供 × n − P` |
| 等额本金              | 每期本金 `= P / n`；`第 i 期利息 = 剩余本金 × r`；总利息 `= P·r·(n+1) / 2`                                                   |
| 还款计划              | 完整 `schedule`（最长 600 期）；金额保留两位小数；末期本金取剩余本金结清尾差，末期 `remaining = 0`                           |

`MortgageResult`：`{ method, months, monthlyPayment, firstPayment, lastPayment, totalPayment, totalInterest, schedule[] }`；`MortgageMonth`：`{ month, payment, principalPart, interestPart, remaining }`。
常量：`MORTGAGE_PRINCIPAL_MIN = 1`、`MORTGAGE_PRINCIPAL_MAX = 100_000_000`、`MORTGAGE_RATE_MAX = 24`、`MORTGAGE_YEARS_MIN = 1`、`MORTGAGE_YEARS_MAX = 50`。

### 3.2 `src/tax.ts`

| 函数 / 常量                     | 入参 / 输出                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calcSalaryTax(input)`          | `{ grossSalary, socialInsurance, specialDeduction }` → `{ ok:true, value }` 或 `{ ok:false, message }`                                                   |
| 口径                            | `应纳税所得额 = max(0, 税前 − 五险一金 − 专项附加扣除 − 5000)`；`个税 = max(0, 应纳税所得额 × 税率 − 速算扣除数)`；`税后 = 税前 − 五险一金 − 个税`       |
| `findTaxBracket(taxableIncome)` | 返回首个 `upTo ≥ 应纳税所得额` 的档位（0–3000 3% / 3000–12000 10% / 12000–25000 20% / 25000–35000 25% / 35000–55000 30% / 55000–80000 35% / >80000 45%） |
| `TAX_BRACKETS`                  | 7 档只读数组（`{ upTo, rate, deduction }`，速算扣除数 0/210/1410/2660/4410/7160/15160）                                                                  |

`SalaryTaxResult`：`{ taxableIncome, tax, netSalary, effectiveRate, bracketRate }`；`effectiveRate = 个税 / 税前 × 100`（税前 0 时为 0）。
常量：`TAX_MONTHLY_THRESHOLD = 5000`、`TAX_GROSS_MAX = 10_000_000`。

### 3.3 `src/percent.ts`

| 函数                                | 入参 / 输出                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `applyPercentChange(base, percent)` | `base × (1 + percent / 100)`；`percent ∈ [-10000, 10000]`                         |
| `percentChange(from, to)`           | `((to − from) / from) × 100`；`from = 0` → `{ ok:false, message:'原值不能为 0' }` |
| `discountPrice(original, off)`      | `original × (1 − off / 100)`；`off ∈ [0, 100]`                                    |
| `originalPrice(discounted, off)`    | `discounted / (1 − off / 100)`；`off ∈ [0, 100)`                                  |

统一返回 `NumberOutcome = { ok:true, value } | { ok:false, message }`；结果保留两位小数；常量 `PERCENT_MAX = 10_000`。

### 3.4 `src/num.ts`

`round2(value)`（两位小数，含 EPSILON 补偿）、`isFiniteNumber(value)`（排除 NaN / ±Infinity / 空值）。

## 4. 错误码（`src/errors.ts`）

| 码                    | 中文文案                               | 触发来源                                         |
| --------------------- | -------------------------------------- | ------------------------------------------------ |
| `LC_MORTGAGE_INVALID` | 房贷参数不合法，请检查本金、利率与年限 | 本金/利率/年限越界或非整数、未知还款方式         |
| `LC_TAX_INVALID`      | 个税参数不合法，请检查工资与扣除项     | 工资为负或越界、扣除项为负或大于税前工资         |
| `LC_PERCENT_INVALID`  | 百分比参数不合法                       | 基数为空/NaN、百分比越界、原值为 0、折扣力度越界 |
| `LC_CLIPBOARD_FAILED` | 复制失败，请手动选择文本复制           | 渲染层剪贴板写入失败                             |

## 5. 壳接线（固定 6 处，无 node.ts）

1. `apps/desktop/electron.vite.config.ts`：`@lumin/tool-life-calculator/manifest`、`/renderer/*` 两条别名。
2. `apps/desktop/package.json`：`"@lumin/tool-life-calculator": "workspace:*"`（devDependencies，按字母序）。
3. `apps/desktop/src/tool-manifests.ts`：import + 数组 `unitConverterManifest` 之后新增 1 行。
4. `apps/desktop/src/renderer/src/tools/life-calculator.vue`：薄页面转发 `ToolView.vue`。
5. `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：iconMap 新增 `'piggy-bank': PiggyBank`。
6. 根 `vitest.config.ts`：新增 `packages/tools/life-calculator/src/**/*.ts` 80% 阈值。

清单：`id: life-calculator`、`name: 生活计算器`、`description`、`icon: piggy-bank`、`category: compute`、`order: 30`、`version: 0.1.0`。

## 6. R5 体积口径

无 worker / wasm / 模型 / 图片 / 字体资产；仅共享 vendor（vue / naive-ui / `@lucide/vue`）。交付时以 `pnpm build` 产物实测 `life-calculator-*.js` 的 raw/gzip 记入 `docs/smoke/life-calculator.md`；独占依赖 chunk 预期为 0，上限 200KB gzip。

## 7. 验收

- 单测：`mortgage.test.ts`（两种方式零利率/正常利率、末期结清、本金合计、月供递减、四类参数校验）、`tax.test.ts`（七档边界与连续性、扣除项校验）、`percent.test.ts`（四种口径与非法输入）、`num.test.ts`、`errors.test.ts`、`manifest.test.ts`；本包覆盖率 ≥80%。
- e2e `apps/desktop/e2e/life-calculator-smoke.spec.ts` 4 用例：
  1. 页面加载 → 3 页签可见 → 默认房贷汇总卡与 12 期还款计划；
  2. 切换等额本金 → 首卡变「首月还款」→ 本金 0 报 `LC_MORTGAGE_INVALID` 并恢复；
  3. 个税 10000/0 → 个税 290、税后 9,710 → 五险一金大于工资报 `LC_TAX_INVALID`；
  4. 百分比默认 120 / 20% / 159.20 → 百分比 -10 得 90 → 原值 0 报 `LC_PERCENT_INVALID`。
- R2 八类映射记录于 `docs/smoke/life-calculator.md`。
- `pnpm gate` / `pnpm coverage` / `pnpm build` / e2e 全绿。
