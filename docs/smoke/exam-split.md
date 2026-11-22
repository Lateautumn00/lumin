# 试卷切割冒烟记录（M3a PDF 操作 + M3b OCR 切题）

> 环境：Windows · Electron 45.3.1 · 分支：`feature/m0-skeleton`
> 日期：2026-11-15（M3a）/ 2026-11-18（M3b P3）· 工具：`@lumin/tool-exam-split` v0.0.0
>
> **M49（2026-11-21）收敛说明**：PDF 页签已下线「合并/删页/旋转」，仅保留拆分与裁剪；下列 M3a 历史记录中涉及这三项的数据保留不改写，作为当时的验收存档。当前 R2 覆盖以拆分/裁剪为准。

## 1. 冒烟总览

| #   | 冒烟项                                   | 方式                                     | 结果                                                                                                  |
| --- | ---------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | 单测（五算子/区间/命名/错误映射/schema） | `pnpm test`                              | ✅ exam-split **80 tests / 10 文件**；全仓 **369 tests** 全绿                                         |
| 2   | 覆盖率（R1 核心 ≥80%、全仓 ≥60%）        | `pnpm coverage`                          | ✅ exam-split 分组 **96.42% stmts / 83.8% branches / 96.92% fns / 98.31% lines**；全仓 92.94%         |
| 3   | 质量门禁                                 | `pnpm gate`                              | ✅ lint / typecheck(10/10) / test / audit(high=0) / dependency-cruiser / format:check                 |
| 4   | e2e 冒烟（R3 IPC + R2 多类 + 预览渲染）  | `pnpm test:e2e` exam-split 套件          | ✅ **19/19 passed（1 skipped = 既有 update 跳过）**；exam-split 6 用例全过                            |
| 5   | 100 页拆分 <2s（spec §8）                | 集成断言（pdf-lib 生成百页 fixture）     | ✅ `elapsed < 2000ms` 断言通过（`pdf-ops.test.ts`）；e2e 百页卷 `_p1`/`_p100` 产物 `%PDF-`            |
| 6   | R2.4 超大文件                            | 74.7MB 三页卷（每页嵌 24.9MB 随机 PNG）  | ✅ split(2)=370ms / merge=400ms（149.4MB 产物）/ rotate=236ms / delete=176ms / crop=225ms，全 `%PDF-` |
| 7   | R2.7 磁盘满（真实 VHD）                  | diskpart 建 16MB VHD → F:，剩余 2.15MB   | ✅ split/rotate → `OUTPUT_WRITE_FAILED` + detail=`ENOSPC`，**截断半成品 residue=[]**                  |
| 8   | chunk 体积（R5 <200KB gzip）             | 构建产物实测                             | ✅ `exam-split-*.js` raw 843.6KB / **gzip 189.5KB < 200KB**；pdfjs worker 资产单列（见 §4）           |
| 9   | 人工目视（spec §8）                      | soffice 转 PNG + 工具 pdfjs 预览渲染截图 | ✅ 页序/方向/裁剪区域/无豆腐块逐项核对（见 §3）                                                       |

## 2. R2 八类异常清单（逐条真实验证）

