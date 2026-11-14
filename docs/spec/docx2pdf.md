# Word 转 PDF — 字段级功能清单（M2 验收附件）

> 依据 AGENTS §11：开工前定稿。变更须同步更新本文件与 `docs/opencode/plan.md` §4.3。
> 工具 id：`docx2pdf` · 显示名：**Word 转 PDF** · 包：`@lumin/tool-docx2pdf`

## 1. 输入项

| 字段           | 类型                             | 约束                                                                              | 默认值 |
| -------------- | -------------------------------- | --------------------------------------------------------------------------------- | ------ |
| 输入文件       | 文件路径（单选，.doc/.docx）     | 必须存在、可读、未被其他程序独占占用                                              | 无     |
| 自定义组件路径 | 设置 `tools.docx2pdf.customPath` | string；指向 `soffice.exe` 的完整路径；无效（文件不存在）时**回退**系统检测并提示 | `''`   |

## 2. soffice 三级定位（顺序取首个有效项）

| 顺序 | 来源       | 判定                                                                                                                                                                       |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 自定义路径 | `customPath` 非空且该文件存在（`.com`/`.exe` 结尾）                                                                                                                        |
| 2    | 系统安装   | 注册表 `HKLM/HKCU\SOFTWARE\LibreOffice\UNO\InstallPath` → `<path>\program\soffice.com`（回退 `soffice.exe`）；**未实现** `%ProgramFiles%` 硬编码回退（注册表为准，已回写） |
| 3    | 便携组件   | `{userData}/libreoffice-portable/program/soffice.com`（回退 `soffice.exe`）                                                                                                |

- 同步 invoke `docx2pdf:status` → `{ source: 'custom' | 'system' | 'portable' | 'none', path?: string, customInvalid: boolean, customPath: string }`（`customPath` 供设置输入框回填，实现已返回，回写本行）。
- 注册表探测经注入的命令执行器（可 mock），定位纯函数覆盖 ≥80%。

## 3. 操作与按钮集

### 3.1 转换区（工具页）

| 操作       | 行为                                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| 选择文件   | 点击打开系统文件选择器（`accept` .doc/.docx）；经 `bridge.getPathForFile` 取真实路径 |
| 拖拽文件   | DropZone 放下 → 同上取真实路径；非 .doc/.docx 拒绝并提示                             |
| 开始转换   | 定位组件（none → 不提交，转引导态）→ 提交 `docx2pdf:convert` 三段任务                |
| 取消       | 通用任务取消；等待串行锁期间取消 = 直接 CANCELLED；已 spawn 则杀进程树               |
| 打开文件夹 | `bridge.revealPath(产物路径)`（shell.showItemInFolder）                              |
| 再转一个   | 清空文件卡与结果，回空态（组件状态横幅保留）                                         |

### 3.2 组件管理区（**工具页内**，不进壳设置页——AGENTS §2.1 壳零工具知识）

| 操作         | 行为                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 重新检测     | 重新 invoke `docx2pdf:status`，刷新横幅                                                                                                               |
| 下载安装组件 | 提交 `docx2pdf:install` 任务：下载 MSI（进度 + 断点续传 + 取消清理 `.part`）→ SHA256 校验 → `msiexec /a` 静默解包到便携目录 → 校验 `soffice.exe` 存在 |
| 自定义路径   | 输入 `soffice.exe` 完整路径 + 保存到设置；清空即恢复三级定位                                                                                          |

## 4. IPC 契约（zod 校验，schema 随工具包）

| 通道                | 类型 | 入参            | 事件                                                                                                                  |
| ------------------- | ---- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `docx2pdf:status`   | sync | `{}`            | — 返回定位结果（含 `customPath` 回填，见 §2）                                                                         |
| `docx2pdf:set-path` | sync | `{ path }`      | — 保存 `customPath`（空串=清空恢复三级定位）并返回最新 status；zod 失败 → `INVALID_PAYLOAD`（新增，回写 §4）          |
| `docx2pdf:convert`  | task | `{ inputPath }` | `progress { stage: 'locate' \| 'convert' \| 'verify' \| 'done', current, message }` · `done { outputPath }` · `error` |
| `docx2pdf:install`  | task | `{}`            | `progress { stage: 'download' \| 'install' \| 'done', current, total?, message }` · `done { path }` · `error`         |
| 取消                | 通用 | 任务 id         | `error { code: 'CANCELLED' }`                                                                                         |

- progress 映射（实现口径，回写）：convert 四阶段 `locate(0)→convert(1)→verify(2)→done(3)`；install 三阶段 `download(字节 current/total)→install(0)→done(1)`。spec 原稿的 `verify/extract` 安装阶段未实现，以本行为准。

- **转换串行**：工具内 mutex 门，同一时刻至多一个 soffice 进程；排队等待期可取消。
- **安装串行**：独立 mutex（与转换互不阻塞，各自最多一个在跑）。
- 超时：convert 自 spawn 起 **60s**，超时 `taskkill /T /F` 杀进程树 → `CONVERT_TIMEOUT`。
- 调用参数固定：`--headless -env:UserInstallation=file:///<task 独立 profile 目录> --convert-to pdf --outdir <临时目录> <input>`；**每任务独立 profile**（防与用户实例/历史僵尸抢锁，spike 实证同 profile 残留实例会假 exit 0），finally 清理 profile 与临时目录。

## 5. 错误码 → 中文文案（结构化错误，detail 附 stderr/stdout 尾部 ≤2000 字符）

