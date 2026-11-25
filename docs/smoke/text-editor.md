# text-editor（文本编辑器）冒烟记录

> 工具：`text-editor`（M56，2026-11-22）· 规格：`docs/spec/text-editor.md`
> 自动化：`apps/desktop/e2e/text-editor-smoke.spec.ts`（真实 Electron + 真实主进程）
> 手工复现环境：Windows x64 · Electron · 本地离线
> 结论：**通过**（自动化 9/9 全绿；R2 中磁盘满、断电恢复、Windows 独占占用等无法稳定自动化的场景见 §2 标注「待手工复核」）。

## 1. 自动化结果

命令：`pnpm --filter @lumin/desktop test:e2e -- text-editor-smoke`（前置 `pnpm --filter @lumin/desktop build`）
结果：**9 passed**（约 19.6s）

| #   | 用例                                                    | 断言                                                                                            | 结果 |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---- |
| 1   | UI：打开文件 → 编辑 → 侧栏切换触发未保存确认 → 放弃更改 | `input[type=file]` 载入、`.cm-content` 可见、NModal「有未保存的更改」、放弃后路由切换且磁盘未变 | 通过 |
| 2   | IPC：UTF-8 + LF 打开，保存为 CRLF                       | 磁盘字节为 `a\r\nb`，重开 `eol=crlf`、内容一致                                                  | 通过 |
| 3   | IPC：GBK 打开后按原编码保存                             | 编码判定 `gbk`，保存后字节完全一致                                                              | 通过 |
| 4   | IPC：只读文件（chmod 0444）保存                         | 返回 `TE_SAVE_FAILED`                                                                           | 通过 |
| 5   | IPC：超过 5MiB 打开                                     | 返回 `TE_TOO_LARGE`，`detail` 为字节数                                                          | 通过 |
| 6   | IPC：mtime 冲突                                         | 先 `TE_FILE_CHANGED`，`force` 后覆盖成功                                                        | 通过 |
| 7   | IPC：save-as 已存在 / 新文件                            | `TE_FILE_EXISTS`；新文件按 EOL 正确写入                                                         | 通过 |
| 8   | IPC：二进制 / 缺失 / 目录 / 非法 name                   | 分别 `TE_DECODE_FAILED` / `TE_NOT_FOUND` / `TE_INVALID_PATH` / `TE_INVALID_PATH`                | 通过 |
| 9   | IPC：中文/空格路径 + UTF-8 BOM 往返                     | 编码 `utf8-bom`、`eol=crlf`、保存后 BOM 与正文一致                                              | 通过 |

## 2. R2 八类异常逐条

| 类别             | 场景与验证                                                                                                                                | 结果                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1. 中文/空格路径 | e2e #1/#9 使用 `说明 文档.txt`、`中文 目录/说明 文档.txt` 打开与保存                                                                      | 通过（自动化）                                       |
| 2. 文件被占用    | 单测注入 `EBUSY`/`EPERM` 断言 `TE_LOCKED`；e2e #4 只读文件保存 → `TE_SAVE_FAILED`。Windows 下真实独占锁（另一进程长期持有句柄）需人工构造 | 部分覆盖，真实独占场景待手工复核                     |
| 3. 加密/损坏文件 | NUL 字节二进制伪装 `.txt` → `TE_DECODE_FAILED`（单测 + e2e #8）；加密 PDF/Office 等非文本文件同一路径处理                                 | 通过（自动化）                                       |
| 4. 超大文件      | >5MiB → `TE_TOO_LARGE`，`detail` 为实际字节数（单测 + e2e #5）                                                                            | 通过（自动化）                                       |
| 5. 任务取消      | 三个通道均为同步 IPC，无长任务与取消入口                                                                                                  | 不适用                                               |
| 6. 并发溢出      | 保存前比对 `expectedMtimeMs`，冲突 → `TE_FILE_CHANGED`，`force` 才覆盖；`writeAtomic` 以临时文件 + rename 提交，不会出现半截文件          | 通过（mtime 冲突自动化；多实例高频写入建议手工复核） |
| 7. 磁盘满        | 单测注入 `EACCES`/`ENOSPC`/无 errno 异常 → `TE_SAVE_FAILED`，原文件未被破坏。真实磁盘写满无法在 CI 稳定构造                               | 代码路径已覆盖，真实磁盘满待手工复核                 |
| 8. 断电恢复      | 写入走 `writeAtomic`（临时文件 + 原子 rename），中途中断不会破坏原文件；真实断电无法自动化                                                | 依赖 writeAtomic 保证，待手工复核                    |

