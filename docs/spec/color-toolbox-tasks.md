# 颜色工具箱（color-toolbox）任务单 — M29

> 关联：`docs/spec/color-toolbox.md`（验收依据）· 分支 `feature/m29-color-toolbox`（基于 `feature/m28-batch-ocr`）
> 状态：**已完成**（2026-11-20）

## T1 工具包骨架

- [x] 新建 `packages/tools/color-toolbox/{package.json,tsconfig.json}`（exports 仅 `./manifest` 与 `./renderer/*`，复制 `unit-converter` 形态，无 node.ts）
- [x] `src/manifest.ts`：`id color-toolbox / 名称 颜色工具箱 / icon palette / category misc / order 80 / version 0.1.0`
- [x] `src/errors.ts`：`CT_INVALID_COLOR`、`CT_CLIPBOARD_FAILED` + `toolError/errorMessage`
- [x] `src/color.ts`：§3 全部纯函数（`Rgb/Hsl/ColorFormat` 类型、`DEFAULT_COLOR`、10 色阶、4 组调和、WCAG）

## T2 单元测试（≥80%）

- [x] `src/color.test.ts`：HEX/RGB/HSL 解析边界、互转往返容差、亮度/对比度（黑白 = 21）、AA/AAA 阈值边界、mix clamp、色阶长度与明暗方向、色相旋转与四组调和、注入随机源
- [x] `src/errors.test.ts`：码集合、中文文案、detail 省略、未知码回退
- [x] `src/manifest.test.ts`：id/name/icon/order/version 契约

## T3 Renderer

- [x] `src/renderer/ToolView.vue`：§2 五卡片 + 三态；Tailwind + tokens（`--lumin-color-*` / `--lumin-radius-md`）；图标仅 `@lucide/vue`（`Dices/Copy/ArrowLeftRight`）；复制反馈 1.2s 自动复位；`onUnmounted` 清理定时器
- [x] 无 `console`/`any`/`!` 非空断言；不引原生依赖

## T4 壳接线

- [x] `apps/desktop/electron.vite.config.ts` 两条别名
- [x] `apps/desktop/package.json` workspace 依赖
- [x] `apps/desktop/src/tool-manifests.ts` 1 行（`example` 前）
- [x] `apps/desktop/src/renderer/src/tools/color-toolbox.vue` 薄页面
- [x] `AppSidebar.vue` iconMap 加 `palette: Palette`
- [x] 根 `vitest.config.ts` 增 `packages/tools/color-toolbox/src/**/*.ts` 80% 阈值
- [x] `pnpm install` 生成 workspace 链接

## T5 e2e

- [x] `apps/desktop/e2e/color-toolbox-smoke.spec.ts` 3 用例（`clickSidebarTool(page, '颜色工具箱')`）
- [x] 用例 1：默认 `#3B82F6` + `rgb(59, 130, 246)` + `hsl(217, 91%, 60%)`
- [x] 用例 2：输入 `#12` → `CT_INVALID_COLOR` 中文提示；改 `#EF4444` → `rgb(239, 68, 68)` 且提示消失
- [x] 用例 3：默认对比度 `3.68 : 1` + 正文 AA 未通过 / 大字 AA 通过；点击示例色「红」后主色联动

## T6 文档与路线图

- [x] `docs/smoke/color-toolbox.md`：R2 八类映射 + 单测/覆盖率/门禁/e2e/build/chunk 实测记录
- [x] `docs/opencode/plan.md`：§1 增 Q31、§4.29 新增条目、§6 增 M29 行
- [x] `CHANGELOG.md` Unreleased 追加 M29 条目
- [x] `README.md` / `README.en.md` 工具表各增 1 行

## T7 验证与提交

- [x] `pnpm gate`（lint→typecheck→test→audit→boundary）：1649 passed / 1 skipped，边界 0 违规
- [x] `pnpm coverage`（本包 99.19/95.65/100/100，全仓 93.45/85.47/90.96/95.32）
- [x] `pnpm build`（chunk 27,357 B raw / 7,799 B gzip）+ e2e 3/3
- [x] 3 个中文提交：`feat(tool): 新增颜色工具箱 color-toolbox` / `test(color-toolbox): 补充单元与 e2e 冒烟用例` / `docs(color-toolbox): 同步规格、冒烟记录与路线图`
- [x] 不推送、不建 MR（等用户指令）
