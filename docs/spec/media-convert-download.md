# 媒体工具箱 · 下载页签 — 字段级功能清单（M4 验收附件；M73 并入 media-convert）

> 依据 AGENTS §11：开工前定稿。变更须同步更新本文件与 `docs/opencode/plan.md` §4.5。
> 工具 id：`media-convert`（显示名 **媒体工具箱**）· 页签「下载」· 包：`@lumin/tool-media-convert` · 视图：`renderer/tabs/DownloadTab.vue`
> M73（2026-11-25）由 `video-download` 整包并入：源码在 `src/download/`，通道统一 `media-convert:download-*`，设置键 `tools.media-convert.download.*`（旧键不迁移）。
> 引擎：yt-dlp（版本随包钉死）+ ffmpeg（合流；ffprobe 已于 2026-11-19 移除，plan §4.10），`scripts/fetch-binaries.mjs` 固定 URL + SHA256，gitignore，打包走 `resources/binaries`。

## 0. 合规与免责（R8 定稿，2026-11-18）

**文案正文**（plan §4.5 同文，修改须重走 R8）：

> 本工具仅用于个人学习、研究与非商业用途的内容备份。您应确保：① 仅下载您拥有合法权利或平台明确允许下载的内容；② 遵守目标平台服务条款与所在地法律法规；③ 不将下载内容用于商业传播、二次分发或任何侵权用途；④ 因使用本工具产生的法律责任由使用者自行承担。本工具不内置任何绕过平台技术限制的能力。

**三重呈现**（用户拍板）：

| #   | 位置                  | 形态                                                                                                                             | 归属（零耦合）                                               |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | 工具页首次进入弹窗    | Naive UI modal 展示全文 + [同意并继续]（唯一主按钮）+ [不再提示] 复选框；未同意则工具主功能区置灰不可操作；重置途径 = 设置页开关 | 工具包内，settings `tools.media-convert.download.disclaimerAccepted` |
| 2   | 工具页顶部常驻 banner | 一句话：「仅供个人学习与研究使用，请遵守平台条款与著作权法」（`text-xs` tokens 弱化样式，不可关闭）                              | 工具包内                                                     |
| 3   | 壳关于页「使用声明」  | 链接弹窗展示全文（通用合规声明，**不含任何工具名**）                                                                             | 壳层 `i18n` + About 页                                       |

**平台范围（随免责一并定）**：一期验收 B站（bilibili.com）+ YouTube（youtube.com）；抖音等国内平台一期 yt-dlp 直连试探一次，成功则记录、失败标注二期（C 类候选池）；不承诺任何平台可用性，链接失效不视为缺陷。
**抖音实测（2026-11-18，yt-dlp 2026.10.26）**：分享口令短链（`v.douyin.com/…`）可被 Douyin extractor 解析出视频 id，但取流需 fresh cookies（`Fresh cookies (not necessarily logged in) are needed`）——一期无 cookie 支持，报错经 `VD_DOWNLOAD_FAILED` detail 透出；cookie 能力列入二期候选（C 类）。

## 1. 输入项

| 字段     | 类型                              | 约束                                                                                                                                                                                                                 | 默认值               |
| -------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 视频链接 | string（粘贴/手动输入）           | `http(s)` URL（zod 校验）；支持**整段分享口令直接粘贴**——入参 preprocess 自动提取第一个 URL（剥离反引号/引号/书名号包裹与紧邻中文正文，纯函数 `extractVideoUrl`）；空白 → 禁用 [获取信息]；无 URL → `VD_URL_INVALID` | 空                   |
| 格式预设 | enum `best \| 1080p \| audio-mp3` | 单选；`best` = `bv*+ba/b`（自动合流）、`1080p` = `bv*[height<=1080]+ba/b[height<=1080]`、`audio-mp3` = `ba` + `--extract-audio --audio-format mp3`                                                                   | `best`               |
| 输出目录 | string（目录路径）                | 必须存在且可写（precheck）；默认 `userData/downloads`（壳 paths 派生，首次可改）；选择器不可用时回退手输                                                                                                             | `userData/downloads` |

- 无拖拽需求（纯链接输入）；链接框支持粘贴后自动去首尾空白。

## 2. 页面结构

