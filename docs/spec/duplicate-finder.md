# 重复文件查找（duplicate-finder）字段级功能清单

> 里程碑：M18（2026-11-19）· 工具 id：`duplicate-finder` · 包：`@lumin/tool-duplicate-finder`
> 依据：`docs/opencode/plan.md` Q22 / §4.18；`AGENTS.md` §2/§5/§6/§7
> 目标：选定目录 → 递归扫描 → 大小分组 + 两段哈希确认 → 重复组展示 → 定位/移入回收站清理

## 0. 范围边界

**做**：单目录扫描（可选包含子目录）、最小文件大小过滤、重复组展示（路径/大小/修改时间/可释放空间）、默认勾选（每组保留最早一份）、定位、移入回收站（回收站由壳通用能力 `shell:trash` 提供）。

**不做**：跨目录多根扫描、目录排除规则、按扩展名过滤、哈希算法选择（固定 SHA-256）、自动批量删除、文件对比预览、硬链接/符号链接识别（跳过符号链接）。

## 1. 输入项（字段级）

| 项           | 控件              | 取值 / 校验                                                                         | 默认     |
| ------------ | ----------------- | ----------------------------------------------------------------------------------- | -------- |
| 扫描目录     | 只读输入 + [选择目录] | 系统目录选择器；空时 [开始扫描] 禁用；记住上次目录                                   | 上次目录 |
| 包含子目录   | 复选框            | 开 / 关（默认开）；关 = 仅扫描根目录一层                                             | 开       |
| 最小文件大小 | 下拉              | 1 KB / 100 KB / 1 MB / 10 MB（对应 1024 / 102400 / 1048576 / 10485760 字节）          | 1 MB     |

## 2. 按钮集

| 按钮             | 可用条件                       | 行为                                                                 |
| ---------------- | ------------------------------ | -------------------------------------------------------------------- |
| 选择目录         | 非任务中                       | `lumin:shell:pick-directory`；选中即回填，取消不变                    |
| 开始扫描         | 有目录且非任务中               | 提交 `duplicate-finder:scan` 任务（三段式），保存本次选项到设置       |
| 取消             | 任务中                         | `lumin:task:cancel`                                                  |
| 定位             | 非任务中                       | `window.lumin.revealPath`（资源管理器中选中文件）                     |
| 全选 / 全不选    | 有结果且非任务中               | 勾选切换                                                             |
| 保留每组最早一份 | 有结果且非任务中               | 每组按修改时间升序保留第一项，其余勾选                               |
| 移入回收站（n）  | 已勾选 ≥1 且非任务中           | `NPopconfirm` 二次确认 → `window.lumin.trashPaths(paths)` → 更新结果  |
| 重试             | 报错且可重试（DF_SCAN_FAILED） | 用当前目录与选项重新扫描                                             |

## 3. 三态（R4 强制）

| 状态   | 表现                                                                                     |
| ------ | ---------------------------------------------------------------------------------------- |
| 空态   | 未选目录：引导「选择要扫描的目录」；已扫描无重复：「未发现重复文件」+ 扫描统计             |
| 加载态 | `TaskProgress`：阶段文案（扫描目录 / 预筛哈希 / 完全哈希）+ 计数或字节进度 + 可取消        |
| 报错态 | 结构化错误码 → 中文文案 + [重试]（仅可重试码）+ 详情折叠                                 |

## 4. IPC 契约（通道 `duplicate-finder:{action}`）

| 通道         | 类型 | 入参                                  | 出参                        |
| ------------ | ---- | ------------------------------------- | --------------------------- |
| `config`     | sync | `{}`                                  | `ConfigResult`              |
| `set-config` | sync | `{ root?: string, recursive, minBytes }`（`root: ''` 表示清空记忆） | `ConfigResult`           |
| `scan`       | task | `{ root, recursive, minBytes }`       | `ScanResult`（worker 两段哈希） |

壳通用通道（非工具通道）：`lumin:shell:trash`（sync，`{ paths: string[] }` → `{ trashed: string[], failed: { path, message }[] }`）。

### 4.1 ScanResult

```ts
interface DuplicateFile { path: string; size: number; mtimeMs: number }
interface DuplicateGroup {
  size: number
  hash: string // 完整 SHA-256
  files: DuplicateFile[] // 至少 2 项；按 mtimeMs 升序、同时间按路径升序
  wastedBytes: number // size * (files.length - 1)
}
interface ScanResult {
  groups: DuplicateGroup[] // wastedBytes 降序，其次 size 降序
  scannedFiles: number // 实际检查过的普通文件数（含小于阈值的）
  skipped: number // stat/读取失败被跳过的文件数
  totalWastedBytes: number
  elapsedMs: number
}
```

