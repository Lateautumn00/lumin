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

## 9. M60 增量验证（URL 编码 / SQL 格式化，2026-11-23）

| 项           | 方式                                                                                                                                                                                                                                   | 结果                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M60 纯函数   | `pnpm exec vitest run packages/tools/text-toolbox`                                                                                                                                                                                     | ✅ 12 文件 / **136 tests 全部通过**：新增 `url.test.ts` 5 例（组件级与完整模式往返、`!'()*` RFC 3986 锚点、非法 `%` 首个索引定位、UTF-8 字节异常、多重编解码）；新增 `sql.test.ts` 15 例（`''` 转义/双引号/反引号/数字保护、行注释与块注释不参与换行大写、关键字换行快照、`CASE…END` 一级缩进、多词子句合并、压缩幂等两条路径、未闭合按原文保留、空输入）                            |
| 质量门禁     | `pnpm --filter @lumin/tool-text-toolbox typecheck`；`pnpm exec eslint packages/tools/text-toolbox apps/desktop/e2e/text-toolbox-smoke.spec.ts --max-warnings 0`；`pnpm --filter @lumin/desktop exec tsc -p tsconfig.e2e.json --noEmit` | ✅ 三项均 exit 0（`errors.ts` 新增 `TT_INVALID_INPUT`；`decodeUrl` 解码前探测首个非法 `%xx` 并在 detail 携带索引，UTF-8 字节异常仍走 `TT_URL_INVALID`；`encodeUrl` 增组件级/完整模式，默认组件级语义编解码页签不变）                                                                                                                                                                 |
| 覆盖率（R1） | `pnpm exec vitest run packages/tools/text-toolbox --coverage --coverage.include='packages/tools/text-toolbox/src/**'`                                                                                                                  | ✅ 本包 **97.18 / 94.11 / 100 / 100**（语句/分支/函数/行），高于根配置 90/80/90/90 阈值（根 `vitest.config.ts` 未改）；`sql.ts` 与 URL 纯函数由新增测试直接覆盖                                                                                                                                                                                                                      |
| chunk（R5）  | `electron-vite build` 产物实测                                                                                                                                                                                                         | ✅ `text-toolbox-*.js` = **101,792 B raw / 21,330 B gzip**（M60 后）；拼音独占 `esm-*.js` 内容未变（401,263 B raw / 此前实测 148,071 B gzip），合计 **≈169KB gzip < 200KB** 达标，零新增依赖                                                                                                                                                                                         |
| e2e（R3）    | `apps/desktop/e2e/text-toolbox-smoke.spec.ts` 追加 2 用例：URL 编码（中文与空格 → 编码断言 → 解码往返一致）、SQL（字符串与注释 → 美化断言换行/关键字大写/字符串原样 → 压缩幂等）                                                       | ✅ 已执行通过（2026-11-23，随 5 套定向 e2e 汇总 32/32）                                                                                                                                                                                                                                                                                                                              |
| 质量门禁     | `pnpm gate`（lint → typecheck → test → audit:high → boundary）                                                                                                                                                                         | ✅ 全绿（2026-11-24）：lint/typecheck 通过；test 283 文件全过（1 跳过）；audit 仅 2 moderate（无 high/critical）；boundary 929 modules 0 违规                                                                                                                                                                                                                                        |
| R2 八类映射  | 纯 renderer、无文件 IO                                                                                                                                                                                                                 | 1–4 **不适用**；URL 编解码沿用 5MB 上限（`TT_TEXT_TOO_LARGE`），SQL 按 spec §7 不设上限、>200KB 分帧渲染处理中；非法 `%` → `TT_INVALID_INPUT`（detail 含首个索引）、UTF-8 异常 → `TT_URL_INVALID`、解码产物含 U+FFFD → 非阻断警告；未闭合字面量 → 按原文保留并提示；空输入 → 按钮禁用 + 空态提示；5 取消：同步计算无队列；6 并发：无共享状态；7 磁盘满：不落盘；8 断电恢复：无持久化 |

