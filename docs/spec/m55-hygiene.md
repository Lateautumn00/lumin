# M55 ⑩ 跨包卫生（字段级变更规格）

> 依据：`docs/opencode/plan.md` §4.55 第 761 行（Q56 登记）· `docs/opencode/feature-research-2026-11-22.md` L230–231
> 性质：跨包卫生四项，零新增依赖、零新包；不改变任何工具运行时行为。
> 状态：**已实施**（2026-11-22）。验证：`plugin-api` 8/8 通过；`pnpm gate` 全绿（2,560 passed / 1 skipped，audit 无 high/critical，boundary 813 modules 0 违规）；`pnpm --filter @lumin/desktop build` 成功（example 仍随包、侧边栏隐藏，无工具 chunk 变化）；e2e `ipc-smoke.spec.ts` 已改写，因本机沙箱无法启动 Electron，标注「待 CI/本机验证」。

## 1. 变更范围

### (a) example 工具退出生产侧边栏（通道保留）

- `packages/plugin-api/src/manifest.ts`
  - `toolManifestSchema` 增：`hidden: z.boolean().optional()`。
  - 语义：`hidden === true` 时壳侧边栏不展示；路由与 IPC 通道**不删除**（example:ping / example:sleep 仍可用，R3 冒烟不断）。
- `apps/desktop/src/renderer/src/layout/AppSidebar.vue`
  - `groups` 计算改为先过滤：`groupToolsByCategory(toolManifests.filter((tool) => !tool.hidden))`。
  - `groupToolsByCategory`（`sidebar-groups.ts`）保持纯分组语义，不引入 hidden 策略。
- `packages/tools/example/src/manifest.ts`
  - 增 `hidden: true`（版本 0.1.0 不变）。
- `packages/plugin-api/src/manifest.test.ts`
  - 增断言：`hidden: true` / 缺省均可解析；`hidden: 'yes'` 拒绝。
- `apps/desktop/e2e/ipc-smoke.spec.ts`
  - 「启动渲染工具清单」用例：移除 `clickSidebarTool(page, '示例工具')` 与其标题断言；
  - 增 `await expect(page.getByText('示例工具')).toHaveCount(0)`（侧边栏无示例工具）；
  - 增直连 `window.lumin.invoke<{ pong: boolean }>('example:ping')` 并断言 `pong === true`（证明通道保留）。

### (b) 删除 batch-ocr 残留目录

- 删除 `packages/tools/batch-ocr/`（当前仅 `.turbo/` 与 `node_modules/`，均在 gitignore）。
- 删除前确认无任何 tracked 文件引用 `batch-ocr`（`pnpm-workspace.yaml` 通配 `packages/tools/*` 无需改，但需 grep 复核 `tsconfig`/`vitest`/`tool-manifests`）。

### (c) image-rotate 三条 SKIP e2e 补验标注

- `docs/spec/image-rotate-tasks.md`：
  - L4 状态行补「e2e 3 例待 CI 或具备 ffmpeg 的本机补验」；
  - L56–58 三条 `[ ]` 后追加「**待 CI/本机验证**（本机沙箱无法启动 Electron 且缺 ffmpeg）」。
- 不改 e2e 代码与 smoke 既有记录。

### (d) 滞后 spec 状态行回写

按实际实现回写以下 6 个（调研稿 L231 指定）：

| 文件 | 行 | 现值 | 回写为 |
| --- | --- | --- | --- |
| `docs/spec/qr-code.md` | 4 | 待用户批准后实施 | 已实施（M16 交付；M55 ⑨ 批量识别 2026-11-22） |
| `docs/spec/zip-tool.md` | 4 | 待用户确认后实施 | 已实施（M25 交付；M55 ⑧ GBK 转码 2026-11-22） |
| `docs/spec/pdf-toolkit.md` | 4 | M38 规格已登记待实施 | M38 文本提取/图片提取/压缩已实现并验证 |
| `docs/spec/m49-pdf-ocr-consolidate.md` | 3 | 待批准 | 已实施（2026-11-22 回写；tasks 全 [x]） |
| `docs/spec/image-stitch.md` | 4 | M40 增补项待实施后回写冒烟 | M40 长图分割已实施（2026-11-21） |
| `docs/spec/exam-split.md` | 22 | OCR 切题·敬请期待 | OCR 切题已启用（M3b/M49） |

一致性补正（代码已实现但 M55 追加节仍写「待实施」）：

| 文件 | 行 | 回写为 |
| --- | --- | --- |
| `docs/spec/image-toolbox.md` | 168 | 已实施（2026-11-22） |
| `docs/spec/time-toolbox.md` | 144 | 已实施（2026-11-22） |

## 2. 三态

纯卫生项，不新增页面/状态；example 退出侧边栏后其页面路由与三态不变。

## 3. 验收

- `pnpm exec vitest run packages/plugin-api` 通过（含 hidden 用例）。
- `pnpm typecheck` / `pnpm lint` 通过。
- `pnpm gate` 全绿（lint → typecheck → test → audit:high → boundary）。
- `pnpm --filter @lumin/desktop build` 成功（chunk 基线无新增工具，示例工具仍随包但不在侧边栏）。
- e2e `ipc-smoke.spec.ts` 用例改写；本机沙箱无法启动 Electron，标记「待 CI/本机验证」。
- `packages/tools/batch-ocr/` 不存在且全仓无 tracked 引用。
- 8 处 spec 状态行与实现一致。

## 4. 不改动

- 不删除 example 路由/页面/IPC 通道。
- 不改任何工具运行时逻辑与 UI 三态。
- 不新增/升级任何依赖；不触碰 R5 chunk 口径。
