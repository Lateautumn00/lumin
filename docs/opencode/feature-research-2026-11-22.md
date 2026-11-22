# Lumin 新功能调研报告 — 功能缺口盘点与竞品对标

> **状态：调研建议稿，未生效。** 任何条目在拍板并回写 `docs/opencode/plan.md` §1 决策总表（R8）前均不构成需求；口头无效。
> 依据：`plan.md` v1.1（Q1–Q55 / M0–M54）、`AGENTS.md`、`docs/spec/*.md`（57 份字段级清单）、`docs/smoke/*.md`（34 份）、`CHANGELOG.md`、竞品官方产品页（见附录 C）。
> 编制：2026-11-22（当前 M54 已交付、v0.9.0 已发布）。替代已过期的 `docs/opencode/future-roadmap.md`（2026-11-16 草案）。
> 覆盖范围（用户确认口径）：① 现有工具扩展 + ② 全仓功能缺口盘点（新工具 + 壳层平台），含联网竞品对标。

---

## 1. 现状基线：32 工具 × 7 分组能力矩阵

交付状态：32 个正式工具全部有 `docs/smoke/` 记录（除 `example` 模板外全交付）；`batch-ocr` 已于 M49 并入 `ocr-text`（包已删，目录残留见 §5.4）。

### 1.1 计算与转换（compute，4）

| toolId | 能力 |
| --- | --- |
| calculator | 「计算/进制」双页签：表达式 + 基础/科学档 + 键盘映射 + DEG/RAD + 历史 100 条；进制页 2/8/10/16 互转（BigInt）；**仅整数进制**（`BASE_NOT_INTEGER`） |
| unit-converter | 17 类单位互转 + 互换 + 收藏置顶；**无汇率**（Q13 锁定） |
| life-calculator | 房贷（等额本息/本金 + 还款计划）/ 个税（五险一金 + 专项附加）/ 百分比折扣 |
| time-toolbox | 时间戳互转/时区（内置 8 + 自定义 IANA）/时长/Cron 解析（未来 5 次触发）/日期差；倒计时已归口 misc-toolbox（M48） |

### 1.2 文本与编码（text，2）

| toolId | 能力 |
| --- | --- |
| text-toolbox | 7 页签：JSON（格式化/压缩/校验含行列定位）/ 编解码（Base64·URL·Hex·Unicode）/ 正则（匹配 + 替换预览）/ 文本处理（替换·去重·排序·9 项统计）/ 摩尔斯 / CSV↔JSON / 拼音（4 模式，M54） |
| text-diff | 并排/统一双视图 + 忽略空白/大小写 + 字符级高亮 + 统一 diff 复制；**仅行级** |

### 1.3 图片处理（image，8）

| toolId | 能力 |
| --- | --- |
| image-toolbox | 5 页签：压缩 / 转换（6 格式）/ 缩放（4 模式 + 不放大）/ 调整（**仅灰度·反色·黑白二值**，M40）/ GIF 合成；输出目录记忆、进度可取消 |
| image-rotate | 批量旋转（90/180/270）+ 翻转组合；**无预览图** |
| image-crop | 比例裁剪（九宫格锚点）/ 自由区域双模式；**无交互式框选预览** |
| image-stitch | 拼接（纵/横/网格）+ 长图分割（M40）；**无拖拽排序** |
| image-watermark | 文字/图片水印（九宫格/平铺/旋转）+ 实时预览；**单水印、无模板库** |
| qr-code | 生成（文本/网址/WiFi/vCard + PNG/SVG）/ 识别（单张）；**无批量、无摄像头、无 Logo** |
| ocr-text | 单张/批量（≤50）双模式 + 可编辑 + 导出 TXT + 重试（M49 合并）；**不做 PDF 识别与多语言** |
| color-toolbox | HEX/RGB/HSL 互转 + 整屏吸管 + 色阶 + 配色 + WCAG 对比度 + 图片调色板（M46） |

### 1.4 文档与 PDF（document，5）

| toolId | 能力 |
| --- | --- |
| pdf-toolkit | 11 页签：合并/拆分/删页/旋转/重排/元数据/水印/页码/文本提取/图片提取/压缩（M38）；**不做加密解密、内容编辑、表单、签名、OCR 文本层** |
| pdf-images | PDF→图片（范围/PNG·JPG/72·150·300 DPI）+ 图片→PDF（Letter/方向/边距/自定义名，M34） |
| exam-split | PDF 拆分/裁剪（M49 收敛，合并/删页/旋转已下线导流 pdf-toolkit）+ OCR 切题（检测→微调→导出）；题号规则内置不可配 |
| docx2pdf | Office 六扩展名批量转 PDF（1–100 串行、失败不中断）+ soffice 组件管理 |
| markdown-tool | MD 预览（sandbox iframe）/ JSON→TS / YAML 互转；**不做导出 PDF/Word、JSON Schema** |

### 1.5 音视频（media，2）

