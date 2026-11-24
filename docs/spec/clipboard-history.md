# clipboard-history（剪贴板历史）规格

- **状态**：已实现并通过验证（2026-11-23 R8 登记 · Q61 · M59；单测 62 / e2e 4-4 / chunk 5,255 B gzip 全绿）
- **形态拍板**：工具页内轮询——仅本工具页挂载期间每 1s 轮询主进程 `clipboard`；不做图片、全局快捷键、常驻后台、托盘浮窗（下一期候选）。
- **定位**：文本剪贴板历史（上限 500 条、置顶永不淘汰、搜索/复制/删除/清空、纯本地持久化）。零新增依赖、零全局快捷键、壳零改动。

---

## 1. 字段级功能清单（按钮集 / 输入项 / 交互分支）

### 1.1 顶栏

| 字段        | 类型/控件               | 约束                                | 分支                                  |
| ----------- | ----------------------- | ----------------------------------- | ------------------------------------- |
| 搜索        | `NInput`（clearable）   | ≤64 字符，子串、忽略大小写实时过滤  | 无命中 → 列表空态「没有匹配的条目」    |
| 条数徽标    | 文本                    | `共 N 条 · 置顶 M 条`（随过滤更新） | —                                     |
| 清空        | `NButton` + `NPopconfirm`（Danger） | 二次确认「清空全部历史（含置顶）？」 | 确认 → `clear` → 本地列表清空；取消无操作 |

### 1.2 条目卡（`v-for` 列表）

| 字段     | 约束                                                                       |
| -------- | -------------------------------------------------------------------------- |
| 预览     | 等宽字体、`line-clamp-3` 多行截断；空行正常显示                             |
| 徽标     | 字数 + 行数（如 `128 字 · 4 行`）；相对时间（刚刚/N 分钟前/N 小时前/日期）；置顶时前缀 `Pin` 图标 |
| 复制     | 回写剪贴板（主进程 `clipboard.writeText`）并把该条本地前移（置顶序保持）；`message.success('已复制')` |
| 置顶/取消 | `pin` 切换；置顶组恒在最前、按 `createdAt` 倒序                             |
| 删除     | `remove` 单条删除，立即生效（V1 无撤销）                                    |

### 1.3 轮询与入库

- 挂载：`list` 拉全量（置顶在前、组内 `createdAt` 倒序）→ 启动 `setInterval(1000ms)` 调 `poll`；卸载：`clearInterval`（轮询即任务取消口径）。
- `poll` 入库判定（主进程）：剪贴板文本 **空串 / 与头部条目相同 / >100KB** → 跳过；`>100KB` 时返回 `skipped: 'TOO_LARGE'`，渲染端**一次性** `message.warning('剪贴板内容过大（>100KB），已跳过')`。
- 新条目：`{ id: crypto.randomUUID(), text, createdAt: Date.now(), pinned: false }` 前插 → 防抖 500ms 原子持久化。
- 淘汰：超过 500 条时从尾部（最旧且未置顶）逐条丢弃，**置顶条目永不淘汰**。
- 重复文本再次复制：与头部相同则跳过；与非头部条目相同则移动该条到最前（去重，不新增）。

### 1.4 三态（R4 强制）

| 状态   | 实现                                                                        |
| ------ | --------------------------------------------------------------------------- |
| 空态   | `NEmpty`「复制任意文本后自动出现在这里」（搜索无命中时文案区分）             |
| 加载态 | 首次 `list` 期间 `NSpin`（同步通道瞬时，按 time-toolbox 豁免口径）           |
| 报错态 | `CH_STORAGE_FAILED` → 中文文案「剪贴板历史读写失败」 + 重试按钮（重新 `list`）；内存态继续轮询可用 |

---

## 2. IPC 契约（5 通道，全 sync，zod schema 归本工具包 `src/node.ts`）

| channel                     | payload        | 返回                              | 说明                       |
| --------------------------- | -------------- | --------------------------------- | -------------------------- |
| `clipboard-history:list`    | `{}`           | `{ items: Entry[] }`              | 全量（置顶前、倒序）；读存储失败 → `CH_STORAGE_FAILED` |
| `clipboard-history:poll`    | `{}`           | `{ entry: Entry \| null, skipped?: 'TOO_LARGE' }` | 读剪贴板并按 §1.3 判定     |
| `clipboard-history:pin`     | `{ id: string }` | `{ ok: true }`                  | 置顶切换（id 不存在 → 结构化 `INVALID_INPUT`） |
| `clipboard-history:remove`  | `{ id: string }` | `{ ok: true }`                  | 单条删除                   |
| `clipboard-history:clear`   | `{}`           | `{ ok: true }`                   | 全清（含置顶）             |

- `Entry = { id: string; text: string; createdAt: number; pinned: boolean }`
- 持久化：`app.getPath('userData')/clipboard-history.json`，node-kit `writeAtomic` 原子写、保存防抖 500ms。
- 损坏/半写 JSON：读取校验失败 → 删除重建空表 + `electron-log` warn（断电恢复口径）。

## 3. 错误码（结构化，中文文案）

| code                | 触发                            | 文案与恢复                     |
| ------------------- | ------------------------------- | ------------------------------ |
| `CH_STORAGE_FAILED` | 存储读取/原子写失败（含磁盘满） | 「剪贴板历史读写失败」+ 重试；内存态继续可用 |
| `INVALID_INPUT`     | 信封校验失败 / pin·remove 非法 id | 沿用共享信封文案               |

## 4. R2 八类异常映射（记入 `docs/smoke/clipboard-history.md`）

| 类别           | 本工具映射                                                        |
| -------------- | ----------------------------------------------------------------- |
| 1 中文/空格    | 中文/空格剪贴板文本入库与持久化往返（存储路径固定名、经 userData） |
| 2 文件占用     | 存储写失败 → `CH_STORAGE_FAILED` 错误态 + 重试（单测 mock 分支）    |
| 3 加密         | 不适用（无加密输入）                                               |
| 4 超大         | 单条 >100KB 跳过 + 一次性提示（单测 + e2e）                         |
| 5 任务取消     | 离开页面 `clearInterval` 停轮询（e2e 切页后剪贴板变化不入库）       |
| 6 并发         | 单实例 + 页内单定时器；pin/remove/clear 主进程同步串行              |
| 7 磁盘满       | 原子写失败 → `CH_STORAGE_FAILED`，内存态继续（单测 mock）           |
| 8 断电恢复     | 原子写防半写；损坏 JSON → 重建空表 + warn（单测）                   |

## 5. 壳接线 6 处（照 calendar §4.58 模板）

vite alias（manifest + renderer 正则）· `apps/desktop/package.json` workspace 依赖 · `tool-manifests.ts` 1 行 · `tools/clipboard-history.vue` 薄壳 · `AppSidebar` iconMap `'clipboard-list': ClipboardList` · 根 `vitest.config.ts` 本包纯函数阈值 80%。

manifest：`category: 'text'`、`order: 65`、`icon: 'clipboard-list'`。

## 6. 验收

- 单测 ≥80%：入库去重/上限淘汰/置顶排序/搜索过滤/相对时间格式化/损坏重建/超限跳过。
- e2e `clipboard-history-smoke.spec.ts`：写剪贴板 → 轮询入库 → 复制/置顶/删除/清空 → 关闭重开 `list` 持久化恢复；切页停轮询；>100KB 跳过提示。
- R5：工具 chunk + 独占依赖 gzip < 200KB。
- `pnpm gate` 全绿；文档五处同步（spec 本文件 / smoke / README 中英 / CHANGELOG / plan §4.59）。
