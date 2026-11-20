# 时间工具箱（time-toolbox）任务单 — M30

> 关联：`docs/spec/time-toolbox.md`（验收依据）· 分支 `feature/m30-time-toolbox`（基于 `feature/m29-color-toolbox`）
> 状态：**已完成**（2026-11-20）

## T1 工具包骨架

- [x] 新建 `packages/tools/time-toolbox/{package.json,tsconfig.json}`：exports 仅 `./manifest` 与 `./renderer/*`；deps 仅 `@lucide/vue` / `@lumin/plugin-api` / `@lumin/shared` / `naive-ui` / `vue`；tsconfig 照 text-toolbox（`types: ["node"]`）
- [x] `src/manifest.ts`：`id time-toolbox / 名称 时间工具箱 / icon clock / category compute / order 70 / version 0.1.0`
- [x] `src/errors.ts`：`TT_INVALID_INPUT`、`TT_OUT_OF_RANGE`、`TT_CLIPBOARD_FAILED` + `toolError/errorMessage`
- [x] `src/time.ts`：§3.1 全部纯函数 + `COMMON_TIME_ZONES`
- [x] `src/cron.ts`：§3.2 全部纯函数

## T2 单元测试（≥80%）

- [x] `src/time.test.ts`：10/13 位自动识别与手动单位、负数、非数字/空、范围上下界；`parseLocalDateTime` 合法/非法日期（2026-02-30、缺秒、空格分隔）；`formatDateTime` 本地/UTC、`formatIso`、`formatOffset`（含 UTC 归一）、`isValidTimeZone`；`formatDuration` 正负与各总量
- [x] `src/cron.test.ts`：`*`/数字/区间/列表/步长/组合；周 7→0；越界与倒置报错；`parseCron` 字段数错误；`describeCron` 五个典型句式；`nextCronRuns` 每 5 分钟、工作日 9 点、日/周「或」语义、无解返回空
- [x] `src/errors.test.ts`、`src/manifest.test.ts`：码集合/中文文案/detail 省略/未知码回退；manifest 契约

## T3 Renderer

- [x] `src/renderer/ToolView.vue`：§2 四页签（`NTabs` + `#tab` 插槽 + 内容 `v-if`）；Tailwind + tokens（`--lumin-color-*` / `--lumin-radius-md`）；图标仅 `@lucide/vue`（`Clock/Copy/ArrowLeftRight/CalendarClock/Timer`）；复制反馈 1.2s 复位；时区 1s 定时器 `onUnmounted` 清理
- [x] 每个 Tab 独立错误行（`role="alert"`，码 + 中文）；无 `console`/`any`/`!` 非空断言

## T4 壳接线（6 处）

- [x] `apps/desktop/electron.vite.config.ts`：manifest + renderer 两条别名
- [x] `apps/desktop/package.json`：workspace 依赖（字母序）
- [x] `apps/desktop/src/tool-manifests.ts`：import + `exampleManifest` 前 1 行
- [x] `apps/desktop/src/renderer/src/tools/time-toolbox.vue`：薄页面
- [x] `AppSidebar.vue`：iconMap `clock: Clock`（补 import）
- [x] 根 `vitest.config.ts`：`packages/tools/time-toolbox/src/**/*.ts` 80% 阈值
- [x] `pnpm install --no-frozen-lockfile --prefer-offline` 生成 workspace 链接

## T5 e2e

- [x] `apps/desktop/e2e/time-toolbox-smoke.spec.ts` 3 用例（`clickSidebarTool(page, '时间工具箱')`）
- [x] 用例 1：4 页签可见 + 默认时间戳产出 ISO/UTC/偏移
- [x] 用例 2：`1700000000` → `2023-11-14T22:13:20.000Z` / `2023-11-14 22:13:20`；`abc` → `TT_INVALID_INPUT` 后恢复
- [x] 用例 3：Cron 默认描述「每 5 分钟」+ 5 条触发时间；`99 * * * *` → `TT_INVALID_INPUT` 后恢复

## T6 文档与路线图

- [x] `docs/smoke/time-toolbox.md`：R2 八类映射 + 单测/覆盖率/门禁/e2e/build/chunk 实测记录
- [x] `docs/opencode/plan.md`：§1 增 Q32（表头 Q1–Q32）、§4.30 新增条目、§6 增 M30 行
- [x] `CHANGELOG.md` Unreleased 追加 M30 条目
- [x] `README.md` / `README.en.md` 工具表各增 1 行（顺带补齐颜色工具箱行缺失的表格竖线）

## T7 验证与提交

- [x] `pnpm exec vitest run packages/tools/time-toolbox`
- [x] `pnpm typecheck` / `pnpm lint`
- [x] `pnpm coverage`（本包 ≥80%）
- [x] `pnpm gate`
- [x] `pnpm build` + `playwright test e2e/time-toolbox-smoke.spec.ts`
- [x] 3 个中文提交：`feat(time-toolbox): ...` / `test(time-toolbox): ...` / `docs(time-toolbox): ...`
- [x] 不推送、不建 MR（等用户指令）
