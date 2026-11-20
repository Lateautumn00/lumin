# Lumin 桌面实用工具箱 — 最终规划方案 v1.1（评审通过版）

> 状态：**评审通过，待实施**
> 评审：`.project-rules/role-skills` 11 个相关角色，21 条意见，修订 R1–R10 已并入本文
> 前置文档：决策来源为多轮评审问答（Q1–Q17），原文见 §1；原始角色规则见 `.project-rules/role-skills/`
> 配套文件：根目录 `AGENTS.md`（工程强制规范，由本方案 §5 收敛而成）

---

## 1. 决策总表（Q1–Q29 锁定）

| #   | 决策项     | 结论                                                                                                                                                                                                                                                         |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | 目标平台   | Windows x64 一期；架构不堵死 macOS                                                                                                                                                                                                                           |
| Q2  | 渲染框架   | Vue 3 + Vite + TS + Pinia + Naive UI                                                                                                                                                                                                                         |
| Q3  | Monorepo   | pnpm workspaces + Turborepo                                                                                                                                                                                                                                  |
| Q4  | 形态/集成  | 单窗口 + 侧边栏；工具**编译期清单插拔**（契约按运行时热插拔设计）                                                                                                                                                                                            |
| Q5  | Python     | **不引入**；视频下载捆绑 `yt-dlp.exe`/`ffmpeg.exe`（2026-11-19 体积优化：`ffprobe.exe` 移出随包，图片元信息改解析 `ffmpeg -i` stderr）；OCR 走纯 JS ONNX                                                                                                     |
| Q6  | 离线边界   | 无自建后端、数据不出本机；视频下载允许联网、仅本地解析，风险自担                                                                                                                                                                                             |
| Q7  | 试卷切割   | **a+b**：a = PDF 拆分/合并/删页/裁剪；b = OCR 切题（图片/PDF → 单题）；c（结构化题库）不做                                                                                                                                                                   |
| Q8  | Word→PDF   | LibreOffice headless，保真优先，按需下载组件                                                                                                                                                                                                                 |
| Q9  | 界面语言   | 中文文案集中 key 化，预留 i18n 结构                                                                                                                                                                                                                          |
| Q10 | 分发       | NSIS + portable；electron-updater generic provider；一期不买签名证书                                                                                                                                                                                         |
| Q11 | 测试/CI    | Vitest 必上；e2e 二期，但 M0 起必须有 IPC 冒烟自动化（R3）                                                                                                                                                                                                   |
| Q12 | 工具顺序   | 骨架 → 计算器/单位换算 → Word→PDF → 试卷切割(PDF→OCR) → 短视频下载                                                                                                                                                                                           |
| Q13 | 工具范围   | 科学计算器（表达式+历史）；10 类单位换算（无汇率）                                                                                                                                                                                                           |
| Q14 | 插拔深度   | **A. 编译期清单**（壳内仅 1 个 manifest）+ 契约按 B 设计（manifest.json 随包产出，未来换目录扫描即升级）                                                                                                                                                     |
| Q15 | OCR 路线   | **A. 纯 JS ONNX**：PP-OCR 模型（det+rec+cls ≈16.2MB 随包）+ onnxruntime 推理——M3b P0 钉 **onnxruntime-web**（wasm，免原生 rebuild），M3b P4 R1 复评按风险表切换为 **onnxruntime-node**（CPU EP，真实样卷 2.6–3.8× 提速达 ≤3s 基线）；Python 留作二期升级路径 |
| Q16 | OCR I/O    | 输入图片+PDF；OCR 行检测 → 题号聚类 → 预览+手动微调边界 → 导出每题 PNG + 可选合成 PDF                                                                                                                                                                        |
| Q17 | 项目规则   | **B. 精选强制**：8 份相关规则 → `AGENTS.md` + CI 门禁（lint/typecheck/test/audit 不绿不合 MR）                                                                                                                                                               |
| Q18 | 版本基线   | **全部最新稳定版 + 精确钉版**；TypeScript 采用「最新稳定版 + 生态适配实测回退制」，当前锁定 **6.0.3**（例外见 §1.1）；详见 §1.1                                                                                                                              |
| Q19 | PDF 工具集 | **新增通用 PDF 页面整理工具**（`pdf-toolkit`，2026-11-19 用户选定）：合并 / 拆分 / 删页 / 旋转 / 重排 / 元数据；不复做加密解密、裁剪与 OCR（exam-split）、PDF↔图片（pdf-images）；产物写源文件同目录；详见 §4.15                                             |
| Q20 | 二维码工具 | **新增二维码生成与识别工具**（`qr-code`，2026-11-19 用户选定）：生成（文本/网址/WiFi/vCard，PNG/SVG）/ 识别（本地图片）；生成与解码在 renderer（`qrcode` + `jsqr`），主进程只做目录记忆与原子写盘，无长任务；详见 §4.16 |
| Q21 | PDF 水印/页码 | **在 `pdf-toolkit` 扩展两个 Tab**（2026-11-19 用户选定）：水印（文字支持中文，renderer Canvas 栅格化；PNG/JPG 图片；透明度/角度/大小/平铺/页码范围）、页码（6 向位置、起始页、4 预设 + 自定义 ASCII 模板 `{n}`/`{total}`、字号/颜色/边距/页码范围）；复用 pdf-lib 与既有 worker/错误码，零新增依赖；详见 §4.17 |
| Q22 | 重复文件查找 | **新增 `duplicate-finder` 工具**（2026-11-19 用户选定）：单目录（可含子目录）扫描 → 大小分组 + 64KB 前缀预筛 + 全量 SHA-256 确认 → 重复组展示与默认勾选 → 定位 / 移入回收站；新增壳通用能力 `lumin:shell:trash`（Electron `shell.trashItem`）；零新增第三方依赖；详见 §4.18 |
| Q23 | 深色主题切换 | **壳级平台能力（2026-11-19 用户选定，无新工具包）**：跟随系统 / 浅色 / 深色三模式；tokens 单源新增暗色变量集（`html[data-theme='dark']` 覆盖），Naive UI 主题层切换 + 设置页持久化 `shell.theme.mode`；全工具零改动受益；零新增依赖、不新增 IPC；详见 §4.19 |
| Q24 | 图片文字识别 | **新增 `ocr-text` 工具（2026-11-19 用户选定）**：单张图片（PNG/JPG/WebP，含截图）离线 PP-OCR 识别 → 可编辑文本预览 → 复制 / 导出 TXT（`{原名}-OCR.txt`，冲突递增）；引擎从 exam-split 上提为根 `packages/ocr-kit`（exam-split 薄壳零回归），`writeAtomic` 上提 `node-kit`；零新增第三方依赖；详见 §4.20 |
| Q25 | 图片批量水印 | **新增 `image-watermark` 工具（2026-11-20 用户选定）**：多选图片（PNG/JPG/WebP，1–100 张、单张 ≤40MB）批量叠加文字/图片水印；九宫格位置、边距、透明度、大小、旋转、平铺可调；输出到指定目录 `{原名}_水印.{ext}`（冲突递增、绝不覆盖原图）；worker 串行 + 进度 + 取消；复用 `@napi-rs/canvas`，零新增第三方依赖；详见 §4.21 |
| Q26 | 图片拼接 | **新增 `image-stitch` 工具（2026-11-20 用户选定）**：多选图片（PNG/JPG/WebP，1–100 张、单张 ≤40MB）→ 纵向长图 / 横向长图 / 网格拼图；基准尺寸（首图/最大/固定）、间距、外边距、背景色、输出格式与质量可调；输出单张、冲突递增；复用 `@napi-rs/canvas`，零新增第三方依赖；详见 §4.22 |
| Q27 | 磁盘空间分析 | **新增 `disk-analyzer` 工具（2026-11-20 用户选定）**：选择目录（含子目录）扫描 → 直接子项（子目录递归汇总 + 文件）按大小降序 + 占比条 + 逐级下钻；最小文件显示阈值 0/1KB/100KB/1MB；单次 20 万文件上限、进度 + 取消；只读分析、绝不改删文件；worker 递归扫描、零新增第三方依赖；详见 §4.23 |
| Q28 | 文件夹对比 | **新增 `folder-compare` 工具（2026-11-20 用户选定）**：左右两个目录递归扫描，按相对路径配对比较文件元数据（大小 + 修改时间，时间容差 2s、可关闭）；仅比较文件不列目录差异，不读文件内容/不算哈希；只读不改文件；单侧 20 万文件上限、结果 2 万条截断、进度 + 取消；worker 扫描、零新增第三方依赖；详见 §4.24                                     |
| Q29 | 压缩包工具 | **新增 `zip-tool` 工具（2026-11-20 用户选定）**：ZIP 打包 / 解压双模式——打包（多选文件/文件夹、保留相对结构、产物冲突递增）/ 解压（zip slip 防护、拒绝符号链接、条目数与解压总大小上限防压缩炸弹、同名自动重命名或跳过）；worker 流式读写 + 进度 + 取消；新增依赖 fflate 0.8.3（纯 JS、MIT、无原生）；详见 §4.25 |
| —   | 硬约束     | 工具独立可插拔、零耦合；公共代码上提根 `packages/`；工具间禁止互相依赖                                                                                                                                                                                       |

### 门禁阈值（Q17 附带锁定）

- 核心纯函数（换算/解析/表达式/进度解析）覆盖率 **≥80%**，全仓 **≥60%**
- `no-explicit-any` = **error**
- `pnpm audit` 无 **high/critical**
- lint + typecheck + test + audit 不绿 **不合 MR**

### 1.1 版本基线（M0 锁定，全部 latest stable）

> 2026-11-12 npm 核查。实施首日与每次升级依赖前必须重新 `npm view` 复核；有漂移先更新本表再改依赖（R8 变更流程）。全部**精确钉版**（无 `^`）+ `pnpm-lock.yaml` + `packageManager` + `.nvmrc`，CI 一律 `--frozen-lockfile`。

