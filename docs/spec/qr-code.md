# 二维码工具（qr-code）字段级功能清单

> 里程碑：M16（拟登记 plan §1 Q20 / §4.16 / §6）
> 状态：待用户批准后实施
> 关联规范：`AGENTS.md` §2（零耦合）、§5（三态/tokens/图标）、§6（IPC）、§7（测试门禁）、§8（性能）

---

## 1. 目标与边界

### 1.1 目标

新增独立工具包 `qr-code`（名称「二维码工具」），提供**离线二维码生成**与**本地图片二维码识别**两项能力，全程无网络请求。

### 1.2 做

| 能力     | 说明                                                                  |
| -------- | --------------------------------------------------------------------- |
| 生成     | 内容类型：文本 / 网址 / WiFi / 名片（vCard 3.0）                      |
| 样式     | 纠错级别 L/M/Q/H、尺寸 128–2048px、边距 0–10、前景/背景色             |
| 预览     | 实时预览（PNG 渲染，300ms 防抖）                                      |
| 保存     | PNG（base64 写盘）/ SVG（文本写盘），文件名可编辑，重名自动 `(n)`     |
| 识别     | 选择/拖拽图片 → 浏览器内 canvas 取像素 → `jsqr` 解码 → 文本展示与复制 |
| 目录记忆 | 输出目录存 settings `outputDir`，缺省 `userData/qrcodes`              |

### 1.3 不做（防范围膨胀）

- 批量识别 / 批量生成（一次一张 / 一份内容）
- 摄像头扫码、屏幕取色、图片美化、Logo 嵌入
- 二维码内容历史记录、云同步、短链
- 复杂内容类型（地理位置、日历事件、邮件拼接等）

### 1.4 与既有工具边界

- `image-toolbox` 做图片转码压缩，不做二维码；本工具不 import 任何 `tools/*`。
- 图片解码在 renderer 内完成（`File` → `createImageBitmap` → canvas），主进程只负责保存，因此**不新增三段式长任务**。
- 公共能力复用：`@lumin/ui/DropZone.vue`、`@lumin/node-kit` 的 `resolveConflictPath`、`@lumin/shared` 的结构化错误与 `makeError`。

---

## 2. 工具清单（manifest）

| 字段        | 值                                                |
| ----------- | ------------------------------------------------- |
| id          | `qr-code`                                         |
| name        | `二维码工具`                                      |
| description | `二维码生成与图片识别（PNG/SVG 导出）`            |
| icon        | `qr-code`（壳 `AppSidebar` iconMap 注册 `QrCode`，已确认 `@lucide/vue@1.72.0` 导出、order 80 |
| version     | `0.1.0`                                           |

settings 命名空间：`tools.qr-code.outputDir`（经 `ctx.settings`，键名 `outputDir`）。

---

## 3. 界面规格（单页两 Tab）

页面标题「二维码工具」，副标题「离线生成二维码，或从图片中识别内容」。`NTabs` 两个页签：`生成` / `识别`。

### 3.1 生成 Tab

**内容类型** `NRadioGroup`：文本 / 网址 / WiFi / 名片。切换类型保留公共样式参数，内容字段独立。

| 类型   | 字段                                                                    | 校验                                                  |
| ------ | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| 文本   | `内容` `NInput` textarea（≤2000 字符）                                  | 去首尾空白后非空                                      |
| 网址   | `网址` `NInput`                                                         | 去空白后匹配 `^https?://\S+$`，≤2048 字符             |
| WiFi   | `SSID`（必填 ≤64）· `密码`（≤64）· `加密方式` WPA/WEP/无密码 · `隐藏网络` | 非「无密码」时密码必填                                |
| 名片   | `姓名`（必填 ≤100）· `公司` ≤100 · `职位` ≤100 · `电话` ≤50 · `邮箱` ≤254 · `网址` ≤2048 · `地址` ≤200 | 邮箱须含 `@`；网址须 `^https?://\S+$`（留空允许） |

**样式参数（所有类型共用）**：

| 控件         | 默认值     | 范围/选项              |
| ------------ | ---------- | ---------------------- |
| 纠错级别     | `M`        | L / M / Q / H          |
| 尺寸（px）   | `512`      | 128–2048 整数          |
| 边距（模块） | `4`        | 0–10 整数              |
| 前景色       | `#000000`  | `#RRGGBB`              |
| 背景色       | `#ffffff`  | `#RRGGBB`              |
| 导出格式     | `PNG`      | PNG / SVG              |
| 文件名       | `qrcode`   | 1–80 字符，主进程再做非法字符清洗 |

