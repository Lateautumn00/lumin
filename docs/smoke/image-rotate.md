# 图片旋转（image-rotate）冒烟记录 — M33

> 版本：v0.1.0 · 记录日期：2026-11-20 · 环境：Windows 11 x64 / Node 锁版 / pnpm workspace
> 关联：`docs/spec/image-rotate.md`（验收依据）· `docs/spec/image-rotate-tasks.md`（任务单）

## 1. 自动化结果

| 项                  | 命令                                                                        | 结果                                                                 |
| ------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 单测（本包）        | `pnpm exec vitest run packages/tools/image-rotate`                          | **48/48 通过**                                                       |
| 类型检查            | `pnpm typecheck`                                                            | 通过                                                                 |
| Lint                | `pnpm lint`                                                                 | 通过                                                                 |
| 覆盖率              | `pnpm coverage`                                                             | 本包 **lines 96.8% / functions 100% / branches 91.9%**（阈值 80%）     |
| 门禁链              | `pnpm gate`                                                                 | 全绿（lint → typecheck → test → audit → dependency-cruiser）          |
| 构建                | `pnpm build`                                                                | 成功                                                                 |
| e2e                 | `pnpm --filter @lumin/desktop exec playwright test e2e/image-rotate-smoke.spec.ts` | **1/4 通过，3 例 skip（本机缺 ffmpeg 且网络不可达无法拉取）** |

### 1.1 chunk 实测（R5，gzip 口径）

| 产物                          | raw       | gzip      |
| ----------------------------- | --------- | --------- |
| `image-rotate-*.js`（工具本体）| 20,737 B  | **5,968 B** |
| `Empty-*.js`（独占）          | 6,599 B   | 2,290 B   |
| `RadioButton-*.js`（独占）    | 1,875 B   | 784 B     |
| `images-*.js`（独占图标）     | 729 B     | 429 B     |
| `folder-open-*.js`（独占图标）| 565 B     | 373 B     |

工具本体 + 独占小组件合计 **≈9.8KB gzip**，远低于 200KB 上限；无 worker / wasm / 模型资产。

### 1.2 e2e 用例状态

| 用例                                                        | 状态 | 说明 |
| ----------------------------------------------------------- | ---- | ---- |
| 页面加载 + 空态引导 + 未选操作时开始禁用                    | PASS | 不需要 ffmpeg |
| R2.1 中文+空格路径旋转 90°，PNG IHDR 320×240 → 240×320      | SKIP | 缺 `binaries/download/ffmpeg.exe` |
| 水平翻转保持尺寸 + 重复执行冲突命名 ` (1)`                  | SKIP | 同上 |
| R2.3 损坏 + 不支持扩展名混合批次（1 成功 2 失败）           | SKIP | 同上 |

**补齐方式**：网络可用时执行 `node scripts/fetch-binaries.mjs --group download`（固定 URL + SHA256），再跑上述 e2e 命令，期望 4/4。当前环境 `curl` 对 GitHub 不可达（超时），非代码缺陷。

## 2. R2 八类异常映射

| 编号 | 场景         | 覆盖方式                                                                 | 结果 |
| ---- | ------------ | ------------------------------------------------------------------------ | ---- |
| R2.1 | 中文/空格路径 | e2e 用例 2/3 文件名 `旋转 样例.png`、`横向 样例.png`（ASCII 临时目录 + 中文文件名）；单测命名函数 | 通过（e2e 待 ffmpeg 复验） |
| R2.2 | 文件被占用   | ffmpeg 打开失败 → `Permission denied` / `Access is denied` 归类 `IR_OUTPUT_WRITE_FAILED`（spec §6 简化口径，文案可重试）；输入 ACL 拒绝同样落此码 | 单测覆盖归类；真实占用待人工补录 |
| R2.3 | 加密文件     | 损坏/非图片样本（`not an image at all`）→ `IR_FILE_CORRUPT`，批次继续；e2e 用例 4 + node 单测 | 通过（单测）/ e2e 待 ffmpeg 复验 |
| R2.4 | 超大文件     | >200MB 或非普通文件 → `IR_FILE_UNSUPPORTED`（`statSync` 分支）；目录伪扩展名已单测 | 分支单测通过；200MB 实文件待人工 |
| R2.5 | 任务取消     | `process` 单测：运行中 `aborted` → 不记失败、产物保留；进入前 abort → 零执行并补 total | 单测通过；真实 ffmpeg 取消待人工 |
| R2.6 | 并发溢出     | 壳任务队列并发上限统一约束；本工具批次内串行、单批 ≤500（zod）；UI 运行中禁用重复提交 | 契约单测通过；并发实测待人工 |
| R2.7 | 磁盘满       | ffmpeg stderr `No space left on device` → `IR_OUTPUT_WRITE_FAILED`；mkdir 失败 errno 入 detail | 归类单测通过；VHD 实测待人工 |
| R2.8 | 断电恢复     | 产物直接写目标文件（无 `.tmp`），断电可能留下截断文件；重跑不覆盖（冲突 `(n)` 递增），需手动清理 | 语义记录；强杀实测待人工 |

## 3. 人工补验清单（ffmpeg 就绪后）

1. `node scripts/fetch-binaries.mjs --group download` → 重跑 e2e，期望 **4/4**。
2. R2.2：用另一进程以 `FileShare.None` 独占一张 jpg，执行旋转 → 断言失败项码与文案、批次其余图片成功。
3. R2.4：构造 200MB+ 图片 → 断言 `IR_FILE_UNSUPPORTED` 且不进入 ffmpeg。
4. R2.5：选 50 张大图，进度中途取消 → 断言已完成产物存在、无失败项、UI 回 idle。
5. R2.6：连续提交两次（第二次在运行中）→ 断言按钮禁用或队列排队，终态均正确。
6. R2.7：挂载 50MB VHD 输出 → 断言 `IR_OUTPUT_WRITE_FAILED` 与 detail（ENOSPC）。
7. R2.8：旋转中强杀进程 → 检查输出目录无半成品残留或可识别，重跑行为符合冲突递增。
8. 目视：90°/270° 方向正确（顺时针）、水平/垂直翻转方向正确、先翻转后旋转组合与文案一致。