---

## 并入页签：text-editor（M77 合并，原独立工具文档）

# text-editor（文本编辑器）冒烟记录

> 工具：`text-editor`（M56，2026-11-22）· 规格：`docs/spec/text-editor.md`
> 自动化：`apps/desktop/e2e/text-editor-smoke.spec.ts`（真实 Electron + 真实主进程）
> 手工复现环境：Windows x64 · Electron · 本地离线
> 结论：**通过**（自动化 9/9 全绿；R2 中磁盘满、断电恢复、Windows 独占占用等无法稳定自动化的场景见 §2 标注「待手工复核」）。

## 1. 自动化结果

命令：`pnpm --filter @lumin/desktop test:e2e -- text-editor-smoke`（前置 `pnpm --filter @lumin/desktop build`）
结果：**9 passed**（约 19.6s）

| #   | 用例                                                    | 断言                                                                                            | 结果 |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---- |
| 1   | UI：打开文件 → 编辑 → 侧栏切换触发未保存确认 → 放弃更改 | `input[type=file]` 载入、`.cm-content` 可见、NModal「有未保存的更改」、放弃后路由切换且磁盘未变 | 通过 |
| 2   | IPC：UTF-8 + LF 打开，保存为 CRLF                       | 磁盘字节为 `a\r\nb`，重开 `eol=crlf`、内容一致                                                  | 通过 |
| 3   | IPC：GBK 打开后按原编码保存                             | 编码判定 `gbk`，保存后字节完全一致                                                              | 通过 |
| 4   | IPC：只读文件（chmod 0444）保存                         | 返回 `TE_SAVE_FAILED`                                                                           | 通过 |
| 5   | IPC：超过 5MiB 打开                                     | 返回 `TE_TOO_LARGE`，`detail` 为字节数                                                          | 通过 |
| 6   | IPC：mtime 冲突                                         | 先 `TE_FILE_CHANGED`，`force` 后覆盖成功                                                        | 通过 |
| 7   | IPC：save-as 已存在 / 新文件                            | `TE_FILE_EXISTS`；新文件按 EOL 正确写入                                                         | 通过 |
| 8   | IPC：二进制 / 缺失 / 目录 / 非法 name                   | 分别 `TE_DECODE_FAILED` / `TE_NOT_FOUND` / `TE_INVALID_PATH` / `TE_INVALID_PATH`                | 通过 |
| 9   | IPC：中文/空格路径 + UTF-8 BOM 往返                     | 编码 `utf8-bom`、`eol=crlf`、保存后 BOM 与正文一致                                              | 通过 |

## 2. R2 八类异常逐条

| 类别             | 场景与验证                                                                                                                                | 结果                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1. 中文/空格路径 | e2e #1/#9 使用 `说明 文档.txt`、`中文 目录/说明 文档.txt` 打开与保存                                                                      | 通过（自动化）                                       |
| 2. 文件被占用    | 单测注入 `EBUSY`/`EPERM` 断言 `TE_LOCKED`；e2e #4 只读文件保存 → `TE_SAVE_FAILED`。Windows 下真实独占锁（另一进程长期持有句柄）需人工构造 | 部分覆盖，真实独占场景待手工复核                     |
| 3. 加密/损坏文件 | NUL 字节二进制伪装 `.txt` → `TE_DECODE_FAILED`（单测 + e2e #8）；加密 PDF/Office 等非文本文件同一路径处理                                 | 通过（自动化）                                       |
| 4. 超大文件      | >5MiB → `TE_TOO_LARGE`，`detail` 为实际字节数（单测 + e2e #5）                                                                            | 通过（自动化）                                       |
| 5. 任务取消      | 三个通道均为同步 IPC，无长任务与取消入口                                                                                                  | 不适用                                               |
| 6. 并发溢出      | 保存前比对 `expectedMtimeMs`，冲突 → `TE_FILE_CHANGED`，`force` 才覆盖；`writeAtomic` 以临时文件 + rename 提交，不会出现半截文件          | 通过（mtime 冲突自动化；多实例高频写入建议手工复核） |
| 7. 磁盘满        | 单测注入 `EACCES`/`ENOSPC`/无 errno 异常 → `TE_SAVE_FAILED`，原文件未被破坏。真实磁盘写满无法在 CI 稳定构造                               | 代码路径已覆盖，真实磁盘满待手工复核                 |
| 8. 断电恢复      | 写入走 `writeAtomic`（临时文件 + 原子 rename），中途中断不会破坏原文件；真实断电无法自动化                                                | 依赖 writeAtomic 保证，待手工复核                    |

