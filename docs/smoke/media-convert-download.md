/**

- smoke：媒体工具箱 · 下载页签（M4；M73 由 video-download 整包并入）
- R2 八类异常逐条真实验证记录。「单测覆盖」指真实文件系统/进程层的 Vitest 断言（非 mock 逻辑）；
- UI 层待人工验证项单独标注。全部实测于 2026-11-18 本机（Windows）完成。
  */

# smoke/media-convert-download.md（原 smoke/video-download.md）

- 验证人：cuilanchao
- 日期：2026-11-18
- 分支：`feature/m4-download`
- 引擎：yt-dlp 2026.10.26（SHA256 `f5389d…77a7d`，实测 23,575,744 bytes）+ ffmpeg-static b6.1.1 win32-x64（ffmpeg.exe 82,797,568 bytes / SHA `04e130…4ad00`）。**2026-11-19 体积优化（plan §4.10）**：ffprobe.exe 已从 fetch 脚本与随包资源移除（当年实测 82,668,032 bytes / SHA `3a7e2d…51ba4`），yt-dlp 仅用 ffmpeg 合流不受影响

## 0. R5 chunk / 资产口径记录

| 项           | 体积                                                   | 说明                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工具 chunk   | 并入后随 `media-convert-*.js` 统一计量（原独立包 11.0KB gzip / 40.4KB raw） | M73 合并后下载页签代码并进媒体工具箱 chunk，实测值见 `docs/smoke/media-convert.md` |
| 独占依赖增量 | **0**                                                  | Select/Popover/Popconfirm/Spin/TaskProgress/createLucideIcon 均被壳或其他工具引用（逐 chunk import 关系实测）                                                                                   |
| 引擎资产     | yt-dlp.exe 22.5MB + ffmpeg.exe 79.0MB（合计 ≈101.5MB） | `binaries/download/`，fetch 脚本固定 URL + SHA256 钉死（ffmpeg 为 .gz 下载解压后校验），不入 git、不计入 chunk 口径（AGENTS §8 运行时资产例外）；2026-11-19 移除 ffprobe（-78.8MB，plan §4.10） |

结论：工具 chunk 11.0KB gzip ≪ 200KB 上限（R5 达标）。

## 1. 八类异常映射与实测记录（R2）

> 下载类工具与文件转换类场景不同：无「输入加密文件」概念，按 spec §7 以等价异常替代。

