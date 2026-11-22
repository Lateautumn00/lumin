# 文本工具箱冒烟记录（M8）

> 环境：Windows 10.0.19045 · Electron 45 · 分支：`feature/m8-text`
> 日期：2026-11-18 · 工具：`@lumin/tool-text-toolbox` v0.1.0

## 1. 冒烟总览

| #   | 冒烟项                               | 方式                                             | 结果                                                                    |
| --- | ------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------- |
| 1   | 单测（JSON/编解码/正则/错误码/清单） | `pnpm vitest run packages/tools/text-toolbox`    | ✅ 46 tests（json 10 / regex 18 / encoding 12 / errors 5 / manifest 1） |
| 2   | 覆盖率（R1 核心 ≥80%）               | `pnpm coverage`                                  | ✅ 本包组 93.83 / 85.93 / 100 / 100；全仓 93.23 / 84.91 / 90.79 / 95.72 |
| 3   | 质量门禁                             | `pnpm typecheck` / `pnpm lint` / `pnpm boundary` | ✅ 全绿（14 tasks typecheck；ESLint 无告警；依赖边界 0 违规）           |
| 4   | e2e 冒烟（R3）                       | `pnpm test:e2e`（text-toolbox 4 用例）           | ✅ 页面加载+JSON 格式化、非法 JSON 行列、Base64 往返、正则匹配+替换     |
| 5   | 全量 e2e 回归                        | `pnpm test:e2e`                                  | ✅ 44 passed / 1 skipped（更新冒烟按设计跳过）                          |
| 6   | 构建                                 | `pnpm build`                                     | ✅ 5612 modules transformed，text-toolbox chunk 正常产出                |
| 7   | chunk 体积（R5 <200KB gzip）         | 构建产物实测                                     | ✅ **36.7KB raw / 8.6KB gzip**，独占依赖 chunk 为 0                     |

## 2. R2 八类异常清单

> 本工具为纯 renderer 文本处理，无文件 IO、无长任务、无落盘；按 `docs/smoke/shell.md` §2 约定逐类映射。

| 类别             | 适用性                                               | 验证级别   | 记录                                                                                                                                 |
| ---------------- | ---------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1. 中文/空格路径 | 不适用（无文件路径）                                 | 单测 + e2e | 补充验证：中文/emoji 文本 Base64 往返与 `Buffer.from(text,'utf8')` 对照 ✅；URL 中文往返 ✅；e2e 输入「你好 Lumin」编码→交换→解码 ✅ |
| 2. 文件被占用    | 不适用（无文件 IO）                                  | —          | —                                                                                                                                    |
| 3. 加密文件      | 不适用（无文件 IO）                                  | —          | —                                                                                                                                    |
| 4. 超大文件      | ✅ 适用（文本 5MB 上限）                             | 单测       | `parseJson`/`encodeBase64` 超 5MB → `TT_TEXT_TOO_LARGE` ✅；100,000 字符分片编码往返 ✅                                              |
| 5. 任务取消      | 不适用（同步计算，无任务队列；spec §4 声明豁免取消） | —          | —                                                                                                                                    |
| 6. 并发溢出      | 不适用（无队列；操作均为单次点击同步执行）           | —          | —                                                                                                                                    |
| 7. 磁盘满        | 不适用（不落盘）                                     | —          | 相关兜底：剪贴板写入失败 → `TT_CLIPBOARD_FAILED` 中文提示（代码分支，未构造实测）                                                    |
| 8. 断电恢复      | 不适用（无持久化；刷新后输入清空为预期）             | —          | —                                                                                                                                    |

## 3. 实现注记（naive-ui 构建行为）

- 当前 `naive-ui@2.45.3` 构建下，`NTabPane` 的**页签内容不随切换更新**（页签 active 类已切换，pane 内容未重渲染），且**自闭合 `NTabPane` 的 `tab` 文本渲染为空**（宽度 0）。
- 本工具实现：`NTabs` 仅作切换器（空 pane），内容区用 `v-if="activeTab === ..."` 渲染；页签文字走 `<template #tab>` 插槽。e2e 4 用例在 `pnpm build` 产物上验证通过。
- 同问题在既有 `image-toolbox` 页面同样存在（页签文字空白），属 M6 遗留，未在本里程碑修复范围内，另行处理。

## 4. R5 体积记录