## 5. 扫描与去重语义

1. **范围**：`root` 必须是已存在的目录（否则 `DF_ROOT_INVALID`）；符号链接目录不跟随、符号链接文件跳过。
2. **上限**：单次扫描文件数上限 **200 000**，超过 → `DF_TOO_MANY_FILES`（建议换更小目录或提高最小文件大小）；任务超时 **15 分钟**。
3. **大小过滤**：`size >= minBytes` 的普通文件才参与去重；小于阈值的仅计入 `scannedFiles`。
4. **两段哈希**（worker 线程，`runTask` + `exposeTask`）：
   - 阶段一 `scan`：遍历目录收集候选并 stat；
   - 阶段二 `partial`：按 size 分组，仅对同 size ≥2 的组读取前 **64 KB** 计算 SHA-256 预筛；`size <= 64KB` 时前缀哈希即最终哈希，跳过阶段三；
   - 阶段三 `full`：剩余候选流式读取完整文件计算 SHA-256（按字节推进度）。
5. **失败容忍**：单文件 stat/读取失败（占用、权限、损坏）计入 `skipped` 并跳过，不中断整次扫描。
6. **进度**：`stage` 依次为 `scan` / `partial` / `full`；`scan`/`partial` 推文件计数，`full` 推字节进度并带当前文件路径。
7. **取消**：任务队列 abort → 壳 terminate worker → `CANCELLED`。

## 6. 清理语义

- 仅通过壳通用通道 `lumin:shell:trash` 删除（Electron `shell.trashItem`，进系统回收站，**不做永久删除**）。
- 单批最多 200 个路径；逐条处理，失败项返回 `{ path, message }`，不中断其余。
- 成功项从前端结果移除；组内剩余 <2 项时整组移除，并重算 `wastedBytes`。
- 回收站不可用/失败 → 保留勾选并展示失败原因。

## 7. 错误码

| 码                    | 文案                                             | 可重试 |
| --------------------- | ------------------------------------------------ | ------ |
| `DF_INVALID_PAYLOAD`  | 参数无效                                         | 否     |
| `DF_ROOT_INVALID`     | 无法读取扫描目录（不存在、不是目录或无权限）     | 是     |
| `DF_TOO_MANY_FILES`   | 目录文件超过 20 万个，请缩小范围或提高大小阈值   | 否     |
| `DF_SCAN_FAILED`      | 扫描失败（任务超时或异常中断）                   | 是     |

取消统一由壳返回 `CANCELLED`。

## 8. 设置记忆（`tools.duplicate-finder.*`）

| 键          | 类型                 | 说明                         |
| ----------- | -------------------- | ---------------------------- |
| `lastRoot`  | `string \| null`     | 上次扫描目录                 |
| `recursive` | `boolean`            | 是否包含子目录（默认 true）  |
| `minBytes`  | `number`             | 最小文件大小（默认 1048576） |

存量非法值回落默认（`null` / `true` / `1 MB`）。

## 9. 文件表

| 文件                                          | 职责                                     |
| --------------------------------------------- | ---------------------------------------- |
| `src/manifest.ts`                             | 工具清单（id / name / icon / order）     |
| `src/schema.ts`                               | zod 契约与常量                           |
| `src/errors.ts`                               | 错误码、中文文案、可重试判定             |
| `src/contract.ts`                             | 纯函数：自动勾选、回收后结果归一         |
| `src/scan.worker.ts`                          | 扫描 + 两段哈希（worker 线程）           |
| `src/node.ts`                                 | config / set-config / scan 注册与错误映射 |
| `src/renderer/client.ts`                      | 类型化 invoke 封装                       |
| `src/renderer/ToolView.vue`                   | 页面与三态                               |
| `apps/desktop/src/main/shell-channels.ts`     | `shell:trash` 通用能力                   |

## 10. 测试与验收

- 单测：schema/errors/contract/worker（真实临时目录）/node（假 worker），包覆盖率 ≥80%。
- e2e：页面空态与 8 类异常覆盖；扫描出重复组、阈值过滤、非递归、DF_ROOT_INVALID、DF_TOO_MANY_FILES（低上限不可注入，改为单测覆盖）、取消、并发、强杀恢复。
- R2 八类：见 `docs/smoke/duplicate-finder.md`。
- 性能：chunk < 200KB gzip（零新增依赖）；扫描为本地 IO，不做硬性时限承诺。
