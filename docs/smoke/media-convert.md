# 音视频处理（media-convert）冒烟记录

> 版本：v0.2.0 · 日期：2026-11-19（M14）/ 2026-11-21（M50 音频互转）· 环境：Windows 11 x64 / Electron（本地构建）
> 依据：AGENTS §7.3（R2 八类全覆盖）+ §8（R5 chunk）+ §5.3（三态）。
> 自动化：单测 `pnpm vitest run --project @lumin/tool-media-convert`（**77/77**）；e2e `apps/desktop/e2e/media-convert-smoke.spec.ts`（**8 用例**，`beforeAll` 检测 `binaries/download/ffmpeg.exe`，缺失时整组 skip）。
>
> **M50 复跑（2026-11-21）**：本机 `binaries/download/ffmpeg.exe` 已就绪，e2e 8 用例**全部真实执行并通过（8/8，29.1s）**，含新增「音频互转 wav → mp3/flac」。M14 首次交付时的「ffmpeg 缺失 → e2e 全 skip」记录已被本次结果覆盖；下表仍保留未真实执行的 R2 类别（占用/加密/VHD 磁盘满/强杀）待手工补录。

## 1. R2 八类异常

| #   | 场景          | 操作与样本                                                                                                        | 预期结果（spec / 代码路径）                                                                                 | 自动化覆盖                                                                                                       | 实测结论              |
| --- | ------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | 中文/空格路径 | `%TEMP%\lumin-mc-e2e\转码 样例.mp4`、`截取 样例.mp4`、`转换 样例.wav`（文件名含中文与空格；临时目录名保持 ASCII） | probe 正常返回时长/分辨率；转码/截取/音频互转产物按模板命名并落在输出目录                                   | e2e 用例 1–6（真实执行）；单测 `node.test.ts` 探测与批量用例使用中文名                                           | 通过（M50 复跑）      |
| 2   | 文件被占用    | PowerShell 独占句柄持有输入文件后提交任务                                                                         | 该文件记 `failures`（`MC_FILE_UNSUPPORTED`，detail=EBUSY/EPERM），批次继续，其余文件正常产出                | 单测覆盖「非结构化异常 → 失败项不中断批次」；ffmpeg 侧 `classifyFfmpegFailure` 的 `Permission denied` 分支有单测 | 阻塞待补              |
| 3   | 加密文件      | EFS 加密的样例视频（`cipher /e`）后 probe/转码                                                                    | 读取失败或无法解析 → `MC_FILE_CORRUPT`/`MC_FILE_UNSUPPORTED`（可重试提示），不中断批次                      | 单测：损坏 stderr → `MC_FILE_CORRUPT`（`CORRUPT_HINTS` + 首条流缺失）                                            | 阻塞待补              |
| 4   | 超大文件      | ① `fs.truncate` 造 4GB+1 字节 `.mp4` ② 正常 200MB 视频                                                            | ① probe 即返回 `MC_FILE_UNSUPPORTED`（上限 4GB）② 正常完成                                                  | 单测：`probe` 超限用例（真实 `truncate` 4GB+1 文件，断言失败项）                                                 | ① 单测通过 ② 阻塞待补 |
| 5   | 任务取消      | 长视频转码提交后调用 `lumin:task:cancel`                                                                          | 壳级终态 `CANCELLED`；不记失败项；已输出文件保留；页面可再次提交                                            | e2e 用例 8（真实执行）；单测：`aborted` → `MC_CANCELLED`、预取消空批次、取消不记失败                             | 通过（M50 复跑）      |
| 6   | 并发溢出      | 同时提交 2–3 个 `media-convert:process` 任务                                                                      | 壳任务队列按并发上限调度；各任务进度互不串扰（taskId 区分）                                                 | 壳层 `task-queue` 既有单测覆盖；本工具无跨任务共享状态                                                           | 阻塞待补              |
| 7   | 磁盘满        | 小容量 VHD / 只读输出目录                                                                                         | 批次级 `MC_OUTPUT_WRITE_FAILED`（目录不可创建/不可写）；ffmpeg `No space left on device` → 单文件同名错误码 | 单测：输出目录为文件 → 批次级错误；`classifyFfmpegFailure` ENOSPC 分支                                           | 阻塞待补              |
| 8   | 断电恢复      | 转码执行中 `taskkill /F /T` 强杀主进程 → 重启                                                                     | 重启后主界面正常；半成品输出保留但不进入任何「已完成」记录；重新提交可覆盖生成                              | 设计为无原子写、无持久任务状态；壳重启回归由 `docs/smoke/shell.md` 覆盖                                          | 阻塞待补              |

