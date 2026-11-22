---
name: project-conventions
description: Lumin 项目命名与工程规范速查：文件/目录、包名、TS/Vue 符号、zod schema、错误码、IPC、测试、文档、Git 分支与提交；在新增或修改代码、创建工具包、编写 spec/smoke、评审 MR、或用户询问项目规范时使用。Lumin naming and engineering conventions for files, packages, TypeScript/Vue symbols, zod schemas, error codes, IPC channels, tests, docs and Git workflow.
---

# Lumin 项目命名与工程规范

本 skill 是**速查与补全**，不替代强制规范。冲突时以 `AGENTS.md` 为准；需求或架构决策变更须同步 `docs/opencode/plan.md`。

## 何时启用

- 新增或修改代码、创建工具包、调整目录结构
- 编写 `docs/spec`、`docs/smoke`、README、CHANGELOG
- 评审 MR / 提交前自检
- 用户询问“项目命名规范”“代码风格”“提交流程”

## 0. 规范优先级

| 优先级 | 文件 | 作用 |
| --- | --- | --- |
| 1 | `AGENTS.md` | 强制工程规范（技术栈、边界、门禁、Git） |
| 2 | `docs/opencode/plan.md` | 决策总表 Q1–Q53、版本锁定、目录定稿、里程碑 |
| 3 | `CLAUDE.md` | 实操指南（命令、注册点、IPC、UI、构建） |
| 4 | 本 skill | 命名细则与速查；不得与以上冲突 |

## 1. 命名总表

| 类别 | 规则 | 示例 |
| --- | --- | --- |
| 工具 id | kebab-case，正则 `^[a-z][a-z0-9-]*$` | `disk-analyzer`、`image-toolbox` |
| 工具目录 | `packages/tools/<tool-id>` | `packages/tools/disk-analyzer` |
| 工具包名 | `@lumin/tool-<tool-id>` | `@lumin/tool-disk-analyzer` |
| 源文件 / 目录 | kebab-case | `file-hasher.ts`、`json-to-ts.ts`、`fs-cleaner/` |
| 测试文件 | 与被测模块同目录，`<module>.test.ts` | `collect.test.ts`、`client.test.ts` |
| 类型声明 | `*.d.ts` | `env.d.ts` |
| Vue 组件文件 | PascalCase | `ToolView.vue`、`AppSidebar.vue` |
| 壳薄页面 | kebab-case，与工具 id 同名 | `renderer/src/tools/disk-analyzer.vue` |
| 变量 / 函数 / 参数 | camelCase | `collectSnapshot`、`errorDetail` |
| 类型 / 接口 / 枚举 / 类型别名 | PascalCase | `Snapshot`、`MainPluginContext` |
| 真常量 | UPPER_SNAKE | `MAX_DISKS`、`SYSTEM_INFO_ERROR_CODES` |
| 布尔值 | `is/has/can/should` 前缀 | `isLoading`、`hasError` |
| 事件回调 | `onXxx` | `onUnmounted`、`onClick` |
| Composable | `useXxx` | `useTheme` |
| Pinia store | `useXxxStore`，id 与领域同名 | `useThemeStore` / `defineStore('theme', …)` |
| zod schema | `xxxSchema`；推导类型 PascalCase | `scanPayloadSchema` → `ScanPayload` |
| 错误码 | `<TOOL_PREFIX>_<REASON>`，UPPER_SNAKE，短前缀（通常 2–4 字母） | `DA_ROOT_INVALID`、`IT_FILE_CORRUPT`、`VD_COOKIE_FORMAT_INVALID` |
| IPC 通道 | `{toolId}:{action}`，action kebab-case | `disk-analyzer:set-config`、`image-toolbox:set-output-dir` |
| manifest `id` | kebab-case | `disk-analyzer` |
| manifest `name` | 中文展示名 | `磁盘空间分析` |
| manifest `icon` | lucide 图标名，并在 `AppSidebar.iconMap` 注册 | `hard-drive` → `HardDrive` |
| manifest `category` | 既有枚举值 | `compute` / `text` / `image` / `document` / `media` / `file` / `misc` |
| manifest `order` | 整数，同分类内不冲突 | `66` |
| manifest `version` | 语义化 `x.y.z` | `0.1.0` |
| settings key | 壳级 `shell.*`；工具级 `tools.<toolId>.*` | `shell.theme`、`tools.image-toolbox.outputDir` |
| CSS token | `--lumin-<group>-<name>` | `--lumin-color-primary`、`--lumin-radius-md` |
| 工具规格 | `docs/spec/<tool-id>.md`；任务清单 `<tool-id>-tasks.md` | `docs/spec/disk-analyzer.md` |
| 冒烟记录 | `docs/smoke/<tool-id>.md` | `docs/smoke/disk-analyzer.md` |
| e2e 用例 | `apps/desktop/e2e/<tool-id>-smoke.spec.ts` | `disk-analyzer-smoke.spec.ts` |
| Git 分支 | `feature/mXX-<slug>`、`fix/<slug>`、`hotfix/<slug>` | `feature/m6-image-toolbox` |
| 提交信息 | `<type>(<scope>): <中文摘要>` | `feat(disk-analyzer): 新增磁盘空间分析工具` |

