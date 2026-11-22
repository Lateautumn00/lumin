# 系统信息查看器（system-info）字段级规格（M53）

> 状态：已实现（M53，2026-11-22）
> 目标：新增只读工具「系统信息」，展示 CPU / 内存 / 磁盘 / 网络 / 操作系统概览，支持一键复制与刷新。
> 约束：零新增第三方依赖；不修改任何系统配置或文件；工具包零耦合（仅依赖 plugin-api / shared / ui）。

---

## 1. 功能边界

| 项 | 结论 |
| --- | --- |
| 工具 id / 包名 | `system-info` / `@lumin/tool-system-info` |
| 名称 / 分类 / 图标 | 系统信息 / `misc` / `monitor`（壳 `AppSidebar` 注册 `Monitor`） |
| order | `72`（misc 分类内 `71/80/90/95` 已占用，72 空闲） |
| 数据来源 | 主进程 `node:os` + `node:fs/promises.statfs` |
| 通道 | 单同步通道 `system-info:snapshot`（无长任务、无取消） |
| 写入 | 无（不落盘、不改设置） |
| 网络 | 仅读取本机网卡地址，不发起任何网络请求 |

## 2. 页面结构（单页，无页签）

1. 标题区：`系统信息` + 说明「只读采集本机概览，不会修改任何设置或文件」。
2. 操作区：主按钮「采集系统信息」（首次）/「刷新」（已有数据）+「复制全部」。
3. 概览卡片（按序）：
   - 操作系统：平台名称、`release`、架构、主机名、运行时长。
   - 处理器：型号、逻辑核心数、平均主频。
   - 内存：总量 / 已用 / 可用 + 使用率条。
   - 磁盘：每个可访问盘符一行（已用 / 总量 / 使用率条）+ 汇总；无盘符时显示「未检测到可访问磁盘」。
   - 网络：非回环 IPv4/IPv6 网卡（名称、地址、协议、MAC）；无网卡时显示「未检测到外部网络接口」。
4. 页脚：采集时间（`YYYY-MM-DD HH:mm:ss`）。

## 3. 三态（AGENTS §5.3 强制）

| 状态 | 触发 | 表现 |
| --- | --- | --- |
| 空态 | 首次进入、尚未采集 | 引导文案 + 主按钮「采集系统信息」，禁止白屏 |
| 加载态 | 点击采集/刷新后请求返回前 | 旋转指示 + 「正在采集系统信息…」；本工具为毫秒级只读调用，不提供取消 |
| 报错态 | 通道抛结构化错误 | 中文文案 + 可选「重试」+ 可展开「详情」（detail） |

## 4. IPC 契约（`system-info:snapshot`）

入参：`{}`（无业务参数；壳按统一信封传递）。

出参 zod schema（`src/schema.ts`）：

```ts
snapshotSchema = {
  collectedAt: number            // 毫秒时间戳
  os: { platform, type, release, version, arch, hostname, uptimeSec }
  cpu: { model, cores, speedMhz }
  memory: { totalBytes, freeBytes, usedBytes }
  disks: Array<{ path, totalBytes, freeBytes, usedBytes }>   // 最多 16
  networks: Array<{ name, address, family: 'IPv4' | 'IPv6', mac }> // 最多 32，已排除 internal
}
```

- 所有字节/频率字段为非负整数；`cores` 为正整数；`usedBytes = max(0, total - free)`。
- 磁盘探测：Windows 遍历 `A:`–`Z:`，逐个 `statfs`，不可访问盘符静默跳过；非 Windows 仅探测 `/`。
- 网络：`os.networkInterfaces()` 扁平化，过滤 `internal`，按名称/地址排序后截断。
- CPU：型号取首个 CPU，核心数取 `cpus().length`，主频取有效 `speed` 的平均值并四舍五入。

## 5. 错误码（`src/errors.ts`）

| 错误码 | 文案 | 可重试 |
| --- | --- | --- |
| `SI_COLLECT_FAILED` | 采集系统信息失败 | 是 |
| `SI_CLIPBOARD_FAILED` | 复制失败（剪贴板不可用） | 否 |

