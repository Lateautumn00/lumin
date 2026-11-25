# Office 转 PDF — 字段级功能清单（M2/M9 验收附件）

> 依据 AGENTS §11：开工前定稿。变更须同步更新本文件与 `docs/opencode/plan.md` §4.3/§4.9。
> 工具 id：`docx2pdf`（通道与包名不变） · 显示名：**Office 转 PDF** · 包：`@lumin/tool-docx2pdf` · 版本 0.2.0
> M9 变更（2026-11-19）：输入扩展为 Word/Excel/PPT 三类共 6 种扩展名，新增**批量转换队列**（单任务内串行逐文件转换、逐文件失败不中断、结果汇总）。

## 1. 输入项

| 字段           | 类型                                                                          | 约束                                                                              | 默认值 |
| -------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| 输入文件       | 文件路径列表（多选 1..100，`.doc/.docx/.xls/.xlsx/.ppt/.pptx`，大小写不敏感） | 每个文件必须存在、可读、未被其他程序独占占用；重复路径（大小写不敏感）自动去重    | 无     |
| 自定义组件路径 | 设置 `tools.docx2pdf.customPath`                                              | string；指向 `soffice.exe`/`soffice.com` 的完整路径；无效时**回退**系统检测并提示 | `''`   |

- 批量上限 `MAX_BATCH_FILES = 100`（`src/formats.ts` 单一来源）；超限由 UI 提示、schema 拒绝（`INVALID_PAYLOAD`）。
- 文件选择器 `accept = .doc,.docx,.xls,.xlsx,.ppt,.pptx`；拖拽/选择非白名单文件 → 拒绝并提示。

## 2. soffice 三级定位（顺序取首个有效项）

| 顺序 | 来源       | 判定                                                                                                                                                                       |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 自定义路径 | `customPath` 非空且该文件存在（`.com`/`.exe` 结尾）                                                                                                                        |
| 2    | 系统安装   | 注册表 `HKLM/HKCU\SOFTWARE\LibreOffice\UNO\InstallPath` → `<path>\program\soffice.com`（回退 `soffice.exe`）；**未实现** `%ProgramFiles%` 硬编码回退（注册表为准，已回写） |
| 3    | 便携组件   | `{userData}/libreoffice-portable/program/soffice.com`（回退 `soffice.exe`）                                                                                                |

- 同步 invoke `docx2pdf:status` → `{ source: 'custom' | 'system' | 'portable' | 'none', path?: string, customInvalid: boolean, customPath: string }`。
- 注册表探测经注入的命令执行器（可 mock），定位纯函数覆盖 ≥80%。
- 批量任务只在**提交时定位一次**；定位失败 → 整批直接 `SOFFICE_NOT_FOUND`（不进入逐文件循环）。

## 3. 操作与按钮集

### 3.1 转换区（工具页）

| 操作          | 行为                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| 选择文件      | 系统文件选择器（多选，`accept` 见 §1）；经 `bridge.getPathForFile` 取真实路径 |
| 拖拽文件      | DropZone 放下 → 同上取真实路径；非白名单拒绝并提示                            |
| 移除单个      | 文件列表行内 ×：仅从待转列表移除，不影响队列外文件                            |
| 清空          | 清空待转列表，回空态（组件状态横幅保留）                                      |
| 开始转换（N） | 定位组件（none → 不提交，转引导态）→ 提交 `docx2pdf:convert` 批量三段任务     |
| 取消          | 整批取消；等待串行锁期间取消 = 直接 CANCELLED；已 spawn 则杀当前文件进程树    |
| 打开文件夹    | `bridge.revealPath(首个成功产物路径)`（shell.showItemInFolder）               |
| 再转一批      | 清空文件列表与结果，回空态                                                    |

- **批量语义**：单任务内按提交顺序串行转换；某文件失败只记录失败项，**继续后续文件**；全部失败时任务以**首个失败的结构化错误**结束（保持单文件旧语义与 [重试] 入口）。
- 结果卡片：成功 N 个（产物路径列表，可滚动）+ 失败 M 个（`inputPath · 错误码 · 中文文案`），失败项不展示 detail 折叠以减少干扰。
- 转换期间禁用添加/移除/开始/组件管理等写操作，避免队列与状态错乱。

