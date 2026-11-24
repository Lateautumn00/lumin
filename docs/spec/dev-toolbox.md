# dev-toolbox 字段级功能清单（M42 / M45）

> 规范源：`AGENTS.md`（强制执行）。路线图：`.trae/documents/Lumin 功能清单差距审计与后续路线图.md` §M42、`docs/opencode/plan.md` §4.45（M45）。
> 分支 `feature/m42-dev-toolbox`（自 `feature/m41-fs-cleaner` 的 `50cf650` 切出）。
> **零新增第三方依赖**；不扩展 `plugin-api` 公共契约；不新增壳能力通道。

---

## 0. 工具元信息

| 项 | 值 |
| --- | --- |
| id | `dev-toolbox` |
| name | 开发工具 |
| description | 端口占用查询与进程结束、CURL 转代码、JWT 解码、本地静态服务器 |
| icon | `terminal`（`@lucide/vue` 的 `Terminal`） |
| category | `misc` |
| order | 70 |
| version | `0.1.0` |

包名 `@lumin/tool-dev-toolbox`，目录 `packages/tools/dev-toolbox`，形态 `manifest.ts + renderer/ + node.ts`。

---

## 1. 页签一：端口占用（`ports`）

### 输入

| 控件 | 说明 |
| --- | --- |
| 端口号输入框 | 可选，整数 1–65535；留空表示查全部 TCP/UDP 监听与连接 |
| [查询] 按钮 | 同步 invoke `dev-toolbox:ports-query`；查询中禁用并显示加载态 |
| 过滤框 | 前端按端口/PID/进程名子串过滤（不重新查询） |

### 主进程行为（`node.ts`）

1. 执行 `netstat -ano -p tcp` 与 `netstat -ano -p udp`（`node-kit.runProcess`，超时 15s）。
2. 解析行：`协议 本地地址 外部地址 状态 PID`；`LISTENING`/`ESTABLISHED`/`UDP` 行（UDP 行无状态列，需兼容列数差异）。
3. `tasklist /FO CSV /NH` 一次性取 PID→进程名映射（超时 15s，失败不影响端口列表，进程名留空）。
4. 输出行数上限 5000，超出截断并置 `truncated: true`。
5. 结果按端口升序、PID 升序稳定排序。

### 输出

表格列：协议 / 本地地址 / 端口 / 状态 / PID / 进程名。
底部摘要：「共 N 条（已截断）」+ PID 行内 [结束进程] 按钮。

[结束进程] 必须 `NPopconfirm` 二次确认，文案含进程名与 PID；确认后同步 invoke `dev-toolbox:port-kill`。

### 安全约束

- 拒绝 PID ≤ 0 与自身 PID（`process.pid`）→ `DT_KILL_SELF_FORBIDDEN`。
- 命令执行一律 `execFile('taskkill', ['/PID', pid, '/T', '/F'])`，**禁止**字符串拼接进 shell。

### 错误分支

| 错误码 | 触发 | 文案 |
| --- | --- | --- |
| `DT_INVALID_PORT` | 端口非 1–65535 整数 | 端口号须为 1–65535 的整数 |
| `DT_NETSTAT_FAILED` | netstat 非零退出/超时 | 查询端口占用失败 |
| `DT_KILL_FAILED` | taskkill 非零退出 | 结束进程失败（可能已退出或无权限） |
| `DT_KILL_SELF_FORBIDDEN` | 目标 PID 为自身 | 不能结束本程序进程 |

---

## 2. 页签二：CURL 转代码（`curl`）

纯 renderer，无 IPC。左侧输入 curl 命令，右侧输出代码，350ms 防抖实时转换。

### 支持参数

`-X/--request`、`-H/--header`（可多次）、`-d/--data/--data-raw/--data-binary`（可多次，按 `&` 连接）、`-b/--cookie`、`-A/--user-agent`、`-u/--user`、`-I/--head`、`--compressed`、`-k/--insecure`（仅注释忽略）、URL 位置参数（取第一个）。

### 不支持参数

遇到其余 `-*` 参数 → 报 `DT_CURL_PARSE_FAILED`，detail 指明「暂不支持的参数：-x」。支持 `\` + 换行续行、单引号/双引号/无引号值、`$'...'` 转义按普通引号处理。

### 输出目标

`NRadioGroup`：`fetch` / `axios` / `python`（默认 `fetch`）。输出只读 `<pre>` + [复制]。

### 生成规则

- fetch：`await fetch(url, { method, headers, body })`，method 缺省 `GET`；有 body 且未显式 `-X` 时 `POST`。
- axios：`await axios({ url, method, headers, data })`。
- python：`requests.request(method, url, headers=..., data=...)`。
- 字符串一律单引号转义（js）/ repr 风格（python）。

### 错误分支

| 错误码 | 触发 |
| --- | --- |
| `DT_CURL_PARSE_FAILED` | 空输入、缺少 URL、遇到不支持参数、引号未闭合 |

---

## 3. 页签三：静态服务器（`server`）

### 输入

| 控件 | 说明 |
| --- | --- |
| 根目录 | `window.lumin.pickDirectory()`，选中即记忆（settings `devToolboxRoot`） |
| 端口 | 1–65535，默认 8080，记忆（settings `devToolboxPort`） |
| [启动] / [停止] | 同步 invoke `dev-toolbox:server-start` / `dev-toolbox:server-stop` |
| 地址显示 | 运行中显示 `http://127.0.0.1:<port>/` + [复制] |

