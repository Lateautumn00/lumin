# 文本编辑器（text-editor）· M56 规格

> 状态：**已实施（I2，2026-11-22）**（plan §4.56 / Q57）
> 目标：打开/编辑/保存任意文本文件，CodeMirror 6 动态加载，支持编码/EOL 识别与原子保存。

## 1. 清单与分类

- id `text-editor` · name「文本编辑器」· category `text` · icon `pencil-line` · 主进程：有
- 复用：`DropZone`、`@lumin/shared/text-file.ts`、`@lumin/node-kit` 的 `writeAtomic`。

## 2. 字段级功能清单

| 区域   | 按钮/控件                                      | 输入项               | 行为                                                 |
| ------ | ---------------------------------------------- | -------------------- | ---------------------------------------------------- |
| 空态   | 打开文件 / 新建空白                            | 文件路径             | —                                                    |
| 工具栏 | 保存 / 另存为 / 只读开关 / 编码选择 / EOL 选择 | —                    | 脏标记「●」                                          |
| 编辑器 | 撤销 / 重做 / 查找 / 替换                      | 正文、查找词、替换词 | CodeMirror 6，行号（首版纯文本，语法高亮因 R5 降级） |
| 状态栏 | —                                              | —                    | 行/列/字符数、编码、EOL                              |
| 离开   | 保存 / 放弃 / 取消                             | —                    | 路由 + beforeunload + 对话框                         |
| 错误态 | 重试 / 另存为                                  | —                    | 错误码中文                                           |

## 3. IPC

| action    | 类型 | 入参 → 出参                                                             |
| --------- | ---- | ----------------------------------------------------------------------- |
| `open`    | sync | `{path}` → `{path,name,size,mtimeMs,content,encoding,eol,readOnly}` |
| `save`    | sync | `{path,content,encoding,eol,expectedMtimeMs?,force?}` → `{mtimeMs}` |
| `save-as` | sync | `{dir,name,content,encoding,eol}` → `{path,mtimeMs}`                |

## 4. 约束

- 打开上限 **5MiB**（超限 `TE_TOO_LARGE`）。
- 保存用 `writeAtomic`（临时文件 + rename）；`expectedMtimeMs` 不匹配且未 `force` → `TE_FILE_CHANGED`。
- 编码：UTF-8 / UTF-8 BOM / UTF-16LE / GBK；GBK 编解码走 `iconv-lite`（仅主进程）。EOL：LF / CRLF。
- CodeMirror 动态 import；首版为纯文本（R5 chunk 门槛取舍，`languageForPath` 保留备用，实测见 smoke §3）。
- 未保存离开三重拦截：路由守卫 + `beforeunload` + Naive 对话框。

## 5. 错误码

`TE_NOT_FOUND / TE_LOCKED / TE_TOO_LARGE / TE_DECODE_FAILED / TE_SAVE_FAILED / TE_FILE_CHANGED / TE_FILE_EXISTS / TE_INVALID_PATH`

## 6. 三态

- 空态：DropZone + 新建空白。
- 加载态：读取文件/加载编辑器。
- 错误态：错误码 + 中文 + 重试/另存为。

## 7. 验收

- 纯函数单测 ≥80%（formats/schema/errors/client/encoding 适配）。
- e2e `text-editor-smoke.spec.ts`：UTF-8/CRLF、GBK、编辑保存校验磁盘字节、只读、脏离开、超限。
- CodeMirror 动态 chunk <200KB gzip（实测记 smoke）；R2 八类见 `docs/smoke/text-editor.md`。
