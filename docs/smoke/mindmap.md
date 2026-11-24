# mindmap（思维导图）冒烟记录

> 工具：`mindmap`（M66，2026-11-24）
> 规格：`docs/spec/mindmap.md` · 自动化：`apps/desktop/e2e/mindmap-smoke.spec.ts`
> 手工复现环境：Windows x64 · Electron 壳 · 本地离线 · mind-elixir 6.0.3 + Vue 3
> 结论：八类异常全部有覆盖路径；单测 136 + e2e 5 用例通过；本包行覆盖 654/671（97.5%）、分支 405/451（89.8%）、函数 128/139（92.1%）。

## 1. 自动化结果（e2e 5 用例 + 单测 136）

| #   | 用例                                         | 断言                                                                                                                                                                                                                                                                             | 结果 |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | 空态新建 → 编辑节点 → 保存 JSON 落盘（R2.1） | 侧边栏「思维导图」→ 空态中心主题输入框可见；填「项目计划」→ 创建后 `.me-tpc` 显示该主题；双击进内联编辑框 `#input-box` 写入 `v2` 并回车 → 节点文本更新；系统保存框 stub 到 `项目 计划.json` → 落盘 JSON 含 `v2` 且 `nodeData.topic` 非空                                         | 通过 |
| 2   | 导入 Markdown → 导出 Markdown 与 JSON        | 原生文件框以 `HTMLInputElement.click` 置空 + `setInputFiles` 注入 `大纲 文件.md`（`# 根主题 / ## 子主题A / - 细节`）→ 画布出现「根主题」；导出 `.md` 含 `# 根主题` 与 `## 子主题A`；导出 `.json` 的 `nodeData.topic` 为「根主题」                                                | 通过 |
| 3   | PNG 导出生成合法文件头                       | 新建「图片导出」→ 打开图片导出弹窗（PNG/2×/主题背景）→ 确认 → 60s 内落盘 `导图.png`，首 8 字节为 `89 50 4E 47 0D 0A 1A 0A`                                                                                                                                                       | 通过 |
| 4   | 草稿恢复提示与损坏提示                       | 首次启动预写合法草稿 → 进页面出现草稿提示 → 「恢复」后画布含「草稿主题」；离开页面后清理；第二次全新启动写入 `{oops` → 出现草稿损坏提示                                                                                                                                          | 通过 |
| 5   | IPC：错误码、mtime 冲突/force 与草稿三通道   | `open-document` 缺失 → `MM_NOT_FOUND`、非法 JSON → `MM_INVALID_DOCUMENT`；`save-document` 返回 `mtimeMs`；外部 touch 后带旧 mtime 保存 → `MM_FILE_CHANGED`，`force: true` 放行；`write-export` 非白名单扩展名 → `MM_INVALID_PATH`；草稿 `save/load(ok)/clear/load(empty)` 全链路 | 通过 |

单测分布：`errors/contract/schema/markdown/opml/theme/node/renderer/client/export-image/mind-elixir-adapter` 共 136 例，覆盖错误码表、文档校验限额、Markdown/OPML 往返、主题 tokens、8 条 IPC 通道、包围盒/尺寸校验/SVG 构造/折行转义/Canvas 栅格化取消。

## 2. R2 八类异常逐条

