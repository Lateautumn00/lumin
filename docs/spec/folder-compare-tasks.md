# 文件夹对比（folder-compare）任务单

> 里程碑：M24 · 规格：`docs/spec/folder-compare.md`

| #   | 任务                                                                        | 状态 |
| --- | --------------------------------------------------------------------------- | ---- |
| T1  | 新建 `packages/tools/folder-compare` 骨架（package/tsconfig/env/manifest/schema/errors） | 完成 |
| T2  | `contract.ts` 相对路径归一/拼接/配对分类/汇总/排序/筛选/折叠纯函数              | 完成 |
| T3  | `compare.worker.ts` 双侧递归扫描 + 配对 + 进度 + 上限/截断                     | 完成 |
| T4  | `node.ts` 三通道 + deps 注入（config/set-config 同步、compare 任务）            | 完成 |
| T5  | 壳注册五处 + 页面薄壳 + vitest 阈值                                            | 完成 |
| T6  | `renderer/ToolView.vue` 三态 + 汇总 + 筛选 + 差异列表 + 定位                    | 完成 |
| T7  | 单测（contract/schema/errors/node/worker/client）≥80%                          | 完成 |
| T8  | e2e 冒烟 `apps/desktop/e2e/folder-compare-smoke.spec.ts` 2/2                     | 完成 |
| T9  | 文档登记（smoke/CHANGELOG/README）+ coverage/build/e2e/gate + 提交              | 完成 |