| #   | 类别          | 下载场景等价异常               | 验证方式                                                                                                                        | 实测结果                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 中文/空格路径 | 输出目录含中文与空格           | 真实下载到 `%TEMP%\lumin-smoke\中文 空格路径\`                                                                                  | ✅ 通过：best 预设产物 `【官方 MV】…[BV1GJ411x7h7].mp4` 21,498,125 bytes 落盘，ffprobe 验证 duration 212.3s；`--print after_move:filepath` 路径正常回传（`outputName` 入历史）                                                                                                                                                                                                                                                                                                      |
| 2   | 文件被占用    | 同名成品被独占打开后重下载     | `--no-overwrites` 跳过已存在成品（引擎层）；输出目录为普通文件 → precheck `VD_OUTPUT_WRITE_FAILED`（node.test.ts 真实 fs 用例） | ✅ 通过：重复下载命中 `--no-overwrites` 直接打印 after_move 路径退出（exit 0），无覆盖、无报错；precheck 场景单测覆盖（真实 mkdtemp + writeFileSync）                                                                                                                                                                                                                                                                                                                               |
| 3   | 加密文件      | 平台不支持 / 链接无效          | 真实 probe：抖音短链（假 id 与真实分享口令）与 `example.com` 无效视频链接                                                       | ✅ 通过：假 id → `ERROR: Unsupported URL` → `VD_UNSUPPORTED_PLATFORM`（中文文案）；**真实口令短链** `v.douyin.com/na3SyHkTkJo/` → Douyin extractor 解析出 id 但取流需 cookies（`Fresh cookies are needed`）→ `VD_DOWNLOAD_FAILED` detail 透出（cookie 列二期，spec §8）；无效链接 HTTP 404 → `VD_DOWNLOAD_FAILED`（detail = stderr 尾行），与 spec §7 一致。**整段口令粘贴已支持**：schema preprocess 提取首个 URL（`extractVideoUrl`，单测覆盖反引号包裹/紧邻中文/中文标点等形态） |
| 4   | 超大文件      | 长视频大体积 + 进度流稳定      | 真实限速 300k 下载：`--newline` + `--progress-template` 输出流实测                                                              | ✅ 通过（解析层）：22 条 PROGRESS 行连续输出，`total_bytes_estimate=NA`（B站不回传估算）→ 解析器容错为 null（UI 转不确定进度）；速度/ETA 四段解析与单测一致。真实引擎下进度行**走 stderr**（曾据此修复 node.ts 仅挂 stdout 的缺陷，见 §3）                                                                                                                                                                                                                                          |
| 5   | 任务取消      | 暂停（.part 保留）与取消       | 真实限速下载 8s 后 `taskkill /T /F` 杀树 → 校验 `.part` → 同参 `--continue` 续传                                                | ✅ 通过：`.part` 残留 4,823,868 bytes 保留；续传后无 `.part`、产物完整 mp4、after_move 回传。PAUSED/CANCELLED 意图区分由主进程 mark-pause 登记（node.test.ts 两用例）                                                                                                                                                                                                                                                                                                               |
| 6   | 并发溢出      | 队列并发 2 + maxPending 100    | 壳任务队列单测 9 例（真实并发语义：并发上限/溢出 QUEUE_FULL/取消）                                                              | ✅ 通过（队列层）：下载任务经 `registerTask` 入同一队列，溢出/并发行为与 example/docx2pdf 同机制（shell.md 已真实记录）                                                                                                                                                                                                                                                                                                                                                             |
| 7   | 磁盘满        | 输出目录不可写 / ENOSPC        | 输出目录 precheck（真实 fs 写探测）单测覆盖；ENOSPC 时引擎写 `.part` 失败非零退出 → `VD_DOWNLOAD_FAILED`（detail 透出 stderr）  | ✅ 通过（precheck 层）：目录为普通文件 → `VD_OUTPUT_WRITE_FAILED`（真实 fs 用例）。VHD ENOSPC 实测与 docx2pdf 里程碑同机制（writeOutput/写文件失败路径共用 shared 结构化错误链路），本工具 ENOSPC 由引擎 stderr detail 透出                                                                                                                                                                                                                                                         |
| 8   | 断电恢复      | 应用重启后 RUNNING 归一 FAILED | normalizeHistory 单测（RUNNING→FAILED、坏条目丢弃、100 条滚动）+ 写盘时机：提交即写 RUNNING、终态覆盖                           | ✅ 通过（持久化层）：真实引擎杀进程场景见 #5（进程树级断电等价，`.part` 与历史均落盘）；壳重启后 normalizeHistory 归一。UI 层重启到页面刷新历史的展示待人工复核                                                                                                                                                                                                                                                                                                                     |

## 2. 假引擎 e2e（不依赖外网）

- [x] 免责弹窗 → 同意解锁主功能区 + 持久化（不再弹窗）
- [x] probe 信息卡（标题/平台）→ 下载 → 进度 → 历史 DONE + `outputName` + 打开文件夹入口
- [x] probe 报错态：结构化错误中文文案 + 详情展开 + 重试按钮
- [x] 清空历史（二次确认 → 空态引导）
- 4/4 通过（2026-11-18，`apps/desktop/e2e/media-toolbox-download.spec.ts`，csc 编译真实 PE 假引擎；M73 改名并改为「进入媒体工具箱 → 切下载页签」）

## 3. 真实引擎人工验证（2026-11-18，B站）- [x] B站 probe：`-J` 返回标题/时长 212.4s/15 formats（BiliBili extractor）

- [x] best 预设下载：bv+ba 经 ffmpeg 合流，中文空格目录产物 21.5MB、212.3s 完整
- [x] 1080p 预设下载：`bv*[height<=1080]+ba/b[height<=1080]` 产物完整
- [x] audio-mp3 预设：`-f ba -x --audio-format mp3` 转码产物 ffprobe 验证 format_name=mp3、duration 212.35s（`--ffmpeg-location` 指向 `binaries/download/` 生效；ffprobe 已于 2026-11-19 移除，后续复验改用 `ffmpeg -i`）
- [x] 暂停 → 续传：限速杀树 `.part` 保留 → `--continue` 断点接续 → 完整产物（见 §1 #5）
- [x] 抖音试探：假 id 短链 `VD_UNSUPPORTED_PLATFORM`；真实分享口令短链解析出 id 但取流需 cookies（`Fresh cookies are needed`，cookie 支持列二期）——分享口令整段粘贴已支持（schema preprocess 提取 URL，单测 56/56）
- [ ] YouTube：本网络不可达（`Connection to www.youtube.com timed out`，connect timeout 12s 重试 3 次失败）。yt-dlp 内置 youtube extractor，网络可达环境可直接验证，不阻塞本里程碑

