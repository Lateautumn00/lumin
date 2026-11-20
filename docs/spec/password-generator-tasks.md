# 密码生成器（password-generator）任务单 — M31

> 关联：`docs/spec/password-generator.md`（验收依据）· 分支 `feature/m31-password-generator`（基于 `feature/m30-time-toolbox`）
> 状态：**已完成**（2026-11-20）

## T1 工具包骨架

- [x] 新建 `packages/tools/password-generator/{package.json,tsconfig.json}`：exports 仅 `./manifest` 与 `./renderer/*`；deps 仅 `@lucide/vue` / `@lumin/plugin-api` / `@lumin/shared` / `naive-ui` / `vue`
- [x] `src/manifest.ts`：`id password-generator / 名称 密码生成器 / icon key-round / category misc / order 90 / version 0.1.0`
- [x] `src/errors.ts`：`PG_INVALID_OPTIONS`、`PG_CLIPBOARD_FAILED` + `toolError/errorMessage`
- [x] `src/password.ts`：§3 全部纯函数 + 常量与预设

## T2 单元测试（≥80%）

- [x] `src/password.test.ts`：字符池组合/去重/排除（易混淆与自定义）；拒绝采样（250/251 丢弃、>256 走 4 字节、非法 bound）；熵与强度四档边界；密码长度/空池校验与确定性输出；UUID v4 全 0/全 ff/顺序字节与字节不足；预设池长度；随机字符串去重与边界；随机整数闭区间、拒绝采样与跨度上限；默认随机源可用
- [x] `src/errors.test.ts`、`src/manifest.test.ts`：码集合/中文文案/detail 省略/未知码回退；manifest 契约

## T3 Renderer

- [x] `src/renderer/ToolView.vue`：§2 三页签（`NTabs` + `#tab` 插槽 + 内容 `v-if`）；Tailwind + tokens（`--lumin-color-*` / `--lumin-radius-md`）；图标仅 `@lucide/vue`（`RefreshCw/Copy/Check/Dices`）；复制反馈 1.2s 复位；`onUnmounted` 清理定时器
- [x] 每个页签独立错误行（`role="alert"`，码 + 中文）；无 `console`/`any`/`!` 非空断言

## T4 壳接线（6 处）

- [x] `apps/desktop/electron.vite.config.ts`：manifest + renderer 两条别名
- [x] `apps/desktop/package.json`：workspace 依赖（字母序）
- [x] `apps/desktop/src/tool-manifests.ts`：import + `exampleManifest` 前 1 行
- [x] `apps/desktop/src/renderer/src/tools/password-generator.vue`：薄页面
- [x] `AppSidebar.vue`：iconMap `'key-round': KeyRound`（补 import）
- [x] 根 `vitest.config.ts`：`packages/tools/password-generator/src/**/*.ts` 80% 阈值
- [x] `pnpm install --no-frozen-lockfile --prefer-offline` 生成 workspace 链接

## T5 e2e

- [x] `apps/desktop/e2e/password-generator-smoke.spec.ts` 4 用例（`clickSidebarTool(page, '密码生成器')`）
- [x] 用例 1：3 页签可见 + 默认 16 位密码 + 强度/熵
- [x] 用例 2：长度 24 + 仅大写 → `^[A-Z]{24}$`；全部取消 → `PG_INVALID_OPTIONS` 后恢复
- [x] 用例 3：UUID 默认 1 条符合 v4 正则；数量 3 条
- [x] 用例 4：随机默认 5 条长度 32 + 随机整数；非法范围报错后恢复

## T6 文档与路线图

- [x] `docs/smoke/password-generator.md`：R2 八类映射 + 单测/覆盖率/门禁/e2e/build/chunk 实测记录
- [x] `docs/opencode/plan.md`：§1 增 Q33（表头 Q1–Q33）、§4.31 新增条目、§6 增 M31 行
- [x] `CHANGELOG.md` Unreleased 追加 M31 条目
- [x] `README.md` / `README.en.md` 工具表各增 1 行

## T7 验证与提交

- [x] `pnpm exec vitest run packages/tools/password-generator`
- [x] `pnpm typecheck` / `pnpm lint`
- [x] `pnpm coverage`（本包 ≥80%）
- [x] `pnpm gate`
- [x] `pnpm build` + `playwright test e2e/password-generator-smoke.spec.ts`
- [x] 3 个中文提交：`feat(password-generator): ...` / `test(password-generator): ...` / `docs(password-generator): ...`
- [x] 不推送、不建 MR（等用户指令）
