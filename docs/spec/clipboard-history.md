# clipboard-history（剪贴板历史）规格

- **状态**：**M59 文本 + M61 图片均已实现并通过验证**（M59：2026-11-23 · Q61；M61：2026-11-24 · Q63——单测 109 / e2e 6-6 / chunk 24,417 B raw / 7,226 B gzip 全绿）
- **形态拍板**：工具页内轮询——仅本工具页挂载期间每 1s 轮询主进程 `clipboard`；图片纳入（Q63，同一列表混排 + 类型筛选）；不做全局快捷键、常驻后台、托盘浮窗（后续候选）。
- **定位**：剪贴板历史（文本 ≤500 条 / 图片 ≤100 条，置顶永不淘汰、搜索/复制/删除/清空、纯本地持久化）。零新增依赖、零全局快捷键、壳零改动。

---

## 1. 字段级功能清单（按钮集 / 输入项 / 交互分支）

### 1.1 顶栏

| 字段        | 类型/控件               | 约束                                | 分支                                  |
| ----------- | ----------------------- | ----------------------------------- | ------------------------------------- |
| 搜索        | `NInput`（clearable）   | ≤64 字符，子串、忽略大小写实时过滤；**词非空时仅过滤文本条目（图片不参与搜索）** | 无命中 → 列表空态「没有匹配的条目」    |
| 类型筛选    | 分段按钮（全部/文本/图片），默认全部 | 随筛选更新列表；与搜索可叠加（搜索时图片自动隐藏） | — |
| 条数徽标    | 文本                    | `共 N 条 · 置顶 M 条`（随过滤更新） | —                                     |
| 清空        | `NButton` + `NPopconfirm`（Danger） | 二次确认「清空全部历史（含置顶）？」 | 确认 → `clear` → 本地列表清空 + 图片文件全删；取消无操作 |

### 1.2 条目卡（`v-for` 列表，按 type 分两形态）

文本条目（同 M59）：

| 字段     | 约束                                                                       |
| -------- | -------------------------------------------------------------------------- |
| 预览     | 等宽字体、`line-clamp-3` 多行截断；空行正常显示                             |
| 徽标     | 字数 + 行数（如 `128 字 · 4 行`）；相对时间；置顶时前缀 `Pin` 图标            |
| 复制     | 渲染端 `navigator.clipboard.writeText` 回写并本地前移；成功后按钮态「已复制」1.5s |

图片条目（新增）：

| 字段     | 约束                                                                       |
| -------- | -------------------------------------------------------------------------- |
| 缩略图   | `<img :src="thumb">`（JSON 内联 ≤160px 宽 PNG dataURL），点开预览           |
| 预览     | 点缩略图开 `NModal`，**打开时**才调 `image` 通道取原图 dataURL 展示；加载失败 → `CH_IMAGE_MISSING` 中文文案 + 重试 |
| 徽标     | 尺寸 + 字节（如 `1920×1080 · 2.1MB`，字节格式化 KB/MB）；相对时间；置顶前缀 |
| 复制     | 调 `copy` 通道（主进程 `clipboard.writeImage` 回写，渲染端 clipboard API 写不了图）并本地前移；成功后按钮态「已复制」1.5s |
| 置顶/删除 | 同文本（`pin` / `remove`；remove 时主进程同步删 PNG 文件）                    |

### 1.3 轮询与入库

- 挂载/卸载同 M59（`list` → 1s `poll` → 卸载停）。
- **图片优先判定（Q63）**：`poll` 先 `readImage()`——非空即走图片分支（此时忽略剪贴板文本，避免截图工具的路径文本污染）；图片为空才走文本分支（M59 规则不变）。
- 图片分支：读 PNG → `>5MB` 跳过返回 `skipped: 'TOO_LARGE'`（渲染端一次性提示「图片过大（>5MB），已跳过」）→ SHA-1 与**头部图片条目**相同 → 跳过 → 否则新条目前插（原图写 `images/{id}.png` + JSON 防抖同批落盘）。
- 图片独立上限 **100 条**：超出从尾部（最旧且未置顶）逐条淘汰图片条目，**置顶永不淘汰**；文本 500 条上限独立计数、规则不变。
- 旧 JSON 兼容：条目无 `type` 字段 → zod `default('text')` 解析为文本条目（M59 数据无缝加载）。
- 启动加载后扫描 `images/` 目录，删除 JSON 未引用的孤儿 PNG（崩溃残留）。

### 1.4 三态（R4 强制）

| 状态   | 实现                                                                        |
| ------ | --------------------------------------------------------------------------- |
| 空态   | `NEmpty`「复制任意文本或图片后自动出现在这里」（搜索无命中时文案区分）       |
| 加载态 | 首次 `list` 期间 `NSpin`（同步通道瞬时，按 time-toolbox 豁免口径）           |
| 报错态 | `CH_STORAGE_FAILED` / `CH_IMAGE_MISSING` → 中文文案 + 重试入口；内存态继续轮询可用 |

---

## 2. IPC 契约（7 通道，全 sync，zod schema 归本工具包 `src/schema.ts`）

