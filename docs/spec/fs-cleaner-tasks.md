# fs-cleaner 任务单（M41）

> 规范源：`AGENTS.md`；功能清单：`docs/spec/fs-cleaner.md`。分支 `feature/m41-fs-cleaner`（自 `b38d70a` 切出）。
> 执行原则：零新增第三方依赖；不改动已定架构；每步可验证。

---

## T1 包骨架与契约

**新建**

- `packages/tools/fs-cleaner/package.json`：`@lumin/tool-fs-cleaner`，exports `manifest|node|schema|errors|tree|renderer/*`，deps 仅 `@lucide/vue / @lumin/node-kit / @lumin/plugin-api / @lumin/shared / @lumin/ui / naive-ui / vue / zod`（与 duplicate-finder 同版本）。
- `packages/tools/fs-cleaner/tsconfig.json`：复制 duplicate-finder 同名文件。
- `src/manifest.ts`：`defineManifest({ id:'fs-cleaner', name:'文件清理', icon:'folder-cog', category:'file', order:66, version:'0.1.0' })`。
- `src/schema.ts`：第 6 节全部常量 + zod schema + 推导类型。
- `src/errors.ts`：`FS_CLEANER_ERROR_CODES`、`toolError`、`isRetryable`、`errorMessage`（复用 `@lumin/shared` 的 `errnoCode`/`isStructuredError`）。
- `src/renderer/client.ts`：`config/setConfig`（sync）与 `tree/emptyDirs/touch/tempClean`（task）封装。

**验收**：`pnpm --filter @lumin/tool-fs-cleaner typecheck` 通过。

---

## T2 纯函数层 `src/tree.ts`

导出（全部纯函数，无 fs）：

| 函数 | 行为 |
| --- | --- |
| `parsePatterns(input: string): string[]` | 按换行/逗号/分号切分，trim、去空、去重（保持顺序）、小写 |
| `isExcluded(name: string, patterns: string[]): boolean` | 精确匹配或 `*` 通配（`*` 转正则，大小写不敏感） |
| `parseExtensions(input: string): string[]` | 同上切分，去前导 `.`、小写、去重 |
| `matchesExtensions(fileName: string, extensions: string[]): boolean` | 取最后一个 `.` 后后缀比较；无扩展名不匹配；空规则集返回 false |
| `parseDateTime(text: string): number \| null` | 接受 `YYYY-MM-DD HH:mm` / `YYYY-MM-DDTHH:mm`，非法返回 `null` |
| `formatDateTime(ms: number): string` | `YYYY-MM-DD HH:mm` |
| `renderTree(nodes: TreeNode[], options: { maxDepth: number }): TreeText` | 生成 Box-drawing 文本 + `dirs/files/truncated` 统计 |
| `findEmptyDirs(root: string, entries: DirEntry[]): string[]` | 自底向上判定（子目录全空则父目录也空），返回按深度降序 |

`TreeNode = { name: string; kind: 'dir'|'file'; size?: number; children: TreeNode[] }`（已按目录优先 + 名称 `localeCompare` 排序后传入）。

**单测** `src/tree.test.ts`：`parsePatterns`(4) / `isExcluded`(6) / `parseExtensions`(4) / `matchesExtensions`(5) / `parseDateTime`+`formatDateTime`(5) / `renderTree`(6) / `findEmptyDirs`(5)，共 ≥35 例，覆盖 ≥80%。

**验收**：`pnpm exec vitest run packages/tools/fs-cleaner` 全绿。

---

## T3 主进程 `src/node.ts`

- `export interface FsCleanerDeps { readdir; stat; utimes; }` + `createDefaultDeps()`。
- `export function registerWith(ctx: MainPluginContext, deps: FsCleanerDeps): void`
  - `config` / `set-config`（settings 键 `lastRoot/treeDepth/treeExclude/tempExtensions`，非法存量归一默认）。
  - `tree`（task）：迭代栈遍历到 `maxDepth`，排除规则剪枝，目录优先排序，`renderTree` 出文本；计数超 `MAX_SCAN_FILES` → `FC_TOO_MANY_FILES`；每 200 条 emit progress；`signal.aborted` 即 break。
  - `empty-dirs`（task）：全递归收集 `DirEntry[]`（记录每个目录的直接子项），`findEmptyDirs` 判定，`emit` 扫描进度。
  - `touch`（task）：`recursive` + `extensions` 过滤 → `stat` 收集；`dryRun` 只回统计；否则逐条 `deps.utimes(path, mtime, mtime)`，失败入 `failures`（code `FC_TOUCH_FAILED` + errno），完成数计 `updated`。
  - `temp-clean`（task）：按扩展名匹配普通文件，回列表与合计字节。
  - 全部 task 入参 `parseOrThrow`（`FC_INVALID_PAYLOAD`）；根目录 `readdir` 失败 → `FC_ROOT_INVALID`。
