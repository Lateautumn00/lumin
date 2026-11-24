# 思维导图（mindmap）字段级功能清单

> 里程碑：M66（已登记 `docs/opencode/plan.md` §1 Q68 / §4.66 / §6）
> 状态：**2026-11-24 规划定稿，待开工**
> 关联规范：`AGENTS.md` §2（零耦合）、§5（三态/tokens/图标）、§6（IPC 三段式）、§7（测试门禁）、§8（性能）
> 依赖实测：`mind-elixir@6.0.3`（MIT、零传递依赖）`dist/MindElixir.js` 42,200 B gzip、`MindElixir.css` 4,858 B gzip；`./i18n` 2,651 B gzip

---

## 0. 目标与边界

### 0.1 目标

新增独立工具包 `mindmap`（名称「思维导图」）：在应用内新建/编辑树形思维导图，支持增删改、折叠、自动左右布局、缩放平移、拖拽重排、节点与连线样式、明暗主题、原生 JSON / Markdown 大纲 / OPML 导入导出、PNG/SVG 导出、本地 `.json` 打开与另存、`userData` 草稿自动保存与重启恢复。全程离线，不新增自研渲染引擎。

### 0.2 做

| 能力       | 说明                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------ |
| 基础编辑   | 根/子/同级节点增删改、折叠展开、自动左右布局、缩放平移、内置快捷键                         |
| 拖拽重排   | 拖拽改父级或同层排序；节点背景/文字/边框/字号/加粗与分支连线色；明暗主题随壳切换            |
| 导入导出   | 原生 JSON、Markdown 大纲、OPML 导入导出；导出 PNG/SVG                                      |
| 本地文件   | `.json` 打开 / 保存 / 另存为（主进程 `dialog` + zod + `.tmp`+rename 原子写）               |
| 草稿       | 变更防抖写 `userData/mindmap/draft.json`；启动检测恢复；损坏草稿降级忽略并留痕              |
| 安全       | 导入时剥离 `dangerouslySetInnerHTML`/图片/图标等不支持的节点字段，链接仅放行 http/https/mailto |

### 0.3 不做（明确冻结）

- 多人协作、云同步、在线分享、导出可交互 HTML
- 图片节点、附件节点、图标选择器（`icons` 仅原样保留，不提供 UI）
- 多文档标签页、移动端布局、自由画布（非树形）
- 由文本或 OCR 自动生成导图、AI 扩写
- 富文本/公式/Markdown 渲染开关（`markdown` 选项不启用，节点按纯文本编辑）

---

## 1. 工具清单（manifest）

| 字段        | 值                                                                 |
| ----------- | ------------------------------------------------------------------ |
| id          | `mindmap`                                                          |
| name        | `思维导图`                                                         |
| description | `新建与编辑树形思维导图，支持导入导出与本地文件`                   |
| icon        | `network`（壳 `AppSidebar` iconMap 注册 `Network`）                |
| category    | `text`                                                             |
| order       | `58`（text-editor 55 之后、text-toolbox 60 之前）                  |
| version     | `0.1.0`                                                            |

无自定义 settings 键；最近目录交给壳 `pickSaveFile` 记忆。

---

## 2. 界面规格（单页，三态强制）

页面标题「思维导图」，副标题「树形大纲与自由布局，本地保存，全程离线」。

### 2.1 页面结构

```
┌ 工具栏（新建/打开/保存/另存为 | 撤销/重做 | 导入/导出 | 布局/缩放 | 主题）┐
├ 画布区 .mindmap-stage（mind-elixir 挂载点，data-testid="mindmap-stage"）   ┤
└ 状态栏（文件名 · 未保存标记 · 节点数 · 草稿时间 · 缩放比例）              ┘
```

### 2.2 空态

- 居中引导卡（禁止白屏）：
  - 主操作「新建导图」：`NInput` 输入中心主题（默认「中心主题」，≤200 字），确认后初始化并聚焦根节点。
  - 次操作「打开文件」：`.json`（`MM_*` 过滤）。
  - 次操作「导入」：`.md/.markdown/.opml` 二选一。
  - 若存在草稿：额外顶部 `NAlert`「检测到 {相对时间} 的草稿」+「恢复」/「丢弃」。

