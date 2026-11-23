import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CursorPosition, EditorHandle } from './createEditor'

interface FakeDoc {
  length: number
  toString(): string
  lineAt(pos: number): { number: number; from: number }
}

interface FakeState {
  doc: FakeDoc
  selection: { main: { head: number } }
}

interface FakeUpdate {
  docChanged: boolean
  selectionSet: boolean
  state: FakeState
}

interface FakeView {
  state: FakeState
  focused: boolean
  destroyed: boolean
  dispatch(transaction: { changes: { insert: string } }): void
  focus(): void
  destroy(): void
}

/** 跨 mock 工厂共享的探针 */
const probe = {
  listener: null as ((update: FakeUpdate) => void) | null,
  view: null as FakeView | null,
  openSearchPanel: vi.fn()
}

function makeDoc(text: string): FakeDoc {
  return {
    length: text.length,
    toString: () => text,
    lineAt: () => ({ number: 1, from: 0 })
  }
}

function makeState(text: string, head = 0): FakeState {
  return { doc: makeDoc(text), selection: { main: { head } } }
}

/** 注册 CodeMirror 假模块（真实 DOM/编辑器不参与单测） */
function mockCodeMirror(): void {
  vi.doMock('@codemirror/state', () => ({
    EditorState: { create: ({ doc }: { doc: string }) => makeState(doc) }
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

      dispatch(transaction: { changes: { insert: string } }): void {
        this.state = makeState(transaction.changes.insert)
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
    history: () => ({})
  }))
  vi.doMock('@codemirror/search', () => ({
    searchKeymap: [],
    search: () => ({}),
    openSearchPanel: probe.openSearchPanel
  }))
}

async function loadCreateEditor(): Promise<typeof import('./createEditor').createEditor> {
  const module = await import('./createEditor')
  return module.createEditor
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  probe.listener = null
  probe.view = null
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
})
