# M55 ⑩ 跨包卫生 — 实施任务

> 规格：`docs/spec/m55-hygiene.md`（批准后按序执行）
> 完成标准：单测/typecheck/lint/gate 全绿、e2e 用例改写并标注补验、spec 状态行回写。

## T1 (a) hidden 字段与侧边栏过滤

- [x] `packages/plugin-api/src/manifest.ts`：`toolManifestSchema` 增 `hidden: z.boolean().optional()`
- [x] `packages/plugin-api/src/manifest.test.ts`：增 hidden 可选/拒绝非布尔断言
- [x] `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：`groups` 前过滤 `!tool.hidden`
- [x] `packages/tools/example/src/manifest.ts`：增 `hidden: true`
- [x] `apps/desktop/e2e/ipc-smoke.spec.ts`：首个用例移除侧边栏点击、增「无示例工具」+ 直连 `example:ping`

## T2 (b) 删除 batch-ocr 残留

- [x] grep 复核全仓无 tracked 引用 `batch-ocr`
- [x] 删除 `packages/tools/batch-ocr/`

## T3 (c) image-rotate SKIP 补验标注

- [x] `docs/spec/image-rotate-tasks.md` L4 状态行补「待 CI/本机验证」
- [x] L56–58 三条 `[ ]` 追加「待 CI/本机验证」说明

## T4 (d) 状态行回写

- [x] `docs/spec/qr-code.md` L4
- [x] `docs/spec/zip-tool.md` L4
- [x] `docs/spec/pdf-toolkit.md` L4
- [x] `docs/spec/m49-pdf-ocr-consolidate.md` L3
- [x] `docs/spec/image-stitch.md` L4
- [x] `docs/spec/exam-split.md` L22
- [x] `docs/spec/image-toolbox.md` L168（M55 ① 一致性）
- [x] `docs/spec/time-toolbox.md` L144（M55 ② 一致性）

## T5 验证

- [x] `pnpm exec vitest run packages/plugin-api`（8/8）
- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm gate`（2,560 passed / 1 skipped；audit 无 high/critical；boundary 813 modules 0 违规）
- [x] `pnpm --filter @lumin/desktop build`
- [x] e2e：`ipc-smoke.spec.ts` 改动标注「待 CI/本机验证」（本机沙箱无法启动 Electron）

## T6 文档

- [x] `docs/spec/m55-hygiene.md` 状态改为「已实施」并记验证结果
- [x] 如 plan §4.55 需追加验证数据则同步；不改变动决策