提交 type 只能是：`feat / fix / docs / style / refactor / test / chore`。scope 用工具 id、包名或模块名。

## 2. 目录与文件结构

```text
apps/desktop/
  src/main/         纯壳：窗口/安全基线、plugin-host、ipc-bus、task-queue
  src/preload/      仅暴露 window.lumin
  src/renderer/     Vue 壳 + 每工具一个薄页面
packages/
  plugin-api/       ToolManifest / MainPluginContext / LuminBridge
  shared/           IPC 信封、结构化错误、通用纯函数
  node-kit/         runTask / runProcess / 路径预检
  ui/               跨工具组件与纯函数
  tools/<tool-id>/
    manifest.ts
    schema.ts        zod 入参/出参
    errors.ts        工具错误码
    node.ts?         主进程逻辑，导出 registerMain
    renderer/
      ToolView.vue
      client.ts      类型化 invoke 封装
```

- 工具包 `exports` 直接指向 `src/*.ts`，无需构建步骤。
- 公共逻辑上提：两个及以上工具复用的逻辑必须抽到根 `packages/`，禁止在工具内复制粘贴。
- 大二进制/模型走 `scripts/fetch-binaries.mjs`，禁止入库。
- 新文件必须落在定稿树的既定位置，禁止随意新建目录层级。

## 3. TypeScript 红线

- `tsconfig` 基线：`strict: true` + `noUncheckedIndexedAccess: true`。
- `@typescript-eslint/no-explicit-any` 为 **error**：禁止 `any`，缺类型先补类型。
- 未使用变量以 `_` 开头可豁免（ESLint `argsIgnorePattern/varsIgnorePattern/caughtErrorsIgnorePattern`）。
- 禁止非空断言滥用；优先收窄类型；zod 校验后使用 `z.infer` 推导类型。
- 禁止死代码、调试残留（`console` / `debugger` / 临时注释）。
- 跨包引用只用 package exports（如 `@lumin/tool-disk-analyzer/manifest`），禁止深链 `src/`。
- 格式化交给 Prettier：无分号、单引号、100 列、无尾逗号（`.prettierrc.json`）。

## 4. Vue / UI / 样式

- Vue 3 SFC + Naive UI + Tailwind；业务样式只允许 Tailwind 工具类 + `--lumin-*` tokens。
- 禁止第二套状态管理 / 请求库 / CSS 方案 / 构建工具；禁止散写色值、间距、圆角等魔法值。
- Naive UI 主题覆盖只在 theme 配置层；禁止组件内用 `:deep()` 随意改库样式。
- 图标只用 `@lucide/vue`；新增 `manifest.icon` 必须同步 `AppSidebar.vue` 的 `iconMap`。
- 暗色主题只通过 `html[data-theme='dark']` 覆盖 tokens + Naive 主题层；禁止组件内按主题分支写样式。
- 每个工具页强制三态：
  - 空态：引导文案 + 主操作，禁止白屏；
  - 加载态：进度可见，长任务必须可取消；
  - 报错态：结构化错误码 → 中文文案 + 重试/详情入口。
- 壳薄页面只 import 工具包的 `ToolView.vue`，禁止在壳内写工具专属逻辑。

## 5. IPC / 错误 / 日志

- renderer 只经 `window.lumin.invoke('{toolId}:{action}', payload)` 调用；禁止直接使用 `ipcRenderer`。
- 所有入参先经 zod 校验再进 handler；出参关键结果同样校验。
- IPC schema 归工具包：`shared` 只定义信封，工具自带 zod schema 与类型化 client。
- 长任务三段式：`invoke` 返回 `{ taskId }` → `progress | log | done | error` 事件 → `cancel`。
- 错误统一 `StructuredError { code, message, detail? }`；`Error` 实例一律不视为结构化错误。
- 错误码必须 UPPER_SNAKE，专属码放工具 `errors.ts`，中文文案集中定义。
- 日志统一 electron-log，滚动文件 + 体积上限；禁止 `console.log` 作为正式日志。
- 主进程安全基线不得下调：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、CSP、导航拦截。

