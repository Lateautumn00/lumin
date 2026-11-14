# Word 转 PDF 冒烟记录（M2）

> 环境：Windows · Electron 45.3.1 · LibreOffice 7.x（注册表 system 定位） · 分支：`feature/m0-skeleton`
> 日期：2026-11-14 · 工具：`@lumin/tool-docx2pdf` v0.1.0

## 1. 冒烟总览

| #   | 冒烟项                                | 方式                                    | 结果                                                                                    |
| --- | ------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | 单测（定位/预检/参数/命名/错误码）    | `pnpm test`                             | ✅ docx2pdf 98 tests / 7 文件；全仓 **257 tests** 全绿                                  |
| 2   | 覆盖率（R1 核心 ≥80%、全仓 ≥60%）     | `pnpm coverage`                         | ✅ 详见 `pnpm gate` 终验（docx2pdf 分组阈值 80% 已在 vitest 配置强制）                  |
| 3   | 质量门禁                              | `pnpm gate`                             | ✅ lint / typecheck / test / audit(high=0) / dependency-cruiser                         |
| 4   | e2e 冒烟（R3 IPC 冒烟 + R2 六类）     | `pnpm test:e2e` docx2pdf 套件           | ✅ **7/7 passed（1.1m）**：status/set-path 往返、真实转换、占用、加密、取消、并发、断电 |
| 5   | 保真人工目视（spec §8）               | 真实转换 fixture → PDF → soffice 转 PNG | ✅ 页眉「Lumin 保真样例页眉 Header Line」正常、表格边框完整、中文无豆腐块、中英混排正常 |
| 6   | R2.4 超大文件                         | 40000 段中文+随机数字 docx（506,314 B） | ✅ 真实应用转换 **55.3s 完成**（<60s 上限），产物 `%PDF-`（50,273,840 B）               |
| 7   | R2.7 磁盘满等价                       | 目标目录 deny `CreateFiles` ACL 现场    | ✅ `OUTPUT_WRITE_FAILED` / 「磁盘无法写入」/ detail=EPERM；无产物、无临时目录残留       |
| 8   | chunk 体积（R5 无求值库 <200KB gzip） | 构建产物实测                            | ✅ `docx2pdf-*.js` 60,188 B raw / **13,322 B gzip**，独占依赖 = 0，远低于基线           |

## 2. R2 八类异常清单（逐条真实验证）

| 类别             | 验证级别 | 记录                                                                                                                                                                                                                           |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. 中文/空格路径 | e2e      | ✅ 目录 `lumin d2p e2e dir`（ASCII+空格）+ 文件 `保真 样例 v2.docx`（中文+空格）真实转换 → `保真 样例 v2.pdf`，`%PDF-` 头校验通过；progress→done 事件链完整                                                                    |
| 2. 文件被占用    | e2e      | ✅ PowerShell `FileShare.None` 独占句柄持有 60s → 转换返回 `INPUT_LOCKED` /「文件被其他程序占用，请关闭后重试」                                                                                                                |
| 3. 加密文件      | e2e      | ✅ LibreOffice UNO `storeToURL(Password)` 生成真加密 docx（CFB 魔数 D0CF11E0）→ soffice `exit=1` + `source file could not be loaded` → `INPUT_LOAD_FAILED`；无产物、无临时目录残留                                             |
| 4. 超大文件      | 真实验收 | ✅ 40000 段 docx（506,314 B，生成 31.9s）→ **55.3s 转换成功**（60s 上限内）；产物 `超大样例(1).pdf` 50,273,840 B，`%PDF-` 头校验通过                                                                                           |
| 5. 任务取消      | e2e      | ✅ 首个 progress 即 `lumin:task:cancel` → `CANCELLED` /「已取消」；轮询临时目录基线无 `lumin-docx2pdf-*` 新增（finally 清理生效）                                                                                              |
| 6. 并发溢出      | e2e      | ✅ 并发提交两任务 → mutex 串行执行，两个 done 事件、两份产物均 `%PDF-`，不丢事件；无临时目录残留                                                                                                                               |
| 7. 磁盘满        | 真实验收 | ✅ 目标目录 `icacls /deny <user>:(WD)`（仅拒 CreateFiles，不影响输入读）→ 转换完成产物后 `moveFile` rename EPERM → **`OUTPUT_WRITE_FAILED`** /「磁盘无法写入，请检查剩余空间与目录权限」/ detail=EPERM；不留产物、不留临时目录 |
| 8. 断电恢复      | e2e      | ✅ 转换中 `taskkill /F /T` 强杀主进程 → 重启后 status 正常（customPath 为空、三级定位命中）+ 再次真实转换成功；进程内队列/锁随进程重建，无持久化污染                                                                           |

### 2.1 R2.7 附带修复（实现偏差回写 spec §5）

- **新增错误码 `OUTPUT_WRITE_FAILED`**：R2.7 类别 7 暴露原错误表缺「磁盘不可写」分支；`makeDir`/`moveFile` 失败统一映射该码（可重试）。
- **结构化错误透传 bug 修复**：errno 码（`EPERM`/`EBUSY`…）本身匹配 `^[A-Z][A-Z0-9_]*$`，`isStructuredError` / `toStructuredError` 曾把原始 fs `Error` 误判为已结构化错误直接泄漏（e2e 实测收到裸 `code=EPERM`）。修复：**`Error` 实例一票否决**，只透传普通对象；`packages/shared` 的 `toStructuredError` 同步修复并补测试。
- 预检 `checkExclusive` 用 `open('r')`：只读输入（只读 ACL/属性）不再被误判 `INPUT_LOCKED`（R2.7 现场只读目录内输入仍可正常进入转换流程）。

## 3. spec §8 保真人工目视（2026-11-14）

方法：真实转换 `fixtures/保真样例.docx` → PDF → soffice `--convert-to png` → 逐项目视。

| 检查项         | 结果                                      |
| -------------- | ----------------------------------------- |
| 页眉           | ✅ 「Lumin 保真样例页眉 Header Line」在位 |
| 标题/正文字体  | ✅ 粗体标题正常，中文无豆腐块             |
| 表格边框       | ✅ 2×2 表格外框+内线完整，无断裂          |
| 中英混排与标点 | ✅ 中英混排、全角括号、数字渲染正常       |
| 表格后段落位置 | ✅ 「表格下方收尾段落」位于表格之后       |

## 4. R5 体积记录

- 口径：gzip；工具专属增量 = `docx2pdf-*.js` **60,188 B raw / 13,322 B gzip**。
- 全部直接依赖（plugin-api / shared / node-kit）均为壳与其它工具共享，**独占依赖 chunk = 0**。
- 无求值库工具基线 <200KB gzip → **13.3KB，达标**（对照：单位换算 37.9KB gzip）。
