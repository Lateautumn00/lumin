# 时间工具箱冒烟记录（M30）

> 环境：Windows 10.0.19045 · Electron 45 · 分支：`feature/m30-time-toolbox`
> 日期：2026-11-20 · 工具：`@lumin/tool-time-toolbox` v0.1.0

## 1. 冒烟总览

| #   | 冒烟项                                 | 方式                                          | 结果                                                          |
| --- | -------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| 1   | 单测（时间/时区/时长/Cron/错误码/清单） | `pnpm vitest run packages/tools/time-toolbox` | ✅ 37 tests（time 17 / cron 16 / errors 3 / manifest 1）       |
| 2   | 覆盖率（R1 核心 ≥80%）                 | `pnpm coverage`                               | ✅ 本包 time 100%、errors 100%、manifest 100%、cron 127/131 行（96.9%） |
| 3   | 质量门禁                               | `pnpm gate`                                   | ✅ lint / typecheck / test / audit / boundary 全绿             |
| 4   | e2e 冒烟（R3）                         | `playwright test e2e/time-toolbox-smoke.spec.ts` | ✅ 3/3：四页签+默认结果、时间戳双向+非法输入、Cron 默认与报错恢复 |
| 5   | 构建                                   | `pnpm build`                                  | ✅ renderer 产物正常，`time-toolbox-*.js` 生成                 |
| 6   | chunk 体积（R5 <200KB gzip）           | 构建产物实测                                  | ✅ **42,160 B raw / 10,491 B gzip**，独占依赖 chunk 为 0       |

## 2. R2 八类异常清单

> 本工具为纯 renderer 时间计算，无文件 IO、无长任务、无落盘、无联网；按 `docs/smoke/shell.md` §2 约定逐类映射。

| 类别             | 适用性                                              | 验证级别   | 记录                                                                                                                         |
| ---------------- | --------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. 中文/空格路径 | 不适用（无文件路径）                                | 单测 + e2e | 补充验证：时间戳输入前后空格可解析（`parseTimestamp(' 1700000000 ')`）✅；Cron 表达式多余空白归一 ✅；自定义时区中文报错文案 ✅ |
| 2. 文件被占用    | 不适用（无文件 IO）                                 | —          | —                                                                                                                            |
| 3. 加密文件      | 不适用（无文件 IO）                                 | —          | —                                                                                                                            |
| 4. 超大文件      | 不适用（无文件输入）                                | 单测       | 等价边界：时间戳超出 Date 可表示范围（±8.64e15ms）→ `TT_OUT_OF_RANGE` ✅；日期年份越界/非法日期拒绝 ✅                        |
| 5. 任务取消      | 不适用（全同步纯函数 <1ms，无任务队列；spec §2.5 豁免） | —          | —                                                                                                                            |
| 6. 并发溢出      | 不适用（无队列；单次点击/输入即时计算）             | —          | —                                                                                                                            |
| 7. 磁盘满        | 不适用（不落盘）                                    | —          | 相关兜底：剪贴板写入失败 → `TT_CLIPBOARD_FAILED` 中文提示（代码分支）                                                         |
| 8. 断电恢复      | 不适用（无持久化；刷新后恢复默认值）                | —          | 时区列表/输入不持久化，重开恢复默认，符合预期                                                                                 |

## 3. 时区数据说明

- 时区名称与 UTC 偏移全部来自运行时 `Intl.DateTimeFormat`（Electron 内置 ICU），不引入时区数据库依赖。
- 自定义时区以 `Intl` 构造校验，非法名称行内提示 `TT_INVALID_INPUT`；重复添加去重。
- 时区列表每秒刷新，离开页面（`onUnmounted`）清理定时器。

## 4. 验证记录（2026-11-20）

| 命令                                                          | 结果                                              |
| ------------------------------------------------------------- | ------------------------------------------------- |
| `pnpm exec vitest run packages/tools/time-toolbox`            | ✅ 4 files / 37 tests                             |
| `pnpm typecheck`                                              | ✅ 全仓通过                                       |
| `pnpm lint`                                                   | ✅ 无告警                                         |
| `pnpm coverage`                                               | ✅ 阈值全绿（本包 ≥80%）                          |
| `pnpm gate`                                                   | ✅ 全绿                                           |
| `pnpm build`                                                  | ✅ 产物正常                                       |
| `pnpm --filter @lumin/desktop exec playwright test e2e/time-toolbox-smoke.spec.ts` | ✅ 3 passed |

## 5. R5 体积记录

- 口径：gzip；`time-toolbox-CmDKRGgX.js` = **42,160 B raw / 10,491 B gzip**（远低于 200KB gzip）。
- 独占依赖 chunk：0（vue / naive-ui / @lucide/vue 为多工具共享 vendor）。
- 无运行时资产（无 worker/wasm/模型/字体），无需单列。
