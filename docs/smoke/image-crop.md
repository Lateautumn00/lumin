# image-crop（图片裁剪）冒烟记录 — M35

> 规格：`docs/spec/image-crop.md` · 任务单：`docs/spec/image-crop-tasks.md` · 日期：2026-11-21
> 环境：Windows 11 x64 · Electron 45 · Node 24 · pnpm 12

## 1. 自动化验证结果

| 项 | 命令 | 结果 |
| -- | ---- | ---- |
| 单测 | `pnpm exec vitest run packages/tools/image-crop` | 6 文件 / **52 用例全绿** |
| 覆盖率（本包） | `pnpm coverage` | lines **96.3%** · functions **100%** · branches **87.7%**（阈值 80%） |
| 类型检查 | `pnpm typecheck` | 通过（含壳与 e2e） |
| Lint | `pnpm lint` | 通过 |
| 门禁 | `pnpm gate` | 通过（lint → typecheck → test → audit → boundary） |
| 构建 | `pnpm build` | 通过 |
| chunk | `apps/desktop/out/renderer/assets/image-crop-*.js` | **28,473 B raw / 7,495 B gzip**（上限 200KB gzip） |
| e2e | `pnpm --filter @lumin/desktop exec playwright test e2e/image-crop-smoke.spec.ts` | **1 passed / 4 skipped** |

e2e 跳过原因：本机 `binaries/download/ffmpeg.exe` 缺失（`fetch-binaries.mjs` 拉取时网络不可达），4 个依赖真实出图的用例自动 skip；页面加载 + 空态 + 开始禁用用例通过。补齐命令：

```powershell
node scripts/fetch-binaries.mjs --group download
pnpm --filter @lumin/desktop exec playwright test e2e/image-crop-smoke.spec.ts
```

## 2. 正向流程（单测 + e2e 断言）

| 场景 | 断言 |
| ---- | ---- |
| 比例 1:1 居中 | 400×300 → 300×300；产物 `正方形 样例_裁剪1x1.png`；progress 事件存在 |
| 比例 16:9 左下锚点 | 400×300 → 400×225；滤波 `x=(iw-ow)*0`、`y=(ih-oh)*1` |
| 自由区域 25/25/50/50 | 400×300 → 200×150；产物 `自由 样例_裁剪自由.png` |
| 冲突递增 | 同目录已存在 / 同批次重复输入 → ` (1)`、` (2)` |
| 混合批次 | 好图产出 + 损坏 `IC_FILE_CORRUPT` + 非图片 `IC_FILE_UNSUPPORTED`，失败不中断 |
| 取消 | `aborted` 后不记失败，已完成产物保留，无 `IC_CANCELLED` 失败项 |
| 输出目录记忆 | `set-output-dir` 落盘，`config` 回填；任务成功后再记忆一次 |

## 3. R2 八类异常场景

| # | 场景 | 预期与实测 | 状态 |
| - | ---- | ---------- | ---- |
| 1 | 中文/空格路径 | 输入/输出目录含中文与空格；单测路径用例 + e2e 文件名 `正方形 样例.png` 覆盖；路径编码经 `basename`/`join` 透传 | 单测通过；e2e 待 ffmpeg 补齐复跑 |
| 2 | 文件被占用 | ffmpeg 无法读取 → stderr 归类 `IC_FILE_CORRUPT`；输出被占用 → `IC_OUTPUT_WRITE_FAILED`（stderr `Could not open file` / `Permission denied` / mux 失败） | 归类单测通过；真实占用待人工补录 |
| 3 | 加密/损坏文件 | 非图片字节 → ffmpeg `Invalid data found` → `IC_FILE_CORRUPT`，批次继续 | 单测 + e2e 用例 5 覆盖（e2e 待 ffmpeg） |
| 4 | 超大文件 | 单文件 >200MB 或非普通文件 → `IC_FILE_UNSUPPORTED`，不调用 ffmpeg | 单测通过 |
| 5 | 任务取消 | `AbortSignal` → runProcess 杀进程树 → `aborted` → 跳出循环、不记失败；已产出文件保留 | 单测通过 |
| 6 | 并发溢出 | UI 单任务互斥（`phase !== 'idle'` 禁用开始）；任务队列并发上限由壳统一控制（R6），工具不并发提交 | 代码路径确认；壳侧既有冒烟 |
| 7 | 磁盘满 | `mkdirSync` 失败 → `IC_OUTPUT_WRITE_FAILED`（errno 入 detail）；ffmpeg `No space left on device` → 同码 | 归类单测通过；真实 ENOSPC 待 VHD 人工复录（同 M11/M33 口径） |
| 8 | 断电恢复 | ffmpeg 直接写目标文件，断电可能残留截断产物；重跑会按冲突 `(n)` 另存，需人工删除残片；原图只读不受影响 | 机制说明；无自动清理（与 image-rotate 一致） |

## 4. 遗留与风险

- **ffmpeg 依赖用例待复跑**：拉取二进制后执行 §1 命令，将本节状态更新为实测记录。
- **R2.2/R2.7 真实环境补录**：文件占用与磁盘满需在真实环境手工验证（可用 VHD 小盘 + 打开中的输出文件）。
- **滤镜表达式**：`min()` 内逗号已按 ffmpeg filtergraph 语法转义 `\,`，单测锁定字符串；真实出图由 e2e 断言尺寸，属最后兜底。
