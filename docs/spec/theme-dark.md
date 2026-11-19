# 深色主题切换（theme-dark）字段级功能清单

> 里程碑：M19（2026-11-19）· 能力类型：壳级平台能力（无新工具包）
> 依据：`docs/opencode/plan.md` Q23 / §4.19；`AGENTS.md` §5.2（tokens 单源）/ §5.1（禁止魔法值）
> 目标：tokens 单源补暗色变量集 → Naive UI 主题层切换 → 设置页三选一并持久化 → 全工具零改动受益

## 0. 范围边界

**做**：

* 主题模式三选一：`跟随系统`（默认）/ `浅色` / `深色`
* tokens 暗色变量集（`html[data-theme='dark']` 覆盖，颜色仍单一来源 main.css）
* Naive UI `NConfigProvider` 按解析结果切换 `darkTheme`，并随主题重算 `themeOverrides`
* 设置持久化键 `shell.theme.mode`（走既有 `window.lumin.settings`，不新增 IPC）
* 跟随系统：监听 `matchMedia('(prefers-color-scheme: dark)')` 的 `change`，实时切换
* 启动应用避免白屏闪烁：主进程按持久化模式设置窗口 `backgroundColor`；渲染进程加载主题后再挂载

**不做**：

* 单工具独立主题 / 自定义配色 / 主题市场
* 主进程 nativeTheme 强制改写（不做 `nativeTheme.themeSource`，避免影响系统级行为）
* 组件内 `:deep()` 覆盖 Naive 样式（仍只在 theme 配置层）
* 为各工具逐个适配硬编码色（仅补 tokens 缺失变量，工具代码不改）

## 1. 主题模式（字段级）

| 项    | 控件                | 取值                          | 默认       | 行为                  |
| ---- | ----------------- | --------------------------- | -------- | ------------------- |
| 主题模式 | `NRadioGroup` 三选一 | `system` / `light` / `dark` | `system` | 选中即持久化并立即生效（无需保存按钮） |

* 文案：`跟随系统` / `浅色` / `深色`；下方提示「跟随系统时将随 Windows 深浅色设置自动切换」
* 非法存量值（非三值之一）一律回落 `system`（纯函数 `parseThemeMode` 覆盖）
* 持久化失败：保留当前选择、就地展示结构化错误文案（不弹窗）

## 2. tokens 暗色变量集（`apps/desktop/src/renderer/src/assets/main.css`）

* `:root`（亮色）补齐 4 个已被工具引用但缺失的变量：`--lumin-color-warning`、`--lumin-color-error`、`--lumin-color-success`、`--lumin-color-primary-soft`
* 新增 `:root[data-theme='dark']` 覆盖全部颜色变量；两处均声明 `color-scheme`
* 变量清单（值只在 main.css 出现一次）：
  `--lumin-color-primary` / `-hover` / `--lumin-color-bg` / `-surface` / `-border` / `-text` / `-text-secondary` / `-danger` / `-error` / `-warning` / `-success` / `-primary-soft`
* 圆角/间距/字号两主题共用，不覆盖

| 变量                             | 亮色        | 暗色        |
| ------------------------------ | --------- | --------- |
| `--lumin-color-primary`        | `#6366f1` | `#818cf8` |
| `--lumin-color-primary-hover`  | `#818cf8` | `#a5b4fc` |
| `--lumin-color-bg`             | `#f8fafc` | `#0b1220` |
| `--lumin-color-surface`        | `#ffffff` | `#111a2c` |
| `--lumin-color-border`         | `#e2e8f0` | `#243044` |
| `--lumin-color-text`           | `#0f172a` | `#e2e8f0` |
| `--lumin-color-text-secondary` | `#64748b` | `#94a3b8` |
| `--lumin-color-danger`         | `#ef4444` | `#f87171` |
| `--lumin-color-error`          | `#ef4444` | `#f87171` |
| `--lumin-color-warning`        | `#f59e0b` | `#fbbf24` |
| `--lumin-color-success`        | `#10b981` | `#34d399` |
| `--lumin-color-primary-soft`   | `#eef2ff` | `#1e1b4b` |

## 3. 主题解析与生效（新增模块）

### 3.1 `apps/desktop/src/renderer/src/theme/theme.ts`（纯函数，可单测）

```ts
export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export const THEME_MODE_KEY = 'shell.theme.mode'
export const DEFAULT_THEME_MODE: ThemeMode = 'system'

export function parseThemeMode(value: unknown): ThemeMode // 仅接受三值，其余回落 system
export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme
export function applyThemeAttribute(el: { dataset: Record<string, string | undefined> }, resolved: ResolvedTheme): void // 写 data-theme
```

### 3.2 `apps/desktop/src/renderer/src/theme/naive.ts`（token 读取注入，可单测）

```ts
export type TokenReader = (name: string) => string
export function buildThemeOverrides(read: TokenReader): GlobalThemeOverrides
```

映射（值一律来自 tokens，禁止字面量色值）：

