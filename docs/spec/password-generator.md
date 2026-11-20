# 密码生成器（password-generator）字段级功能清单

> 版本：v0.1.0 · 定稿日期：2026-11-20（R8）· 工具 id：`password-generator` · 里程碑 M31
> 本文件为该里程碑验收附件；实现与本文件不一致时以本文件为准，变更须走 R8 流程。

## 1. 范围与边界

**做**：强随机密码生成（长度 4–128、四类字符集任意组合、排除易混淆与自定义排除字符、熵与强度分档）；UUID v4 批量生成（1–50）；随机字符串（四档预设字符集、长度 1–256、批量 1–20）与闭区间随机整数（跨度 ≤ 1,000,000）。

**不做**：密码强度词典/泄露库校验、密码保存与管理、口令短语（passphrase）生成、UUID v1/v3/v5/ULID、随机数分布统计、历史记录持久化、联网。

**形态**：**纯 renderer、零 IPC、零主进程逻辑、零新增运行时第三方依赖**；仅复用 vue / naive-ui / `@lucide/vue` / `@lumin/shared`（`StructuredError`）。随机源统一为 Web Crypto `crypto.getRandomValues`（拒绝采样消除模偏差），全部计算为同步纯函数（<1ms），无任务队列。

## 2. 页面字段清单

单页 + 3 个页签（`NTabs` 仅作切换器，内容 `v-if` 渲染，标签走 `#tab` 插槽——与 text-toolbox 同范式）。

### 2.1 Tab1 密码

| 区域     | 控件                                                    | 行为                                                                                     | 空/默认                          |
| -------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------- |
| 密码长度 | `NInputNumber`（4–128，整数）                           | 变更即重新生成；为空或越界 → `PG_INVALID_OPTIONS`（detail 指明长度规则）                 | 16                               |
| 字符集   | 4 个 `NCheckbox`：小写 a-z / 大写 A-Z / 数字 0-9 / 符号 | 至少启用一类；全部取消 → 字符池为空报错，结果区隐藏                                      | 小写 / 大写 / 数字启用，符号关闭 |
| 排除项   | `NCheckbox` + `NInput`                                  | 勾选排除 `0 O o I l 1`；输入框追加自定义排除字符（逐字符过滤，可为空）                   | 不勾选 / 空                      |
| 结果区   | 只读文本（`data-password`）+ 强度条                     | 等宽字体、可整段选择；强度条按熵映射宽度与颜色（tokens `error/warning/primary/success`） | 挂载即生成一版结果               |
| 强度/熵  | 文本                                                    | `强度：弱/中/强/极强`（熵 <40/<60/<80/≥80 bits）+ `熵 x.x bits · 字符池 n 个`            | 随结果实时更新                   |
| 操作     | `[重新生成]` + `[复制]`                                 | 重新生成并替换结果；复制成功文案 1.2s 复位，失败 → `PG_CLIPBOARD_FAILED`                 | —                                |

### 2.2 Tab2 UUID

| 区域     | 控件                        | 行为                                                             |
| -------- | --------------------------- | ---------------------------------------------------------------- |
| 生成数量 | `NInputNumber`（1–50 整数） | 变更即重新生成；越界/为空 → `PG_INVALID_OPTIONS`（结果列表清空） |
| 结果列表 | `data-uuid-item` 列表       | 每行 UUID v4（小写、36 字符）等宽展示 + 单条 `[复制]`            |
| 操作     | `[生成]` + `[复制全部]`     | 重新生成整批；全部按行拼接复制（空列表时按钮禁用）               |
| 空/默认  | —                           | 挂载即生成 1 条，无白屏                                          |

### 2.3 Tab3 随机

| 区域       | 控件                                                                         | 行为                                                                                                             |
| ---------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 随机字符串 | `NSelect` 字符集 + 长度 `NInputNumber`（1–256）+ 数量 `NInputNumber`（1–20） | 字符集四档：字母+数字 / 仅字母 / 仅数字 / 十六进制；变更即重新生成；批量结果逐条 `[复制]`，`[复制全部]` 按行拼接 |
| 随机整数   | 最小值 / 最大值 `NInputNumber` + `[生成随机数]`                              | 闭区间 `[min, max]`，跨度 ≤ 1,000,000；非整数、下界大于上界、跨度过大 → `PG_INVALID_OPTIONS`；结果带 `[复制]`    |
| 空/默认    | —                                                                            | 字符串：字母+数字 / 长度 32 / 5 条；整数：1–100 且挂载即生成 1 个                                                |
| 错误行     | `role="alert"` 文案 + 错误码                                                 | 两个小节各自独立报错，互不阻塞                                                                                   |

### 2.4 三态

| 状态   | 实现                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------- |
| 空态   | 三个页签均有默认值（16 位密码 / 1 条 UUID / 5 条随机字符串 + 1 个随机整数），打开即出结果，无白屏                     |
| 加载态 | **不适用**（全部同步纯函数 <1ms；spec 登记豁免，与 text-toolbox 同口径）                                              |
| 报错态 | 各页签独立 `role="alert"` 行内结构化错误（错误码 + 中文文案），其余页签与页面不阻塞；复制失败 → `PG_CLIPBOARD_FAILED` |

## 3. 纯函数契约（`src/password.ts`，≥80% 覆盖）

