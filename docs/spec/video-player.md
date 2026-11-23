# 视频播放器（video-player）· M56 规格

> 状态：**已实施（I3，2026-11-22）**（plan §4.56 / Q57）· 增量 I3
> 目标：本地播放浏览器原生支持的视频（mp4/webm/ogv/ogg），零转码、零外部二进制。

## 1. 清单与分类

- id `video-player` · name「视频播放器」· category `media` · icon `play` · 主进程：有
- 复用：`DropZone`。

## 2. 字段级功能清单

| 区域 | 按钮/控件 | 输入项 | 行为 |
| --- | --- | --- | --- |
| 空态 | 选择文件 / 拖拽区 | 文件路径 | 仅 mp4/webm/ogv/ogg |
| 播放器 | 播放/暂停 / 进度 / 音量 / 倍速 0.5–2 / 全屏 | 文件 | 原生 `<video controls>` + 倍速/全屏补充 |
| 错误态 | 重试 / 换文件 | — | 不支持格式提示「请先用音视频处理转换」 |

## 3. IPC

| action | 类型 | 入参 → 出参 |
| --- | --- | --- |
| `resolve` | sync | `{path}` → `{url,name,size,mime}` |

- 主进程校验存在性与扩展名后 `pathToFileURL(path).href`。

## 4. CSP

`apps/desktop/src/main/csp.ts`：`DEV_CSP` 增 `media-src 'self' file: blob: data:` 与 `img-src ... file:`；`PROD_CSP` 增显式 `media-src 'self' file: blob: data:`。

## 5. 错误码

`VP_UNSUPPORTED_FORMAT / VP_NOT_FOUND / VP_RESOLVE_FAILED / VP_PLAYBACK_FAILED`

## 6. 三态

- 空态：DropZone。
- 加载态：`loadstart/waiting` 显示进度。
- 错误态：`video.error.code` 映射 + 结构化错误码 + 换文件。

## 7. 验收

- 纯函数单测 ≥80%（formats/schema/errors/client）。
- e2e `video-player-smoke.spec.ts`：tiny mp4 播放、mkv 报错、含空格/`#` 路径。
- chunk <200KB gzip；R2 八类见 `docs/smoke/video-player.md`。