| toolId | 能力 |
| --- | --- |
| media-convert | 5 页签：转码 / 截取 / 提取音频 / 音频互转（M50）/ 压缩；**已拍板无硬件编码·无字幕·无合并** |
| video-download | 链接提取 → 队列（并发 2、进度/暂停/续传）+ 历史 100 条 + 三预设 + 免责三重呈现 + **Cookie 管理（M5 已落地，非缺口）**；抖音取流平台侧风险，不承诺 |

### 1.6 文件管理（file，6）

| toolId | 能力 |
| --- | --- |
| file-renamer | 单目录 6 规则叠加 + 实时预览 + 8 条冲突校验 + 撤销；**非递归、不改文件夹名、无 EXIF/ID3** |
| file-hasher | 多选 MD5/SHA-1/SHA-256 + 期望比对 + TSV 复制；**无 SHA-512、不递归** |
| duplicate-finder | 单目录大小分组 + 两段 SHA-256 + 默认保最早 + 回收站；**无目录排除/扩展名过滤** |
| disk-analyzer | 目录下钻 + 占比条 + 阈值；**无文件类型统计、无 Treemap、无 CSV 导出** |
| folder-compare | 双目录按相对路径比元数据（大小 + mtime）；**只读、无内容哈希、无空目录、无同步** |
| fs-cleaner | 4 页签：目录树导出 / 空文件夹 / 批量改时间（仅 mtime·atime）/ 临时文件；删除均进回收站 |

### 1.7 其他（misc，6）+ 示例（1）

| toolId | 能力 |
| --- | --- |
| password-generator | 密码（熵强度）/ UUID v4 / 随机字符串与整数；**无 passphrase、无泄露校验（联网，Q6）** |
| dev-toolbox | 端口占用 / CURL 转代码 / 静态服务器（127.0.0.1）/ JWT 解码（M45） |
| misc-toolbox | 子网计算（**仅 IPv4**）/ 屏幕标尺（M51）/ 计时器（秒表·倒计时·番茄钟） |
| system-info | OS/CPU/内存/磁盘/网络五区 + 复制（M53） |
| zip-tool | 打包/解压（zip slip 防护）；**仅 ZIP，无 7z/RAR/加密/分卷/GBK 转码** |
| example | 模板工具（Ping + 三段式）——**仍注册在生产清单（§5.4）** |

---

## 2. 竞品对标缺口

对标 13 个产品官方页（附录 C）。判定口径：**同类主流产品有、Lumin 无，且不触碰硬约束（Q6 离线/Q7c/Q13）**；「可做性」标注复用基础与大致成本。

### 2.1 壳与系统类（PowerToys · uTools）

| 竞品能力 | Lumin 现状 | 判定 |
| --- | --- | --- |
| 文件名即时搜索（Everything、uTools 文件搜索） | **完全没有** | **P1 新工具候选**（§4.1） |
| 剪贴板历史（uTools） | 无 | P1 壳能力（§5.2） |
| 窗口布局/置顶/唤醒（FancyZones、Always On Top、Awake） | 无 | P2，属新领域（需全局钩子，见 §4.5） |
| 快速启动器（PowerToys Run、Command Palette） | 无 | **默认不做**：与「单窗口 + 侧边栏」形态定位重叠，价值低 |
| Hosts 编辑、环境变量管理、注册表预览 | 无 | P2 小工具候选，需提权与安全评审 |
| 文件占用查询（File Locksmith） | 无（仅 smoke 覆盖"文件被占用"场景） | P2 候选（§4.4） |
| 录屏/屏幕标注（uTools 录屏、ZoomIt） | 无 | P1 新工具候选（§4.3） |
| Color Picker / Text Extractor / Screen Ruler / Image Resizer / PowerRename | **已有**：color-toolbox 吸管、ocr-text、misc-toolbox 标尺、image-toolbox 缩放、file-renamer | ✅ 对齐 |
| AI 生成应用 / MCP（uTools） | 无 | **硬约束否决**（附录 A） |

### 2.2 图片类（XnConvert · IrfanView · bigjpg）

| 竞品能力 | Lumin 现状 | 判定 |
| --- | --- | --- |
| 亮度/对比度/饱和度/锐化/模糊等调整（XnConvert 80+ 动作核心子集） | image-toolbox 调整页**仅灰度/反色/二值** | **P0 扩展**（§3.1，ffmpeg eq/滤镜零新依赖） |
| 文件夹递归批量、动作预设保存（XnConvert preset/watch folder） | 无（spec 二期候选） | P1（§3.2） |
| 元数据（EXIF/XMP）查看与编辑 | 无（fs-cleaner 仅改文件时间） | P1/P2（读取可复用 ffmpeg，写入需新依赖评估） |
| 500+ 格式读 / 70 格式写（XnConvert） | 6 格式（jpg/png/webp/bmp/tiff/avif） | **默认不做**：格式长尾由 ffmpeg 能力边界与体积口径决定，HEIC/RAW 需新解码器 |
| 图片查看器（IrfanView 核心） | 无（仅有缩略图预览） | P2 新工具候选（§4.5） |
| AI 放大/修复（bigjpg） | 无 | **硬约束否决**（联网推理，附录 A） |

