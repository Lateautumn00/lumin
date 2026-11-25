/**
 * @file 共享 CodeMirror 编辑器封装单测（mock 动态模块，不触真实 DOM）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖初始化、setContent/getContent、focus/destroy/openSearch、
 *              选区读写/区间替换（工具栏格式化）与撤销重做。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CursorPosition, EditorHandle } from './create-editor'

interface FakeDoc {
  length: number
  toString(): string
  lineAt(pos: number): { number: number; from: number }
}

interface FakeState {
  doc: FakeDoc
  selection: { main: { from: number; to: number; head: number } }
}

interface FakeUpdate {
  docChanged: boolean
  selectionSet: boolean
  state: FakeState
}

interface FakeChanges {
  from?: number
  to?: number
  insert?: string
}

interface FakeTransaction {
  changes?: FakeChanges
  selection?: { anchor: number; head: number }
}

interface FakeView {
  state: FakeState
  focused: boolean
  destroyed: boolean
  dispatch(transaction: FakeTransaction): void
  focus(): void
  destroy(): void
}

/** 跨 mock 工厂共享的探针 */
const probe = {
  listener: null as ((update: FakeUpdate) => void) | null,
  view: null as FakeView | null,
  transactions: [] as FakeTransaction[],
  undo: vi.fn(),
  redo: vi.fn(),
  openSearchPanel: vi.fn(),
  extensions: [] as unknown[]
}

function makeDoc(text: string): FakeDoc {
  return {
    length: text.length,
    toString: () => text,
    lineAt: () => ({ number: 1, from: 0 })
  }
}

function makeState(text: string, head = 0): FakeState {
  return { doc: makeDoc(text), selection: { main: { from: head, to: head, head } } }
}

/** 注册 CodeMirror 假模块（真实 DOM/编辑器不参与单测） */
function mockCodeMirror(): void {
  vi.doMock('@codemirror/state', () => ({
    EditorState: {
      create: ({ doc, extensions }: { doc: string; extensions?: unknown[] }) => {
        probe.extensions = extensions ?? []
        return makeState(doc)
      }
    }
  }))
  vi.doMock('@codemirror/view', () => {
    class FakeEditorView implements FakeView {
      static theme = (): Record<string, never> => ({})
      static updateListener = {
        of: (callback: (update: FakeUpdate) => void): Record<string, never> => {
          probe.listener = callback
          return {}
        }
      }

      state: FakeState
      focused = false
      destroyed = false

      constructor(options: { state: FakeState }) {
        this.state = options.state
        probe.view = this
      }

      dispatch(transaction: FakeTransaction): void {
        probe.transactions.push(transaction)
        const changes = transaction.changes
        if (changes !== undefined) {
          const text = this.state.doc.toString()
          const from = changes.from ?? 0
          const to = changes.to ?? text.length
          const next = `${text.slice(0, from)}${changes.insert ?? ''}${text.slice(to)}`
          this.state = {
            doc: makeDoc(next),
            selection: { main: { from, to: from, head: from } }
          }
        }
        if (transaction.selection !== undefined) {
          const { anchor, head } = transaction.selection
          this.state = {
            doc: this.state.doc,
            selection: {
              main: { from: Math.min(anchor, head), to: Math.max(anchor, head), head }
            }
          }
        }
      }

      focus(): void {
        this.focused = true
      }

      destroy(): void {
        this.destroyed = true
      }
    }
    return {
      EditorView: FakeEditorView,
      keymap: { of: () => ({}) },
      lineNumbers: () => ({}),
      highlightActiveLine: () => ({})
    }
  })
  vi.doMock('@codemirror/commands', () => ({
    defaultKeymap: [],
    historyKeymap: [],
    history: () => ({}),
    undo: probe.undo,
    redo: probe.redo
  }))
  vi.doMock('@codemirror/search', () => ({
    searchKeymap: [],
    search: () => ({}),
    openSearchPanel: probe.openSearchPanel
  }))
  vi.doMock('@codemirror/lang-markdown', () => ({
    markdown: () => ({ extension: 'markdown' })
  }))
  vi.doMock('@codemirror/language', () => ({
    defaultHighlightStyle: { style: 'default' },
    syntaxHighlighting: () => ({ extension: 'highlight' })
  }))
}