### 2.3 工具栏（按钮集）

| 分组 | 按钮             | 图标（@lucide/vue） | 启用条件 / 行为                                                        |
| ---- | ---------------- | ------------------- | ---------------------------------------------------------------------- |
| 文件 | 新建             | `FilePlus`          | 有未保存修改先确认；重置画布与撤销栈                                    |
| 文件 | 打开             | `FolderOpen`        | `pickFile`（壳无 pickFile → 用 `mindmap:open-dialog`）+ 读取校验        |
| 文件 | 保存             | `Save`              | 无路径 → 转另存为；有路径直接原子写；保存中禁用                         |
| 文件 | 另存为           | `SaveAll`           | `window.lumin.pickSaveFile({ defaultName, filters })`                   |
| 编辑 | 撤销 / 重做      | `Undo2` / `Redo2`   | 调 `mei.undo()/redo()`；无可撤销时禁用                                  |
| 导入 | 导入 Markdown    | `FileDown`          | 选择 `.md/.markdown` → `mindmap:read-text-file` → `importMarkdown`      |
| 导入 | 导入 OPML        | `FileDown`          | 选择 `.opml` → `mindmap:read-text-file` → `importOpml`                  |
| 导出 | 导出 JSON        | `Download`          | `serializeDocument` → `mindmap:write-export`                            |
| 导出 | 导出 Markdown    | `Download`          | `exportMarkdown` → `mindmap:write-export`                              |
| 导出 | 导出 OPML        | `Download`          | `exportOpml` → `mindmap:write-export`                                  |
| 导出 | 导出图片         | `ImageDown`         | 打开 `NModal`：格式 PNG/SVG、倍率 1/2/3（默认 2）、背景 主题/白/透明     |
| 视图 | 布局方向         | `Network`           | `NSelect`：左右（默认，`SIDE`）/ 右侧（`RIGHT`）/ 左侧（`LEFT`）/ 向下（`DOWN`） |
| 视图 | 适应窗口         | `Maximize`          | `mei.scaleFit()`                                                       |
| 视图 | 缩放 − / 比例 / + | `ZoomOut` / `ZoomIn` | 10%–200% 步进 10%；调 `mei.scale()`                                    |
| 视图 | 全部展开/折叠    | `ChevronsDownUp` / `ChevronsUpDown` | `mei.expandNodeAll(root, true/false)`                       |
| 视图 | 主题             | `Sun` / `Moon`      | 切换壳主题（写 `html[data-theme]`，经 tokens 桥接，不做工具内主题分叉）  |

### 2.4 节点样式面板（右侧抽屉，`NDrawer`）

| 项       | 控件            | 约束                                                              |
| -------- | --------------- | ----------------------------------------------------------------- |
| 节点背景 | `NColorPicker`  | 写 `style.background`；「清除」回退主题                           |
| 文字颜色 | `NColorPicker`  | 写 `style.color`                                                  |
| 边框     | `NInput`        | 仅接受 `1px solid #RRGGBB` 形态；写 `style.border`                |
| 字号     | `NInputNumber`  | 12–32；写 `style.fontSize`（纯数字字符串）                        |
| 加粗     | `NSwitch`       | 写 `style.fontWeight` = `'700'` / 清除                            |
| 分支线色 | `NColorPicker`  | 写 `branchColor`                                                  |
| 重置     | 按钮            | 删除当前节点全部样式字段并 `refresh`                              |

写回流程：`mei.reshapeNode(currentNode, patch)` → 触发 `operation` 事件 → 标脏 + 草稿调度。

### 2.5 快捷键