## 6. 测试 / 覆盖率 / 门禁

- 单测与源码同目录（`*.test.ts`）；fixture 放 `packages/tools/<tool>/fixtures/`。
- 核心纯函数覆盖率 **≥80%**，全仓 **≥60%**；新增核心模块要在 `vitest.config.ts` 加 glob。
- e2e 用 Playwright 驱动真实 Electron，先 `pnpm build`；用例命名 `<tool>-smoke.spec.ts`。
- M0 起必须有 IPC 冒烟自动化；无 IPC 冒烟不得合入。
- 两级验证：开发期只跑受影响单测/定向 typecheck；提交前 `pnpm gate` 只跑一次。
- 每工具必须附 `docs/smoke/<tool>.md`，R2 八类逐条真实记录：中文/空格路径、文件被占用、加密文件、超大文件、任务取消、并发溢出、磁盘满、断电恢复。只测正向流程不予验收。

## 7. 文档与交付

- 开工前先出字段级 `docs/spec/<tool>.md`：入口、按钮、输入项、错误分支、IPC 契约、验收断言。
- 决策变更必须改 `docs/opencode/plan.md` 决策总表并同步 `AGENTS.md`，口头无效。
- 工具表同步 `README.md` / `README.en.md`；每次变更同步 `CHANGELOG.md` 的 `[Unreleased]`。
- 验收必须可复现断言；禁止“能用 / 差不多 / 正常”式模糊验收。
- 体积口径：工具 chunk + 独占依赖 <200KB gzip（mathjs 工具例外 300KB）；运行时资产单列 smoke。

## 8. Git 规范

- `main` 只读，禁止直推；开发 `feature/*`，修复 `fix/*`，线上紧急 `hotfix/*`。
- 所有合入走 MR，门禁全绿才可合并。
- 小步提交、功能独立、不混编；提交前确保编译过、格式化、Lint 绿、无冗余文件。
- 禁止提交敏感信息（密钥/Token/证书）、debug 日志、`console`、无效代码。
- 外部二进制/模型必须固定 URL + SHA256 校验；依赖精确钉版，升级前 `npm view` 复核并更新 plan §1.1。
- 发布使用语义化 Tag `vX.Y.Z`；`CHANGELOG.md` 从 M0 起持续维护。

## 9. 新增工具注册点（6 处）

1. `packages/tools/<id>/`：`manifest.ts`、`schema.ts`、`errors.ts`、`renderer/ToolView.vue`、`renderer/client.ts`，可选 `node.ts`。
2. `apps/desktop/src/tool-manifests.ts`：导入 manifest 并加入数组。
3. `apps/desktop/src/main/tool-mains.ts`：有主进程逻辑时加入 `registerMain` 映射。
4. `apps/desktop/src/renderer/src/tools/<id>.vue`：薄页面，只 import `ToolView.vue`。
5. `apps/desktop/electron.vite.config.ts`：为 `/manifest`、`/node`、`/renderer/*` 增加 workspace alias。
6. `vitest.config.ts`：核心纯函数加入 80% 覆盖率分组。

有 IPC 的工具还需在 `AppSidebar.vue` 注册图标，并补 `docs/spec`、`docs/smoke`、README、CHANGELOG。

## 10. 提交前自检

- [ ] 命名符合第 1 节总表；新文件在既定目录。
- [ ] 没有新增 `any`、`console`、魔法值、死代码。
- [ ] 工具页三态齐全；错误码为 UPPER_SNAKE + 中文文案。
- [ ] 新增工具 6 个注册点全部接通；图标已映射。
- [ ] 单测/覆盖率达标；e2e 或 IPC 冒烟通过。
- [ ] `docs/spec`、`docs/smoke`、`plan.md`、README、CHANGELOG 已同步。
- [ ] `pnpm gate` 全绿；提交信息符合 `<type>(<scope>): <中文摘要>`。

## 11. 禁止清单

- 工具之间互相 import；`tools/*` 依赖 `apps/*`；renderer import main。
- 壳内出现工具名或工具专属代码（清单文件除外）。
- 第二套状态管理 / 请求库 / CSS 方案 / 构建工具。
- 直接使用 `ipcRenderer`、绕过 `window.lumin` bridge。
- 硬编码 secrets；提交 `binaries/`、模型、安装包。
- 提交生成物：`out/`、`coverage/`、`userData/`、`test-results/`。
- 为赶工期弱化架构边界、复制粘贴公共逻辑、绕过插件契约。

---

维护：`AGENTS.md` 或 `docs/opencode/plan.md` 更新时同步本 skill；本 skill 不新增与二者冲突的规则。
