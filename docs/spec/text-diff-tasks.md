# 文本对比（text-diff）任务单 — M32

> 关联：`docs/spec/text-diff.md`（验收依据）· 分支 `feature/m32-text-diff`（基于 `feature/m31-password-generator`）
> 状态：**已完成**（2026-11-20）

## T1 工具包骨架

- [x] 新建 `packages/tools/text-diff/{package.json,tsconfig.json}`：exports 仅 `./manifest` 与 `./renderer/*`；deps 仅 `@lucide/vue` / `@lumin/plugin-api` / `@lumin/shared` / `naive-ui` / `vue`
- [x] `src/manifest.ts`：`id text-diff / 名称 文本对比 / icon file-diff / category text / order 100 / version 0.1.0`
- [x] `src/errors.ts`：`TD_TOO_LARGE`、`TD_CLIPBOARD_FAILED` + `toolError/errorMessage`
- [x] `src/diff.ts`：§3 全部纯函数 + 上限/预算常量

## T2 单元测试（≥80%）

- [x] `src/diff.test.ts`：拆行（LF/CRLF/CR/末尾换行）；归一化（空白/大小写）；行级 LCS 与双侧行号；全等/左空/双空；忽略空白/大小写；CRLF 混用；行数与字符数超限；LCS 预算降级；统计；统一 diff 头部/前缀/无差异/自定义标题；字符级替换/全等/空串/emoji 码点/超长整行替换；单侧片段过滤；前缀映射
- [x] `src/errors.test.ts`、`src/manifest.test.ts`：码集合/中文文案/detail 省略/未知码回退；manifest 契约与固定字段

## T3 Renderer

- [x] `src/renderer/ToolView.vue`：双输入 + 工具条（并排/统一、忽略空白/大小写、示例/交换/清空/复制）；统计 + 并排/统一结果区；Tailwind + tokens（`--lumin-color-*` / `--lumin-radius-md`）；图标仅 `@lucide/vue`（`FileDiff/Sparkles/ArrowLeftRight/Eraser/Copy/Check`）；复制反馈 1.2s 复位；`onUnmounted` 清理定时器
- [x] 三态：空态引导卡 / 加载态豁免（同步纯函数）/ 超限与复制失败 `role="alert"` 行内码 + 中文
- [x] 无 `console`/`any`/`!` 非空断言

## T4 壳接线（6 处）

- [x] `apps/desktop/electron.vite.config.ts`：manifest + renderer 两条别名
- [x] `apps/desktop/package.json`：workspace 依赖（字母序）
- [x] `apps/desktop/src/tool-manifests.ts`：import + 清单数组 1 行
- [x] `apps/desktop/src/renderer/src/tools/text-diff.vue`：薄页面
- [x] `AppSidebar.vue`：iconMap `'file-diff': FileDiff`（补 import）
- [x] 根 `vitest.config.ts`：`packages/tools/text-diff/src/**/*.ts` 80% 阈值
- [x] `pnpm install --no-frozen-lockfile --prefer-offline` 生成 workspace 链接

## T5 e2e

- [x] `apps/desktop/e2e/text-diff-smoke.spec.ts` 4 用例（`clickSidebarTool(page, '文本对比')`）
- [x] 用例 1：空态引导 + 示例统计 `+3/-2/2` + 并排 5 行
- [x] 用例 2：区分/忽略大小写统计联动 + 统一视图 `-Beta`/`+Gamma`
- [x] 用例 3：复制统一 diff 到系统剪贴板（`app.evaluate` 读取校验）+ 交换 + 清空
- [x] 用例 4：20,001 行 → `TD_TOO_LARGE` + 清空恢复空态

## T6 文档与路线图

- [x] `docs/smoke/text-diff.md`：R2 八类映射 + 单测/覆盖率/门禁/e2e/build/chunk 实测记录
- [x] `docs/opencode/plan.md`：§1 增 Q34（表头 Q1–Q34）、§4.32 新增条目、§6 增 M32 行
- [x] `CHANGELOG.md` Unreleased 追加 M32 条目
- [x] `README.md` / `README.en.md` 工具表各增 1 行

## T7 验证与提交

- [x] `pnpm exec vitest run packages/tools/text-diff`
- [x] `pnpm typecheck` / `pnpm lint`
- [x] `pnpm coverage`（本包 ≥80%）
- [x] `pnpm gate`
- [x] `pnpm build` + `playwright test e2e/text-diff-smoke.spec.ts`
- [x] 3 个中文提交：`feat(text-diff): ...` / `test(text-diff): ...` / `docs(text-diff): ...`
- [x] 不推送、不建 MR（等用户指令）
