# video-player（视频播放器）冒烟记录

> 工具：`video-player`（M56，2026-11-22；**误报「损坏」修复 2026-11-24**）· 规格：`docs/spec/video-player.md`
> 自动化：`apps/desktop/e2e/video-player-smoke.spec.ts`（真实 Electron + 真实主进程）
> 手工复现环境：Windows x64 · Electron 45.3.1 · 本地离线
> 结论：**通过**（自动化 5/5 全绿；R2 中文件占用、并发、断电等只读场景按代码行为标注，见 §2）。
> 2026-11-24 增量：`MediaError` 按 code 分支映射（2→`VP_READ_FAILED`、3→`VP_PLAYBACK_FAILED`、4→`VP_CODEC_UNSUPPORTED`、1 不提示），由新增单测覆盖（§3.1），e2e 仍为 5 例。

## 1. 自动化结果

命令：`pnpm --filter @lumin/desktop test:e2e -- video-player-smoke`（前置 `pnpm --filter @lumin/desktop build`）
结果：**5 passed**（约 12.9s）

| # | 用例 | 断言 | 结果 |
| --- | --- | --- | --- |
| 1 | IPC：mp4/webm 解析 | `file:///` 前缀、`name`/`size`、`mime=video/mp4|video/webm` | 通过 |
| 2 | IPC：mkv / 缺失 / 目录 | 分别 `VP_UNSUPPORTED_FORMAT` / `VP_NOT_FOUND` / `VP_RESOLVE_FAILED` | 通过 |
| 3 | IPC：中文/空格/`#` 路径 | URL 含 `%20`/`%23`，`decodeURIComponent` 还原文件名 | 通过 |
| 4 | UI：真实 WebM 播放 + 倍速 + 换视频 | `<video>` 挂载且 `readyState≥2`、`error===null`；选 2x 后 `playbackRate===2`；「换一个视频」回空态 | 通过 |
| 5 | UI：不支持格式（.mkv） | `错误码：VP_UNSUPPORTED_FORMAT`；「重新选择」回空态 | 通过 |

> #4 的素材由仓库 ffmpeg（`binaries/download/ffmpeg.exe`，`lavfi testsrc` + `libvpx`）现场合成 1s/64x64 WebM，不入库 fixture；ffmpeg 缺失时该用例 `skip` 并提示先执行 `node scripts/fetch-binaries.mjs`。

## 2. R2 八类异常逐条

| 类别 | 场景与验证 | 结果 |
| --- | --- | --- |
| 1. 中文/空格路径 | e2e #3/#4 使用 `中文 目录/视频 #1.webm`、`演示 视频.webm`，`pathToFileURL` 正确转义 | 通过（自动化） |
| 2. 文件被占用 | 播放为只读 `file://` 访问，不申请写句柄；被占用/不可读时 Chromium 抛 `MediaError` 2（NETWORK）→ `VP_READ_FAILED`（可重试，不误报损坏） | 通过（`playbackError` 单测分支 + 真实独占场景建议手工复核） |
| 3. 加密/损坏文件 | 损坏内容触发 `MediaError` 3（DECODE）→ `VP_PLAYBACK_FAILED`，文案为「文件可能已损坏或编码不受支持」，不武断断言损坏；e2e #2 的假 mp4 仅验证路径解析不校验内容 | 通过（错误映射单测 + UI 错误态） |
| 4. 超大文件 | 仅 `stat` 取体积 + 生成 URL，不读入内存；播放由 Chromium 流式读取 | 通过（设计保证） |
| 5. 任务取消 | 无长任务，`resolve` 为同步 IPC，无取消入口 | 不适用 |
| 6. 并发溢出 | 每次 `resolve` 无共享可变状态；连续调用互不影响（单测 8 个 resolve 用例串行独立） | 通过（单测覆盖） |
| 7. 磁盘满 | 只读播放，不写盘 | 不适用 |
| 8. 断电恢复 | 只读播放，无状态写入；重开工具回空态 | 不适用 |

> 补充（不在 R2 八类内，2026-11-24）：容器合法但编码不受支持（如 HEVC in mp4）触发 `MediaError` 4 → `VP_CODEC_UNSUPPORTED`，文案明确「文件未必损坏」并引导转码；此类错误不可重试（重试不会改变解码能力）。

## 3. 单测 / 覆盖率 / chunk

### 3.1 单测

`pnpm exec vitest run packages/tools/video-player`：**35 passed / 6 files**（formats 6、errors 12、schema 4、manifest 1、renderer/client 2、node 10）。

### 3.2 覆盖率（v8，包内实测）

- `packages/tools/video-player/src/**/*.ts` 阈值四项 80%，2026-11-24 修复后实测：**语句 100% / 分支 94% / 函数 100% / 行 100%**（`errors.ts` 含新增 `playbackError` 分支，四项均 100%），达标。
- 全仓阈值 60%，2026-11-24 复跑 `pnpm coverage` 实测语句 94.46% / 分支 87.76% / 函数 93.14% / 行 96.04%，退出码 0（3,087 passed / 287 files）。

### 3.3 chunk 体积（R5）

构建产物 `apps/desktop/out/renderer/assets/`，工具自身 chunk：

| 文件 | raw (B) | gzip (B) |
| --- | --- | --- |
| `video-player--QmHbz7I.js` | 14,009 | 4,906 |

> 2026-11-24 修复后复测（`pnpm --filter @lumin/desktop build` 产物，GZipStream 实测）；M56 基线为 12,228 B raw / 4,274 B gzip。

结论：**4,906 B gzip < 200KB**，达标；`DropZone`/`Button`/`Select` 走壳共享 vendor，不计入工具增量。

## 4. 门禁结论

> 2026-11-24 修复后复跑：`pnpm gate` 退出码 0（lint / typecheck 44 tasks / test 3,087 passed / audit / boundary 全绿）。

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 44/44 tasks 通过（含 `@lumin/tool-video-player`、`@lumin/desktop`） |
| `pnpm test` | 通过（3,087 passed / 287 files，含本工具 35 例） |
| `pnpm coverage` | 退出码 0，全仓与包阈值均达标 |
| `pnpm audit:high` | 无 high/critical（2 moderate），退出码 0 |
| `pnpm boundary` | 936 modules / 2,127 dependencies，无违规 |
| `pnpm --filter @lumin/desktop build` | 通过 |
| `pnpm --filter @lumin/desktop test:e2e -- video-player-smoke` | 5 passed（M56 基线；本次未改 e2e） |
| `pnpm gate` | 通过（2026-11-24 复跑） |

## 5. 待手工复核清单

1. 播放中文件被另一进程独占/删除 → 预期 `MediaError` 2 → `VP_READ_FAILED` 错误态（可重试），不崩溃。
2. 播放 HEVC/H.265 编码的 mp4 → 预期 `MediaError` 4 → `VP_CODEC_UNSUPPORTED`，提示「文件未必损坏」且不显示重试。
3. 超大视频（>2GB）拖动进度条 → 预期 Chromium 流式读取，内存不随文件线性增长。
4. 系统休眠/断电后重开工具 → 预期回空态（无持久化状态）。