## 3. 单测 / 覆盖率 / chunk

### 3.1 单测

`pnpm exec vitest run packages/tools/text-editor`：**69 passed / 8 files**（formats、errors、schema、encoding、manifest、renderer/client、renderer/createEditor、node）。

### 3.2 覆盖率（`pnpm coverage`，v8）

- `packages/tools/text-editor/src/**/*.ts` 阈值四项 80%，实测：**语句 97.38%（186/191） / 分支 93.81%（91/97） / 函数 97.5%（39/40） / 行 97.67%（168/172）**，达标。
- 全仓阈值 60%，实测语句 94.01% / 分支 86.92% / 函数 92.37% / 行 95.72%，退出码 0（2753 passed / 263 files）。

### 3.3 chunk 体积（R5）

构建产物 `apps/desktop/out/renderer/assets/`，工具 chunk + 其独占 CodeMirror chunk（M67 起 CodeMirror 封装上提 `packages/ui/create-editor`，与 markdown-tool 共享）：

| 文件                                          | raw (B)     | gzip (B)    |
| --------------------------------------------- | ----------- | ----------- |
| `text-editor-C-XvnTge.js`                     | 27,578      | 7,187       |
| `dist-ChOqyWHd.js`（@codemirror/view）        | 377,367     | 99,976      |
| `dist-B1D0oc76.js`（@codemirror/state）       | 121,707     | 32,923      |
| `dist-B16xA5iq.js`（@codemirror/commands 等） | 177,274     | 44,312      |
| `dist-_5SobO52.js`（@codemirror/search）      | 41,325      | 10,996      |
| **合计**                                      | **745,251** | **195,394** |

结论：**195,394 B gzip < 200KB**，达标（CodeMirror 相关 chunk 自 M67 起与 markdown-tool 共享，仍按单工具预算计）。

**R5 取舍说明**：初版引入 `@codemirror/lang-javascript`、`lang-json`、`lang-markdown` 与 `theme-one-dark`，合计 gzip 约 315KB 超限。按规格的降级顺序依次移除 JavaScript/Markdown/JSON 语言包与 one-dark 主题后达标，因此**首版为纯文本编辑器（行号、撤销/重做、查找、高亮当前行）**，无语法高亮与深色编辑器主题；`formats.languageForPath` 保留备用，后续若拿到 chunk 预算再接入。

## 4. 门禁结论

| 命令                                                         | 结果                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                  | 通过（text-editor 与壳改动文件无告警）                                                          |
| `pnpm typecheck`                                             | `@lumin/tool-text-editor`、`@lumin/desktop` 通过                                                |
| `pnpm test`                                                  | 通过（含本工具 69 例）                                                                          |
| `pnpm coverage`                                              | 退出码 0，全仓与包阈值均达标                                                                    |
| `pnpm audit:high`                                            | 无 high/critical（2 moderate），退出码 0                                                        |
| `pnpm boundary`                                              | 863 modules，无违规                                                                             |
| `pnpm --filter @lumin/desktop build`                         | 通过                                                                                            |
| `pnpm --filter @lumin/desktop test:e2e -- text-editor-smoke` | 9 passed                                                                                        |
| `pnpm gate`                                                  | 通过（lint → typecheck → test → audit → boundary 全绿；此前记录的 docx2pdf 测试类型问题已修复） |