| 错误码                | 触发条件                                                         | 中文文案                                            | 操作入口                |
| --------------------- | ---------------------------------------------------------------- | --------------------------------------------------- | ----------------------- |
| `SOFFICE_NOT_FOUND`   | 三级定位全部失败                                                 | 未检测到 LibreOffice 转换组件，请下载安装或指定路径 | 下载安装 / 自定义路径   |
| `INPUT_NOT_FOUND`     | 预检：输入文件不存在/已移动                                      | 输入文件不存在，请重新选择                          | 重新选择                |
| `INPUT_LOCKED`        | 预检：`open('r')` 独占打开失败（EBUSY/EPERM/EACCES）             | 文件被其他程序占用，请关闭后重试                    | 重试                    |
| `INPUT_LOAD_FAILED`   | soffice exit≠0 且 stderr 含 `source file could not be loaded`    | 文件无法读取（可能已损坏或已加密）                  | 详情                    |
| `CONVERT_TIMEOUT`     | spawn 后 60s 未退出                                              | 转换超时（60 秒），已终止                           | 重试                    |
| `CONVERT_FAILED`      | exit≠0 且非加载失败（组件异常退出）                              | 转换组件异常退出，请重试或查看详情                  | 重试 + 详情             |
| `OUTPUT_MISSING`      | exit=0 但产物缺失 / 0 字节 / 非 `%PDF-` 头                       | 转换未生成有效 PDF                                  | 重试 + 详情             |
| `OUTPUT_WRITE_FAILED` | 建工作目录或产物 move 失败（磁盘满/目录不可写，errno 入 detail） | 磁盘无法写入，请检查剩余空间与目录权限              | 重试（新增，R2.7 回写） |
| `SPAWN_FAILED`        | spawn 抛错（路径不存在/权限）                                    | 启动转换组件失败                                    | 详情                    |
| `DOWNLOAD_FAILED`     | 下载重试 3 次仍失败                                              | 组件下载失败，请检查网络后重试                      | 重试                    |
| `CHECKSUM_MISMATCH`   | SHA256 与钉死值不符（文件已删除）                                | 组件校验失败，已删除损坏文件，请重试                | 重试                    |
| `INSTALL_FAILED`      | msiexec 非零退出/超时/解包后无 soffice 入口                      | 组件安装失败，请重试                                | 重试                    |
| `CANCELLED`           | 用户取消（等待锁/下载/转换中）                                   | 已取消                                              | —                       |
| `INVALID_PAYLOAD`     | zod 校验失败                                                     | 参数无效                                            | —                       |

> 锚点（spike 实测）：missing/locked 均 exit=1 + `Error: source file could not be loaded` → 靠**预检**区分；stderr 的 `Could not find platform independent libraries` 为无害噪音，**不得**判为失败——仅 exit code + 产物校验为准。

## 6. 三态（R4）

| 状态   | 呈现                                                                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 空态   | DropZone（拖拽/点击，accept .doc/.docx）+ 组件状态横幅：`none` → 中文引导 + [下载安装组件] [指定已有路径]；已定位 → 显示来源与路径 |
| 加载态 | 转换：阶段进度（定位→转换→校验，转换阶段不确定进度）+ [取消]；下载：字节进度/百分比（有 total 时）+ [取消]                         |
| 报错态 | 错误码 → 中文文案卡片 + [重试]（可重试码）+ [详情]（detail 折叠）+ `SOFFICE_NOT_FOUND` 额外给 [下载安装]                           |

## 7. 输出策略

1. 转换写入 `{ctx.paths.temp}/lumin-docx2pdf-<taskId>/`（含独立 profile 子目录）。
2. 产物校验：存在 && size>0 && 头 5 字节 `%PDF-`。
3. 移动到**输入文件同目录**：`{原名}.pdf`；已存在则 `{原名}(1).pdf`、`(2)…`（上限 `(99)`，仍冲突报 `OUTPUT_MISSING`）。
4. finally 清理临时目录（清理失败仅记日志，不阻塞）。

## 8. 保真验收（plan §4.3）

- fixture：`packages/tools/docx2pdf/fixtures/保真样例.docx`（含**表格、页眉、中文段落与中文字体**），入库。
- 自动断言：有 soffice 环境才跑的集成测试——转换成功 + `pdfjs-dist` 提取文本含 fixture 关键中文串；CI 无 soffice → guard skip（同 update-smoke 模式）。
- 人工目视（smoke 记录）：表格边框与合并、页眉文字、中文字体渲染无豆腐块/错位。

## 9. 验收清单

- [x] R8 本清单先行（本文件）；spec 与实现一致（P4 回写：§2 定位口径与 `customPath`、§4 `set-path` 通道与 progress 阶段映射、§5 新增 `OUTPUT_WRITE_FAILED`/`CONVERT_FAILED`/`INSTALL_FAILED`、`open('r')` 预检口径）
- [x] 定位纯函数 + schema + 命名/预检/错误映射单测 ≥80%（核心分组）；全仓 ≥60%（终验：docx2pdf 98 tests，全仓 257 tests，coverage 91.36% stmts / 86.81% 分支）
- [x] 保真 fixture 集成断言通过（本机有 soffice）；e2e 13 passed（docx2pdf 7 + ipc 冒烟 6，update-smoke guard skip）
- [x] `docs/smoke/docx2pdf.md` R2 八类逐条真实记录（含 §8 人工目视）
- [x] 门禁全绿（lint/typecheck/test/coverage/boundary/format/audit）；chunk 13,322 B gzip < 200KB（R5，无三方求值库）
- [x] 组件下载 URL + SHA256 钉死于代码常量（AGENTS §10），`pnpm audit` 无 high/critical