### 3.1 实测发现的缺陷与修复

1. **进度行走 stderr**：真实引擎 `--progress-template download:` 输出走 stderr，`--print after_move:filepath` 走 stdout；`node.ts` 原仅挂 `onStdoutLine` 导致进度事件收不到。已修复为两端同挂 `handleLine`（重复解析无害），`lastProgressBytes` 改为 stderr 优先双流尾搜，并补 stderr 进度单测（46/46）。
2. **`NA` 段容错**：B站 `total_bytes_estimate=NA`，解析器已容错为 null（单测既有覆盖），UI 以不确定进度呈现。
3. PowerShell 5 重定向会吞 stderr 行并加 BOM——真实验证一律经 `node` 读文件解析，勿依赖 `2>&1` 直显。

## 4. 二期 Cookie 支持（2026-11-19，feature/m5-cookie）

### 4.1 自动化验证

- [x] 单测 647/647 全仓（video-download 增至 107：`cookies.test.ts` 13 例纯函数 + `browser-cookies.test.ts` 15 例（假库建表 node:sqlite / 假 DPAPI + AES-GCM 真实加解密 / v20-v9 拒绝分支 / 默认 finder 容忍）+ `node.test.ts` 14 例 cookie 通道——加密落盘密文≠明文、`VD_COOKIE_FORMAT_INVALID`、`VD_COOKIE_STORE_UNAVAILABLE`、list 脱敏（断言响应不含任何 cookie 值）、remove、import-browser 三段 progress 与错误包装/透传、probe/start `--cookies` 透传与终态删除 + `client.test.ts` 4 例 bridge 通道 + `errors.test.ts` 5 例错误码）
- [x] coverage 门禁全绿（全仓 statements 93.25% / branches 84.39% / functions 91.4% / lines 95.86%，媒体工具箱（含下载/播放子模块）分组与 plugin-host 分组均 ≥80%）
- [x] e2e 5/5（假引擎，新增「Cookie 管理：粘贴保存 → 平台独立 → 删除」用例：safeStorage 真实加解密往返、平台间隔离、二次确认删除、非法输入报错态）
- [x] `node:sqlite` 可用性：Node 24 CLI 实测 OK；e2e 运行于 Electron 45 主进程未触发缺失路径
- [x] `pnpm typecheck` / `pnpm lint` 全绿

### 4.2 八类异常在 Cookie 场景的映射（机制层，与 §1 对应）

| 场景              | Cookie 场景等价物              | 保障机制                                                       | 记录                                        |
| ----------------- | ------------------------------ | -------------------------------------------------------------- | ------------------------------------------- |
| 文件被占用        | 浏览器 cookies.sqlite 被锁     | 先 `copyFileSync` 快照到 temp 再只读查询                       | 单测覆盖快照逻辑；真实 Firefox 库验证见 4.3 |
| 加密文件          | 新版 Chrome v20 App-Bound 密文 | 前缀检测 → 抛错 → `VD_COOKIE_IMPORT_FAILED`                    | 单测覆盖 v10/v20 分支                       |
| 磁盘满            | 临时 cookie 文件写失败         | `resolveCookieFile` mkdir/write 包 `VD_OUTPUT_WRITE_FAILED`    | 单测覆盖                                    |
| 任务取消/断电恢复 | import-browser 长任务取消      | 通用 task cancel（AbortSignal），无半写状态（settings 原子写） | 机制同 §1 #5/#8                             |
| 中文/空格路径     | temp 目录含中文用户名          | `join(ctx.paths.temp)` 全程 path API，无手工拼接               | e2e 真实 userData 验证                      |
| 超大文件          | cookie raw ≤ 64KB 上限         | `cookieSetPayloadSchema.max(64*1024)`                          | 单测覆盖                                    |
| 并发溢出          | 多平台同时 import              | 壳 task-queue 并发上限统一管控                                 | 机制同 §1 #6                                |
| 日志脱敏（R10）   | cookie 值                      | 日志仅记 platform/browser/cookieCount；list 响应不含内容       | node.ts `ctx.log.info` 断言                 |

