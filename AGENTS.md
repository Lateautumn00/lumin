# AGENTS.md — Lumin 项目工程强制规范

> 本文件是 Lumin 项目的**强制规范**，由 `.project-rules/role-skills` 精选 8 份角色规则 + 方案评审修订（R1–R10）收敛而成。
> 配套方案：`docs/opencode/plan.md`（决策依据与里程碑）。
> **任何 AI 或人员生成/修改代码前必须遵守本文件；决策变更时必须同步更新本文件（口头无效）。**
> 命名与工程细则速查：`.project-rules/skills/project-conventions/SKILL.md`（编码、评审、提交前必读；与本文件冲突时以本文件为准）。

---

## 1. 项目概述与技术栈锁定

Lumin：Windows 桌面实用工具箱（Electron），离线优先、无自建后端。小工具**独立可插拔、零耦合**。

**锁定技术栈（禁止替换/新增平行方案）：**

- pnpm workspaces + Turborepo + electron-vite + Electron + TypeScript
- Vue 3 + Vite + Pinia + Vue Router + Naive UI + Tailwind CSS
- Vitest（测试）· ESLint + Prettier（格式）· dependency-cruiser（边界）
- pdf-lib + pdfjs-dist（PDF）· mathjs（表达式）· PP-OCR ONNX + onnxruntime-node（OCR，M3b P4 由 onnxruntime-web 切换，2026-11-18，见 plan §4.4）· marked 18.2.1 + js-yaml 5.5.0（Markdown 工具，M39，2026-11-21 R8 登记，见 plan §4.39）
- CodeMirror 6 最小集（文本编辑器，M56，2026-11-22 R8 登记，见 plan §4.56）· `@codemirror/lang-markdown` 6.5.2 + `@codemirror/language` 6.13.1（Markdown 工具语法高亮，M67，2026-11-24 R8 登记，见 plan §4.39）· iconv-lite 0.7.3（非 UTF 编码保存，仅主进程）
- lunar-javascript 1.7.8（日历农历/节气/黄历/节假日库，M58，2026-11-23 R8 登记，见 plan §4.58；MIT 零依赖、无内置类型手写 d.ts、动态 import 分包）
- mind-elixir 6.0.3（思维导图库，M66，2026-11-24 R8 登记，见 plan §4.66；MIT、零传递依赖、自带 TS 类型，实测 42,200 B gzip JS + 4,858 B gzip CSS）
- electron-builder（NSIS + portable）· electron-updater（generic provider）

**版本基线**：一律**最新稳定版 + 精确钉版**，锁定表见 `docs/opencode/plan.md` §1.1；升级依赖前必须 `npm view` 复核并同步该表（Q18/R8，口头无效）。TypeScript 当前锁定 **6.0.3**（7.0.2 因 `typescript-eslint` 未适配已按方案 A 回退，例外与升级条件见 plan.md §1.1）。

**禁止**：引入第二套状态管理 / 请求库 / CSS 方案 / 构建工具；随意引包（新增第三方依赖必须在 PR 描述中说明用途）。

---

## 2. 架构铁律（零耦合）

1. **壳零工具知识**：`apps/desktop` 内除工具清单文件外，禁止出现任何工具名/工具专属代码。
2. **工具间禁止互相 import**：`packages/tools/*` 只能依赖 `plugin-api / shared / ui / node-kit / ocr-kit`。
3. **公共代码上提**：两个及以上工具复用的逻辑必须抽到根 `packages/` 对应包，禁止在工具内复制粘贴。
4. **契约唯一入口**：工具与壳之间只通过 `packages/plugin-api`（ToolManifest / MainPluginContext / bridge）交互。
5. **IPC schema 归工具包**：`shared` 只定义信封（channel/payload/progress/error 形状）；各工具自带 zod schema 与类型化 client。
6. **依赖方向**：renderer 禁 import main；`tools/*` 禁 import `apps/*`。dependency-cruiser 规则在 CI 强制，违规不合 MR。
7. **新增工具 = 新包 + 清单 1 行**；禁止绕过清单注册。

