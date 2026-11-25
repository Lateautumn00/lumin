# 下载能力优化专项调研报告

> 调研对象：`putyy/res-downloader`、`bhwa233/galaxy-downloader`
> 对照基线：Lumin `@lumin/tool-media-convert` 下载页签（yt-dlp + ffmpeg 子进程方案）
> 版本：v1.0（2026-11-25）· 性质：只读调研，未改动任何业务代码
> 结论口径：以「可直接落地且不破坏现有稳定性」为第一优先级；不可复用代码一律标注真实原因，不夸大

---

## 0. 结论摘要

| 结论 | 内容 |
| ---- | ---- |
| 两个项目代码**均不可直接移植** | res-downloader 是 Go + Wails 单进程应用；galaxy-downloader 是 React 前端 + **闭源托管 API**，且为**非 OSI 非商用许可** |
| 真正有价值的是**机制**，不是代码 | 分片并行下载器、HLS 兜底链路、抓包头复用、失败降级策略四类机制可直接用 TS 重写 |
| 不建议照搬的部分 | 系统代理 + MITM + 根证书（安全/合规双重风险）、ffmpeg.wasm（GPL + 已有原生 ffmpeg）、galaxy 的托管解析 API（闭源、不可自建） |
| 最值得做的三件事 | ① 批量队列 + 文件名模板 + 失败归因（P0，纯 TS，改动面小）② 内置页面嗅探（Electron `webRequest`，**不用 MITM**）③ HLS 兜底下载器（覆盖 m3u8/直链） |
| 明确不做 | 系统级代理嗅探与证书安装、DRM/签名逆向、直播录制（P2 再议） |
| 抖音/快手怎么落 | 两项目**都没有可移植的解析代码**（A = 系统代理 MITM 抓真实播放流；B = 闭源后端 API）；可落地方案是**分享页 SSR 直链解析**（iPhone UA + 页面内 `play_addr` / `.mp4` 直链），见 §7 |

**总体判断**：现有 yt-dlp 主链路在站点解析上强于两个参考项目（1200+ extractor），短板集中在「**非站点型资源**（网页 m3u8、直链、视频号/小程序素材）」与「**任务体验**（批量、命名、归因、持久化）」。优化应围绕补短板，而非替换引擎。

---

## 1. 调研对象与当前基线

### 1.1 项目 A：putyy/res-downloader（爱享素材下载器）

| 维度 | 事实 |
| ---- | ---- |
| 定位 | 跨平台资源**嗅探**下载器：微信视频号/小程序、抖音、快手、小红书、QQ/酷狗音乐、网页视频音频图片、m3u8、直播流 |
| 技术栈 | Go 1.22 + Wails v2.12（WebView2/WKWebView）；前端 Vue 3 + Naive UI + Pinia + Vite + Tailwind 3 + video.js/flv.js |
| 进程模型 | **单进程**：Go 内置 HTTP/WS 服务 + Wails 绑定；无 Electron、无 Node 侧 |
| 许可/活跃度 | Apache-2.0；约 5.4k star；v3.1.3，最后 push 2025-03-06（README 声明维护放缓） |

**核心架构与数据流**：本地代理 `127.0.0.1:8899` → 写 Windows 注册表系统代理（`core/system_windows.go`）→ 根证书（PEM **硬编码在 `core/app.go`**）经 `CertOpenStore(ROOT)` 装入系统信任区 → `elazarl/goproxy v1.7.2` 做 TLS MITM → 按域名规则表（`core/rule.go`，支持 `*`、`*.domain`、`!` 否定）决定解密或透传 → `OnResponse` 按 `Content-Type` 分类（`core/plugins/plugin.default.go`）→ 命中即构造 `MediaInfo`（`MD5(url)` 去重）→ WebSocket 推送 `newResources` → 用户点选下载，**复用抓包请求头**（剔除 `accept-encoding`/`host`/`sec-fetch-*` 黑名单）后交给 `FileDownloader`。

**下载器实现（`core/downloader.go`，本项目最有价值的部分）**：