| 函数                                          | 入参 / 输出                                                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `defaultRandomSource(length)`                 | `crypto.getRandomValues` 填充并返回 `Uint8Array`                                                                                   |
| `randomIntBelow(bound, random)`               | 拒绝采样返回 `[0, bound)`：`bound ≤ 256` 走 1 字节（丢弃 ≥ `256 - 256 % bound` 的字节），否则走 4 字节；非法 bound 抛 `RangeError` |
| `buildCharset(options)`                       | 按 小写→大写→数字→符号 拼接、去重，再剔除易混淆（`0OoIl1`）与自定义排除字符；返回字符池字符串                                      |
| `estimateEntropyBits(length, poolSize)`       | `length ≤ 0` 或 `poolSize < 2` → 0；否则 `length × log2(poolSize)`                                                                 |
| `strengthOf(entropyBits)`                     | `<40` 弱 / `<60` 中 / `<80` 强 / `≥80` 极强（`{ level, label }`）                                                                  |
| `generatePassword(options, random?)`          | 校验长度 4–128 与字符池非空 → `{ ok:true, value:{ password, poolSize, entropyBits, strength } }` 或 `{ ok:false, message }`        |
| `generateUuidV4(random?)`                     | 16 随机字节 → 第 6 字节 `(b & 0x0f) \| 0x40`、第 8 字节 `(b & 0x3f) \| 0x80` → 8-4-4-4-12 小写十六进制；字节不足抛错               |
| `poolOf(id)`                                  | `alphanumeric`（62）/ `letters`（52）/ `digits`（10）/ `hex`（16）                                                                 |
| `generateRandomString(length, pool, random?)` | 长度 1–256、字符池先去重非空；均匀采样 → `Result<string>`                                                                          |
| `generateRandomInt(min, max, random?)`        | 闭区间随机整数；非整数 / `min > max` / 跨度 > `1,000,000` → `{ ok:false, message }`                                                |

常量：`PASSWORD_LENGTH_MIN = 4`、`PASSWORD_LENGTH_MAX = 128`、`RANDOM_STRING_LENGTH_MIN = 1`、`RANDOM_STRING_LENGTH_MAX = 256`、`RANDOM_INT_SPAN_MAX = 1_000_000`、`AMBIGUOUS_CHARS = '0OoIl1'`、四类字符集字符串、`RANDOM_STRING_POOLS`。

## 4. 错误码（`src/errors.ts`）

| 码                    | 中文文案                           | 触发来源                                                                           |
| --------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| `PG_INVALID_OPTIONS`  | 生成参数不合法，请检查长度与字符集 | 密码长度越界/为空、字符池为空、UUID 数量越界、随机字符串参数非法、随机整数范围非法 |
| `PG_CLIPBOARD_FAILED` | 复制失败，请手动选择文本复制       | 渲染层剪贴板写入失败                                                               |

## 5. 壳接线（固定 6 处，无 node.ts）

1. `apps/desktop/electron.vite.config.ts`：`@lumin/tool-password-generator/manifest`、`/renderer/*` 两条别名。
2. `apps/desktop/package.json`：`"@lumin/tool-password-generator": "workspace:*"`（devDependencies，按字母序）。
3. `apps/desktop/src/tool-manifests.ts`：import + 数组 `exampleManifest` 之前新增 1 行。
4. `apps/desktop/src/renderer/src/tools/password-generator.vue`：薄页面转发 `ToolView.vue`。
5. `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：iconMap 新增 `'key-round': KeyRound`。
6. 根 `vitest.config.ts`：新增 `packages/tools/password-generator/src/**/*.ts` 80% 阈值。

清单：`id: password-generator`、`name: 密码生成器`、`description`、`icon: key-round`、`category: misc`、`order: 90`、`version: 0.1.0`。

## 6. R5 体积口径

无 worker / wasm / 模型 / 图片 / 字体资产；仅共享 vendor（vue / naive-ui / @lucide/vue）。交付时以 `pnpm build` 产物实测 `password-generator-*.js` 的 raw/gzip 记入 `docs/smoke/password-generator.md`；独占依赖 chunk 预期为 0，上限 200KB gzip。

## 7. 验收

- 单测：`password.test.ts`（字符池构建/排除、拒绝采样含模偏差丢弃、熵与强度边界、密码确定性生成与校验失败、UUID v4 版本位与变体位、随机字符串/整数边界）、`errors.test.ts`、`manifest.test.ts`；本包覆盖率 ≥80%。
- e2e `apps/desktop/e2e/password-generator-smoke.spec.ts` 4 用例：
  1. 页面加载 → 3 页签可见 → 默认 16 位密码 + 强度/熵展示；
  2. 长度 24 + 仅大写 → `^[A-Z]{24}$`；全部取消 → `PG_INVALID_OPTIONS` 并恢复小写；
  3. UUID 页签 → 默认 1 条且符合 v4 正则 → 数量改 3 条；
  4. 随机页签 → 默认 5 条长度 32 + 随机整数可见 → 下界大于上界报 `PG_INVALID_OPTIONS` 并恢复。
- R2 八类映射记录于 `docs/smoke/password-generator.md`。
- `pnpm gate` / `pnpm coverage` / `pnpm build` / e2e 全绿。