| 区域      | 内容                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 顶部      | 免责 banner（呈现 #2）                                                                                                                |
| 输入区    | 链接输入框 + [获取信息]（主按钮，触发 probe）+ 预设单选 + 输出目录（[浏览…] 或手输）                                                  |
| 信息卡    | probe 成功后显示：标题、平台、时长、估计体积（可选）+ [加入队列]（主按钮）；probe 失败 → 报错态                                       |
| 队列/历史 | 任务列表（进行中：进度条/速度/ETA + [暂停] [取消]；已完成：文件名/体积/时长 + [打开所在文件夹]）+ 历史记录（最近 100 条，[清空历史]） |
| 空态      | 引导文案（粘贴链接开始）+ 输入框聚焦；无白屏                                                                                          |

- 复用 `ui` 包：`TaskProgress` / `ResultCard` / `ErrorCard`；图标 `@lucide/vue`（`download/pause/play/history/trash-2/folder-open/link` 等，新增进壳 `iconMap`）。

## 3. 按钮集与交互

| 按钮           | 行为                                                                                                                           | 状态约束                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| 获取信息       | `media-convert:download-probe`（sync invoke，超时 20s）                                                                                | 引擎缺失 → `VD_ENGINE_MISSING` 直接报错  |
| 加入队列       | `media-convert:download-start`（task，返回 `{taskId}`）                                                                                | 队列并发 2（壳 `shell.taskConcurrency`） |
| 暂停           | `media-convert:download-mark-pause`（登记暂停意图）→ 通用 `lumin:task:cancel`（AbortSignal 杀进程树）；`.part` 保留，历史标记 `PAUSED` | 仅 running 可见                          |
| 继续下载       | 再次 `media-convert:download-start`（同 url/预设/目录，yt-dlp `--continue` 续传 `.part`）                                              | 仅 `PAUSED` 历史项可见                   |
| 取消           | 通用 cancel（不 mark-pause）；历史标记 `CANCELLED`，删除 `.part`（best-effort）                                                | queued/running 均可                      |
| 打开所在文件夹 | 壳通道 `window.lumin.revealPath`（`lumin:shell:reveal`，工具不自带 reveal 通道）                                               | 仅已完成/已暂停项可见                    |
| 清空历史       | 确认弹窗 → 清空 `tools.media-convert.download.history`                                                                                 | 二次确认                                 |

## 4. IPC 与数据

| 通道                           | 类型 | payload → 返回                                                                                                                      |
| ------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `media-convert:download-probe`         | sync | `{url}` → `{title, platform, durationSec, thumbnailUrl}`；超时 20s 杀树                                                             |
| `media-convert:download-start`         | task | `{url, preset, outputDir?}`（缺省 `userData/downloads`）→ `{taskId}`；progress `{current, total?, message?}`；done → `{outputPath}` |
| `media-convert:download-mark-pause`    | sync | `{taskId}` → `{}`（登记暂停意图，供 abort 后区分 PAUSED/CANCELLED）                                                                 |
| `media-convert:download-history`       | sync | `{}` → `{entries: 历史数组}`（读 settings，坏条目丢弃 + RUNNING→FAILED）                                                            |
| `media-convert:download-history:clear` | sync | `{}` → `{}`                                                                                                                         |

- 打开文件夹复用壳 `lumin:shell:reveal`（不新增工具 reveal 通道）。

- 入参全部 zod 校验；错误结构化（`makeError`/`toolError`）；进度解析为纯函数（可测）。

## 5. 错误码

