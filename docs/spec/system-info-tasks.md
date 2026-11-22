# system-info（M53）实施任务清单

> 对应规格：`docs/spec/system-info.md`
> 执行顺序即依赖顺序；每完成一项更新状态。

## 阶段 A：登记与骨架

- [x] A1 从 `feature/m52-unit-more` 切 `feature/m53-system-info`
- [x] A2 `docs/opencode/plan.md` 新增 Q53 决策行
- [x] A3 新建 `packages/tools/system-info` 的 `package.json` / `tsconfig.json`
- [x] A4 编写 `src/manifest.ts`（id `system-info`、icon `monitor`、category `misc`、order `72`）

## 阶段 B：契约与纯函数

- [x] B1 `src/schema.ts`：snapshot 各段 zod schema 与常量（磁盘 16 / 网卡 32）
- [x] B2 `src/errors.ts`：`SI_COLLECT_FAILED` / `SI_CLIPBOARD_FAILED` + 重试判定
- [x] B3 `src/format.ts`：平台名、运行时长、频率、百分比、时间戳、磁盘汇总、复制文本
- [x] B4 为 B1–B3 编写单测

## 阶段 C：主进程采集

- [x] C1 `src/collect.ts`：可注入 deps（os API / statfs / now / 盘符），聚合 snapshot
- [x] C2 `src/node.ts`：注册 `system-info:snapshot`，zod 出参校验 + 结构化错误映射
- [x] C3 为 collect / node 编写单测（成功、statfs 失败跳过、异常映射）

## 阶段 D：渲染层

- [x] D1 `src/renderer/client.ts`：`snapshot()` 类型化 invoke
- [x] D2 `src/renderer/ToolView.vue`：空态 / 加载态 / 报错态 + 五个概览区 + 刷新 + 复制全部
- [x] D3 `apps/desktop/src/renderer/src/tools/system-info.vue` 薄壳

## 阶段 E：壳接线

- [x] E1 `tool-manifests.ts` 导入 + 数组追加
- [x] E2 `tool-mains.ts` 导入 + 映射
- [x] E3 `AppSidebar.vue` 注册 `Monitor` 图标
- [x] E4 `apps/desktop/package.json` 增加工作区依赖
- [x] E5 `vitest.config.ts` 增加本包 80% 覆盖率阈值

## 阶段 F：验证

- [x] F1 `pnpm --filter @lumin/tool-system-info typecheck`
- [x] F2 `npx vitest run packages/tools/system-info/src` 且覆盖率 ≥80%
- [x] F3 `pnpm --filter @lumin/desktop build`，记录工具 chunk raw/gzip
- [x] F4 `apps/desktop` 下运行 `npx playwright test e2e/system-info-smoke.spec.ts --reporter=line`
- [x] F5 `pnpm gate` 全绿（lint/typecheck/test/audit/boundary）

## 阶段 G：文档与提交

- [x] G1 `docs/spec/system-info.md`（已完成）+ 本任务清单
- [x] G2 `docs/smoke/system-info.md`：R2 八类异常逐条映射（只读工具标注 N/A 理由）
- [x] G3 `plan.md`：§4.53 实现段 + M53 里程碑行（回填实测 chunk/测试数）
- [x] G4 `README.md` / `README.en.md` 工具表新增「系统信息」
- [x] G5 `CHANGELOG.md` `[Unreleased] / Added` 追加 M53 条目
- [x] G6 提交 3 笔：`feat:`（实现）/ `test:`（单测 + e2e）/ `docs:`（文档）