## 5. 待手工复核清单

1. Windows 下真实文件独占占用（另一进程持有写句柄）保存 → 预期 `TE_LOCKED`/`TE_SAVE_FAILED`。
2. 真实磁盘写满（或配额限制）保存 → 预期 `TE_SAVE_FAILED`，原文件内容不变。
3. 保存过程中强制结束进程后重启 → 原文件完整，无残留临时文件（依赖 `writeAtomic`）。

---

## 并入页签：text-diff（M77 合并，原独立工具文档）

# 文本对比（text-diff）冒烟记录 — M32 / M62

> 版本：v0.2.0 · 日期：2026-11-20（M32）/ 2026-11-24（M62 增量）· 关联：`docs/spec/text-diff.md`
> 工具形态：M32 纯 renderer；**M62 起文本比较纯 renderer + 文件比较 2 同步主进程通道**（`pick-file` / `compare-files`）；**M63 增 `copy-text`（3 通道）**，零新增第三方运行时依赖（zod 为 IPC schema 既有依赖）。

## 1. 环境

| 项       | 值                                                   |
| -------- | ---------------------------------------------------- |
| OS       | Windows（x64）                                       |
| 运行形态 | `pnpm build` + Playwright 驱动 Electron 45（真实壳） |
| 网络     | 全程离线（无任何请求）                               |

## 2. 功能冒烟（e2e，4/4 通过）

命令：`pnpm --filter @lumin/desktop exec playwright test e2e/text-diff-smoke.spec.ts`

| #   | 用例                                 | 断言                                                                         | 结果 |
| --- | ------------------------------------ | ---------------------------------------------------------------------------- | ---- |
| 1   | 页面加载 + 空态引导 + 示例统计与并排 | 侧边栏可进入；空态文案可见；示例后统计 `+3/-2/2`；并排视图 5 行              | 通过 |
| 2   | 忽略大小写联动 + 并排/统一视图切换   | 区分大小写 `+2/-2/0`；忽略后 `+1/-1/1`；统一视图 3 行且含 `-Beta` / `+Gamma` | 通过 |
| 3   | 复制统一 diff + 交换 + 清空          | 系统剪贴板含 `+++ 右侧` 与 `-香蕉`；交换后左右值互换；清空后空态恢复         | 通过 |
| 4   | 超限报错与清空恢复                   | 20,001 行 → `TD_TOO_LARGE`，统计与结果区隐藏；清空后错误消失且空态恢复       | 通过 |

单测：`packages/tools/text-diff` 共 **33 例**（diff 26 / errors 5 / manifest 2）全绿。

覆盖率（lcov 实测）：

| 文件          | lines   | functions | branches |
| ------------- | ------- | --------- | -------- |
| `diff.ts`     | 126/136 | 19/19     | 74/86    |
| `errors.ts`   | 5/5     | 2/2       | 6/6      |
| `manifest.ts` | 1/1     | 0/0       | 0/0      |
| **本包合计**  | 132/142 | 21/21     | 80/92    |

全仓 coverage：Statements 93.58% / Branches 85.78% / Functions 91.49% / Lines 95.44%（1786 passed / 1 skipped）。

## 3. R5 体积实测（`pnpm build`）

| 项                             | 实测                                                | 上限       | 结论 |
| ------------------------------ | --------------------------------------------------- | ---------- | ---- |
| 工具 chunk（renderer）         | 27,941 B raw / **7,774 B gzip**                     | 200KB gzip | 达标 |
| 独占依赖 chunk                 | 0（vue / naive-ui / `@lucide/vue` 均为共享 vendor） | —          | 达标 |
| 运行时资产（worker/wasm/模型） | 无                                                  | —          | —    |

## 4. R2 八类异常映射（AGENTS §7.3）

