# 图片裁剪 M35 任务单

> 规格：`docs/spec/image-crop.md` · 分支：`feature/m35-image-crop` · 日期：2026-11-21
> 范围：新增 `packages/tools/image-crop`；公共逻辑上提 `node-kit/ffmpeg` 与 `shared/naming`；零新增第三方依赖。

## 任务清单

| 编号 | 任务 | 文件 | 验收 |
| ---- | ---- | ---- | ---- |
| [x] T0 | 分支与公共上提 | `git checkout -b feature/m35-image-crop`；`packages/node-kit/src/ffmpeg.ts` + `index.ts` 导出；`packages/shared/src/naming.ts` 增 `extensionOf` | 新包目录建立；`image-rotate` 既有单测零改动全绿 |
| [x] T1 | 工具包与契约 | `package.json`、`tsconfig.json`、`src/manifest.ts`、`src/schema.ts`、`src/errors.ts` | manifest 字段与 spec §8 一致；自由区域越界 `INVALID_PAYLOAD` |
| [x] T2 | 裁剪纯函数 | `src/crop.ts` | 滤镜字符串、九宫格锚点、命名、编码参数、失败归类全部可单测 |
| [x] T3 | 主进程通道 | `src/node.ts` | 3 通道；批量串行、进度、取消、失败不中断、目录记忆、冲突递增 |
| [x] T4 | renderer 客户端与页面 | `src/renderer/client.ts`、`src/renderer/ToolView.vue` | 比例/自由/锚点/输出目录/三态/错误详情/运行中禁用齐全 |
| [x] T5 | 壳接线 7 处 | `electron.vite.config.ts`、`apps/desktop/package.json`、`tool-manifests.ts`、`tool-mains.ts`、`tools/image-crop.vue`、`AppSidebar.vue`、`vitest.config.ts` | 侧边栏出现「图片裁剪」；`pnpm install` 后类型检查通过 |
| [x] T6 | 单测 | `src/*.test.ts`、`node-kit/ffmpeg.test.ts`、`shared/naming.test.ts` | 本包 ≥80%；`image-rotate` 无回归 |
| [x] T7 | e2e | `apps/desktop/e2e/image-crop-smoke.spec.ts` | 5 用例（缺 ffmpeg 时 4 例 skip，页面用例必过） |
| [x] T8 | 文档同步 | `docs/smoke/image-crop.md`、`docs/opencode/plan.md`（Q37 / §4.35 / M35）、`CHANGELOG.md`、`README.md` + `README.en.md` | 记录实测覆盖率、chunk、e2e 结果与 R2 八类映射 |
| [x] T9 | 全量验证与提交 | — | `vitest` → `typecheck` → `lint` → `coverage` → `gate` → `build` → e2e；3 个中文提交，不推送 |

## 提交计划

1. `feat(image-crop): 新增批量图片裁剪工具（比例/自由 + 九宫格锚点，M35）` —— T0–T5
2. `test(image-crop): 补裁剪纯函数、通道与 e2e 用例（M35）` —— T6–T7
3. `docs(image-crop): 登记 M35 规格、任务单、冒烟与路线图` —— T8

## 验证命令

```powershell
pnpm exec vitest run packages/tools/image-crop packages/node-kit packages/shared packages/tools/image-rotate
pnpm typecheck
pnpm lint
pnpm coverage
pnpm gate
pnpm build
pnpm --filter @lumin/desktop exec playwright test e2e/image-crop-smoke.spec.ts
```

## 风险与回退

- 公共上提触及 `image-rotate`：以既有单测零改动全绿为回归门槛；异常则先回退上提并记录技术债（需评审）。
- ffmpeg 不可达时 e2e 4 例 skip，不视为代码缺陷；smoke 记录需写明补齐命令。
- 无数据库/依赖/壳契约变更；回退 = revert 三个提交。