| 错误码                    | 触发                                                          | 中文文案                                            |
| ------------------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| `VD_URL_INVALID`          | URL 非法/非 http(s)                                           | 链接格式不正确，请检查后重试                        |
| `VD_ENGINE_MISSING`       | `binaries/download/yt-dlp.exe` 缺失或损坏（SHA 预检失败）     | 下载引擎未就绪，请运行 fetch 脚本获取 yt-dlp 后重试 |
| `VD_PROBE_FAILED`         | probe 超时/非零退出/输出不可解析                              | 无法获取视频信息，请确认链接可公开访问              |
| `VD_UNSUPPORTED_PLATFORM` | yt-dlp 报 `Unsupported URL`                                   | 暂不支持该平台链接                                  |
| `VD_OUTPUT_WRITE_FAILED`  | 输出目录不存在/不可写/磁盘满（errno ENOSPC → 磁盘满专项文案） | 输出目录不可写或磁盘空间不足                        |
| `VD_DOWNLOAD_FAILED`      | 下载中非零退出（网络中断等），stderr 尾行入 detail            | 下载失败，请查看详情或稍后重试                      |
| `VD_HISTORY_FAILED`       | 历史读写 settings 失败                                        | 历史记录读写失败                                    |
| `VD_LINK_EXPIRED`         | 快手 token 过期/作品删除/私密/yt-dlp 报 video unavailable     | 链接已失效或内容不可访问，请重新复制分享链接后重试  |
| `VD_LOGIN_REQUIRED`       | 引擎报 sign in to confirm / login required / 需要登录         | 该内容需要登录后访问，请先在 Cookie 管理中配置后重试 |
| `VD_REGION_BLOCKED`       | 引擎报地区限制                                                | 该内容在当前地区不可用                              |
| `VD_FORBIDDEN`            | 引擎报 HTTP Error 403                                         | 平台拒绝访问（403），请稍后重试或更换链接           |
| `VD_CANCELLED`            | 用户取消/暂停（复用 shared `CANCELLED` 语义，工具内细分状态） | 已取消                                              |

## 6. 历史字段（`tools.media-convert.download.history` JSON，滚动 100 条）

`{ id, url, title, platform, preset, outputDir, outputName?, status: RUNNING|PAUSED|DONE|FAILED|CANCELLED, downloadedBytes?, totalBytes?, startedAt, endedAt? }`

- 应用重启后 `RUNNING` 状态项归一为 `FAILED`（进程已随退出终止）；`PAUSED` 保留可续传。

## 7. 引擎保鲜（一期口径，R8）

- 版本随包钉死：`fetch-binaries.mjs` 固定 release URL + SHA256；升级 = 改脚本常量（新版本号 + 新 SHA256）走代码变更
- 设置页「下载引擎」卡片：显示当前 yt-dlp/ffmpeg 版本（spawn `-version`）+ [检查更新]（网络对比远端 latest，仅提示不做运行时下载，守 R7）
- 引擎缺失时工具页报错态引导文案同 `VD_ENGINE_MISSING`

## 8. 验收标准（plan §4.5 同源）

1. B站 + YouTube 真实链接下载成功（best 与 audio-mp3 各一），进度/暂停/续传/队列可用（smoke 人工记录）
2. 免责三重呈现逐项截图入 smoke
3. 三态强制 + tokens + `@lucide/vue`；chunk < 200KB gzip
4. 核心纯函数（进度解析/预设映射/schema/历史归一）≥80%；全仓 ≥60%
5. R2 八类异常逐条真实记录；`pnpm gate` 全绿（audit 维持已知 picomatch 例外）

## 9. Cookie 支持（二期，字段级设计定稿 2026-11-18，R8）

> plan M4 章节二期候选的落地设计。决策：获取 = **粘贴 + 浏览器自动读取**；作用域 = **按平台分别管理**；存储 = **Electron safeStorage 加密**（硬约束，settings 明文 JSON 禁存 cookie）。合规边界不变：仅透传用户自有凭证，**不内置签名逆向/cookie 池/绕过平台技术限制能力**（守免责 ④）。

### 9.1 数据模型与存储

- 存储键：`tools.media-convert.download.cookies.<platform>`，值为 `{ cipher: string, updatedAt: number }`——`cipher` = `safeStorage.encryptString(cookieText)` 的 base64，永不落明文
- `platform` 枚举与域名匹配表（纯函数 `matchPlatformFor(url): platform | null`）：

| platform   | 匹配域名                          | 说明                      |
| ---------- | --------------------------------- | ------------------------- |
| `douyin`   | `douyin.com`（含 `v.douyin.com`） | 登录态可见非公开内容      |
| `bilibili` | `bilibili.com` / `bilibili.tv`    | 大会员高码率画质          |
| `youtube`  | `youtube.com` / `youtu.be`        | 年龄限制/登录可见内容     |
| （null）   | 其余                              | 不注入 cookie，行为同一期 |