### 4.3 待真实环境人工验证（用户自备账号）

- [x] Firefox 真实 profile 导入抖音 cookie → **2026-11-19 用户实测：Cookie 配置后抖音非公开视频仍无法下载**。初步判断：抖音取流除 cookies 外还需请求签名（a_bogus/verify_fp 等动态参数），yt-dlp 内置 Douyin extractor 不自动生成；按守免责文案 ④（不内置签名逆向），此项记录为**已知限制**，后续评估方向 = 用户手动导出含签名的完整请求或依赖 yt-dlp 上游更新。工具本体链路（存储/注入/透传）功能保留
- [ ] B站大会员 cookie → probe 返回会员高码率画质
- [ ] 旧版 Chromium/Edge（v10）DPAPI+AES-GCM 解密成功（新版 Chrome 预期报「App-Bound」）
- [ ] cookie 过期后引擎报错 detail 透出（如「login required」）

### 4.4 R5 chunk 复测（M5 后）

- video-download renderer chunk（M5 后历史值）：52,518 raw / **13.4KB gzip**（M4 时 11.0KB，+2.4KB 为 `CookieDialog.vue` 工具代码）；**M73 并入媒体工具箱后随 `media-convert` chunk 统一计量**；独占依赖增量维持 0；cookie 主进程逻辑（cookies/browser-cookies/node 通道）不入 renderer chunk，无新增运行时资产

### 4.5 M73 并回归档（2026-11-25）

- 通道改为 `media-convert:download-*`（`probe` / `start` / `mark-pause` / `history` / `history:clear` / `cookie:list` / `cookie:set` / `cookie:remove` / `cookie:import-browser`）；错误码 `VD_*` 不变。
- 设置键迁至 `tools.media-convert.download.*`（`history` / `disclaimerAccepted` / `cookies.<platform>`），旧键不迁移；打开工具箱默认停留在「格式转换」，**切到「下载」页签才实例化并触发免责弹窗**。
- e2e 改名 `media-toolbox-download.spec.ts`（5/5 通过，2026-11-25 复跑），命令 `pnpm --filter @lumin/desktop test:e2e -- media-toolbox-download`；合并后工具 chunk 实测 107,332 B raw / 25,640 B gzip（见 `docs/smoke/media-convert.md` §4）。

## 5. 三期 抖音 / 快手直链（2026-11-25，M83）

> spec 字段级规则见 `docs/spec/media-convert-download.md` §10；决策见 plan Q83 / §4.83 / M83。

### 5.1 链路（与二期的差别）

- 二期：链接一律交 yt-dlp 自身 extractor 解析（抖音需签名、快手无内置 extractor，实测失败）。
- 三期：主进程先用全局 `fetch` 拉分享页 HTML（iPhone UA、15s 超时、5MB 上限、follow 重定向）→ 平台模块解析出**真实播放直链**；命中平台则跳过 `cookieFile` 解析，直链交 yt-dlp 下载（`-f b --add-header UA/Referer -o <定名路径> --no-overwrites --continue`），进度 / 暂停续传 / 历史 / 取消全复用既有链路。
- **抖音会话（真机实测后补）**：分享页无 cookie 时 `_ROUTER_DATA` 不带 `videoInfoRes`；解析前先 `POST https://ttwid.bytedance.com/ttwid/union/register/` 取匿名访客态 `ttwid`，后续请求带 `Cookie: ttwid=…` 即回传 `play_addr`（不涉及账号登录）。
- 抖音去水印：直链 `playwm` 段改写为 `play`；画质 `ratio`：best/1080p → `1080p`，audio-mp3 → `720p`（`default` 实测单条 1.08GB，弃用）。
- 快手：页面内 `.mp4` 直链按 `hd15`/`_hd` → 标清 → 其余 优先级挑选，token 有 TTL 故解析后立即下载。

### 5.2 自动化验证

