# 试卷切割冒烟记录（M3a）

> 环境：Windows · Electron 45.3.1 · 分支：`feature/m0-skeleton`
> 日期：2026-11-15 · 工具：`@lumin/tool-exam-split` v0.0.0（PDF 操作五算子：拆分/合并/删除/旋转/裁剪）

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
- `exam-split-*.js`：raw **843.6KB** / **gzip 189.5KB** < 200KB 基线 ✅（对照：计算器 214.3KB、单位换算 37.9KB）。
- 运行时资产单列（按需加载，不计入上限）：
  - renderer `pdf.worker.min-*.mjs` raw 1,242.1KB / **gzip 370.4KB**
  - 主进程 `out/main/chunks/pdf.worker-5011d310.js`（pdf-lib worker，不属 R5 口径）
- 依赖方向核对：pdfjs-dist（renderer）与 pdf-lib（主进程 worker）为 exam-split 独占依赖，已分仓隔离。
