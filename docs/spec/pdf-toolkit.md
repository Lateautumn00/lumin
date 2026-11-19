# PDF 工具集（pdf-toolkit）字段级功能清单

> 里程碑：M15 v1.4（R8 登记：plan §1 Q19 / §4.15 / §6）
> 状态：待用户批准后实施
> 关联规范：`AGENTS.md` §2（零耦合）、§5（三态/tokens/图标）、§6（IPC/任务）、§7（测试门禁）、§8（性能）

---

## 1. 目标与边界

### 1.1 目标

新增独立工具包 `pdf-toolkit`（名称「PDF 工具集」），提供**通用 PDF 页面整理**能力：合并、拆分、删页、旋转、重排、元数据编辑。全部操作为本地离线处理，产物写在源文件同目录。

### 1.2 做

| 能力   | 说明                                           |
| ------ | ---------------------------------------------- |
| 合并   | 2–100 个 PDF 按列表顺序合并为一个              |
| 拆分   | 页码范围 `1-3,5` 每段产出一个 PDF              |
| 删页   | 删除指定页，至少保留 1 页                      |
| 旋转   | 指定页或全部页顺时针 +90/+180/+270             |
| 重排   | 按用户给定的页面顺序（1..N 全排列）重写页序    |
| 元数据 | 查看并改写 Title / Author / Subject / Keywords |

### 1.3 不做（防范围膨胀）

- PDF 加密/解密、权限处理（加密输入直接报错）
- PDF→图片、图片→PDF（`pdf-images` 范围）
- 裁剪、OCR 切题（`exam-split` 范围）
- 页面内容编辑、表单、签名、水印
- 批量队列并发（单任务内串行处理单个文档）
- 输出目录记忆（产物固定写源文件同目录）

### 1.4 与既有工具的边界说明

`exam-split` 面向试卷场景（含 OCR、裁剪），本工具为通用 PDF 页面整理；两者不互相 import，各自依赖 `pdf-lib`。可复用的纯函数（页范围解析、基名、冲突重命名）统一取自 `@lumin/shared` 与 `@lumin/node-kit`。

---

## 2. 工具清单（manifest）

| 字段        | 值                                              |
| ----------- | ----------------------------------------------- |
| id          | `pdf-toolkit`                                   |
| name        | `PDF 工具集`                                    |
| description | `PDF 合并、拆分、删页、旋转、重排与元数据编辑`  |
| icon        | `files`（壳 `AppSidebar` iconMap 注册 `Files`） |
| order       | `75`（介于 pdf-images 70 与 example 90 之间）   |
| version     | `0.1.0`                                         |

settings 命名空间：无（本工具不写 settings）。

---

## 3. 界面规格（单页六 Tab）

页面标题「PDF 工具集」；`NTabs` 六个页签：`合并` / `拆分` / `删页` / `旋转` / `重排` / `元数据`。

通用元素：

- 文件选择：复用 `@lumin/ui/DropZone.vue`（accept `.pdf`）；合并 Tab 支持多选与排序（上移/下移/移除）。
- 提交按钮：`开始<操作名>`；运行中禁用并显示 `取消`。
- 进度：复用 `@lumin/ui/TaskProgress.vue`，值为 `current/total` 与 `message`。
- 结果：产物列表 + 「打开所在文件夹」按钮（`window.lumin.revealPath`）。
- 错误：结构化错误码 + 中文文案；`isRetryable` 为真时显示「重试」，并可展开 `detail`。
- 三态强制：
  - 空态：DropZone 引导文案 + 主操作，禁止白屏；
  - 加载态：进度可见 + 可取消；
  - 报错态：错误码 → 中文文案 + 重试/详情。

各 Tab 输入项：

| Tab    | 输入                                                                | 校验                                   |
| ------ | ------------------------------------------------------------------- | -------------------------------------- |
| 合并   | PDF 列表（2–100）                                                   | 至少 2 个；大小写不敏感去重；有序      |
| 拆分   | 单个 PDF + 页码范围                                                 | 非空；语法 `1-3,5`；区间不重叠、不越界 |
| 删页   | 单个 PDF + 页码                                                     | 非空；不得删光全部页                   |
| 旋转   | 单个 PDF + 角度（90/180/270）+ 页码（留空 = 全部）                  | 角度枚举；页码语法同拆分               |
| 重排   | 单个 PDF + 页序（拖拽/上移下移，默认 1..N）                         | 必须是 1..N 的完整全排列               |
| 元数据 | 单个 PDF + Title/Author/Subject/Keywords 四个文本框（载入现值可改） | 单字段 ≤ 500 字符                      |

---

## 4. 通道与任务模型（AGENTS §6）

