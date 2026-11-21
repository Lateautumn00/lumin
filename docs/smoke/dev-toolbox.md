# dev-toolbox（开发工具）冒烟记录

> 工具：`dev-toolbox`（M42 三页签 / M45 增 JWT 解码与 UUID 生成，2026-11-21）
> 规格：`docs/spec/dev-toolbox.md` · 自动化：`apps/desktop/e2e/dev-toolbox-smoke.spec.ts` · 单测：`packages/tools/dev-toolbox/src/*.test.ts`
> 手工复现环境：Windows x64 · Electron 45.3.1 · 本地离线
> 结论：五页签功能可用；静态服务器仅监听 `127.0.0.1`；JWT/UUID 为纯 renderer 同步计算；八类异常均有覆盖路径（能实测的已用单测实测，不能实测的给出映射结论，未编造结果）。

## 1. 自动化结果

### 1.1 e2e（7 用例，待主会话串行统一执行）

> 应用有单实例锁，本分支未单独执行 Playwright；以下用例代码已通过桌面 typecheck，结果由主会话统一回填。

| #   | 用例                     | 断言                                                                                                                              | 结果   |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | 页面加载 + 五页签空态    | 标题「开发工具」可见；页签 `ports/curl/jwt/uuid/server` 文案正确；各页签空态引导文案可见；[查询] 可见                             | 待执行 |
| 2   | CURL 转代码              | 输入含 `-H 'X-A: 1'` 的 curl → `pre` 含 `fetch(` 与 `'X-A': '1'`；切 python 含 `requests.request`；切 axios 含 `axios(`           | 待执行 |
| 3   | JWT 解码 + 非法 token    | 已知样本 → Header 含 `"alg": "HS256"`、Payload 含 `"sub": "1234567890"`、「已过期」可见；非法串 → `DT_JWT_INVALID` + [重试] 可见    | 待执行 |
| 4   | UUID 批量 + 时间戳 ID    | [生成] → 5 行均匹配 v4 形态；时间戳 ID 匹配 `^\d{8}-\d{6}-[0-9a-z]{4}$`                                                            | 待执行 |
| 5   | 端口查询 + 非法端口      | 留空查询 → `table tbody tr` ≥1；输入 70000 → 可见 `DT_INVALID_PORT`                                                               | 待执行 |
| 6   | 静态服务器启停           | 预置 root/port → [启动] → 「服务运行中」+ `http://127.0.0.1:<port>/`；真实 HTTP 取 `/` 与 `/assets/a.txt` 均 200；[停止] 回空态   | 待执行 |
| 7   | 静态服务器根目录非法     | root 指向不存在目录 → [启动] → 可见 `DT_ROOT_INVALID` + [重试]；无「服务运行中」                                                  | 待执行 |

### 1.2 单测（144 用例，全部通过，本包覆盖率四项 ≥80%）

| 文件                      | 用例数 | 覆盖要点                                                                                     |
| ------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `netstat.test.ts`         | 13     | TCP 五列/UDP 四列、IPv6 方括号、TIME_WAIT 过滤、CSV 进程名、排序/过滤/截断                   |
| `curl.test.ts`            | 27     | 分词（续行/单双引号/`$'…'`）、全部支持参数、不支持的参数、三种代码生成                       |
| `jwt.test.ts`             | 19     | Base64URL `-`/`_`/填充/非法字符/非 UTF-8、分段数、非对象 JSON、Bearer 前缀、空签名、exp 边界 |
| `uuid.test.ts`            | 11     | v4 版本位/变体位、200 次无重复、crypto 缺失回退、批量上限与越界、时间戳 ID 格式              |
| `mime.test.ts`            | 4      | 常见类型、大小写、未知扩展名回退                                                             |
| `path-guard.test.ts`      | 8      | 根目录等值、合法子路径、`../` 与编码穿越、NUL、非法百分号编码                                |
| `server.test.ts`          | 15     | 目录列表/index.html、404/403/405、HEAD、中文与空格路径、8 MB、5 并发、端口占用、访问日志     |
| `node.test.ts`            | 23     | 七通道正常/异常映射、自身 PID、tasklist 失败降级、5000 行截断、配置记忆                      |
| `schema.test.ts`          | 10     | 七通道入参边界                                                                               |
| `errors.test.ts`          | 9      | 文案（含 `DT_JWT_INVALID`）、detail 缺省、可重试判定、shared 委托                            |
| `renderer/client.test.ts` | 5      | 七通道名与入参透传                                                                           |

## 2. R2 八类异常逐条