| 类别             | 验证级别 | 记录                                                                                                                                                                                                                                                       |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 中文/空格路径 | e2e      | ✅ 目录 `lumin exam split e2e`（ASCII+空格）+ 输入 `期中 卷甲.pdf`（中文+空格）真实执行五算子 → 产物 `期中 卷甲_p1-2.pdf`/`_p3.pdf`/`_合并.pdf`/`_删p2.pdf`/`_旋转180.pdf`/`_裁剪.pdf`，`%PDF-` 头校验通过；冲突时递增 `…(1)` 命名（soffice 批转侧面复测） |
| 2. 文件被占用    | e2e      | ✅ PowerShell `FileShare.None` 独占句柄持有输入 `占用卷.pdf` → `PDF_LOCKED` /「文件被其他程序占用，请关闭后重试」，无产物                                                                                                                                  |
| 3. 加密文件      | e2e      | ✅ 加密 fixture `encrypted.pdf` → `PDF_ENCRYPTED` /「PDF 已加密，请先解除密码再操作」，无产物、预览同步报错                                                                                                                                                |
| 4. 超大文件      | 真实验收 | ✅ 74.7MB 三页卷（一次性脚本生成，不入库）→ split 370ms / merge 400ms / rotate 236ms / delete 176ms / crop 225ms，全部产物 `%PDF-`，无超时                                                                                                                 |
| 5. 任务取消      | e2e      | ✅ 排队任务执行中 `lumin:task:cancel` → `CANCELLED`，队列状态不污染；输入/输出目录无残留                                                                                                                                                                   |
| 6. 并发溢出      | e2e      | ✅ 并发提交超上限任务 → 队列排队执行，全部 done、产物全 `%PDF-`，不丢事件                                                                                                                                                                                  |
| 7. 磁盘满        | 真实验收 | ✅ diskpart `create vdisk maximum=16` + attach → F: 可用 5.15MB，写入 3MB 输入后剩 **2.15MB < 产物 3MB** → split/rotate 均 `OUTPUT_WRITE_FAILED` / detail=`ENOSPC`，**residue=[]（无截断半成品）**，输入不受影响                                           |
| 8. 断电恢复      | e2e      | ✅ 处理中 `taskkill /F /T` 强杀主进程 → 重启后同输入再次处理成功（冲突递增兜底命名），无持久化污染                                                                                                                                                         |

### 2.1 R2.7 附带修复（实现偏差回写 spec §7.4）

- **`writeOutput` 失败清理半成品**：`writeFile` 抛错（ENOSPC/EPERM…）或写后校验失败时，best-effort `unlink(path)` 清掉截断文件，再抛 `OUTPUT_WRITE_FAILED`（detail=errno / `verify-failed`）——磁盘满不再留半成品。
- 新增专项单测 `pdf-ops.writefail.test.ts`（3 个）：ENOSPC 分支 + verify-failed 分支 + 正常路径不触发清理（mock `writeFile`/`unlink`）。

## 3. spec §8 人工目视（2026-11-15）

方法：五算子产物 → soffice `--convert-to png` 看页序/方向/文字；裁剪产物因 **LibreOffice 忽略 CropBox（只认 MediaBox）**，改用工具自身 pdfjs 预览（按 CropBox 渲染）截图核对。

| 检查项       | 结果                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 拆分页序     | ✅ `_p1/_p2/_p3` 分别为 SAN-3 page 1/2/3，页序正确                                                                                                                             |
| 删除页       | ✅ `_删p2` 首页 = SAN-3 page 1（第 2 页已去，第 1、3 页保留）                                                                                                                  |
| 旋转方向     | ✅ `_旋转90` 顺时针 90° 竖排正确，无颠倒                                                                                                                                       |
| 裁剪区域     | ✅ CropBox 数值 `{59.5, 84.2, 476.2, 673.5}`（= 0.1/0.1/0.8/0.8 比例换算精确）；pdfjs 预览可见区域 = 分隔线横贯、**文字被裁掉**（baseline y=760 > CropBox 顶 757.7），符合预期 |
| 豆腐块       | ✅ 五算子产物中文均正常渲染，无豆腐块                                                                                                                                          |
| 命名冲突递增 | ✅ 重复生成 → `…(1)` 递增（soffice 批转输出侧面复测）                                                                                                                          |

## 4. R5 体积记录

