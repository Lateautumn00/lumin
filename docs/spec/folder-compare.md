# 文件夹对比（folder-compare）字段级功能清单

> 里程碑：M24（已登记 plan §1 Q28 / §4.24 / §6）
> 状态：**已批准并于 2026-11-20 实施**（冒烟见 `docs/smoke/folder-compare.md`）
> 关联规范：`AGENTS.md` §2（零耦合）、§5（三态/tokens/图标）、§6（IPC 三段式）、§7（测试门禁）、§8（性能）

---

## 1. 目标与边界

### 1.1 目标

新增独立工具包 `folder-compare`（名称「文件夹对比」）：选择左右两个目录后**递归扫描文件**，按**相对路径**配对，默认比较文件**元数据**（大小 + 修改时间），可选开启**内容哈希比较**，输出四类结果（仅左侧 / 仅右侧 / 有差异 / 相同）与汇总计数；长任务进度 + 取消；三态 UI。全程离线、**只读**，零新增第三方依赖。

### 1.2 做

| 能力     | 说明                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| 输入     | 左右各一个目录选择器（取消保持原值）；支持一键交换左右                                      |
| 扫描     | 两侧各自迭代栈递归；不跟随符号链接；stat 失败计入 `skipped` 不中断                          |
| 配对     | 相对路径统一 `/` 分隔、大小写不敏感配对（展示保留原样）；**仅比较文件**，目录只用于遍历       |
| 比较     | 大小是否相同；修改时间差 > 2s（`MTIME_TOLERANCE_MS`）视为不同；可关闭「比较修改时间」        |
| 内容比较 | 可选「比较文件内容」（默认关闭）：对**两侧均存在且大小相同**的配对做两段 SHA-256（前 64KB 预筛 → 全量），内容不同标记 `contentChanged` 并归入「有差异」 |
| 分类     | `only-left` / `only-right` / `different`（大小不同、时间不同或两者）/ `same`                |
| 汇总     | 四类计数 + 左右各自文件数 + 跳过数 + 耗时                                                  |
| 筛选     | 状态筛选（全部 / 仅差异 / 仅左侧 / 仅右侧 / 元数据相同）+ 相对路径关键字（大小写不敏感）      |
| 折叠     | 单页最多展示 500 条，其余提示折叠数；worker 侧结果上限 20,000 条（超出计入 `truncated`）      |
| 定位     | 行内左侧/右侧「定位」按钮，调 `window.lumin.revealPath`（拼接根目录 + 相对路径）             |
| 进度     | 两侧扫描分别上报（每 200 个文件）；内容比较阶段单独上报（每 20 个配对）；取消 terminate      |
| 记忆     | 上次左右目录与两个比较开关（settings `leftRoot` / `rightRoot` / `compareMtime` / `compareContent`） |

### 1.3 不做（防范围膨胀）

- 逐字节差异定位（只判断内容是否一致，不输出差异偏移；二进制差异定位不在本工具范围）
- 三方合并、差异补丁生成、同步/复制/删除等写操作
- 目录差异单独成行（空目录差异不展示）、权限/ACL/所有者/软链目标比较
- 实时监听（watch）与增量缓存

### 1.4 与既有工具边界

| 工具                | 边界                                                       |
| ------------------- | ---------------------------------------------------------- |
| `duplicate-finder`  | 同目录找内容重复并可移入回收站；本工具只判断两侧同名文件内容是否一致，不找重复、不删改 |
| `file-hasher`       | 计算并导出文件哈希值；本工具不展示/导出哈希值，仅用于判定内容是否一致 |
| `disk-analyzer`     | 单目录占用分析；本工具双目录逐文件配对                       |

---

## 2. 工具清单（manifest）

```ts
{
  id: 'folder-compare',
  name: '文件夹对比',
  description: '按相对路径对比左右两个目录的文件（大小/修改时间，可选内容哈希），只读不修改文件',
  icon: 'git-compare',
  order: 67,
  version: '0.1.0'
}
```

设置命名空间 `tools.folder-compare.*`；壳侧需在 `AppSidebar` iconMap 注册 `git-compare → GitCompare`。

---

## 3. 界面规格（单页，三态强制）

### 3.1 空态

- 左右两行只读输入框 + 「选择目录」；中间「交换」按钮
- 「比较修改时间」复选框（默认勾选）
- 「比较文件内容（SHA-256，较慢）」复选框（默认不勾选）
- 引导文案「先选择左右两个目录，再点击「开始对比」；默认只比较元数据，勾选「比较文件内容」后对同名同大小文件做 SHA-256」
- 任一目录未选时「开始对比」禁用

### 3.2 加载态

- `TaskProgress`：`正在扫描左侧目录 · 已检查 N 个文件` / `正在扫描右侧目录 · …` / `正在比较文件内容 · N / M 个文件` + `[取消]`
- 扫描与内容比较期间禁用目录选择、交换与复选框

### 3.3 报错态