| 通道                   | 类型 | 入参                              | 返回                                |
| ---------------------- | ---- | --------------------------------- | ----------------------------------- |
| `pdf-toolkit:info`     | 同步 | `{ inputPath }`                   | `{ pageCount, fileName, metadata }` |
| `pdf-toolkit:merge`    | 任务 | `{ inputPaths: string[] }`        | `{ outputPaths: string[] }`         |
| `pdf-toolkit:split`    | 任务 | `{ inputPath, ranges }`           | `{ outputPaths: string[] }`         |
| `pdf-toolkit:delete`   | 任务 | `{ inputPath, ranges }`           | `{ outputPaths: string[] }`         |
| `pdf-toolkit:rotate`   | 任务 | `{ inputPath, ranges?, degrees }` | `{ outputPaths: string[] }`         |
| `pdf-toolkit:reorder`  | 任务 | `{ inputPath, order: number[] }`  | `{ outputPaths: string[] }`         |
| `pdf-toolkit:metadata` | 任务 | `{ inputPath, metadata }`         | `{ outputPaths: string[] }`         |

- 长任务三段式：`invoke` 返回 `{ taskId }` → `progress|log|done|error` → `cancel`；取消由壳统一归 `CANCELLED`。
- worker：`src/pdf.worker.ts`（`?modulePath` + `exposeTask`），超时 `120_000ms`；超时/崩溃映射 `PT_TIMEOUT` / `PT_OP_FAILED`。
- 入参先过 zod，再逐个文件预检（`access(R_OK)` + 读方式打开探测独占）。
- 进度：`load(0) → process(i/total) → write(total) → done(total)`。

---

## 5. 数据契约（`src/schema.ts`）

```ts
PDF_INPUT_RE = /\.pdf$/i
MAX_MERGE_FILES = 100
RANGE_RE = /^[\d\s,-]+$/

infoPayloadSchema   = { inputPath: pdfPath }
mergePayloadSchema  = { inputPaths: pdfPath[2..100] }
splitPayloadSchema  = { inputPath: pdfPath, ranges: string(1..2000, RANGE_RE) }
deletePayloadSchema = { inputPath: pdfPath, ranges: string(1..2000, RANGE_RE) }
rotatePayloadSchema = { inputPath: pdfPath, ranges?: string(≤2000, RANGE_RE), degrees: 90|180|270 }
reorderPayloadSchema= { inputPath: pdfPath, order: int[1..10000] }  // 全排列由 pdf-ops 校验
metadataPayloadSchema = {
  inputPath: pdfPath,
  metadata: {
    title?: string(≤500), author?: string(≤500),
    subject?: string(≤500), keywords?: string(≤500)
  }
}

pdfMetadataSchema = { title, author, subject, keywords, creator, producer } // 均 string，缺省 ''
infoResultSchema  = { pageCount: int≥1, fileName: string, metadata: pdfMetadataSchema }
opResultSchema    = { outputPaths: string[] }
workerProgressSchema = { stage: 'load'|'process'|'write'|'done', current: int, total?: int, message?: string }
```

---

## 6. 处理语义（`src/pdf-ops.ts`）

所有操作：`pdf-lib` 读入源文档 → 生成新文档/修改副本 → 序列化写盘 → 写后校验（size>0 且头 5 字节 `%PDF-`）。

| op       | 语义                                                                | 输出命名                   |
| -------- | ------------------------------------------------------------------- | -------------------------- |
| merge    | 依次复制每个文件全部页                                              | `{首文件基名}_合并.pdf`    |
| split    | `parseRangeGroups` 分组（组内升序、组间不重叠），每组产出一个文件   | `{基名}_p{区间标签}.pdf`   |
| delete   | `parsePageList` 删除指定页；删光 → `PT_NO_PAGES_LEFT`               | `{基名}_删p{标签}.pdf`     |
| rotate   | 目标页 `(当前角度 + degrees) % 360`；空范围 = 全部页                | `{基名}_旋转{degrees}.pdf` |
| reorder  | `order` 必须是 1..N 全排列，否则 `PT_ORDER_INVALID`；按序 copyPages | `{基名}_重排.pdf`          |
| metadata | 设置非空字段；空字符串 = 保持原值；至少一个字段有值（zod refine）   | `{基名}_元数据.pdf`        |

- 冲突重名：`node-kit.resolveConflictPath` 递增 `(n)`，99 次耗尽 → `PT_OUTPUT_WRITE_FAILED`。
- 写盘失败（含 ENOSPC/EACCES）→ `PT_OUTPUT_WRITE_FAILED`，尽力删除半成品。
- 加密判定：`pdf-lib` 抛 message 含 `is encrypted`（与 exam-split 同口径）→ `PT_PDF_ENCRYPTED`。

---

## 7. 错误码（`src/errors.ts`，renderer 文案同源）