---

## 3. 目录结构锁死

目录结构以 `docs/opencode/plan.md` §3 的定稿树为准。

- **禁止**乱建文件、乱分层、乱拆组件；新文件必须落在定稿树的既定位置
- 工具包固定形态：`manifest.ts` + `renderer/` + `node.ts?`（主进程逻辑可选）
- 大二进制（yt-dlp/ffmpeg/OCR 模型）一律走 `scripts/fetch-binaries.mjs` 拉取，**禁止提交进 git**（`binaries/` 已 gitignore）；**随包资源只保留 win32-x64 原生库与 `zh-CN`/`en-US` 语言包**（2026-11-19 体积优化，plan §4.10）

---

## 4. TypeScript 编码规范

- `tsconfig` 基线：**`strict: true` + `noUncheckedIndexedAccess: true`**（见 `tsconfig.base.json`）
- **`@typescript-eslint/no-explicit-any` = error**：见 any 就删，类型缺失直接打回重写
- 禁用非空断言滥用；优先收窄类型（zod 校验后用推导类型）
- 命名：文件/目录 kebab-case；组件 PascalCase；类型/接口 PascalCase；常量 UPPER_SNAKE
- 禁止死代码、调试残留（`console`/`debugger`/临时注释）提交

---

## 5. 样式收口与 UI 规范

### 5.1 样式

- 业务样式**只允许** Tailwind 工具类 + design tokens CSS 变量
- Naive UI 主题覆盖**只允许**在 theme 配置层；**禁止**组件内 `:deep()` 随意改库样式
- **禁止**散写魔法值（色值/间距/圆角硬编码）——一律走 tokens

### 5.2 Design tokens 单源（R4）

- 色板 / 圆角 / 间距 / 字号经 **CSS 变量**同时供给 Naive UI 主题与 Tailwind，单一来源
- tokens 定义位置：`apps/desktop/renderer` 主题层（M0 建立）
- 改色/改主题只改 tokens，禁止逐组件改
- 明暗切换只允许通过 `html[data-theme='dark']` 覆盖 tokens + Naive theme 配置层；禁止组件内按主题分支改样式，禁止散写 `dark:` 颜色类

### 5.3 三态强制（R4）

**每个工具页面必须实现并交付三种状态**（缺一不验收）：

| 状态   | 要求                                           |
| ------ | ---------------------------------------------- |
| 空态   | 引导文案 + 主操作（如拖拽区/输入框），禁止白屏 |
| 加载态 | 进度可见 + **可取消**（长任务）                |
| 报错态 | 结构化错误码 → 中文文案 + 重试/详情入口        |

### 5.4 图标体系（R4）

- 统一使用 **`@lucide/vue`**（Tree-shakeable；lucide-vue-next 已废弃，官方继任包）
- **禁止**混用 Naive 内置图标、手写 SVG、图标字体

---

## 6. IPC / 任务模型规范

- 通道命名 `{toolId}:{action}`；preload 只暴露白名单 bridge（`window.lumin`）
- 长任务三段式：`invoke` 提交返回 `{ taskId }` → 事件推送 `progress|log|done|error` → `cancel` 取消
- 所有入参经 zod 校验后才进 handler；错误统一结构化错误码（`shared` 定义）
- 队列并发上限可配；**soffice 必须串行**（单实例锁）
- 主进程安全基线不得下调：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、CSP、导航拦截

---

## 7. 测试与质量门禁（QA 规则落地）

### 7.1 覆盖率阈值（R1 门禁）

- **核心纯函数 ≥80%**（单位换算、区间解析、表达式求值、进度行解析、命名模板、IPC schema）
- **全仓 ≥60%**
- 不达标 = CI 红 = 不合 MR

### 7.2 IPC 冒烟自动化（R3）

- **M0 起 CI 必须包含一条 IPC 冒烟**：启动 → `invoke` → 断言回包；无此测试不得合入

### 7.3 smoke.md 异常场景清单（R2）

每工具交付必须附 `docs/smoke/<tool>.md`，**8 类异常全覆盖、逐条手工验证记录**：

