/**
 * @file mind-elixir 适配层单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 通过 vi.mock 替换 mind-elixir 库与语言包，验证构造参数、bus 事件桥接、
 *              视图/样式命令映射与选中节点快照。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Theme } from 'mind-elixir'
import type { MindmapDocument } from '../contract'
import { createMindElixir, type MindElixirHandle } from './mind-elixir-adapter'

/** 伪实例（与适配层调用面一致） */
interface FakeInstance {
  options: Record<string, unknown>
  bus: {
    listeners: Record<string, Array<(payload?: unknown) => void>>
    addListener(event: string, listener: (payload?: unknown) => void): void
    emit(event: string, payload?: unknown): void
  }
  data: unknown
  currentNode: { nodeObj: Record<string, unknown> } | null
  scaleVal: number
  initCalls: unknown[]
  refreshes: unknown[]
  clearHistoryCalls: number
  directions: string[]
  expandCalls: Array<[unknown, boolean]>
  scaleCalls: number[]
  fitCalls: number
  undoCount: number
  redoCount: number
  reshapes: Array<[unknown, unknown]>
  themes: Array<[unknown, boolean]>
  destroyed: boolean
}

const holder = vi.hoisted(() => ({ instances: [] as unknown[] }))

vi.mock('mind-elixir', () => {
  class FakeMindElixir {
    readonly bus: FakeInstance['bus']
    data: unknown = { nodeData: { id: 'root', topic: '根', children: [] } }
    currentNode: FakeInstance['currentNode'] = null
    scaleVal = 1
    readonly options: Record<string, unknown>
    readonly initCalls: unknown[] = []
    readonly refreshes: unknown[] = []
    clearHistoryCalls = 0
    readonly directions: string[] = []
    readonly expandCalls: Array<[unknown, boolean]> = []
    readonly scaleCalls: number[] = []
    fitCalls = 0
    undoCount = 0
    redoCount = 0
    readonly reshapes: Array<[unknown, unknown]> = []
    readonly themes: Array<[unknown, boolean]> = []
    destroyed = false

    constructor(options: Record<string, unknown>) {
      this.options = options
      const listeners: Record<string, Array<(payload?: unknown) => void>> = {}
      this.bus = {
        listeners,
        addListener: (event, listener) => {
          ;(listeners[event] ??= []).push(listener)
        },
        emit: (event, payload) => {
          for (const listener of listeners[event] ?? []) listener(payload)
        }
      }
      holder.instances.push(this)
    }

    async init(data: unknown): Promise<void> {
      this.initCalls.push(data)
    }

    getData(): unknown {
      return this.data
    }

    findEle(id: string): { id: string } {
      if (id === 'missing') throw new Error('not found')
      return { id }
    }

    refresh(data: unknown): void {
      this.refreshes.push(data)
      this.data = data
    }

    clearHistory(): void {
      this.clearHistoryCalls += 1
    }

    initLeft(): void {
      this.directions.push('left')
    }

    initRight(): void {
      this.directions.push('right')
    }

    initDown(): void {
      this.directions.push('down')
    }

    initSide(): void {
      this.directions.push('side')
    }

    expandNodeAll(element: unknown, expand: boolean): void {
      this.expandCalls.push([element, expand])
    }

    scale(value: number): void {
      this.scaleCalls.push(value)
      this.scaleVal = value
    }

    scaleFit(): void {
      this.fitCalls += 1
    }

    undo(): void {
      this.undoCount += 1
    }

    redo(): void {
      this.redoCount += 1
    }

    async reshapeNode(topic: unknown, patch: unknown): Promise<void> {
      this.reshapes.push([topic, patch])
    }

    changeTheme(theme: unknown, reRender: boolean): void {
      this.themes.push([theme, reRender])
    }

    destroy(): void {
      this.destroyed = true
    }
  }
  return { default: FakeMindElixir }
})

vi.mock('mind-elixir/i18n', () => ({ zh_CN: { name: 'zh' } }))

const DATA: MindmapDocument = { nodeData: { id: 'root', topic: '根', children: [] } }
const THEME = { name: 'lumin', type: 'light', palette: [], cssVar: {} } as unknown as Theme

/** 构造适配选项 */
function makeOptions(overrides: Partial<Parameters<typeof createMindElixir>[0]> = {}) {
  return {
    el: {} as unknown as HTMLElement,
    data: DATA,
    theme: THEME,
    direction: 2 as const,
    onDirty: vi.fn(),
    onDirection: vi.fn(),
    onSelect: vi.fn(),
    ...overrides
  }
}

/** 最近一次创建的伪实例 */
function lastInstance(): FakeInstance {
  const instance = holder.instances[holder.instances.length - 1]
  return instance as unknown as FakeInstance
}

beforeEach(() => {
  holder.instances.length = 0
})