1. `HEAD` 探测长度 → 仅当响应含 `Accept-Ranges` 且体积 > 1MB 才走多分片；
2. 预分配文件（`Truncate`）+ 各 goroutine `WriteAt` 指定偏移写入，避免内存聚合；
3. 最小分片 1MB，单片失败重试 3 次，整体失败**自动降级单线程重下**；
4. `context` 取消时删除半成品；进度经 channel 汇总后推送；
5. 并发参数：`TaskNumber = NumCPU*2`（单任务分片数）、`DownNumber = 3`（并行任务数）。

**其他要点**：文件名 = 描述清洗 + 截断 + 时间戳 + `GetUniqueFileName` 防重名；配置/规则存 JSON；**无任务持久化、无断点续传**；视频号文件用 base64 密钥 **XOR 头部 N 字节**解密（`core/resource.go`）；**m3u8 不做解析合并**，仅嗅探直链，README 建议配合外部工具。

**优势**：嗅探覆盖面广（系统级代理可捕获 WebView/原生 App 流量）；分片下载器工程质量高、失败降级完善；无外部二进制依赖。
**局限**：证书与私钥硬编码（安全反面教材）；系统代理影响全局、卸载/异常易残留；m3u8/直播不做合并录制；无任务持久化与断点续传；维护放缓、平台规则易失效。

### 1.2 项目 B：bhwa233/galaxy-downloader

| 维度 | 事实 |
| ---- | ---- |
| 定位 | Web/PWA 多平台媒体下载站（B站、抖音、小红书、IG、TikTok、X、Telegram、微信、微博、Niconico、Vimeo、Twitch、SoundCloud、Apple Podcasts 等） |
| 技术栈 | Next.js 16 App Router 跑在 **vinext**（Vite 8 + Cloudflare Workers）；React 19 + TS + Tailwind 4 + shadcn/ui；hls.js / hls-parser / ffmpeg.wasm / JSZip / p-retry |
| 进程模型 | **仓库只有前端**；解析与下载由独立服务完成（默认 `https://downloader-api.bhwa233.com`，端点 `/api/parse`、`/api/download`、`/api/play`），**后端不开源** |
| 许可/活跃度 | 自定义「个人使用及免费公开服务许可证」（源码可用、**非 OSI 开源、禁商用**）；`@ffmpeg/core 0.12.9` 为 GPL-2.0-or-later；约 1.1k star；v6.3.2，最后 push 2026-11-19（活跃） |

**核心架构与数据流**：粘贴链接 → `/api/parse` 返回 `downloadVideoUrl` / `downloadAudioUrl` / `mediaActions` → 前端按 action 分支：`direct-download`（a 标签）/ `merge-then-download`（分别下载音视频后 ffmpeg.wasm 合并）/ `browser-hls-download`（前端拉分片）/ `extract-audio`。`src/lib/unified-parse.ts` 管并发 in-flight 去重、429 `Retry-After` 冷却、超 60 次解析强制刷新。

**HLS 前端下载（本项目最有参考价值的部分）**：

- `src/lib/hls-browser-download.ts`：解析 master/media playlist，`pickBestVariant` 取最高码率；支持 `EXT-X-BYTERANGE`、`EXT-X-MAP`（init 段）、**AES-128 用 WebCrypto 解密**（缺 IV 时用 `mediaSequence` 构造）；
- `src/components/hls-browser-download-panel.tsx`：**8 分片并发**、每片 `p-retry` 3 次、`ReadableStream` **按序 flush** 保证时序、File System Access 流式写盘；不支持流式且分片 > 800 时直接拒绝；
- `src/lib/ffmpeg.ts`：FFmpeg 单例，core wasm 拆成 `.part-0/1` 并行拉取拼 Blob，45s 超时，本地 → jsdelivr → 镜像三级兜底。

**优势**：多平台覆盖面广；HLS 处理细节完备（加密、init 段、字节区间、有序落盘）；错误与限流处理规范（429 冷却、action 分支模型）。
**局限**：**解析能力完全依赖闭源 API**，不可自建、不可离线、配额与可用性不可控；强非商用许可；无服务端任务队列与断点续传；ffmpeg.wasm 体积大、性能低。

---

## 2. 与当前项目的对比分析