### 3.2 组件管理区（**工具页内**，不进壳设置页——AGENTS §2.1 壳零工具知识）

| 操作         | 行为                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 重新检测     | 重新 invoke `docx2pdf:status`，刷新横幅                                                                                                               |
| 下载安装组件 | 提交 `docx2pdf:install` 任务：下载 MSI（进度 + 断点续传 + 取消清理 `.part`）→ SHA256 校验 → `msiexec /a` 静默解包到便携目录 → 校验 `soffice.exe` 存在 |
| 自定义路径   | 输入 `soffice.exe` 完整路径 + 保存到设置；清空即恢复三级定位                                                                                          |

## 4. IPC 契约（zod 校验，schema 随工具包）

| 通道                | 类型 | 入参                       | 事件                                                                                                                    |
| ------------------- | ---- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `docx2pdf:status`   | sync | `{}`                       | — 返回定位结果（含 `customPath` 回填，见 §2）                                                                           |
| `docx2pdf:set-path` | sync | `{ path }`                 | — 保存 `customPath`（空串=清空恢复三级定位）并返回最新 status；zod 失败 → `INVALID_PAYLOAD`                             |
| `docx2pdf:convert`  | task | `{ inputPaths: string[] }` | `progress { stage: 'locate' \| 'convert' \| 'done', current, total, message }` · `done { outputs, failures }` · `error` |
| `docx2pdf:install`  | task | `{}`                       | `progress { stage: 'download' \| 'install' \| 'done', current, total?, message }` · `done { path }` · `error`           |
| 取消                | 通用 | 任务 id                    | `error { code: 'CANCELLED' }`                                                                                           |

- `done` 形如 `{ outputs: { inputPath, outputPath }[], failures: { inputPath, code, message, detail? }[] }`；`outputs` 保持提交顺序（去重后）。
- progress 映射（实现口径）：`locate(0/total)` → 每文件 `convert(i+1/total)`（message = `i+1/total 转换中：文件名`）→ 全部完成 `done(total/total)`；M9 起产物校验并入 per-file 流程，不再单列 `verify` 阶段。
- **转换串行**：工具内 mutex 门包住**整个批次**，同一时刻至多一个 soffice 进程；排队等待期可取消。
- **安装串行**：独立 mutex（与转换互不阻塞，各自最多一个在跑）。
- 超时：单文件 convert 自 spawn 起 **60s**，超时 `taskkill /T /F` 杀进程树 → `CONVERT_TIMEOUT`（该文件记失败，批次继续）。
- 调用参数固定：`--headless -env:UserInstallation=file:///<每文件独立 profile 目录> --convert-to pdf --outdir <每文件临时目录> <input>`；每文件一个 profile（防串扰与历史僵尸抢锁），文件完成即清理其子目录。

## 5. 错误码 → 中文文案（结构化错误，detail 附 stderr/stdout 尾部 ≤2000 字符）