### 主进程行为

- `node:http` 创建服务，仅绑定 `127.0.0.1`。
- 仅允许 `GET`/`HEAD`，其余 405。
- 路径解析：`decodeURIComponent` → `path.resolve(root, '.' + pathname)`；结果**必须**以 `root + sep` 开头（等值视为目录），否则 403；违反即返回 403 并记录。
- 目录请求：存在 `index.html` 则返回；否则返回最小 HTML 列表（文件名 + 大小，`text/html; charset=utf-8`，文件名做 HTML 转义）。
- MIME 表内置：html/htm/css/js/mjs/json/txt/md/svg/png/jpg/jpeg/gif/webp/ico/pdf/wasm/woff2/mp4/mp3/map；未知 → `application/octet-stream`。
- 访问日志环形缓冲 200 条：`{ time, method, path, status, bytes }`。
- `dev-toolbox:server-status` 同步 invoke 返回 `{ running, port, root, requests: 最近 50 条 }`；renderer 每 1s 轮询（仅运行中）。
- 再次 [启动] 时先关闭旧服务。

### 错误分支

| 错误码 | 触发 |
| --- | --- |
| `DT_ROOT_INVALID` | 目录不存在或非目录 |
| `DT_PORT_IN_USE` | `EADDRINUSE` |
| `DT_SERVER_FAILED` | 其余监听失败（`EACCES` 等） |

带宽说明：仅本机调试用，不做鉴权；页面常驻提示「仅监听 127.0.0.1，勿用于公网」。

---

## 4. 页签四：JWT 解码（`jwt`，M45）

纯 renderer，无 IPC。粘贴 token 后 350ms 防抖自动解码，**只解码展示，不校验签名**。

### 输入

| 控件 | 说明 |
| --- | --- |
| token 多行输入框 | 接受 `header.payload.signature`；允许 `Bearer ` 前缀与首尾空白 |
| [填入示例] | 固定样本（HS256 / `exp=1516242622`） |
| [清空] | 清空输入与结果 |

### 解码规则

1. 去空白与 `Bearer ` 前缀后按 `.` 切三段；段数 ≠ 3 → `DT_JWT_INVALID`。
2. Base64URL 解码（`-`→`+`、`_`→`/`、忽略 `=`），按 UTF-8 严格解码；非法字符/非 UTF-8 → `DT_JWT_INVALID`。
3. header / payload 必须是 JSON **对象**（数组与标量非法）→ 否则 `DT_JWT_INVALID`。
4. `exp` / `iat` 取 `number` 且有限，否则视为缺失（null）；`exp !== null && exp <= now` 判为已过期。
5. 输出 Header / Payload 格式化 JSON（可分别复制）与时效标签「未过期 / 已过期 / 无 exp」。

### 错误分支

| 错误码 | 触发 | 文案 |
| --- | --- | --- |
| `DT_JWT_INVALID` | 空输入、分段数≠3、Base64URL 非法、非 UTF-8、段非 JSON 对象 | JWT 格式无效（不可重试） |

---

## 5. IPC 契约

| 通道 | 类型 | 入参 | 出参 |
| --- | --- | --- | --- |
| `dev-toolbox:ports-query` | invoke | `{ port?: number }` | `{ rows: PortRow[], truncated: boolean, elapsedMs: number }` |
| `dev-toolbox:port-kill` | invoke | `{ pid: number }` | `{ ok: true }` |
| `dev-toolbox:server-start` | invoke | `{ root: string, port: number }` | `{ running: true, port: number, root: string }` |
| `dev-toolbox:server-stop` | invoke | `{}` | `{ running: false }` |
| `dev-toolbox:server-status` | invoke | `{}` | `{ running, port?, root?, requests: AccessLog[] }` |
| `dev-toolbox:config` | invoke | `{}` | `{ root: string \| null, port: number }` |
| `dev-toolbox:set-config` | invoke | `{ root?: string \| null, port?: number }` | 同 config |

全部入参 zod 校验；错误统一 `DT_*` 结构化错误码（`toolError` 仿 `fs-cleaner/src/errors.ts`）。