async function loadCreateEditor(): Promise<typeof import('./create-editor').createEditor> {
  const module = await import('./create-editor')
  return module.createEditor
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  probe.listener = null
  probe.view = null
  probe.transactions = []
  probe.extensions = []
})

describe('createEditor', () => {
  it('创建编辑器并支持 setContent/getContent/focus/destroy/openSearch', async () => {
    mockCodeMirror()
    const createEditor = await loadCreateEditor()
    const handle: EditorHandle = await createEditor({
      container: {} as HTMLElement,
      content: 'abc'
    })
    expect(handle.getContent()).toBe('abc')

    handle.setContent('xyz')
    expect(handle.getContent()).toBe('xyz')

    handle.focus()
    expect(probe.view?.focused).toBe(true)

    handle.openSearch()
    expect(probe.openSearchPanel).toHaveBeenCalledTimes(1)
    expect(probe.view?.focused).toBe(true)

    handle.destroy()
    expect(probe.view?.destroyed).toBe(true)
  })

  it('文档变化回调长度与光标位置，纯光标变化也回调', async () => {
    mockCodeMirror()
    const createEditor = await loadCreateEditor()
    const onChange = vi.fn<(length: number) => void>()
    const onCursor = vi.fn<(position: CursorPosition) => void>()
    await createEditor({
      container: {} as HTMLElement,
      content: '',
      onChange,
      onCursor
    })
    const listener = probe.listener
    expect(listener).not.toBeNull()

    listener?.({ docChanged: true, selectionSet: false, state: makeState('abcd', 3) })
    expect(onChange).toHaveBeenCalledWith(4)
    expect(onCursor).toHaveBeenCalledWith({ line: 1, column: 4 })

    listener?.({ docChanged: false, selectionSet: true, state: makeState('abcd', 1) })
    expect(onCursor).toHaveBeenCalledTimes(2)
  })

  it('未提供回调时不抛错', async () => {
    mockCodeMirror()
    const createEditor = await loadCreateEditor()
    const noCallback = await createEditor({
      container: {} as HTMLElement,
      content: 'x'
    })
    probe.listener?.({ docChanged: true, selectionSet: false, state: makeState('x') })

    expect(noCallback.getContent()).toBe('x')
    expect(probe.openSearchPanel).not.toHaveBeenCalled()
  })

  it('language=markdown 时挂载语法高亮扩展', async () => {
    mockCodeMirror()
    const createEditor = await loadCreateEditor()
    await createEditor({
      container: {} as HTMLElement,
      content: '# 标题',
      language: 'markdown'
    })
    expect(probe.extensions).toContainEqual({ extension: 'markdown' })
    expect(probe.extensions).toContainEqual({ extension: 'highlight' })
  })

  it('未指定 language 时不加载语言包', async () => {
    mockCodeMirror()
    const createEditor = await loadCreateEditor()
    await createEditor({ container: {} as HTMLElement, content: 'plain' })
    expect(probe.extensions).not.toContainEqual({ extension: 'markdown' })
  })

  it('getSelection/replaceRange 按偏移读写并重置选区', async () => {
    mockCodeMirror()
    const createEditor = await loadCreateEditor()
    const handle = await createEditor({ container: {} as HTMLElement, content: 'hello' })
    expect(handle.getSelection()).toEqual({ from: 0, to: 0 })

    handle.replaceRange(0, 5, '**hello**', { from: 2, to: 7 })
    expect(handle.getContent()).toBe('**hello**')
    expect(handle.getSelection()).toEqual({ from: 2, to: 7 })
    expect(probe.view?.focused).toBe(true)

    // 不传选区时保留原选区，仅替换文本
    handle.replaceRange(2, 7, 'world')
    expect(handle.getContent()).toBe('**world**')
  })

  it('undo/redo 转发到 commands 模块', async () => {
    mockCodeMirror()
    const createEditor = await loadCreateEditor()
    const handle = await createEditor({ container: {} as HTMLElement, content: 'abc' })

    handle.undo()
    expect(probe.undo).toHaveBeenCalledTimes(1)
    handle.redo()
    expect(probe.redo).toHaveBeenCalledTimes(1)
  })
})