| 错误码                | 触发条件                                                         | 中文文案                                            | 操作入口              |
| --------------------- | ---------------------------------------------------------------- | --------------------------------------------------- | --------------------- |
| `SOFFICE_NOT_FOUND`   | 三级定位全部失败（批量提交时定位一次）                           | 未检测到 LibreOffice 转换组件，请下载安装或指定路径 | 下载安装 / 自定义路径 |
| `INPUT_NOT_FOUND`     | 预检：输入文件不存在/已移动                                      | 输入文件不存在，请重新选择                          | 重新选择              |
| `INPUT_LOCKED`        | 预检：`open('r')` 独占打开失败（EBUSY/EPERM/EACCES）             | 文件被其他程序占用，请关闭后重试                    | 重试                  |
| `INPUT_LOAD_FAILED`   | soffice exit≠0 且 stderr 含 `source file could not be loaded`    | 文件无法读取（可能已损坏或已加密）                  | 详情                  |
| `CONVERT_TIMEOUT`     | spawn 后 60s 未退出                                              | 转换超时（60 秒），已终止                           | 重试                  |
| `CONVERT_FAILED`      | exit≠0 且非加载失败（组件异常退出）                              | 转换组件异常退出，请重试或查看详情                  | 重试 + 详情           |
| `OUTPUT_MISSING`      | exit=0 但产物缺失 / 0 字节 / 非 `%PDF-` 头                       | 转换未生成有效 PDF                                  | 重试 + 详情           |
| `OUTPUT_WRITE_FAILED` | 建工作目录或产物 move 失败（磁盘满/目录不可写，errno 入 detail） | 磁盘无法写入，请检查剩余空间与目录权限              | 重试                  |
| `SPAWN_FAILED`        | spawn 抛错（路径不存在/权限）                                    | 启动转换组件失败                                    | 详情                  |
| `DOWNLOAD_FAILED`     | 下载重试 3 次仍失败                                              | 组件下载失败，请检查网络后重试                      | 重试                  |
| `CHECKSUM_MISMATCH`   | SHA256 与钉死值不符（文件已删除）                                | 组件校验失败，已删除损坏文件，请重试                | 重试                  |
| `INSTALL_FAILED`      | msiexec 非零退出/超时/解包后无 soffice 入口                      | 组件安装失败，请重试                                | 重试                  |
| `CANCELLED`           | 用户取消（等待锁/下载/转换中）                                   | 已取消                                              | —                     |
| `INVALID_PAYLOAD`     | zod 校验失败（扩展名/数量 1..100/空串）                          | 参数无效                                            | —                     |

> 批次内单文件错误的处理：`INPUT_*` / `CONVERT_*` / `OUTPUT_*` / `SPAWN_FAILED` 记入 `failures` 并继续；整批无任何成功时抛出首个失败错误。`CANCELLED` 直接终止整批（不进入 failures）。

> 锚点（spike 实测）：missing/locked 均 exit=1 + `Error: source file could not be loaded` → 靠**预检**区分；stderr 的 `Could not find platform independent libraries` 为无害噪音，**不得**判为失败——仅 exit code + 产物校验为准。

## 6. 三态（R4）

| 状态   | 呈现                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 空态   | DropZone（拖拽/点击，多选，accept 见 §1）+ 组件状态横幅：`none` → 中文引导 + [下载安装组件] [指定已有路径]；已定位 → 显示来源与路径       |
| 加载态 | 转换：`i/N 转换中：文件名` + 进度条（current/total）+ [取消]；下载：字节进度/百分比（有 total 时）+ [取消]                                |
| 报错态 | 错误码 → 中文文案卡片 + [重试]（可重试码）+ [详情]（detail 折叠）+ `SOFFICE_NOT_FOUND` 额外给 [下载安装]；`INPUT_NOT_FOUND` 给 [重新选择] |

## 7. 输出策略

1. 每个文件写入 `{ctx.paths.temp}/lumin-docx2pdf-<taskId>/f<序号>/`（含独立 profile 子目录），文件完成即删该子目录；任务结束统一删除批次目录。
2. 产物校验：存在 && size>0 && 头 5 字节 `%PDF-`。
3. 移动到**输入文件同目录**：`{原名}.pdf`；已存在则 `{原名}(1).pdf`、`(2)…`（上限 `(99)`，仍冲突报 `OUTPUT_MISSING`）。批量内同名基名文件（如 `同名.docx` 与 `同名.xlsx`）因顺序落盘，第二个自动获得 `(1)` 后缀。
4. 全部文件结束 finally 清理批次目录（清理失败仅记日志，不阻塞）。

## 8. 保真验收（plan §4.3 / §4.9）

- fixture（入库）：
  - `packages/tools/docx2pdf/fixtures/保真样例.docx`（表格、页眉、中文段落与中文字体）
  - `packages/tools/docx2pdf/fixtures/表格样例.xlsx`（中文表头 + 数字单元格，LibreOffice 生成）
  - `packages/tools/docx2pdf/fixtures/演示样例.pptx`（单页中文文本框，LibreOffice 生成）
  - `packages/tools/docx2pdf/fixtures/加密样例.docx`（加密/损坏分支）