**预览与操作**：

- 预览区：内容合法时展示 PNG 预览（生成失败显示行内错误文案）；内容非法时展示空态提示，不请求保存。
- 主按钮：`保存到文件`（合法且预览成功才可点）；保存中禁用。
- 保存成功：`NMessage` 提示 + 展示产物路径 + `打开所在文件夹`（`window.lumin.revealPath`）。
- 输出目录：右侧展示当前目录 + `选择目录` 按钮（`window.lumin.pickDirectory`），选中后即时 `set-output-dir`。

### 3.2 识别 Tab

- 空态：`DropZone`（accept `.png,.jpg,.jpeg,.webp,.bmp,.gif`，单选）+ 引导文案「拖拽或选择一张包含二维码的图片」。
- 解码中：loading 文案「识别中…」（解码在本机毫秒级完成，无取消按钮）。
- 成功：只读 textarea 展示内容 + `复制` 按钮 + 图片文件名/像素尺寸。
- 失败：结构化错误（`QR_IMAGE_TOO_LARGE` / `QR_IMAGE_UNREADABLE` / `QR_DECODE_FAILED`）+ 可展开 `detail` + `重试`（对同一文件重新解码）。

### 3.3 三态强制（AGENTS §5.3）

| 状态   | 生成 Tab                          | 识别 Tab                          |
| ------ | --------------------------------- | --------------------------------- |
| 空态   | 预览占位 + 「输入内容后自动预览」 | DropZone 引导 + 主操作            |
| 加载态 | 保存按钮 loading                  | 「识别中…」loading                |
| 报错态 | 错误码 + 中文文案 + 详情          | 错误码 + 中文文案 + 重试/详情     |

---

## 4. 通道与数据流

### 4.1 IPC（全部同步 `registerIpc`，无长任务）

| 通道                     | 入参                                               | 返回               |
| ------------------------ | -------------------------------------------------- | ------------------ |
| `qr-code:config`         | `{}`                                               | `{ outputDir }`    |
| `qr-code:set-output-dir` | `{ outputDir }`                                    | `void`             |
| `qr-code:save`           | `{ outputDir, baseName, format, data }`            | `{ output }`       |

`save.data`：`format=png` 为 base64（可容忍 `data:image/png;base64,` 前缀，≤8MB 原文）；`format=svg` 为 SVG 文本（须以 `<svg` 或 `<?xml` 开头，≤2MB）。

### 4.2 数据流

```
生成：renderer（qrcode 库）→ PNG dataURL / SVG 文本 → invoke qr-code:save → 主进程原子写盘
识别：DropZone(File) → createImageBitmap → canvas.getImageData → jsQR → 文本
```

- 生成与解码均在 renderer；主进程只做目录记忆与写盘，**不新增 task/worker**。
- 解码失败重试：renderer 保留 `File` 引用重新走同一管线。

---

## 5. 数据契约（`src/schema.ts`）

```ts
MAX_TEXT_CHARS = 2000
MAX_URL_CHARS = 2048
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_PNG_BASE64_CHARS = 8 * 1024 * 1024
MAX_SVG_CHARS = 2 * 1024 * 1024
MIN_SIZE = 128
MAX_SIZE = 2048
MIN_MARGIN = 0
MAX_MARGIN = 10
COLOR_RE = /^#[0-9a-fA-F]{6}$/
URL_RE = /^https?:\/\/\S+$/i

qrFormatSchema = 'png' | 'svg'
errorCorrectionSchema = 'L' | 'M' | 'Q' | 'H'

wifiInputSchema  = { ssid: string(1..64), password: string(0..64), encryption: 'WPA'|'WEP'|'nopass', hidden: boolean }
vCardInputSchema = { name: string(1..100), org?, title?, phone?, email?, url?, address? } // 均可选 ≤ 上限
qrContentSchema  = discriminatedUnion('type', [
  { type:'text', value: string(1..2000) },
  { type:'url', value: string(1..2048) },
  { type:'wifi', wifi: wifiInputSchema },
  { type:'vcard', vcard: vCardInputSchema }
])

configResultSchema   = { outputDir: string }
setOutputDirPayloadSchema = { outputDir: string(1..1024) }
savePayloadSchema = {
  outputDir: string(1..1024),
  baseName: string(1..80),
  format: qrFormatSchema,
  data: string(1..8MB)
}
saveResultSchema = { output: string(1..1024) }
```