- `export const registerMain: RegisterMain = (ctx) => registerWith(ctx, createDefaultDeps())`。

**单测** `src/node.test.ts`：用假 `MainPluginContext`（捕获 handler）+ 假 deps（内存 fs）覆盖：config 归一、tree 深度/排除/超限、empty-dirs 深层序、touch dryRun 与应用、temp-clean 匹配、`FC_ROOT_INVALID`。

---

## T4 渲染层

文件：

- `src/renderer/ToolView.vue`：标题 + 四页签（`NTabs`），页签内组件懒挂载；顶部说明「删除操作均移入回收站」。
- `src/renderer/TreePanel.vue`（D3）
- `src/renderer/EmptyDirsPanel.vue`（D4）
- `src/renderer/TouchPanel.vue`（D5，含创建时间不支持常驻说明）
- `src/renderer/TempCleanPanel.vue`（D6）
- 回收统一走 `window.lumin.trashPaths`，渲染层 `chunkPaths(list, 200)` 分批（实现于 `src/tree.ts` 导出 `chunkPaths`，纯函数 + 单测）。

每页签必须：空态引导、加载态进度 + 取消、报错态错误码中文 + 重试/详情（复用 `@lumin/ui/TaskProgress.vue`、`toStructuredError`、`formatBytes`、`formatTime`、`fileNameOf`）。

**壳接线（4 处，1 行/处）**

1. `apps/desktop/package.json` deps 加 `"@lumin/tool-fs-cleaner": "workspace:*"`。
2. `apps/desktop/src/tool-manifests.ts`：import + 数组追加 `fsCleanerManifest`。
3. `apps/desktop/src/main/tool-mains.ts`：import + `'fs-cleaner': fsCleanerRegisterMain`。
4. `apps/desktop/src/renderer/src/tools/fs-cleaner.vue`：薄页面（同 duplicate-finder.vue）。
5. `apps/desktop/src/renderer/src/layout/AppSidebar.vue`：`FolderCog` import + `'folder-cog': FolderCog`。

---

## T5 e2e

`apps/desktop/e2e/fs-cleaner-smoke.spec.ts`（真实 Electron，临时目录 fixture）：

1. 侧栏可见「文件清理」，可进入页面，四页签均在。
2. 目录树：写入 `a/b/c.txt` 后生成，断言文本含 `c.txt` 与 `└──`。
3. 空文件夹：`empty/one/two` 全空，扫描后列表含 3 条。
4. 批量改时间：预演显示命中 N；应用后提示「已更新」。
5. 临时清理：`.log` 命中、`.txt` 不命中。
6. 报错态：不存在目录 → 显示 `FC_ROOT_INVALID` 中文文案且 [重试] 可见。

**验收**：`pnpm --filter @lumin/desktop exec playwright test e2e/fs-cleaner-smoke.spec.ts` 全绿。

---

## T6 文档与登记

- `docs/smoke/fs-cleaner.md`：R2 八类（中文/空格路径、占用、加密、超大、取消、并发溢出、磁盘满、断电恢复）逐条记录 + chunk gzip 实测。
- `docs/opencode/plan.md`：§1 决策表追加 `Q41`（M41 范围与「创建时间不支持」决策）、§4.41 实现说明、§6 里程碑表追加 M41 行。
- `AGENTS.md` §1 无需改（零新增依赖）；如最终有依赖变化则同步。
- `README.md` / `README.en.md` 工具表追加「文件清理」。
- `CHANGELOG.md` 追加 M41 条目。

---

## T7 门禁

顺序执行并留存输出：

1. `pnpm coverage`（工具包纯函数 ≥80%、全仓 ≥60%）
2. `pnpm --filter @lumin/desktop build`（记录 `fs-cleaner` chunk raw/gzip，写入 smoke 文档）
3. `pnpm exec vitest run packages/tools/fs-cleaner`
4. `pnpm --filter @lumin/desktop exec playwright test e2e/fs-cleaner-smoke.spec.ts`
5. `pnpm gate`（lint → typecheck → test → audit → dependency-cruiser）全绿

---

## T8 提交（不推送）

`feat(fs-cleaner)` 包实现与壳接线 → `test(fs-cleaner)` 单测与 e2e → `docs(m41)` spec/smoke/plan/README/CHANGELOG。

---

## 进度

- [x] T1 包骨架与契约
- [x] T2 纯函数层 `src/tree.ts`
- [x] T3 主进程 `src/node.ts`
- [x] T4 渲染层与壳接线
- [x] T5 e2e
- [x] T6 文档与登记
- [x] T7 门禁（coverage / build / vitest / playwright / gate 全绿）
- [x] T8 提交（分支 `feature/m41-fs-cleaner`，未推送）