| #   | 异常类        | 本工具适配结论                                                                                                     | 验证方式                |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| 1   | 中文/空格路径 | **不适用**：无文件路径读写；输入含中文/空格由示例与「忽略空白」用例覆盖                                            | 静态审查 + e2e 1/2      |
| 2   | 文件被占用    | **不适用**：无文件操作                                                                                             | 静态审查                |
| 3   | 加密文件      | **不适用**：无文件操作                                                                                             | 静态审查                |
| 4   | 超大文件      | **映射为超大文本**：单侧 >20,000 行或 >1,000,000 字符 → `TD_TOO_LARGE`；行数与字符数边界单测覆盖，UI 由 e2e 4 覆盖 | 单测 + e2e 4            |
| 5   | 任务取消      | **不适用**：全部同步纯函数，无长任务（spec §2.4 登记加载态豁免）                                                   | 静态审查                |
| 6   | 并发溢出      | **不适用**：无 IPC / 队列；连续输入为同步重算，LCS 预算保证有界耗时                                                | 静态审查 + 预算降级单测 |
| 7   | 磁盘满        | **不适用**：无写盘；剪贴板失败映射 `TD_CLIPBOARD_FAILED`（单测覆盖错误形状）                                       | 单测                    |
| 8   | 断电恢复      | **不适用**：无持久化，重启即空态（双输入为空 + 引导卡）                                                            | 静态审查 + e2e 1/4      |

## 5. 质量门禁

| 命令                                                   | 结果                            |
| ------------------------------------------------------ | ------------------------------- |
| `pnpm exec vitest run packages/tools/text-diff`        | 33/33 通过                      |
| `pnpm typecheck`                                       | 通过（32 包）                   |
| `pnpm lint`                                            | 通过                            |
| `pnpm coverage`                                        | 通过（本包阈值 80% 全绿）       |
| `pnpm gate`（lint→typecheck→test→audit:high→boundary） | 通过                            |
| `pnpm build`                                           | 通过（工具 chunk 7,774 B gzip） |
| e2e `text-diff-smoke.spec.ts`                          | 4/4 通过                        |

---

## 6. M62 增量（2026-11-24：词级高亮 + 文件比较）

### 6.1 功能冒烟（e2e，6/6 通过，含 M32 回归 4 例）

命令：`pnpm --filter @lumin/desktop exec playwright test e2e/text-diff-smoke.spec.ts`

| #   | 用例                               | 断言                                                                                                                                                   | 结果 |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| 5   | M62 词级/字符级粒度开关            | 默认词级左单元分段 `['hello ', 'brave', ' world']`；切字符级变 `['hello ', 'brav', 'e', ' world']`；切回词级恢复                                       | 通过 |
| 6   | M62 文件比较（文本/二进制/错误态） | 主进程回填 dialog 免原生弹窗：文本模式统计 `+1/-1/1`；二进制卡「偏移 3（块 1/1）」；缺失路径 `TD_FILE_READ_FAILED` 中文 + 重试；直连通道回包三形状断言 | 通过 |

单测：`packages/tools/text-diff` 共 **78 例**（diff 36 / node 27 / schema 7 / errors 6 / manifest 2）全绿。

覆盖率（lcov 实测，本包 ≥80% 阈值）：

| 文件          | lines            | branches         |
| ------------- | ---------------- | ---------------- |
| `diff.ts`     | 169/179（94.4%） | 122/134（91.0%） |
| `node.ts`     | 81/81（100%）    | 61/61（100%）    |
| `schema.ts`   | 4/4              | 0/0              |
| `errors.ts`   | 5/5              | 6/6              |
| `manifest.ts` | 1/1              | 0/0              |
| **本包合计**  | 260/270（96.3%） | 189/201（94.0%） |

### 6.2 R5 体积复测（`pnpm build`）

| 项                             | 实测                                                                | 上限       | 结论 |
| ------------------------------ | ------------------------------------------------------------------- | ---------- | ---- |
| 工具 chunk（renderer）         | 41,909 B raw / **10,903 B gzip**（M63 copy-text 后；M62 为 10,782） | 200KB gzip | 达标 |
| 独占依赖 chunk                 | 0（zod 仅主进程，不进 renderer）                                    | —          | 达标 |
| 运行时资产（worker/wasm/模型） | 无                                                                  | —          | —    |