- 错误行展示 `error.message` + `code · detail`
- `isRetryable(code)` 为真时显示 `[重试]`；始终可重新选择目录

### 3.4 结果态

- 汇总行：`仅左侧 X · 仅右侧 Y · 有差异 Z · 相同 W [· 内容不同 C] · 跳过 S · 耗时 T`（`内容不同` 仅在启用内容比较时展示）
- 规模行：`左侧 N 个文件 · 右侧 M 个文件`
- 筛选行：状态 `NSelect` + 关键字 `NInput`（可清空）+ `共 X 条 · 展示 Y 条`
- 列表行：状态标签 + 相对路径 + 左右元数据（`大小 · 修改时间`，缺失侧显示「不存在」）+ 两侧定位按钮
- 元数据声明：未启用内容比较时「相同」= 元数据相同（大小与修改时间一致），不代表内容逐字节一致；启用后「相同」= 大小与文件内容（SHA-256）一致
- 内容不同条目状态文案优先展示「内容不同」

---

## 4. 纯函数（`contract.ts`）

| 函数                                          | 语义                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `normalizeRelPath(path)`                      | `\` → `/`、合并重复分隔符、去首尾分隔符与 `./` 前缀                   |
| `pathKey(rel)`                                | 配对键（小写），实现 Windows 大小写不敏感配对                         |
| `joinRelPath(parent, name)`                   | 相对路径拼接（`/` 分隔，不产生首尾多余分隔符）                        |
| `joinRootPath(root, rel)`                     | 绝对路径拼接（按 root 分隔符风格把相对路径 `\`/`/` 统一转换）          |
| `classifyPair(rel, left, right, compareMtime, toleranceMs?)` | 单条配对分类（缺失侧 → only-*；两侧 → 比较大小/时间；容忍差 ≤ 2s） |
| `withContentResult(entry, contentSame)`       | 合并内容比较结果：内容不同 → 归入 `different` 并置 `contentChanged`；内容一致/缺失侧保持原分类 |
| `summarize(entries)`                          | 四类计数 `{ onlyLeft, onlyRight, different, same }`                   |
| `sortEntries(entries)`                        | 状态优先级（仅左 → 仅右 → 有差异 → 相同）→ 相对路径升序（不改原数组）  |
| `filterEntries(entries, { status, keyword })` | 状态筛选（`all` / `changed` = 非相同 / 四类）+ 路径关键字（去空白、小写包含） |
| `limitEntries(entries, limit)`                | 截取前 N 条并返回 `{ shown, hiddenCount }`                            |

---

## 5. IPC 契约（通道 `folder-compare:{action}`）

### 5.1 schema（`packages/tools/folder-compare/src/schema.ts`）

```ts
const comparePayloadSchema = z.object({
  leftRoot: z.string().min(1).max(32767),
  rightRoot: z.string().min(1).max(32767),
  compareMtime: z.boolean(),
  compareContent: z.boolean()
})

const compareEntrySchema = z.object({
  path: z.string().min(1),
  status: z.enum(['only-left', 'only-right', 'different', 'same']),
  sizeLeft: z.number().int().nonnegative().nullable(),
  sizeRight: z.number().int().nonnegative().nullable(),
  mtimeLeft: z.number().nonnegative().nullable(),
  mtimeRight: z.number().nonnegative().nullable(),
  sizeChanged: z.boolean(),
  mtimeChanged: z.boolean(),
  contentChanged: z.boolean()
})