| 快捷键           | 行为                                   | 来源                          |
| ---------------- | -------------------------------------- | ----------------------------- |
| `Tab`            | 新建子节点                             | mind-elixir `keypress` 内置   |
| `Enter`          | 新建同级节点                           | 内置                          |
| `F2` / 双击      | 编辑节点主题                           | 内置                          |
| `Delete` / `Backspace` | 删除选中节点（根节点禁止）       | 内置                          |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做                        | 内置 + 工具栏                 |
| `方向键`         | 节点间移动焦点                         | 内置                          |
| `Ctrl+S`         | 保存                                   | 工具页 window 监听（capture） |
| `Ctrl+Shift+S`   | 另存为                                 | 同上                          |
| `Ctrl+O`         | 打开                                   | 同上                          |
| `Ctrl+N`         | 新建                                   | 同上                          |
| `Ctrl+0`         | 适应窗口                               | 同上                          |
| `Ctrl+=` / `Ctrl+-` | 放大 / 缩小                         | 同上                          |

工具级快捷键仅在画布区获得焦点或页面激活时生效，`preventDefault` 后不冒泡到壳。

### 2.6 加载态

- 打开/导入/导出/保存统一 `NLoadingBar` + 画布上方 `NSpin`（不遮挡工具栏）。
- 文案：`正在打开…` / `正在导入 Markdown…` / `正在导出 PNG（2×）…` / `正在保存…`。
- 图片导出 >1.5s 时显示「取消」；取消用 `AbortController` 中止后续栅格化并丢弃结果，回到可操作态（文件不落盘）。

### 2.7 报错态

- `NAlert`（error）展示：中文文案 + `code` + `detail`。
- 「重试」仅对 `retryable` 码显示；文档损坏类提供「重新选择文件」。
- 草稿损坏不上报错误态：`NAlert`（warning）一行「草稿已损坏，已忽略（原文保留为 draft.corrupt-*.json）」。

---

## 3. 数据模型（文档 JSON）

### 3.1 顶层结构（原生 `MindElixirData`，不另包信封）

```jsonc
{
  "nodeData": {
    "id": "root01",
    "topic": "中心主题",
    "note": "可选备注",
    "hyperLink": "https://example.com",
    "expanded": true,
    "style": { "background": "#eef2ff", "color": "#0f172a", "fontSize": "16" },
    "tags": ["标签"],
    "branchColor": "#4f46e5",
    "children": [
      { "id": "n2", "topic": "一级主题", "direction": 1, "children": [] }
    ]
  },
  "arrows": [],
  "summaries": [],
  "direction": 2,
  "meta": { "app": "lumin-mindmap", "version": 1 }
}
```

- `direction`：`0` 左 / `1` 右 / `2` 左右 / `3` 向下，与 `MindElixir.LEFT|RIGHT|SIDE|DOWN` 一致。
- `arrows` / `summaries`：本批不提供创建入口，但**原样保留**（避免往返丢数据），schema 仅限长度 ≤200 的任意对象数组。
- `meta` 仅作来源标记；导入时忽略未知键，保存时由工具写入 `{ app, version: 1 }`。
- 保存前剔除运行时字段：`parent`、`dangerouslySetInnerHTML`、`image`、`metadata`、`icons`。

### 3.2 zod schema（`schema.ts`）

| 字段                                  | 规则                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `id`                                  | 1–64 位 `[A-Za-z0-9_-]`；缺失/重复由 `sanitizeDocument` 注入 `newId()` 重新生成         |
| `topic`                               | trim 后 1–2000 字符；空 → 「未命名」；控制字符（除常规空白）剔除                        |
| `note`                                | ≤5000 字符                                                                             |
| `hyperLink`                           | ≤2048；仅 `http:`/`https:`/`mailto:`，其余丢弃并记 warning                             |
| `expanded`                            | boolean，缺省 true                                                                     |
| `direction`（子节点）                 | `0 | 1`；根节点忽略                                                                     |
| `style`                               | 仅白名单键：`fontSize/fontFamily/color/background/fontWeight/width/border/textDecoration`；值 ≤64 且正则 `^[#a-zA-Z0-9(),.%\s-]+$`，含 `url(`/`expression`/`;` 一律丢弃 |
| `tags`                                | ≤10 项，每项 ≤64 字符                                                                  |
| `branchColor`                         | 颜色正则（`#RGB`/`#RRGGBB`/`rgb()/rgba()`）                                             |
| `children`                            | 递归；空数组合法                                                                       |
| 文档上限                              | 节点数 ≤5000、深度 ≤50、序列化 ≤5MiB（`MM_NODE_LIMIT` / `MM_DOC_TOO_LARGE`）            |