### 2.3 文档 PDF 类（PDF24 · Stirling PDF · PDFgear）

| 竞品能力 | Lumin 现状 | 判定 |
| --- | --- | --- |
| 网页转 PDF（PDF24 webpage-to-pdf、Stirling） | 无 | **P0 新能力**（§4.2，Electron `printToPDF` 零新依赖） |
| PDF→HTML 导出 | 仅有纯文本提取 | P1（复用 pdfjs 文本 + 结构组装，§3.3） |
| PDF 加密/解密（PDF24 protect/unlock、Stirling） | 明确不做（Q19 拍板） | **已拍板冻结**，解冻需 R8（附录 B） |
| 页面内容编辑/注释/签名/表单（PDFgear、Stirling 核心） | 明确不做 | **已拍板冻结** + pdf-lib 能力边界，成本高（附录 B） |
| PDF OCR 可搜索化（PDF24 ocr-pdf） | 明确不做（M49 收敛决策） | **已拍板冻结**；技术上可复用 ocr-kit，解冻可行性中等（附录 B） |
| PDF↔Word/Excel/PPT 互转（PDFgear） | 仅单向 Office→PDF | **引擎缺失**：反向转换需新引擎（P2，默认不做，§6 表 ID-G11） |
| PDF 对比/涂黑/线性化/Overlay（PDF24、Stirling） | 无 | P2 长尾，价值中低 |
| 合并/拆分/压缩/旋转/删页/提取页/重排/水印/页码/图片互转 | **已有**（pdf-toolkit 11 Tab + pdf-images + exam-split） | ✅ 对齐 |

### 2.4 音视频类（HandBrake）

| 竞品能力 | Lumin 现状 | 判定 |
| --- | --- | --- |
| 硬件加速编码（NVENC/QSV/AMF） | 无 | **已拍板不做**（media-convert spec 拍板） |
| 字幕轨/章节/HDR 直通/滤镜（去隔行等） | 无 | **已拍板不做**（字幕、合并）；滤镜类未拍板，P2 可议 |
| 设备预设（preset）、批量队列 | 有高中低三档与串行批量 | ✅ 基本对齐 |

### 2.5 文件与文本类（Advanced Renamer · Everything · WizTree · FreeFileSync · TextFixer）

| 竞品能力 | Lumin 现状 | 判定 |
| --- | --- | --- |
| 文件即时搜索（Everything MFT 索引） | 无 | **P1 新工具候选**（§4.1） |
| 文件夹双向/镜像/更新同步（FreeFileSync） | folder-compare **只读比较**，无同步 | **P1 新工具候选**（§4.0） |
| EXIF/ID3/GPS 元数据命名（Advanced Renamer 13 方法） | file-renamer 6 规则，**无元数据** | P1 扩展（§3.4，读取侧复用 ffmpeg） |
| 正则/脚本改名（AR 支持完整正则 + JS） | 仅查找替换 `$1`–`$9` | P1 扩展（§3.5） |
| 改名批次 copy/move 模式、跨会话撤销 | 仅 rename、会话内撤销 | P2（spec 冻结，需解冻） |
| 磁盘分析 Treemap/文件类型统计/CSV 导出（WizTree） | disk-analyzer 仅下钻列表 | P1 扩展（§3.6，Treemap 属 spec 冻结项） |
| 重复文件查找（WizTree 内置） | **已有** duplicate-finder | ✅ 对齐 |
| 文本行处理矩阵（TextFixer：断行清理/去重行/排序/词频） | text-toolbox 文本处理页**大部分已有**（替换/去重/排序/9 项统计） | ✅ 基本对齐；缺 HTML 标签剥离/互转（P2，低价值，有 markdown-tool 部分覆盖） |
| 文件内容比较（FreeFileSync 二进制比较、Beyond Compare 类） | text-diff 仅粘贴文本、folder-compare 仅元数据 | **P1 扩展候选**（§3.7） |

### 2.6 对标总结

- **硬缺口（竞品普遍有、Lumin 完全没有）**：① 文件搜索；② 文件夹同步；③ 网页转 PDF；④ 图片调色（亮度/对比度/饱和度等）；⑤ 录屏；⑥ 剪贴板历史。
- **Lumin 已对齐的高频能力**：OCR、屏幕标尺、取色、批量重命名、重复查找、磁盘分析、PDF 基础操作矩阵——对标未发现结构性遗漏。
- **明确否决/冻结的**：AI 与云能力（Q6）、汇率（Q13）、题库（Q7c）、PDF 加密与内容编辑（Q19/M49 拍板）、硬件编码与字幕（拍板）——集中见附录 A/B，避免重复调研。

---

## 3. 现有工具扩展候选（B 类，ROI 最高）

按「复用现有资产 + 低/零新增依赖」排序。除标注外均为纯 renderer 或复用既有 ffmpeg/worker，chunk 影响小。

