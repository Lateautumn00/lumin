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