### 2.1 当前基线（来自 `docs/spec/media-convert-download.md` 与源码）

| 能力 | 现状 |
| ---- | ---- |
| 引擎 | `binaries/download/yt-dlp.exe` + `ffmpeg.exe`，`scripts/fetch-binaries.mjs` 固定 URL + SHA256 拉取，产物 gitignore |
| 调用方式 | 主进程 `node-kit.runProcess` 流式行回调解析进度；壳任务队列（全局并发 2）；`cancel` 经 AbortSignal |
| 通道 | `media-convert:download-probe` / `download-start`（task）/ `download-mark-pause` / `download-history` / `download-history:clear` + `download-cookie:*` |
| 输入 | 支持整段分享口令提取；URL 仅 `http(s)`；格式预设 `best / 1080p / audio-mp3` |
| Cookie | 二期已落地：粘贴 + Firefox/Chromium-legacy 自动读取；**safeStorage 加密**按平台存储；临时 Netscape 文件注入并清理 |
| 续传/历史 | `--continue` 续传 `.part`（仅 `PAUSED` 项）；历史 JSON 滚动 100 条；重启后 `RUNNING` 归为 `FAILED` |
| 明确不做 | 直播录制、系统代理嗅探、DRM/签名逆向；引擎检查更新仅提示不下载 |
| 体积 | 下载页签逻辑在主进程，工具 renderer chunk **25,640 B gzip** |

### 2.2 兼容性矩阵

| 维度 | A：res-downloader | B：galaxy-downloader | 与本项目兼容性 |
| ---- | ---- | ---- | ---- |
| 语言/运行时 | Go + Wails | React + Workers（前端） | **均不兼容**：本项目为 Electron 主进程 TS，无 Go 工具链、无 Cloudflare 运行时 |
| 代码复用 | 0%（仅算法/结构参考） | 0%（且**许可禁止商用**） | 复用方式只能是「按机制用 TS 重写」 |
| 依赖策略 | 无外部二进制 | ffmpeg.wasm（GPL） | 本项目已有原生 ffmpeg，**引入 wasm 无收益且触 R7 许可审查** |
| 离线能力 | 全离线（本地代理） | 强依赖在线 API | 本项目离线优先 → **B 的后端模式不可取** |
| 安全基线 | 硬编码根证书 + 系统代理 | 无特殊 | 本项目 `sandbox/contextIsolation/CSP` 基线**不得下调**，MITM 方案与之冲突 |
| 架构约束 | — | — | `tools/*` 只依赖 `plugin-api/shared/ui/node-kit/ocr-kit`；两项目代码结构均无法归入现有包边界 |
| 适配成本 | 中高（需自研嗅探，但可绕开 MITM） | 高（后端不可得） | A 的「机制」适配成本远低于 B |

### 2.3 差距定位（优化方向）

1. **非站点资源**：yt-dlp 对网页内嵌 m3u8、直链、视频号/小程序素材无解 → 需「嗅探 + 直链/HLS 下载」；
2. **任务体验**：单链接提交、无批量、命名不可控、失败原因黑盒、队列与历史不够持久；
3. **引擎维护**：yt-dlp 站点规则高频变化，当前仅「检查更新提示」，缺少受控升级通道。

---

## 3. 可复用点清单（机制级）

> 成本口径：**S**（≤3 文件、≤300 行）、**M**（3–8 文件、300–800 行）、**L**（>8 文件、>800 行或涉及新窗口/协议）。
> 所有新增逻辑默认落在 `packages/tools/media-convert/src/download/**` 与 `src/renderer/tabs/DownloadTab.vue`，**不新增第三方依赖**。

