# Shell 冒烟记录（M0）

> 环境：Windows 10.0.19045 · Electron 45.3.1 · Node 24.13.0 · pnpm 12.18.0
> 日期：2026-11-12 · 分支：`feature/m0-skeleton`

## 1. 冒烟总览

| #   | 冒烟项                             | 方式                                                   | 结果                                             |
| --- | ---------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| 1   | 开发窗口（三端 HMR）               | `pnpm dev`                                             | ✅ dev server :5173 + 4 个 electron 进程（窗口） |
| 2   | 生产启动（file:// + module + CSP） | 运行 `release/win-unpacked/Lumin.exe --enable-logging` | ✅ 零 console/CORS/CSP 报错，工具加载成功        |
| 3   | IPC 冒烟（R3，CI 强制）            | `pnpm test:e2e`                                        | ✅ 4/4：清单渲染 / 同步 invoke / 三段式 / 取消   |
| 4   | 单元测试 + 覆盖率（R1）            | `pnpm coverage`                                        | ✅ 73 tests；statements 86.71%（核心文件 ≥80%）  |
| 5   | 质量门禁                           | `pnpm gate`                                            | ✅ lint / typecheck / test / audit(high=0) / dc  |
| 6   | 架构边界                           | `pnpm boundary`                                        | ✅ 62 modules，0 违规                            |
| 7   | 出包（NSIS + portable）            | `pnpm dist`                                            | ✅ setup 116.2MB + portable 105.7MB + latest.yml |
| 8   | **更新冒烟（M0 卡点）**            | `docs/smoke/shell.md` §4 流程                          | ✅ 33.3s：检测 → 下载 → 静默安装 → 0.0.1 运行    |
| 9   | 单实例锁                           | 双开 `Lumin.exe`                                       | ✅ 第二实例立即退出，首实例保持                  |
| 10  | 打包版启动零报错                   | `release/win-unpacked/Lumin.exe --enable-logging`      | ✅ 无 CONSOLE/ERROR/CORS 输出                    |

## 2. R2 八类异常清单（shell 层映射）

> 说明：R2 清单面向**文件类工具**。M0 仅交付壳（无文件读写工具），逐类映射如下；
> 标注「M1 起按工具执行」的类别，将在各工具交付的 `docs/smoke/<tool>.md` 中按本清单逐条手工验证。

| 类别             | 适用性                                              | 验证级别               | 记录                                                                                                                              |
| ---------------- | --------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1. 中文/空格路径 | M0 无文件工具 → 暂不适用                            | —                      | M1 起按工具执行；settings/log 路径经 `app.getPath('userData')`，由 Electron 统一处理                                              |
| 2. 文件被占用    | 暂不适用（settings 采用 tmp+rename 原子写降低风险） | —                      | M1 起按工具执行                                                                                                                   |
| 3. 加密文件      | 暂不适用                                            | —                      | M1 起（docx2pdf/exam-split）                                                                                                      |
| 4. 超大文件      | 暂不适用                                            | —                      | M1 起（PDF/视频工具）                                                                                                             |
| 5. 任务取消      | ✅ 适用                                             | 单测 + e2e             | e2e：`example:sleep` 5s 任务取消 → `CANCELLED/任务已取消` 事件 ✅；单测：排队中/运行中/未知 id 分支 ✅                            |
| 6. 并发溢出      | ✅ 适用                                             | 单测（手工模拟未做）   | 队列满 → `QUEUE_FULL` 结构化错误 ✅；`shell.taskConcurrency` 设置项可配 ✅；真实压满场景待 M1 工具交付时手工补充                  |
| 7. 磁盘满        | 部分适用（settings 写入）                           | 已识别风险，未手工模拟 | settings 写失败会 reject → 设置页「保存失败」错误态；**待 M1 首个写文件工具交付时按工具手工验证**（结构化错误 → 中文文案 → 重试） |
| 8. 断电恢复      | ✅ 适用（settings 原子性）                          | 单测（手工断电未模拟） | 损坏的 settings.json → 恢复 `{}` 并继续运行 ✅；tmp+rename 原子写避免半写状态 ✅                                                  |

## 3. 安全基线确认

| 项                                                                    | 结果                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `contextIsolation: true` / `sandbox: true` / `nodeIntegration: false` | ✅ `apps/desktop/src/main/index.ts` BrowserWindow webPreferences                                           |
| CSP 双保险                                                            | ✅ main `webRequest.onHeadersReceived`（DEV/PROD）+ 生产 `index.html` meta 注入（构建产物已验证含 CSP 头） |
| 导航拦截                                                              | ✅ `will-navigate` preventDefault + `setWindowOpenHandler` deny（代码级；待 M1 工具含外链时补 e2e 断言）   |
| preload 白名单                                                        | ✅ 仅 `contextBridge.exposeInMainWorld('lumin', bridge)`；invoke 响应经 zod 信封校验，错误为结构化 reject  |
| 更新源单点配置                                                        | ✅ `electron-builder.yml` `publish.url`（当前占位，M5 替换为 Gitee raw 固定地址；失败换 OSS 只改一处）     |

## 4. 更新冒烟（M0 卡点）详细步骤与记录

**结果：✅ 通过（33.3s）** —— 旧版 0.0.0 检测到 0.0.1 → 下载 → 静默安装 → 新版报告 `appVersion=0.0.1`。

复现步骤：

```powershell
# 1) 构建旧版（0.0.0，更新源指向本地）
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
pnpm build
pnpm --filter @lumin/desktop exec electron-builder --config electron-builder.yml --publish never `
  "-c.publish.url=http://127.0.0.1:8787"
Move-Item apps/desktop/release/win-unpacked apps/desktop/release/win-unpacked-old

# 2) 升版本构建新版（随后立即还原版本号）
#    将 apps/desktop/package.json version 改为 0.0.1，重复上一条 electron-builder 命令，再改回 0.0.0

# 3) 启动本地更新源（serve apps/desktop/release → http://127.0.0.1:8787）
node <update-server.js>   # 见下方服务脚本要点

# 4) 运行冒烟（守卫：缺产物或更新源未启动时自动 skip）
pnpm --filter @lumin/desktop exec playwright test update-smoke

# 5) 清理：%LOCALAPPDATA%\Programs\Lumin 卸载（Uninstall Lumin.exe /S）、
#    删除 %LOCALAPPDATA%\@lumindesktop-updater 缓存、停掉本地服务
```

更新源脚本要点：Node `http` 服务，根目录 `apps/desktop/release`，拒绝 `..` 路径穿越，端口 `8787`。

用例断言链：`关于 → 检查更新 → 已下载新版本（120s 超时）→ 安装并重启 → 等待安装目录出现 → 结束旧进程 → 启动已安装 exe → appVersion === '0.0.1'`。

注意：`release/` 内产物为**本地 localhost URL 冒烟产物**，不可作为发布资产；正式发布流程见 plan.md §5.2（M5）。

## 5. 已知限制与待办

- **无代码签名**（Q10：一期不买证书）→ 安装时 SmartScreen 提示，M5 README 提供指引。
- Gitee Release 更新源为占位 URL，M5 发布前替换（`apps/desktop/electron-builder.yml` `publish` 单点）。
- §2 中「M1 起按工具执行」的类别，随各工具 `docs/smoke/<tool>.md` 落地。
- Gitee Go CI（`.gitee/workflows/mr-gate.yml`）需在仓库开启 Gitee Go 后验证首跑。