| # | 对象 | 扩展能力 | 复用基础 | 成本 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 3.1 | image-toolbox | **调整页扩至完整调色**：亮度/对比度/饱和度/色调/锐化/模糊（ffmpeg `eq`/`gblur`/`unsharp` 滤镜链，`mode:'effect'` 通道 union 扩展） | M40 调整页与 process 通道骨架 | 0.5–1d | 对标 XnConvert 核心缺口；零新依赖 |
| 3.2 | image-toolbox | **文件夹递归输入 + 处理历史列表**（spec 二期候选 L17/L98） | 既有批量任务链路 | 1d | spec 已预留，无需解冻 |
| 3.3 | pdf-toolkit | **PDF→HTML 导出**（保留标题/段落/列表层级） | M38 文本提取原语（`node-kit/pdf`） | 1d | 对标 Stirling；比 Word 反转换现实得多 |
| 3.4 | file-renamer | **EXIF/ID3 元数据命名**（拍照日期/尺寸/相机/艺术家 → 命名模板新算子） | `ffmpeg -i` stderr 解析已有（M10 `parseFfmpegStream` 思路复用，EXIF 需补解析纯函数）；或评估 `exiftool` 二进制（fetch-binaries 钉版） | 1.5–2d | spec「按 EXIF 改名不做」需解冻回写 |
| 3.5 | file-renamer | **完整正则支持**（`RegExp` 替换 + 常用模式预设） | 既有查找替换算子 | 0.5d | spec「仅 $1–$9」需解冻 |
| 3.6 | disk-analyzer | **文件类型统计（按扩展名聚合）+ CSV 导出** | 既有扫描结果在内存中聚合 | 1d | 类型统计是 spec 冻结项，需解冻；CSV 导出零依赖 |
| 3.7 | （新/跨） | **两文件内容比较**：文本走 LCS（复用 text-diff 纯函数）、二进制走字节哈希分段定位 | text-diff 行级算法 + file-hasher 哈希原语（**上提 `shared`/`node-kit` 后两工具复用，禁止互 import**） | 1.5–2d | 需归口决策：独立 Tab（text-diff 加文件输入）或并入 folder-compare「查看差异」入口 |
| 3.8 | time-toolbox | **Cron 反向生成**（勾选分钟/小时/日/月/周 → 表达式）+ 农历（纯算法） | 既有 Cron 解析纯函数 | 0.5d（Cron）+ 1d（农历） | spec 冻结项，解冻回写 |
| 3.9 | text-diff | **词级差异高亮**（变更行内 word-level） | LCS 算法已有 | 0.5d | spec 冻结项 |
| 3.10 | color-toolbox | **色盲模拟**（8 类色觉缺陷仿真矩阵，叠加显示） | 纯 renderer canvas 矩阵变换 | 0.5d | spec 冻结项；WCAG 场景强相关 |
| 3.11 | password-generator | **passphrase 口令短语**（内置 EFF 词表资产，可选分隔符/词数/熵） | Web Crypto 随机源已有 | 0.5d | 词表为运行时资产（smoke 单列 raw/gzip） |
| 3.12 | markdown-tool | **JSON Schema 生成**（对象数组 → JSON Schema draft-07）+ MD→纯文本导出 | 既有 JSON→TS 同源解析 | 0.5d | spec 冻结项；零依赖 |
| 3.13 | qr-code | **批量识别（≤50 张）+ 生成图内嵌 Logo** | ocr-text 批量列表骨架可参照（**代码上提共享组件**）；Logo 用 canvas 合成 | 1d | spec 冻结项 |
| 3.14 | misc-toolbox | **IPv6 子网计算** | 既有 CIDR 纯函数扩 IPv6（BigInt） | 0.5d | spec「暂不支持」项 |
| 3.15 | file-hasher | **SHA-512 算法 + 目录递归** | Web Crypto 原生支持 SHA-512；递归复用 node-kit 扫描 | 0.5d | spec 冻结项解冻 |
| 3.16 | folder-compare | **内容哈希深度比较开关**（大小相同存疑项二段 SHA-256） | duplicate-finder 两段哈希模式**上提 `node-kit`** 后复用 | 1d | spec 冻结项；性能需进度+取消 |
| 3.17 | ocr-text | **PDF 识别输入**（pdfjs 渲染页 → 既有 OCR 链路） | `node-kit/pdf` 渲染 + ocr-kit 全套 | 1d | M49 明确不做（归 exam-split/pdf-images），解冻需 R8 |

未列入的工具（calculator、unit-converter、life-calculator、text-toolbox、image-rotate/crop/stitch/watermark、docx2pdf、exam-split、system-info、dev-toolbox、fs-cleaner、zip-tool 等）当前 spec 冻结块内**没有**低成本高价值项；其中值得记录的长期候选：calculator 变量与自定义函数（future-roadmap B 类遗留，中成本）、zip-tool 7z/加密（需新依赖评估，见 §6 G1）。

---

## 4. 新工具候选（A 类，复用现有资产）

全部触发 R8：改 plan.md §1 决策总表（Q13 工具范围）+ §6 里程碑 + AGENTS 同步 + 字段级清单先行。