| # | 复用点 | 来源 | 落地方式（TS 重写） | 成本 | 预期收益 |
| - | ---- | ---- | ---- | ---- | ---- |
| R1 | Range 分片并行 + 预分配偏移写 + 失败降级 | A `core/downloader.go` | 主进程 `http-downloader.ts`：`HEAD` 探测 → `Accept-Ranges && size>1MB` 才分片；`fs.open` + `fs.write` 带 `position`；单片 3 次重试；整体失败降级单流；`AbortSignal` 取消删除 `.part` | M | 直链下载速度与稳定性提升；摆脱 yt-dlp 对直链的额外开销 |
| R2 | 抓包请求头复用 + 敏感头黑名单 | A `plugin.default.go` / `downloader.go` | 嗅探得到的 `requestHeaders` 过滤 `accept-encoding/host/content-length/sec-fetch-*` 后，转 `yt-dlp --add-header` 或自研下载器 headers | S | 防盗链/鉴权直链可下载（关键成功率提升点） |
| R3 | HLS 解析 + 并发分片 + 有序落盘 | B `hls-browser-download.ts` | 主进程 `hls-downloader.ts`：解析 master/media，`pickBestVariant`；支持 `BYTERANGE` / `EXT-X-MAP` / AES-128（`node:crypto`）；**8 并发**、3 次重试、按序 `WriteStream` 写入；超 800 分片降并发 | M–L | 覆盖网页 m3u8 / 直播回放；yt-dlp 失败时兜底 |
| R4 | action 分支模型（direct/merge/hls/extract） | B `unified-parse.ts` | 抽象为本地 `ResolvedMedia` union：`direct` / `hls` / `video+audio`（ffmpeg 合并）/ `audio`；不做远程 API | S | 统一嗅探结果与站点解析结果的执行分派 |
| R5 | 分片并发/重试/降级参数化 | A + B | 将 `fragConcurrency`、`retry`、`minPartSize` 提升为设置项（`tools.media-convert.download.*`），默认值与现值一致 | S | 弱网可调，避免硬编码 |
| R6 | 失败原因归因表 | A/B 错误处理 | 对 yt-dlp stderr 关键字映射：`login required`→`VD_LOGIN_REQUIRED`、`Private video`→`VD_PRIVATE`、`not available in your country`→`VD_REGION_BLOCKED`、`HTTP Error 403`→`VD_FORBIDDEN`（新增码需登记 spec） | S | 用户可自助修复（导 cookie / 换链接），减少无效重试 |
| R7 | 文件名模板 + 唯一化 | A `GetUniqueFileName` | 复用 `shared.uniqueFileName`，新增模板变量 `{title}/{platform}/{date}/{id}/{ext}`，非法字符清洗 | S | 批量下载可管理 |
| R8 | 任务持久化（队列 + 历史） | A（配置持久化思路） | 历史 JSON 增字段 `status/queueOrder/attempts`，启动恢复 `QUEUED`；保持 100 条上限与原子写 | S–M | 重启不丢队列，断点可续 |
| R9 | 内置页面嗅探（**替代 MITM**） | A 的嗅探目标 | 见 §4 P1：独立 `session.fromPartition` + `webContents` 加载用户粘贴的页面 URL；`session.webRequest.onResponseStarted` 按 `Content-Type`/扩展名捕获候选直链；**不装证书、不改系统代理** | L | 补齐网页 m3u8/直链/视频号素材场景 |
| R10 | 引擎受控升级 | A 无 / B 无 | `yt-dlp.exe` 升级走「签名清单（URL+SHA256+版本）→ 下载到 temp → 校验 → 原子替换 → 失败回滚」；仍守 R7 固定 URL + SHA256 | M | 站点规则失效率下降 |

**明确不复用**：A 的 MITM/证书安装与注册表代理（安全与合规风险，且与 Electron 安全基线冲突）；B 的托管解析 API（闭源、离线不可用）、ffmpeg.wasm（GPL、体积/性能劣势）、非商用许可代码。

---

## 4. 落地实施路径

> 工作量以相对规模标注（S/M/L），不给出绝对工期；每项均需走 R8 决策登记 + spec/smoke 同步。

### P0（先做，风险最低、收益即时）

