/**
 * @file CodeMirror 6 动态加载与编辑器句柄封装（跨工具共享）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 由 text-editor 与 markdown-tool 复用；全部 @codemirror/* 走动态 import（工具 chunk 懒加载，R5）。
 *              M67：可选 Markdown 语法高亮（lang-markdown + defaultHighlightStyle，按需加载，纯文本为缺省）。
 */
import type { Extension } from '@codemirror/state'

/** 语法高亮语言（缺省纯文本） */
export type EditorLanguage = 'markdown'

/** 光标位置（1 基行/列） */
export interface CursorPosition {
  line: number
  column: number
}

/** 选区（0 基字符偏移） */
export interface EditorSelection {
  from: number
  to: number
}

/** 编辑器回调 */
export interface EditorCallbacks {
  /** 文档变化（用户输入；程序化 setContent 不触发） */
  onChange?: (length: number) => void
  /** 光标位置变化 */
  onCursor?: (position: CursorPosition) => void
}

/** 编辑器句柄 */
export interface EditorHandle {
  setContent(text: string): void
  getContent(): string
  focus(): void
  destroy(): void
  /** 打开查找/替换面板（工具栏「查找」与 Ctrl+F 同一命令） */
  openSearch(): void
  /** 读取当前选区（0 基字符偏移，未选中时 from === to） */
  getSelection(): EditorSelection
  /** 替换指定区间并可选重置选区（工具栏格式化命令） */
  replaceRange(from: number, to: number, insert: string, selection?: EditorSelection): void
  /** 撤销 */
  undo(): void
  /** 重做 */
  redo(): void
}

/** 创建编辑器参数 */
export interface CreateEditorOptions extends EditorCallbacks {
  container: HTMLElement
  content: string
  /** 语法高亮语言（缺省纯文本；Markdown 高亮按需动态加载） */
  language?: EditorLanguage
}

/**
 * 动态加载 CodeMirror 并创建编辑器实例
 * @param options 容器、初始内容、语言与回调
 */
export async function createEditor(options: CreateEditorOptions): Promise<EditorHandle> {
  const highlight = options.language === 'markdown'
  const [stateMod, viewMod, commandsMod, searchMod, markdownMod, languageMod] = await Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/commands'),
    import('@codemirror/search'),
    highlight ? import('@codemirror/lang-markdown') : Promise.resolve(null),
    highlight ? import('@codemirror/language') : Promise.resolve(null)
  ])

  let suppressChanges = false

  const languageExtensions: Extension[] =
    markdownMod !== null && languageMod !== null
      ? [markdownMod.markdown(), languageMod.syntaxHighlighting(languageMod.defaultHighlightStyle)]
      : []

  const extensions: Extension[] = [
    viewMod.lineNumbers(),
    viewMod.highlightActiveLine(),
    commandsMod.history(),
    ...languageExtensions,
    viewMod.keymap.of([
      ...commandsMod.defaultKeymap,
      ...commandsMod.historyKeymap,
      ...searchMod.searchKeymap
    ]),
    searchMod.search({ top: true }),
    viewMod.EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto' }
    }),
    viewMod.EditorView.updateListener.of((update) => {
      const doc = update.state.doc
      if (update.docChanged) {
        if (suppressChanges) return
        options.onChange?.(doc.length)
        const head = update.state.selection.main.head
        const line = doc.lineAt(head)
        options.onCursor?.({ line: line.number, column: head - line.from + 1 })
        return
      }
      if (update.selectionSet) {
        const head = update.state.selection.main.head
        const line = doc.lineAt(head)
        options.onCursor?.({ line: line.number, column: head - line.from + 1 })
      }
    })
  ]

  const state = stateMod.EditorState.create({ doc: options.content, extensions })
  const view = new viewMod.EditorView({ state, parent: options.container })

  return {
    setContent(text: string): void {
      suppressChanges = true
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text }
        })
      } finally {
        suppressChanges = false
      }
    },
    getContent(): string {
      return view.state.doc.toString()
    },
    focus(): void {
      view.focus()
    },
    destroy(): void {
      view.destroy()
    },
    openSearch(): void {
      searchMod.openSearchPanel(view)
      view.focus()
    },
    getSelection(): EditorSelection {
      const range = view.state.selection.main
      return { from: range.from, to: range.to }
    },
    replaceRange(from: number, to: number, insert: string, selection?: EditorSelection): void {
      view.dispatch({
        changes: { from, to, insert },
        ...(selection === undefined
          ? {}
          : { selection: { anchor: selection.from, head: selection.to } })
      })
      view.focus()
    },
    undo(): void {
      commandsMod.undo(view)
    },
    redo(): void {
      commandsMod.redo(view)
    }
  }
}
