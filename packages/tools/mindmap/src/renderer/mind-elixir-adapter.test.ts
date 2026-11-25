/**
 * @file mind-elixir 适配层单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 通过 vi.mock 替换 mind-elixir 库与语言包，验证构造参数、bus 事件桥接、
 *              视图/样式命令映射与选中节点快照。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Theme } from 'mind-elixir'
import type { MindmapDocument, MindmapNode } from '../contract'
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
  findEle: (id: string) => { id: string; nodeObj: Record<string, unknown> }
  currentNode: { nodeObj: Record<string, unknown> } | null
  currentNodes: Array<{ nodeObj: Record<string, unknown> }>
  scaleVal: number
  initCalls: unknown[]
  refreshes: unknown[]
  clearHistoryCalls: number
  directions: string[]
  expandCalls: Array<[unknown, boolean]>
  expandOneCalls: unknown[]
  scaleCalls: number[]
  fitCalls: number
  undoCount: number
  redoCount: number
  reshapes: Array<[unknown, unknown]>
  themes: Array<[unknown, boolean]>
  addChildCalls: Array<[unknown, unknown]>
  siblingCalls: Array<[string, unknown]>
  parentCalls: unknown[]
  upCalls: unknown[]
  downCalls: unknown[]
  removeCalls: unknown[][]
  selectedTopics: unknown[]
  scrollCalls: Array<[unknown, boolean | undefined]>
  destroyed: boolean
}

/** 大纲视图伪实例 */
interface FakeOutliner {
  options: Record<string, unknown>
  destroyed: boolean
}

const holder = vi.hoisted(() => ({
  instances: [] as unknown[],
  outliners: [] as unknown[]
}))