- 口径：gzip；`text-toolbox-*.js` = **36,711 B raw / 8,638 B gzip**（远低于 200KB gzip）。
- 独占依赖 chunk：0（naive-ui `Tabs`/`Button`/`CheckboxGroup`/`Select` 等为多工具共享 vendor，不计入工具增量）。
- 无运行时资产（无 worker/wasm/模型），无需单列。

## 5. M36 增量验证（2026-11-21）

| 项          | 方式                                                   | 结果                                                                                                                                                                             |
| ----------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 编解码扩展  | `pnpm exec vitest run packages/tools/text-toolbox/src` | ✅ 69 tests：Hex（`你好🙂` ↔ `e4 bd a0 e5 a5 bd f0 9f 99 82`、空白/大小写、奇数长度/非法字符/非 UTF-8）、Unicode（`\uXXXX` 代理对往返、小写转义、不完整 → `TT_UNICODE_INVALID`） |
| 文本处理    | `text-ops.test.ts`                                     | ✅ 字面量元字符转义、大小写敏感开关、正则 `$1`、空查找 → `TT_REPLACE_INVALID`、非法正则 → `TT_REGEX_INVALID`；行处理固定顺序、A/a 去重、数字自然排序、CRLF 归一                  |
| 字数统计    | `stats.test.ts`                                        | ✅ 中英数字混排 16 字符/5 汉字/5 字母/3 数字/4 词/2 行/26 字节；CRLF 空行；emoji 按码点 1 字符 4 字节                                                                            |
| chunk（R5） | `pnpm build` 产物实测                                  | ✅ `text-toolbox-*.js` = 54,599 B raw / **11,890 B gzip**，远低于 200KB                                                                                                          |
| R2 八类映射 | 纯 renderer、无文件 IO                                 | 1–4 **不适用**；超大文本 → `TT_TEXT_TOO_LARGE`（5MB）；5 取消：>200KB 分帧但同步可忽略；6 并发：无共享状态；7 磁盘满：无写入；8 断电恢复：无持久化（沿用 §2）                    |

## 6. M44 增量验证（摩尔斯，2026-11-21）

| 项           | 方式                                                                 | 结果                                                                                                                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 摩尔斯纯函数 | `pnpm exec vitest run packages/tools/text-toolbox/src/morse.test.ts` | ✅ 12 tests（编码大小写/单词分隔/数字/空白归一/空文本/不支持字符 `TT_MORSE_INVALID`/超限；解码往返/单词容错/空文本/未知码/超限）                                                                                                                              |
| 质量门禁     | `pnpm gate`（lint → typecheck → test → audit:high → boundary）       | ✅ 全绿：2412 passed / 1 skipped；audit 仅 2 moderate（无 high/critical）；boundary 788 modules 0 违规                                                                                                                                                        |
| 覆盖率（R1） | `pnpm coverage`                                                      | ✅ 全仓 93.44 / 85.69 / 91.68 / 95.32（语句/分支/函数/行）；text-toolbox 包阈值 ≥80% 通过                                                                                                                                                                     |
| chunk（R5）  | `pnpm build` 产物实测                                                | ✅ `text-toolbox-*.js` = **62,617 B raw / 13,523 B gzip**（远低于 200KB gzip）；独占依赖 chunk 为 0                                                                                                                                                           |
| e2e（R3）    | `playwright test text-toolbox-smoke.spec.ts`                         | ⚠️ 已新增「摩尔斯编码 → 交换 → 解码往返」用例；**本机执行被 Trae 文件系统沙箱硬阻断**（Electron 沙箱令牌对 `AppData\Roaming\@lumin` 仅 RX，启动报 `Lock file can not be created: 0x5`，`dangerouslyDisableSandbox` 亦无法绕过），待本机普通终端或 CI 运行验证 |
| R2 八类映射  | 纯 renderer、无文件 IO                                               | 1–4 **不适用**；编码超限 → `TT_TEXT_TOO_LARGE`（5MB）；不支持字符/未知码 → `TT_MORSE_INVALID`；5 取消：同步计算无队列；6 并发：无共享状态；7 磁盘满：不落盘；8 断电恢复：无持久化                                                                             |

## 7. M47 增量验证（CSV ↔ JSON，2026-11-21）

