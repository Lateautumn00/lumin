# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

Lumin 是 Windows 桌面实用工具箱（Electron 45 + Vue 3 + TypeScript），离线优先、无自建后端。
pnpm workspaces + Turborepo monorepo，每个工具是一个独立 package，由壳在**编译期清单**中插拔。

**动代码前先读：**

- `AGENTS.md` — 工程强制规范（门禁、零耦合、提交与文档要求），优先级最高。
- `docs/opencode/plan.md` — 决策总表 Q1–Q18、版本锁定表 §1.1、架构、目录定稿、各里程碑。
- `docs/spec/<tool>.md` — 字段级功能清单（开工前定稿，验收附件）。
- `docs/smoke/<tool>.md` — R2 八类异常的真实冒烟记录，同时记录 chunk/资产体积。
- `CHANGELOG.md` — 当前进度与已落地能力。

## 常用命令

```bash
pnpm install                  # Node 24（.nvmrc）+ pnpm 12（packageManager，corepack）
pnpm dev                      # electron-vite dev（壳 + 工具源码热更新）
pnpm build                    # turbo 全量构建；e2e / dist 的前置
pnpm typecheck                # 根 tsc + 各包 tsc + desktop node/e2e/vue-tsc
pnpm lint                     # ESLint（no-explicit-any = error）
pnpm lint:fix
pnpm format                   # Prettier
pnpm format:check
pnpm test                     # Vitest 单测（根 projects 聚合，排除 e2e）
pnpm vitest run packages/tools/exam-split/src/ranges.test.ts   # 单文件
pnpm vitest run -t "关键词"                                     # 按用例名过滤
pnpm coverage                 # 覆盖率门禁：全仓 60%，核心模块 80%
pnpm test:e2e                 # 先 build，再 Playwright 驱动真实 Electron
pnpm --filter @lumin/desktop test:e2e -- e2e/ipc-smoke.spec.ts  # 单个 e2e（仍需先 build）
pnpm boundary                 # dependency-cruiser 架构边界
pnpm audit:high               # high/critical 必须为 0
pnpm gate                     # lint → typecheck → test → audit → boundary（MR 门禁同序）
pnpm dist                     # electron-builder：NSIS + portable
node scripts/fetch-binaries.mjs [--check]   # OCR 模型/外部二进制，固定 URL + SHA256，产物 gitignore
```

- 单测与源码同目录（`*.test.ts`），fixture 在 `packages/tools/<tool>/fixtures/`。
- e2e 直接启动 `apps/desktop/out` 的构建产物，改主进程/工具代码后必须先 `pnpm build`；Playwright 串行（workers=1）。
- OCR 相关 e2e/手动验证前需先跑 `fetch-binaries.mjs`（模型落 `binaries/ocr/`）。

## 架构

### 包与依赖方向

```
apps/desktop/
  src/main/       纯壳：窗口/安全基线、plugin-host、ipc-bus、task-queue、settings/log/updater
  src/preload/    contextBridge 只暴露 window.lumin（LuminBridge）
  src/renderer/   Vue 壳：侧边栏/路由/设置/关于 + 每工具一个薄页面
packages/
  plugin-api/     ★ 唯一契约：ToolManifest / MainPluginContext / LuminBridge
  shared/         IPC 信封、结构化错误、任务/更新事件形状、通用纯函数
  node-kit/       主进程重任务工具：runTask/exposeTask（worker）、runProcess、路径/预检
  ui/             跨工具组件与纯函数
  tools/<id>/     独立工具包
```

已有工具（17 个包）：`calculator`（计算/进制/单位换算/生活计算）、`calendar`、`color-toolbox`、`dev-toolbox`、`docx2pdf`（显示名「文档输出」：转 PDF + 打印）、`exam-split`（pdf-lib/pdfjs + OCR ONNX）、`example`（契约链路占位）、`file-preview`、`file-scanner`（七页签：校验/重复/对比/重命名/清理/磁盘/压缩包）、`image-toolbox`（十二页签：图片处理 + 文字识别 + 二维码）、`markdown-tool`、`media-convert`（媒体工具箱：处理/下载/播放）、`mindmap`、`misc-toolbox`（系统信息/密码生成/剪贴板 + 实用工具）、`pdf-toolkit`、`text-toolbox`（格式/编码/编辑/对比）、`time-toolbox`。

dependency-cruiser 强制：`tools/*` 只能依赖 `plugin-api / shared / ui / node-kit`；工具之间禁止互相 import；工具禁止依赖 `apps/*`；renderer 禁止 import main；禁止循环依赖。

### 新增/修改工具必须同步的注册点

1. 新包 `packages/tools/<id>/`：`manifest.ts`（`defineManifest`）、`renderer/ToolView.vue` + `renderer/client.ts`（类型化 invoke 封装）、`schema.ts`（zod）、可选 `node.ts`（导出 `registerMain`）。
2. `apps/desktop/src/tool-manifests.ts`：加入 manifest（壳内唯一允许的工具知识载体）。
3. `apps/desktop/src/tool-mains.ts`：有主进程逻辑时加入 `registerMain` 映射。
4. `apps/desktop/src/renderer/src/tools/<id>.vue`：薄页面，只 import 工具包的 `ToolView.vue`。
5. `apps/desktop/electron.vite.config.ts`：为 `/manifest`、`/node`、`/renderer/*` 增加 workspace alias（main/preload/renderer 三端共用，必须手改，不会自动发现）。
6. `vitest.config.ts`：核心纯函数加入 80% 覆盖率分组。