1. 中文/空格路径　2. 文件被占用　3. 加密文件　4. 超大文件
2. 任务取消　6. 并发溢出　7. 磁盘满　8. 断电恢复

漏测即返工；只测正向流程不予验收。

### 7.4 OCR 量化验收（R1，exam-split M3b）

- 固定 **10 份样卷测试集**（手写/印刷/双栏/带图混合）
- **自动切题边界命中率 ≥90%，或每题人工微调 ≤1 次**
- **单页 OCR ≤3s**（wasm；超限切 onnxruntime-node 复评）

---

## 8. 性能基线（R5，硬性）

| 指标                    | 基线            |
| ----------------------- | --------------- |
| 主壳首屏可交互          | < 1.5s          |
| 单工具懒加载 chunk 增量 | < 200KB（gzip） |
| 100 页 PDF 拆分         | < 2s            |
| OCR 单页                | ≤ 3s            |

工具页一律懒加载分包；长列表虚拟滚动；超基线 = 打回优化，不合并。

**chunk 口径与例外（2026-11-13 M1 决策）**：chunk 基线一律按 **gzip** 计，「增量」= 工具 chunk + 其独占依赖 chunk（不含壳与共享 vendor）。**依赖表达式求值库的工具**（plan Q13 锁定 mathjs，公开入口 `parse` 位于 side-effectful 聚合器、官方无更小入口）例外上限 **300KB gzip**——计算器实测 214.3KB gzip（977.6KB raw，较 mathjs 全量入口约 -44%）达标；无求值库工具维持 200KB gzip（单位换算实测 37.9KB gzip）。变更本条例须同步 `docs/opencode/plan.md` R5（口头无效）。

**运行时资产口径（2026-11-14 M3 决策，R5 修订）**：按需随包、运行时按需加载的**资产文件**（pdfjs worker、wasm、OCR 模型等）**不计入** chunk 增量与上述 200KB/300KB 上限，但必须在对应 `docs/smoke/<tool>.md` 单列记录（raw/gzip）；工具代码 chunk 仍受原口径约束。例：exam-split 实测 renderer 增量（pdfjs 主库 + 工具代码）≈150KB gzip 达标，pdfjs worker 资产 379.2KB gzip 单列，pdf-lib（184.1KB gzip）走主进程 worker 不属 R5 口径。变更本条例须同步 `docs/opencode/plan.md` R5（口头无效）。

---

## 9. Git 规范（skills-git 落地）

- **分支**：`main` 只读（禁止直推）；开发走 `feature/*`；修复 `fix/*`；线上紧急 `hotfix/*`
- **流程**：所有合入走 **MR**，描述清晰、关联需求、标注风险，**门禁全绿才可合并**
- **提交前缀**：`feat / fix / docs / style / refactor / test / chore`，语义清晰，禁止模糊文案
- **提交粒度**：小步提交、功能独立、不混编；提交前自检 = 编译过 + 格式化 + Lint 绿 + 无冗余文件
- **禁止**：敏感信息（密钥/Token/证书）、debug 日志、console、无效代码入库
- **发布**：语义化 Tag（`vX.Y.Z`）；**`CHANGELOG.md` 从 M0 起维护**（R9）

---

## 10. CI / 依赖 / 安全（DevOps 规则落地，R7）

- **环境锁死**：根 `package.json` `packageManager` 锁 pnpm 版本；`.nvmrc` 锁 Node；CI 一律 `--frozen-lockfile`
- **MR 门禁链**：lint → typecheck → test（含 IPC 冒烟）→ `pnpm audit`（**无 high/critical**）→ dependency-cruiser；全绿才合入
- **secrets**：Gitee 发版 token 只进 CI secrets，**禁止硬编码**进任何文件
- **外部二进制/模型**：fetch 脚本必须**固定 URL + SHA256 校验**（yt-dlp/ffmpeg/OCR 模型）
- **更新**：`allowDowngrade=false`；回滚 = 发新版覆盖；**更新源冒烟不过不得进入下一里程碑**
- 依赖漏洞带风险版本一律不准引入