| # | 候选 | 能力范围 | 复用基础 | 成本 | 风险/备注 |
| --- | --- | --- | --- | --- | --- |
| 4.0 | **folder-sync 文件夹同步** | 双目录对比 → 镜像/单向更新/双向三种策略，**预演清单 + 用户确认后执行**，冲突规则，回收站兜底，进度可取消 | folder-compare 扫描与配对逻辑**上提 `shared`/`node-kit`**；trashPaths、写原语已有 | 2–3d | 写操作类工具，必须「只读扫描 → 预演 → 确认 → 执行」三段式；上限与 folder-compare 对齐（20 万文件）；对标 FreeFileSync |
| 4.1 | **file-search 文件搜索** | 选定盘/目录建索引（内存倒排：文件名分词 + 子串），增量刷新，结果排序（大小/时间），双击定位/reveal | 纯 Node `fs` 遍历（disk-analyzer 扫描骨架）+ renderer 虚拟列表 | 3–5d | 性能是核心风险：自建索引大库（百万文件）内存与耗时需实测，首期建议限定「选定根 + 文件数上限 50 万 + 索引进度可取消」；Everything 式 MFT 直读需 native/外部服务（`fetch-binaries` 可钉 ES，但有提权与服务常驻问题）→ 首期不做 MFT，靠 API 实测定档 |
| 4.2 | **web2pdf 网页转 PDF** | 输入 URL/本地 HTML → `webContents.printToPDF`（A4/Letter、边距、背景开关、页码） | Electron 内建 API，零新依赖；输出走 `writeAtomic` | 1d | 对标 PDF24；**必须本地渲染、无后端**（Q6 合规）；需导航拦截白名单豁免与超时/错误三态 |
| 4.3 | **screen-recorder 屏幕录制** | 整屏/窗口选取 + 时长/音频开关 → `desktopCapturer` 流 → ffmpeg 编码 mp4/webm，进度 + 取消 | node-kit/screen.ts 截屏（M51）+ ffmpeg spawn 进度解析（media-convert 全套） | 2–3d | 体积零增量（ffmpeg 已随包）；录屏时长上限与体积口径需定义；对标 uTools 录屏/ZoomIt |
| 4.4 | **file-lock 文件占用查询** | 输入文件/目录 → 查询占用进程（PowerShell `OpenFiles`/`handle` 方案评估）+ 结束进程 | dev-toolbox 的 `execFile` 数组传参 + `taskkill` 模式 | 1–2d | Windows API 限制：不引 handle.exe 则覆盖率有限；提权场景需评估，P2 |
| 4.5 | 图片查看器 / 窗口管理类（FancyZones、置顶、Awake） | 基础看图；或全局窗口行为 | 看图可用 canvas 渲染骨架；窗口管理需 Electron `globalShortcut`/`screen` + 全局钩子 | 2–5d | **新领域**：与 Lumin「文件/内容处理工具」主线偏离，壳层需新增托盘/快捷键基建（§5.2），建议合并为「系统增强」分组统一拍板，单列 P2 |

---

## 5. 壳层平台能力与卫生项

### 5.1 已核实：future-roadmap（2026-11-16）缺口复验

| 当时记载 | 2026-11-22 复验结论 |
| --- | --- |
| `publish.url` 占位 | ✅ 已修复：`https://gitee.com/Lateautumn00/lumin/raw/master/updates` |
| README 是初始化模板 | ✅ 已重写（M5，含 SmartScreen 指引、许可表） |
| task-queue 单一全局队列、无配额/历史/重启恢复 | ❌ **仍未做**：`apps/desktop/src/main/task-queue.ts` 仅 `concurrency + maxPending=100`，manifest 无 `quota` 字段，无任务历史 UI |
| i18n 仅壳层、工具中文硬编码 | ❌ **仍未做**：`renderer/src/i18n/` 仅 `zh-CN.ts`（42 行）、无 en-US；工具硬编码抽样：exam-split 478 / text-toolbox 401 / docx2pdf 186 / unit-converter 152 处中文匹配 |
| LuminBridge 无系统级集成 | ❌ 仍无托盘/全局快捷键/剪贴板/通知（bridge 现有：invoke、事件、getAppInfo、openLogDir、getPathForFile、revealPath、trashPaths、pickDirectory、settings） |
| 其候选池（text-toolbox、media-convert、pdf-toolkit、批量重命名等） | ✅ **全部已落地**（M8/M14/M15/M7…），该文档候选池章节已整体过期 → 已标注（本报告头部说明同步写入其文档头） |

### 5.2 平台能力候选（均需 R8，AGENTS §6/§5 相应同步）