## 3. 单测 / 覆盖率 / chunk

### 3.1 单测

`pnpm exec vitest run packages/tools/text-editor`：**69 passed / 8 files**（formats、errors、schema、encoding、manifest、renderer/client、renderer/createEditor、node）。

### 3.2 覆盖率（`pnpm coverage`，v8）

- `packages/tools/text-editor/src/**/*.ts` 阈值四项 80%，实测：**语句 97.38%（186/191） / 分支 93.81%（91/97） / 函数 97.5%（39/40） / 行 97.67%（168/172）**，达标。
- 全仓阈值 60%，实测语句 94.01% / 分支 86.92% / 函数 92.37% / 行 95.72%，退出码 0（2753 passed / 263 files）。

### 3.3 chunk 体积（R5）

构建产物 `apps/desktop/out/renderer/assets/`，工具 chunk + 其独占 CodeMirror chunk（M67 起 CodeMirror 封装上提 `packages/ui/create-editor`，与 markdown-tool 共享）：

| 文件                                          | raw (B)     | gzip (B)    |
| --------------------------------------------- | ----------- | ----------- |
| `text-editor-C-XvnTge.js`                     | 27,578      | 7,187       |
| `dist-ChOqyWHd.js`（@codemirror/view）        | 377,367     | 99,976      |
| `dist-B1D0oc76.js`（@codemirror/state）       | 121,707     | 32,923      |
| `dist-B16xA5iq.js`（@codemirror/commands 等） | 177,274     | 44,312      |
| `dist-_5SobO52.js`（@codemirror/search）      | 41,325      | 10,996      |
| **合计**                                      | **745,251** | **195,394** |

结论：**195,394 B gzip < 200KB**，达标（CodeMirror 相关 chunk 自 M67 起与 markdown-tool 共享，仍按单工具预算计）。

**R5 取舍说明**：初版引入 `@codemirror/lang-javascript`、`lang-json`、`lang-markdown` 与 `theme-one-dark`，合计 gzip 约 315KB 超限。按规格的降级顺序依次移除 JavaScript/Markdown/JSON 语言包与 one-dark 主题后达标，因此**首版为纯文本编辑器（行号、撤销/重做、查找、高亮当前行）**，无语法高亮与深色编辑器主题；`formats.languageForPath` 保留备用，后续若拿到 chunk 预算再接入。

## 4. 门禁结论

| 命令                                                         | 结果                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                  | 通过（text-editor 与壳改动文件无告警）                                                          |
| `pnpm typecheck`                                             | `@lumin/tool-text-editor`、`@lumin/desktop` 通过                                                |
| `pnpm test`                                                  | 通过（含本工具 69 例）                                                                          |
| `pnpm coverage`                                              | 退出码 0，全仓与包阈值均达标                                                                    |
| `pnpm audit:high`                                            | 无 high/critical（2 moderate），退出码 0                                                        |
| `pnpm boundary`                                              | 863 modules，无违规                                                                             |
| `pnpm --filter @lumin/desktop build`                         | 通过                                                                                            |
| `pnpm --filter @lumin/desktop test:e2e -- text-editor-smoke` | 9 passed                                                                                        |
| `pnpm gate`                                                  | 通过（lint → typecheck → test → audit → boundary 全绿；此前记录的 docx2pdf 测试类型问题已修复） |

## 5. 待手工复核清单

1. Windows 下真实文件独占占用（另一进程持有写句柄）保存 → 预期 `TE_LOCKED`/`TE_SAVE_FAILED`。
2. 真实磁盘写满（或配额限制）保存 → 预期 `TE_SAVE_FAILED`，原文件内容不变。
3. 保存过程中强制结束进程后重启 → 原文件完整，无残留临时文件（依赖 `writeAtomic`）。
