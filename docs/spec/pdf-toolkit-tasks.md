# PDF 工具集（M15）实施任务

> 规格：`docs/spec/pdf-toolkit.md`（批准后按序执行）
> 完成标准：单测/覆盖率、e2e、smoke 记录、`pnpm gate` 全绿、3 个提交。

## 任务顺序

- [x] 1. **工具包骨架**
  - 新建 `packages/tools/pdf-toolkit/{package.json,tsconfig.json}`
  - `src/manifest.ts`（id `pdf-toolkit`，order 75，icon `files`）
  - `src/schema.ts` + `schema.test.ts`
  - `src/errors.ts` + `errors.test.ts`
  - 验证：`pnpm exec vitest run --project @lumin/tool-pdf-toolkit`

- [x] 2. **纯函数与 PDF 内核**
  - `src/naming.ts` + `naming.test.ts`
  - `src/pdf-ops.ts`（merge/split/delete/rotate/reorder/metadata + runOp）+ `pdf-ops.test.ts`
  - `src/pdf.worker.ts`
  - 验证：同上项目测试 + `pnpm exec tsc --noEmit -p packages/tools/pdf-toolkit/tsconfig.json`

- [x] 3. **主进程通道**
  - `src/node.ts`（info 同步 + 六个任务；deps 可注入）+ `node.test.ts`
  - `src/env.d.ts`（`?modulePath` 声明）
  - 验证：项目测试全绿

- [x] 4. **渲染层**
  - `src/renderer/client.ts` + `client.test.ts`
  - `src/renderer/ToolView.vue`（六 Tab、三态、取消、结果与错误）
  - `apps/desktop/src/renderer/src/tools/pdf-toolkit.vue` 薄包装
  - 验证：`pnpm --filter @lumin/desktop typecheck`（vue-tsc）

- [x] 5. **壳注册与门禁**
  - `apps/desktop/package.json`、`electron.vite.config.ts`、`tool-manifests.ts`、`tool-mains.ts`、`AppSidebar.vue` iconMap
  - `vitest.config.ts` 增包阈值
  - `pnpm install`
  - 验证：`pnpm typecheck`

- [x] 6. **登记文档**
  - `docs/opencode/plan.md`：§1 Q19、§4.15、§6 M15
  - `CHANGELOG.md`、`README.md`、`README.en.md`
  - 验证：人工核对表格列数一致

- [x] 7. **e2e 与冒烟记录**
  - `apps/desktop/e2e/pdf-toolkit-smoke.spec.ts`
  - `docs/smoke/pdf-toolkit.md`（R2 八类）
  - 验证：`pnpm --filter @lumin/desktop build` 后跑 playwright 用例

- [x] 8. **全量门禁**
  - `pnpm coverage`
  - `pnpm gate`
  - 修复直到全绿

- [x] 9. **提交（3 个，中文正文）**
  - `feat(pdf-toolkit): PDF 工具集——合并/拆分/删页/旋转/重排/元数据`
  - `feat(pdf-toolkit): 壳注册（清单/主进程/别名/侧边栏/路由包装）与包覆盖率阈值`
  - `test(pdf-toolkit): e2e 用例 + spec/smoke 与 plan §4.15/M15 登记`