### 6.3 R2 八类异常映射（M62 增量）

| #   | 异常类        | M62 适配结论                                                                                                                  | 验证方式                  |
| --- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | 中文/空格路径 | **已适用**：文件比较支持含空格路径（e2e 用 `left file.txt` 覆盖）；中文路径由 `basename` 标签与 zod 非空校验兜底              | e2e 6 + 单测              |
| 2   | 文件被占用    | **映射**：`stat`/`read` 失败 → `TD_FILE_READ_FAILED`（errno detail），UI 行内中文 + 重试                                      | 单测（注入 ENOENT/EPERM） |
| 3   | 加密文件      | **不适用**：无格式解密语义；任意二进制按二进制模式比对，不报错                                                                | 静态审查                  |
| 4   | 超大文件      | **映射**：>200MB → `TD_FILE_TOO_LARGE`（stat 预检）；>1MB 或含 NUL 或 >20,000 行 → 二进制/兜底；文本行数超限 → `TD_TOO_LARGE` | 单测三条件判定            |
| 5   | 任务取消      | **不适用**：同步通道最坏 1–2s 短阻塞（spec §2.4 登记豁免），不走三段式                                                        | 静态审查                  |
| 6   | 并发溢出      | **不适用**：同步 IPC 串行执行，无队列；二进制比对内存 O(1)（1MB/块）                                                          | 静态审查 + 跨块单测       |
| 7   | 磁盘满        | **映射**：读盘失败同 `TD_FILE_READ_FAILED`（工具只读不写盘）                                                                  | 单测（结构化错误透传）    |
| 8   | 断电恢复      | **不适用**：无持久化，结果为即时计算，重启回空态                                                                              | 静态审查 + e2e 6          |

### 6.4 质量门禁（M62）

| 命令                                                   | 结果                              |
| ------------------------------------------------------ | --------------------------------- |
| `pnpm exec vitest run packages/tools/text-diff`        | 82/82 通过（M63 增 copy-text 后） |
| `pnpm -C packages/tools/text-diff typecheck`           | 通过                              |
| `pnpm eslint packages/tools/text-diff …`               | 通过                              |
| e2e `text-diff-smoke.spec.ts`                          | 6/6 通过                          |
| `pnpm build`                                           | 通过（工具 chunk 10,903 B gzip）  |
| `pnpm gate`（lint→typecheck→test→audit:high→boundary） | 见 MR 记录                        |

## 7. M63 附带修复（2026-11-24）：统一 diff 复制改主进程剪贴板

- **现象**：e2e 点击「复制统一 diff」后主进程 `clipboard.readText()` 仍为旧内容，用例失败；真实窗口未聚焦时同样可能静默失败（`NotAllowedError: Document is not focused`）。
- **根因**：复制走 renderer `navigator.clipboard.writeText`，依赖窗口焦点与剪贴板权限。
- **修复**：新增同步通道 `text-diff:copy-text`（`{ text }` 非空且 ≤4,000,000 字符 → `{ ok: true }`），主进程 `clipboard.writeText` 写入；空/超限 → `INVALID_INPUT`，写入异常 → `TD_CLIPBOARD_FAILED`（沿用既有错误码）。
- **回归**：`text-diff` 单测全绿（新增 copy-text 三用例 + schema 校验 + 默认依赖断言）；`text-diff-smoke.spec.ts` 6/6 通过。

## M77 合并后 chunk / 资产复测（2026-11-25）

- 工具 chunk：`text-toolbox-*.js` 165.7KB raw / **36.6KB gzip**（CodeMirror 6 最小集随宿主按需加载）→ R5 达标（<200KB gzip）
- 运行时资产：无新增（零新增二进制）
- 异常场景映射：并入「编辑 / 对比」页签沿用本节前文原工具 R2 记录