---

## 6. 纯函数与算法

### 6.1 `src/payload.ts`

| 函数                                  | 行为                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `escapeWifiValue(value)`              | 对 `\ ; , : "` 前加反斜杠（ZXing WiFi 规范）                                           |
| `buildWifiPayload(input)`             | `WIFI:T:<WPA|WEP|nopass>;S:<ssid>;P:<pwd>;H:<true|false>;;`（nopass 时省略 `P:`）       |
| `escapeVCardValue(value)`             | `\` → `\\`，换行 → `\n`，`,` → `\,`，`;` → `\;`                                       |
| `buildVCardPayload(input)`            | `BEGIN:VCARD / VERSION:3.0 / N / FN / ORG? / TITLE? / TEL;TYPE=CELL? / EMAIL? / URL? / ADR:;;addr? / END:VCARD`（`\r\n` 连接，空字段省略） |
| `isValidUrl(value)`                   | 去空白后匹配 `URL_RE`                                                                  |
| `buildQrContent(input: QrContent)`    | 按 `type` 分派：text 去首尾空白；url 校验；wifi/vcard 组装                               |

校验失败抛 `toolError('QR_INVALID_CONTENT' | 'QR_CONTENT_TOO_LONG', 字段名)`（主进程仍以 zod 兜底，不依赖 renderer 校验）。

### 6.2 `src/renderer/generate.ts`

| 函数                        | 行为                                                                 |
| --------------------------- | -------------------------------------------------------------------- |
| `createQrOptions(style)`    | `{ errorCorrectionLevel, width, margin, color:{dark,light} }`，越界钳制 |
| `toPngDataUrl(text, style)` | `QRCode.toDataURL(text, options)`（浏览器构建，canvas 渲染）         |
| `toSvg(text, style)`        | `QRCode.toString(text, { ...options, type: 'svg' })`                 |
| `dataUrlToBase64(dataUrl)`  | 取 `,` 之后片段；无逗号返回原串（纯函数，单测）                      |

### 6.3 `src/renderer/decode.ts`

| 函数                                  | 行为                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- |
| `decodeRgba(rgba, width, height)`     | `jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' })`；无码返回 `null`，有码返回 `{ text }` |
| `decodeImageFile(file)`               | `size > MAX_IMAGE_BYTES` → `QR_IMAGE_TOO_LARGE`；`createImageBitmap` 失败 → `QR_IMAGE_UNREADABLE`；canvas 取 ImageData → `decodeRgba`；无码 → `QR_DECODE_FAILED`；返回 `{ text, width, height }` |

### 6.4 `src/save.ts`

| 函数                              | 行为                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `sanitizeBaseName(raw)`           | 替换 `[\\/:*?"<>|]` 与换行 → `_`，去首尾空格与末尾点，空则 `qrcode`，长度截断 80             |
| `normalizePngBase64(data)`        | 剥 `data:image/png;base64,` 前缀；非法 base64 字符 → `QR_INVALID_PAYLOAD`                     |
| `writeAtomic(target, data, fs?)`  | 写 `target.tmp-<pid>-<n>` → `renameSync`；任一步失败 → 尽力 `unlink` 临时文件并抛原始错误      |

### 6.5 `src/node.ts`

`registerWith(ctx, deps?)`：

- `config`：读 settings `outputDir`，缺省 `join(ctx.paths.userData, 'qrcodes')`。
- `set-output-dir`：zod 校验后写 settings。
- `save`：zod 校验 → `sanitizeBaseName` → `mkdirSync(outputDir, {recursive:true})` → `resolveConflictPath(join(outputDir, `${base}.${format}`))` → `writeAtomic` → 回写 settings.outputDir → 返回 `{ output }`。
  - 目录创建/写盘错误 → `QR_OUTPUT_WRITE_FAILED`，`errnoCode(err)` 入 `detail`。
- 导出 `registerMain: RegisterMain = (ctx) => registerWith(ctx)`。

---

## 7. 错误码（`src/errors.ts`）