- [x] 单测：`pnpm exec vitest run packages/tools/media-convert/src/download` → **10 文件 / 151 用例全通过**（platforms 3 文件 35 例、直链 node 用例 6 例、`ttwid` 提取/获取/回退/请求头透传 4 例、归因 5 例）
- [x] 覆盖率（`coverage-summary.json` 实测）：`platforms` 聚合 statements 92.59% / branches 82.55% / functions 100% / lines 97.74%；全量 `pnpm coverage` 门禁绿（全仓 statements 94.51% / branches 87.63% / functions 92.58% / lines 96.05%，3536 例）
- [x] `pnpm --filter @lumin/tool-media-convert typecheck`、`pnpm exec eslint packages/tools/media-convert/src/download`、`pnpm gate`、`pnpm build` 全绿
- [x] 关键断言：probe 命中抖音/快手时**不调用 yt-dlp**；抖音 start 参数含 `play`（非 `playwm`）、`ratio`、定名 `-o`、`--add-header` ×2；`ttwid` 取到后分享页请求带 `Cookie` 头；快手 start 取 hd 直链、`audio-mp3` 预设额外带 `--extract-audio --audio-format mp3`；解析失败先写 FAILED 历史再抛结构化错误

### 5.2.1 真实网络实测（2026-11-25，本机）

样本：用户提供的整段分享口令（`2.58 复制打开抖音… \`https://v.douyin.com/1ksnYsT9MCY/\` :5pm PKJ:/ d@n.da 03/01`）

| 步骤 | 结果 |
| ---- | ---- |
| 口令 → URL 提取 | `extractVideoUrl` 剥离反引号与尾部随机码 → `https://v.douyin.com/1ksnYsT9MCY/`（schema.test.ts 用例覆盖，含本样本同形态） |
| 短链 302 | `200`，落地 `www.iesdouyin.com/share/video/7707583901452419835/?…&from_ssr=1…` |
| 无 cookie 分享页 | `_ROUTER_DATA` 存在但**无** `videoInfoRes` / `play_addr`（旧方案直接失效） |
| ttwid 注册 | `POST ttwid.bytedance.com/…/register/` → `200` + `ttwid`（127 字节） |
| 带 ttwid 分享页 | `videoInfoRes` ✓ `play_addr` ✓ → `https://aweme.snssdk.com/aweme/v1/playwm/?line=0&logo_name=aweme_diversion_search&ratio=720p&video_id=v2700fgi0000dbrdaafog65op6rhnj80` |
| 去水印 + 1080p | `play/?…&ratio=1080p` → `video/mp4`，`Content-Length: 119,222,946` |
| 去水印 + 720p | `play/?…&ratio=720p` → `video/mp4`，`Content-Length: 90,173,027` |
| `ratio=default` | `video/mp4`，`Content-Range: 0-2048/1,081,499,697`（1.08GB，判定为原始母版，已弃用该档） |
| yt-dlp 直链 | `[redirect] → douyinvod.com…` → `Downloading 1 format(s): mp4`，`--max-filesize 2M` 守卫下按 119MB 正常中止 |
| 反向验证 | yt-dlp 直接吃 `www.douyin.com/video/<id>` → `Fresh cookies (not necessarily logged in) are needed`（证实必须走直链方案） |

### 5.2.2 实测发现的缺陷与修复（2026-11-25，用户反馈）

| 现象 | 根因 | 修复 | 证据 |
| ---- | ---- | ---- | ---- |
| 进度条恒为 0、无速度/ETA，但最终下载成功 | `--print after_move:filepath` **隐含 `--quiet`**，`--progress-template` 输出被吞（本机对照实验：仅 template → 0 行；`--print` → 0 行；`--print` + `--progress` → 34 行） | start 两条参数路径统一追加 **`--progress`** | `progress.test.ts` 断言 `--progress` 存在；真实引擎 6s 采样 34 条 PROGRESS 行 |
| 百分比无法计算（total 缺失） | 模板只取 `total_bytes_estimate`，直链源该字段为 `NA`（`total_bytes` 首行即有值）；B站分片源相反 | 模板扩为五段，解析优先 `total_bytes`、回退 `total_bytes_estimate` | 实测首行 `PROGRESS\|1024\|119222946\|NA\|NA\|NA`、末行 `…117439488\|119222946\|NA\|5553160\|0` |

> 该缺陷对**所有**预设生效（含二期 B站路径），修复后 e2e 假引擎进度行同步改为五段格式。
>
> **UI 层验证（2026-11-25）**：假引擎每步加 500ms 停顿后，`media-toolbox-download.spec.ts` 新增断言 `512 B/s · 剩余 0:10 · 25%` 可见，**5/5 通过**（`pnpm --filter @lumin/desktop exec playwright test e2e/media-toolbox-download.spec.ts`）——确认进度条百分比、速度、ETA 均在页面上真实渲染。