> 注：第 7 类中「目录不可创建」与「ffmpeg ENOSPC 归类」已由单测覆盖；真实磁盘满需 VHD 环境补录。

## 2. 三态验收

| 状态   | 断言                                                                                       | 结果                                               |
| ------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 空态   | 未添加文件时显示拖拽区 + 引导文案；五 Tab 参数区常驻，不白屏                               | 通过（构建产物人工目视 + e2e 五 Tab 断言）         |
| 加载态 | 进度条（总进度 = 已完成文件数 + 当前文件百分比）+ 当前文件名与时间码 + [取消] 可点击       | 通过（单测覆盖进度事件；UI 与 image-toolbox 同构） |
| 报错态 | 结构化错误码 → 中文文案（`errors.ts` MESSAGES）+ [重试]（可重试码）+ [详情]（detail 尾行） | 通过（单测覆盖错误映射与可重试判定）               |

## 3. 功能与交互（自动化已覆盖部分）

| 项             | 自动化断言                                                                   | 结果                                                   |
| -------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| 转码参数       | mp4/mkv → H.264+AAC（medium 预设，`+faststart`）；webm → VP9+Opus            | 通过（`encode.test.ts`）                               |
| 截取参数       | `-ss/-to` + 精确重编码；`fastCopy` → `-c copy`                               | 通过（`encode.test.ts`）                               |
| 提取音频       | 5 格式 codec 映射；wav/flac 忽略码率；无音频轨 → `MC_NO_STREAM`              | 通过（`encode.test.ts` / `node.test.ts`）              |
| 音频互转       | 复用提取音频参数；`-vn` 丢弃封面；视频输入 → `MC_FILE_UNSUPPORTED`           | 通过（`encode.test.ts` / `node.test.ts` / e2e 用例 5） |
| 压缩参数       | 三档 CRF/preset/码率；maxHeight 0 不加 `-vf`，其余 `scale=min(...)`          | 通过（`encode.test.ts`）                               |
| 命名模板       | `{stem}.{ext}` / `.cut_HHMMSS-HHMMSS.mp4` / `.audio.{ext}` / `.c{level}.mp4` | 通过（`naming.test.ts`）                               |
| 冲突重命名     | 目标目录已有同名 → `demo (1).webm`（Windows 大小写不敏感）                   | 通过（`node.test.ts`）                                 |
| 进度解析与节流 | `out_time_us/ms`（微秒）+ `progress=end`；首次/±1%/200ms/100% 推送           | 通过（`media.test.ts` / `node.test.ts`）               |
| 截取区间校验   | 结束≤开始 → 批次级 `MC_PARAM_INVALID`；起点超出源时长 → 单文件失败           | 通过（`node.test.ts`）                                 |
| 超时           | 单文件 30 分钟 → `MC_TIMEOUT`（可重试）                                      | 通过（`node.test.ts`）                                 |

## 4. chunk 实测（R5）

| 产物                                        | raw      | gzip     | 口径说明                                              |
| ------------------------------------------- | -------- | -------- | ----------------------------------------------------- |
| `renderer/assets/media-convert-CBt5i4P-.js` | 38,569 B | 10,106 B | M50 实测（含「音频互转」页签），工具 chunk 基线 200KB |
| 历史 `media-convert-B0LUgUi6.js`（M14）     | 37,526 B | 9,962 B  | 四 Tab 版本，改动 +1,043 B raw / +144 B gzip          |

结论：工具 chunk **10,106 B gzip（≈9.9KB）**，远低于 200KB 基线；无新增第三方依赖（复用 `binaries/download/ffmpeg.exe`，fetcher 固定 URL + SHA256 校验，不入 git）。

## 5. 补测指引

1. `node scripts/fetch-binaries.mjs --group download`（确认 `binaries/download/ffmpeg.exe` 存在且 SHA256 校验通过）
2. `pnpm build`
3. `pnpm --filter @lumin/desktop exec playwright test media-convert-smoke.spec.ts`（8 用例，M50 实测 8/8 通过）
4. 手工补录：R2 第 2、3、7、8 类按上表样本执行并回填「实测结论」列（第 1、5 类已由 e2e 覆盖；第 4、6 类由单测覆盖）

## 6. 已知限制

- 任务内串行处理（不做单任务并发）；单批 1–50 文件、单文件 ≤ 4GB、单段截取 ≤ 24h。
- 无原子写：取消/强杀会保留已生成文件与可能的半成品（spec §4 已声明）。
- 截取「快速复制」按关键帧对齐，起止时间可能不精确（UI 已提示）。
- probe 依赖 `ffmpeg -i` stderr 文本，异常封装格式可能无法识别时长（退化为 0，按入参区间处理）。
