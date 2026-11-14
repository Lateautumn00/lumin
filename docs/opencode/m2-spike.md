# M2 Phase 0 — LibreOffice 组件分发 spike 记录

> 日期：2026-11-13 · 分支：`feature/m0-skeleton` · 依据：plan.md §4.3 / AGENTS §10（固定 URL + SHA256 钉死）
> 结论：**按需下载 + `msiexec /a` 静默解包方案成立**，无需回退 PortableApps 方案。

## 1. 下载源选定

| 源                 | 状态                            | 说明                                                                                                             |
| ------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **aliyun（主源）** | ✅ 可用，支持 HTTP 206 断点续传 | `https://mirrors.aliyun.com/libreoffice/stable/26.8.3/win/x86_64/LibreOffice_26.8.3_Win_x86-64.msi`              |
| TDF 官方（回退）   | ⚠️ 间歇 502（目录/文件均出现）  | `https://download.documentfoundation.org/libreoffice/stable/26.8.3/win/x86_64/LibreOffice_26.8.3_Win_x86-64.msi` |
| TUNA / BFSU / NJU  | ❌ 404（无 26.8.3 或路径不同）  | 不采用                                                                                                           |
| USTC               | ❌ 403                          | 不采用                                                                                                           |

**钉死常量**（实现写入 `docx2pdf` 组件模块）：

```
URL primary   = https://mirrors.aliyun.com/libreoffice/stable/26.8.3/win/x86_64/LibreOffice_26.8.3_Win_x86-64.msi
URL fallback  = https://download.documentfoundation.org/libreoffice/stable/26.8.3/win/x86_64/LibreOffice_26.8.3_Win_x86-64.msi
SIZE          = 376,311,808 bytes
SHA256        = 0e6918c273eabbdbbd800ee0dacbbf130a14c13c2e4cec861b06dd59e015bf94
VERSION       = LibreOffice 26.8.3（winget 显示 26.8.3.1）
```

- 无官方 sha256 旁车（`.sha256`/`SHA256SUMS` 均 404/502）→ **SHA256 以本地下载计算值钉死**。
- 信任锚补强：MSI **Authenticode 签名 Valid**（Signer `CN=The Document Foundation, O=The Document Foundation`，Issuer `Certum Code Signing 2021 CA`，有效期 2026-10-07 ~ 2028-01-09）。

## 2. 静默解包（便携组件）验证

```
msiexec /a <msi> /qn TARGETDIR=<userData>\libreoffice-portable
→ exit 0，耗时 40.5s，解包 1,603,968,965 bytes（≈1.50 GiB）
→ <TARGETDIR>\program\soffice.exe 与 soffice.com 均存在
```

- `/a`（administrative install）**无需管理员权限**，纯文件复制 ✅。
- 解包树**独立运行验证**：`portable-test\program\soffice.com --headless … --convert-to pdf` → exit 0、17.3s、产物 PDF 与系统安装版一致（19,658 B）✅ 无对系统安装的隐性依赖。
- **磁盘占用**：下载 358.8 MiB + 解包 1.50 GiB ≈ **1.86 GiB**（临时 MSI 删除后常驻 1.50 GiB）；下载前需向用户提示空间需求。

## 3. 系统定位验证（本机）

- 注册表 `HKLM\SOFTWARE\LibreOffice\UNO\InstallPath` → `D:\software\LibreOffice\program`（**自定义安装路径，非 Program Files**——实证注册表探测为必需项）。
- `Program Files\LibreOffice\program\soffice.exe` 默认路径探测保留为兜底。
- 本机 winget 版本：`TheDocumentFoundation.LibreOffice 26.8.0.3`（可用 26.8.3.1）。

## 4. 转换行为与耗时基线

| 场景                             | exit | 耗时  | 输出                                                                    |
| -------------------------------- | ---- | ----- | ----------------------------------------------------------------------- |
| 冷转（系统安装、新 profile）     | 0    | 12.3s | stdout `convert … using filter : writer_pdf_Export`                     |
| 暖转（同 profile）               | 0    | 7.1s  | 同上                                                                    |
| 冷转（便携解包树、新 profile）   | 0    | 17.3s | 同上                                                                    |
| 输入文件不存在                   | 1    | 1.0s  | stderr `Error: source file could not be loaded`                         |
| 输入文件被独占占用（无共享打开） | 1    | 1.0s  | stderr `Error: source file could not be loaded`（与缺文件**不可区分**） |
| 垃圾内容 .docx（非 zip）         | 0    | 2.0s  | **仍产出 PDF**（LO 文本回退，宽松处理，非错误）                         |

**60s 超时基线充足**（最慢 17.3s，真实大文档留 3.5x 余量）。

## 5. 关键陷阱（写入实现约束）

1. **同 profile 实例转发 → 假 exit 0**：同 `UserInstallation` 已有存活实例时，新调用把参数转发给旧实例后立即退 0，**不保证转换发生**；残留僵尸实例还会让后续调用无限挂起（实测 180s 无输出）。
   → **约束：每任务独立 profile 目录**（`<temp>/lumin-docx2pdf-<taskId>/profile`），任务 finally 删除；禁止复用共享 profile。
2. **杀进程必须杀树**：`soffice.exe` 会派生 `soffice.bin`，只杀父进程会留僵尸持锁。
   → **约束：node-kit `runProcess` 超时/取消一律 `taskkill /pid <pid> /T /F`（win32）**。
3. **stderr 有固定噪音**：`Could not find platform independent libraries <prefix>` 每次出现。
   → **约束：stderr 非空 ≠ 失败；判定只看 exit code + 产物校验**（`%PDF-` 头 + size>0）。
4. **missing 与 locked 同错误文案**：soffice 层无法区分。
   → **约束：spawn 前预检**——`fs.access` 不存在 → `INPUT_NOT_FOUND`；`open(path, 'r+')` EBUSY/EPERM → `INPUT_LOCKED`。
5. **`soffice.com`（console 包装）优于 `soffice.exe`**：退出码与 stdout/stderr 捕获可靠（GUI 子系统 exe 在重定向下表现不稳）。
   → **约束：定位到 program 目录后调用 `soffice.com`，回退 `soffice.exe`**。

## 6. 对计划的修订

- 下载源由「TUNA 优先」改为「**aliyun 优先 + TDF 官方回退**」（TUNA 实测 404；aliyun 实测可用且支持断点续传）。
- 组件空间提示（1.86 GiB 峰值）加入空态引导文案。
- 其余（三级定位、串行、60s 超时、独立 profile、产物校验）与 plan §4.3 一致，无需修订。