| 类别             | 场景与验证                                                                                                                                                                                                                                           | 结果        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1. 中文/空格路径 | 实测（`server.test.ts`）：根目录 `site dir`（含空格）+ 文件 `中文 文件.txt`，请求 `%E4%B8%AD%E6%96%87%20...` → 200 且内容一致；`path-guard.test.ts` 覆盖中文目录解码。e2e 临时目录名保持 ASCII（规避本机 Node fs 非 ASCII 目录崩溃），文件名保留中文 | 通过        |
| 2. 文件被占用    | 不可实测（无法稳定制造 Windows 独占锁）。映射：`serveFile` 先 `open` 再写响应头，`EACCES/EPERM/EBUSY` → 403、其余 → 500，不会出现「已发 200 再断流」；端口/CURL 不读文件                                                                             | 映射        |
| 3. 加密文件      | 不适用：工具不解析文件内容。静态服务器按二进制流返回，`Content-Type` 仅按扩展名推断，是否可解密由浏览器/调用方决定；端口与 CURL 不接触文件                                                                                                           | 不适用      |
| 4. 超大文件      | 实测（`server.test.ts`）：8 MB 文件 → 200、响应体长度 8,388,608、访问日志 `bytes` 精确。实现为 `FileHandle.createReadStream` + `pipeline` 流式，内存不随文件大小线性增长                                                                             | 通过        |
| 5. 任务取消      | 不适用：本工具无长任务、无 task 通道，全部为快速 invoke。静态服务器由「停止」立即 `closeAllConnections` 并释放端口（`server.test.ts` 覆盖 stop→再次 start）                                                                                          | 不适用/映射 |
| 6. 并发溢出      | 实测（`server.test.ts`）：5 个并发请求（含 404）全部返回且逐条记录。端口查询并发时并行执行 `netstat`/`tasklist`（无队列、结果幂等），UI 侧查询中禁用按钮；无自建队列则不涉及并发上限                                                                 | 通过        |
| 7. 磁盘满        | 不适用：本工具不写盘（静态服务器只读）。唯一写入是壳 `settings` 配置记忆（electron-store），renderer 写入失败被静默忽略，不影响启停                                                                                                                  | 不适用/映射 |
| 8. 断电恢复      | 不可实测（断电/强杀）。映射：服务状态不落盘，进程退出即释放端口；重启后 `server-status` 返回未运行 → 空态；仅 root/port 由壳持久化用于表单回显，无中间产物                                                                                           | 映射        |

### 2.1 M45 两页签（JWT 解码 / UUID 生成）补充说明

两页签均为纯 renderer 同步计算，不读文件、不写盘、不发网络请求，八类异常中仅两类需要说明：

- **中文/空格路径**：不适用（不接触路径）。JWT payload 内的中文以 UTF-8 严格解码，`jwt.test.ts` 覆盖中文往返。
- **超大文件（超长 token）**：解码耗时与 token 长度线性且无内存放大；非法超长串在分段校验即报 `DT_JWT_INVALID`，不会卡死 UI（`jwt.test.ts` 覆盖非法字符/非 UTF-8 快速失败）。
- 其余六类（文件被占用、加密文件、任务取消、并发溢出、磁盘满、断电恢复）：不适用——无文件 I/O、无长任务、无状态持久化。

## 3. 不可实测项说明

- **e2e 未在本分支执行**：应用单实例锁，主会话统一串行执行 `dev-toolbox-smoke.spec.ts` 后回填 §1.1。
- **真实独占锁/断电**：无法在自动化中稳定复现，按上表映射结论交付；手工复现建议：用另一进程以独占方式打开被服务文件后请求 → 期望 403；任务管理器强制结束应用后重启 → 期望空态且端口未被占用。
- **netstat 兼容性**：解析只依赖行首 `TCP/UDP` 与列位置（不依赖表头语言），已覆盖 zh-CN/en-US 表头、IPv6 方括号、TCP 五行（含状态）与 UDP 四行（无状态）；未知状态行（TIME_WAIT 等）被过滤。若未来 Windows 改变列布局，会表现为行被跳过而非崩溃。

## 4. 包体积（R5）

| 项                            | raw      | gzip     | 结论                |
| ----------------------------- | -------- | -------- | ------------------- |
| 工具 chunk `dev-toolbox-*.js` | 68,738 B | 15,630 B | gzip < 200 KB，达标 |

> 口径：`dev-toolbox` 页 chunk 为工具代码增量（M42 三页签 46,220 B raw → M45 五页签 68,738 B raw，+22.5 KB）；Naive UI 组件（Alert/Tabs/Spin/Popconfirm/Tag/Button/Input/InputNumber/Radio）与 `@lucide/vue` 图标（含 `Copy`/`RefreshCw`/`KeyRound`）均落共享 vendor chunk，不计入增量。主进程 `server.ts` 走 `out/main/index.js`，不属 R5 renderer 口径。

## 5. 验收命令记录（2026-11-21，含 M45 复测）

| 命令                                                                             | 结果                                                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm --filter @lumin/tool-dev-toolbox typecheck`                                | 通过                                                                  |
| `pnpm exec vitest run packages/tools/dev-toolbox`                                | 144/144 通过                                                          |
| `pnpm exec vitest run packages/tools/dev-toolbox --coverage`（限定本包 include） | Statements 93.34% · Branches 83.15% · Functions 92.85% · Lines 94.93% |
| `pnpm --filter @lumin/desktop typecheck`                                         | 通过                                                                  |
| `pnpm --filter @lumin/desktop build`                                             | 通过（chunk 68,738 B raw / 15,630 B gzip）                            |