| # | 能力 | 现状 → 目标 | 成本 | 优先级建议 |
| --- | --- | --- | --- | --- |
| 5.2a | **i18n 收口 + en-US 结构** | 壳 42 key → 工具文案全 key 化（抽样约 800+ 处中文匹配）、`t()` 下沉 `shared`/`ui`、补 en-US | 3–5d（分批） | **P1**（Q9 兑现；多语言是产品面扩展前置） |
| 5.2b | **全局任务中心 + 按工具配额** | 单一队列 → manifest 可选 `quota` 声明（soffice 1/下载 2/OCR 2…）、全局任务列表 UI、持久化历史、重启恢复归一 | 3–5d | **P1**（消除 docx2pdf 等工具内 mutex 重复；改 plugin-api 契约） |
| 5.2c | **剪贴板历史**（uTools 对标） | 壳轮询 `clipboard` + 历史列表（上限 100、去重）+ 点击回写 | 1–2d | P1（随 5.2 系统增强统一拍板） |
| 5.2d | **托盘/全局快捷键/系统通知** | 无 → 壳基建（为 4.5、启动常驻铺路） | 1–2d | P2（先决于是否做 4.5） |
| 5.2e | 工作流编排（文件中立串联） | 无 → 壳层编排器 | 2–3d | P2 |
| 5.2f | 运行时热插拔（Q14 A→B） | 编译期清单 → 目录扫描 + 签名校验 | 5d+ | P2/P3（安全基线评审前置） |
| 5.2g | 代码签名 / macOS | 无 | 签名：证书费用 + 流程；macOS：全量 smoke 复跑 | P3（随发版节奏评估） |

### 5.3 卫生项（顺带发现，低成本）

| 项 | 证据 | 建议 |
| --- | --- | --- |
| `example` 示例工具注册在生产清单 | `apps/desktop/src/tool-manifests.ts` L8/L70（正式 UI「其他」分组可见） | 从生产清单移除（保留在 dev 条件注册或明确标注），0.25d |
| `batch-ocr/` 空目录残留 | 仅含 `.turbo`、`node_modules`，无 src | 删除目录，0.1d |
| `image-rotate-tasks.md` 三条 e2e SKIP | L56–58「本机缺 ffmpeg」未勾选 | 本机补验并回写，0.25d |
| 6 个 spec 状态行滞后 | qr-code/zip-tool/pdf-toolkit-m38/m49（「待批准」但 tasks 全 [x]）、image-stitch、exam-split「敬请期待」历史叙述 | 状态行回写统一，0.25d |

---

## 6. 优先级总表

口径：**P0 = ≤1 人日、零/近零新增依赖、无需契约变更，可立即排期**；**P1 = 1–5 人日或需 R8 新决策但价值明确**；**P2 = 高成本/新领域/需解冻拍板/依赖外部条件**。成本为单人粗估，非承诺。R8 列：是否需改 plan.md 决策总表。

### P0（建议下一里程碑批次消化）

| ID | 层 | 候选 | 能力 | 复用基础 | 成本 | R8 | 硬约束 | 依赖/chunk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0-1 | 扩展 | image-toolbox 调色 | 亮度/对比度/饱和度/锐化/模糊 | M40 effect 通道 + ffmpeg | 0.5–1d | 需（Q40 类目追加） | 无 | 零新增 |
| P0-2 | 扩展 | time-toolbox Cron 反向生成 | 勾选 → 表达式 | 既有 Cron 纯函数 | 0.5d | 需（spec 解冻） | 无 | 零新增 |
| P0-3 | 扩展 | color-toolbox 色盲模拟 | 8 类仿真矩阵 | canvas 变换 | 0.5d | 需（spec 解冻） | 无 | 零新增 |
| P0-4 | 扩展 | password-generator passphrase | EFF 词表短语 | Web Crypto | 0.5d | 需（spec 解冻） | 无 | 词表资产（smoke 单列） |
| P0-5 | 扩展 | markdown-tool JSON Schema | JSON→Schema | 既有 JSON→TS | 0.5d | 需（spec 解冻） | 无 | 零新增 |
| P0-6 | 扩展 | misc-toolbox IPv6 | IPv6 子网计算 | CIDR 纯函数 | 0.5d | 需（spec 解冻） | 无 | 零新增 |
| P0-7 | 扩展 | file-hasher SHA-512 | 算法复选 +1 | Web Crypto | 0.25d | 需（spec 解冻） | 无 | 零新增 |
| P0-8 | 扩展 | text-diff 词级高亮 | 变更行内词级 | LCS | 0.5d | 需（spec 解冻） | 无 | 零新增 |
| P0-9 | 扩展 | text-toolbox/qr 小项（qr 批量识别或 Logo 二选一先行） | 单项 | 批量骨架/canvas | 0.5d | 需（spec 解冻） | 无 | 零新增 |
| P0-10 | 卫生 | §5.3 四项（example 出清单、batch-ocr 清理、e2e 补验、状态行回写） | — | — | ~0.75d | 否 | 无 | 无 |

### P1（中期主推）