路由由 `tool-manifests.ts` + `import.meta.glob('../tools/*.vue')` 自动生成；清单有工具但薄页面缺失会在启动时报错。
工具包 `package.json` 的 `exports` 直接指向 `src/*.ts`，包本身无需构建步骤；依赖全部精确钉版。

### IPC 与长任务模型

- renderer 只能通过 `window.lumin.invoke('{toolId}:{action}', payload)` 调用；preload 只暴露白名单 bridge，禁止 renderer 直接使用 `ipcRenderer`。
- 链路：preload → `lumin:invoke` → `main/ipc-bus.ts` 校验 channel/信封并查注册表；同步 handler 直接回包，task handler 交给 `task-queue` 并立即返回 `{ taskId }`。
- 长任务三段式：`invoke` 提交 → `lumin:task:event` 推送 `progress | log | done | error` → `lumin:task:cancel` 取消。队列并发读 `shell.taskConcurrency`（默认 2），`maxPending` 100，溢出 → `QUEUE_FULL`；取消通过 AbortSignal 终止，终态统一为 `CANCELLED`。
- 错误统一为 `StructuredError { code: UPPER_SNAKE, message, detail? }`（`shared` 定义信封与核心码，工具专属错误码放各自 `errors.ts`）。`Error` 实例一律不视为结构化错误（errno 码也是 UPPER_SNAKE），抛错用 `makeError` / `toolError`。
- `MainPluginContext` 提供 `registerIpc` / `registerTask`、按 `tools.<toolId>.*` 命名空间隔离的 settings、带工具标签的 logger、`paths { temp, userData, binaries }`。
- CPU 密集任务：`node-kit` 的 `runTask`（主进程）+ `exposeTask`（worker）走 `worker_threads`；worker 入口用 `?modulePath` 引入，禁止顶层 await。Vitest 无法解析 `?modulePath`，因此 `node.ts` 用可注入 deps，测试传假 worker 路径/handler。
- 外部程序：`node-kit` 的 `runProcess`（支持超时、取消杀进程树、Windows GBK 输出解码）。

### UI / 样式约定

- Vue 3 SFC + Naive UI + Tailwind v4 CSS-first（无 tailwind.config）。tokens 是 `apps/desktop/src/renderer/src/assets/main.css` 中的 `--lumin-*` CSS 变量，业务样式只允许 Tailwind 工具类 + tokens。
- `main.css` 的 `@source` 已包含 `packages/tools` 与 `packages/ui`，工具包内写 Tailwind 类可被扫描。
- 图标只用 `@lucide/vue`；`manifest.icon` 的字符串在 `AppSidebar.vue` 的 `iconMap` 中映射（未知则回退 `Wrench`），新图标需加映射。
- 每个工具页必须实现空态 / 加载态（进度 + 可取消）/ 报错态（结构化错误码 → 中文文案 + 重试/详情）。
- 壳文案集中在 `renderer/src/i18n/zh-CN.ts`；工具文案在工具包内。
- 主进程安全基线（contextIsolation、nodeIntegration=false、sandbox、CSP、导航拦截）不得下调。

### 构建与打包

- electron-vite 分 main/preload/renderer 三端构建；生产 CSP 同时注入 meta 与响应头，开发用 `DEV_CSP`。
- 外部二进制/OCR 模型放 `binaries/`：开发态 = 仓库根，打包态 = `resources/binaries`（extraResources）；一律由 fetch 脚本获取，禁止入库。
- R5 口径：工具 chunk + 其独占依赖 < 200KB gzip（使用 mathjs 的工具例外 300KB）；pdfjs worker/wasm/OCR 模型等运行时资产单列记录在 smoke 文档，不计入上限。给工具新增依赖时必须复测。

## 质量门禁与交付物

- 覆盖率阈值在 `vitest.config.ts`：全仓 60%，shared / plugin-api / node-kit / 各工具核心纯函数 / 壳关键服务 80%。新增核心纯模块要补对应 glob。
- 每个工具交付：`docs/spec/<tool>.md`（字段级清单）+ `docs/smoke/<tool>.md`（R2 八类异常逐条真实验证：中文/空格路径、文件被占用、加密文件、超大文件、任务取消、并发溢出、磁盘满、断电恢复）。只测正向流程不予验收。
- `pnpm gate` 全绿才可合 MR；`main` 只读，开发走 `feature/*`，修复走 `fix/*`，提交用 `feat/fix/docs/style/refactor/test/chore` 前缀，并同步 `CHANGELOG.md`。
- 依赖精确钉版；升级前先 `npm view` 复核并更新 `docs/opencode/plan.md` §1.1。TypeScript 故意停留在 6.0.3（7.x 与 typescript-eslint 不兼容），不要顺手升级。