### 3.3 清洗与统计（`contract.ts`，纯函数、可注入 id 生成器）

| 函数                                          | 行为                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `sanitizeDocument(input, newId)`              | 剥危险/不支持字段、修 id、限长限深；返回 `{ data, warnings }`        |
| `countNodes(data)`                            | 节点总数                                                             |
| `treeDepth(data)`                             | 最大深度（根 = 1）                                                   |
| `collectIds(data)`                            | 全量 id 集合（查重）                                                 |
| `createDocument(topic)`                       | 生成根节点最小文档（`MindElixir.new` 等价，脱离库可测）              |
| `directionLabel(code)` / `normalizeDirection` | 布局枚举与文案/缺省归一                                              |

---

## 4. 导入导出映射

### 4.1 JSON

- 导出：`serializeDocument(mei.getData(), { pretty: true })` → 2 空格缩进、UTF-8、无 BOM。
- 导入：读文件 → `JSON.parse`（失败 `MM_INVALID_DOCUMENT`）→ `sanitizeDocument` → `mei.refresh(data)` + `clearHistory()`。
- 文件名缺省：`{当前名或"未命名导图"}.json`。

### 4.2 Markdown 大纲

导出（`exportMarkdown(data)`）：

```markdown
# 中心主题
> 根节点备注

## 一级主题
- 二级主题
  - 三级主题
    - 四级主题
```

- 根 → `# `；深度 1 → `## `；深度 ≥2 → `- ` + 2×(深度−1) 个空格缩进的列表项。
- `note` → 紧随节点行、同缩进的 `> ` 行（多行逐行加 `> `）。
- `hyperLink` → 行尾追加 ` [链接](url)`。
- 空节点保留为空行内容（`- `）。

导入（`importMarkdown(text, newId)`）：

- 跳过 ``` 围栏代码块与空行；标题 `#{1,6}` 的层级 L → 深度 L−1；跳级按父级+1 并记 warning。
- 列表行 `^(\s*)[-*+]\s+(.*)$`：缩进 ÷2 取整为相对层级（Tab 计 2 空格）。
- `> ` 行归到最近节点 `note`（多行以 `\n` 连接）。
- 行尾 `[显示文本](url)` → `topic=显示文本`、`hyperLink=url`（协议校验同 §3.2）。
- 多个顶层节点 → 建虚拟根「导入导图」并记 warning；0 节点 → `MM_IMPORT_INVALID`。
- 上限与 §3.2 一致。

### 4.3 OPML 2.0

导出（`exportOpml(data)`，`escapeXml` 纯函数转义）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>中心主题</title></head>
  <body>
    <outline text="中心主题" _note="备注" url="https://example.com" _expanded="false" />
  </body>