| ID | 层 | 候选 | 能力 | 复用基础 | 成本 | R8 | 硬约束 | 依赖/chunk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1-1 | 平台 | **5.2a i18n 收口 + en-US** | 工具文案 key 化 + 双语言 | 既有 i18n 结构 | 3–5d | 需（AGENTS UI 章） | 无 | 零新增 |
| P1-2 | 平台 | **5.2b 任务中心 + 配额** | quota 声明/任务列表/历史/恢复 | task-queue + manifest | 3–5d | 需（plugin-api 契约 + AGENTS §6） | 无 | 零新增 |
| P1-3 | 新工具 | **4.0 folder-sync 文件夹同步** | 三策略 + 预演确认 | folder-compare 上提 + trash | 2–3d | **需（新工具 Q）** | 无 | 零新增 |
| P1-4 | 新工具 | **4.1 file-search 文件搜索** | 索引 + 搜索 + 定位 | fs 遍历 + 虚拟列表 | 3–5d | **需（新工具 Q）** | 无 | 零新增（首期不做 MFT/ES） |
| P1-5 | 新工具 | **4.2 web2pdf 网页转 PDF** | URL/HTML → PDF | Electron printToPDF | 1d | **需（新工具 Q）** | Q6 合规（本地渲染即合规） | 零新增 |
| P1-6 | 扩展 | image-toolbox 递归 + 历史 | spec 二期两项 | 既有批量链路 | 1d | 需（spec 回写） | 无 | 零新增 |
| P1-7 | 扩展 | disk-analyzer 类型统计 + CSV | 聚合/导出 | 内存聚合 | 1d | 需（spec 解冻） | 无 | 零新增 |
| P1-8 | 扩展 | file-renamer EXIF/ID3 + 完整正则 | 元数据命名 + 正则 | ffmpeg 解析 / RegExp | 2–2.5d | 需（spec 解冻；EXIF 依赖形态评估） | 无 | 视 exiftool 与否 |
| P1-9 | 扩展 | 两文件内容比较（§3.7） | 文本 LCS + 二进制分段 | text-diff + hasher 上提 | 1.5–2d | 需（归口 + spec） | 无 | 零新增 |
| P1-10 | 扩展 | folder-compare 内容哈希开关 | 二段 SHA-256 | duplicate-finder 上提 | 1d | 需（spec 解冻） | 无 | 零新增 |
| P1-11 | 扩展 | pdf-toolkit PDF→HTML | 结构化导出 | M38 文本提取 | 1d | 需（spec 追加） | 无 | 零新增 |
| P1-12 | 扩展 | qr-code 批量识别（若 P0-9 未选）/ ocr-text PDF 输入 | 批量/PDF | 批量骨架 / pdfjs 渲染 | 1d | 需（M49 解冻） | 无 | 零新增 |
| P1-13 | 新工具 | 4.3 屏幕录制 | 桌面捕获 → ffmpeg | screen.ts + media-convert | 2–3d | **需（新工具 Q）** | 无 | 零新增（ffmpeg 随包） |
| P1-14 | 平台 | 5.2c 剪贴板历史 | 轮询 + 列表 + 回写 | clipboard API | 1–2d | 需 | 无 | 零新增 |

### P2（需解冻拍板 / 新领域 / 外部条件）

| ID | 候选 | 阻塞点 | 成本 | 前置条件 |
| --- | --- | --- | --- | --- |
| G1 | zip-tool 7z/RAR/加密/分卷 | 新依赖（7zip-min 或 7zr 二进制钉版）+ RAR 许可边界；GBK 转码可独立先做 | 2–3d | 依赖 PR 说明 + audit + 体积口径 |
| G2 | pdf-toolkit 内容编辑/签名/加密解密 | **Q19 拍板冻结** + pdf-lib 无文本编辑能力（R10 观察项联动） | 4–6d+ | R8 解冻 + 引擎选型评审（或维持不做） |
| G3 | PDF→Word/Excel 反向转换 | 引擎缺失（无现实零依赖路径） | 5d+ | 默认不做，除非引擎选型拍板 |
| G4 | 4.4 文件占用查询 | 提权/handle 覆盖率权衡 | 1–2d | 方案 spike |
| G5 | 4.5 看图 + 窗口管理类 | 新领域，需 5.2d 托盘/快捷键基建先行 | 2–5d | 「系统增强」分组统一拍板 |
| G6 | 5.2e 工作流编排 | 壳编排器 + 路径白名单 | 2–3d | R8 |
| G7 | 5.2f 热插拔 Q14 A→B | 安全边界变更（签名校验/CSP 复核） | 5d+ | 安全评审 |
| G8 | 5.2g 代码签名 / macOS | 证书费用 / 全量 smoke 复跑 | 外部条件 | 发版节奏评估 |
| G9 | calculator 变量与自定义函数 | 中成本、纯 renderer 可行 | 2–3d | R8（Q13 范围追加） |
| G10 | 元数据写入（EXIF 清除/写入） | 需新依赖或 exiftool 钉版 | 1–2d | 依赖评估（可并入 P1-8） |
| G11 | media-convert 硬件编码/字幕/合并 | **已拍板不做** | — | 仅当用户主动解冻 |
| G12 | video-download 抖音等国内平台 | 合规与失效风险（C 类） | — | 平台白名单随免责文案重议 |

---

## 附录 A：因硬约束不可做（勿重复调研）

