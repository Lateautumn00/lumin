# 深色主题切换（theme-dark）任务单

> 里程碑：M19 · 规格：`docs/spec/theme-dark.md` · 依据：`docs/opencode/plan.md` Q23 / §4.19
> 约束：零新增依赖；tokens 单源；Naive 覆盖只在 theme 配置层；不新增 IPC；不动工具代码

## T1 tokens 单源补暗色（`assets/main.css`）

- [x] `:root` 补 `--lumin-color-warning` / `-error` / `-success` / `-primary-soft`
- [x] 新增 `:root[data-theme='dark']` 覆盖全部颜色变量（值见 spec §2）
- [x] 两处声明 `color-scheme: light|dark`
- 验证：`pnpm --filter @lumin/desktop build` 通过；产物 CSS 含 `data-theme='dark'`

## T2 纯函数模块（`theme/theme.ts`、`theme/naive.ts`）

- [x] `parseThemeMode` / `resolveTheme` / `applyThemeAttribute` / 常量导出
- [x] `buildThemeOverrides(read)` 按 spec §3.2 映射，空值回落 `''` 不抛
- 验证：单测覆盖合法/非法/矩阵分支

## T3 状态与挂载（`stores/theme.ts`、`main.ts`、`App.vue`）

- [x] store：`mode`/`resolved`/`load`/`setMode`/`matchMedia` change 监听（仅 system 生效）
- [x] `main.ts`：创建 Pinia 后 `await theme.load()` 再挂载；失败 catch 不阻断
- [x] `App.vue`：`:theme` 切换 `darkTheme`；`watch(resolved)` + `nextTick` 重建 overrides
- 验证：类型检查通过；手工切换无 Naive 组件颜色残留

## T4 设置页（`SettingsView.vue`、`i18n/zh-CN.ts`）

- [x] `NRadioGroup` 三选一 + 提示文案；写入中禁用，失败就地提示并回滚选中
- [x] 新增 i18n key：`shell.settings.theme` / `themeSystem` / `themeLight` / `themeDark` / `themeHint` / `themeSaveFailed`
- 验证：设置页手工切换即时生效

## T5 主进程防白闪（`main/index.ts`）

- [x] 启动读取 `shell.theme.mode` + `nativeTheme.shouldUseDarkColors` 计算窗口底色；`createWindow`/`activate` 复用
- 验证：`pnpm --filter @lumin/desktop build`；冷启动首帧无白屏

## T6 单测

- [x] `theme/theme.test.ts`：三值解析、非法回落、`resolveTheme` 4 矩阵、属性写入
- [x] `theme/naive.test.ts`：映射键齐全、值不含 `var(`、读取器返回空串时的兜底
- [x] `stores/theme.test.ts`：默认 system、存量 dark、系统 change、setMode 持久化、写失败抛出、读取失败回落
- 验证：`pnpm exec vitest run --project apps/desktop`（或 `apps/*`）全绿

## T7 e2e（`apps/desktop/e2e/theme-smoke.spec.ts`）

- [x] 用例 1：默认「跟随系统」+ `data-theme` 与 `matchMedia` 一致
- [x] 用例 2：切深色 → 属性/`--lumin-color-bg` 断言，再切浅色 → 复原
- [x] 用例 3：切深色后 `reload()` → 仍为深色（持久化）
- [x] 用例 4：写回 `system` 清场，避免污染后续用例
- 验证：`pnpm build` 后 `pnpm --filter @lumin/desktop exec playwright test e2e/theme-smoke.spec.ts`

## T8 文档登记

- [x] `docs/smoke/theme-dark.md`（R2 八类映射/不适用说明 + e2e 结果 + 手工目视）
- [x] `docs/opencode/plan.md`：§1 加 Q23、标题改 Q1–Q23、§4.19、里程碑 M19
- [x] `AGENTS.md` §5.2 补一句：明暗切换仅通过 tokens + `data-theme`，禁止逐组件改色
- [x] `CHANGELOG.md` Unreleased 增 M19 条目；`README.md` 功能表增「外观主题」行

## T9 门禁与提交

- [x] `pnpm coverage`（全仓 ≥60%，theme 纯函数 ≥80%）
- [x] `pnpm gate` 退出码 0
- [x] 三个中文提交：`feat(theme)` / `test(theme)` / `docs(theme)`；**不推送**

## 验收断言（可复现）

1. 设置页选「深色」→ `document.documentElement.dataset.theme === 'dark'`，且 `--lumin-color-bg` 计算值为 `#0b1220`
2. 重启应用 → 仍为深色（settings.json `shell.theme.mode` 为 `dark`）
3. 选「跟随系统」→ `data-theme` 等于 `matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'`
4. 任意工具页在深色下无白底区块（PDF 预览画布除外）