</opml>
```

- 节点属性：`text`=topic、`_note`=note、`url`=hyperLink、`_expanded="false"` 仅折叠时写入。
- 导入：渲染进程 `DOMParser` 解析；`parsererror` → `MM_IMPORT_INVALID`；遍历 `outline` 嵌套，缺 `text` 回退 `title`；OPML 无 id → 全部重新生成；深度/节点超限按上限截断并记 warning。

### 4.4 PNG / SVG 导出（自研，零新增依赖）

mind-elixir 6 核心不含导出能力（`exportPng/exportSvg` 不在公开 API），故由工具包自研轻量导出：

| 步骤     | 实现                                                                                         |
| -------- | -------------------------------------------------------------------------------------------- |
| 取景     | `computeExportBox(rects, padding=32)`：节点包围盒并集 + 内边距，最小 320×200，忽略当前缩放/平移 |
| 样式快照 | 读取 `html` 计算样式中的 `--lumin-*` 与 `--node-gap-*` 等变量，拼进 `<style>`，连同 `MindElixir.css` 文本（`?inline` 导入） |
| SVG      | `buildSvgDocument({ width, height, background, css, body })` → `<svg xmlns><style/>[背景 rect]<foreignObject><div xmlns="xhtml">节点+连线层深克隆</div></foreignObject></svg>`；剔除工具栏/缩放条/浮动面板与 `transform` |
| PNG      | SVG 字符串 → `Blob` → `Image` → `canvas(width×scale, height×scale)` → `toBlob('image/png')`     |
| 参数     | 倍率 `1|2|3`（默认 2）；背景 `theme`（取当前 `--bgcolor`）/`white`/`transparent`（透明不写背景 rect） |
| 上限     | 单边 ≤8192px 且总像素 ≤32M，超出 → `MM_EXPORT_TOO_LARGE`                                      |

---

## 5. 本地文件与草稿

### 5.1 IPC 通道（`mindmap:{action}`，异步 sync 通道；无 task 队列）

| 通道                        | 类型 | 入参（zod）                                                        | 回包                                                        |
| --------------------------- | ---- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `mindmap:open-dialog`       | sync | `{}`                                                               | `{ path } \| null`（`dialog.showOpenDialogSync`，过滤 `.json`） |
| `mindmap:open-document`     | sync | `{ path }`                                                         | `{ path, name, data, warnings, size, mtimeMs }`             |
| `mindmap:save-document`     | sync | `{ path, data, expectedMtimeMs?, force? }`                         | `{ path, mtimeMs, warnings }`                               |
| `mindmap:read-text-file`    | sync | `{ path }`（`.md/.markdown/.opml/.txt`）                           | `{ text, size, name }`（UTF-8，去 BOM）                     |
| `mindmap:write-export`      | sync | `{ path, text? , base64? }`（二选一；扩展名 `.json/.md/.opml/.svg/.png`） | `{ path, size }`                                    |
| `mindmap:load-draft`        | sync | `{}`                                                               | `{ status: 'ok', data, savedAt, documentPath } \| { status: 'empty' } \| { status: 'corrupt' }` |
| `mindmap:save-draft`        | sync | `{ data, documentPath? }`                                          | `{ savedAt }`                                               |
| `mindmap:clear-draft`       | sync | `{}`                                                               | `{}`                                                        |

- 所有入参 zod 校验；文件路径 `≤4096`；`data` 复用文档 schema；`base64` ≤ 40MiB 字符量。
- 保存冲突：`expectedMtimeMs` 存在且与磁盘不一致 → `MM_FILE_CHANGED`（UI 提示「文件已被外部修改」+ 覆盖/另存）。
- 原子写统一 `@lumin/node-kit` 的 `writeAtomic`；写前 `mkdir(recursive)`。
- 草稿路径：`join(paths.userData, 'mindmap', 'draft.json')`；临时文件 `draft.json.tmp`。

### 5.2 草稿策略

| 项       | 规则                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| 触发     | `mei.bus` 的 `operation` / `changeDirection` / `refresh` 事件标脏                        |
| 节流     | 防抖 **800ms**，最长等待 **4000ms**（持续编辑每 4s 必落一次）；保存成功/切页/卸载前 flush  |
| 内容     | `{ savedAt: ISO, documentPath?: string, data: MindElixirData }`（已清洗，剔除运行时字段） |
| 上限     | 序列化 >2MiB 或节点 >5000 → 暂停本次会话自动保存，状态栏提示「草稿过大，已暂停自动保存」  |
| 恢复     | 启动 `load-draft`：`ok` 显示恢复条；`empty` 不显示；`corrupt` 显示 warning 一行           |
| 损坏降级 | JSON/结构校验失败 → `rename(draft.json, draft.corrupt-{yyyyMMddHHmmss}.json)`，返回 `corrupt`，`ctx.log.warn` |
| 清除     | 新建/打开/导入成功且已另存后清除草稿；「丢弃草稿」显式清除                                |

---

## 6. 主题与 tokens 桥接（`theme.ts`）

| mind-elixir cssVar        | tokens 来源                       |
| ------------------------- | --------------------------------- |
| `--bgcolor`               | `--lumin-color-bg`                |
| `--color`                 | `--lumin-color-text`              |
| `--main-color`            | `--lumin-color-primary`           |
| `--main-bgcolor`          | `--lumin-color-surface`           |
| `--main-border`           | `--lumin-color-border`            |
| `--root-bgcolor`          | `--lumin-color-primary-soft`      |
| `--root-color`            | `--lumin-color-text`              |
| `--root-border-color`     | `--lumin-color-primary`           |
| `--selected`              | `--lumin-color-primary-hover`     |
| `--accent-color`          | `--lumin-color-accent`            |
| `--panel-bgcolor`         | `--lumin-color-bg-elevated`       |
| `--panel-color`           | `--lumin-color-text`              |
| `--panel-border-color`    | `--lumin-color-border`            |
| `--main-radius`/`--root-radius` | `--lumin-radius-md`         |
| `--topic-padding`         | `8px 12px`（tokens 无对应时取间距 token 组合） |

- 实现：`readThemeTokens(getComputedStyle)`（纯函数，入参可注入读取器）→ `buildTheme(tokens, 'light'|'dark')` → `new MindElixir({ theme })`；明暗切换时 `mei.changeTheme(theme, true)`。
- 监听 `html[data-theme]` 的 `MutationObserver`；组件卸载断开。
- 禁止在组件内写 `:deep()` 改库样式、禁止硬编码色值；`MindElixir.css` 只做基础引入（`import 'mind-elixir/style.css'`）。
- 上下文菜单语言：`contextMenu: { locale: zh_CN, link: false }`（`mind-elixir/i18n`，关闭连线创建入口）。

---

## 7. 模块与纯函数契约

```
packages/tools/mindmap/
  package.json            exports: ./manifest ./node ./schema ./errors ./contract ./renderer/*
  src/
    manifest.ts           defineManifest（§1）
    schema.ts             文档/通道 zod schema（§3.2、§5.1）
    errors.ts             MM_* 错误码 + toolError + isRetryable
    contract.ts           sanitizeDocument / countNodes / treeDepth / collectIds / createDocument / normalizeDirection
    markdown.ts           importMarkdown / exportMarkdown（+ 行解析器）
    opml.ts               importOpml / exportOpml / escapeXml
    theme.ts              readThemeTokens / buildTheme（tokens → cssVar）
    node.ts               registerWith(ctx, deps) + registerMain（§5.1 八通道）
    renderer/
      ToolView.vue        三态 UI + 工具栏 + 抽屉 + 快捷键 + 草稿调度
      client.ts           类型化 invoke 封装（8 个函数）
      mind-elixir-adapter.ts  动态 import、实例创建/销毁、事件桥、方向与缩放命令
      export-image.ts     computeExportBox / buildSvgDocument / rasterizePng（AbortSignal）
```

- `node.ts` 依赖注入接口 `MindmapDeps { stat, readFile, writeAtomic, rename, mkdir, now }`，`registerWith` 供单测；生产 `registerMain` 用真实 fs。
- `node.ts` 只做 I/O 与校验，不做树清洗（清洗在 renderer 的 `sanitizeDocument`，保存前也走一次，双保险但实现单一）。
- 动态 import：`const { default: MindElixir } = await import('mind-elixir')`，保证工具 chunk 懒加载。

---

## 8. 错误码表（`errors.ts`）

| 码                  | 文案                                     | 可重试 |
| ------------------- | ---------------------------------------- | ------ |
| `MM_INVALID_PAYLOAD`| 参数无效                                 | 否     |
| `MM_INVALID_PATH`   | 文件路径无效                             | 否     |
| `MM_NOT_FOUND`      | 文件不存在                               | 否     |
| `MM_LOCKED`         | 文件被其他程序占用，请关闭后重试         | 是     |
| `MM_DOC_TOO_LARGE`  | 文档超过 5MB 上限                        | 否     |
| `MM_INVALID_DOCUMENT` | 文档格式不正确，无法作为思维导图打开   | 否     |
| `MM_NODE_LIMIT`     | 节点超过 5000 个或层级超过 50 层         | 否     |
| `MM_IMPORT_INVALID` | 导入内容无法解析为大纲                   | 否     |
| `MM_FILE_CHANGED`   | 文件已被外部修改，请确认后覆盖或另存     | 是     |
| `MM_SAVE_FAILED`    | 保存失败，请检查磁盘空间与目录权限       | 是     |
| `MM_READ_FAILED`    | 读取失败，请检查文件权限                 | 是     |
| `MM_DRAFT_TOO_LARGE`| 草稿超过 2MB，已暂停自动保存             | 否     |
| `MM_EXPORT_TOO_LARGE` | 导出图片尺寸过大（单边 8192px / 32M 像素） | 否  |
| `MM_EXPORT_FAILED`  | 导出失败，请重试                         | 是     |

---

## 9. 工程接线

- 新包 `packages/tools/mindmap`：依赖 `mind-elixir@6.0.3`、`@lucide/vue`、`@lumin/{plugin-api,shared,node-kit,ui}`、`naive-ui`、`vue`、`zod`（精确钉版）。
- 壳注册 6 处：
  1. `apps/desktop/src/tool-manifests.ts` 加 manifest；
  2. `apps/desktop/src/main/tool-mains.ts` 加 `registerMain`；
  3. `apps/desktop/src/renderer/src/layout/AppSidebar.vue` iconMap 加 `network → Network`；
  4. `apps/desktop/src/renderer/src/tools/mindmap.vue` 薄页面；
  5. `apps/desktop/package.json` devDependencies 加 `@lumin/tool-mindmap`；
  6. `apps/desktop/electron.vite.config.ts` 三端 alias（`/manifest`、`/node`、`/renderer/*`）加 `mindmap` 三项。
- `vitest.config.ts`：新增 `packages/tools/mindmap/src/**/*.ts` 的 80% 阈值。
- `pnpm install` 后同步 `pnpm-lock.yaml`（`--frozen-lockfile` CI 校验）。

---

## 10. 性能与规范符合

| 项             | 要求                                                                 |
| -------------- | -------------------------------------------------------------------- |
| 工具 chunk     | mind-elixir 42.2 + CSS 4.9 + i18n 2.6 + 工具代码 ≈ 60–70KB gzip，<200KB |
| 首屏           | 工具页懒加载；库动态 import 后再建实例，壳首屏不受影响               |
| 规模           | 5000 节点内编辑可交互；PNG 导出 2000 节点 ≤5s（2× 倍率）             |
| 导出上限       | 单边 8192px / 32M 像素，防内存爆炸                                   |
| 样式           | 仅 Tailwind + tokens；主题经 cssVar 桥接，无硬编码色值、无 `:deep()` |
| 图标           | 全部 `@lucide/vue`                                                   |
| 日志           | 主进程 `ctx.log.info/warn` 记录注册、草稿降级；禁止 console          |

---

## 11. 验收标准

1. 三态齐全：空态可新建/打开/导入；打开导出有加载提示（图片导出可取消）；错误态带码与重试。
2. 编辑链路：Tab 加子节点、Enter 加同级、F2 改名、Delete 删除、折叠展开、撤销重做均可用且标脏。
3. 布局与拖拽：四种方向切换正确；拖拽可改父级与同层顺序，保存后重开结构一致。
4. 主题：壳切明暗后画布颜色随 tokens 变化；节点自定义样式保留。
5. 文件：中文/空格路径保存与打开成功；`.tmp` 原子写无残留；外部修改后保存报 `MM_FILE_CHANGED`。
6. 导入导出：JSON/Markdown/OPML 往返后树结构与 note/hyperLink 一致；PNG/SVG 可打开且尺寸符合倍率与背景选择。
7. 草稿：编辑后 1s 内落盘；杀进程重启提示恢复；损坏草稿降级并改名留痕。
8. 安全：含 `dangerouslySetInnerHTML`/`image` 的 JSON 打开后被剥离且有 warning；`javascript:` 链接被丢弃。
9. 单测：`contract/markdown/opml/theme/schema/errors/node/client/export-image(纯函数)` 本包覆盖率 ≥80%。
10. e2e（`apps/desktop/e2e/mindmap-smoke.spec.ts`，主进程 stub `dialog.showSaveDialog/showOpenDialogSync` 免原生框）：
    - 空态新建 → 加两级节点 → 保存 → 重新打开断言结构；
    - 导入 Markdown → 断言层级；导出 Markdown/OPML 文件内容断言；
    - 导出 PNG → 断言文件存在、PNG 魔数、尺寸 ≈ 包围盒×倍率；
    - 损坏 JSON → `MM_INVALID_DOCUMENT` 提示；
    - 草稿：编辑后触发保存，重建页面断言恢复条 → 恢复成功。
11. `docs/smoke/mindmap.md` R2 八类逐条记录（映射见 §12）。
12. `pnpm gate` 退出码 0；全仓覆盖率 ≥60%；`pnpm boundary` 无违规。

---

## 12. R2 八类异常映射（交付时写入 smoke）

| # | 场景         | mindmap 验证方式                                                                 |
| - | ------------ | -------------------------------------------------------------------------------- |
| 1 | 中文/空格路径 | `%TEMP%\思维 导图\我的 导图.json` 保存 → 打开 → 结构一致                        |
| 2 | 文件被占用   | 目标文件设只读（模拟占用）→ 保存失败 `MM_SAVE_FAILED`/`MM_LOCKED`，原文件不变     |
| 3 | 加密文件     | JSON 无加密格式；以随机字节/损坏 JSON 模拟 → `MM_INVALID_DOCUMENT`                |
| 4 | 超大文件     | 生成 >5MiB 文档 → `MM_DOC_TOO_LARGE`；>5000 节点 → `MM_NODE_LIMIT`                |
| 5 | 任务取消     | 无队列长任务；记录「本地同步操作不适用」+ 图片导出 >1.5s 取消丢弃、无文件落盘     |
| 6 | 并发溢出     | 无 task 队列；连点保存两次结果一致且无 `.tmp` 残留（记录为不适用 + 实际验证）      |
| 7 | 磁盘满       | 只读盘/模拟 ENOSPC → `MM_SAVE_FAILED`；草稿写失败不阻塞编辑并提示                |
| 8 | 断电恢复     | 编辑后强杀进程 → 重启检测草稿 → 恢复；再写入损坏草稿 → 降级并改名留痕             |

---

## 13. 风险与回滚

| 风险                                   | 处置                                                                 |
| -------------------------------------- | -------------------------------------------------------------------- |
| 自研 SVG `foreignObject` 导出兼容性    | 仅 Chromium（Electron）目标；e2e 断言 PNG 魔数与尺寸；失败降级为 PNG-only 并回写 plan |
| mind-elixir v6 API 与类型漂移          | 精确钉版 6.0.3；适配层集中 `mind-elixir-adapter.ts`，升级只改一处     |
| 大文档卡顿                             | 5000 节点/深度 50 上限；导出像素上限；超限结构化报错                 |
| 导入内容 XSS                           | 剥离 `dangerouslySetInnerHTML`；链接协议白名单；不启用 markdown 渲染  |
| 草稿与手动保存互相覆盖                 | 草稿只写 `userData`，与用户文件路径彻底分离；保存成功后清草稿         |

回滚：删除 `packages/tools/mindmap`、撤销壳 6 处注册与 vitest 阈值、移除 `mind-elixir` 依赖，单 commit revert 即可。