| 码                        | 文案                                       | 可重试 |
| ------------------------- | ------------------------------------------ | ------ |
| `QR_INVALID_CONTENT`      | 内容为空或格式不正确                       | 否     |
| `QR_CONTENT_TOO_LONG`     | 内容超出长度上限                           | 否     |
| `QR_INVALID_PAYLOAD`      | 参数无效                                   | 否     |
| `QR_OUTPUT_WRITE_FAILED`  | 输出目录不可写或磁盘空间不足               | 是     |
| `QR_IMAGE_TOO_LARGE`      | 图片超过 20MB，请压缩后重试                | 否     |
| `QR_IMAGE_UNREADABLE`     | 图片无法读取，可能已损坏或格式不支持       | 否     |
| `QR_DECODE_FAILED`        | 未识别到二维码，请换更清晰、完整的图片     | 否     |
| `QR_NO_IMAGE`             | 请先选择一张包含二维码的图片               | 否     |

`INVALID_PAYLOAD`（core）由 zod 失败时使用；本工具错误码与 core 码在 renderer 均映射为「码 + 中文文案」。

---

## 8. 文件清单（全部新增/修改）

### 8.1 新包 `packages/tools/qr-code`

```
package.json            # @lumin/tool-qr-code；exports: manifest/node/schema/errors/payload/save/renderer/*
tsconfig.json           # 同 image-toolbox
src/manifest.ts
src/schema.ts
src/errors.ts
src/payload.ts
src/save.ts
src/node.ts
src/manifest.test.ts
src/schema.test.ts
src/payload.test.ts
src/save.test.ts
src/node.test.ts
src/renderer/client.ts
src/renderer/generate.ts
src/renderer/decode.ts
src/renderer/generate.test.ts
src/renderer/decode.test.ts
src/renderer/ToolView.vue
```

依赖：`qrcode@1.5.4`、`jsqr@1.4.0`、`@types/qrcode@1.5.6`（dev）、工作区包与版本基线同 `pdf-toolkit`。

### 8.2 壳注册（5 处）

| 文件                                               | 改动                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/desktop/package.json`                        | devDependencies 加 `@lumin/tool-qr-code": "workspace:*"`          |
| `apps/desktop/electron.vite.config.ts`             | manifest/node/renderer 三条别名                                  |
| `apps/desktop/src/tool-manifests.ts`               | import + 数组（pdf-toolkit 之后、example 之前）                  |
| `apps/desktop/src/main/tool-mains.ts`              | import + `'qr-code'` 记录                                        |
| `apps/desktop/src/renderer/src/tools/qr-code.vue`  | 薄包装（仅 import ToolView）                                     |
| `apps/desktop/src/renderer/src/layout/AppSidebar.vue` | import `QrCode` + iconMap `'qr-code': QrCode`                |

路由由 `import.meta.glob('../tools/*.vue')` 自动发现，无需改 router。

### 8.3 根配置与文档

| 文件                            | 改动                                                     |
| ------------------------------- | -------------------------------------------------------- |
| `vitest.config.ts`              | 新增 `packages/tools/qr-code/src/**/*.ts` 四项 80 阈值   |
| `apps/desktop/e2e/qr-code-smoke.spec.ts` | e2e 用例（见 §9）                                |
| `apps/desktop/package.json`     | devDependencies 加 `qrcode@1.5.4` + `@types/qrcode@1.5.6`（仅 e2e 生成样图） |
| `docs/spec/qr-code.md`          | 本文件                                                   |
| `docs/spec/qr-code-tasks.md`    | 任务清单                                                 |
| `docs/smoke/qr-code.md`         | R2 八类异常记录 + 覆盖率 + chunk 实测                    |
| `docs/opencode/plan.md`         | §1 决策表加 Q20；新增 §4.16；§6 里程碑表加 M16           |
| `CHANGELOG.md`                  | Unreleased 增加 qr-code 条目                             |
| `README.md` / `README.en.md`    | 工具列表加一行                                           |

---

## 9. 质量门禁与验收

### 9.1 单元测试（覆盖率 ≥80%，`src/**/*.ts`）