- 读写前必查 `safeStorage.isEncryptionAvailable()`：不可用（如 Linux 无 keyring）→ 功能置灰 + 文案说明，**禁止降级明文存储**
- 解析输入（纯函数 `parseCookieText(raw): NetscapeLine[]`）：同时接受三种粘贴形态——① DevTools `Cookie:` 请求头行（`name=value; name2=v2`）② Netscape 文件内容（`#` 注释 + TAB 七段行）③ 裸 `name=value` 换行序列；非法行丢弃，全部非法 → `VD_COOKIE_FORMAT_INVALID`
- cookie 有效域/过期：粘贴形态缺失 domain/expiry 时按当前 platform 的匹配域名 + 会话级处理（Netscape 行固定 `FALSE` path `/`）；有 expiry 的行过期即丢弃并在导入结果中提示条数

### 9.2 IPC 通道（全部 zod 校验，返回值脱敏）

| 通道                                   | 类型 | payload → 返回                                                                                                                              |
| -------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `media-convert:download-cookie:list`           | sync | `{}` → `{ items: [{ platform, cookieCount, updatedAt? }] }`——**不回显任何 cookie 内容**（实现较设计收紧：连前缀摘要也不返回，仅条数与时间） |
| `media-convert:download-cookie:set`            | sync | `{ platform, raw }`（raw ≤ 64KB）→ `{ cookieCount, droppedCount }`；加密后落存储                                                            |
| `media-convert:download-cookie:remove`         | sync | `{ platform }` → `{}`                                                                                                                       |
| `media-convert:download-cookie:import-browser` | task | `{ platform, browser: 'firefox' \| 'chromium-legacy' }` → `{ taskId }`，progress = 扫描/解密/解析三阶段，done → `{ cookieCount }`           |

### 9.3 浏览器自动读取（实现层约定）

| browser           | 路径与做法                                                                                                                                                                                                                                                                                                                 | 支持矩阵                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `firefox`         | 定位 `%APPDATA%/Mozilla/Firefox/Profiles/*/cookies.sqlite` → 复制到 temp（避文件占用）→ `node:sqlite` 只读查询 `moz_cookies` → 转 Netscape                                                                                                                                                                                 | ✅ 支持（未开主密码；多 profile 取默认 release profile） |
| `chromium-legacy` | 定位旧版 Chromium/Edge profile 的 `Cookies` 库 → 同上复制 + `node:sqlite` 取密文 → 主密钥来自 `Local State.os_crypt.encrypted_key`（`DPAPI` 前缀，经 PowerShell `ProtectedData.Unprotect` 解密，**不引原生 npm 依赖**，守 R7），cookie 值本体用 node:crypto **AES-256-GCM** 解密（v10 前缀；v20 = App-Bound 直接报不支持） | ⚠ 版本相关：仅 App-Bound Encryption 上线前的版本         |
| Chrome/Edge 新版  | App-Bound Encryption，离线不可解（v20 密文检测到即抛错）                                                                                                                                                                                                                                                                   | ✘ UI 明示「该浏览器新版已加密，请手动粘贴」              |

- 读取是**只读**操作：不写浏览器库、不装任何扩展；失败 → `VD_COOKIE_IMPORT_FAILED`（detail = 阶段 + 原因）
- `node:sqlite` 可用性：**Node CLI 24 已实测可用**（`DatabaseSync`）；Electron 45 主进程 e2e 兜底（`hasSqlite()` 运行时探测，不可用 → `VD_COOKIE_IMPORT_FAILED`）

### 9.4 下载链路集成

- `probe` / `start` 组参前：`matchPlatformFor(url)` 非 null 且该平台已存 cookie → `safeStorage.decryptString` 解密 → 由 Netscape 行写**临时 cookie 文件**（`ctx.paths.temp/cookie-<taskId>.txt`，任务终态 finally 删除）→ 追加 `--cookies <file>`
- 临时文件权限最小化、进程退出清理；**日志一律不得出现 cookie 值/临时文件内容**（R10 脱敏）
- cookie 过期/失效由引擎报错透出（stderr detail，如「login required」），不新增猜测性错误码

### 9.5 UI（Cookie 管理弹窗，挂在工具页标题行右侧）

- 入口：页内 [Cookie 管理] 按钮（`KeyRound` 图标）；弹窗内平台切换用**按钮组**（抖音/B站/YouTube，实现较设计的 NTabs 简化——按钮组更轻量且 e2e 可稳定定位）
- 每 Tab：脱敏状态行（已存 n 条 · 更新时间）+ 粘贴框（textarea，支持三种形态）+ [保存] / [从浏览器读取]（下拉 firefox / chromium-legacy）+ [删除]（NPopconfirm 二次确认）
- 三态：空态（未配置 → 引导文案「粘贴浏览器 Cookie 后可下载登录可见内容」）；加载态（浏览器读取 task 进度 + 可取消）；报错态（结构化错误 → 中文文案 + 详情）
- 主下载流程 UI 不变——cookie 配置后自动生效，无全局开关