vi.mock('mind-elixir', () => {
  /** 在伪数据里按 id 找节点（模拟库内 findEle 返回元素上挂的 nodeObj） */
  const findNode = (data: unknown, id: string): Record<string, unknown> | null => {
    const walk = (node: Record<string, unknown> | undefined): Record<string, unknown> | null => {
      if (!node) return null
      if (node.id === id) return node
      for (const child of (node.children ?? []) as Record<string, unknown>[]) {
        const hit = walk(child)
        if (hit !== null) return hit
      }
      return null
    }
    const root = (data as { nodeData?: Record<string, unknown> } | null)?.nodeData
    return walk(root)
  }

  class FakeMindElixir {
    readonly bus: FakeInstance['bus']
    data: unknown = { nodeData: { id: 'root', topic: '根', children: [] } }
    currentNode: FakeInstance['currentNode'] = null
    currentNodes: FakeInstance['currentNodes'] = []
    scaleVal = 1
    readonly options: Record<string, unknown>
    readonly initCalls: unknown[] = []
    readonly refreshes: unknown[] = []
    clearHistoryCalls = 0
    readonly directions: string[] = []
    readonly expandCalls: Array<[unknown, boolean]> = []
    readonly expandOneCalls: unknown[] = []
    readonly scaleCalls: number[] = []
    fitCalls = 0
    undoCount = 0
    redoCount = 0
    readonly reshapes: Array<[unknown, unknown]> = []
    readonly themes: Array<[unknown, boolean]> = []
    readonly addChildCalls: Array<[unknown, unknown]> = []
    readonly siblingCalls: Array<[string, unknown]> = []
    readonly parentCalls: unknown[] = []
    readonly upCalls: unknown[] = []
    readonly downCalls: unknown[] = []
    readonly removeCalls: unknown[][] = []
    readonly selectedTopics: unknown[] = []
    readonly scrollCalls: Array<[unknown, boolean | undefined]> = []
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

    findEle(id: string): { id: string; nodeObj: Record<string, unknown> } {
      const nodeObj = findNode(this.data, id)
      if (nodeObj === null) throw new Error(`not found: ${id}`)
      return { id, nodeObj }
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

    async addChild(topic?: unknown, node?: unknown): Promise<void> {
      this.addChildCalls.push([topic, node])
    }

    async insertSibling(type: string, topic?: unknown): Promise<void> {
      this.siblingCalls.push([type, topic])
    }

    async insertParent(topic?: unknown): Promise<void> {
      this.parentCalls.push(topic)
    }

    async moveUpNode(topic?: unknown): Promise<void> {
      this.upCalls.push(topic)
    }

    async moveDownNode(topic?: unknown): Promise<void> {
      this.downCalls.push(topic)
    }

    async removeNodes(topics: unknown[]): Promise<void> {
      this.removeCalls.push(topics)
    }

    selectNode(topic: unknown): void {
      this.selectedTopics.push(topic)
      this.currentNode = topic as FakeInstance['currentNode']
    }

    scrollIntoView(element: unknown, smooth?: boolean): void {
      this.scrollCalls.push([element, smooth])
    }

    expandNode(element: unknown): void {
      this.expandOneCalls.push(element)
    }

    changeTheme(theme: unknown, reRender: boolean): void {
      this.themes.push([theme, reRender])
    }

    destroy(): void {
      this.destroyed = true
    }
  }

  class FakeOutliner {
    readonly options: Record<string, unknown>
    destroyed = false

    constructor(options: Record<string, unknown>) {
      this.options = options
      holder.outliners.push(this)
    }

    destroy(): void {
      this.destroyed = true
    }
  }

  return { default: FakeMindElixir, Outliner: FakeOutliner }
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
  holder.outliners.length = 0
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
    expect(instance.expandCalls.map(([element]) => (element as { id: string }).id)).toEqual(['root'])
    expect(instance.expandCalls[0]?.[1]).toBe(true)

    instance.findEle = () => {
      throw new Error('collapsed')
    }
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

  it('选中节点快照：空选返回 null，有选返回 id/主题/备注/链接/样式/分支色', async () => {
    const handle = await createMindElixir(makeOptions())
    const instance = lastInstance()
    expect(handle.getSelectedNode()).toBeNull()

    instance.currentNode = { nodeObj: { id: 'a', topic: 'A' } }
    expect(handle.getSelectedNode()).toEqual({
      id: 'a',
      topic: 'A',
      note: '',
      hyperLink: '',
      style: {},
      branchColor: ''
    })

    instance.currentNode = {
      nodeObj: {
        id: 'b',
        topic: 'B',
        note: '备注',
        hyperLink: 'https://a.b',
        style: { fontSize: '14' },
        branchColor: '#f00'
      }
    }
    expect(handle.getSelectedNode()).toEqual({
      id: 'b',
      topic: 'B',
      note: '备注',
      hyperLink: 'https://a.b',
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

  it('节点操作：增子/同级/父级/上下移透传给库', async () => {
    const handle = await createMindElixir(makeOptions())
    const instance = lastInstance()
    expect(handle.getSelectionCount()).toBe(0)
    const topic = { nodeObj: { id: 'a', topic: 'A' } }
    instance.currentNode = topic
    instance.currentNodes = [topic]
    expect(handle.getSelectionCount()).toBe(1)
    await handle.addChild()
    await handle.addSibling()
    await handle.insertParent()
    await handle.moveUp()
    await handle.moveDown()
    expect(instance.addChildCalls).toEqual([[topic, undefined]])
    expect(instance.siblingCalls).toEqual([['after', topic]])
    expect(instance.parentCalls).toEqual([topic])
    expect(instance.upCalls).toEqual([topic])
    expect(instance.downCalls).toEqual([topic])
  })

  it('删除：根节点不可删，其余批量删除', async () => {
    const handle = await createMindElixir(makeOptions())
    const instance = lastInstance()
    const root = { nodeObj: { id: 'root', topic: '根' } }
    instance.currentNode = root
    instance.currentNodes = [root]
    await expect(handle.removeSelected()).resolves.toBe(0)

    const a = { nodeObj: { id: 'a', topic: 'A' } }
    const b = { nodeObj: { id: 'b', topic: 'B' } }
    instance.currentNodes = [root, a, b]
    await expect(handle.removeSelected()).resolves.toBe(2)
    expect(instance.removeCalls).toEqual([[a, b]])
    expect(handle.getSelectionCount()).toBe(2)
  })

  it('备注/链接：空串转 undefined，无选中返回 false', async () => {
    const handle = await createMindElixir(makeOptions())
    const instance = lastInstance()
    await expect(handle.setNodeMeta({ note: 'n' })).resolves.toBe(false)
    const topic = { nodeObj: { id: 'a', topic: 'A' } }
    instance.currentNode = topic
    await expect(handle.setNodeMeta({ note: '备注', hyperLink: '' })).resolves.toBe(true)
    expect(instance.reshapes).toEqual([[topic, { note: '备注', hyperLink: undefined }]])
  })

  it('focusById：展开折叠祖先并选中居中，根折叠时全量展开，未命中静默', async () => {
    const handle = await createMindElixir(makeOptions())
    const instance = lastInstance()
    instance.data = {
      nodeData: {
        id: 'root',
        topic: '根',
        children: [
          { id: 'a', topic: 'A', expanded: false, children: [{ id: 'b', topic: 'B' }] }
        ]
      }
    }
    handle.focusById('b')
    // 根节点无折叠开关，不参与单节点展开；仅展开折叠的中间祖先
    expect(instance.expandOneCalls.map((element) => (element as { id: string }).id)).toEqual(['a'])
    expect(instance.selectedTopics.map((topic) => (topic as { id: string }).id)).toEqual(['b'])
    expect(instance.scrollCalls.map(([element]) => (element as { id: string }).id)).toEqual(['b'])
    expect(instance.expandCalls).toHaveLength(0)

    // 根节点折叠时库内 expandNode 不可用，回落全量展开
    instance.data = {
      nodeData: {
        id: 'root',
        topic: '根',
        expanded: false,
        children: [{ id: 'a', topic: 'A', children: [{ id: 'b', topic: 'B' }] }]
      }
    }
    handle.focusById('b')
    expect(instance.expandCalls.map(([element]) => (element as { id: string }).id)).toEqual(['root'])

    handle.focusById('missing')
    expect(instance.scrollCalls).toHaveLength(2)
  })

  it('appendNodes：空数组不操作，按目标节点批量加子级', async () => {
    const handle = await createMindElixir(makeOptions())
    const instance = lastInstance()
    const parent = { nodeObj: { id: 'a', topic: 'A' } }
    instance.currentNode = parent
    instance.currentNodes = [parent]
    await expect(handle.appendNodes([])).resolves.toBe(0)
    const nodes: MindmapNode[] = [
      { id: 'n1', topic: 'N1' },
      { id: 'n2', topic: 'N2' }
    ]
    await expect(handle.appendNodes(nodes, 'a')).resolves.toBe(2)
    expect(instance.addChildCalls).toEqual([
      [parent, nodes[0]],
      [parent, nodes[1]]
    ])
  })

  it('appendNodes：无选中节点时回落到根节点', async () => {
    const handle = await createMindElixir(makeOptions())
    const instance = lastInstance()
    instance.currentNode = null
    instance.currentNodes = []
    const node: MindmapNode = { id: 'n1', topic: 'N1' }
    await expect(handle.appendNodes([node])).resolves.toBe(1)
    expect(instance.selectedTopics.map((topic) => (topic as { id: string }).id)).toEqual(['root'])
    expect(instance.addChildCalls).toEqual([[instance.currentNode, node]])
  })

  it('mountOutliner：绑定同一实例并返回可销毁句柄', async () => {
    const handle = await createMindElixir(makeOptions())
    const host = {} as HTMLElement
    const outliner = await handle.mountOutliner(host)
    const created = holder.outliners[0] as FakeOutliner
    expect(created.options).toMatchObject({
      el: host,
      mei: lastInstance(),
      fileName: '根',
      i18n: { menuTitle: '节点操作', untitled: '未命名节点' }
    })
    outliner.destroy()
    expect(created.destroyed).toBe(true)
  })
})