`PortRow = { protocol: 'TCP' | 'UDP'; localAddress: string; port: number; state: string; pid: number; process: string }`。

---

## 6. 三态与 UI 约束

| 页签 | 空态 | 加载态 | 报错态 |
| --- | --- | --- | --- |
| 端口占用 | 「输入端口或留空查询全部」+ [查询] | [查询] 禁用 + `NSpin` | 错误码 → 中文 + [重试]/详情 |
| CURL 转代码 | 示例 curl 占位（placeholder） | 无长任务 | 解析失败原因常驻展示 |
| JWT 解码 | 「粘贴 JWT 后自动解码…」+ [填入示例] | 无长任务（同步解码） | `DT_JWT_INVALID` 中文 + detail + [重试] |
| 静态服务器 | 「选择根目录后启动」 | [启动] 禁用 + 状态文案 | 错误码 → 中文 + [重试]/详情 |

- 样式只用 Tailwind + tokens；图标只用 `@lucide/vue`。
- 关闭/切换工具页时若服务运行中：保留服务（跨页签不打断），页面顶部常驻「服务运行中」提示。

---

## 7. 测试与验收

### 单测（`packages/tools/dev-toolbox/src`）

- `curl.ts`：参数解析 ≥15 例（引号、续行、重复 header、多 data、`-I`、未知参数报错、缺少 URL）。
- `netstat.ts`：固定样本解析（TCP LISTENING / ESTABLISHED / UDP 三列行、IPv6 地址、含空格）≥8 例。
- `mime.ts`/路径穿越判定：≥6 例。
- `jwt.ts`（M45）：Base64URL 变体/填充/非法字符/非 UTF-8、分段数、非对象 JSON、Bearer 前缀、空签名、exp/iat 与过期边界 ≥15 例。
- `errors.ts` 与 schema：≥5 例。
- 包覆盖率 ≥80%（statements/branches/functions/lines）。

### e2e（`apps/desktop/e2e/dev-toolbox-smoke.spec.ts`）

1. 侧栏「开发工具」可进入，四页签均可见且各有空态引导。
2. CURL：输入 `curl 'https://a.com/x' -H 'X-A: 1'` → 输出含 `fetch(` 与 `'X-A': '1'`；切到 python 输出含 `requests.request`。
3. JWT：已知样本 → Header 含 `"alg": "HS256"`、Payload 含 `"sub": "1234567890"`、显示「已过期」；非法串 → `DT_JWT_INVALID` + [重试]。
4. 端口：留空查询 → 表格至少 1 行（本机必有监听）；非法端口 `70000` → `DT_INVALID_PORT` 文案可见。
5. 静态服务器：临时目录写 `index.html` → 启动 → 页面显示 `http://127.0.0.1:` 地址；停止后状态回未运行。（HTTP 请求断言可在主进程侧用 Node `fetch` 直接在 spec 内验证 200 与内容）
6. 错误态：无效目录启动 → `DT_ROOT_INVALID` 文案 + [重试] 可见。

### 门禁

`pnpm --filter @lumin/tool-dev-toolbox typecheck` → `pnpm exec vitest run packages/tools/dev-toolbox` → `pnpm --filter @lumin/desktop build`（记录 chunk raw/gzip）→ e2e（由主会话串行执行）。

## M60 扩展（速赢档一 · Q62/M60，2026-11-23 登记）：进制与位运算

- **区 A「进制互转」**：输入框（容忍 `0x`/`0b`/`0o` 前缀——与所选进制一致时采纳；剥离下划线与空格分组）+ 当前进制单选（2/8/10/16）→ 四读数卡 BIN/OCT/DEC/HEX（十六进制大写、每 4 位空格分组）+ 所需最少位宽徽标。
- **区 B「位运算」**：A、B 输入（默认十进制、BigInt、非负）、运算单选 AND/OR/XOR/NOT（NOT 单目时隐藏 B 框）→ 结果同步显示十/二/八/十六进制；NOT 与全运算按 **64 位无符号**（`BigInt.asUintN(64, …)`）口径，界面注明，避免负号困扰。
- **约束**：互转区仅非负整数（≤ 2^63-1 十进制可负、绝对值 ≤ 63 位）；位运算输入 ≤ 2^64-1；非法字符/小数/超范围 → 沿用本工具既有错误码前缀（从既有码表取），中文文案 + 恢复上一有效值。
- **实现**：纯函数 `convertBase(raw, from)`、`bitwise(a, op, b)`、`groupDigits`。零 IPC、零依赖。
- **验收**：单测锚点（0xFF 四进制互转、`0b1010` 前缀、下划线分组、2^64-1 边界、负十进制 asUintN、NOT 口径、非法字符、小数拒绝、分组宽度）本包 ≥80%；e2e ≥1 用例；R2 记入 `docs/smoke/dev-toolbox.md` M60 增量节；chunk <200KB gzip。