| 项           | 方式                                                               | 结果                                                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CSV 纯函数   | `pnpm exec vitest run packages/tools/text-toolbox/src/csv.test.ts` | ✅ 26 tests（引号包裹/`""` 转义/字段内换行/CRLF 归一/BOM/四种分隔符/无表头；引号未闭合、引号位置、列数不一致、表头重复、空内容、超限；JSON→CSV 表头并集、缺失值、转义、空数组、非对象数组、嵌套值、非法 JSON）                 |
| 质量门禁     | `pnpm gate`（lint → typecheck → test → audit:high → boundary）     | ✅ 全绿：2478 passed / 1 skipped；audit 仅 2 moderate（无 high/critical）；boundary 798 modules 0 违规                                                                                                                         |
| 覆盖率（R1） | `pnpm vitest run packages/tools/text-toolbox --coverage`           | ✅ 本包 96.72 / 92.08 / 100 / 100（语句/分支/函数/行），高于 80% 阈值                                                                                                                                                          |
| chunk（R5）  | `pnpm build` 产物实测                                              | ✅ `text-toolbox-*.js` = **77,047 B raw / 16,663 B gzip**（远低于 200KB gzip）；独占依赖 chunk 为 0                                                                                                                            |
| e2e（R3）    | `playwright test text-toolbox-smoke.spec.ts`                       | ⚠️ 已新增「CSV → JSON」「JSON → CSV 与列数不一致报错」两用例；**本机执行受 Trae 文件系统沙箱阻断（同 §6）**，待本机普通终端或 CI 运行验证                                                                                      |
| R2 八类映射  | 纯 renderer、无文件 IO                                             | 1–4 **不适用**；超大文本 → `TT_TEXT_TOO_LARGE`（5MB）；CSV 结构错误 → `TT_CSV_INVALID`（detail 带行号）、JSON 语法错误 → `TT_JSON_INVALID`；5 取消：同步计算无队列；6 并发：无共享状态；7 磁盘满：不落盘；8 断电恢复：无持久化 |

## 8. M54 增量验证（拼音，2026-11-22）

| 项           | 方式                                                                                                           | 结果                                                                                                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 拼音纯函数   | `pnpm exec vitest run packages/tools/text-toolbox/src/pinyin.test.ts`                                          | ✅ 9 tests（带声调 `nǐ hǎo`、数字声调 `ni3 hao3`、无声调 `ni hao`、首字母 `nh`、多音字「重庆」→ `chóng qìng`、非汉字保留/移除、换行保留、空串、超 5MB → `TT_TEXT_TOO_LARGE`）                                                                 |
| 质量门禁     | `pnpm gate`（lint → typecheck → test → audit:high → boundary）                                                 | ✅ 全绿：2,489 passed / 1 skipped（242 文件）；audit 仅 2 moderate（无 high/critical）；boundary 805 modules 0 违规                                                                                                                           |
| 覆盖率（R1） | `pnpm vitest run packages/tools/text-toolbox --coverage --coverage.include=packages/tools/text-toolbox/src/**` | ✅ 本包 96.93 / 92.69 / 100 / 100（语句/分支/函数/行），高于 80% 阈值                                                                                                                                                                         |
| chunk（R5）  | `pnpm build` 产物实测                                                                                          | ✅ 工具 chunk `text-toolbox-*.js` = **84,938 B raw / 18,054 B gzip**；拼音字典动态独占 chunk `esm-*.js` = **401,263 B raw / 148,071 B gzip**，合计 **166,125 B gzip < 200KB**；已确认仅 text-toolbox 动态引用该 chunk，拼音页签未打开时不加载 |
| e2e（R3）    | `playwright test e2e/text-toolbox-smoke.spec.ts`（沙箱外执行）                                                 | ✅ **7/7 passed**（含新增「带声调 → 首字母」用例）；同时修复 M47 旧用例两处断言（textarea 的 CRLF 按 HTML 规范归一为 LF、方向切换后重新定位 placeholder），旧用例恢复全绿                                                                     |
| R2 八类映射  | 纯 renderer、无文件 IO                                                                                         | 1–4 **不适用**；超大文本 → `TT_TEXT_TOO_LARGE`（5MB）；5 取消：首次字典加载与转换均在百毫秒级，按同步豁免；6 并发：无共享状态；7 磁盘满：不落盘；8 断电恢复：无持久化                                                                         |
