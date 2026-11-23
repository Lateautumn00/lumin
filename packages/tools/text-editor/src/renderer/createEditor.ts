/**
 * @file CodeMirror 6 动态加载与编辑器句柄封装
 * @author cuilanchao
 * @date 2026-11-22
 * @description 全部 @codemirror/* 走动态 import（工具 chunk 懒加载，R5）。
 *              R5 取舍：为守住「工具 chunk + 独占依赖 <200KB gzip」，不引入语言包与
 *              one-dark 主题（二者会额外带入 @lezer/* 与 @codemirror/language），
 *              编辑器按纯文本呈现；扩展名映射保留在 formats.languageForPath 备用。
 */
import type { Extension } from '@codemirror/state'

/** 光标位置（1 基行/列） */
export interface CursorPosition {
  line: number
  column: number
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
}

/** 创建编辑器参数 */
export interface CreateEditorOptions extends EditorCallbacks {
  container: HTMLElement
  content: string
}

/**
 * 动态加载 CodeMirror 并创建编辑器实例
 * @param options 容器、初始内容、语言与回调
 */
export async function createEditor(options: CreateEditorOptions): Promise<EditorHandle> {
  const [stateMod, viewMod, commandsMod, searchMod] = await Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/commands'),
    import('@codemirror/search')
  ])

  let suppressChanges = false

  const extensions: Extension[] = [
    viewMod.lineNumbers(),
    viewMod.highlightActiveLine(),
    commandsMod.history(),
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
    }
  }
}