describe('mind-elixir-adapter', () => {
  it('构造参数与 init 数据符合 spec', async () => {
    const options = makeOptions()
    await createMindElixir(options)
    const instance = lastInstance()
    expect(instance.options).toMatchObject({
      el: options.el,
      direction: 2,
      editable: true,
      contextMenu: { locale: { name: 'zh' }, link: false },
      toolBar: false,
      keypress: true,
      allowUndo: true,
      newTopicName: '新主题',
      theme: THEME
    })
    expect(instance.initCalls).toEqual([DATA])
  })

  it('bus 事件映射到 onDirty / onDirection / onSelect', async () => {
    const options = makeOptions()
    await createMindElixir(options)
    const bus = lastInstance().bus
    bus.emit('operation')
    expect(options.onDirty).toHaveBeenCalledTimes(1)
    bus.emit('changeDirection', 1)
    expect(options.onDirection).toHaveBeenCalledWith(1)
    expect(options.onDirty).toHaveBeenCalledTimes(2)
    bus.emit('refresh')
    expect(options.onDirty).toHaveBeenCalledTimes(3)
    for (const event of ['selectNewNode', 'selectNodes', 'selectArrow', 'selectSummary']) {
      bus.emit(event)
    }
    expect(options.onSelect).toHaveBeenCalledTimes(4)
  })

  it('getData / refresh 透传并清空撤销栈', async () => {
    const handle = await createMindElixir(makeOptions())
    expect(handle.getData()).toEqual(DATA)
    const next: MindmapDocument = { nodeData: { id: 'b', topic: 'B' } }
    handle.refresh(next)
    const instance = lastInstance()
    expect(instance.refreshes).toEqual([next])
    expect(instance.clearHistoryCalls).toBe(1)
  })

  it('setDirection 覆盖四种布局', async () => {
    const handle = await createMindElixir(makeOptions())
    handle.setDirection(0)
    handle.setDirection(1)
    handle.setDirection(3)
    handle.setDirection(2)
    expect(lastInstance().directions).toEqual(['left', 'right', 'down', 'side'])
  })

  it('expandAll：找到根节点时调用，findEle 抛错时静默', async () => {
    const handle = await createMindElixir(makeOptions())
    const instance = lastInstance()
    instance.data = { nodeData: { id: 'root', topic: '根' } }
    handle.expandAll(true)
    expect(instance.expandCalls).toEqual([[{ id: 'root' }, true]])

    instance.data = { nodeData: { id: 'missing', topic: '根' } }
    handle.expandAll(false)
    expect(instance.expandCalls).toHaveLength(1)
  })

  it('缩放：百分比夹紧 10–200 并换算倍率', async () => {
    const handle = await createMindElixir(makeOptions())
    handle.setScale(5)
    handle.setScale(250)
    handle.setScale(123.4)
    expect(lastInstance().scaleCalls).toEqual([0.1, 2, 1.23])
    lastInstance().scaleVal = 1.234
    expect(handle.getScalePercent()).toBe(123)
  })

  it('fit / undo / redo / changeTheme / destroy 透传', async () => {
    const handle = await createMindElixir(makeOptions())
    handle.fit()
    handle.undo()
    handle.redo()
    handle.changeTheme(THEME)
    handle.destroy()
    const instance = lastInstance()
    expect(instance.fitCalls).toBe(1)
    expect(instance.undoCount).toBe(1)
    expect(instance.redoCount).toBe(1)
    expect(instance.themes).toEqual([[THEME, true]])
    expect(instance.destroyed).toBe(true)
  })

  it('选中节点快照：空选返回 null，有选返回 id/样式/分支色', async () => {
    const handle = await createMindElixir(makeOptions())
    const instance = lastInstance()
    expect(handle.getSelectedNode()).toBeNull()

    instance.currentNode = { nodeObj: { id: 'a', topic: 'A' } }
    expect(handle.getSelectedNode()).toEqual({ id: 'a', style: {}, branchColor: '' })

    instance.currentNode = {
      nodeObj: { id: 'b', topic: 'B', style: { fontSize: '14' }, branchColor: '#f00' }
    }
    expect(handle.getSelectedNode()).toEqual({
      id: 'b',
      style: { fontSize: '14' },
      branchColor: '#f00'
    })
  })

  it('样式写入：无选中返回 false，有选中时 reshape 并返回 true', async () => {
    const handle: MindElixirHandle = await createMindElixir(makeOptions())
    const instance = lastInstance()
    await expect(handle.applyNodeStyle({ style: { color: '#000' } })).resolves.toBe(false)
    await expect(handle.resetNodeStyle()).resolves.toBe(false)

    const topic = { nodeObj: { id: 'a', topic: 'A' } }
    instance.currentNode = topic
    await expect(handle.applyNodeStyle({ branchColor: '#f00' })).resolves.toBe(true)
    await expect(handle.resetNodeStyle()).resolves.toBe(true)
    expect(instance.reshapes).toEqual([
      [topic, { branchColor: '#f00' }],
      [topic, { style: {} }]
    ])
  })
})