- 口径：gzip（2026-11-13 M1 决策：工具 chunk + 独占依赖 chunk；运行时资产单列不计入）。
- `exam-split-*.js`：**M49 复测 raw 705,122 B / gzip 177,363 B（173.2KB）< 200KB 基线 ✅**（PDF 页签收敛为拆分/裁剪、OCR 能力不变；较 M3b P4 gzip 184.1KB 减少 6.8KB）。M3b P4 复测 raw 733.5KB / gzip 184.1KB、M3a 历史值 raw 843.6KB / gzip 189.5KB、P3 值 712.0KB / 177.6KB 保留不改写。对照：计算器 214.3KB、单位换算 37.9KB（同一未压缩构建口径，未复测）。
- M49 e2e 复跑：`exam-split-smoke` 13/13 + `ocr-text-smoke` 4/4，合计 17 passed（`--workers=1`，真实模型）。
- 运行时资产单列（按需加载，不计入上限）：
  - renderer `pdf.worker.min-*.mjs` raw 1,242.1KB / **gzip 370.4KB**
  - 主进程 `out/main/chunks/ocr.worker-*.js` raw 1,119.6KB / gzip 306.8KB（推理 + pdfjs 渲染，worker 内按需；P4 切 onnxruntime-node 后较 wasm 版 +30KB）
  - 主进程 `out/main/chunks/pdf.worker-*.js`（pdf-lib worker，不属 R5 口径）raw 1,067.4KB / gzip 288.9KB
  - OCR 模型 `binaries/ocr/` 16.2MB（det 4.7 + rec 10.9 + cls 0.6 + dict 0.03，gitignore，fetch 脚本 SHA256 钉死）
  - onnxruntime-node native（win32 x64，P4 起随包，asarUnpack）：**≈68.6MB**（onnxruntime.dll 31.7 + DirectML.dll 18.5 + dxcompiler.dll 18.0 + binding 0.36；打包态走 extraResources 同级随包）
- 依赖方向核对：pdfjs-dist（renderer）与 pdf-lib（主进程 worker）为 exam-split 独占依赖，已分仓隔离。

## 5. M3b OCR 切题冒烟（2026-11-18，P3）

> 口径：真实模型（`binaries/ocr/` 四件套）+ 真实 Electron 构建产物；e2e 套件 `e2e/exam-split-smoke.spec.ts`（11 用例，workers=1 串行）。

### 5.1 总览

| #   | 冒烟项                            | 方式                            | 结果                                                                                                                                  |
| --- | --------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 单测（OCR schema/编排/编辑模型）  | `pnpm test`                     | ✅ exam-split **237 tests / 22 文件**（`ocr-edit` 24 + `ocr-workspace` 3 + `pdf-open` 3 + 既有组）；全仓 **526 tests / 51 文件** 全绿 |
| 2   | 覆盖率（R1 核心 ≥80%、全仓 ≥60%） | `pnpm coverage`                 | ✅ exam-split 分组 **lines 97.90% / branches 83.74%**；全仓 93.65/85.37/91.52/95.83                                                   |
| 3   | 质量门禁                          | `pnpm gate`                     | ✅ lint / typecheck(10/10) / test / dependency-cruiser 绿；⚠️ audit 新增外部 high advisory（无修复版，见 5.4）                        |
| 4   | e2e（真实模型 + 真实构建）        | `pnpm test:e2e` exam-split 套件 | ✅ **11/11 passed**（PDF 6 + OCR 5）                                                                                                  |
| 5   | chunk 体积（R5 <200KB gzip）      | 构建产物实测                    | ✅ `exam-split-*.js` raw 712.0KB / **gzip 177.6KB**（见 §4）                                                                          |
| 6   | 单页 OCR ≤3s（R1，合成卷）        | 构建产物真实 spawn（三页卷）    | ✅ 2.25s / 3 页 ≈ **750ms/页**（A4@1.5 893×1263，regions 1/1/1）；真实样卷口径待 P4                                                   |

### 5.2 R2 八类异常（OCR 侧）

