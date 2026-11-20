# 图片旋转（image-rotate）任务单 — M33

> 关联：`docs/spec/image-rotate.md`（验收依据）· 分支 `feature/m33-image-rotate`（基于 `feature/m32-text-diff`，HEAD `2e5d026`）
> 状态：**已实施**（2026-11-20）· e2e 旋转 3 例因本机缺 ffmpeg 且网络不可达而 skip，补验清单见 `docs/smoke/image-rotate.md` §3

## T0 分支与骨架

- [x] `git checkout -b feature/m33-image-rotate`
- [x] 新建 `packages/tools/image-rotate/{package.json,tsconfig.json}`：exports `./manifest`、`./node`、`./schema`、`./errors`、`./rotate`、`./renderer/*`；deps `@lucide/vue / @lumin/node-kit / @lumin/plugin-api / @lumin/shared / @lumin/ui / naive-ui / vue / zod`
- [x] `src/manifest.ts`：`id image-rotate / 名称 图片旋转 / icon rotate-cw / category image / order 51 / version 0.1.0`

## T1 纯函数与契约

- [x] `src/schema.ts`：白名单（jpg/jpeg/png/webp/bmp/tiff）、200MB、500 张、`rotation/flip` 枚举 + 「至少一项」refine、三通道 payload/result zod
- [x] `src/rotate.ts`：`normalizeExtension` / `extensionOf` / `buildFilterArgs`（先翻转后旋转）/ `buildRotateOutputName` / `buildEncodeArgs` / `classifyFfmpegFailure`
- [x] `src/errors.ts`：`IR_*` 5 码 + 中文文案 + `isRetryable`；`isStructuredError`/`errnoCode` 委托 `@lumin/shared`

## T2 主进程（`src/node.ts`）

- [x] `config` / `set-output-dir` 同步通道（settings `outputDir`，缺省 `userData/image-rotate`）
- [x] `process` task：payload 校验 → 引擎预检 → 输出目录 mkdir + 记忆 → 串行逐张（filter/encode/唯一命名）→ 逐张结果
- [x] 取消：`signal.aborted` → `IR_CANCELLED` 跳出，已完成保留；单张失败不中断
- [x] `ImageRotateDeps` 可注入（`runProcess`）便于单测
- [x] `registerMain` 导出

## T3 单元测试（≥80%）

- [x] `rotate.test.ts`：扩展名/滤镜组合与顺序/命名全组合/编码参数/失败归类
- [x] `schema.test.ts`：合法、空列表、超 500、双 none、非法枚举
- [x] `errors.test.ts` / `manifest.test.ts`：码集合/文案/可重试/detail 省略；契约字段
- [x] `node.test.ts`：假 runProcess——引擎缺失、mkdir 失败、成功/失败混合、冲突递增、取消、目录记忆
- [x] `renderer/client.test.ts`：三通道名与透传

## T4 Renderer

- [x] `src/renderer/client.ts`：`config` / `saveOutputDir` / `process` / `revealPath`
- [x] `src/renderer/ToolView.vue`：标题/说明、空态 `NEmpty`+`DropZone`、文件列表、旋转与翻转按钮组、输出目录选择、开始/取消、结果与失败汇总、错误码+详情
- [x] 三态齐备；Tailwind + tokens；图标仅 `@lucide/vue`（`RotateCw/RotateCcw/FlipHorizontal/FlipVertical/FolderOpen/X/Image` 等按需）
- [x] 无 `console`/`any`/`!` 非空断言

## T5 壳接线（7 处）

- [x] `apps/desktop/electron.vite.config.ts`：manifest/node/renderer 别名
- [x] `apps/desktop/package.json`：workspace 依赖（字母序）
- [x] `apps/desktop/src/tool-manifests.ts`：import + 清单 1 行
- [x] `apps/desktop/src/main/tool-mains.ts`：import + 注册表 1 行
- [x] `apps/desktop/src/renderer/src/tools/image-rotate.vue`：薄页面
- [x] `AppSidebar.vue`：iconMap `'rotate-cw': RotateCw`
- [x] 根 `vitest.config.ts`：本包 80% 阈值
- [x] `pnpm install --no-frozen-lockfile --prefer-offline`

## T6 e2e

- [x] `apps/desktop/e2e/image-rotate-smoke.spec.ts` 4 用例（缺 ffmpeg 时逐例 skip）
- [x] 用例 1：加载 + 空态 + 开始禁用（**PASS**）
- [ ] 用例 2：旋转 90° 尺寸变化（PNG IHDR 校验）+ progress（**SKIP：缺 ffmpeg**，见 smoke §3）
- [ ] 用例 3：水平翻转尺寸不变 + 二次执行冲突 ` (1)`（**SKIP：缺 ffmpeg**）
- [ ] 用例 4：好图 + 损坏 + 不支持扩展名混合批次（1 成功 2 失败）（**SKIP：缺 ffmpeg**）

## T7 文档与路线图

- [x] `docs/smoke/image-rotate.md`：R2 八类映射 + 单测/覆盖率/门禁/e2e/build/chunk 实测
- [x] `docs/opencode/plan.md`：§1 增 Q35（表头 Q1–Q35）、§4.33 新增条目、§6 增 M33 行
- [x] `CHANGELOG.md` Unreleased 追加 M33 条目
- [x] `README.md` / `README.en.md` 工具表各增 1 行

## T8 验证与提交

- [x] `pnpm exec vitest run packages/tools/image-rotate`（48/48）
- [x] `pnpm typecheck` / `pnpm lint`
- [x] `pnpm coverage`（lines 96.8% / functions 100% / branches 91.9%）
- [x] `pnpm gate`
- [x] `pnpm build` + e2e 1/4 PASS（3 例 SKIP）
- [x] 3 个中文提交：`feat(image-rotate): ...` / `test(image-rotate): ...` / `docs(image-rotate): ...`
- [x] 不推送、不建 MR（等用户指令）