### 9.6 错误码（§5 表追加）

| 错误码                        | 触发                                              | 中文文案                                       |
| ----------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| `VD_COOKIE_FORMAT_INVALID`    | 粘贴内容解析后无有效 cookie 行                    | Cookie 格式无法识别，请粘贴浏览器导出的 Cookie |
| `VD_COOKIE_IMPORT_FAILED`     | 浏览器未安装/profile 不存在/sqlite 读取或解密失败 | 从浏览器读取 Cookie 失败，请改用手动粘贴       |
| `VD_COOKIE_STORE_UNAVAILABLE` | `safeStorage.isEncryptionAvailable()` 为 false    | 系统不支持加密存储，Cookie 功能不可用          |

### 9.7 二期验收标准

1. 粘贴三种形态（Header 行/Netscape/裸键值）解析正确（纯函数单测 ≥80% 覆盖）
2. Firefox 真实 profile 读取 → 抖音登录态真实下载一条登录可见内容成功；B站大会员账号 probe 返回会员画质
3. 存储加密落盘验证（磁盘文件中无明文 cookie）；日志无 cookie 值
4. 临时 cookie 文件任务终态后不存在；R2 八类在 cookie 场景的等价异常（占用/失效/损坏）逐条入 smoke

## 10. 抖音 / 快手直链下载（三期，2026-11-25 R8 登记，plan Q83/M83）

> 背景与选型依据：`docs/research/downloader-optimization.md §7`。不采用 res-downloader 的**系统代理 + 根证书 MITM**，不采用 galaxy-downloader 的**闭源托管 API**；改为解析平台**分享页 SSR HTML** 中的直链（公开页面、移动 UA、无账号登录、无签名、无 cookie 池）。

> **2026-11-25 真机实测修订**：抖音分享页在**无 cookie 时不内联 `videoInfoRes`**（`_ROUTER_DATA` 仅剩 query/commonContext）。经字节 `ttwid` 注册端点取**匿名访客态 cookie**（`aid=1768, region=cn`，不含任何账号信息）后，同一页面即回传 `video.play_addr.url_list`。实现已在解析前自动获取该 cookie；获取失败退回无 cookie 请求并按解析失败归因。

### 10.1 抖音（Douyin）

| 项 | 规则 |
| -- | ---- |
| 链接形态 | `v.douyin.com/<code>`（App 短链，跟随 302）、`www.douyin.com/video/<id>`、`?modal_id=<id>`、`www.iesdouyin.com/share/video/<id>` |
| 分享口令 | 整段 App 复制文案（「2.58 复制打开抖音… \`https://v.douyin.com/xxx/\` …」）由 schema `extractVideoUrl` 提取首个 URL（squema.test.ts 覆盖） |
| ID 提取 | `/(video|share/video)/(\d{6,})` → `modal_id=(\d{6,})` → 302 `finalUrl` / 页面正文 |
| 会话 | `POST https://ttwid.bytedance.com/ttwid/union/register/`（`{region:'cn',aid:1768,service:'www.ixigua.com',union:true}`）→ `Set-Cookie: ttwid=…` → 后续分享页请求带 `Cookie: ttwid=…`；失败不阻断（退回无 cookie 请求） |
| 分享页 | `https://www.iesdouyin.com/share/video/<aweme_id>/`，UA 固定 iPhone Safari |
| 直链 | `_ROUTER_DATA` JSON 的 `video.play_addr.url_list`（花括号平衡提取 + 递归查找）；失败退化正则 `"play_addr":{...}`；`\u002F`/`\/` 反转义、`http` 升 `https` |
| 去水印（用户拍板） | `playwm` → `play`（默认无水印流） |
| 画质 | `ratio` 参数：`best`/`1080p` → `1080p`（实测 119MB / H.264）；`audio-mp3` → `720p`（实测 90MB，音轨一致、省流量）；**不用 `default`**（实测单条 1.08GB 原始母版） |
| 标题 | 作品 `desc`；无则 `<title>` 去 `- 抖音` 后缀 |