---

## 11. 需求与变更流程（PM 规则落地，R8）

- **决策总表**（`docs/opencode/plan.md` §1）为需求边界唯一依据；变更必须：改决策总表 + 同步更新本文件，**口头无效**
- 各工具开工前先出**字段级功能清单**（按钮集/输入项/错误分支），作为该里程碑验收附件
- 禁止验收模糊化：「能用/差不多/正常」不算验收，必须可复现断言
- 视频下载免责文案**已定稿**（2026-11-18，用户拍板三重呈现：工具首次弹窗 + 页内 banner + 关于页声明；正文见 `docs/opencode/plan.md` §4.5，修改须重走 R8）
- 壳级 UX 决策（2026-11-23，plan Q60）：**无原生菜单栏**（`Menu.setApplicationMenu(null)`，dev 经 `before-input-event` 保留 F12/Ctrl+Shift+I/F5/Ctrl+R）；**启动默认工具 = 日历**（`tool-manifests.ts` 的 `DEFAULT_TOOL_ID`）；修改须重走 R8
- 文件打印决策（2026-11-25，plan Q69/M68）：新增独立工具 `@lumin/tool-print`（id `print`，Office/PDF/图片三类输入）；**统一系统打印对话框 `silent:false`**，不做应用内预览与静默打印；PDF 走 Electron PDFium 视图（隐藏窗口 `plugins:true`）+ `node-kit/pdf` 栅格兜底；Office 经 `soffice` 转 PDF 后打印（串行锁）；**零新增依赖/二进制**；修改须重走 R8
- 页面切分决策（2026-11-25，plan Q70/M69）：`exam-split` 的 **OCR 页签内置「切成两页」处理方式**（默认选中，与「识别切题」互斥切换，不新增第三个页签），A3 横向双页 → 两页 A4；**纯像素检测**（Otsu + 纸张包围盒 + 中央装订沟，无沟回退 0.5），**竖版 → `PAGE_NOT_SPREAD`** 不静默硬切；PDF 两次独立 `copyPages` + `setMediaBox/CropBox` 出单文件 2N 页，图片同格式左右成对输出；切完即结束不自动 OCR；**零新增依赖/二进制**；修改须重走 R8
- 图片三件套合并决策（2026-11-25，plan Q71/M70）：`image-rotate` / `image-crop` **整包并入 `image-toolbox`** 为「旋转」「裁剪」两 Tab，删除两包与侧边栏入口、薄壳页、e2e；`process` union 与 `historyModeSchema` 增 `rotate`/`crop`，错误码统一 `IT_*`，产物扩展名沿用 `compressOutputExt`（gif/webp→webp，动图取首帧）；**零新增依赖/二进制**；修改须重走 R8
- 文件扫描套件合并决策（2026-11-25，plan Q72/M71）：`file-hasher` / `duplicate-finder` / `folder-compare` **整包并入 `file-scanner`** 为「文件校验 / 重复文件 / 目录对比」三页签，删除三包与侧边栏入口、薄壳页、e2e（3 入口 → 1）；通道统一 `file-scanner:*`（`hash-*` / `dup-*` / `compare-*` 共 9 个），错误码保留 `FH_*`/`DF_*`/`FC_*`；**零新增依赖/二进制**；修改须重走 R8
- 图片剩余三件套合并决策（2026-11-25，plan Q72/M72）：`image-watermark` / `image-dewatermark` / `image-stitch` **整包并入 `image-toolbox`** 为「水印 / 去水印 / 拼接」三 Tab，删除三包与侧边栏入口、薄壳页、e2e（图片入口 4 → 1）；通道统一 `image-toolbox:*`（10 个，按页签加前缀），错误码保留 `IW_*`/`IDW_*`/`IS_*`；设置键 `watermarkOutputDir` / `dewatermarkOutputDir` / `stitchOutputDir`；**零新增依赖/二进制**；修改须重走 R8
- 视频下载/播放器合并决策（2026-11-25，plan Q73/M73）：`video-download` / `video-player` **整包并入 `media-convert`**（id 不变，显示名「媒体工具箱」，`version 0.3.0`）为「下载 / 播放」两页签，删除两包与侧边栏入口、薄壳页、e2e（媒体入口 3 → 1）；宿主五通道不变，子功能经上下文适配器加前缀 `media-convert:download-*` / `media-convert:player-*`；settings 迁至 `tools.media-convert.download.*`（旧键不迁移）；下载页签**懒挂载**防免责弹窗误弹；错误码保留 `VD_*`/`VP_*`；**零新增依赖/二进制**；修改须重走 R8
- 思维导图交互升级决策（2026-11-25，plan Q74/M74）：`mindmap` **v0.2.0** 新增导图/大纲双视图（库内置 `Outliner`，同一文档共享撤销栈）、节点操作条与备注/链接、`Ctrl+F` 搜索定位、从文本大纲生成/追加、工具栏 tooltip/快捷键帮助/边框字号控件重做/多选批量样式；解冻 spec §0.3「纯文本/Markdown 大纲生成」，**OCR/AI 生成仍冻结**；**零新增依赖/二进制**；修改须重走 R8
- 文件残余三件套合并决策（2026-11-25，plan Q75/M75）：`file-renamer` / `fs-cleaner` / `disk-analyzer` **整包并入 `file-scanner`** 为「批量重命名 / 文件清理 / 磁盘分析」三页签（六页签单入口，文件入口 4 → 1），删除三包与侧边栏入口、薄壳页、e2e；通道统一 `file-scanner:rename-* / clean-* / disk-*`（上下文适配器加前缀），settings 迁至 `tools.file-scanner.rename|clean|disk.*`，错误码保留 `FR_*`/`FC_*`/`DA_*`；**零新增依赖/二进制**；修改须重走 R8
- PDF 图片互转合并决策（2026-11-25，plan Q76/M76）：`pdf-images` **整包并入 `pdf-toolkit`** 为第 13 页签「PDF↔图片」（PDF 入口 2 → 1），删除独立包与侧边栏入口、薄壳页、e2e；通道统一 `pdf-toolkit:images-*`，错误码保留 `PI_*`；**零新增依赖/二进制**；修改须重走 R8
- 文本残余两件套合并决策（2026-11-25，plan Q77/M77）：`text-editor` / `text-diff` **整包并入 `text-toolbox`** 为「编辑 / 对比」两页签（文本入口 3 → 1），`text-toolbox` 新增主进程入口；通道统一 `text-toolbox:editor-* / diff-*`，错误码保留 `TE_*`/`TD_*`；**零新增依赖/二进制**；修改须重走 R8
- 杂项与系统合并决策（2026-11-25，plan Q78/M78）：`system-info` / `password-generator` / `clipboard-history` **整包并入 `misc-toolbox`** 为「系统信息 / 密码生成 / 剪贴板」三页签（杂项入口 4 → 1，`qr-code` 归属图片明确不动）；通道统一 `misc-toolbox:sysinfo-* / clipboard-*`（密码生成纯 renderer 无通道），错误码保留 `SI_*`/`CH_*`；**零新增依赖/二进制**；修改须重走 R8

---

## 12. 架构与技术债务底线（chief-architect / cto 落地）

- 架构决策以方案为准，**禁止**为赶工期弱化架构、简化边界、短期凑活交付
- 禁止局部偷懒：发现耦合/重复代码/绕过契约 = 打回重构
- 预埋扩展点已定（manifest 契约）；**禁止**推翻重做已定架构
- 观察项：`pdf-lib` 维护活跃度低——每季度评估替代（如 unpdf），**不擅自更换**（R10）

---

## 13. 日志规范（R10）

- 统一 electron-log：**滚动文件** + 体积上限；设置页可打开日志目录
- 本地日志可含路径；**任何外发/上报场景必须脱敏**（去用户名、去敏感文件名）
- 禁止 `console.log` 作为正式日志手段

---

_版本：v1.0（随方案 v1.1 生成）· 变更本文件必须同步更新 `docs/opencode/plan.md` 对应章节_
