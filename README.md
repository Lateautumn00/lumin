# Lumin

离线优先的 Windows 桌面实用工具箱。单窗口 + 侧边栏，每个工具独立可插拔：离线优先、无自建后端、数据不出本机。

## 功能

| 工具          | 说明                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 计算器        | 表达式求值（mathjs）+ 历史记录                                                                                                                                                                          |
| 单位换算      | 长度/重量/温度/面积/体积/速度/时间/数据/数据速率/压强/功率/能量/流量/油耗/角度/频率/像素 17 类（不含汇率）                                                                                              |
| Office 转 PDF | `.doc/.docx/.xls/.xlsx/.ppt/.pptx` 批量转 PDF，同目录输出、重名自动 `(1)`                                                                                                                               |
| 试卷切割      | OCR 切题（图片/PDF → 单题导出）；PDF 拆分/裁剪作为前置处理，合并/删页/旋转等见「PDF 工具集」                                                                                                            |
| 图片工具箱    | 压缩 / 格式转换 / 缩放 / 调整（灰度、反色、黑白二值阈值）/ GIF 生成，支持 JPG、PNG、WebP、AVIF、BMP、TIFF                                                                                               |
| 图片旋转      | 批量旋转（90°/180°/270°）与水平/垂直翻转可组合，输出目录记忆、原图不修改                                                                                                                                |
| 图片裁剪      | 批量按比例（含九宫格锚点）或百分比区域裁剪，输出目录记忆、原图不修改                                                                                                                                    |
| 批量重命名    | 单目录六规则叠加、实时预览、冲突检测、单次撤销                                                                                                                                                          |
| 文本工具箱    | JSON 格式化/压缩/校验、Base64/URL/Hex/Unicode 编解码、正则测试与替换预览、批量文本处理与字数统计、摩尔斯电码、CSV/JSON 互转、汉字转拼音                                                                 |
| Markdown 工具 | Markdown 预览与 HTML 导出、JSON 转 TypeScript 类型或 JSON Schema、YAML 格式化与互转                                                                                                                     |
| 颜色工具箱    | HEX/RGB/HSL 互转、整屏吸管取色（支持窗口外）/取色器与色阶、图片调色板（主色与占比）、调和配色、色觉缺陷模拟（8 类）、WCAG 对比度（AA/AAA）检测                                                          |
| 时间工具箱    | 时间戳与日期互转、8 个常用时区当前时间、时长计算、Cron 校验与未来 5 次触发                                                                                                                              |
| 日历          | 公历/农历月历（节气与节日标记）、法定节假日与调休、黄历宜忌/建除/值神/冲煞、公历与农历纪念日管理（倒数日与周年）                                                                                        |
| 生活计算器    | 房贷月供与还款计划（等额本息/等额本金）、工资个税与五险一金、百分比与折扣计算                                                                                                                           |
| 密码生成器    | 强随机密码（字符集/排除/熵与强度）、EFF 口令短语（3–10 词、分隔符/大写/数字后缀）、UUID v4、随机字符串与随机整数                                                                                        |
| 文本对比      | 左右文本逐行对比，忽略空白/大小写、并排/统一视图、差异统计与统一 diff 复制                                                                                                                              |
| PDF 图片转换  | PDF 逐页转 PNG/JPG（范围/DPI），多张图片按序合成 PDF（auto/A4/Letter、方向/边距/自定义名）                                                                                                              |
| PDF 工具集    | 合并 / 拆分 / 删页 / 旋转 / 重排 / 元数据 / 水印 / 页码 / 文本提取 / 图片提取 / 压缩，产物写到源文件同目录                                                                                              |
| 文件哈希校验  | 批量计算 MD5/SHA-1/SHA-256/SHA-512，粘贴期望哈希自动比对，结果表可复制                                                                                                                                  |
| 重复文件查找  | 目录扫描 + 两段哈希确认重复组，默认保留最早一份，其余移入回收站                                                                                                                                         |
| 文件清理      | 目录树导出、空文件夹/临时文件扫描（勾选后移入回收站）、批量改文件时间（mtime/atime）                                                                                                                    |
| 开发工具      | 端口占用查询与结束进程、CURL 转 fetch/axios/python、JWT 解码（不验签）、本地静态服务器（仅监听 127.0.0.1）                                                                                              |
| 实用工具      | 子网/IP 计算（IPv4 CIDR /0–/32、IPv6 CIDR /0–/128）、屏幕标尺（截屏拖拽测量 px/cm/inch）、秒表 / 倒计时 / 番茄钟                                                                                        |
| 磁盘空间分析  | 目录递归扫描，子项按占用大小排序 + 占比条，逐级下钻（只读，不改文件）                                                                                                                                   |
| 系统信息      | CPU/内存/磁盘/网络/操作系统概览，一键复制全部（只读，不改文件）                                                                                                                                         |
| 文件夹对比    | 左右目录按相对路径比对文件大小/修改时间，差异分类 + 筛选定位（只读，不读内容）                                                                                                                          |
| 压缩包工具    | 打包文件/文件夹为 ZIP（保留相对结构），或解压 ZIP（防路径穿越、不覆盖、GBK 中文名自动转码）                                                                                                             |
| 音视频处理    | 视频/音频转格式（8 容器：mp4/mkv/webm/mov/avi/flv/ts/m4v；7 音频：mp3/m4a/wav/flac/ogg/aac/opus）、remux 换封装、H.265、分辨率/帧率/码率、去音轨、片段截取、提取音频、压缩（复用内置 ffmpeg，离线可用） |
| 二维码工具    | 生成文本/网址/WiFi/名片二维码（PNG/SVG），或从本地图片识别（单张/批量 ≤50 张）                                                                                                                          |
| 图片文字识别  | 单张或批量本地图片 OCR（离线 PP-OCR），逐张可编辑预览，复制、逐张或合并导出 TXT                                                                                                                         |
| 图片批量水印  | 多选图片批量叠加文字/图片水印（九宫格/透明度/旋转/平铺），原图不修改                                                                                                                                    |
| 图片拼接      | 多张图片拼成纵向/横向长图或网格拼图，或按固定高度/份数分割长图（间距/外边距/背景色可调）                                                                                                                |
| 文件预览      | 本地预览文本 / Markdown / HTML / JSON / CSV / PDF / 图片 / Office（经 LibreOffice 转 PDF）；PDF 逐页渲染，Markdown/HTML 走 sandbox 隔离预览                                                             |
| 文本编辑器    | 纯文本编辑：UTF-8/UTF-16/GBK 编码识别与保存、CRLF/LF、行号与当前行高亮、只读与 5MiB 大文件保护、外部修改冲突检测                                                                                        |
| 视频播放器    | 本地播放 mp4/webm/ogv/ogg（浏览器原生解码，倍速与全屏，不转码、不复制文件）                                                                                                                             |
| 视频下载      | B 站/抖音/YouTube 等站点下载（联网、仅本地解析，请遵守平台条款与版权）                                                                                                                                  |
| 外观主题      | 跟随系统 / 浅色 / 深色切换，全工具统一生效（tokens 单源，无逐工具适配）                                                                                                                                 |