- 自动断言：有 soffice 环境才跑的集成/e2e——docx 转换成功 + `pdfjs-dist` 提取文本含 fixture 关键中文串；e2e 批量用例真实转换 docx/xlsx/pptx 三种格式并断言产物 `%PDF-` 头。
- 人工目视（smoke 记录）：docx 表格边框与合并、页眉文字；xlsx 单元格与中文表头；pptx 文本与版式；均无豆腐块/错位。

## 9. 验收清单

- [x] M2：R8 本清单先行；spec 与实现一致（P4 回写：§2 定位口径与 `customPath`、§4 `set-path` 通道与 progress 阶段映射、§5 新增 `OUTPUT_WRITE_FAILED`/`CONVERT_FAILED`/`INSTALL_FAILED`、`open('r')` 预检口径）
- [x] M2：定位纯函数 + schema + 命名/预检/错误映射单测 ≥80%；保真 fixture 集成断言通过；R2 八类冒烟记录；chunk 13,322 B gzip
- [x] M9：格式白名单扩至 6 种扩展名；批量队列（去重/上限 100/串行/失败不中断/全失败抛首错）单测与 e2e 覆盖
- [x] M9：spec 更新（§1/§3.1/§4/§5/§6/§7/§8）+ plan §4.9/M9 登记 + smoke 记录 + CHANGELOG
- [x] M9：门禁全绿（lint/typecheck/test/coverage/boundary/format；audit 为已知 picomatch 例外）；chunk 复测 24,412 B raw / **6,062 B gzip** < 200KB（R5）

## 10. M80 并入：打印（原 print-tool，2026-11-25，plan Q80 / §4.80）

> 原 `docs/spec/print-tool.md` 已并入本节后删除；工具 id 由 `print` 并入 `docx2pdf`，显示名改「**文档输出**」（`version 0.3.0`），两页签「转为 PDF / 打印」。
> 打印为**纯主进程 + 隐藏窗口**能力，零新增依赖/二进制（沿用 Q69：统一系统打印对话框 `silent:false`，不做应用内预览与静默打印）。

### 10.1 页签与通道对照

| Tab（`TabKey`） | 视图                    | 通道（`docx2pdf:{action}`）                                       | 错误码前缀                        |
| --------------- | ----------------------- | ----------------------------------------------------------------- | --------------------------------- |
| `convert`       | ToolView 内联（原能力） | `status` / `convert` / `install` / `set-path` / `reveal`          | `SOFFICE_*` / `CONVERT_FAILED` 等 |
| `print`         | `renderer/PrintTab.vue` | `print-status` / `print-prepare` / `print-show` / `print-cleanup` | `PR_*`                            |

- settings 键：`tools.docx2pdf.print.*`（自定义 soffice 路径与打印相关记忆）；`print-status` 传 `{ customPath }` 即保存。
- 宿主 `NTabs` 使用 `display-directive="show:lazy"`：切换页签不卸载、不中断进行中的转换任务。
- `print-jobId` 映射仅存主进程内存（不落盘），临时产物 `<userData>/temp/lumin-print/<jobId>.pdf|.html`，注册时清理 mtime >24h 残留。

### 10.2 打印页签字段级清单

| 项        | 规则                                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 输入格式  | Office `doc/docx/xls/xlsx/ppt/pptx`；PDF `pdf`；图片 `png/jpg/jpeg/webp/bmp/gif`                                                                                                   |
| 选择方式  | DropZone 拖拽多选 / 点击选择；`getPathForFile` 取绝对路径；同路径去重                                                                                                              |
| 数量/体积 | 1–50 个（超 `PR_TOO_MANY_FILES`）；单文件 ≤500 MiB（超 `PR_TOO_LARGE`）                                                                                                            |
| 按钮集    | 添加文件 / 清空（调 `print-cleanup`）/ 开始打印 / 取消 / 重试（按失败阶段）/ 详情折叠 / 移除 / 重新选择                                                                            |
| 状态机    | `idle → preparing`（`print-prepare`，逐份进度）`→ printing`（逐份串行 `print-show`）`→ done`；任一阶段 error/cancel 回 error/idle                                                  |
| 取消口径  | prepare 取消 → 任务 `CANCELLED` 并清理临时产物；printing 取消 → 关闭打印窗口并中止后续份                                                                                           |
| 用户关框  | 关闭系统打印对话框 → `PR_PRINT_CANCELLED`，**不计入失败**，继续下一份                                                                                                              |
| 结果态    | 成功/失败/已取消份数 + 失败项错误码与文案列表                                                                                                                                      |
| 三态      | 空态 DropZone + 格式/上限说明 + LibreOffice 提示；加载态 `TaskProgress`（含取消），等待对话框用不确定进度 NSpin；报错态 `role="alert"` 中文文案 + 错误码 + 详情 + 可重试码「重试」 |

