# 压缩包工具（zip-tool）任务单

> 里程碑：M25 · 规格：`docs/spec/zip-tool.md`

| #   | 任务                                                                                          | 状态   |
| --- | --------------------------------------------------------------------------------------------- | ------ |
| T1  | 新建 `packages/tools/zip-tool` 骨架（package/tsconfig/env/manifest/schema/errors）+ fflate 钉版 | 已完成 |
| T2  | `contract.ts` 路径归一/zip slip 判定/默认命名/去重/进度百分比纯函数                             | 已完成 |
| T3  | `archive.ts` 打包（fflate Zip 流式）与解压（Unzip 流式 + 冲突/跳过/上限）                       | 已完成 |
| T4  | `archive.worker.ts` 协议编排 + `node.ts` 四通道 + deps 注入                                     | 已完成 |
| T5  | 壳注册五处 + 页面薄壳 + vitest 阈值 + lockfile                                                  | 已完成 |
| T6  | `renderer/ToolView.vue` 双 Tab 三态 + 源列表 + 进度/结果/定位                                   | 已完成 |
| T7  | 单测（contract/schema/errors/node/archive/client/worker）≥80%                                   | 已完成 |
| T8  | e2e 冒烟 `apps/desktop/e2e/zip-tool-smoke.spec.ts` 2/2（含 zip slip / 非法 zip）                 | 已完成 |
| T9  | 文档登记（smoke/CHANGELOG/README）+ coverage/build/e2e/gate + 提交                              | 已完成 |
