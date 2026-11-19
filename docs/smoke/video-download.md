/**

- smoke：video-download（M4）
- R2 八类异常逐条真实验证记录。「单测覆盖」指真实文件系统/进程层的 Vitest 断言（非 mock 逻辑）；
- UI 层待人工验证项单独标注。全部实测于 2026-11-18 本机（Windows）完成。
  */

# smoke/video-download.md

- 验证人：cuilanchao
- 日期：2026-11-18
- 分支：`feature/m4-download`
- 引擎：yt-dlp 2026.10.26（SHA256 `f5389d…77a7d`，实测 23,575,744 bytes）+ ffmpeg-static b6.1.1 win32-x64（ffmpeg.exe 82,797,568 bytes / SHA `04e130…4ad00`）。**2026-11-19 体积优化（plan §4.10）**：ffprobe.exe 已从 fetch 脚本与随包资源移除（当年实测 82,668,032 bytes / SHA `3a7e2d…51ba4`），yt-dlp 仅用 ffmpeg 合流不受影响

## 0. R5 chunk / 资产口径记录

| 项           | 体积                                                   | 说明                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工具 chunk   | 11.0KB gzip（40.4KB raw）                              | `video-download-*.js`，实测 electron-vite build 产物                                                                                                                                            |
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
- 4/4 通过（2026-11-18，`apps/desktop/e2e/video-download.spec.ts`，csc 编译真实 PE 假引擎）

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
- [x] coverage 门禁全绿（全仓 statements 93.25% / branches 84.39% / functions 91.4% / lines 95.86%，video-download 分组与 plugin-host 分组均 ≥80%）
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

- video-download renderer chunk：52,518 raw / **13.4KB gzip**（M4 时 11.0KB，+2.4KB 为 `CookieDialog.vue` 工具代码，远低于 200KB 上限）；独占依赖增量维持 0；cookie 主进程逻辑（cookies/browser-cookies/node 通道）不入 renderer chunk，无新增运行时资产
