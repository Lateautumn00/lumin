# 媒体工具箱 · 播放页签冒烟记录（原 video-player，M73 并入）

> 工具：`media-convert`（显示名「媒体工具箱」）· 页签「播放」（M56，2026-11-22；**误报「损坏」修复 2026-11-24**；**媒体加载链路修复 2026-11-24**；**M73 并入媒体工具箱 2026-11-25**）· 规格：`docs/spec/media-convert-player.md`
> 自动化：`apps/desktop/e2e/media-toolbox-player.spec.ts`（真实 Electron + 真实主进程）
> 手工复现环境：Windows x64 · Electron 45.3.1 · 本地离线
> 结论：**通过**（自动化 5/5 全绿；R2 中文件占用、并发、断电等只读场景按代码行为标注，见 §2）。
> 2026-11-24 增量 1：`MediaError` 按 code 分支映射（2→`VP_READ_FAILED`、3→`VP_PLAYBACK_FAILED`、4→`VP_CODEC_UNSUPPORTED`、1 不提示），由新增单测覆盖（§3.1）。
> 2026-11-24 增量 2：`file://` 改为壳级 `lumin-media://` 协议（dev 的 http origin / UNC 路径下 Chromium URL safety check 会拒绝 `file://` 媒体）；e2e 断言改为「协议前缀 + base64url 解码还原路径」，仍为 5 例。
> 2026-11-24 增量 3：控件精简——移除页面自定义「倍速 / 全屏」，统一原生 `<video controls>`；e2e #4 移除倍速 UI 断言、改为断言原生 `controls`。

## 1. 自动化结果

命令：`pnpm --filter @lumin/desktop test:e2e -- media-toolbox-player`（前置 `pnpm --filter @lumin/desktop build`）
结果：**5 passed**（协议修复后重新构建并复跑）

| # | 用例 | 断言 | 结果 |
| --- | --- | --- | --- |
| 1 | IPC：mp4/webm 解析 | `lumin-media://local/` 前缀、base64url 解码还原原路径、`name`/`size`、`mime=video/mp4\|video/webm` | 通过 |
| 2 | IPC：mkv / 缺失 / 目录 | 分别 `VP_UNSUPPORTED_FORMAT` / `VP_NOT_FOUND` / `VP_RESOLVE_FAILED` | 通过 |
| 3 | IPC：中文/空格/`#` 路径 | `decodeMediaUrl(url) === 原路径`（UTF-16LE + base64url 无损） | 通过 |
| 4 | UI：真实 WebM 播放 + 换视频 | `<video src>` 为 `lumin-media://local/<token>` 且解码等于文件路径；断言原生 `controls` 存在（页面无自定义倍速/全屏）；`readyState≥2`、`error===null`；「换一个视频」回空态 | 通过 |
| 5 | UI：不支持格式（.mkv） | `错误码：VP_UNSUPPORTED_FORMAT`；「重新选择」回空态 | 通过 |

> #4 的素材由仓库 ffmpeg（`binaries/download/ffmpeg.exe`，`lavfi testsrc` + `libvpx`）现场合成 1s/64x64 WebM，不入库 fixture；ffmpeg 缺失时该用例 `skip` 并提示先执行 `node scripts/fetch-binaries.mjs`。

## 2. R2 八类异常逐条

| 类别 | 场景与验证 | 结果 |
| --- | --- | --- |
| 1. 中文/空格路径 | e2e #3/#4 使用 `中文 目录/视频 #1.webm`、`演示 视频.webm`，`toMediaUrl` 按 UTF-16 码元 + base64url 编码，e2e 解码后与原文逐字相等 | 通过（自动化） |
| 2. 文件被占用 | 播放为只读访问（主进程 `net.fetch(file://)` 回源），不申请写句柄；被占用/不可读时 Chromium 抛 `MediaError` 2（NETWORK）→ `VP_READ_FAILED`（可重试，不误报损坏） | 通过（`playbackError` 单测分支 + 真实独占场景建议手工复核） |
| 3. 加密/损坏文件 | 损坏内容触发 `MediaError` 3（DECODE）→ `VP_PLAYBACK_FAILED`，文案为「文件可能已损坏或编码不受支持」，不武断断言损坏；e2e #2 的假 mp4 仅验证路径解析不校验内容 | 通过（错误映射单测 + UI 错误态） |
| 4. 超大文件 | 仅 `stat` 取体积 + 生成 URL，不读入内存；播放由 Chromium 流式读取 | 通过（设计保证） |
| 5. 任务取消 | 无长任务，`resolve` 为同步 IPC，无取消入口 | 不适用 |
| 6. 并发溢出 | 每次 `resolve` 无共享可变状态；连续调用互不影响（单测 8 个 resolve 用例串行独立） | 通过（单测覆盖） |
| 7. 磁盘满 | 只读播放，不写盘 | 不适用 |
| 8. 断电恢复 | 只读播放，无状态写入；重开工具回空态 | 不适用 |

