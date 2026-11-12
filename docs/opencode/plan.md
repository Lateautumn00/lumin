# Lumin 桌面实用工具箱 — 最终规划方案 v1.1（评审通过版）

> 状态：**评审通过，待实施**
> 评审：`.project-rules/role-skills` 11 个相关角色，21 条意见，修订 R1–R10 已并入本文
> 前置文档：决策来源为多轮评审问答（Q1–Q17），原文见 §1；原始角色规则见 `.project-rules/role-skills/`
> 配套文件：根目录 `AGENTS.md`（工程强制规范，由本方案 §5 收敛而成）

---

## 1. 决策总表（Q1–Q17 锁定）

| #   | 决策项    | 结论                                                                                                                            |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | 目标平台  | Windows x64 一期；架构不堵死 macOS                                                                                              |
| Q2  | 渲染框架  | Vue 3 + Vite + TS + Pinia + Naive UI                                                                                            |
| Q3  | Monorepo  | pnpm workspaces + Turborepo                                                                                                     |
| Q4  | 形态/集成 | 单窗口 + 侧边栏；工具**编译期清单插拔**（契约按运行时热插拔设计）                                                               |
| Q5  | Python    | **不引入**；视频下载捆绑 `yt-dlp.exe`/`ffmpeg.exe`；OCR 走纯 JS ONNX                                                            |
| Q6  | 离线边界  | 无自建后端、数据不出本机；视频下载允许联网、仅本地解析，风险自担                                                                |
| Q7  | 试卷切割  | **a+b**：a = PDF 拆分/合并/删页/裁剪；b = OCR 切题（图片/PDF → 单题）；c（结构化题库）不做                                      |
| Q8  | Word→PDF  | LibreOffice headless，保真优先，按需下载组件                                                                                    |
| Q9  | 界面语言  | 中文文案集中 key 化，预留 i18n 结构                                                                                             |
| Q10 | 分发      | NSIS + portable；electron-updater generic provider；一期不买签名证书                                                            |
| Q11 | 测试/CI   | Vitest 必上；e2e 二期，但 M0 起必须有 IPC 冒烟自动化（R3）                                                                      |
| Q12 | 工具顺序  | 骨架 → 计算器/单位换算 → Word→PDF → 试卷切割(PDF→OCR) → 短视频下载                                                              |
| Q13 | 工具范围  | 科学计算器（表达式+历史）；10 类单位换算（无汇率）                                                                              |
| Q14 | 插拔深度  | **A. 编译期清单**（壳内仅 1 个 manifest）+ 契约按 B 设计（manifest.json 随包产出，未来换目录扫描即升级）                        |
| Q15 | OCR 路线  | **A. 纯 JS ONNX**：PP-OCR 模型（det+rec+cls ≈22MB 随包）+ onnxruntime-web（wasm，免原生 rebuild）；Python 留作二期升级路径      |
| Q16 | OCR I/O   | 输入图片+PDF；OCR 行检测 → 题号聚类 → 预览+手动微调边界 → 导出每题 PNG + 可选合成 PDF                                           |
| Q17 | 项目规则  | **B. 精选强制**：8 份相关规则 → `AGENTS.md` + CI 门禁（lint/typecheck/test/audit 不绿不合 MR）                                  |
| Q18 | 版本基线  | **全部最新稳定版 + 精确钉版**；TypeScript 采用「最新稳定版 + 生态适配实测回退制」，当前锁定 **6.0.3**（例外见 §1.1）；详见 §1.1 |
| —   | 硬约束    | 工具独立可插拔、零耦合；公共代码上提根 `packages/`；工具间禁止互相依赖                                                          |

### 门禁阈值（Q17 附带锁定）

- 核心纯函数（换算/解析/表达式/进度解析）覆盖率 **≥80%**，全仓 **≥60%**
- `no-explicit-any` = **error**
- `pnpm audit` 无 **high/critical**
- lint + typecheck + test + audit 不绿 **不合 MR**