> 采集异常统一包装为 `SI_COLLECT_FAILED`（`detail` 保留 errno）；结构化错误原样透传。

## 6. 纯函数（`src/format.ts`，单测 ≥80%）

| 函数 | 行为 |
| --- | --- |
| `platformLabel(platform)` | `win32→Windows`、`darwin→macOS`、`linux→Linux`，其余原样 |
| `formatUptime(seconds)` | 负值/非法 → `00:00:00`；≥1 天 → `N 天 HH:MM:SS` |
| `formatFrequency(mhz)` | ≤0/非法 → `—`；≥1000 → `x.xx GHz`（去尾零）；否则 `N MHz` |
| `percentValue(used, total)` | 进度条宽度数值（0–100；非法/总量≤0 → 0） |
| `formatPercent(used, total)` | `total≤0`/非法 → `—`；否则 0–100 保留 1 位小数 |
| `formatSize(bytes)` | 0 → `0 B`；其余委托 `shared.formatBytes`；非法/负数 → `—` |
| `formatTimestamp(ms)` | `YYYY-MM-DD HH:mm:ss`（本地时区，手动补零） |
| `summarizeDisks(disks)` | 返回 `{ totalBytes, freeBytes, usedBytes }` 汇总 |
| `buildCopyText(snapshot)` | 「复制全部」多行中文文本（系统/CPU/内存/磁盘/网络/采集时间） |

## 7. 文件清单

新增：

- `packages/tools/system-info/package.json`
- `packages/tools/system-info/tsconfig.json`
- `packages/tools/system-info/src/manifest.ts`
- `packages/tools/system-info/src/schema.ts`
- `packages/tools/system-info/src/errors.ts`
- `packages/tools/system-info/src/format.ts`
- `packages/tools/system-info/src/collect.ts`（依赖可注入，便于单测）
- `packages/tools/system-info/src/node.ts`
- `packages/tools/system-info/src/renderer/client.ts`
- `packages/tools/system-info/src/renderer/ToolView.vue`
- 对应 `*.test.ts`
- `apps/desktop/src/renderer/src/tools/system-info.vue`（薄壳）
- `apps/desktop/e2e/system-info-smoke.spec.ts`
- `docs/smoke/system-info.md`

壳接线（各 1 行）：

- `apps/desktop/src/tool-manifests.ts` 导入 + 数组追加
- `apps/desktop/src/main/tool-mains.ts` 导入 + 映射
- `apps/desktop/src/renderer/src/layout/AppSidebar.vue` 导入 `Monitor` + `iconMap['monitor']`
- `apps/desktop/package.json` 依赖 `@lumin/tool-system-info: workspace:*`
- `vitest.config.ts` 覆盖率阈值新增 `packages/tools/system-info/src/**/*.ts`（80）

文档同步：

- 本文件 + `docs/spec/system-info-tasks.md`
- `docs/smoke/system-info.md`（R2 八类映射）
- `docs/opencode/plan.md`：Q53 行、§4.53 段、M53 里程碑行
- `README.md` / `README.en.md` 工具表
- `CHANGELOG.md` `[Unreleased] / Added`

## 8. 验收标准

1. 侧边栏「实用」分类出现「系统信息」，图标为显示器，进入无报错。
2. 空态可见引导与「采集系统信息」；点击后展示五个概览区（系统/CPU/内存/磁盘/网络）与采集时间。
3. 「复制全部」写入剪贴板且内容包含「操作系统」「处理器」「内存」「磁盘」「网络」。
4. IPC 冒烟：`system-info:snapshot` 返回 `cpu.cores > 0`、`memory.totalBytes > 0`、`disks`/`networks` 为数组。
5. 采集异常时展示 `SI_COLLECT_FAILED` 中文文案 + 重试入口。
6. 工具包 typecheck 通过；本包纯函数单测覆盖 ≥80%；`pnpm gate` 全绿。
7. 工具 chunk 增量 <200KB gzip；零新增第三方依赖。
8. 文档五处同步完成。