> 补充（不在 R2 八类内，2026-11-24）：容器合法但编码不受支持（如 HEVC in mp4）触发 `MediaError` 4 → `VP_CODEC_UNSUPPORTED`，文案明确「文件未必损坏」并引导转码；此类错误不可重试（重试不会改变解码能力）。
> 补充（2026-11-24）：`MediaError` 4 但原始文案含 `URL safety check` / `Media load rejected` 时归 `VP_READ_FAILED`（可重试）——这是传输层拦截（如 dev 的 http origin 拒绝 `file://`），不是编码问题；协议修复后正常路径不再触发。

## 3. 单测 / 覆盖率 / chunk

### 3.1 单测

`pnpm exec vitest run packages/tools/media-convert`：**36 passed / 6 files**（formats 6、errors 13、schema 4、manifest 1、renderer/client 2、node 10）。
`pnpm exec vitest run packages/shared/src/media-url.test.ts`：**7 passed**（协议 URL 编解码与非法输入）。

### 3.2 覆盖率（v8，包内实测）

- `packages/tools/media-convert/src/**/*.ts` 阈值四项 80%，2026-11-24 协议修复后实测：**语句 100% / 分支 94.54% / 函数 100% / 行 100%**（`errors.ts` 四项均 100%），达标。
- `packages/shared/src/media-url.ts`：语句 98.21% / 分支 87.87% / 函数 100% / 行 100%，达标。
- 全仓阈值 60%，2026-11-24 复跑 `pnpm coverage` 实测语句 94.32% / 分支 87.63% / 函数 92.98% / 行 95.9%，退出码 0（3,095 passed / 288 files）。

### 3.3 chunk 体积（R5）

构建产物 `apps/desktop/out/renderer/assets/`，工具自身 chunk：

| 文件 | raw (B) | gzip (B) |
| --- | --- | --- |
| 并入后（M73） | 随 `media-convert-*.js` 统一计量（原独立 chunk 11,961 B raw / 4,626 B gzip） |

> 2026-11-24 控件精简后复测（`pnpm --filter @lumin/desktop build` 产物，GZipStream 实测）；媒体协议修复版为 14,461 B raw / 5,241 B gzip。
> 壳级协议模块 `main/media-protocol.ts` 属主进程产物，不计入 renderer 工具 chunk。

结论：**4,626 B gzip < 200KB**，达标；`DropZone`/`Button` 走壳共享 vendor，不计入工具增量。

## 4. 门禁结论

> 2026-11-24 协议修复后复跑：`pnpm gate` 退出码 0（lint / typecheck / test / audit / boundary 全绿）；控件精简后另复跑 lint / typecheck / build / e2e（5/5）全绿。

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 44/44 tasks 通过（含 `@lumin/tool-media-convert`、`@lumin/desktop`） |
| `pnpm test` | 通过（3,095 passed / 288 files，含本工具 36 例 + shared 协议 7 例） |
| `pnpm coverage` | 退出码 0，全仓与包阈值均达标 |
| `pnpm audit:high` | 无 high/critical（2 moderate），退出码 0 |
| `pnpm boundary` | 939 modules / 2,133 dependencies，无违规 |
| `pnpm --filter @lumin/desktop build` | 通过 |
| `pnpm --filter @lumin/desktop test:e2e -- media-toolbox-player` | 5 passed（协议修复后重新构建复跑） |
| `pnpm gate` | 通过（2026-11-24 协议修复后复跑，退出码 0） |

## 5. 待手工复核清单

1. **开发模式 http origin 场景（2026-11-24 实测通过）**：静态托管 `out/renderer` 并以 `ELECTRON_RENDERER_URL=http://127.0.0.1:<port>` 启动真实 Electron → `media-convert:player-resolve` 返回 `lumin-media://local/...`，`<video>` `readyState=4`、`duration=1`、`error=null`，无 `MediaError 4 / URL safety check`（临时校验脚本验证后已删除，不入库）。
2. UNC 网络路径（`\\server\share\a.mp4`）打开 → 预期同协议正常播放（不依赖 file:// 加载）。
3. 播放中文件被另一进程独占/删除 → 预期 `MediaError` 2 → `VP_READ_FAILED` 错误态（可重试），不崩溃。
4. 播放 HEVC/H.265 编码的 mp4 → 预期 `MediaError` 4 → `VP_CODEC_UNSUPPORTED`，提示「文件未必损坏」且不显示重试。
5. 超大视频（>2GB）拖动进度条 → 预期按 Range 分段读取，内存不随文件线性增长、seek 正常。
6. 系统休眠/断电后重开工具 → 预期回空态（无持久化状态）。

## 6. M73 并回归档（2026-11-25）

- 页签化：`media-convert` 显示名「媒体工具箱」，「播放」页签常驻（`v-show`，切换不销毁播放状态）；通道改为 `media-convert:player-resolve`，错误码 `VP_*` 不变；源码 `packages/tools/media-convert/src/player/`，视图 `renderer/tabs/PlayerTab.vue`，无持久化设置。
- e2e 改名 `media-toolbox-player.spec.ts`（5/5 通过，2026-11-25 复跑；UI 用例的 `input[type=file]` 定位收窄到 `[data-testid="player-tab"]`，避免命中宿主隐藏拖拽区）。
- 合并后工具 chunk 随 `media-convert` 统一计量：107,332 B raw / 25,640 B gzip（见 `docs/smoke/media-convert.md` §4）。
