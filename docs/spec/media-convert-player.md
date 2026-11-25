# 媒体工具箱 · 播放页签（M56 规格；M73 并入 media-convert）

> 状态：**已实施（I3，2026-11-22）**（plan §4.56 / Q57）· 增量 I3
> 修订：**误报「视频损坏」修复（2026-11-24）** —— `MediaError` 按 code 分支映射，编码不受支持不再断言文件损坏（§5/§6）。
> 修订：**媒体加载链路修复（2026-11-24）** —— 播放地址由 `file://` 改为壳级自定义协议 `lumin-media://`：开发态 renderer 为 `http://localhost` origin，Chromium 的 URL safety check 会拒绝加载 `file://` 媒体（`MediaError 4 / SRC_NOT_SUPPORTED`），UNC 网络路径同理。
> 修订：**控件精简（2026-11-24）** —— 移除页面顶部自定义「倍速 / 全屏」，统一使用原生 `<video controls>`（原生控制栏已含倍速与全屏），避免功能重复。
> 目标：本地播放浏览器原生支持的视频（mp4/webm/ogv/ogg），零转码、零外部二进制。

## 1. 清单与分类

- 工具 id `media-convert`（显示名「媒体工具箱」）· 页签「播放」· category `media` · icon `film` · 主进程：有（通道 `media-convert:player-resolve`）· 源码 `src/player/`、视图 `renderer/tabs/PlayerTab.vue`
- M73（2026-11-25）由 `video-player` 整包并入；错误码保留 `VP_*`；无 settings 键。
- 复用：`DropZone`。

## 2. 字段级功能清单

| 区域 | 按钮/控件 | 输入项 | 行为 |
| --- | --- | --- | --- |
| 空态 | 选择文件 / 拖拽区 | 文件路径 | 仅 mp4/webm/ogv/ogg |
| 播放器 | 播放/暂停 / 进度 / 音量 / 倍速 / 全屏（均为原生控制栏） | 文件 | 原生 `<video controls>`；页面不再提供重复的自定义倍速/全屏控件 |
| 错误态 | 重试（仅可重试码）/ 换文件 | — | 结构化错误码 → 中文文案；编码不受支持时提示「文件未必损坏，请先用音视频处理转换」 |

## 3. IPC

| action | 类型 | 入参 → 出参 |
| --- | --- | --- |
| `resolve` | sync | `{path}` → `{url,name,size,mime}` |

- 主进程校验存在性与扩展名后，用 shared `toMediaUrl(path)` 生成 `lumin-media://local/<base64url(UTF-16LE 路径)>`；壳 `media-protocol.ts` 校验「绝对路径 + 普通文件」后经 `net.fetch(file://)` 流式回源（透传 `Range`，支持拖动进度条）。路径按 UTF-16 码元编码，中文/空格/`#`/网络路径均无损往返。

## 4. CSP 与自定义协议

- `apps/desktop/src/main/csp.ts`：`DEV_CSP` 与 `PROD_CSP` 的 `media-src` 均含 `lumin-media:`；`img-src` 保留 `file:`。
- `apps/desktop/src/main/media-protocol.ts`：`registerSchemesAsPrivileged`（`standard + secure + supportFetchAPI + stream`）必须在 app ready 前调用，`protocol.handle` 在 ready 后注册；非法 URL / 非绝对路径 / 非普通文件一律 404，不发起远程请求。

## 5. 错误码

| 错误码 | 触发条件 | 可重试 | 中文文案（同源 `errors.ts`） |
| --- | --- | --- | --- |
| `VP_UNSUPPORTED_FORMAT` | 扩展名不在 mp4/webm/ogv/ogg 白名单 | 否 | 不支持该视频格式，请先用「音视频处理」转换 |
| `VP_NOT_FOUND` | `stat` 失败且 errno 为 `ENOENT` | 否 | 文件不存在或无法访问 |
| `VP_RESOLVE_FAILED` | `stat` 其他失败 / 非普通文件 / `toMediaUrl` 生成失败 | 是 | 无法解析视频文件 |
| `VP_PLAYBACK_FAILED` | `MediaError` 3（DECODE）/ 未知 code / 无 code | 是 | 视频解码失败，文件可能已损坏或编码不受支持 |
| `VP_CODEC_UNSUPPORTED` | `MediaError` 4（SRC_NOT_SUPPORTED，容器合法但编码不支持，如 HEVC in mp4） | 否 | 视频编码不受支持，浏览器无法解码（文件未必损坏），请先用「音视频处理」转换 |
| `VP_READ_FAILED` | `MediaError` 2（NETWORK：文件被移动 / 占用 / 无读取权限） | 是 | 视频文件读取失败，文件可能已被移动、占用或无读取权限 |

- `MediaError` 1（ABORTED，切换 `src` 的正常中断）不提示、不进入错误态。
- `MediaError` 4 但原始文案为 URL 安全校验拦截（含 `URL safety check` / `Media load rejected`）时归 `VP_READ_FAILED`（可重试），避免把传输层拦截误报成编码不支持。

## 6. 三态

- 空态：DropZone。
- 加载态：`loadstart/waiting` 显示进度。
- 错误态：`playbackError(code, message)` 按 `MediaError.code` 分支映射为结构化错误（映射表见 §5），`detail` 保留 `MediaError <code>（NETWORK|DECODE|SRC_NOT_SUPPORTED）：<原始 message>`；仅可重试码显示「重试」，其余只保留「换一个视频」。

## 7. 验收

- 纯函数单测 ≥80%（formats/schema/errors/client；`errors.ts` 实测四项 100%，含 `playbackError` 八类分支；shared `media-url.ts` 覆盖编解码与非法 URL）。
- e2e `media-toolbox-player.spec.ts`：mp4/webm 解析（`lumin-media://` 前缀 + 解码还原路径）、真实 WebM 播放（断言原生 `controls` 存在、页面无自定义倍速/全屏）、mkv 报错、含空格/`#`/中文路径（5/5）。
- chunk <200KB gzip（并入后随 `media-convert` 工具 chunk 统一计量，实测见 `docs/smoke/media-convert.md`）；R2 八类见 `docs/smoke/media-convert-player.md`。