| Naive common 键        | token                          |
| --------------------- | ------------------------------ |
| `primaryColor`        | `--lumin-color-primary`        |
| `primaryColorHover`   | `--lumin-color-primary-hover`  |
| `primaryColorPressed` | `--lumin-color-primary`        |
| `primaryColorSuppl`   | `--lumin-color-primary`        |
| `bodyColor`           | `--lumin-color-bg`             |
| `cardColor`           | `--lumin-color-surface`        |
| `popoverColor`        | `--lumin-color-surface`        |
| `borderColor`         | `--lumin-color-border`         |
| `dividerColor`        | `--lumin-color-border`         |
| `textColor1` / `2`    | `--lumin-color-text`           |
| `textColor3`          | `--lumin-color-text-secondary` |
| `errorColor`          | `--lumin-color-error`          |
| `warningColor`        | `--lumin-color-warning`        |
| `successColor`        | `--lumin-color-success`        |
| `borderRadius`        | `--lumin-radius-md`            |
| `fontSize`            | `--lumin-font-size-md`         |

### 3.3 `apps/desktop/src/renderer/src/stores/theme.ts`（Pinia）

* state：`mode: ThemeMode`、`resolved: ResolvedTheme`
* `load()`：读取 `shell.theme.mode` → `parseThemeMode` → 初始化 `matchMedia` → 应用属性；读取失败回落 `system` 且不阻断启动
* `setMode(next)`：先应用再持久化；持久化失败**回滚到切换前模式**并向上抛（设置页展示错误）
* 系统监听：仅 `mode === 'system'` 时随 `change` 事件重算 `resolved`
* 销毁不涉及（应用生命周期内常驻）

### 3.4 挂载与配置

* `main.ts`：`await theme.load()` 后再 `app.mount('#app')`（失败 catch 后仍挂载），避免先亮后暗闪烁
* `App.vue`：`:theme="resolved === 'dark' ? darkTheme : null"`；`watch(resolved)` → `nextTick` 后以 `getComputedStyle(document.documentElement)` 重建 `themeOverrides`（切换后 Naive 内部 rgba 运算取到新值）
* 主进程 `createWindow`：读取持久化模式 + `nativeTheme.shouldUseDarkColors` 决定 `backgroundColor`（暗 `#0b1220` / 亮 `#f8fafc`），供 `ready-to-show` 前的窗口底色，杜绝白闪

## 4. 按钮集 / 交互

| 控件    | 可用条件 | 行为               |
| ----- | ---- | ---------------- |
| 跟随系统  | 常驻   | 选中并持久化；立即按系统偏好解析 |
| 浅色    | 常驻   | 选中并持久化；立即切换      |
| 深色    | 常驻   | 选中并持久化；立即切换      |
| 并发数保存 | 常驻   | 原有行为不变（互不影响）     |

## 5. 三态（R4）

| 状态  | 表现                                    |
| --- | ------------------------------------- |
| 空态  | 不适用（设置项常驻）；默认选中「跟随系统」                 |
| 加载态 | 持久化写入期间禁用主题单选项，防连点竞态                  |
| 报错态 | 持久化失败：单选项恢复原值 + 就地中文错误文案（结构化 message） |

## 6. 设置键

| 键                  | 类型                              | 默认       | 非法回落     |
| ------------------ | ------------------------------- | -------- | -------- |
| `shell.theme.mode` | `'system' \| 'light' \| 'dark'` | `system` | `system` |

## 7. 文件表

| 文件                                                      | 职责                             |
| ------------------------------------------------------- | ------------------------------ |
| `apps/desktop/src/renderer/src/assets/main.css`         | 亮/暗 tokens 单源 + `color-scheme` |
| `apps/desktop/src/renderer/src/theme/theme.ts`          | 模式解析、主题解析、属性应用（纯函数）            |
| `apps/desktop/src/renderer/src/theme/naive.ts`          | token → Naive overrides 映射     |
| `apps/desktop/src/renderer/src/stores/theme.ts`         | 状态、持久化、系统偏好监听                  |
| `apps/desktop/src/renderer/src/App.vue`                 | Naive 主题与 overrides 响应式切换      |
| `apps/desktop/src/renderer/src/main.ts`                 | 挂载前加载主题（防闪烁）                   |
| `apps/desktop/src/renderer/src/layout/SettingsView.vue` | 三选一 + 失败提示                     |
| `apps/desktop/src/renderer/src/i18n/zh-CN.ts`           | 主题文案 key                       |
| `apps/desktop/src/main/index.ts`                        | 窗口 `backgroundColor` 防白闪       |

## 8. 测试与验收

* 单测：`theme/theme.test.ts`（三值解析/回落、resolve 矩阵、属性应用）、`theme/naive.test.ts`（映射键齐全、值不含 `var(`、空值兜底）、`stores/theme.test.ts`（默认/持久化/系统 change/非法回落/写失败，注入假 window+matchMedia+Pinia）
* e2e：`apps/desktop/e2e/theme-smoke.spec.ts` —— 默认跟随系统、切深色断言 `html[data-theme]` + token 计算值、切浅色、重载持久化、跟随系统与 `matchMedia` 一致
* 覆盖：新增 `theme/**` 与 `stores/theme.ts` 纳入 `apps/*/src/**` 全仓 60% 门禁；纯函数目标 ≥80%
* 回归：`pnpm coverage`、`pnpm gate` 全绿；既有 e2e 不回归
* R2 八类：见 `docs/smoke/theme-dark.md`（壳级能力，逐条映射/不适用说明）