const compareDoneSchema = z.object({
  leftRoot: z.string().min(1),
  rightRoot: z.string().min(1),
  entries: z.array(compareEntrySchema), // ≤ MAX_RESULT_ENTRIES
  onlyLeft: z.number().int().nonnegative(),
  onlyRight: z.number().int().nonnegative(),
  different: z.number().int().nonnegative(),
  same: z.number().int().nonnegative(),
  leftFiles: z.number().int().nonnegative(),
  rightFiles: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  truncated: z.number().int().nonnegative(),
  compareMtime: z.boolean(),
  compareContent: z.boolean(),
  contentDifferent: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative()
})
```

常量：`MTIME_TOLERANCE_MS = 2_000`、`MAX_FILES_PER_SIDE = 200_000`、`MAX_RESULT_ENTRIES = 20_000`、`MAX_VISIBLE_ENTRIES = 500`、`DEFAULT_COMPARE_MTIME = true`、`DEFAULT_COMPARE_CONTENT = false`；内容比较前缀长度复用 `node-kit` 的 `HASH_CHUNK_BYTES = 65_536`（与 `duplicate-finder` 共用 `hashFileRange` / `hashWholeFile`）。

### 5.2 主进程（`node.ts`）

- `config` → `{ leftRoot: string | null, rightRoot: string | null, compareMtime: boolean, compareContent: boolean }`（非法存量回落 `null` / `null` / `true` / `false`）
- `set-config` → 记忆左右目录与两个开关（`leftRoot`/`rightRoot` 省略时保留上次；空串清空）
- `compare` → zod 校验 → 记忆本次参数 → `runTask`（900s、可取消）
- 错误映射：超时 / 崩溃 → `FC_COMPARE_FAILED`；结构化错误透传

### 5.3 worker（`compare.worker.ts`）

- 先校验根目录可读，失败 → `FC_ROOT_INVALID`（detail 标明左侧/右侧）
- 两侧各自迭代栈遍历：目录入栈、普通文件 stat 取 `size`/`mtimeMs`；符号链接等非普通条目跳过
- 单侧普通文件计数超过 200,000 → `FC_TOO_MANY_FILES`（detail 标明侧别）
- 进度：`{ kind: 'progress', current: 已检查文件数, stage: 'left' | 'right' }`，每 200 个文件上报一次
- 配对：相对路径 `pathKey` 合并键集；显示路径优先取左侧原样（仅右侧取右侧）
- 内容比较（`compareContent` 为真时）：仅对两侧均存在且**大小相同**的配对比较；`node-kit/hash` 先算前 64KB SHA-256 预筛，前缀一致且文件 > 64KB 时再全量 SHA-256；内容不同经 `withContentResult` 归入 `different` 并置 `contentChanged`；哈希读取失败计入 `skipped` 且保留元数据分类
- 内容比较进度：`{ kind: 'progress', current, total, stage: 'content' }`，每 20 个配对上报一次，首尾必报
- 结果：按 `sortEntries` 排序后截断至 20,000 条，`truncated` 为省略数；四类计数与 `contentDifferent` 均按全量统计

---

## 6. 错误码表（`packages/tools/folder-compare/src/errors.ts`）

| 码                    | 文案                                | 可重试 |
| --------------------- | ----------------------------------- | ------ |
| `FC_INVALID_PAYLOAD`  | 参数无效                            | 否     |
| `FC_ROOT_INVALID`     | 无法读取对比目录（不存在或无权限）  | 是     |
| `FC_TOO_MANY_FILES`   | 单侧文件超过 20 万个，请缩小对比范围 | 否    |
| `FC_COMPARE_FAILED`   | 对比失败（任务超时或异常中断）      | 是     |
| `CANCELLED`           | 已取消（壳统一）                    | 否     |

---

## 7. 工程接线

- 工具包：`packages/tools/folder-compare`（`manifest.ts` + `renderer/` + `node.ts` + `compare.worker.ts`）
- 壳注册五处：`tool-manifests.ts`、`main/tool-mains.ts`、`AppSidebar.vue` iconMap、`apps/desktop/package.json` devDeps、`electron.vite.config.ts` 别名
- 页面薄壳：`apps/desktop/src/renderer/src/tools/folder-compare.vue`
- 覆盖率阈值：`vitest.config.ts` 新增 `packages/tools/folder-compare/src/**/*.ts` 80%

---

## 8. 性能与规范符合

- 工具页懒加载分包；chunk + 独占依赖 <200KB gzip（本工具零独占依赖）
- worker 内两侧各保留一个相对路径 → 元数据 Map，不缓存文件内容；20 万/侧上限防内存爆炸
- 结果条目 2 万条上限，避免 IPC 大包；展示 500 条上限
- 图标只用 `@lucide/vue`；样式只走 Tailwind + tokens；无 `any`

---

## 9. 验收标准

1. 相对路径配对正确（嵌套目录、中文/空格、大小写差异按不敏感配对）
2. 四类分类正确：仅左侧 / 仅右侧 / 大小不同 / 时间差 > 2s / 相同；关闭修改时间比较后时间差不再产生差异
2b. 内容比较：两侧同名同大小文件内容不同 → 归入「有差异」并标记「内容不同」；内容相同维持「相同」；>64KB 前缀相同但尾部不同可被全量哈希识别；大小不同不参与内容比较；关闭开关不读取内容
3. 汇总计数与全量一致（即使结果被 2 万条截断）
4. 根目录不存在 → `FC_ROOT_INVALID`（detail 标明侧别）；超上限 → `FC_TOO_MANY_FILES`
5. 取消后无残留任务；UI 恢复空闲
6. 交换左右后结果方向正确
7. 单测覆盖 contract / schema / errors / node / worker / client；本包 ≥80%
8. e2e 2/2；`pnpm gate` 全绿

---

## 10. 风险与回滚

- 风险：超大目录两侧扫描耗时 → 20 万/侧上限 + 进度可见 + 可取消
- 风险：修改时间精度差异误报 → 2s 容差 + 可关闭比较
- 风险：内容哈希在大目录上耗时 → 默认关闭 + 64KB 预筛 + 进度可见 + 可取消 + 仅比较同大小配对
- 回滚：删除工具包与壳注册 5 处即可，无数据迁移、无文件改动风险

---

## 11. 审批

- [x] 用户确认功能方向（2026-11-20，选定「文件夹对比」）
- [x] plan 决策总表 Q28 / §4.24 / 里程碑 M24 登记
- [x] 字段级清单（本文）先行
