# 实用工具冒烟记录（M43 首版 · M51 增屏幕标尺）

> 环境：Windows · 分支 `feature/m51-screen-ruler` · 工具：`@lumin/tool-misc-toolbox` v0.2.0
> 日期：2026-11-21 · IP / 计时器为纯 renderer；屏幕标尺新增单通道 IPC（`misc-toolbox:capture-display`）

## 1. 冒烟总览

| #   | 冒烟项                                      | 方式                                               | 结果                                                                                     |
| --- | ------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | 单测（ip / clock / ruler / node / schema / errors / 清单） | `pnpm exec vitest run packages/tools/misc-toolbox` | ✅ 7 files / 70 tests（ip 23 / clock 16 / ruler 11 / node 8 / schema 8 / errors 3 / manifest 1） |
| 2   | 覆盖率（R1 核心 ≥80%）                      | 同上 + `--coverage`（限包）                        | ✅ 语句 97.76%（175/179）、分支 92.1%（105/114）、函数 97.5%（39/40）、行 99.31%（144/145） |
| 3   | 包 typecheck                                | `pnpm --filter @lumin/tool-misc-toolbox typecheck` | ✅ 通过                                                                                  |
| 4   | 公共包 typecheck                            | `node-kit` / `shared` / `color-toolbox`            | ✅ 全部通过（color-toolbox 委托后单测零改动）                                            |
| 5   | 壳 typecheck（web/node/e2e 三套）           | `pnpm --filter @lumin/desktop typecheck`           | ✅ 通过（含新增 e2e 用例）                                                               |
| 6   | 构建                                        | `pnpm --filter @lumin/desktop build`               | ✅ 产物正常，生成 `misc-toolbox-mgZZGYF0.js`                                             |
| 7   | chunk 体积（R5 <200KB gzip）                | 构建产物实测                                       | ✅ **62,015 B raw / 15,139 B gzip**，无独占依赖 chunk                                    |
| 8   | e2e 冒烟（R3）                              | `e2e/misc-toolbox-smoke.spec.ts`（6 例）           | ✅ **6/6 通过（22.2s）**：三页签 / CIDR / CIDR 报错 / 屏幕标尺截屏拖拽 + Esc / 秒表 / 番茄钟             |
| 9   | Lint / 格式化                               | `eslint` + `prettier --check`（新增与改动文件）    | ✅ 无告警                                                                                |

## 2. R2 八类异常清单

> IP / 计时器只读输入文本、全同步纯函数 + 本地计时；屏幕标尺新增只读截屏（desktopCapturer）与剪贴板写入，无文件 IO、无落盘、无网络、无队列；按 `docs/smoke/shell.md` §2 约定逐类映射。

| 类别             | 适用性                                 | 验证级别            | 记录                                                                                                                                                                                      |
| ---------------- | -------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 中文/空格路径 | 不适用（无文件路径输入）               | 单测                | 等价实测：CIDR 前后空白 `'  172.16.0.1/12  '` 正常解析为 `172.16.0.0/12`（ip.test.ts）✅；显示器标签含中文正常回显（node.test.ts）✅；界面文案全为中文 ✅                                   |
| 2. 文件被占用    | 不适用（无文件 IO）                    | —                   | —                                                                                                                                                                                         |
| 3. 加密文件      | 不适用（无文件 IO）                    | —                   | —                                                                                                                                                                                         |
| 4. 超大文件      | 不适用（截图由系统尺寸决定）           | 单测（等价边界）    | `/0` 全网主机数 4294967294 不溢出 ✅；5K 屏截图像素尺寸照常换算（`measureRect` 纯函数无上限）✅；截图超大时按显示器缩放放大请求尺寸（`bounds × scaleFactor` 单测）✅                            |
| 5. 任务取消      | 部分适用                               | 代码分支 + e2e 用例 | 秒表 / 倒计时 / 番茄钟均提供「暂停」「重置」；屏幕标尺预览层 `Esc` / [关闭] 即退出并清空选区（e2e 覆盖 Esc 关闭）✅                                                                      |
| 6. 并发溢出      | 部分适用（截屏按钮守卫）               | 单测 + 代码分支     | 秒表计次封顶 20 条 ✅；截屏 / 重新截屏 / 切换显示器共用 `capturing` 守卫，重复触发直接返回；多显示器只串行重新截屏，无并发请求                                                            |
| 7. 磁盘满        | 部分适用（剪贴板写入）                 | 代码分支            | 截图仅驻留内存 dataURL，不落盘；剪贴板写入失败 → `MT_CLIPBOARD_FAILED` + 中文文案，不崩溃                                                                                                  |
| 8. 断电恢复      | 不可实测（无持久化设计）               | 代码分支            | 输入、DPI、截图与选区均不持久化；进程重启 / 路由离开后恢复默认（DPI 96、倒计时 5 分钟、秒表 `00:00.00`）。`onUnmounted` 清理 interval / AudioContext / 标题 ⏰ 标记 / 复制计时器            |

## 3. 计时器生命周期说明

- 计时基准为 `performance.now()` 差值；`setInterval(50ms)` 只负责刷新显示，不参与计时精度。
- interval 仅在任一计时器运行时存在，暂停 / 重置 / 结束 / 卸载时统一 `stopTicker()`。
- 页签切换（`activeTab`）只做 `v-if` 渲染，离开「计时器」页签即卸载对应 DOM；路由离开整页时 `onUnmounted` 释放句柄。
- 结束提示：短蜂鸣（`AudioContext` 合成，无音频资源文件）+ `document.title` 追加 ⏰（重置 / 新一次开始 / 卸载时移除）。

## 4. 屏幕标尺截屏说明

- 通道 `misc-toolbox:capture-display`（zod 入参 `displayId?`）；主进程复用 `@lumin/node-kit` `captureDisplay`，显示器选择顺序：请求 id → 当前窗口所在 → 首个。
- 回包含 `scaleFactor`；物理像素、逻辑像素（÷ 缩放比）、对角线均来自截图原始像素，cm / inch 按 DPI 名义换算（默认 96，可调 48–600）。
- 截图是整屏合成画面，Lumin 自身窗口会被包含；界面提示用户先移开 / 最小化窗口。
- 错误码：`MT_CAPTURE_FAILED`（无显示器 / 空画面 / 底层异常 / 入参非法）、`MT_RULER_INVALID`（DPI 越界）、`MT_CLIPBOARD_FAILED`（复制失败）。

## 5. R5 体积记录

- 口径：gzip；`misc-toolbox-mgZZGYF0.js` = **62,015 B raw / 15,139 B gzip**（远低于 200KB gzip）。
- 独占依赖 chunk：0（vue / naive-ui / @lucide/vue 为多工具共享 vendor；`@lumin/shared` / `@lumin/node-kit` 为 workspace 公共包）。
- 无运行时资产（无 worker / wasm / 模型 / 字体），无需单列。