### 10.2 快手（Kuaishou）

| 项 | 规则 |
| -- | ---- |
| 链接形态 | `v.kuaishou.com/<code>`（App 分享）、`www.kuaishou.com/short-video/<photoId>`、`www.kuaishou.com/f/<token>` |
| 抓页 | 直接 GET（跟随 302），UA 固定 iPhone Safari + `Accept-Language: zh-CN` |
| 直链 | 页面内全部 `https?://…\.mp4(\?…)`，按 base 去重；`hd15`/`_hd` = 高清、`_b_` = 标清；选择顺序「高清 → 标清 → 其余」 |
| 标题 | `<title>` 去 `- 快手` 后缀；为空回退 `kuaishou` |
| 失效 | 无直链且页面含「作品不存在/已删除/链接已失效」→ `VD_LINK_EXPIRED`；否则 `VD_PROBE_FAILED`（提示可能改版） |

### 10.3 链路与下载

1. `download-probe`：`detectPlatform` 命中 → SSR 解析 → 返回 `{ title, platform: douyin|kuaishou }`（不调用 yt-dlp）；未命中走原 yt-dlp `-J`。
2. `download-start`：命中 → 解析时按预设计算 `ratio` / 清晰度 → 组装 `buildDirectStartArgs`：`-f b`、`--add-header "User-Agent: <iPhone UA>"`、`--add-header "Referer: https://www.douyin.com/|https://www.kuaishou.com/"`、`-o <输出目录>/<安全标题>.<mp4|mp3>`（`uniqueFileName` 大小写不敏感去重，`%` 转义）；`audio-mp3` 追加 `--extract-audio --audio-format mp3`。
3. 进度/暂停（`.part` 续传）/取消/历史/打开文件夹**全部复用既有实现**；平台任务不再读写 cookie。
4. **进度输出前置条件（2026-11-25 实测修复）**：`--print after_move:filepath` 隐含 `--quiet`，会吞掉 `--progress-template` 输出（表现为进度条恒为 0 但最终下载成功）；两条 start 参数路径均显式带 **`--progress`**。模板改为五段 `downloaded | total_bytes | total_bytes_estimate | speed | eta`，解析优先 `total_bytes`（直链首行即有值）、`NA` 时回退 `total_bytes_estimate`（B站分片源）。
5. 解析失败 → 直接写 `FAILED` 历史 + 结构化错误，**不自动重试**（链接失效重试无意义）。

### 10.4 边界与风险

- 抓页超时 15s、正文上限 5MB；实现用全局 `fetch`（Node 24 / Electron 主进程可用），零新增依赖。
- 抖音访客态 `ttwid` 为**匿名会话标识**（非账号 cookie），每次解析现取不缓存、不落盘、不做多账号池；端点失效时解析失败并提示「改用 cookies 导入」。
- 平台改版导致解析失败时回退提示「请升级应用后重试」；解析器集中在 `platforms/` 单文件，便于快速修复。
- 不做：系统代理/MITM/证书、DRM、付费墙、直播录制、签名逆向、cookie 池。

### 10.5 验收标准

1. 单测：抖音长链/短链/modal_id、`playwm→play`、`ratio` 改写/追加、`_ROUTER_DATA` 与正则兜底、`ttwid` 提取/获取失败回退/请求头透传、异常分支；快手三种链接形态、`hd15/_b_` 分桶去重、失效/改版归因；platforms 四文件行/分支/函数覆盖 ≥80%。
2. 真实链路（2026-11-25 已实测至直链层）：短链 `v.douyin.com/1ksnYsT9MCY/` → 302 → `aweme_id=7707583901452419835` → 带 `ttwid` 分享页拿到 `play_addr` → `play` + `ratio=1080p` 返回 `video/mp4`（119,222,946 B，H.264）；yt-dlp 识别为 `mp4` 单格式（`--max-filesize` 守卫下正常中止）。**待用户真机**：完整下载落盘、无水印画面核对、快手短链/长链（无样本链接）。
3. 失败归因：失效链接 → `VD_LINK_EXPIRED`；登录可见内容 → `VD_LOGIN_REQUIRED`；`403` → `VD_FORBIDDEN`。
4. 回归：非目标平台链接行为与三期前完全一致（yt-dlp 分支未改动）。