| 类别             | 场景与验证                                                                                                                                                                                                                                                                                                            | 结果   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1. 中文/空格路径 | 用例 1 `项目 计划.json`、用例 2 `大纲 文件.md` 与 `导出.md`、用例 5 `导图 文件.json` 全链路可读写；单测 `node.test.ts` 覆盖路径校验与读写归一                                                                                                                                                                         | 通过   |
| 2. 文件被占用    | 单测 `node.test.ts`：`stat EBUSY` → `MM_LOCKED`、`readFile EPERM` → `MM_LOCKED`、`write EBUSY` → `MM_LOCKED`、`mkdir EPERM` → `MM_LOCKED`；e2e 未构造真实独占（说明见 §3）                                                                                                                                            | 通过   |
| 3. 加密文件      | 不适用（纯 JSON 文档，无解密语义）；伪装 JSON 的不可解析内容 → `MM_INVALID_DOCUMENT`（用例 5 + 单测），结构非法 → `MM_INVALID_PAYLOAD`（单测）；损坏草稿改名留痕并返回 `corrupt`（单测 + 用例 4 UI 提示）                                                                                                             | 不适用 |
| 4. 超大文件      | 单测 `node.test.ts`：文档 >5MiB → `MM_DOC_TOO_LARGE`；序列化后超限 → 同码；节点 >5000 / 深度 >50 → `MM_NODE_LIMIT`；`read-text-file` 超大 → `MM_DOC_TOO_LARGE`；草稿 >2MB/节点超限 → `MM_DRAFT_TOO_LARGE`（UI 置 `draftPaused` 并提示暂停自动保存）；`resolveExportSize` 超单边 8192/32M 像素 → `MM_EXPORT_TOO_LARGE` | 通过   |
| 5. 任务取消      | 无三段式长任务；取消落在图片导出的 `AbortController`：`export-image.test.ts` 断言栅格化前/后 abort 均抛 `MM_EXPORT_FAILED`（「已取消」），UI 导出 1.5s 后出现「取消导出」按钮；未在 e2e 构造慢栅格化（说明见 §3）                                                                                                     | 通过   |
| 6. 并发溢出      | 无工具内并发子任务，8 条通道均为同步短任务，并发上限由壳队列 `taskConcurrency`/`maxPending` 统一控制（溢出为壳级 `QUEUE_FULL`，壳级 e2e 覆盖）；同文件并发覆盖由 mtime 校验拦截（用例 5）                                                                                                                             | 通过   |
| 7. 磁盘满        | 单测 `node.test.ts`：写入失败 → `MM_SAVE_FAILED`；`writeAtomic` 为临时文件 + rename，失败清理临时文件；未做 ENOSPC 定向实测（说明见 §3）                                                                                                                                                                              | 通过   |
| 8. 断电恢复      | 文档与草稿均 `writeAtomic`（`.tmp` + rename），目标要么不存在要么完整；损坏草稿下次启动自动改名留痕（用例 4 + 单测）；e2e 未强杀（说明见 §3）                                                                                                                                                                         | 通过   |

## 3. 不可实测项说明

- **真实文件占用**：在 Windows 上稳定制造 EBUSY/EPERM 成本高；占用映射由单测覆盖同一 `classifyReadError` / `classifySaveError` 代码路径。
- **磁盘满**：未建 VHD 定向模拟 ENOSPC；写失败分支由「写入抛错」单测覆盖（同一 `MM_SAVE_FAILED` 映射），原子写保证无半成品。
- **断电恢复**：原子写语义由 `.tmp` + rename 实现与损坏草稿留痕用例保证；e2e 强杀会破坏 Playwright 会话，未纳入。
- **任务取消**：图片导出在渲染进程内完成，用例 3 只验证成功路径；取消分支由 `export-image.test.ts` 的 AbortSignal 单测覆盖。
- **加密文档**：JSON 无解密语义，按解析失败归入 `MM_INVALID_DOCUMENT`。

## 4. 性能与包体积（R5）

| 项                                 | 数值                              | 结论                        |
| ---------------------------------- | --------------------------------- | --------------------------- |
| 工具 chunk（页面 UI + 逻辑）       | 147,812 B raw / **36,599 B gzip** | 低于 200KB gzip 基线        |
| 独占第三方依赖 chunk（MindElixir） | 150,664 B raw / 41,972 B gzip     | 计入工具增量                |
| 工具样式 chunk（MindElixir.css）   | 20,193 B raw / 4,848 B gzip       | 计入工具增量                |
| **增量合计**                       | **83,419 B gzip**                 | 远低于 200KB gzip 基线      |
| 运行时资产                         | 0                                 | 无模型 / wasm / worker 资产 |

## 5. 实现修正与已知限制

- **PNG 导出实现修正（对外行为不变）**：spec 原案为 foreignObject + Canvas。实测 Chromium 对含 `<foreignObject>` 的 SVG 画入 Canvas 后会 taint，`canvas.toBlob` 抛 `Tainted canvases may not be exported.`。现改为纯原生 SVG（节点矩形 + 居中文本 + 克隆 `.lines` 的分支 path）栅格化；SVG 文件导出仍走 foreignObject 克隆以保留完整 DOM 外观。
- 栅格化文本折行为字号估算（CJK 1em / ASCII 0.55em），节点矩形与分支线取自真实 DOM 几何，因此位置与连线准确、文字排版为近似。
- 草稿：`userData/mindmap/draft.json`，编辑后 800ms 防抖、最长 4s 强制落盘；超 2MB 或节点超限时暂停本次会话自动保存并提示。
