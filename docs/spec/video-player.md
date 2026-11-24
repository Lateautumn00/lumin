# 视频播放器（video-player）· M56 规格

> 状态：**已实施（I3，2026-11-22）**（plan §4.56 / Q57）· 增量 I3
> 修订：**误报「视频损坏」修复（2026-11-24）** —— `MediaError` 按 code 分支映射，编码不受支持不再断言文件损坏（§5/§6）。
> 目标：本地播放浏览器原生支持的视频（mp4/webm/ogv/ogg），零转码、零外部二进制。

## 1. 清单与分类

- id `video-player` · name「视频播放器」· category `media` · icon `play` · 主进程：有
- 复用：`DropZone`。

## 2. 字段级功能清单

| 区域 | 按钮/控件 | 输入项 | 行为 |
| --- | --- | --- | --- |
| 空态 | 选择文件 / 拖拽区 | 文件路径 | 仅 mp4/webm/ogv/ogg |
| 播放器 | 播放/暂停 / 进度 / 音量 / 倍速 0.5–2 / 全屏 | 文件 | 原生 `<video controls>` + 倍速/全屏补充 |
| 错误态 | 重试（仅可重试码）/ 换文件 | — | 结构化错误码 → 中文文案；编码不受支持时提示「文件未必损坏，请先用音视频处理转换」 |

## 3. IPC

| action | 类型 | 入参 → 出参 |
| --- | --- | --- |
| `resolve` | sync | `{path}` → `{url,name,size,mime}` |

- 主进程校验存在性与扩展名后 `pathToFileURL(path).href`。

## 4. CSP

`apps/desktop/src/main/csp.ts`：`DEV_CSP` 增 `media-src 'self' file: blob: data:` 与 `img-src ... file:`；`PROD_CSP` 增显式 `media-src 'self' file: blob: data:`。

## 5. 错误码

| 错误码 | 触发条件 | 可重试 | 中文文案（同源 `errors.ts`） |
| --- | --- | --- | --- |
| `VP_UNSUPPORTED_FORMAT` | 扩展名不在 mp4/webm/ogv/ogg 白名单 | 否 | 不支持该视频格式，请先用「音视频处理」转换 |
| `VP_NOT_FOUND` | `stat` 失败且 errno 为 `ENOENT` | 否 | 文件不存在或无法访问 |
| `VP_RESOLVE_FAILED` | `stat` 其他失败 / 非普通文件 / `pathToFileURL` 失败 | 是 | 无法解析视频文件 |
| `VP_PLAYBACK_FAILED` | `MediaError` 3（DECODE）/ 未知 code / 无 code | 是 | 视频解码失败，文件可能已损坏或编码不受支持 |
| `VP_CODEC_UNSUPPORTED` | `MediaError` 4（SRC_NOT_SUPPORTED，容器合法但编码不支持，如 HEVC in mp4） | 否 | 视频编码不受支持，浏览器无法解码（文件未必损坏），请先用「音视频处理」转换 |
| `VP_READ_FAILED` | `MediaError` 2（NETWORK：文件被移动 / 占用 / 无读取权限） | 是 | 视频文件读取失败，文件可能已被移动、占用或无读取权限 |

- `MediaError` 1（ABORTED，切换 `src` 的正常中断）不提示、不进入错误态。

## 6. 三态

- 空态：DropZone。
- 加载态：`loadstart/waiting` 显示进度。
- 错误态：`playbackError(code, message)` 按 `MediaError.code` 分支映射为结构化错误（映射表见 §5），`detail` 保留 `MediaError <code>（NETWORK|DECODE|SRC_NOT_SUPPORTED）：<原始 message>`；仅可重试码显示「重试」，其余只保留「换一个视频」。

## 7. 验收

- 纯函数单测 ≥80%（formats/schema/errors/client；`errors.ts` 实测四项 100%，含 `playbackError` 七类分支）。
- e2e `video-player-smoke.spec.ts`：mp4/webm 解析、真实 WebM 播放、mkv 报错、含空格/`#` 路径（5/5）。
- chunk <200KB gzip（实测 14,009 B raw / 4,906 B gzip）；R2 八类见 `docs/smoke/video-player.md`。