| 类别           | 版本                                                                                                                                                                                                                                                                                       | 说明                                                                                                                                                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node           | 24.13.0（`.nvmrc`）                                                                                                                                                                                                                                                                        | Electron 45 要求 ≥22.12                                                                                                                                                                                                                                                                                                                |
| pnpm           | 12.18.0（`packageManager`，corepack）                                                                                                                                                                                                                                                      | npm `latest` 仍指 11 线；独立安装用 `latest-12` 标签                                                                                                                                                                                                                                                                                   |
| **TypeScript** | **6.0.3（当前锁定）**                                                                                                                                                                                                                                                                      | **例外记录（2026-11-12，方案 A 触发回退）**：7.0.2（Go 原生版）实测 `tsc` 类型检查通过，但 `typescript-eslint@8.72.2` 运行时硬报错 "does not support TS 7.0"（peer `<6.1.0`，跟踪 typescript-eslint#10940，称支持随 ≥7.1 到来）→ 按方案 A 回退 6.0.3。升级条件：typescript-eslint 发布支持 TS 7 的稳定版后复测 lint+typecheck+冒烟再升 |
| Electron 套件  | electron 45.3.1 · electron-vite 6.0.0 · electron-builder 26.18.0 · electron-updater 6.8.11                                                                                                                                                                                                 | 46 仅 alpha；`@swc/core` 为 electron-vite 可选 peer，不装                                                                                                                                                                                                                                                                              |
| 构建/框架      | vite 8.3.8 · @vitejs/plugin-vue 6.0.10 · vue 3.5.45 · vue-router 5.5.0 · pinia 4.1.0 · naive-ui 2.45.3 · tailwindcss 4.3.5 + @tailwindcss/vite 4.3.5（CSS-first `@theme`，无 config.js）· @lucide/vue 1.72.0（lucide-vue-next 整包已废弃，官方继任包）                                     | vue 3.6 仅 rc，取 3.5 稳定线；lucide 于 M0 切换继任包（Q18 最新稳定版原则）                                                                                                                                                                                                                                                            |
| 校验/测试      | zod 4.6.7 · vitest 5.1.0 + @vitest/coverage-v8 5.1.0 · @vue/test-utils 2.5.1 · vue-tsc 3.3.14                                                                                                                                                                                              | vue-tsc peer 无上限（TS7 兼容待实测）                                                                                                                                                                                                                                                                                                  |
| Lint/格式      | eslint 10.14.0 · @typescript-eslint/* 8.72.2 · eslint-plugin-vue 10.12.1 · vue-eslint-parser 10.4.2 · @vue/eslint-config-typescript 14.9.0 · @vue/eslint-config-prettier 10.2.0 · eslint-config-prettier 10.1.8 · prettier 3.10.1                                                          |                                                                                                                                                                                                                                                                                                                                        |
| 工程化         | turbo 2.11.11 · dependency-cruiser 18.7.2 · electron-log 5.4.4                                                                                                                                                                                                                             | pnpm 12 为 Rust 重写，配置格式与 11 兼容；`--frozen-lockfile false` 语法已移除                                                                                                                                                                                                                                                         |
| 后续里程碑     | mathjs 15.2.0（M1）· pdf-lib 1.17.1 + pdfjs-dist 6.5.438（M3）· **onnxruntime-web 1.31.1（M3b P0 钉版）→ onnxruntime-node 1.31.1（M3b P4 R1 复评切换，2026-11-18 `npm view` 复核 latest=1.31.1，`pnpm-workspace.yaml` `allowBuilds` 放行 postinstall）** · @playwright/test（M0 IPC 冒烟）· **fflate 0.8.3（M25，2026-11-20 `npm view` 复核 latest=0.8.3；纯 JS ZIP，MIT，无原生依赖）** | M3b P0 实测：worker_threads 内 import 23ms / session 创建 327ms / 320² 推理 62–90ms；模型与字典经 `scripts/fetch-binaries.mjs` 固定 URL+SHA256 拉取（det 4.7MB + rec 10.9MB + cls 0.6MB + 字典 6623 字符，合计 ≈16.2MB）；P4 真实样卷 wasm 3.3–4.7s/页超 R1 ≤3s 基线 → 切 onnxruntime-node 后 1.10–1.56s/页达标（提速 2.6–3.8×）       |

---

## 2. 架构

### 2.1 核心原则：壳零工具知识

```
apps/desktop/src/main/          # 纯壳，不含任何工具专属代码
├── index.ts                    # 窗口 + 安全基线 + 单实例锁
├── plugin-host.ts              # 通用插件加载器：读 manifest → 调 registerMain
├── ipc-bus.ts                  # 通用 IPC 分发：信封校验 + 按注册表路由
└── services/                   # settings / log / updater / taskQueue / dialog
```

- 每个工具 = `packages/tools/<id>` 独立 package：`manifest.ts`（元数据）+ `renderer/`（UI + 类型化 client + 自带 zod schema）+ `node.ts`（`registerMain(ctx)`，无主进程逻辑可省）
- **新增工具 = 新包 + 壳清单加 1 行**
- 升级到运行时热插拔 = 壳清单换目录扫描，工具包零改动（Q14 预留）

### 2.2 IPC 与任务模型

- 通道命名 `{toolId}:{action}`；`shared` **只定义信封**（channel/payload/progress/error 形状），**schema 与类型化 client 归各工具包自带**（避免 shared 认识所有工具的隐性耦合）
- 长任务统一模式：
  1. `invoke` 提交 → 返回 `{ taskId }`
  2. 主进程推 `lumin:task:event`（`progress | log | done | error`）
  3. `lumin:task:cancel` 取消（kill child / terminate worker）
- 主进程 `taskQueue`：并发上限可配（soffice **串行**——单实例锁；下载 2；OCR 2；PDF 2）

### 2.3 重任务执行

| 类型     | 机制                                              | 用于                    |
| -------- | ------------------------------------------------- | ----------------------- |
| CPU 密集 | `worker_threads`（node-kit 统一封装 `runTask()`） | pdf-lib 拆合、OCR 推理  |
| 外部程序 | `child_process.spawn` + stdout 解析 → 事件推送    | soffice、yt-dlp、ffmpeg |
| 纯 IO    | 主进程直接做                                      | 设置读写、文件对话框    |

### 2.4 安全基线

`contextIsolation: true` · `nodeIntegration: false` · `sandbox: true` · CSP 禁远程脚本 · 导航拦截 + `setWindowOpenHandler` deny · 文件选择一律 `dialog.showOpenDialog` 白名单 · `shell.openExternal` 白名单域名。

### 2.5 依赖规则（dependency-cruiser 进 CI 强制）

1. `tools/*` → 仅可依赖 `plugin-api / shared / ui / node-kit / ocr-kit`
2. **`tools/*` 之间禁止互相 import**
3. `tools/*` 禁止 import `apps/*`
4. `apps/*` 内除 manifest 文件外禁止出现工具名
5. renderer 禁止 import main

---

## 3. 目录结构（定稿）

```
lumin/
├── AGENTS.md                    # 项目强制规范（本方案 §5 收敛，已生成）
├── .project-rules/              # 原始角色规则（参考源，保留不动）
├── .gitee/workflows/            # MR 门禁 + tag 发版
├── scripts/
│   ├── fetch-binaries.mjs       # 下载/校验二进制与 OCR 模型（固定 URL + SHA256 钉死）
│   └── release.mjs              # 本地打包兜底
├── apps/desktop/
│   ├── electron.vite.config.ts  # main/preload/renderer 三段构建
│   ├── electron-builder.yml     # NSIS + portable + extraResources + publish
│   └── src/
│       ├── main/                # 纯壳（见 §2.1）
│       ├── preload/index.ts     # contextBridge → window.lumin（强类型）
│       └── renderer/src/
│           ├── App.vue          # 侧边栏 + <router-view>
│           ├── router/          # 由工具清单生成动态路由
│           ├── layout/          # Sidebar / Settings / About
│           └── tools/           # 工具页面薄壳（逻辑在 packages/tools）
├── packages/
│   ├── plugin-api/              # ★ 唯一契约：ToolManifest / MainPluginContext / bridge 类型
│   ├── shared/                  # IPC 信封、错误码、任务事件形状、i18n 规范
│   ├── ui/                      # DropZone / TaskProgress / Empty 等跨工具组件（M2 后抽）
│   ├── node-kit/                # spawn+进度解析、worker 封装、路径解析、原子写盘
│   ├── ocr-kit/                 # ★ PP-OCR 引擎共享包（预处理/CTC/模型/PDF 渲染/资产校验）
│   └── tools/
│       ├── calculator/          # manifest.ts + renderer/（+ node.ts 如需要）
│       ├── unit-converter/
│       ├── docx2pdf/
│       ├── exam-split/          # PDF 操作 + OCR 切题同包两入口
│       ├── ocr-text/            # 图片 OCR 文字提取（复用 ocr-kit）
│       └── video-downloader/
├── binaries/                    # gitignore；fetch 脚本拉取
├── docs/opencode/               # 本方案
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

---

## 4. 各工具实现方案

### 4.1 计算器（M1）

- mathjs 表达式求值：`sin/cos/ln/√/^`、括号、π/e、角度/弧度切换
- 键盘输入；计算历史（Pinia + 持久化，上限 100 条）；科学/基础两档布局
- 纯 renderer，无 IPC
- **验收**：表达式求值用例覆盖 ≥80%

### 4.2 单位换算（M1）

- 数据驱动：`{ category, units[{id,name,factor}] }`；10 类 = 长度/重量/温度（偏移换算单独模型）/面积/体积/速度/时间/数据量/压强/功率；**无汇率**
- 双向换算 + 单位收藏
- **验收**：换算表全量断言覆盖 ≥80%

### 4.3 Word→PDF（M2）

- **soffice 定位顺序**：设置自定义路径 → 系统安装（注册表/`Program Files\LibreOffice`）→ `userData/libreoffice-portable` 按需下载（~350MB，进度+断点重试）
  - **P4 实现回写（2026-11-14）**：系统安装层仅查注册表 `HKLM/HKCU\SOFTWARE\LibreOffice\UNO\InstallPath`（`%ProgramFiles%` 硬编码回退未实现，注册表已覆盖官方安装器写入项；如需补充须走变更流程）
- 调用：`soffice.exe --headless -env:UserInstallation=file:///独立profile --convert-to pdf --outdir <tmp> <input>`（独立 profile 防抢锁）
- **串行队列** + 超时 60s kill + 产物存在校验 + 可读错误（加密/占用/未装引导）
- **错误码扩展（P4 回写）**：R2.7 磁盘满类新增 `OUTPUT_WRITE_FAILED`；`shared.toStructuredError` / `docx2pdf.isStructuredError` 修复 errno 码（EPERM 等）冒充结构化错误码的透传漏洞（`Error` 实例一票否决）
- 打包策略：默认「精简包」不含 LibreOffice；设置页「安装转换组件」按需下载
- 中文字体走系统字体，无需打包
- **验收**：含表格/页眉/中文字体 docx 转换保真可接受（R8 功能清单先行）——P4 实测：保真人工目视通过、e2e 13 passed、chunk 13,322 B gzip、R2 八类真实记录见 `docs/smoke/docx2pdf.md`
- **M9 扩展**：输入扩至 Excel/PPT 六种扩展名并支持批量队列，见 §4.9

### 4.4 试卷切割（M3a PDF + M3b OCR）

**M3a — PDF 操作**

- 预览：`pdfjs-dist` 缩略图（renderer worker，`GlobalWorkerOptions.workerSrc` 配置）
- 写出：`pdf-lib` 无损——按页码区间拆分（`copyPages`）、多文件合并（拖拽排序）、删除页（去答案）、旋转、矩形区域裁剪（`setCropBox`）
- 命名模板 `{原名}_p1-3.pdf`；加密 PDF 结构化中文错误
- **验收**：100 页拆分 <2s；区间解析纯函数覆盖 ≥80%

**M3a 完成记录（2026-11-15）**：

- 五算子 + pdfjs 预览（缩略图渲染/点选回写区间/裁剪框拖拽）全部交付；OCR Tab 按拍板置灰占位（单页双 Tab）。
- 验收全绿：e2e 19/19、exam-split 分组覆盖率 96.42/83.8/96.92/98.31（全仓 92.94%）、`pnpm gate` + `format:check` 通过；chunk **gzip 189.5KB < 200KB**（pdfjs worker 资产 370.4KB 单列）。
- R2 八类逐条真实记录见 `docs/smoke/exam-split.md`（R2.4 超大 74.7MB、R2.7 磁盘满 VHD ENOSPC 实测）；spec §8 人工目视完成（soffice PNG + pdfjs 预览截图双路径）。
- 实现偏差已回写 spec §7.4/§8/§9：① `writeOutput` 失败 best-effort 清理截断半成品（R2.7 附带加固）；② 裁剪目视因 LO 忽略 CropBox 改道 pdfjs 预览渲染。

**M3b — OCR 切题（Q7=b）**

> 字段级功能清单：`docs/spec/exam-split.md` **§10（2026-11-16 定稿，R8）**——两段式 IPC（ocr-detect → 微调 → ocr-export）、错误码增补（`OCR_INPUT_INVALID`/`MODEL_MISSING`/`NO_REGIONS`/`OCR_FAILED`）、命名与验收细则以该节为准；实现偏差回写该节 + 本节。
>
> **实现期偏差（2026-11-16，R8 已拍板回写 spec §10.2/§10.4）**：① region 增加**可选** `xStart`/`xEnd`（缺省 0/1 = 全宽）以支持页面级双栏——列间空隙 ≥3% 页宽且两列均含题号行才判分栏，每列独立聚类、overlay 横线画在列内、导出按列裁剪；② 题号分两级（一级 `1.`/`1、`/`一、`/`第1题`，二级 `(1)`），仅当该列无一级题号时才启用二级，避免切碎小题。
>
> **P0/P1 spike 实证（2026-11-16，不入库）**：onnxruntime-web 1.31.1 在 worker_threads 内 import 23ms / det session 创建 327ms / 320² 推理 62–90ms；pdfjs-dist 6 **legacy build** + `@napi-rs/canvas`（pdfjs NodeCanvasFactory 原生支持）worker 内渲染 1191×1684 页 6–36ms、PNG 魔数 `89504E47` 正确；rec 模型输出 `[1,T,6625]`，CTC 实证 **blank=0、字典索引=输出索引−1**（渲染「1. 下列哪项正确」精确解码）；det/rec/cls/字典 SHA256 全部与上游或实测钉死一致。故 `standardFontDataUrl`/`cmaps` 须走 legacy build 的文件路径（非 file:// URL）。
>
> **性能达标路径（2026-11-16 拍板，已回写 spec §10.8）**：det 960 长边 + 32 对齐预处理 → 5/5 行命中、609ms/页；rec 全宽 batch 40 行 **3.3s 超 3s 预算**、`numThreads=4` 无改善（wasm 线程未生效）→ 改**行前缀裁剪 3.5×行高**（保持宽高比缩 48 高、上限 320）**38ms/行**，40 行 1.5s + det ≈0.5s ≈ 2s 达标，且 12 种内置题号样式全部精确识别。前缀裁剪为**必选实现口径**，偏离须回写 spec §10.8 + 本节。
>
> **P2 实现记录（2026-11-17，R8 已回写 spec §10.9）**：① 模块拆分 —— 主进程 `ocr-assets.ts`（存在+体积+SHA256 预检，不缓存）与 worker 侧 `ocr-render.ts`/`ocr-model.ts`/`ocr-ops.ts`/`ocr.worker.ts` 分离，主进程 bundle 不拖入推理代码；② pdfjs v6 用 `cMapUrl`（`cmaps`/`isEvalSupported` 已移除），渲染 1.5 倍率 + 白底 + `destination-over` 补白 + `msyh.ttc` 注册；③ ort node 构建仅 default 导出（`loadOrt` 互操作兜底，`numThreads=1/proxy=false`），rec 按前缀宽度分组 batch（同宽零 padding）；④ 打包：三依赖进 `apps/desktop` dependencies 由 `externalizeDepsPlugin` 外部化，`asarUnpack` = `@napi-rs/**` + `onnxruntime-web/dist/**`；⑤ 构建产物 `out/main/chunks/ocr.worker-*.js` 真实 spawn 验证三页卷 **2.25s（≈750ms/页）**、A4@1.5 = 893×1263、regions 1/1/1；⑥ 单页 ≤3s 预算内，暂不切 onnxruntime-node。
>
> **P3 实现记录（2026-11-18，R8 已回写 spec §10.11）**：① UI 拆分 `OcrPreview`（左栏大图+overlay）+ `OcrPanel`（右栏三态/任务）+ `ocr-edit.ts`（纯编辑模型，24 用例）+ `ocr-workspace.ts`（provide/inject 会话，重置本页口径）+ `pdfjs.ts`/`pdf-open.ts`，`ErrorCard`/`ResultCard` 与 PDF Tab 共用；② 交互：分界线 `role="slider"` 键盘微调（↑/↓ 0.005、Delete、Esc）、添加模式按 x 命中列/y 拆题区、空页 [添加题区]、`NO_REGIONS` → 手动模式（按预览 meta 建页，当前页整页题区，`watch(totalPages)` 补页）；③ 图片预览改 `FileReader` data URL（CSP `img-src` 无 `blob:`）；④ **chunk 收口**：electron-vite 默认 `minify=false`，renderer 侧 pdfjs 根入口是 891KB 未压缩构建；改为官方压缩入口 `build/pdf.min.mjs`（renderer 别名，类型仍来自包根声明）后 `exam-split-*.js` **raw 712.0KB / gzip 177.6KB < 200KB**（此前 200.2KB 临界超限），worker 资产仍单列；⑤ 验证：`pnpm gate` 51 文件/526 测试全绿（audit 除外，见下）、`pnpm coverage` exam-split 分组 lines 97.90%/branches 83.74%、e2e 11/11（图片识别→键盘微调→导出 PNG+PDF、三页卷、损坏图片/加密 PDF、模型缺失、百页取消）；⑥ **P4 待办**：10 份真实样卷未提供，命中率与单页 ≤3s 以合成卷替代验证，R1 量化验收尚未关闭。
>
> **P4 范围（2026-11-18，R8 已回写 spec §10.12）**：真实样卷 9 文件 11 页入库后实测发现两类输入缺口——① 4 张侧拍截屏（含查看器 UI/黑边）与 2 个内嵌侧拍照片的 PDF：无 EXIF Orientation、引擎不做方向校正，仅出 1 个整页题区；② 2 张整本摊开的跨页照：书脊窄且页脚行跨缝，旧「最大空隙」列检测恒判单栏，产出 13/5 个碎题区。用户拍板新增两项能力后收口 R1：**页面旋转**（`rotation 0/90/180/270`，detect 与 export 同变换；PDF 叠固有 `page.rotate`；不做自动方向检测以免突破 ≤3s 预算）与**跨页展开拆分**（列检测改覆盖率谷底：1% 分桶、阈值 `max(1,⌈行数×3%⌉)`、谷底 ≥2%、限 `[0.2,0.8]`，两侧各需题号行；不新增页面模型）。旋转为破坏性操作（变更清空题区、需重识别）。
>
> **P4 完成记录（2026-11-18，R8 已回写 spec §10.8/§10.12、smoke §4/§5.5）**：① 新能力实测有效——旋转（rot270 复原 6 张侧拍输入）、跨页展开拆分（覆盖率谷底切书脊，跨缝页脚行归右页末题）；② **R1 量化验收关闭：命中率 90.5%（95/105）≥90% 主口径达标**（替代口径 ≈0.10 次/题同样满足）、**单页 1.10–1.54s/页 ≤3s 达标**；③ **引擎切换（R1 流程闭环，用户拍板）**：wasm 真实卷 3.3–4.7s/页超限 → 切 `onnxruntime-node 1.31.1`（CPU EP）：`exam-split`/`desktop` 双包换钉、`asarUnpack` 改 native 目录（win32 x64 ≈68.6MB 单列 smoke §4）、`pnpm-workspace.yaml` `allowBuilds` 放行 postinstall、`loadOrt` 去 wasm env（§1.1 已同步）；提速 2.6–3.8×，预处理/CTC 口径不变，det 浮点差异使题区微调（图3 5→6、图4 7→8、图1 13→12）→ 命中率 89.5%→90.5%；④ **e2e 回归发现并修复 `binaries` 根误判**：pnpm `.pnpm` 布局使 Electron 误判 `app.isPackaged=true` → `MODEL_MISSING det: ENOENT`；`ToolPaths.binaries` 改探测 `resources/binaries` 存在、回落仓库根（不再依赖 isPackaged）；⑤ 门禁：全仓 539 测试 / coverage 分组阈值通过（全仓 93.71/84.95/91.60/95.92）、e2e **13/13**、chunk 184.1KB gzip < 200KB、audit 仅已知 picomatch 例外（见下）。
>
> **已知外部风险（2026-11-18）**：`pnpm audit` 新增 high advisory **GHSA-fc5q-39xc-vjpf**（picomatch ≤4.0.7 ReDoS，`first_patched_version: null`，上游暂无修复版本），命中 vite/eslint 的构建期依赖，**不进应用运行时产物**；待上游发版后升级清零，期间门禁 audit 记为已知例外（不得借此放宽为无 high 规则）。

- 管线：图片/PDF 输入（pdfjs 渲染 PDF 页为图）→ PP-OCR 行级检测（**onnxruntime-node CPU EP**，P4 由 wasm 切换，见上）→ 按题号（「1.」「一、」）聚类成题区 → **缩略图预览 + 拖拽微调边界** → 导出每题 PNG + 可选合成 PDF
- 模型：PP-OCR det+rec+cls+字典 实测 **16.2MB** 随包（extraResources），**固定 URL + SHA256 钉死**
- 不做结构化题库（c 未选）；Python sidecar 留作二期升级路径
- **验收（R1 量化）**：固定样卷测试集（含手写/印刷/双栏/带图），**自动切题边界命中率 ≥90%，或每题人工微调 ≤1 次**；单页 OCR **≤3s**（超则切 onnxruntime-node 复评）——**P4 已关闭：90.5% + 1.10–1.54s/页双达标**
- **M20 引擎上提（2026-11-19，R8）**：OCR 引擎（预处理/CTC 解码/模型加载/PDF 渲染/资产校验）原样搬移至根 `packages/ocr-kit`，`exam-split` 原 `ocr-*.ts` 改为薄壳 re-export（行为零回归，250 测试通过），供 `ocr-text` 复用；`writeAtomic` 上提 `node-kit`（qr-code 同步改为 re-export）

### 4.5 短视频下载（M4）

- `scripts/fetch-binaries.mjs`：拉取官方 `yt-dlp.exe` + `ffmpeg.exe` 到 `binaries/`（**固定 URL + SHA256 钉死**，gitignore；ffprobe 已于 2026-11-19 移除，见 §4.10）
- 主进程 spawn 队列（并发 2）：`probe`（`yt-dlp -J`）→ `start` → 逐行解析 stdout 进度 → 事件推送
- 功能：链接粘贴、格式预设（best/1080p/仅音频 mp3）、暂停（kill + `--continue` 续传）、取消、输出目录、历史（JSON）
- 保鲜：设置页「更新下载引擎」；UI 免责声明（**文案 M4 开工前定稿，R8**）
- 抖音等国内平台：一期先 yt-dlp 直连试，失败标注二期
- **二期候选（2026-11-18，R8 记录）**：**Cookie 支持**——用户自带登录态（浏览器导出/粘贴 cookie → yt-dlp `--cookies` 透传），用于非公开/登录可见内容（抖音 `Fresh cookies are needed`、B站大会员画质等）。合规边界：仅透传用户自有凭证，**不内置签名逆向/cookie 池/绕过平台技术限制能力**（守免责文案 ④）。实测依据：yt-dlp Douyin extractor 可解析视频 id 但取流需 fresh cookies；第三方小程序（如「河畔视频提取」）可下非公开内容系其内置签名算法或服务端账号池，本项目不做。**字段级设计已定稿（2026-11-18）**：`docs/spec/video-download.md` §9——粘贴 + 浏览器自动读取（firefox ✓ / chromium-legacy ⚠ / 新版 Chrome ✘ App-Bound）、按平台三套管理（douyin/bilibili/youtube 域名匹配注入）、safeStorage 加密存储（禁明文 settings）、四条 `cookie:*` IPC 通道、三个新错误码；实现走 `feature/m5-cookie` 新分支（M4 合入后开工）
- **验收**：B站 + YouTube 真实链接下载成功；进度/暂停/队列可用

> **M4 开工前置已完成（2026-11-18，R8）**：① **免责文案定稿**（用户拍板**三重呈现**：工具页首次弹窗（`tools.video-download.disclaimerAccepted`，壳零工具知识）+ 工具页常驻 banner + 关于页「使用声明」全文链接）。正文：
>
> 本工具仅用于个人学习、研究与非商业用途的内容备份。您应确保：① 仅下载您拥有合法权利或平台明确允许下载的内容；② 遵守目标平台服务条款与所在地法律法规；③ 不将下载内容用于商业传播、二次分发或任何侵权用途；④ 因使用本工具产生的法律责任由使用者自行承担。本工具不内置任何绕过平台技术限制的能力。
>
> **平台范围**：一期验收 B站 + YouTube；抖音等国内平台一期直连试探一次，成功记录、失败标注二期；不承诺平台可用性，链接失效不视为缺陷。② **引擎保鲜口径**：版本随包钉死（fetch 脚本固定 URL+SHA256），设置页「检查更新」仅网络对比提示，不做运行时动态下载（守 R7）。③ 字段级清单 `docs/spec/video-download.md` 已定稿（含暂停 = cancel + `.part` 续传的零契约方案、历史字段、错误码 VD_*）。

### 4.6 图片工具箱（M6，2026-11-18 R8 登记）

- **决策（用户拍板 2026-11-18）**：下一个功能 = 图片批量压缩/格式转换/缩放（一工具三 Tab）；引擎 = **复用 M4 的 ffmpeg.exe**（零新增依赖与二进制；原并存的 ffprobe.exe 已于 2026-11-19 移除，见 §4.10）；格式矩阵**含 AVIF**（libaom-av1 单张 5–30s，UI 标注）；输出冲突**自动重命名**；GIF **转 webp 保留动画**（其他格式取首帧并标注）
- 通道：`image-toolbox:probe`（sync，ffmpeg 元信息）+ `image-toolbox:process`（task，批量串行 + 可取消）；编码参数映射/缩放求解/输出命名/冲突重命名全部纯函数（≥80% 覆盖）。**2026-11-19 体积优化**：探测改用 `ffmpeg -hide_banner -i <file>` 的 stderr 流行解析（纯函数 `parseFfmpegStream`），不再依赖 `ffprobe.exe`
- **2026-11-18 增补（用户反馈）**：输出目录支持系统选择器（新增壳通用通道 `lumin:shell:pick-directory` + bridge `pickDirectory`，工具 `set-output-dir` 即时记忆）；目标格式补全常用项——压缩 Tab `原格式/jpg/png/webp/avif`，转换/缩放 Tab `jpg(JPEG)/png/webp/avif/bmp/tiff`（png/bmp/tiff 为无损，质量滑杆置灰）
- 字段级清单：`docs/spec/image-toolbox.md`（已定稿）；错误码 `IT_*`；settings 仅记忆输出目录，一期无历史列表
- 依据实测：gyan.dev essentials 6.1.1 编码器 libwebp/png/mjpeg/libaom-av1 与 muxer avif/webp/image2 全部可用
- **验收**：gif→webp 帧数一致、缩放四模式尺寸断言、冲突重命名、单张 jpg < 1s（avif 除外）、R2 八类 smoke、gate 全绿

### 4.7 批量重命名（M7，2026-11-18 R8 登记）

- **决策（用户拍板 2026-11-18）**：下一个功能 = 文件批量重命名（`file-renamer`）。范围锁定：**单目录、非递归、只改普通文件**；不做文件夹改名/跨目录/跨会话撤销；不做临时中转改名（交换/成环在预览期判冲突），保证断电无残留
- 通道：`file-renamer:scan`（sync，仅普通文件 + `localeCompare` 排序 + 5000 条截断）、`apply`/`undo`（task，逐条原子 rename，单条失败不中断）、`config`/`set-dir`（sync，settings `lastDir` 记忆）
- 规则六项（作用顺序）：删除字符 → 查找替换（正则支持 `$1`–`$9`）→ 大小写 → 序号 → 日期 → 扩展名；「序号」按勾选列表顺序编号，「日期」支持 mtime/统一 now
- 名称校验：Windows 保留字符、保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）、≤255 UTF-8 字节、不以空格/点结尾；冲突判定含批内重复、未勾选占用、链式/交换
- 错误码 `FR_*`（DIR_NOT_FOUND / NO_FILES / NAME_INVALID / NAME_RESERVED / CONFLICT / RENAME_FAILED / TOO_MANY / CANCELLED）；无新增第三方依赖
- 字段级清单：`docs/spec/file-renamer.md`；冒烟：`docs/smoke/file-renamer.md`（R2 八类真实记录 + chunk 11.8KB gzip）
- **验收**：预览与执行一致（勾选/规则实时重算）、冲突不可执行、撤销可回退最近一次、R2 八类 smoke、gate 全绿

### 4.8 文本工具箱（M8，2026-11-18 R8 登记）

- **决策（用户拍板 2026-11-18）**：下一个功能 = 文本工具箱（`text-toolbox`）。范围锁定：**JSON 格式化/压缩/校验（含行列定位）、Base64 与 URL Component 编解码、正则测试与替换预览**；不做哈希、文本 diff、语法高亮
- 形态：**纯 renderer、零 IPC、零新增第三方依赖**（三 Tab：JSON / 编解码 / 正则）；纯函数集中在 `json.ts` / `encoding.ts` / `regex.ts`，错误码 `TT_*`（5 个 + UI 兜底 `TT_CLIPBOARD_FAILED`）
- 限制：单次文本 5MB（`TT_TEXT_TOO_LARGE`）；匹配收集上限 500、替换计数上限 10000；>200KB 先渲染「处理中」再分帧同步计算（满足 R4 加载态；无任务队列，取消豁免）
- **实现注记**：当前 `naive-ui@2.45.3` 构建下 `NTabPane` 内容不随页签切换重渲染、自闭合 pane 的 `tab` 文字渲染为空 —— 本工具改为「`NTabs` 仅作切换器 + 内容 `v-if` 渲染 + 页签走 `#tab` 插槽」；`image-toolbox` 存在同类页签文字空白的既有问题（M6 遗留，另行修复）
- 字段级清单：`docs/spec/text-toolbox.md`；冒烟：`docs/smoke/text-toolbox.md`（R2 八类映射 + chunk **8.6KB gzip**）
- **验收**：三 Tab 成功/失败分支单测齐全（46 tests，本包组覆盖率 80% 门禁全绿）、e2e 4/4、R2 八类映射、gate 全绿

### 4.9 Office 转 PDF 扩展（M9，2026-11-19 R8 登记）

- **决策（用户拍板 2026-11-19）**：下一个功能 = docx2pdf 扩展，范围锁定「xlsx/pptx → PDF + 批量转换队列」；不新增图片/PDF 输出格式、不做 PDF 合并
- 格式白名单扩至 `.doc/.docx/.xls/.xlsx/.ppt/.pptx`（`src/formats.ts` 单一来源；零依赖，避免 zod 进渲染层 chunk）；显示名由「Word 转 PDF」改为「Office 转 PDF」，工具 id/通道/包名**不变**
- 批量语义：单任务 `{ inputPaths: string[] }`（1..100，大小写不敏感去重），任务内**串行**逐文件转换；单文件失败记入 `failures` 并继续，全部失败抛首个结构化错误（保持单文件 [重试] 语义）；取消终止整批
- 结果：`done { outputs: {inputPath, outputPath}[], failures: {inputPath, code, message, detail?}[] }`；progress 改为 `locate(0/total) → convert(i+1/total) → done(total/total)`（不再单列 verify）
- 每文件独立工作子目录与 profile（`lumin-docx2pdf-<taskId>/f<序号>`），同名基名不同扩展名顺序落盘自动 `(1)` 后缀
- 字段级清单：`docs/spec/docx2pdf.md`（M9 章节）；冒烟：`docs/smoke/docx2pdf.md`；fixture 新增 `表格样例.xlsx`、`演示样例.pptx`
- **验收**：批量/去重/上限/部分失败/全失败/取消单测覆盖；e2e 真实转换 docx+xlsx+pptx 混合批次；gate 全绿；chunk 复测 gzip < 200KB

### 4.10 发布体积优化（M10，2026-11-19 R8 登记）

- **决策（用户拍板 2026-11-19）**：v0.9.0 安装包体积过大（解包 928.7MB / setup 290.1MB / portable 260.7MB），采用「全面瘦身」方案；**不改随包捆绑策略**（不改为运行时按需下载），首次使用不需要联网
- 三项措施与依据：
  1. **onnxruntime-node 只保留 win32-x64 原生库**：该包自带全平台二进制（darwin 86.8MB + linux 70.5MB + win32-arm64 70.6MB），`electron-builder.yml` `files` 取反排除，省 ≈227.9MB
  2. **Electron 语言包只保留 `zh-CN`/`en-US`**：`electronLanguages` 裁剪其余 50+ 语言，省 ≈44MB
  3. **移除 `ffprobe.exe`**（随包 ≈78.8MB）：图片元信息改由 `ffmpeg -hide_banner -i <file>` stderr 解析（`parseFfmpegStream` 纯函数 + 单测）；`scripts/fetch-binaries.mjs` 同步删除该资产；视频下载链路只用 ffmpeg 合流，不受影响
- 维护约束：后续新增/升级依赖若再随包**全平台原生库或语言资源**，必须在 `pnpm dist` 后复测体积，并把数字记入 `docs/smoke/shell.md`
- **实测（2026-11-19，`pnpm dist`）**：解包 928.7MB → **574.2MB**；setup 304.2MB → **203.6MB**（-33%）；portable 260.7MB → **187.0MB**（-28%）。打包产物核对：`app.asar.unpacked/.../onnxruntime-node/bin/napi-v6` 只剩 `win32/x64`；`locales` 只剩 `en-US.pak`/`zh-CN.pak`；`resources/binaries/download` 只剩 `ffmpeg.exe`/`yt-dlp.exe`
- **验收**：`pnpm dist` 实测新体积；打包版 OCR（onnxruntime CPU EP）与图片工具 probe/resize 可用；gate 全绿

### 4.11 PDF 图片转换（M11，2026-11-19 R8 登记）

- **决策（用户拍板 2026-11-19）**：新增 `pdf-images` 工具，一包两用——**PDF 逐页转图片（PNG/JPG）+ 多图按序合成 PDF**；不做 PDF 加密/解密、合并/拆分（exam-split 范围）、图片压缩/转换（image-toolbox 范围）
- 通道：`pdf-info` / `config` / `set-output-dir` 同步；`pdf-to-images` / `images-to-pdf` 走 worker 三段式任务（`?modulePath` + `runTask`，10 分钟超时，取消 terminate）
- 渲染复用：新增 `node-kit/pdf`（pdfjs-dist legacy + `@napi-rs/canvas`，`openPdf` / `renderPageToCanvas` / `encodeCanvas`），**与 exam-split 共用**；公共纯函数上提 `shared/naming.ts`（`baseName` / `uniqueFileName`）与 `shared/ranges.ts`（页码解析），工具内不再重复实现
- 合并语义：png/jpg 直嵌 `pdf-lib`；webp/bmp/tiff/avif/gif 经 ffmpeg `-frames:v 1` 转 PNG；页面模式 `auto`（跟随图片）/ `a4`（等比 contain + 0–50mm 边距）；单图失败记入 `failures` 不中断整批
- 命名：`{PDF 基名}_p{页码}.{png|jpg}` / `{首图基名}_合并.pdf`，冲突 `{base} ({n})`；输出目录记忆 `userData/pdf-images-output`
- 限制：页码 `1-3,5`（留空=全部页）、DPI 72/150/300、图片 1–200 张；错误码 `PI_*` 12 个
- 字段级清单：`docs/spec/pdf-images.md`；冒烟：`docs/smoke/pdf-images.md`（R2 八类真实记录 + chunk **7,825 B gzip**）；e2e `apps/desktop/e2e/pdf-images-smoke.spec.ts` **5/5**
- **验收**：单测 + e2e 覆盖两向转换/部分失败/取消/加密/占用/ACL；R2 八类全过；chunk < 200KB gzip；gate 全绿

### 4.13 文件哈希校验（M13，2026-11-19 R8 登记）

- **决策**：新增 `file-hasher` 工具，批量计算 **MD5 / SHA-1 / SHA-256**（可多选，默认 SHA-256）+ 粘贴期望哈希比对；不做目录递归、导出文件（无保存对话框，改复制 TSV）、SHA-512、i18n
- 通道：`config` / `set-config` 同步（算法记忆 `settings.algorithms`）；`hash` 走 worker 三段式任务（`?modulePath` + `runTask`，30 分钟超时，取消 terminate）
- 计算语义：逐文件顺序处理；单文件**一次读流**同时喂多个 `createHash`；64KB 粒度推字节进度；单文件失败（不存在/目录/超 20GB/占用/ACL）记入 `results` 不中断整批
- 边界：单次 1–200 文件、单文件 20GB、批量任务 30 分钟；错误码 `FH_FILE_INVALID` / `FH_HASH_FAILED` / `FH_INVALID_PAYLOAD`（取消由壳统一 `CANCELLED`）
- 公共代码：`shared/number.ts` 增 `formatBytes`（B/KB/MB/GB，1 位小数）；比对/归一为 renderer 纯函数，不进 IPC；零新增第三方依赖（`node:crypto` + `node:fs`）
- 字段级清单：`docs/spec/file-hasher.md`；冒烟：`docs/smoke/file-hasher.md`（R2 八类真实记录 + chunk **8,854 B gzip**）；e2e `apps/desktop/e2e/file-hasher-smoke.spec.ts` **7/7**
- **验收**：单测 36/36（含 80% 包覆盖率阈值）；e2e 覆盖三算法向量/中文空格路径/逐项失败/取消/并发/强杀恢复；R2 八类全过；chunk < 200KB gzip；gate 全绿

### 4.14 音视频处理（M14，2026-11-19 R8 登记）

- **决策（用户拍板 2026-11-19）**：新增 `media-convert` 工具，四 Tab —— **转码（mp4/webm/mkv）**、**片段截取（精确重编码 / 快速流复制）**、**提取音频（mp3/m4a/wav/flac/ogg）**、**压缩（高中低三档 + 分辨率上限）**；不做视频剪辑拼接、字幕、GIF、批量并发（同批次串行）
- 形态：复用 `binaries/download/ffmpeg.exe`（fetcher 固定 URL + SHA256），**零新增第三方依赖**；工具包 `manifest.ts` + `src/schema.ts`/`errors.ts`/`media.ts`/`encode.ts`/`naming.ts`/`node.ts` + `renderer/`
- 通道：`probe` / `config` / `set-output-dir` 同步（`ffmpeg -hide_banner -i` stderr 解析时长与首条音视频流，不依赖 ffprobe）；`process` 走壳三段式任务（`-progress pipe:1 -nostats` 解析 `out_time_us`，单文件超时 30 分钟，取消杀进程树）
- 批量语义：单批 1–50 文件、单文件 ≤ 4GB；任务内**串行**逐文件处理，单文件失败记入 `failures` 不中断批次；取消不记失败项，已完成文件保留
- 命名：`{stem}.{ext}` / `{stem}.cut_HHMMSS-HHMMSS.mp4` / `{stem}.audio.{ext}` / `{stem}.c{high|medium|low}.mp4`，冲突经 `shared.uniqueFileName` 递增；输出目录记忆 `settings.outputDir`（默认 `userData/media`）
- 错误码 `MC_*` 10 个（ENGINE_MISSING / FILE_UNSUPPORTED / FILE_CORRUPT / PROBE_FAILED / NO_STREAM / PARAM_INVALID / OUTPUT_WRITE_FAILED / TIMEOUT / NO_FILES / CANCELLED）；可重试：CORRUPT / PROBE_FAILED / OUTPUT_WRITE_FAILED / TIMEOUT
- 字段级清单：`docs/spec/media-convert.md`；冒烟：`docs/smoke/media-convert.md`（R2 八类映射 + chunk **37,526 B raw / 9,962 B gzip**）；e2e `apps/desktop/e2e/media-convert-smoke.spec.ts`（7 用例，本机缺 ffmpeg 时整组 skip）
- **验收**：单测 72/72（本包 80% 覆盖率阈值全绿）；四模式参数/命名/失败分类/取消/超时/磁盘满/进度节流单测覆盖；chunk < 200KB gzip；gate 全绿

### 4.15 PDF 工具集（M15，2026-11-19 R8 登记）

- **决策（用户拍板 2026-11-19）**：新增 `pdf-toolkit` 工具，六 Tab —— **合并（2–100）**、**拆分（每区间一文件）**、**删页（至少留 1 页）**、**旋转（90/180/270 可选页）**、**重排（1..N 全排列）**、**元数据（Title/Author/Subject/Keywords）**；不复做 PDF↔图片（pdf-images）、裁剪与 OCR（exam-split）
- 形态：复用 `pdf-lib`（与 pdf-images/exam-split 同库，工具间零 import）；页面范围解析/基名/冲突重命名统一取自 `@lumin/shared` 与 `@lumin/node-kit`，**零新增第三方依赖**
- 通道：`pdf-toolkit:info` 同步（页数 + 元数据快照）；`merge` / `split` / `delete` / `rotate` / `reorder` / `metadata` 六个 worker 三段式任务（`?modulePath` + `runTask`，120 秒超时，取消 terminate）
- 语义：单一输入文档串行处理；产物写源文件同目录，冲突 `{base} (n)`；写入后校验 `%PDF-` 头；加密/占用/损坏/越界/非全排列分别给出结构化错误
- 边界：页码 `1-3,5`（旋转留空 = 全部页）；元数据单字段 ≤500 字符、至少一项非空；错误码 `PT_*` 10 个（可重试：LOCKED / CORRUPT / RANGE_INVALID / ORDER_INVALID / OUTPUT_WRITE_FAILED / TIMEOUT / OP_FAILED）
- 字段级清单：`docs/spec/pdf-toolkit.md`；冒烟：`docs/smoke/pdf-toolkit.md`；e2e `apps/desktop/e2e/pdf-toolkit-smoke.spec.ts`
- **验收**：单测与包覆盖率 ≥80%；e2e 覆盖六操作/中文空格路径/损坏/占用/取消/并发/R2 八类；chunk < 200KB gzip；gate 全绿

### 4.16 二维码工具（M16，2026-11-19 R8 登记）

- **决策（用户拍板 2026-11-19）**：新增 `qr-code` 工具，两 Tab —— **生成（文本/网址/WiFi/vCard 3.0，纠错 L/M/Q/H、128–2048px、边距 0–10、前景/背景色、PNG/SVG）**、**识别（本地图片 → canvas → jsQR）**；不做批量、摄像头扫码与 Logo 嵌入
- 形态：`packages/tools/qr-code`；生成与解码都在 renderer（`qrcode@1.5.4` + `jsqr@1.4.0`），主进程只做输出目录记忆与原子写盘（临时文件 + rename），**无三段式长任务**
- 通道：`config` / `set-output-dir` / `save` 三条同步；`save` zod 校验 → 文件名清洗（非法字符/路径穿越）→ 冲突 `(n)` → 原子写盘；识别图片上限 20MB，错误码 `QR_*` 8 个（可重试：OUTPUT_WRITE_FAILED）
- 字段级清单：`docs/spec/qr-code.md`；冒烟：`docs/smoke/qr-code.md`（R2 八类映射 + chunk **372,970 B raw / 88,831 B gzip**）；e2e `apps/desktop/e2e/qr-code-smoke.spec.ts`（5 用例）
- **验收**：本包覆盖率 ≥80%；e2e 覆盖生成/保存/识别闭环/损坏图/超大图/ACL 不可写/并发保存；chunk < 200KB gzip；gate 全绿

### 4.17 PDF 水印与页码（M17，2026-11-19 R8 登记）

- **决策（用户拍板 2026-11-19）**：在既有 `pdf-toolkit` **扩展两 Tab**（不新建包），**水印**（文字/图片、透明度 5–100%、角度 -90–90、大小 5–50% 页宽、平铺、页码范围）与**页码**（6 向位置、起始页、4 预设 + 自定义模板 `{n}`/`{total}`、字号 8–32、颜色 `#rrggbb`、边距 12–72pt、页码范围）
- 形态：**零新增第三方依赖**；文字水印由 renderer Canvas 栅格化为透明 PNG（`Microsoft YaHei`，支持中文），主进程统一按 PNG/JPG 嵌入并 `drawImage`（单张绕中心旋转、平铺步长 1.8×尺寸）；页码用 pdf-lib 标准字体 Helvetica 绘制
- 通道：`pdf-toolkit:watermark` / `pdf-toolkit:page-numbers` 两个 worker 三段式任务，复用 `runTask`（120 秒超时、取消 terminate）、预检与写后 `%PDF-` 校验
- 语义：产物同目录 `{base}_水印.pdf` / `{base}_页码.pdf`，冲突 `(n)`；页码 `n = 页码 - startPage + 1`，`{total}` = 文档总页数，`ranges` 与 `startPage` 交集为空 → `PT_PAGE_NUMBER_INVALID`；页码模板仅 ASCII 且必须含 `{n}`（标准字体限制，schema 拦截并非 ASCII → `INVALID_PAYLOAD`）
- 边界：水印文字 ≤200 字、栅格化 PNG base64 ≤4MB、图片仅 `.png/.jpg/.jpeg`；页面自带 90/270 旋转不额外补偿；新增错误码 `PT_WATERMARK_INVALID` / `PT_PAGE_NUMBER_INVALID`（均不可重试）
- 字段级清单：`docs/spec/pdf-toolkit.md`；任务单：`docs/spec/pdf-toolkit-m17-tasks.md`；冒烟：`docs/smoke/pdf-toolkit.md`（chunk **55,864 B raw / 12,198 B gzip**）；e2e `apps/desktop/e2e/pdf-toolkit-smoke.spec.ts`（8 用例）
- **验收**：本包覆盖率 ≥80%；e2e 覆盖水印文字/平铺/冲突递增/图片缺失与损坏、页码模板/起始页/中文模板拦截；R2 八类映射；gate 全绿

### 4.18 重复文件查找（M18，2026-11-19 R8 登记）

- **决策（用户拍板 2026-11-19）**：新增 `duplicate-finder` 工具，单页面 —— 选择目录（可含子目录）+ 最小文件大小（1KB/100KB/1MB/10MB，默认 1MB）→ 扫描 → 重复组（路径/大小/修改时间/可释放空间）→ 默认每组保留最早一份 → 定位 / 移入回收站；不做多根扫描、扩展名过滤、永久删除、文件内容对比
- 形态：`packages/tools/duplicate-finder` + `src/schema.ts`/`errors.ts`/`contract.ts`/`scan.worker.ts`/`node.ts` + `renderer/`；**零新增第三方依赖**（`node:fs` + `node:crypto`）
- 通道：`config` / `set-config` 同步（记忆目录与选项）；`scan` 走 worker 三段式任务（`?modulePath` + `runTask`，15 分钟超时，取消 terminate）；壳新增通用通道 `lumin:shell:trash`（`shell.trashItem`，单批 ≤200，逐条容错）与 bridge `trashPaths`
- 语义：大小分组 → 仅同 size ≥2 的组做 64KB 前缀 SHA-256 预筛（`size ≤64KB` 时前缀即全量）→ 全量 SHA-256 确认；单文件 stat/读取失败计入 `skipped` 不中断；单次扫描上限 20 万文件；结果按 `wastedBytes` 降序
- 边界：跳过符号链接；回收站删除不可恢复（二次确认）；错误码 `DF_INVALID_PAYLOAD` / `DF_ROOT_INVALID` / `DF_TOO_MANY_FILES` / `DF_SCAN_FAILED`（可重试：ROOT_INVALID / SCAN_FAILED）
- 字段级清单：`docs/spec/duplicate-finder.md`；冒烟：`docs/smoke/duplicate-finder.md`；e2e `apps/desktop/e2e/duplicate-finder-smoke.spec.ts`
- **验收**：本包覆盖率 ≥80%；e2e 覆盖页面三态/扫描分组/阈值/非递归/根目录非法/取消/并发/强杀恢复；R2 八类映射；chunk < 200KB gzip；gate 全绿

### 4.19 深色主题切换（M19，2026-11-19 R8 登记）

- **决策（用户拍板 2026-11-19）**：壳级平台能力，无新工具包；三模式 `system | light | dark`（默认跟随系统），设置页单选即时生效并持久化；不做单工具主题、自定义配色、`nativeTheme.themeSource` 强制改写
- **tokens 单源**：`apps/desktop/src/renderer/src/assets/main.css` 新增 `:root[data-theme='dark']` 覆盖全部颜色变量（并补齐 `--lumin-color-warning/-error/-success/-primary-soft`）；圆角/间距/字号两主题共用；Naive 覆盖仍只在 theme 配置层，`buildThemeOverrides` 从 `getComputedStyle` 读取 token 计算值（Naive 内部无法解析 `var()`）
- **状态链路**：新增 `theme/theme.ts`（`parseThemeMode`/`resolveTheme`/`applyThemeAttribute` 纯函数）、`theme/naive.ts`（token → overrides 映射）、`stores/theme.ts`（读取/持久化/`matchMedia('(prefers-color-scheme: dark)')` 监听）；`main.ts` 先 `load()` 再挂载防闪烁；主进程按持久化模式 + `nativeTheme.shouldUseDarkColors` 设 `backgroundColor`（暗 `#0b1220`/亮 `#f8fafc`）
- **持久化**：复用既有 `lumin:settings:get/set`，键 `shell.theme.mode`；非法存量回落 `system`；写入失败回滚并就地提示；**不新增 IPC**
- **边界**：PDF/图片预览画布保持白底（内容属性）；工具代码零改动；跟随系统仅在 `system` 模式响应 `change`
- 字段级清单：`docs/spec/theme-dark.md` + `docs/spec/theme-dark-tasks.md`；冒烟：`docs/smoke/theme-dark.md`；e2e `apps/desktop/e2e/theme-smoke.spec.ts`
- **验收**：theme 纯函数覆盖率 ≥80%；e2e 覆盖跟随系统一致性/深浅切换（`data-theme` + token 计算值）/重启持久化；R2 八类映射；零新增依赖；gate 全绿

### 4.20 图片文字识别（M20，2026-11-19 R8 登记）

- **决策（用户拍板 2026-11-19）**：新增 `@lumin/tool-ocr-text`（「图片文字识别」）——单张图片（PNG/JPG/WebP，含截图）→ PP-OCR 识别 → 可编辑文本预览 → 复制到剪贴板 / 导出 TXT；不做批量、不做 PDF 输入（PDF 走 exam-split）、不做翻译/排版还原
- **公共代码上提（AGENTS §2.2）**：OCR 引擎（`preproc`/`post`/`model`/`render`/`assets`/错误码）原样搬移根 `packages/ocr-kit`；`exam-split` 的 `ocr-*.ts` 改为薄壳 re-export（`PDF_RENDER_SCALE` 包装保持 1.5），行为零回归；`writeAtomic`/`AtomicFs` 上提 `node-kit`（qr-code 改 re-export）
- **IPC（4 通道）**：`ocr-text:config`（输出目录记忆，缺省 `userData/ocr-text`）、`ocr-text:recognize`（三段式任务，`runTask` + worker，120s 超时、可取消）、`ocr-text:save-txt`（同步原子写盘）、`ocr-text:cancel` 走壳通用 `lumin:task:cancel`
- **输出命名**：`{原名}-OCR.txt`，同目录冲突走 `resolveConflictPath` 递增 `(n)`；导出目录经壳 `lumin:shell:pick-directory` 选择并记忆
- **边界**：单图 ≤20MB；文本上限 1,000,000 字；识别 0 行 → `OCR_NO_TEXT`；图片损坏/非图片 → `OCR_INPUT_INVALID`；占用 → `OCR_FILE_LOCKED`；模型缺失 → `MODEL_MISSING`
- **错误码**：`OCR_INVALID_PAYLOAD / OCR_FILE_NOT_FOUND / OCR_FILE_LOCKED / OCR_IMAGE_TOO_LARGE / OCR_INPUT_INVALID / OCR_NO_TEXT / MODEL_MISSING / OCR_FAILED / OP_TIMEOUT / OUTPUT_WRITE_FAILED / CANCELLED`；`ocr-kit` 的 `PDF_*` 码在工具边界归一为图片语义
- **UI 三态（AGENTS §5.3）**：空态拖拽/选择图片；加载态进度 + 取消；报错态结构化文案 + 重试/详情；结果态缩略图 + 可编辑文本框 + 行/字数统计 + 复制 / 导出 TXT
- **图标**：`@lucide/vue` `scan-text`
- **验收**：本包与 `ocr-kit` 覆盖率 ≥80%；e2e `apps/desktop/e2e/ocr-text-smoke.spec.ts` 3/3；R2 八类映射；chunk < 200KB gzip；零新增第三方依赖；gate 全绿

### 4.21 图片批量水印（M21，2026-11-20 R8 登记）

- **决策（用户拍板 2026-11-20）**：新增 `@lumin/tool-image-watermark`（「图片批量水印」）——多选图片批量叠加文字/图片水印；不做 PDF 水印（pdf-toolkit）、不做转码/缩放（image-toolbox）、不做多水印叠加与模板库
- **引擎**：复用既有 `@napi-rs/canvas@1.1.1`（中文水印字体复用 `@lumin/node-kit/pdf` 的 `ensureCjkFont`），worker 内逐张解码 → 画布绘制 → 原格式编码（png/jpeg q90/webp q90）→ `.tmp` + rename 原子写；**零新增第三方依赖**
- **布局纯函数**：`contract.ts` 单一真相源（短边百分比、九宫格锚点、旋转包围盒、平铺步长 1.6×/2.0×、点数上限 2000、旋转归一、命名 `{原名}_水印`、扩展名 → 编码器），renderer 预览与 worker 出图共用
- **IPC（3 通道）**：`image-watermark:config` / `image-watermark:set-output-dir`（目录记忆，缺省 `userData/image-watermark`）/ `image-watermark:watermark`（三段式任务，`runTask` + worker，600s 超时、可取消）；取消走壳通用 `lumin:task:cancel`
- **容错**：单张失败记入 `failures` 不中断整批；全部失败抛首个结构化错误；预检（存在/占用/40MB）在 `node.ts`，水印图缺失/超 5MB 分别归 `IW_WATERMARK_MISSING` / `IW_WATERMARK_INVALID`
- **错误码**：`IW_INVALID_PAYLOAD / IW_INPUT_INVALID / IW_FILE_LOCKED / IW_IMAGE_TOO_LARGE / IW_IMAGE_CORRUPT / IW_WATERMARK_MISSING / IW_WATERMARK_INVALID / IW_OUTPUT_DIR_INVALID / IW_WRITE_FAILED / IW_PROCESS_FAILED / OP_TIMEOUT / CANCELLED`
- **UI 三态（AGENTS §5.3）**：空态 DropZone 多选；加载态逐张进度 + 取消；报错态结构化文案 + 重试/返回；结果态成功/失败分组 + 打开目录；第一张图 Canvas 参数化预览（防抖 200ms）
- **图标**：`@lucide/vue` `stamp`（壳 iconMap 注册 `Stamp`）
- **验收**：本包覆盖率 ≥80%（contract/schema/errors/node/worker/client）；e2e `apps/desktop/e2e/image-watermark-smoke.spec.ts` 2/2；R2 八类映射；chunk 21,132 B gzip（raw 90,487 B）；零新增第三方依赖；gate 全绿

### 4.22 图片拼接（M22，2026-11-20 R8 登记）

- **决策（用户拍板 2026-11-20）**：新增 `@lumin/tool-image-stitch`（「图片拼接」）——多选图片拼成单张长图/网格图；不做自由画布拖拽排版、不做水印（image-watermark）、不做转码/压缩（image-toolbox）
- **引擎**：复用 `@napi-rs/canvas@1.1.1`；worker 两遍处理（先量尺寸 → 再逐张绘制）→ 一次编码 → `.tmp` + rename 原子写；**零新增第三方依赖**
- **布局纯函数**：`contract.ts` 的 `planLayout` 为单一真相源（纵向统一宽、横向统一高、网格等宽单元格 contain 居中；间距/外边距/基准尺寸），renderer 预览与 worker 出图共用
- **上限**：输出单边 ≤30,000 px 且总像素 ≤1 亿（超限 `IS_OUTPUT_TOO_LARGE`）；网格列数 2–8；间距/外边距 0–100 px；固定基准尺寸 100–10,000 px
- **IPC（3 通道）**：`image-stitch:config` / `image-stitch:set-output-dir`（目录记忆，缺省 `userData/image-stitch`）/ `image-stitch:stitch`（三段式任务，`runTask` + worker，600s 超时、可取消）
- **命名**：`拼接_{yyyyMMdd-HHmmss}.{ext}`，冲突 `(n)` 递增，绝不覆盖既有文件
- **错误码**：`IS_INVALID_PAYLOAD / IS_INPUT_INVALID / IS_FILE_LOCKED / IS_IMAGE_TOO_LARGE / IS_IMAGE_CORRUPT / IS_OUTPUT_TOO_LARGE / IS_OUTPUT_DIR_INVALID / IS_WRITE_FAILED / IS_PROCESS_FAILED / OP_TIMEOUT / CANCELLED`
- **UI 三态（AGENTS §5.3）**：空态 DropZone 多选；加载态两阶段（量尺寸/绘制）进度 + 取消；报错态结构化文案 + 重试/返回；结果态尺寸与路径 + 打开目录 + 再拼一次；布局缩略预览（防抖 200ms）
- **图标**：`@lucide/vue` `layout-grid`（壳 iconMap 注册 `LayoutGrid`）
- **验收**：本包覆盖率 ≥80%；e2e `apps/desktop/e2e/image-stitch-smoke.spec.ts` 2/2；R2 八类映射；chunk < 200KB gzip；零新增第三方依赖；gate 全绿

### 4.23 磁盘空间分析（M23，2026-11-20 R8 登记）

- **决策（用户拍板 2026-11-20）**：新增 `@lumin/tool-disk-analyzer`（「磁盘空间分析」）——选择目录后递归扫描，按**直接子项**展示占用（子目录含后代汇总、文件单项），大小降序 + 占比条 + 逐级下钻；只读分析，**绝不修改/删除任何文件**
- **形态**：`packages/tools/disk-analyzer` + `src/schema.ts`/`errors.ts`/`contract.ts`/`scan.worker.ts`/`node.ts` + `renderer/`；**零新增第三方依赖**（`node:fs`）
- **IPC（3 通道）**：`disk-analyzer:config` / `disk-analyzer:set-config` 同步（记忆目录与显示阈值）；`disk-analyzer:scan` 走 worker 三段式任务（`?modulePath` + `runTask`，15 分钟超时，取消 terminate）；下钻 = 以子目录为 root 再发一次扫描
- **扫描语义**：迭代栈遍历（不跟随符号链接），每个直接子目录递归汇总 `size`/`fileCount`；单文件 stat 失败计入 `skipped` 不中断；单次扫描普通文件上限 20 万；根目录不可读 → `DA_ROOT_INVALID`（可重试）
- **显示**：最小文件阈值 0/1KB/100KB/1MB（默认 0）仅过滤文件行，目录行始终展示且大小含全部后代；单层最多展示前 100 项（其余折叠为「其余 N 项 · 共 X」）；面包屑逐级返回
- **错误码**：`DA_INVALID_PAYLOAD / DA_ROOT_INVALID / DA_TOO_MANY_FILES / DA_SCAN_FAILED`（可重试：ROOT_INVALID / SCAN_FAILED）
- **UI 三态（AGENTS §5.3）**：空态目录选择引导；加载态已扫描文件数 + 取消；报错态结构化文案 + 重试/详情；结果态汇总 + 面包屑 + 占用列表
- **图标**：`@lucide/vue` `hard-drive`（壳 iconMap 注册 `HardDrive`）
- **验收**：本包覆盖率 ≥80%；e2e `apps/desktop/e2e/disk-analyzer-smoke.spec.ts` 2/2；R2 八类映射；chunk < 200KB gzip；零新增第三方依赖；gate 全绿

### 4.24 文件夹对比（M24，2026-11-20 R8 登记）

- **决策（用户拍板 2026-11-20）**：新增 `@lumin/tool-folder-compare`（「文件夹对比」）——左右两个目录各自递归扫描文件，按**相对路径**配对，比较**文件元数据**（大小 + 修改时间）；只读对比，**绝不修改/删除任何文件**；**不读取文件内容、不计算哈希**（内容级判断归 `file-hasher` / `duplicate-finder`）
- **形态**：`packages/tools/folder-compare` + `src/schema.ts`/`errors.ts`/`contract.ts`/`compare.worker.ts`/`node.ts` + `renderer/`；**零新增第三方依赖**（`node:fs`）
- **IPC（3 通道）**：`folder-compare:config` / `folder-compare:set-config` 同步（记忆左右目录与「比较修改时间」开关）；`folder-compare:compare` 走 worker 三段式任务（`?modulePath` + `runTask`，15 分钟超时，取消 terminate）
- **比对语义**：两侧迭代栈遍历（不跟随符号链接），相对路径统一 `/` 分隔、大小写不敏感配对（展示保留原样）；**仅比较文件**，目录仅用于遍历不参与配对；修改时间容差 2s（`MTIME_TOLERANCE_MS`，避免文件系统精度误报）；结果分类 仅左侧 / 仅右侧 / 有差异（大小不同、时间不同、两者）/ 相同；单侧普通文件上限 20 万 → `FC_TOO_MANY_FILES`；结果条目上限 20,000，其余以 `truncated` 计数返回
- **展示**：四计数汇总（仅左侧/仅右侧/有差异/元数据相同）+ 状态筛选（全部/有差异/仅左侧/仅右侧/相同）+ 相对路径关键字过滤；单页最多展示 500 条并提示折叠数；行内左右大小与时间、两侧「定位」按钮
- **错误码**：`FC_INVALID_PAYLOAD / FC_ROOT_INVALID / FC_TOO_MANY_FILES / FC_COMPARE_FAILED`（可重试：ROOT_INVALID / COMPARE_FAILED；ROOT_INVALID 的 detail 标明左侧/右侧）
- **UI 三态（AGENTS §5.3）**：空态左右目录选择引导 + 交换按钮；加载态两侧扫描进度 + 取消；报错态结构化文案 + 重试/详情；结果态汇总 + 筛选 + 差异列表
- **图标**：`@lucide/vue` `git-compare`（壳 iconMap 注册 `GitCompare`）
- **验收**：本包覆盖率 ≥80%；e2e `apps/desktop/e2e/folder-compare-smoke.spec.ts` 2/2；R2 八类映射；chunk < 200KB gzip；零新增第三方依赖；gate 全绿

### 4.25 压缩包工具（M25，2026-11-20 R8 登记）

- **决策（用户拍板 2026-11-20）**：新增 `@lumin/tool-zip-tool`（「压缩包工具」）——ZIP 打包 / 解压双模式；离线、纯本机；**新增第三方依赖 `fflate@0.8.3`**（纯 JS、MIT、无原生，经 `npm view` 复核并登记 §1.1）
- **形态**：`packages/tools/zip-tool` + `src/schema.ts`/`errors.ts`/`contract.ts`/`archive.ts`/`archive.worker.ts`/`node.ts` + `renderer/`
- **IPC（4 通道）**：`zip-tool:config` / `zip-tool:set-config` 同步（记忆模式/源列表/输出目录与文件名/压缩包/目标目录/冲突策略）；`zip-tool:pack` 与 `zip-tool:unpack` 走 worker 三段式任务（`?modulePath` + `runTask`，900s，取消 terminate）
- **打包语义**：源为文件 → 条目名 = 文件名；源为目录 → 条目名 = `{目录名}/{相对路径}`（保留相对结构）；不跟随符号链接、跳过非常规条目；条目名统一 `/` 分隔、UTF-8 标志；单次条目上限 10 万；同名条目冲突自动 `(1)` 递增；产物路径 = 输出目录 + 文件名（冲突递增，绝不覆盖既有文件）
- **解压语义**：仅 `.zip`；流式解压逐条落盘；**zip slip 防护**（拒绝绝对路径、盘符、`..` 段，非法条目跳过并计数）；拒绝符号链接条目（跳过并计数）；条目上限 10 万、解压总大小上限 10GB（超限 → `ZP_ARCHIVE_TOO_LARGE`）；同名冲突策略：`rename`（默认，`{名} (1){扩展名}` 递增）/ `skip`（跳过并计数），**不提供覆盖**
- **展示**：双 Tab（打包 / 解压）；打包源列表（拖拽 + 添加文件夹，去重、≤200 项）、输出目录 + 文件名；解压压缩包（拖拽 `.zip`）、目标目录（默认压缩包同目录同名文件夹）、冲突策略；进度 = 已完成条目 / 总条目 + 阶段；结果卡片展示文件数/目录数/字节数/跳过数/重命名数/耗时 + 定位按钮
- **错误码**：`ZP_INVALID_PAYLOAD / ZP_SOURCE_INVALID / ZP_ARCHIVE_INVALID / ZP_TARGET_INVALID / ZP_TOO_MANY_ENTRIES / ZP_ARCHIVE_TOO_LARGE / ZP_TASK_FAILED`（可重试：SOURCE_INVALID / ARCHIVE_INVALID / TARGET_INVALID / TASK_FAILED）
- **UI 三态（AGENTS §5.3）**：空态双 Tab 引导；加载态条目进度 + 取消；报错态结构化文案 + 重试/详情
- **图标**：`@lucide/vue` `archive`（壳 iconMap 注册 `Archive`）
- **验收**：本包覆盖率 ≥80%；e2e `apps/desktop/e2e/zip-tool-smoke.spec.ts` 2/2（UI 打包→解压回读；IPC zip slip 拒绝 / 非法 zip / 计数）；R2 八类映射；chunk（含 fflate）< 200KB gzip；gate 全绿

### 4.26 侧边栏分类分组（M26，2026-11-20 R8 登记）

- **决策（用户拍板 2026-11-20）**：侧边栏工具过多（21 项），按分类折叠分组展示
- **分类知识归属**：`ToolManifest` 新增必填字段 `category`（`plugin-api` 导出 `TOOL_CATEGORIES` 七类：`compute/text/image/document/media/file/misc`），由各工具 manifest 自行声明——壳零工具知识（AGENTS §2.1），新增工具仍只需「新包 + 清单 1 行」
- **壳侧**：`layout/sidebar-groups.ts` 纯函数按固定分类序 + 组内 `order` 升序分组；`AppSidebar.vue` 渲染分组头（分类名 + 数量）并实现**手风琴折叠**——默认全部折叠，展开某分类时其余分类自动收起（状态仅存会话内）；分类标签走 `zh-CN` i18n；侧边栏改 `overflow-y-auto`
- **验收**：`sidebar-groups` 单测 3 例 + `plugin-api` 清单 schema 拒绝未知分类；e2e 统一走 `e2e/sidebar.ts` 的 `clickSidebarTool`（先展开所属分类再点击）；IPC 冒烟 6/6；gate 全绿


---

## 5. 项目规则采纳（Q17=B）与 CI 门禁

### 5.1 精选 8 份 → AGENTS.md（已生成于根目录）

| 源文件                                               | 落入 AGENTS.md 章节                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| skills-git                                           | Git 规范（main 只读 MR、提交前缀、语义化 Tag、CHANGELOG 从 M0 起）  |
| skills-qa-test-engineer                              | 测试与门禁（覆盖阈值、IPC 冒烟、smoke.md 异常清单）                 |
| skills-devops-sre-engineer                           | CI/安全（frozen-lockfile、secrets、SHA 钉死、allowDowngrade=false） |
| skills-frontend-architect + skills-frontend-engineer | 目录锁死、TS strict、样式收口、依赖治理                             |
| skills-chief-architect + skills-cto                  | 架构铁律、性能基线、技术债务底线                                    |
| skills-uiux-designer                                 | 三态强制、design tokens 单源、图标体系                              |

未采纳（与本项目无关）：DBA、小程序、RN、移动端、后端分布式、Party A/终端用户（角色扮演类）；`skills-prompt-ai-lead.md` 为 0 字节空文件。

### 5.2 CI 门禁（Gitee Go，MR 触发）

```
MR 门禁：lint → typecheck → test（含 IPC 冒烟）→ pnpm audit（无 high/critical）
          → dependency-cruiser 边界检查
          全绿才可合入；tag 触发：fetch-binaries → electron-builder → Release 上传
```

- 环境锁死：`packageManager` 锁 pnpm + `.nvmrc` 锁 Node；一律 `--frozen-lockfile`
- Gitee 发版 token 只进 CI secrets
- Windows 打包 runner 不可用时降级本地 `pnpm release`（兜底已预留）

### 5.3 更新与回滚

- electron-updater `provider: generic`；`latest.yml` + blockmap 放仓库 `updates/` 固定目录（gitee raw 固定 URL），安装包传 Gitee Release 资产（latest.yml 内写绝对地址）
- **M0 必须完成更新冒烟，不过不得进入 M1**（卡点）
- `allowDowngrade=false`；回滚 = 发新版覆盖

---

## 6. 里程碑

| 里程碑        | 内容                                                                                                                                                                                                                                                                                                                                            | 验收（含评审修订）                                                                      | 预估     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------- |
| **M0 骨架**   | workspace/Turbo/electron-vite 三端 HMR；侧边栏+动态路由；plugin-api/ipc-bus；安全基线；settings/log/taskQueue；**AGENTS.md/CI 门禁/CHANGELOG**；NSIS+portable 出包；**更新冒烟（卡点）**；**IPC 冒烟自动化（R3）**                                                                                                                              | `pnpm dev` 出窗口；invoke 全链路通；门禁全绿；build 出包；更新冒烟过                    | 2–3 天   |
| **M1 v0.1**   | 计算器 + 单位换算 + 单测                                                                                                                                                                                                                                                                                                                        | 覆盖 ≥80%；门禁绿                                                                       | 2–3 天   |
| **M2 v0.2**   | Word→PDF（三段定位+独立 profile+串行队列+按需下载组件）                                                                                                                                                                                                                                                                                         | 真实 docx 保真可接受；**功能清单先行（R8）**                                            | 4–6 天   |
| **M3a v0.3**  | 试卷切割 PDF（缩略图+拆/合/删/转/裁）                                                                                                                                                                                                                                                                                                           | 100 页拆分 <2s；smoke.md 8 类异常全过（R2）                                             | 3–4 天   |
| **M3b v0.3b** | OCR 切题（PP-OCR wasm+预览微调+导出）                                                                                                                                                                                                                                                                                                           | **10 份样卷命中 ≥90% 或微调 ≤1 次/题；≤3s/页（R1）**                                    | 4–6 天   |
| **M4 v0.4**   | 短视频下载（fetch-binaries+队列+进度/暂停/历史+自更新+免责）                                                                                                                                                                                                                                                                                    | B站/YouTube 真实下载成功；**免责文案定稿（R8）**                                        | 5–8 天   |
| **M5 发布**   | 更新端到端验证；Gitee Release 首发；README/许可/SmartScreen 指引。**2026-11-19 决策**：许可 MIT（新增 LICENSE + package.json license）；首发版本 v0.9.0（root/desktop 同步）；更新源落定 `https://gitee.com/Lateautumn00/lumin/raw/master/updates`；新增 `scripts/serve-updates.mjs`（`pnpm update:serve`）与 `docs/release/v0.9.0.md` 发布说明 | 旧版自动升新版（e2e 断言读 package.json 版本，不再硬编码）                              | 2–3 天   |
| **M6 v0.5**   | 图片工具箱（ffmpeg 复用：压缩/转换/缩放三 Tab，含 AVIF，gif→webp 动画）                                                                                                                                                                                                                                                                         | §4.6 验收；smoke 8 类全过（R2）；**字段级清单先行（R8）**                               | 3–5 天   |
| **M7 v0.6**   | 批量重命名（单目录非递归、六规则叠加、预览/冲突/撤销、5000 条截断）                                                                                                                                                                                                                                                                             | §4.7 验收；smoke 8 类全过（R2）；字段级清单先行（R8）                                   | 2–3 天   |
| **M8 v0.7**   | 文本工具箱（纯 renderer 三 Tab：JSON 格式化/压缩/校验、Base64/URL 编解码、正则测试与替换预览）                                                                                                                                                                                                                                                  | §4.8 验收；smoke 映射（R2）；字段级清单先行（R8）；chunk <200KB gzip                    | 0.5–1 天 |
| **M9 v0.8**   | Office 转 PDF 扩展（docx2pdf）：输入扩至 doc/xls/ppt 六种扩展名 + 批量队列（1..100、串行、失败不中断、结果汇总）                                                                                                                                                                                                                                | §4.9 验收；单测/e2e 覆盖批量；chunk <200KB gzip；smoke 增量记录                         | 0.5–1 天 |
| **M10 瘦身**  | 发布体积优化（§4.10，2026-11-19）：onnxruntime 仅 win32-x64 + Electron 语言包仅 zh-CN/en-US + 移除 ffprobe（改 `ffmpeg -i` 解析）                                                                                                                                                                                                               | §4.10 验收；`pnpm dist` 复测体积；打包版 OCR/图片工具可用                               | 0.5 天   |
| **M11 v1.1**  | PDF 图片转换（§4.11，2026-11-19）：PDF→图片（范围/DPI/PNG-JPG）+ 图片→PDF（200 张、auto/A4、边距）；`node-kit/pdf` 与 `shared/naming`、`ranges` 上提复用                                                                                                                                                                                        | §4.11 验收；e2e 5/5；R2 八类；chunk <200KB gzip；gate 全绿                              | 1–2 天   |
| **M13 v1.2**  | 文件哈希校验（§4.13，2026-11-19）：MD5/SHA-1/SHA-256 多选批算 + 期望哈希比对 + 复制 TSV + 失败项重试；`shared/number` 上提 `formatBytes`                                                                                                                                                                                                        | §4.13 验收；e2e 7/7；R2 八类；chunk 8,854 B gzip；gate 全绿                             | 0.5–1 天 |
| **M14 v1.3**  | 音视频处理（§4.14，2026-11-19）：转码（mp4/webm/mkv）/ 片段截取（精确+快速复制）/ 提取音频（5 格式）/ 压缩（三档 + 分辨率上限），ffmpeg 复用、四模式批量串行                                                                                                                                                                                    | §4.14 验收；e2e 7 用例（缺 ffmpeg 时 skip）；R2 八类映射；chunk 9,962 B gzip；gate 全绿 | 1–2 天   |
| **M15 v1.4**  | PDF 工具集（§4.15，2026-11-19）：合并 / 拆分 / 删页 / 旋转 / 重排 / 元数据，pdf-lib 复用、产物写源目录                                                                                                                                                                                                                                          | §4.15 验收；e2e 覆盖六操作；R2 八类；chunk <200KB gzip；gate 全绿                       | 1–2 天   |
| **M16 v1.5**  | 二维码工具（§4.16，2026-11-19）：生成（文本/网址/WiFi/vCard + 样式 + PNG/SVG）/ 识别（本地图片 jsQR），renderer 计算、主进程原子写盘                                                                                                                                                                                                            | §4.16 验收；e2e 5/5；R2 八类；chunk 88,831 B gzip；gate 全绿                            | 0.5–1 天 |
| **M17 v1.6**  | PDF 水印与页码（§4.17，2026-11-19）：`pdf-toolkit` 扩展两 Tab —— 水印（文字中文栅格化/图片、透明度/角度/大小/平铺/区间）+ 页码（6 向/起始页/4 预设+自定义模板/字号/颜色/边距）                                                                                                                                                                   | §4.17 验收；e2e 8/8；R2 八类；chunk 12,198 B gzip；gate 全绿                            | 0.5–1 天 |
| **M18 v1.7**  | 重复文件查找（§4.18，2026-11-19）：`duplicate-finder` —— 目录扫描（可递归）+ 大小分组 + 64KB 前缀预筛 + 全量 SHA-256 + 重复组默认勾选 + 定位/移入回收站；壳新增 `shell:trash` 通用能力                                                                                                                                                          | §4.18 验收；e2e 覆盖三态与扫描/取消/并发；R2 八类；chunk < 200KB gzip；gate 全绿        | 1–2 天   |
| **M19 v1.8**  | 深色主题切换（§4.19，2026-11-19）：跟随系统/浅色/深色三模式、tokens 暗色变量集、Naive 主题层切换、设置页持久化、启动防白闪；全工具零改动                                                                                                                                                                                                         | §4.19 验收；e2e 3/3；R2 八类映射；纯函数覆盖率 ≥80%；gate 全绿                          | 0.5 天   |
| **M20 v1.9**  | 图片文字识别（§4.20，2026-11-19）：`ocr-text` —— 单图 OCR → 可编辑文本 → 复制 / 导出 TXT；OCR 引擎上提 `packages/ocr-kit`（exam-split 薄壳零回归），`writeAtomic` 上提 `node-kit`                                                                                                                                                              | §4.20 验收；e2e 3/3；R2 八类；chunk 4,163 B gzip；gate 全绿                             | 0.5–1 天 |
| **M21 v2.0**  | 图片批量水印（§4.21，2026-11-20）：`image-watermark` —— 多选图片批量文字/图片水印（九宫格/边距/透明度/大小/旋转/平铺），原图不修改、冲突递增；复用 `@napi-rs/canvas` 零新增依赖                                                                                                                                                                 | §4.21 验收；e2e 2/2；R2 八类；chunk 21,132 B gzip；gate 全绿                            | 0.5–1 天 |
| **M22 v2.1**  | 图片拼接（§4.22，2026-11-20）：`image-stitch` —— 纵向/横向长图 + 网格拼图，基准尺寸/间距/外边距/背景色/格式质量可调，单张输出、冲突递增；复用 `@napi-rs/canvas` 零新增依赖                                                                                                                                                                   | §4.22 验收；e2e 2/2；R2 八类；chunk <200KB gzip；gate 全绿                              | 0.5–1 天 |
| **M23 v2.2**  | 磁盘空间分析（§4.23，2026-11-20）：`disk-analyzer` —— 目录递归扫描 + 直接子项大小降序 + 占比条 + 逐级下钻，最小文件阈值可调、20 万文件上限、进度 + 取消；只读不改文件、零新增依赖                                                                                                                     | §4.23 验收；e2e 2/2；R2 八类；chunk < 200KB gzip；gate 全绿                             | 0.5–1 天 |
| **M24 v2.3**  | 文件夹对比（§4.24，2026-11-20）：`folder-compare` —— 左右目录按相对路径配对比较文件元数据（大小/修改时间，容差 2s 可关闭），四类结果 + 筛选 + 筛选后定位；单侧 20 万上限、结果 2 万截断、进度 + 取消；只读不改文件、零新增依赖                                                                         | §4.24 验收；e2e 2/2；R2 八类；chunk < 200KB gzip；gate 全绿                             | 0.5–1 天 |
| **M25 v2.4**  | 压缩包工具（§4.25，2026-11-20）：`zip-tool` —— ZIP 打包（多选文件/文件夹、保留相对结构、产物冲突递增）/ 解压（zip slip 防护、符号链接拒绝、条目与总大小上限、同名重命名/跳过）；worker 流式读写 + 进度 + 取消；新增 fflate 0.8.3                                                                 | §4.25 验收；e2e 2/2；R2 八类；chunk < 200KB gzip；gate 全绿                             | 1–2 天   |
| **M26 v2.5**  | 侧边栏分类分组（§4.26，2026-11-20）：`ToolManifest` 新增 `category`（七类，工具清单自声明）；侧边栏可折叠分组 + 分类数量；纯函数分组单测                                                                                                         | §4.26 验收；IPC 冒烟 6/6；gate 全绿                                                     | 0.5 天   |

**合计约 4–5 周**（单人全职）。每里程碑产出可安装包，随时可停。

### smoke.md 异常场景强制清单（R2，每工具 8 类）

中文/空格路径 · 文件被占用 · 加密文件 · 超大文件 · 任务取消 · 并发溢出 · 磁盘满 · 断电恢复

### 需求变更流程（R8）

新增工具/改需求 = 改本文 §1 决策总表 + 同步更新 `AGENTS.md`，口头不算；各工具开工前出字段级功能清单作验收附件。

---

## 7. 风险清单

| 风险                            | 应对                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| yt-dlp 平台改版失效/合规        | 放最后、可整体砍；内置引擎自更新；UI 免责                                                                                 |
| Gitee Release 更新源兼容        | M0 冒烟卡点；失败换 OSS（改一处配置）                                                                                     |
| LibreOffice 体积 300MB+         | 精简包 + 按需下载组件                                                                                                     |
| Gitee Go 无 Windows runner/额度 | 本地 `release.mjs` 兜底                                                                                                   |
| OCR 边界误差                    | 预览手动微调兜底；R1 量化验收                                                                                             |
| wasm 推理慢                     | 单页 >3s 则切 onnxruntime-node 复评——**已发生并切换（P4，2026-11-18）**：wasm 真实卷 3.3–4.7s/页 → node 1.10–1.54s/页达标 |
| SmartScreen 拦截                | 一期文档引导；二期 OV 签名                                                                                                |
| pdf-lib 维护放缓（观察项 R10）  | 每季度人工检查替代方案（unpdf 等），不阻塞一期                                                                            |
| 单人维护多工具                  | taskQueue/settings/ui 全共享，新工具只写差异                                                                              |

---

## 附录 A：评审报告摘要（.project-rules/role-skills · 11 角色）

| 角色                    | 结论        | 关键意见                                                               |
| ----------------------- | ----------- | ---------------------------------------------------------------------- |
| CTO                     | ✅ 通过     | —                                                                      |
| Git Master              | ✅ 通过     | CHANGELOG 从 M0 起（→R9）                                              |
| 后端架构师（main 映射） | ✅ 通过     | 日志轮转+路径脱敏（→R10）                                              |
| 终端用户/甲方           | ✅ 通过     | —                                                                      |
| 总架构师                | 🟡 有条件   | 性能基线（→R5）；pdf-lib 观察（→R10）                                  |
| 前端架构师              | 🟡 有条件   | design tokens（→R4）；性能基线（→R5）；依赖治理                        |
| 前端工程师              | 🟡 有条件   | strict 模式（→R6）；样式收口（→R6）                                    |
| DevOps/SRE              | 🟡 有条件   | 版本锁/frozen-lockfile/secrets/SHA 钉死/allowDowngrade/更新卡点（→R7） |
| 产品经理                | 🟡 有条件   | 功能清单/变更流程/免责定稿（→R8）                                      |
| **QA 测试工程师**       | 🔴 **打回** | OCR 量化验收（→R1）；异常清单（→R2）；IPC 冒烟（→R3）                  |
| **UI/UX 设计师**        | 🔴 **打回** | 三态强制（→R4）；design tokens（→R4）；图标体系（→R4）                 |

## 附录 B：修订清单 R1–R10（已全部并入）

| #   | 修订                                                                                                                                                     | 来源            | 级别 | 落点                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---- | ------------------- |
| R1  | OCR 量化验收：10 样卷、命中 ≥90%、≤3s/页                                                                                                                 | QA              | 必须 | §4.4、§6            |
| R2  | smoke.md 8 类异常强制清单                                                                                                                                | QA              | 必须 | §6                  |
| R3  | M0 起 CI 含 IPC 冒烟自动化                                                                                                                               | QA              | 必须 | §5.2、§6            |
| R4  | 三态规范 + design tokens + 图标库（lucide）                                                                                                              | UIUX            | 必须 | AGENTS.md UI 章     |
| R5  | 性能基线：首屏 1.5s / chunk 200KB（gzip；求值类例外 ≤300KB gzip，M1 修订；运行时资产不计入 chunk、smoke 单列记录，M3 修订 2026-11-14） / PDF 2s / OCR 3s | 总架构+前端架构 | 必须 | AGENTS.md 性能章    |
| R6  | strict + noUncheckedIndexedAccess + 样式收口                                                                                                             | 前端工程师      | 必须 | AGENTS.md TS/样式章 |
| R7  | 版本锁/frozen/secrets/SHA/allowDowngrade/更新卡点                                                                                                        | DevOps          | 必须 | §5.2、§5.3          |
| R8  | 功能清单 + 变更流程 + 免责定稿                                                                                                                           | 产品经理        | 建议 | §4、§6              |
| R9  | CHANGELOG 从 M0 起                                                                                                                                       | Git             | 建议 | §6                  |
| R10 | pdf-lib 观察项 + 日志轮转/脱敏                                                                                                                           | 总架构+后端     | 建议 | §7、services        |
