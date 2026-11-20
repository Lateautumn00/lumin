# 图片拼接（image-stitch）任务单

> 里程碑：M22 · 规格：`docs/spec/image-stitch.md`

| #   | 任务                                                                 | 状态 |
| --- | -------------------------------------------------------------------- | ---- |
| T1  | 新建 `packages/tools/image-stitch` 骨架（package/tsconfig/env/manifest/schema/errors） | 完成 |
| T2  | `contract.ts` 布局纯函数（缩放/基准/planLayout/上限/命名）              | 完成 |
| T3  | `node.ts` 三通道 + deps 注入（config/set-output-dir 同步、stitch 任务） | 完成 |
| T4  | `stitch.worker.ts` 两遍处理 + 原子写 + 进度                             | 完成 |
| T5  | 壳注册五处 + 页面薄壳                                                  | 完成 |
| T6  | `renderer/ToolView.vue` 三态 + 参数面板 + 预览 + 结果态                 | 完成 |
| T7  | 单测（contract/schema/errors/node/worker/client）≥80%                  | 完成 |
| T8  | e2e 冒烟 `apps/desktop/e2e/image-stitch-smoke.spec.ts`                  | 完成 |
| T9  | 文档登记（spec/smoke/plan/CHANGELOG/README）+ gate + 提交               | 完成 |