- `payload`：WiFi 四类加密/转义（含 `;,:` 与反斜杠）、vCard 转义与空字段省略、URL 判定、空内容与超长。
- `save`：文件名清洗（非法字符/空白/末尾点/超长）、PNG base64 前缀剥离与非法字符、`writeAtomic` 成功与 rename 失败后临时文件清理。
- `schema`：各 payload 合法/非法边界（尺寸 128/2048、边距 0/10、颜色大小写、format 枚举）。
- `generate`：`createQrOptions` 钳制、`dataUrlToBase64`、`toSvg` 含 `<svg`、`toPngDataUrl` 前缀。
- `decode`：用 `QRCode.create` 生成矩阵 → 扩为 RGBA（quiet zone 4、放大 8×）→ `decodeRgba` 还原文本；空白图返回 `null`。
- `node`：假 ctx + 临时目录，覆盖 config 缺省/回填、set-output-dir、save 成功/重名 `(1)`/目录创建失败/写盘失败（注入 fs 假件）。

### 9.2 e2e（`apps/desktop/e2e/qr-code-smoke.spec.ts`，真实 Electron）

1. **页面加载 + 空态 + 两 Tab + 保存（R2.1）**：侧边栏进入「二维码工具」；空态文案可见；输入文本后预览出现；点「保存到文件」→ 产物存在且为 PNG；中文+空格目录/文件名正确。
2. **识别闭环（R2.1）**：`qrcode` 在测试进程生成 `https://example.com/你好 世界` 的 PNG → `setInputFiles` 注入 DropZone → 识别文本一致；再注入随机字节 `.png` → `QR_IMAGE_UNREADABLE`；注入空白 PNG → `QR_DECODE_FAILED`。
3. **边界与参数**：空内容 → 按钮禁用；尺寸 127/2049 无法输入（NInputNumber 钳制）；非法颜色 → 行内提示；SVG 保存成功且内容含 `<svg`。
4. **输出目录记忆**：`set-output-dir` 后重启页面 `config` 回填一致；重名保存 → `(1)`、`(2)`。
5. **源目录不可写（R2.7）**：`icacls deny (WD,AD)` → 保存归 `QR_OUTPUT_WRITE_FAILED`，ACL 复原。
6. **大图（R2.4）**：生成 21MB 占位 `.png`（零填充）注入 → `QR_IMAGE_TOO_LARGE`。

### 9.3 R2 八类异常（`docs/smoke/qr-code.md` 逐条记录）

1. 中文/空格路径（e2e 1/2）· 2. 文件被占用（不读源文件；目标冲突走 `(n)`，ACL 只读归 `QR_OUTPUT_WRITE_FAILED` 等价覆盖）· 3. 加密/损坏图片（随机字节 → `QR_IMAGE_UNREADABLE`）· 4. 超大文件（21MB → `QR_IMAGE_TOO_LARGE`）· 5. 任务取消（无三段式长任务，N/A + 理由）· 6. 并发（`save` 同步、毫秒级；并发 5 次各自 `(n)` 成功）· 7. 磁盘满（ACL deny 等价覆盖）· 8. 断电恢复（临时文件 + 原子 rename，单测断言失败清理）。

### 9.4 性能与体量（R5）

- 工具 chunk（qrcode + jsqr + 工具代码）gzip 目标 < 200KB，构建后实测并写入 smoke。
- 识别单张 ≤1s（离线、无需上传）；生成预览防抖 300ms。

### 9.5 门禁命令

`pnpm lint` → `pnpm typecheck` → `pnpm coverage` → `pnpm gate`；e2e 需先 `pnpm -F @lumin/desktop build`。

---

## 10. 风险与决策

| 风险/决策            | 结论                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| 生成放 renderer      | 是：预览必须实时；主进程保存时再校验长度与格式，防越权 payload                          |
| 识别不放主进程       | 是：File API + canvas 足够，避免新增原生依赖（`@napi-rs/canvas` 属壳，不下沉到工具）     |
| 识别图片体积上限     | 20MB（解码需整图入内存；超限给明确文案，不崩溃）                                        |
| 二维码库体积         | `qrcode` 浏览器构建按需打包；构建后核对 chunk，超 200KB 则改用 `qrcode-generator` 并重走 R8 |
| 文件名安全           | 主进程清洗非法字符 + 冲突重命名，禁止路径穿越（不拼接用户路径片段）                     |
| 剪贴板               | 优先 `navigator.clipboard`，不可用时 `textarea + execCommand('copy')` 兜底，仍失败提示手动复制 |