| 码                       | 中文文案                               | 可重试 |
| ------------------------ | -------------------------------------- | ------ |
| `PT_INPUT_INVALID`       | 输入文件不存在或不是 PDF               | 否     |
| `PT_PDF_LOCKED`          | PDF 正被其他程序占用，请关闭后重试     | 是     |
| `PT_PDF_ENCRYPTED`       | PDF 已加密，请先解除密码保护           | 否     |
| `PT_PDF_CORRUPT`         | PDF 无法解析，可能已损坏               | 是     |
| `PT_RANGE_INVALID`       | 页码范围不正确，请检查（如 1-3,5）     | 是     |
| `PT_NO_PAGES_LEFT`       | 至少需要保留一页                       | 否     |
| `PT_ORDER_INVALID`       | 页面顺序无效，必须包含全部页码各一次   | 是     |
| `PT_OUTPUT_WRITE_FAILED` | 无法写出结果，请检查目录权限与剩余空间 | 是     |
| `PT_TIMEOUT`             | 处理超时（120 秒），已终止             | 是     |
| `PT_OP_FAILED`           | 处理失败，请重试或查看详情             | 是     |
| `INVALID_PAYLOAD`        | 参数无效（壳级共享码）                 | 否     |

---

## 8. 文件清单（新增/修改）

新增：

```
packages/tools/pdf-toolkit/package.json
packages/tools/pdf-toolkit/tsconfig.json
packages/tools/pdf-toolkit/src/manifest.ts
packages/tools/pdf-toolkit/src/schema.ts            (+ schema.test.ts)
packages/tools/pdf-toolkit/src/errors.ts            (+ errors.test.ts)
packages/tools/pdf-toolkit/src/naming.ts            (+ naming.test.ts)
packages/tools/pdf-toolkit/src/pdf-ops.ts           (+ pdf-ops.test.ts)
packages/tools/pdf-toolkit/src/pdf.worker.ts
packages/tools/pdf-toolkit/src/node.ts              (+ node.test.ts)
packages/tools/pdf-toolkit/src/env.d.ts
packages/tools/pdf-toolkit/src/renderer/client.ts   (+ client.test.ts)
packages/tools/pdf-toolkit/src/renderer/ToolView.vue
apps/desktop/src/renderer/src/tools/pdf-toolkit.vue  (薄包装)
apps/desktop/e2e/pdf-toolkit-smoke.spec.ts
docs/spec/pdf-toolkit.md                             (本文件)
docs/spec/pdf-toolkit-tasks.md
docs/smoke/pdf-toolkit.md
```

修改（壳注册 6 处 + 门禁 + 登记）：

```
apps/desktop/package.json                依赖 @lumin/tool-pdf-toolkit
apps/desktop/electron.vite.config.ts     manifest/node/renderer 三条别名
apps/desktop/src/tool-manifests.ts       清单 1 行
apps/desktop/src/main/tool-mains.ts      toolMains 1 行
apps/desktop/src/renderer/src/layout/AppSidebar.vue  iconMap 增 files: Files
vitest.config.ts                         包覆盖率阈值 80%
docs/opencode/plan.md                    §1 Q19、§4.15、§6 M15 行
CHANGELOG.md / README.md / README.en.md  工具清单登记
```

---

## 9. 测试与验收

1. 单测（包覆盖率 ≥80%）：schema 边界、错误码/可重试、命名、六种 op（真 `pdf-lib` 造样本）、node 通道（假 worker + 预检失败）、client 通道名。
2. e2e `apps/desktop/e2e/pdf-toolkit-smoke.spec.ts`（真实 Electron + 真实 worker，临时目录 ASCII、文件名含中文/空格）：
   - 页面加载 + 六 Tab + 空态；
   - 合并 3 个 PDF → 页数 = 合计；
   - 拆分 `1-2,3` → 2 个产物；越界 → `PT_RANGE_INVALID`；
   - 删页 / 旋转（检查页 Rotation 角度）/ 重排（检查页序通过文本或页对象顺序）；
   - 元数据写入后 `info` 回读校验；
   - 损坏 PDF → `PT_PDF_CORRUPT`；不存在 → `PT_INPUT_INVALID`；占用 → `PT_PDF_LOCKED`（R2.2）；
   - 取消（R2.5）、并发排队（R2.6）、输出目录不可写（R2.7）、强杀恢复（R2.8）。
3. `docs/smoke/pdf-toolkit.md`：R2 八类逐条记录（不可实测项如实标注）。
4. `pnpm coverage`（包 80% / 全仓 60%）、`pnpm gate`（lint/typecheck/test/audit/depcruise）全绿。
5. chunk：工具代码 + 独占依赖 < 200KB gzip（`pdf-lib` 已在 pdf-images 使用，主进程侧不计 renderer chunk；renderer 仅含 UI 与 client，需在 smoke 记录实测 gzip）。

---

## 10. 验收断言（可复现）

- `pnpm exec vitest run --project @lumin/tool-pdf-toolkit` 全绿且覆盖率 ≥80%。
- `pnpm --filter @lumin/desktop exec playwright test e2e/pdf-toolkit-smoke.spec.ts` 全绿。
- `pnpm gate` 退出码 0。
- e2e 断言产物存在且头部为 `%PDF-`、页数/元数据与预期一致。