### 10.3 错误码（沿用 `PR_*`）

| 码                      | 文案                                                | 可重试         |
| ----------------------- | --------------------------------------------------- | -------------- |
| `PR_UNSUPPORTED_FORMAT` | 不支持的文件类型                                    | 否             |
| `PR_NOT_FOUND`          | 文件不存在，请重新选择                              | 否             |
| `PR_LOCKED`             | 文件被其他程序占用，请关闭后重试                    | 是             |
| `PR_TOO_LARGE`          | 文件超过 500 MiB，无法打印                          | 否             |
| `PR_SOFFICE_MISSING`    | 未检测到 LibreOffice 转换组件，无法打印 Office 文件 | 否             |
| `PR_CONVERT_FAILED`     | Office 转 PDF 失败                                  | 是             |
| `PR_CONVERT_TIMEOUT`    | Office 转 PDF 超时（60 秒），已终止                 | 是             |
| `PR_PDF_PASSWORD`       | PDF 已加密，请先解除密码保护                        | 否             |
| `PR_PDF_BROKEN`         | PDF 无法解析（可能已损坏）                          | 否             |
| `PR_PRINT_FAILED`       | 打印失败，请重试或检查打印机                        | 是             |
| `PR_PRINT_CANCELLED`    | 已取消打印                                          | 否（不计失败） |
| `PR_PRINT_BUSY`         | 已有打印任务进行中，请等待完成                      | 是             |
| `PR_INVALID_PATH`       | 文件路径无效                                        | 否             |
| `PR_TOO_MANY_FILES`     | 单次最多打印 50 个文件                              | 否             |

### 10.4 打印实现口径（不变）

- PDF：隐藏 `BrowserWindow`（`plugins:true`、`sandbox:true`、`contextIsolation:true`、`nodeIntegration:false`、无 preload、deny `window.open`、拦截 `will-navigate`）加载 `file://` → `showInactive()` → `webContents.print({ silent:false })`。
- 栅格兜底：视图装载失败时用 `node-kit/pdf` 按 scale 2 逐页渲染 PNG → `@page` A4 HTML → 同窗口打印。
- Office：`node-kit/office` 定位 soffice（自定义 / 系统 / 便携三级）+ 串行锁 + 60s 超时 + `%PDF-` 产物校验。
- 打印前置预检取页数：`PasswordException` → `PR_PDF_PASSWORD`，其余解析失败 → `PR_PDF_BROKEN`；同一时刻仅一份 `print-show`，并发 → `PR_PRINT_BUSY`。

### 10.5 验收（M80）

1. 两页签标签可见，切换不中断转换任务；打印页签空态含格式/上限与组件提示。
2. e2e `docx2pdf-smoke.spec.ts`：页签断言 + dry-run 打印全链路（`%PDF-` 产物 + `print-cleanup`）+ 文件不存在 `PR_NOT_FOUND`。
3. 手工：加密 PDF → `PR_PDF_PASSWORD`；损坏 PDF → `PR_PDF_BROKEN`；51 个文件 → `PR_TOO_MANY_FILES`；取消对话框 → 提示「已取消」无错误卡片。
4. chunk 复测：`docx2pdf-*.js` **46,746 B raw / 10.4KB gzip**（<200KB）；`pnpm gate` 全绿。