| 顺序 | 事项 | 改动面 | 验收指标 |
| ---- | ---- | ---- | ---- |
| P0-1 | 批量多链接提交 + 队列持久化（R8/R5） | `schema.ts`（数组化）、`history.ts`（状态机）、`DownloadTab.vue` | 一次粘贴 ≥5 链接全部入队；重启后队列恢复；并发上限可配且默认 2 |
| P0-2 | 失败归因（R6） | `errors.ts` + `node.ts` stderr 映射 | 登录/私密/地区/403 四类可复现并给出对应中文指引 |
| P0-3 | 文件名模板（R7） | `naming` 纯函数 + UI 输入 | 模板变量全量单测；非法字符与重名 `(n)` 断言 |
| P0-4 | 分片/重试参数化（R5） | settings schema + UI | 默认值与现值一致，回归用例全绿 |

### P1（核心竞争力，需新窗口/新协议）

| 顺序 | 事项 | 改动面 | 验收指标 |
| ---- | ---- | ---- | ---- |
| P1-1 | 内置页面嗅探页签（R9） | 主进程新建 `sniff/`（独立 partition、`webRequest` 监听、候选列表）、renderer 新子页签 | 10 个样本页（含 3 个 m3u8 站）候选命中 ≥8；不修改系统代理、不安装证书；关闭页签即销毁 session |
| P1-2 | HLS 兜底下载器（R3/R4） | `download/hls/*` + `ResolvedMedia` 分派 | AES-128 与 BYTERANGE 样本可完整落盘并通过 ffprobe 校验；取消无残留 |
| P1-3 | Range 分片下载器（R1/R2） | `download/http/*` | 大文件（>200MB）下载成功；断网续传；分片失败降级单流可复现 |

### P2（评估后再说）

| 事项 | 说明 |
| ---- | ---- |
| 直播录制 | 依赖 yt-dlp `--live-from-start` + ffmpeg 分段，涉及长时间任务、磁盘与合规风险；先做可行性样本 |
| 引擎受控升级（R10） | 需先定「清单签名/回滚」策略，避免破坏 R7 供应链约束 |
| 系统代理/MITM 嗅探 | **不建议**：安全基线冲突 + 合规风险高，P1 的进程内嗅探已覆盖绝大多数场景 |

---

## 5. 风险点与规避措施

| 风险 | 等级 | 规避措施 |
| ---- | ---- | ---- |
| 合规风险（绕过平台限制、DRM、版权） | 高 | 延续免责三重呈现；**仅下载用户有权访问的公开资源**；不内置签名逆向、不内置 cookie 池、不做 DRM 解密；新增嗅探页签首次使用弹窗确认 |
| 安全风险（证书、代理、凭据） | 高 | **不采用 MITM/系统证书**；嗅探仅在进程内独立 session；cookie 继续 safeStorage 加密 + 临时文件即用即删 + 日志脱敏（R10） |
| 稳定性风险（自研下载器） | 中 | 新引擎**默认关闭**，作为 yt-dlp 失败后的显式兜底；与主链路隔离（独立文件、独立通道）；补齐单测（≥80%）与 R2 八类冒烟；异常自动回退 yt-dlp |
| 许可/依赖风险 | 中 | 不引入 ffmpeg.wasm（GPL）、不复制 galaxy 非商用代码；新增逻辑仅用 Node 内置（`fetch`/`crypto`/`fs`），`pnpm audit` 零 high/critical |
| 体积风险（R5） | 低 | 逻辑全部在主进程，renderer 不新增依赖；改后复测工具 chunk（现 25.6KB gzip） |
| 平台规则失效 | 中 | 归因映射 + 引擎升级通道；失败提示引导升级而非静默失败 |
| 决策漂移 | 中 | 每项落地前在 `plan.md` 登记 Q/M 编号并同步 `AGENTS.md §11`、spec/smoke、CHANGELOG（R8） |

---

## 6. 决策建议

**做**：P0 全部（批量队列、失败归因、命名模板、参数化）→ P1-1 进程内嗅探 → P1-2 HLS 兜底 → P1-3 Range 下载器。

**不做**：系统代理 + 证书 MITM、复用 galaxy 后端/代码、ffmpeg.wasm、DRM 绕过、P2 直播录制（暂缓）。

**依据**：两个项目的代码层复用价值为 0，但 R1/R2/R3 三项机制恰好补齐本项目「直链与 HLS 兜底」「鉴权头透传」「并发分片稳定性」三个真实短板；采用「机制重写 + 默认关闭兜底」的方式，可在不触碰现有 yt-dlp 主链路与安全基线的前提下获得可量化收益。