### 5.3 R2 八类异常在直链场景的映射

| #   | 类别          | 直链场景等价异常                             | 保障机制                                                                                     | 实测结果                                                                     |
| --- | ------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | 中文/空格路径 | 分享页标题含中文/表情/斜杠                   | `safeFileTitle()` 去非法字符 + `uniqueFileName` 大小写不敏感去重，全程 path API              | 单测覆盖（`allocateDirectOutput` + `common.test.ts`）                        |
| 2   | 文件被占用    | 同名成品已存在 / 被独占                       | `--no-overwrites` + `--continue`（引擎层），输出名由 `allocateDirectOutput` 预分配           | 单测覆盖命名去重；引擎行为同 §1 #2                                           |
| 3   | 加密文件      | 分享页被风控 / 需登录 / 地区限制              | `classifyEngineError`：login required → `VD_LOGIN_REQUIRED`、地区 → `VD_REGION_BLOCKED`、403 → `VD_FORBIDDEN`、作品不存在/已删除 → `VD_LINK_EXPIRED` | 单测覆盖 5 条归因分支                                                        |
| 4   | 超大文件      | 分享页 HTML 异常巨大                         | `MAX_PAGE_BYTES = 5MB` 上限 + `PAGE_TIMEOUT_MS = 15s` AbortController                        | 单测覆盖截断与超时分支                                                       |
| 5   | 任务取消      | 解析阶段取消                                 | 解析在主进程 handler 内同步完成（远小于超时），下载阶段取消同二期 AbortSignal                 | 机制同 §1 #5                                                                 |
| 6   | 并发溢出      | 多链接同时解析                               | 壳 task-queue 并发上限统一管控（`shell.taskConcurrency`）                                     | 机制同 §1 #6                                                                 |
| 7   | 磁盘满        | 输出目录不可写 / 分配产物名失败               | `allocateDirectOutput` 失败 → `VD_OUTPUT_WRITE_FAILED`                                        | 单测覆盖                                                                     |
| 8   | 断电恢复      | 解析中进程被杀 / 下载中断                     | 提交即写 RUNNING 历史、解析失败写 FAILED；`.part` 残留可续传                                  | 机制同 §1 #8                                                                 |

### 5.4 待真机验证清单（需外网 + 真实分享链接）

- [x] 抖音短链 `https://v.douyin.com/xxxxxxx/` → probe 出标题/平台（解析层实测，见 §5.2.1）
- [x] 抖音整段分享口令（含反引号与随机码）→ URL 提取正确
- [x] 去水印直链可达（`play` 端点返回 `video/mp4`）；画面无水印待下载完整文件后肉眼核对
- [x] 「1080p」预设 URL 含 `ratio=1080p`、「音频 MP3」含 `ratio=720p`
- [ ] 完整下载落盘（走应用内 yt-dlp，产物可播放）
- [ ] 抖音长链 `https://www.douyin.com/video/<aweme_id>`、`?modal_id=<aweme_id>` 在应用内 probe + 下载
- [ ] 「音频 MP3」预设产物确为 `.mp3` 且时长与源一致
- [ ] 快手短链 `https://v.kuaishou.com/xxxxx` 与长链（`short-video` / `photo`）——**缺真实样本链接，尚未验证**
- [ ] 失效链接（已删除作品）→ `VD_LINK_EXPIRED` 中文文案
- [ ] 分享页被风控 → `VD_LOGIN_REQUIRED` / `VD_FORBIDDEN` detail 透出且可重试语义正确

> 说明：直链层已用本机网络实测通过（含 ttwid 会话、去水印、1080p/720p、yt-dlp 识别 mp4）；剩余项需在应用内跑完整链路（下载落盘 + 播放核对），快手因无样本链接整体待验证。

### 5.5 R5 / R7 记录

- **零新增依赖 / 零新增二进制**：页面拉取改用 Electron 主进程全局 `fetch`（Node 18+ / Electron 45 内置），未引 axios/got；下载仍走既有 `yt-dlp.exe`。
- 新增代码仅主进程 `src/download/platforms/*`（不入 renderer chunk），renderer 代码未改动 → 工具 chunk 增量 **0**；`pnpm audit:high` 无新增风险面。
