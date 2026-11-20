# 图片批量水印（image-watermark）实施任务单（M21）

> 关联：`docs/spec/image-watermark.md`（字段级清单，R8）
> 状态：待用户批准后执行
> 约束：零新增第三方依赖；不推送 git（除用户明确要求）

## 任务分解

| #  | 任务                                                                 | 产物 / 验收                                                     |
| -- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| T1 | 新建 `packages/tools/image-watermark` 骨架：package.json / tsconfig / manifest / schema / errors | `defineManifest` id `image-watermark`；zod 契约与错误码表落地 |
| T2 | 纯函数 `contract.ts`（几何/命名/编码器）                             | 九宫格/平铺/旋转归一/命名全部单测覆盖                            |
| T3 | `node.ts` 三通道（config / set-output-dir / watermark 三段式任务）   | 预检分类、错误映射、目录记忆；deps 可注入                        |
| T4 | `watermark.worker.ts`（逐张绘制 + 原格式编码 + 原子写 + 失败不中断） | 单张失败记 failures；`.tmp` 清理；progress 逐张                 |
| T5 | 壳注册 5 处 + `image-watermark.vue` 薄壳                            | 侧边栏可见、路由可达、懒加载                                     |
| T6 | `renderer/ToolView.vue`（三态 + 文件列表 + 参数面板 + Canvas 预览 + 结果/失败列表） | 空态/加载（可取消）/报错/结果齐全；tokens + lucide |
| T7 | 单测（contract/schema/errors/node/worker + client）                  | 新增阈值条目，本包 ≥80%                                         |
| T8 | e2e `apps/desktop/e2e/image-watermark-smoke.spec.ts`                 | 合成图正例（文字/图片/平铺）+ 损坏图 + 冲突递增 + 取消          |
| T9 | 文档登记：`docs/smoke/image-watermark.md`（R2 八类）、plan §1 Q25 / §4.21 / §6 M21、CHANGELOG、README 中英 | 全量门禁 `pnpm gate` 绿；3 个中文提交（不推送）                  |

## 验证命令

```bash
pnpm typecheck
pnpm --filter @lumin/tool-image-watermark typecheck
pnpm vitest run packages/tools/image-watermark
pnpm --filter @lumin/desktop build
pnpm --filter @lumin/desktop e2e -- image-watermark-smoke
pnpm gate
```
