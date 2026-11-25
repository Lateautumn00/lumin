# 文件扫描（file-scanner）R2 冒烟记录

> 里程碑：M71（2026-11-25）· 工具 id `file-scanner` · 归一文档：原 `smoke/file-hasher.md`、`smoke/duplicate-finder.md`、`smoke/folder-compare.md`（R2 记录已并入本文件）
> 记录环境：Windows 11 (win32-x64) · Electron 45.3.1 · Node 24 · pnpm 12 · 本机真实磁盘（`%TEMP%` ASCII 目录名 + 中文/空格文件名）

## 1. 自动化结果

| 命令 | 结果 |
| ---- | ---- |
| `pnpm vitest run packages/tools/file-scanner` | 139 passed（hash / duplicate / compare 各自 schema / contract / errors / worker / node + client + 注册入口） |
| `pnpm coverage` | 全仓门禁通过；`packages/tools/file-scanner/src/**/*.ts` ≥80%（lines/functions/statements/branches） |
| `pnpm --filter @lumin/desktop test:e2e -- e2e/file-scanner-smoke.spec.ts` | **9 passed（15.5s）**：页面与三页签加载/空态、四算法 RFC 向量 + 不可读项、四算法记忆 + 期望哈希命中、重复递归/非递归/阈值/非法根、重复 UI 默认保留最早一份 + 全选、对比配对/关闭时间比较/内容比较/非法根、对比 UI 汇总与筛选、取消 + 3 并发、强杀重启恢复 |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm boundary` | 全绿 |

## 2. R2 八类异常逐条（按页签）

| # | 场景 | 文件校验 | 重复文件 | 目录对比 |
| - | ---- | -------- | -------- | -------- |
| 1 | 中文/空格路径 | ✅ e2e `文件 一.txt` 全链路（选择→worker→结果表→期望哈希）；本地路径经 `fs` 原样传递，不经 URL 解码 | ✅ e2e 预置中文文件名 + 中文子目录；`PathLink` 展示原样 | ✅ e2e 相对路径含 `nested/deep/`；根目录用 `path.join` 拼装，不做转义 |
| 2 | 文件被占用 | ✅ 计算中占用/截断 → 该行 `FH_HASH_FAILED`，其余文件照常完成（worker 单文件 try/catch） | ✅ stat/read 失败计入 `skipped` 并继续；被占用的重复候选不会被移入回收站成功（回执 `failed` 汇总提示） | ✅ 单侧 stat/read 失败计入 `skipped`；不中断整体对比 |
| 3 | 加密文件 | ✅ 无权限/拒绝访问 → `FH_FILE_INVALID`（errno 文案透传） | ✅ 无权限目录/文件计入 `skipped`，扫描继续 | ✅ 同上，`skipped` +1 |
| 4 | 超大文件 | ✅ >20GB 直接判 `FH_FILE_INVALID` 不读取；e2e 128MB 正常计时（`totalBytes` 精确） | ✅ 单次扫描上限 20 万文件，超限 `DF_TOO_MANY_FILES`；e2e 128MB 文件参与大小分组 | ✅ 单侧上限 20 万文件，超限 `FC_TOO_MANY_FILES`；结果上限 20,000 条计 `truncated` |
| 5 | 任务取消 | ✅ e2e 取消大文件任务，终态 `done`/`CANCELLED`（竞态容忍），UI 显示「已取消校验」 | ✅ [取消] → `lumin:task:cancel` → 队列 `CANCELLED`，UI 显示「已取消扫描」，保留已有结果 | ✅ 同重复文件，两侧扫描/内容比较阶段均可取消 |
| 6 | 并发溢出 | ✅ e2e 3 个 `dup-scan` 并发全部 `done`，互不干扰（`taskConcurrency` 默认 2，第三个排队）；队列满 → `QUEUE_FULL` 结构化提示 | 同左 | 同左 |
| 7 | 磁盘满 | ✅ 只读计算，不写盘；临时目录不存在写失败路径（无中间文件） | ⚠️ 移入回收站走系统 API，失败项回执 `failed` 并提示「N 个失败（原因）」；不产生应用自有临时文件 | ✅ 完全只读，不写盘 |
| 8 | 断电恢复 | ✅ e2e 强杀主进程后重启，重新提交同一文件可正常计算完整 SHA-256；无半成品落盘 | ✅ 扫描结果为内存态，重启后需重新扫描；设置记忆（目录/阈值）仍在，无脏数据 | ✅ 对比结果为内存态，重启后重新对比即可；左右目录记忆仍在 |

## 3. 体积与资产（R5）

| 项 | raw | gzip | 说明 |
| -- | --- | ---- | ---- |
| 工具 chunk（`file-scanner-*.js`） | 78,666 B | **16.7 KB** | 三页签 + 三套 schema/contract/client 合并后仍远低于 200KB gzip 上限 |
| 运行时资产 | — | — | **零新增**；三个 worker 由 electron-vite 以 `?modulePath` 独立打包，属代码 chunk 已计入上表；无 wasm / 模型 / 外部二进制 |

CSS 复用壳 tokens 与既有 Tailwind 扫描范围（`main.css @source` 已含 `packages/tools`），无新增样式资产。

## 4. 关键实现核对

- **通道**：9 个 `file-scanner:*`（`hash`/`hash-config`/`hash-set-config`、`dup-scan`/`dup-config`/`dup-set-config`、`compare`/`compare-config`/`compare-set-config`），无同名覆盖。
- **worker**：`hash.worker.ts` / `scan.worker.ts` / `compare.worker.ts` 原样迁入 `src/{hash,duplicate,compare}/`，`?modulePath` 路径随目录变化但构建通过。
- **设置命名空间**：`tools.file-scanner.*` 下 9 个键互不重叠；旧 `tools.file-hasher|duplicate-finder|folder-compare` 存量不迁移（均为可再选偏好，首启回落默认）。
- **页签状态**：`NTabs display-directive="show"`，切页签保留结果、进度与在跑任务（e2e 空态清理用例验证了重新进入读记忆）。
- **错误码**：保留 `FH_*` / `DF_*` / `FC_*` 前缀，页面按页签展示各自中文文案（spec §4）。

## 5. 人工复核（开发机）

- 侧边栏由 3 个入口收敛为 1 个「文件扫描」（icon `scan-search`），点击进入默认「文件校验」页签。
- 三页签分别执行一次真实任务：哈希（4 算法）、重复扫描（默认勾选口径）、目录对比（含内容比较），进度条、取消按钮、结果汇总与错误提示显示正常。
- 切换页签期间后台任务继续推进，回切后进度与结果仍在。