---

## 7. 抖音 / 快手专项落地方案（2026-11-25 补充）

### 7.1 两个参考项目到底怎么下抖音/快手

| 项目 | 真实做法 | 能否用于 Lumin |
| ---- | -------- | -------------- |
| res-downloader | **系统代理 + 根证书 MITM 抓包**：读取用户在 App/WebView 中的真实播放请求，拿到播放器实际使用的 mp4/m3u8 地址与请求头，再交自带分片下载器。README 明确要求「安装时允许安装证书」 | **不能**：与 Electron 安全基线（不装证书、不改系统代理）冲突；且系统代理残留会影响全局网络 |
| galaxy-downloader | 前端把链接交给**闭源托管后端** `/api/parse`，由后端做平台解析，前端只负责下载/合并 | **不能**：后端不开源、离线不可用、非商用许可 |

结论：所谓「他们的抖音/快手方案」本质是**拿到播放器真实使用的直链**。这条路可以走，但必须换实现方式——**不 MITM、不闭源 API**，改为解析平台**分享页 SSR HTML** 中内联的直链。该方式已被成熟第三方实现验证（`zyipeng/video-downloader`，2026-09 更新；文档明确「抖音绕开 yt-dlp 失效 extractor 走分享页 SSR」「yt-dlp 无内置快手 extractor，走分享页 SSR」）。

### 7.2 抖音（Douyin）方案

**URL 形态**：`v.douyin.com/xxx`（App 短链）、`www.douyin.com/video/{id}`、`www.douyin.com/...?modal_id={id}`、`www.iesdouyin.com/share/video/{id}`。

**解析链路（纯 HTTP，无需登录、无需签名）**：

1. 取 `aweme_id`：
   - 短链：`HEAD`/`GET` 跟随 302，从 `Location` 取 `/(video|share/video)/(\d+)`；
   - 长链：直接正则 `/(video|share/video)/(\d+)`；
   - 兜底：`modal_id=(\d+)`。
2. 拉分享页：`https://www.iesdouyin.com/share/video/{aweme_id}/`，**UA 用 iPhone Safari**（移动 UA 才返回含直链的 SSR 页）。
3. 提取：
   - 标题：`<title>`；
   - 直链：优先 `window._ROUTER_DATA` JSON 的 `video.play_addr.url_list`；退化用正则抓 `"play_addr":{...}` 块内 URL（`\u002F`/`\/` 需反转义）。
4. 画质档位（分享页 API 隐式参数）：`/play/?ratio=720p|1080p|default`；`default` = 原始母版（可能 4K HEVC），`1080p` = H.264 兼容档，`720p` = 最小体积。
5. 去水印：地址中 `playwm` → `play`（`playwm` 恒为 720p 带水印；`play` 为无水印流）。

**已知边界**：yt-dlp 内置 Douyin extractor 自 2025 反爬升级后常失效（本项目 spec 已记录「需 fresh cookies」）；分享页 SSR 不依赖 cookie，但页面结构变更会导致解析失败，需保留 yt-dlp 作为兜底。

### 7.3 快手（Kuaishou）方案

**URL 形态**：`v.kuaishou.com/{shortCode}`（App 分享）、`www.kuaishou.com/short-video/{photoId}`、`www.kuaishou.com/f/{shareToken}`。

**解析链路**：

1. 用 iPhone UA + `Accept-Language: zh-CN` 拉分享页 HTML（跟随 302）。
2. `photoId`：页面内 `short-video/([\w-]+)` → `clientCacheKey=([\w-]+)` → URL 路径，三级兜底。
3. 直链：正则抓页面内全部 `https?://...\.mp4(\?...)?`，按文件名分类：含 `hd15`/`_hd` = 高清、`_b_` = 标清；`quality` 取 HD，`speed` 取 SD。
4. 标题：`<title>`。

**已知边界**：yt-dlp **无内置快手 extractor**（`Unsupported URL`）；快手指令 token 有 TTL，过期/年龄/地区限制时页面无 mp4，需归因提示「链接已失效，请重新复制分享链接」。