## 系统要求

- Windows 10 / 11（x64）
- 无需安装 .NET、Python 或其它运行时
- Office 转 PDF 需 LibreOffice 转换组件：可在工具页内一键下载便携版（约 359 MB），或指定本机已安装的 `soffice.exe`

## 下载与安装

在 [Releases](https://gitee.com/Lateautumn00/lumin/releases) 下载：

- `Lumin-<版本>-win-x64-setup.exe`：NSIS 安装版，可选安装目录，创建桌面/开始菜单快捷方式
- `Lumin-<版本>-win-x64-portable.exe`：便携版，双击即用，不写安装目录

### SmartScreen 首次运行提示

当前版本未购买代码签名证书，Windows SmartScreen 可能提示「Windows 已保护你的电脑」：

1. 点击「更多信息」
2. 点击「仍要运行」

请只用官方 Release 附带的安装包，并通过 SHA256 校验确认文件完整：

```powershell
Get-FileHash .\Lumin-0.9.0-win-x64-setup.exe -Algorithm SHA256
```

对比 Release 说明中公布的 SHA256，不一致请重新下载。

## 数据与隐私

- 无自建后端，除视频下载外不联网；所有处理均在本机完成
- 视频下载引擎（yt-dlp/FFmpeg）随包提供；OCR 模型随包提供
- Cookie 使用系统凭据加密（Electron safeStorage）存储，不落明文
- 日志写到本机用户数据目录（设置页可打开日志目录），不上报

## 自动更新

- 关于页「检查更新」：检测 → 下载 → 「安装并重启」
- 更新源为 Gitee `updates/` 目录（generic provider）；`allowDowngrade=false`，回滚通过发布新版本覆盖
- 便携版同样可自更新，但更新后写入同一路径

## 开发

```bash
pnpm install                  # Node 24 + pnpm 12（corepack）
pnpm dev                      # 开发模式（壳 + 工具源码热更新）
pnpm build                    # 全量构建
pnpm typecheck                # 类型检查（含 vue-tsc / e2e）
pnpm lint                     # ESLint
pnpm test                     # Vitest 单测
pnpm coverage                 # 覆盖率门禁（全仓 ≥60%，核心纯函数 ≥80%）
pnpm test:e2e                 # 先构建，再用 Playwright 驱动真实 Electron
pnpm dist                     # 打包 NSIS + portable 到 apps/desktop/release
pnpm gate                     # lint → typecheck → test → audit → boundary
node scripts/fetch-binaries.mjs  # 拉取 OCR 模型 / 视频引擎（固定 URL + SHA256，产物不入库）
pnpm update:serve             # 本地更新源 http://127.0.0.1:8787（更新冒烟用）
```

架构与规范见 `AGENTS.md` 与 `docs/opencode/plan.md`；每个工具的字段级清单在 `docs/spec/`，冒烟记录在 `docs/smoke/`。

## 第三方组件与许可

本项目以 [MIT](LICENSE) 许可发布。随包或按需下载的第三方组件遵循各自许可：

| 组件                       | 用途           | 许可                          |
| -------------------------- | -------------- | ----------------------------- |
| Electron / Vue / Naive UI  | 桌面壳与界面   | MIT                           |
| LibreOffice（按需下载）    | Office 转 PDF  | MPL-2.0                       |
| yt-dlp                     | 视频下载       | Unlicense                     |
| FFmpeg                     | 图片/视频处理  | LGPL-2.1+ / GPL-2.0（视构建） |
| pdf.js / pdf-lib           | PDF 解析与生成 | Apache-2.0 / MIT              |
| PP-OCR 模型 + ONNX Runtime | 离线 OCR       | Apache-2.0 / MIT              |
| mathjs                     | 表达式求值     | Apache-2.0                    |
| CodeMirror 6 / iconv-lite  | 文本编辑器     | MIT                           |

第三方组件的版权与许可声明以其发布页为准。

## 贡献与反馈

- 问题与建议：提交 [Issue](https://gitee.com/Lateautumn00/lumin/issues)
- 代码贡献：从 `master` 拉 `feature/*` 或 `fix/*` 分支，门禁（`pnpm gate`）全绿后提交 Pull Request，并同步 `CHANGELOG.md` 与对应 `docs/spec`、`docs/smoke`

## 免责声明

视频下载工具仅限下载你有权保存的内容，请遵守目标平台服务条款与当地法律法规。因使用本工具产生的任何版权或合规风险由使用者自行承担。
