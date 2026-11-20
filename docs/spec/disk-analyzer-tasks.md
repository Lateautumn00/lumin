# 磁盘空间分析（disk-analyzer）任务单

> 里程碑：M23 · 规格：`docs/spec/disk-analyzer.md`

| #   | 任务                                                                 | 状态 |
| --- | -------------------------------------------------------------------- | ---- |
| T1  | 新建 `packages/tools/disk-analyzer` 骨架（package/tsconfig/env/manifest/schema/errors） | 完成 |
| T2  | `contract.ts` 占比/排序/汇总/过滤/折叠/面包屑纯函数                     | 完成 |
| T3  | `node.ts` 三通道 + deps 注入（config/set-config 同步、scan 任务）       | 完成 |
| T4  | `scan.worker.ts` 递归聚合 + 进度 + 上限                                 | 完成 |
| T5  | 壳注册五处 + 页面薄壳                                                  | 完成 |
| T6  | `renderer/ToolView.vue` 三态 + 占比条 + 下钻 + 面包屑                   | 完成 |
| T7  | 单测（contract/schema/errors/node/worker/client）≥80%                  | 完成 |
| T8  | e2e 冒烟 `apps/desktop/e2e/disk-analyzer-smoke.spec.ts`                 | 完成 |
| T9  | 文档登记（smoke/CHANGELOG/README）+ gate + 提交                         | 完成 |