### 7.4 与 Lumin 的落点映射（最小改动版）

| 层 | 改动 | 说明 |
| -- | ---- | ---- |
| `download/platforms/douyin.ts`（新） | 纯函数 + `net.fetch`：`extractAwemeId(url)` / `resolveDouyin(url, ratio)` → `{ title, url, ratioOptions }` | 正则与 JSON 解析全部纯函数，单测 ≥80% |
| `download/platforms/kuaishou.ts`（新） | 纯函数：`resolveKuaishou(url)` → `{ title, urls: { hd?, sd? } }` | 同上 |
| `download/node.ts` | `probe` 前置平台分流：命中 douyin/kuaishou → 走 SSR 解析；否则原 yt-dlp 逻辑 | 不改动原有 yt-dlp 分支 |
| `download/progress.ts` | `buildStartArgs` 增加 `--add-header`（UA/Referer）与直链模式 | **直链仍交给 yt-dlp 下载**，进度/暂停/续传/历史全部复用，零新增下载器 |
| `schema.ts` / `DownloadTab.vue` | 预设扩展为平台感知（抖音 ratio 三档、快手 HD/SD）；错误码新增 `VD_LINK_EXPIRED`（需登记 spec） | 三态与文案按既有规范 |

**关键决策**：P0 **不自研 Range 下载器**——解析出直链后直接 `yt-dlp <直链> --add-header ...`，先把抖音/快手跑通且不引入新下载路径；原生 Range 分片下载器放 P1（见 §4 R1）。
**收益**：抖音/快手从「不支持/需 cookie 且常失效」变为可用；改动集中在 2 个新文件 + 1 处分流，成本 **M**，不触碰主链路。
**验收**：抖音短链/长链/modal_id 各 1 条 + 快手三种链接形态各 1 条，probe 出标题与直链、下载完成且 `ffprobe` 可解析；断网/取消沿用既有 R2 八类冒烟记录。

### 7.5 专项风险与规避

| 风险 | 规避 |
| ---- | ---- |
| 去水印的合规边界（`playwm`→`play`） | 属「取平台分享页已提供的非水印流」，但仍需在免责口径中明确；建议做成**默认开启的『优先无水印』开关**并在 spec 登记（走 R8） |
| 平台页面结构变更 | 解析失败 → 自动回退 yt-dlp；错误码 `VD_UNSUPPORTED_PLATFORM`/`VD_PROBE_FAILED` 给出「平台改版，请升级应用」指引；解析器集中单文件，便于快速修复 |
| 快手 token TTL | 归因 `VD_LINK_EXPIRED`，提示重新复制分享链接，不重试 |
| 请求被风控/地区限制 | 仅用分享页公开 HTML，不加 cookie 池、不做签名逆向；失败明确告知，不静默重试 |
| 页面体积过大 | `net.fetch` 读取上限（如 5MB）+ 15s 超时，超限即失败 |

---

## 附：证据索引

- 项目 A：`core/downloader.go`、`core/proxy.go`、`core/rule.go`、`core/system_windows.go`、`core/resource.go`、`core/plugins/plugin.default.go`、`go.mod`
- 项目 B：`src/lib/hls-browser-download.ts`、`src/components/hls-browser-download-panel.tsx`、`src/lib/unified-parse.ts`、`src/lib/config.ts`、`src/lib/ffmpeg.ts`
- 本项目：`docs/spec/media-convert-download.md`、`packages/tools/media-convert/src/download/{node,schema,errors,history,cookies,browser-cookies,progress}.ts`、`scripts/fetch-binaries.mjs`、`docs/opencode/plan.md`（Q73/M73、§4.5）
- 抖音/快手分享页 SSR 参考实现（§7）：`zyipeng/video-downloader` 的 `scripts/download-douyin.sh`、`scripts/download-kuaishou.sh`（2026-09）；对照 `yxxbc/downvid`（抖音/快手走站点 Web API 取播放器流地址）
- 平台支持事实：yt-dlp 2026.10.26（本项目锁定版本）有 Douyin extractor、**无** Kuaishou extractor