### 1.1 版本基线（M0 锁定，全部 latest stable）

> 2026-11-12 npm 核查。实施首日与每次升级依赖前必须重新 `npm view` 复核；有漂移先更新本表再改依赖（R8 变更流程）。全部**精确钉版**（无 `^`）+ `pnpm-lock.yaml` + `packageManager` + `.nvmrc`，CI 一律 `--frozen-lockfile`。

| 类别           | 版本                                                                                                                                                                                                                              | 说明                                                                                                                                                                                                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node           | 24.13.0（`.nvmrc`）                                                                                                                                                                                                               | Electron 45 要求 ≥22.12                                                                                                                                                                                                                                                                                                                |
| pnpm           | 12.18.0（`packageManager`，corepack）                                                                                                                                                                                             | npm `latest` 仍指 11 线；独立安装用 `latest-12` 标签                                                                                                                                                                                                                                                                                   |
| **TypeScript** | **6.0.3（当前锁定）**                                                                                                                                                                                                             | **例外记录（2026-11-12，方案 A 触发回退）**：7.0.2（Go 原生版）实测 `tsc` 类型检查通过，但 `typescript-eslint@8.72.2` 运行时硬报错 "does not support TS 7.0"（peer `<6.1.0`，跟踪 typescript-eslint#10940，称支持随 ≥7.1 到来）→ 按方案 A 回退 6.0.3。升级条件：typescript-eslint 发布支持 TS 7 的稳定版后复测 lint+typecheck+冒烟再升 |
| Electron 套件  | electron 45.3.1 · electron-vite 6.0.0 · electron-builder 26.18.0 · electron-updater 6.8.11                                                                                                                                        | 46 仅 alpha；`@swc/core` 为 electron-vite 可选 peer，不装                                                                                                                                                                                                                                                                              |
| 构建/框架      | vite 8.3.8 · @vitejs/plugin-vue 6.0.10 · vue 3.5.45 · vue-router 5.5.0 · pinia 4.1.0 · naive-ui 2.45.3 · tailwindcss 4.3.5 + @tailwindcss/vite 4.3.5（CSS-first `@theme`，无 config.js）· lucide-vue-next 1.0.0                   | vue 3.6 仅 rc，取 3.5 稳定线                                                                                                                                                                                                                                                                                                           |
| 校验/测试      | zod 4.6.7 · vitest 5.1.0 + @vitest/coverage-v8 5.1.0 · @vue/test-utils 2.5.1 · vue-tsc 3.3.14                                                                                                                                     | vue-tsc peer 无上限（TS7 兼容待实测）                                                                                                                                                                                                                                                                                                  |
| Lint/格式      | eslint 10.14.0 · @typescript-eslint/* 8.72.2 · eslint-plugin-vue 10.12.1 · vue-eslint-parser 10.4.2 · @vue/eslint-config-typescript 14.9.0 · @vue/eslint-config-prettier 10.2.0 · eslint-config-prettier 10.1.8 · prettier 3.10.1 |                                                                                                                                                                                                                                                                                                                                        |
| 工程化         | turbo 2.11.11 · dependency-cruiser 18.7.2 · electron-log 5.4.4                                                                                                                                                                    | pnpm 12 为 Rust 重写，配置格式与 11 兼容；`--frozen-lockfile false` 语法已移除                                                                                                                                                                                                                                                         |
| 后续里程碑     | mathjs 15.2.0（M1）· pdf-lib 1.17.1 + pdfjs-dist 6.5.438（M3）· onnxruntime-web（M3b）· @playwright/test（M0 IPC 冒烟）                                                                                                           | 开工时复核最新稳定版后钉死                                                                                                                                                                                                                                                                                                             |

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

1. `tools/*` → 仅可依赖 `plugin-api / shared / ui / node-kit`
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
│   ├── node-kit/                # spawn+进度解析、worker 封装、路径解析
│   └── tools/
│       ├── calculator/          # manifest.ts + renderer/（+ node.ts 如需要）
│       ├── unit-converter/
│       ├── docx2pdf/
│       ├── exam-split/          # PDF 操作 + OCR 切题同包两入口
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
- 调用：`soffice.exe --headless -env:UserInstallation=file:///独立profile --convert-to pdf --outdir <tmp> <input>`（独立 profile 防抢锁）
- **串行队列** + 超时 60s kill + 产物存在校验 + 可读错误（加密/占用/未装引导）
- 打包策略：默认「精简包」不含 LibreOffice；设置页「安装转换组件」按需下载
- 中文字体走系统字体，无需打包
- **验收**：含表格/页眉/中文字体 docx 转换保真可接受（R8 功能清单先行）

### 4.4 试卷切割（M3a PDF + M3b OCR）

**M3a — PDF 操作**

- 预览：`pdfjs-dist` 缩略图（renderer worker，`GlobalWorkerOptions.workerSrc` 配置）
- 写出：`pdf-lib` 无损——按页码区间拆分（`copyPages`）、多文件合并（拖拽排序）、删除页（去答案）、旋转、矩形区域裁剪（`setCropBox`）
- 命名模板 `{原名}_p1-3.pdf`；加密 PDF 结构化中文错误
- **验收**：100 页拆分 <2s；区间解析纯函数覆盖 ≥80%

**M3b — OCR 切题（Q7=b）**

- 管线：图片/PDF 输入（pdfjs 渲染 PDF 页为图）→ PP-OCR 行级检测（onnxruntime-web wasm）→ 按题号（「1.」「一、」）聚类成题区 → **缩略图预览 + 拖拽微调边界** → 导出每题 PNG + 可选合成 PDF
- 模型：PP-OCR det+rec+cls ≈22MB 随包（extraResources），**固定 URL + SHA256 钉死**
- 不做结构化题库（c 未选）；Python sidecar 留作二期升级路径
- **验收（R1 量化）**：固定 10 份样卷测试集（含手写/印刷/双栏/带图），**自动切题边界命中率 ≥90%，或每题人工微调 ≤1 次**；单页 OCR **≤3s**（超则切 onnxruntime-node 复评）

### 4.5 短视频下载（M4）

- `scripts/fetch-binaries.mjs`：拉取官方 `yt-dlp.exe` + `ffmpeg.exe` 到 `binaries/`（**固定 URL + SHA256 钉死**，gitignore）
- 主进程 spawn 队列（并发 2）：`probe`（`yt-dlp -J`）→ `start` → 逐行解析 stdout 进度 → 事件推送
- 功能：链接粘贴、格式预设（best/1080p/仅音频 mp3）、暂停（kill + `--continue` 续传）、取消、输出目录、历史（JSON）
- 保鲜：设置页「更新下载引擎」；UI 免责声明（**文案 M4 开工前定稿**，R8）
- 抖音等国内平台：一期先 yt-dlp 直连试，失败标注二期
- **验收**：B站 + YouTube 真实链接下载成功；进度/暂停/队列可用

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

| 里程碑        | 内容                                                                                                                                                                                                               | 验收（含评审修订）                                                   | 预估   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------ |
| **M0 骨架**   | workspace/Turbo/electron-vite 三端 HMR；侧边栏+动态路由；plugin-api/ipc-bus；安全基线；settings/log/taskQueue；**AGENTS.md/CI 门禁/CHANGELOG**；NSIS+portable 出包；**更新冒烟（卡点）**；**IPC 冒烟自动化（R3）** | `pnpm dev` 出窗口；invoke 全链路通；门禁全绿；build 出包；更新冒烟过 | 2–3 天 |
| **M1 v0.1**   | 计算器 + 单位换算 + 单测                                                                                                                                                                                           | 覆盖 ≥80%；门禁绿                                                    | 2–3 天 |
| **M2 v0.2**   | Word→PDF（三段定位+独立 profile+串行队列+按需下载组件）                                                                                                                                                            | 真实 docx 保真可接受；**功能清单先行（R8）**                         | 4–6 天 |
| **M3a v0.3**  | 试卷切割 PDF（缩略图+拆/合/删/转/裁）                                                                                                                                                                              | 100 页拆分 <2s；smoke.md 8 类异常全过（R2）                          | 3–4 天 |
| **M3b v0.3b** | OCR 切题（PP-OCR wasm+预览微调+导出）                                                                                                                                                                              | **10 份样卷命中 ≥90% 或微调 ≤1 次/题；≤3s/页（R1）**                 | 4–6 天 |
| **M4 v0.4**   | 短视频下载（fetch-binaries+队列+进度/暂停/历史+自更新+免责）                                                                                                                                                       | B站/YouTube 真实下载成功；**免责文案定稿（R8）**                     | 5–8 天 |
| **M5 发布**   | 更新端到端验证；Gitee Release 首发；README/许可/SmartScreen 指引                                                                                                                                                   | 旧版自动升新版                                                       | 2–3 天 |

**合计约 4–5 周**（单人全职）。每里程碑产出可安装包，随时可停。

### smoke.md 异常场景强制清单（R2，每工具 8 类）

中文/空格路径 · 文件被占用 · 加密文件 · 超大文件 · 任务取消 · 并发溢出 · 磁盘满 · 断电恢复

### 需求变更流程（R8）

新增工具/改需求 = 改本文 §1 决策总表 + 同步更新 `AGENTS.md`，口头不算；各工具开工前出字段级功能清单作验收附件。

---

## 7. 风险清单

| 风险                            | 应对                                           |
| ------------------------------- | ---------------------------------------------- |
| yt-dlp 平台改版失效/合规        | 放最后、可整体砍；内置引擎自更新；UI 免责      |
| Gitee Release 更新源兼容        | M0 冒烟卡点；失败换 OSS（改一处配置）          |
| LibreOffice 体积 300MB+         | 精简包 + 按需下载组件                          |
| Gitee Go 无 Windows runner/额度 | 本地 `release.mjs` 兜底                        |
| OCR 边界误差                    | 预览手动微调兜底；R1 量化验收                  |
| wasm 推理慢                     | 单页 >3s 则切 onnxruntime-node 复评            |
| SmartScreen 拦截                | 一期文档引导；二期 OV 签名                     |
| pdf-lib 维护放缓（观察项 R10）  | 每季度人工检查替代方案（unpdf 等），不阻塞一期 |
| 单人维护多工具                  | taskQueue/settings/ui 全共享，新工具只写差异   |

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

| #   | 修订                                                | 来源            | 级别 | 落点                |
| --- | --------------------------------------------------- | --------------- | ---- | ------------------- |
| R1  | OCR 量化验收：10 样卷、命中 ≥90%、≤3s/页            | QA              | 必须 | §4.4、§6            |
| R2  | smoke.md 8 类异常强制清单                           | QA              | 必须 | §6                  |
| R3  | M0 起 CI 含 IPC 冒烟自动化                          | QA              | 必须 | §5.2、§6            |
| R4  | 三态规范 + design tokens + 图标库（lucide）         | UIUX            | 必须 | AGENTS.md UI 章     |
| R5  | 性能基线：首屏 1.5s / chunk 200KB / PDF 2s / OCR 3s | 总架构+前端架构 | 必须 | AGENTS.md 性能章    |
| R6  | strict + noUncheckedIndexedAccess + 样式收口        | 前端工程师      | 必须 | AGENTS.md TS/样式章 |
| R7  | 版本锁/frozen/secrets/SHA/allowDowngrade/更新卡点   | DevOps          | 必须 | §5.2、§5.3          |
| R8  | 功能清单 + 变更流程 + 免责定稿                      | 产品经理        | 建议 | §4、§6              |
| R9  | CHANGELOG 从 M0 起                                  | Git             | 建议 | §6                  |
| R10 | pdf-lib 观察项 + 日志轮转/脱敏                      | 总架构+后端     | 建议 | §7、services        |
