# M3a Spike 记录（试卷切割 · PDF 操作）

> 日期：2026-11-14 · 分支：`feature/m0-skeleton` · 环境：Windows · Node 24.13.0 · electron-vite 6.0.0 · vite 8.3.8（rolldown/oxc）
> 结论先行：**四项未知全部破题**；R5 已按实测数据完成修订（见 §1，AGENTS §8 + plan R5 双同步）。

## 1. Chunk 实测（R5 口径，gzip level 9）

方法：临时工程 + 同版本 vite 8.3.8 真实压缩构建（与 electron-vite renderer 同管线）。

| 组件                                 | 去向                | raw        | gzip                           |
| ------------------------------------ | ------------------- | ---------- | ------------------------------ |
| pdfjs 主库（`pdfjs-dist` 现代构建）  | renderer 工具 chunk | 443.8 KB   | **133.6 KB**                   |
| exam-split 工具代码（估）            | renderer 工具 chunk | ~40 KB     | **~15 KB**                     |
| **renderer 增量小计**                | —                   | —          | **≈150 KB**（< 200KB 基线 ✅） |
| pdfjs worker（`pdf.worker.min.mjs`） | renderer 运行时资产 | 1,271.9 KB | **379.2 KB**（R5 资产单列）    |
| pdf-lib 1.17.1                       | **主进程 worker**   | 503.6 KB   | 184.1 KB（不属 R5 口径）       |

**决策（2026-11-14，用户批准）**：运行时资产（pdfjs worker/wasm/OCR 模型等按需随包文件）不计入 chunk 增量，`docs/smoke/<tool>.md` 单列记录。原「PDF 类例外 ≤300KB」预授权**未启用**（纯代码增量本来就达标）。已落：AGENTS §8 运行时资产口径段 + plan 附录 B R5 行。

- pdfjs 现代构建可用（Electron 45 Chromium 远超 baseline target）；无需 legacy。
- 备选数据：`pdf.min.mjs` 预构建 136.7KB gzip（与自压缩 133.6KB 相差无几，走 vite 打包即可）。

## 2. node worker 打包（`runTask()` 基础）

**结论：用 electron-vite 官方 `?modulePath` 后缀，全链路实测通过。**

```ts
import workerPath from './pdf.worker.ts?modulePath'
const worker = new Worker(workerPath, {}) // node:worker_threads
```

scratch 工程实测（electron-vite 6.0.0，`package.json` 无 `type: module` = 与 apps/desktop 真实条件一致）：

- main 输出 CJS（`require`），worker chunk 同为 CJS；路径在运行时解析为 `join(__dirname, './chunks/xxx.js')` 绝对路径 ✅
- worker 内 node 内建（`node:worker_threads`/`node:os`）、静态/动态 import、**函数内 async/await** 均正常 ✅
- `node out/main/index.js` 实跑：spawn → progress×2 → done → terminate ✅

**踩坑记录（勿再试）**：

1. `new Worker(new URL('./x.worker.ts', import.meta.url))` 在 main 构建**不被转换**（vite:worker 插件只认 `?worker` 查询语法的 client 环境……仅 `?worker&url` 触发，但返回 web 根路径 `/chunks/...`，node 下解析成 `C:\chunks` 找不到）。
2. `?worker&url` 默认 `worker.format: 'iife'`：TLA 报错、node 内建被 browser-external 化——**弃用**。
3. **worker 源码禁顶层 await**（CJS 输出格式限制，`INVALID_TLA_FORMAT` 编译期报错）；静态 import + `fn().then()`/函数内 await 完全够用。
4. TS 侧 `?modulePath` 需要工具包内自备环境声明（`declare module '*?modulePath'`），vite/client 类型在工具包不可解析。

## 3. pdfjs renderer worker 打包

```ts
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
```

vite client 构建实测：asset 正常产出（`assets/pdf.worker.min-<hash>.mjs`）；CSP 无阻（PROD `script-src 'self' file:` 兜底 worker-src 回退）。
**残余风险**：生产 `file://` 下 module worker 可用性——M0 起 index.html 即为 file:// 下的 module script（长期正常），worker 同机制；**P4 e2e 真实预览断言兜底**，若失败备选 `loadURL` 自定义协议或 classic worker。

## 4. 加密 PDF 错误形态

fixture 配方（真加密样例，43,686 B）：

```
soffice --headless --convert-to 'pdf:writer_pdf_Export:{"EncryptFile":{"type":"boolean","value":"true"},"DocumentOpenPassword":{"type":"string","value":"pw123"}}' …
```

- PowerShell 传参会吃内层双引号 → 参数字符串内须 `\"` 转义（或 cmd /c）；未转义时过滤器静默失效（产物大小与未加密一致 = 假象信号）。
- **pdf-lib**：普通 `Error`，message 含 `is encrypted`（且自带 `ignoreEncryption` 提示）→ 消息嗅探映射 `PDF_ENCRYPTED`；`ignoreEncryption: true` 可读元数据（本工具不启用）。
- **pdfjs**：`PasswordException` `code=1`（未给密码）/ `code=2`（密码错）→ renderer 预览报错态复用 `PDF_ENCRYPTED` 文案。
- pdfjs 销毁 API 是 `loadingTask.destroy()`（非 `doc.destroy()`）——M2 已踩过，沿用。

## 5. 对 P2–P4 的设计输入（已纳入方案）

1. `node-kit runTask({ workerPath, payload, signal, onProgress, timeoutMs })` + worker 侧 `exposeTask(fn)` 帮助函数；协议 `progress|done|error|cancel`；abort = `worker.terminate()`（硬终止，同 docx2pdf kill 语义）。
2. worker 单测不走 `?modulePath`（electron-vite 专属语法 vitest 不认）：runTask 协议用 **plain-JS fixture worker** 测；业务算子（pdf-lib 五操作）抽成纯模块 `pdf-ops.ts` 直接测（100 页 <2s 断言在集成测试进程内测）；**真 TS worker + ?modulePath 由 e2e 兜底**。
3. 输出冲突递增 `(1)..(99)` 逻辑 docx2pdf 与 exam-split 两处复用 → **按 AGENTS 铁律 3 上提 `node-kit`**，docx2pdf 重构为调用方（行为与测试不变）。
4. renderer 预览读文件用 `File.arrayBuffer()`（File 对象直读，无需 IPC）；主进程操作走路径 payload。