| 类别             | 验证级别 | 记录                                                                                                                                                     |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 中文/空格路径 | e2e      | ✅ 临时目录 `lumin ocr image` + 输入 `样卷 图片.png`（中文+空格）→ 识别/导出成功，产物 `样卷 图片_题1.png`（`\x89PNG`）、`样卷 图片_切题.pdf`（`%PDF-`） |
| 2. 文件被占用    | 复用 M3a | ✅ PDF 输入占用 → `PDF_LOCKED`（OCR detect 走同一 readFile 分类，§10.5 分界已覆盖；e2e 占用用例在 PDF 套件）                                             |
| 3. 加密文件      | e2e      | ✅ `encrypted.pdf` → `ocr-detect` 回 `PDF_ENCRYPTED` /「PDF 已加密，请先解除密码再操作」，无读数、无产物                                                 |
| 4. 超大文件      | e2e + P2 | ✅ 1200×1600 合成大图（R2.4 大图口径）识别 + 导出通过；百页 PDF 取消路径见第 5 类；74.7MB 超大 PDF 已在 M3a 验证不超时                                   |
| 5. 任务取消      | e2e      | ✅ 百页卷 `ocr-detect` 首个进度即 `lumin:task:cancel` → `CANCELLED`，无残留产物、队列可继续                                                              |
| 6. 并发溢出      | 复用 M3a | ✅ OCR 走同一壳队列（OCR 档位=2），M3a 并发用例已验证排队不丢事件；OCR 侧合并提交并发无跨任务状态（会话按 Tab 单实例）                                   |
| 7. 磁盘满        | 复用 M3a | ✅ 导出走同 `writeFile` + `OUTPUT_WRITE_FAILED` 分类，M3a VHD ENOSPC 实测覆盖截断清理；OCR 导出失败清理本批全部已写文件（spec §10.9）                    |
| 8. 断电恢复      | 复用 M3a | ✅ 同进程队列/冲突递增兜底；M3a `taskkill /F /T` 重启后重处理成功用例覆盖                                                                                |
| 9. 模型缺失      | e2e      | ✅ 临时移走 `binaries/ocr/det.onnx` → `ocr-detect` 回 `MODEL_MISSING` /「识别模型缺失，请在设置中下载后重试」；`finally` 原位恢复模型文件                |
| 10. 输入损坏     | e2e      | ✅ 非图片字节 `坏图.png` → `OCR_INPUT_INVALID` /「图片无法读取，请换一张清晰的图片」                                                                     |

### 5.3 交互与三态核对（R4）

- 空态：OCR Tab 首次激活 → DropZone（accept PDF+PNG/JPG/JPEG/WebP）+ 左侧预览占位引导，无白屏。
- 加载态：detect 显示阶段进度（`加载识别模型…`/`识别第 n/N 页…`）+ [取消]；export 无 message → 显示「正在导出…」。
- 报错态：结构化码 → 中文文案卡 + [重试]（可重试码）/ [重新选择]；`NO_REGIONS` 额外 [手动添加边界] → 手动模式（预览 meta 建页、当前页整页题区、点击插入分界线）。
- 微调：分界线 `role="slider"` 拖拽/键盘（↑/↓ 0.005、Delete、Esc）；[添加边界] 拆分命中列题区；[重置本页] 仅当前页（自动页恢复、手动页清空）；题目列表点击定位预览。
- e2e 已覆盖：图片识别 → 键盘微调（aria-valuenow 变化）→ 导出 PNG+PDF；三页卷 PDF 每页 ≥1 题区。

### 5.4 已知外部风险与 P4 待办

- ⚠️ `pnpm audit` 新增 high advisory **GHSA-fc5q-39xc-vjpf**（picomatch ≤4.0.7 ReDoS，`first_patched_version: null`）：命中 vite/eslint 构建期依赖，不进应用运行时产物；上游无修复版，升级后清零（plan §4.4 已记，不放宽规则）。
- ~~P4 待办~~：✅ 已完成（9 文件 11 页真实样卷入库 `fixtures/ocr/`，逐卷命中率/耗时见 §5.5，R1 量化验收关闭——spec §10.10 全勾）。

### 5.5 P4 真实样卷量化验收（2026-11-18，R1 收口）