| 条目 | 否决依据 |
| --- | --- |
| AI 图片放大/修复/生成、在线 OCR/翻译 | Q6 离线优先、数据不出本机（bigjpg 类联网推理否决） |
| 云同步 / 账号体系 / 历史云备份 | Q6（无自建后端） |
| 汇率换算 / 联网行情 | Q13 锁定 + Q6 |
| 密码泄露库校验（HaveIBeenPwned 类） | Q6（联网请求外部服务）；本地词典弱校验价值有限 |
| 结构化题库 / 出题 / 自动判卷 | Q7c 明确不做 |
| 第三方插件市场 / 运行时加载任意插件 | §2.4 安全基线（contextIsolation/sandbox/CSP）强冲突；热插拔（G7）亦须签名校验后才可议 |
| uTools 式 AI 生成应用 / MCP 接入 | Q6 |
| 二维码短链/内容上云 | Q6 |

## 附录 B：已拍板冻结项（R8 可解冻，但须用户明确重新拍板）

| 冻结项 | 拍板出处 | 解冻成本评估 |
| --- | --- | --- |
| PDF 加密/解密 | plan Q19 + pdf-toolkit spec | pdf-lib 支持标准安全处理器，**技术可行**；权限位支持有限 |
| PDF 页面内容编辑/表单/签名 | plan Q19 + spec | pdf-lib **无文本级编辑**，需新引擎（R10 观察项），高成本 |
| PDF OCR 文本层 / ocr-text PDF 输入 | M49 收敛决策 | 复用 ocr-kit + pdfjs，**中等可行（≈1d）**，属范围取舍而非技术不可行 |
| exam-split 题号规则可配 | spec 冻结 | 低（模板化已有 M27 先例） |
| media-convert 硬件编码/字幕/合并 | media-convert spec 拍板 | 硬件编码 ffmpeg 原生支持（体积不变），字幕/合并中等 |
| zip 7z/RAR/加密/分卷/GBK 转码 | zip-tool spec | 见 G1；**GBK 转码可零依赖先做**（fflate + TextDecoder） |
| folder-compare 空目录/内容哈希/权限比较 | spec | 哈希已列 P1-10；其余低价值 |
| file-renamer 递归/文件夹改名/跨会话撤销/EXIF | spec | EXIF 已列 P1-8；递归需重做扫描上限与安全校验（2d+） |
| image-rotate/crop 任意角度、动图 AVIF | spec | ffmpeg 可行但动图链路复杂，中成本 |
| life-calculator 提前还款/LPR、time-toolbox 农历节假日 | spec | 纯算法可做（农历列 P0 组外 1d） |
| text-diff 三路合并/文件读写 | spec | 中成本；文件读写可与 G/P1-9 归口合并决策 |
| pdf-toolkit 并发与输出目录可配 | spec | 低，但与「产物写源目录」既有拍板冲突，需 R8 |

## 附录 C：竞品数据来源（2026-11-22 实际抓取）

| 领域 | 产品 | 来源 |
| --- | --- | --- |
| 系统壳 | Microsoft PowerToys（25+ 模块清单） | learn.microsoft.com/en-us/windows/powertoys/ |
| 系统壳 | uTools（插件市场/剪贴板/录屏/OCR/批量） | u.tools |
| 图片 | XnConvert（80+ 动作/500 格式/preset） | xnview.com/en/xnconvert/ |
| 图片 | IrfanView（查看/批处理/幻灯） | irfanview.com |
| 图片 | bigjpg（AI 放大，联网类，仅作否决对照） | bigjpg.com |
| PDF | PDF24（24 工具矩阵） | pdf24.org |
| PDF | Stirling PDF（60+ 工具） | stirlingpdf.com |
| PDF | PDFgear（编辑/注释/转换/OCR） | pdfgear.com |
| 音视频 | HandBrake（编码器/字幕/滤镜/队列） | handbrake.fr/features.php |
| 文件 | Advanced Renamer（13 方法/EXIF·ID3·GPS） | advancedrenamer.com |
| 文件 | Everything（文件名索引搜索） | voidtools.com |
| 文件 | WizTree（MFT 磁盘分析/Treemap/重复查找） | diskanalyzer.com |
| 文件 | FreeFileSync（同步策略/目录对比） | freefilesync.org |
| 文本 | TextFixer（行处理/统计/HTML 互转矩阵） | textfixer.com |

> 注：`websearch` 集成本次不可用（连续取消），全部数据经 `webfetch` 抓取产品官方页/官方文档，未使用搜索摘要。

## 附录 D：本报告与旧文档的关系

- `docs/opencode/future-roadmap.md`（2026-11-16）：**已标注过时**。其阶段一（M3b/M4/M5）、阶段二 A/B 类候选全部已兑现；仅「阶段三平台能力」与「C 类否决项」仍有参考价值并已并入本报告 §5/附录 A。
- `.trae/documents/Lumin 功能清单差距审计与后续路线图.md`（M36–M43 时期）：历史基线，其路线图条目均已交付，不再更新。
- 本报告为**调研建议稿**：任何条目生效须走 R8（改 plan.md §1 + 同步 AGENTS.md + 字段级清单先行），口头无效。