| channel                     | payload        | 返回                              | 说明                       |
| --------------------------- | -------------- | --------------------------------- | -------------------------- |
| `clipboard-history:list`    | `{}`           | `{ items: Entry[] }`              | 全量（置顶前、倒序）；读存储失败 → `CH_STORAGE_FAILED` |
| `clipboard-history:poll`    | `{}`           | `{ entry: Entry \| null, skipped?: 'TOO_LARGE' }` | 图片优先判定（§1.3） |
| `clipboard-history:pin`     | `{ id: string }` | `{ ok: true }`                  | 置顶切换（id 不存在 → 结构化 `INVALID_INPUT`） |
| `clipboard-history:remove`  | `{ id: string }` | `{ ok: true }`                  | 单条删除；图片条目同步删 PNG |
| `clipboard-history:clear`   | `{}`           | `{ ok: true }`                   | 全清（含置顶）+ 删全部图片文件 |
| `clipboard-history:image`   | `{ id: string }` | `{ dataUrl: string }`           | **M61 新增**：原图 `data:image/png;base64,…`；文件缺失 → `CH_IMAGE_MISSING` |
| `clipboard-history:copy`    | `{ id: string }` | `{ ok: true }`                  | **M61 新增**：主进程读 PNG `clipboard.writeImage` 回写；文件缺失 → `CH_IMAGE_MISSING` |

- `Entry = { id, text, createdAt, pinned, type: 'text' | 'image' }`；图片条目附加 `{ width, height, bytes, sha1, thumb }`（`text` 恒 `''`），文本条目不带图片字段。
- 持久化：元数据 `userData/clipboard-history.json`（node-kit `writeAtomic`、防抖 500ms）；原图 `userData/clipboard-history/images/{id}.png`。
- 损坏/半写 JSON：读取校验失败 → 删除重建空表 + `electron-log` warn（断电恢复口径）。

## 3. 错误码（结构化，中文文案）

| code                | 触发                            | 文案与恢复                     |
| ------------------- | ------------------------------- | ------------------------------ |
| `CH_STORAGE_FAILED` | 存储读取/原子写失败（含磁盘满） | 「剪贴板历史读写失败」+ 重试；内存态继续可用 |
| `CH_IMAGE_MISSING`  | image/copy 通道 PNG 文件缺失（崩溃残留/被外部删除） | 「图片文件已丢失」+ 重试（重试 = 重新 list 移除幽灵条目）；**M61 新增** |
| `INVALID_INPUT`     | 信封校验失败 / pin·remove·image·copy 非法 id | 沿用共享信封文案               |

## 4. R2 八类异常映射（记入 `docs/smoke/clipboard-history.md`）

| 类别           | 本工具映射                                                        |
| -------------- | ----------------------------------------------------------------- |
| 1 中文/空格    | 中文/空格剪贴板文本入库与持久化往返；中文文件名不涉（固定名存储）   |
| 2 文件占用     | 存储写失败 → `CH_STORAGE_FAILED` 错误态 + 重试（单测 mock 分支）    |
| 3 加密         | 不适用（无加密输入）                                               |
| 4 超大         | 文本 >100KB / 图片 >5MB 跳过 + 一次性提示（单测 + e2e）            |
| 5 任务取消     | 离开页面 `clearInterval` 停轮询（e2e 切页后剪贴板变化不入库）       |
| 6 并发         | 单实例 + 页内单定时器；pin/remove/clear 主进程同步串行              |
| 7 磁盘满       | 原子写失败 → `CH_STORAGE_FAILED`，内存态继续（单测 mock）           |
| 8 断电恢复     | 原子写防半写；损坏 JSON → 重建空表 + warn；孤儿 PNG 加载清理（单测） |

## 5. 壳接线 6 处（照 calendar §4.58 模板）

vite alias（manifest + renderer 正则）· `apps/desktop/package.json` workspace 依赖 · `tool-manifests.ts` 1 行 · `tools/clipboard-history.vue` 薄壳 · `AppSidebar` iconMap `'clipboard-list': ClipboardList` · 根 `vitest.config.ts` 本包纯函数阈值 80%。

manifest：`category: 'text'`、`order: 65`、`icon: 'clipboard-list'`。**M61 零壳改动**（通道归包、UI 归 ToolView）。

## 6. 验收

- 单测 ≥80%（本包阈值 80%）：M59 全量 + M61 增量——图片优先判定、SHA-1 去重、图片独立上限淘汰（置顶不淘汰）、旧 JSON `type` 默认兼容、搜索排除图片、孤儿 PNG 清理、image/copy 通道注入测试（含文件缺失 → `CH_IMAGE_MISSING`）。
- e2e `clipboard-history-smoke.spec.ts`：M59 四用例 + M61 ≥2 用例——`app.evaluate` 经主进程 `clipboard.writeImage` 写入真实图片 → 轮询入库 → 类型筛选（全部/图片/文本）→ 预览 modal 出原图 → 复制回写；图片文件缺失 → `CH_IMAGE_MISSING` 错误态。
- R5：工具 chunk + 独占依赖 gzip < 200KB（M61 实测回填）。
- `pnpm gate` 全绿；文档五处同步（spec 本文件 / smoke / README 中英 / CHANGELOG / plan §4.61）。