> 口径：真实模型（`binaries/ocr/`）+ 真实 `ocr-detect` 完整管线（渲染 + det + rec + 聚类），临时 vitest 基准（跑完即删）计时，预热一轮取第二轮；逐卷数据与引擎切换决策见 spec §10.12 / plan §4.4。

| #   | 验收项（spec §10.10）                | 方式                                        | 结果                                                                                                                                                 |
| --- | ------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 样卷测试集入库                       | `fixtures/ocr/` 9 文件 11 页（git 跟踪）    | ✅ 跨页展开照 2 + 截屏 2 + 侧拍 2 + PDF 3（2 个内嵌侧拍）——手写/印刷/双栏/带图/跨页/侧拍全覆盖                                                       |
| 2   | 页面旋转（0/90/180/270）             | 真实样卷（4 侧拍 + 2 内嵌侧拍 PDF 无 EXIF） | ✅ rot270 复原全部出正确题区；未旋转时整页 1 题区（题号行 0）；PDF2 rot90 仅 3+4 → rot270 4+9 佐证方向必要性                                         |
| 3   | 跨页展开拆分                         | 图1/图2 书脊栏缝                            | ✅ 覆盖率谷底切分（0.47/0.53），页脚跨缝行归右页末题                                                                                                 |
| 4   | 命中率 ≥90% 或每题微调 ≤1 次         | 自动题区 vs 人工判读（105 题）              | ✅ **90.5%（95/105）主口径达标**；替代口径 ≈0.10 次/题（单题 ≤1）同样满足；缺口集中在嵌套小题（图4/图5）                                             |
| 5   | 单页 OCR ≤3s（R1 硬性）              | 端到端计时                                  | ✅ **1.10–1.54s/页**（onnxruntime-node；wasm 3.3–4.7s/页超限 → R1 流程切换，提速 2.6–3.8×）                                                          |
| 6   | 单测/覆盖率/门禁                     | `pnpm test` / `pnpm coverage` / `pnpm gate` | ✅ 全仓 **539 tests / 52 文件**；coverage 分组阈值通过、全仓 93.71/84.95/91.60/95.92；lint/typecheck/boundary/format 绿；audit 仅已知 picomatch 例外 |
| 7   | e2e（真实模型 + 真实构建，含新能力） | `pnpm test:e2e` exam-split 套件             | ✅ **13/13 passed**（PDF 6 + OCR 7：新增旋转 e2e 用例 + 模型缺失用例改用真实模型文件移走/恢复）                                                      |
| 8   | chunk/资产体积（R5）                 | 构建产物实测                                | ✅ renderer chunk 184.1KB gzip（<200KB）；ocr.worker 306.8KB gzip 单列；onnxruntime-node native ≈68.6MB 单列（§4）                                   |

- **引擎切换记录（R1 流程闭环）**：M3b P0 钉 onnxruntime-web（wasm）→ P4 真实卷 3.3–4.7s/页超 ≤3s → 用户拍板切 **onnxruntime-node 1.31.1**（CPU EP、NAPI binding）：依赖换钉（exam-split + desktop 双包）、`asarUnpack` 改 native 目录、`allowBuilds` 放行 postinstall、`loadOrt` 去 wasm env。同管线复测 2.6–3.8× 提速；预处理/CTC 口径不变，题区数受 det 浮点差异微调（图3 5→6、图4 7→8、图1 13→12）→ 命中率 89.5%→90.5% 转达标。
- **binaries 根修复（P4 e2e 发现）**：pnpm `.pnpm` 目录布局使 Electron 误判 `app.isPackaged=true`（execPath 为 `.pnpm/.../electron/dist/electron.exe`），e2e 下模型路径错指向 `electron/dist/resources/binaries` → `MODEL_MISSING det: ENOENT`（6 用例红）。修复：`ToolPaths.binaries` 改为探测 `resources/binaries` 存在，回落仓库根 `binaries/`，不再依赖 `isPackaged`（CSP/updater 语义不受影响）。修复后 13/13 全绿。
