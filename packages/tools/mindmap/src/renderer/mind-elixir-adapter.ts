/**
 * @file mind-elixir 适配层（动态加载、事件桥接、视图/样式命令）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 渲染进程唯一接触 mind-elixir 的模块：库与中文语言包均动态 import，
 *              对外只暴露 MindElixirHandle，ToolView 不直接依赖第三方类型。
 */
import 'mind-elixir/style.css'

import type MindElixir from 'mind-elixir'
import type { MindElixirData, NodeObj, Theme, Topic } from 'mind-elixir'

import type { MindmapDirection, MindmapDocument, MindmapNode } from '../contract'

/** 实例类型（泛型固定为 unknown，避免 any 泄漏） */
export type MindElixirInstance = MindElixir<unknown>

/** 选中节点样式快照 */
export interface NodeStyleSnapshot {
  id: string
  topic: string
  note: string
  hyperLink: string
  style: Record<string, string>
  branchColor: string
}

/** 样式补丁 */
export interface NodeStylePatch {
  style?: Record<string, string>
  branchColor?: string
}

/** 大纲视图句柄 */
export interface OutlinerHandle {
  /** 销毁大纲视图（不触碰文档数据） */
  destroy(): void
}

/** 适配句柄（ToolView 使用面） */
export interface MindElixirHandle {
  /** 读取完整文档 */
  getData(): MindmapDocument
  /** 载入文档并清空撤销栈 */
  refresh(data: MindmapDocument): void
  /** 切换布局方向 */
  setDirection(direction: MindmapDirection): void
  /** 全部展开 / 折叠 */
  expandAll(expand: boolean): void
  /** 设置缩放百分比（10–200） */
  setScale(percent: number): void
  /** 当前缩放百分比 */
  getScalePercent(): number
  /** 适应窗口 */
  fit(): void
  /** 撤销 / 重做 */
  undo(): void
  redo(): void
  /** 当前选中节点样式 */
  getSelectedNode(): NodeStyleSnapshot | null
  /** 选中节点数量（多选时为多个） */
  getSelectionCount(): number
  /** 写回选中节点样式（多选时批量） */
  applyNodeStyle(patch: NodeStylePatch): Promise<boolean>
  /** 重置选中节点样式（多选时批量） */
  resetNodeStyle(): Promise<boolean>
  /** 新增子节点 / 同级节点 / 父级节点 */
  addChild(): Promise<void>
  addSibling(): Promise<void>
  insertParent(): Promise<void>
  /** 选中节点上移 / 下移 */
  moveUp(): Promise<void>
  moveDown(): Promise<void>
  /** 删除选中节点（根节点不可删），返回删除数量 */
  removeSelected(): Promise<number>
  /** 设置备注 / 超链接（空串表示清除） */
  setNodeMeta(patch: { note?: string; hyperLink?: string }): Promise<boolean>
  /** 按 id 选中并居中（节点已被折叠或删除时静默忽略） */
  focusById(id: string): void
  /** 追加节点树（走库内操作，保留撤销栈），返回实际追加数量 */
  appendNodes(nodes: MindmapNode[], targetId?: string): Promise<number>
  /** 挂载大纲视图（与画布同一文档、共享撤销栈） */
  mountOutliner(el: HTMLElement): Promise<OutlinerHandle>
  /** 重新渲染（主题切换） */
  changeTheme(theme: Theme): void
  /** 销毁实例 */
  destroy(): void
}

/** 创建参数 */
export interface AdapterOptions {
  el: HTMLElement
  data: MindmapDocument
  theme: Theme
  direction: MindmapDirection
  /** 数据变更（operation / changeDirection / refresh） */
  onDirty(): void
  /** 方向变化 */
  onDirection(direction: number): void
  /** 选择变化 */
  onSelect(): void
}

/** 文档类型转换（本工具数据结构是 MindElixirData 子集） */
function toLibraryData(data: MindmapDocument): MindElixirData {
  return data as unknown as MindElixirData
}

/**
 * 查找从根到目标节点的 id 路径
 * @param node 当前节点
 * @param id 目标节点 id
 * @returns 命中时返回 `[根, …, 目标]`，未命中返回 null
 */
function findPathIds(node: MindmapNode, id: string): string[] | null {
  if (node.id === id) return [node.id]
  for (const child of node.children ?? []) {
    const path = findPathIds(child, id)
    if (path !== null) return [node.id, ...path]
  }
  return null
}

/**
 * 创建并初始化 mind-elixir 实例
 * @param options 挂载点 / 初始数据 / 主题 / 回调
 */
export async function createMindElixir(options: AdapterOptions): Promise<MindElixirHandle> {
  const library = await import('mind-elixir')
  const i18n = await import('mind-elixir/i18n')
  const MindElixirClass = library.default
  const instance: MindElixirInstance = new MindElixirClass({
    el: options.el,
    direction: options.direction,
    editable: true,
    contextMenu: { locale: i18n.zh_CN, link: false },
    toolBar: false,
    keypress: true,
    allowUndo: true,
    newTopicName: '新主题',
    theme: options.theme
  })

  instance.bus.addListener('operation', () => {
    options.onDirty()
  })
  instance.bus.addListener('changeDirection', (direction) => {
    options.onDirection(direction)
    options.onDirty()
  })
  instance.bus.addListener('refresh', () => {
    options.onDirty()
  })
  instance.bus.addListener('selectNewNode', () => {
    options.onSelect()
  })
  instance.bus.addListener('selectNodes', () => {
    options.onSelect()
  })
  instance.bus.addListener('selectArrow', () => {
    options.onSelect()
  })
  instance.bus.addListener('selectSummary', () => {
    options.onSelect()
  })

  await instance.init(toLibraryData(options.data))

  /** 按 id 查节点元素，找不到（已被折叠或删除）返回 null */
  const eleById = (id: string): Topic<unknown> | null => {
    try {
      return instance.findEle(id)
    } catch {
      return null
    }
  }

  /** 根节点元素（用于全部展开） */
  const rootElement = (): Topic<unknown> | null => eleById(instance.getData().nodeData.id)

  /** 选中节点集合（多选优先，回退单选；库在未选中时可能返回 null/undefined） */
  const selectedTopics = (): NonNullable<MindElixirInstance['currentNode']>[] => {
    const topics = instance.currentNodes ?? []
    if (topics.length > 0) return topics
    const single = instance.currentNode
    return single === null || single === undefined ? [] : [single]
  }

  /** 写当前节点样式（多选逐个写回） */
  const reshapeSelected = async (patch: Partial<NodeObj<unknown>>): Promise<boolean> => {
    const topics = selectedTopics()
    if (topics.length === 0) return false
    for (const topic of topics) await instance.reshapeNode(topic, patch)
    return true
  }

  return {
    getData() {
      return instance.getData() as unknown as MindmapDocument
    },
    refresh(data) {
      instance.refresh(toLibraryData(data))
      instance.clearHistory?.()
    },
    setDirection(direction) {
      if (direction === 0) instance.initLeft()
      else if (direction === 1) instance.initRight()
      else if (direction === 3) instance.initDown()
      else instance.initSide()
    },
    expandAll(expand) {
      const root = rootElement()
      if (root !== null) instance.expandNodeAll(root, expand)
    },
    setScale(percent) {
      const clamped = Math.min(200, Math.max(10, Math.round(percent)))
      instance.scale(clamped / 100)
    },
    getScalePercent() {
      return Math.round(instance.scaleVal * 100)
    },
    fit() {
      instance.scaleFit()
    },
    undo() {
      instance.undo()
    },
    redo() {
      instance.redo()
    },
    getSelectedNode() {
      const topic = instance.currentNode
      if (topic === null || topic === undefined) return null
      const node = topic.nodeObj as MindmapNode
      return {
        id: node.id,
        topic: node.topic,
        note: node.note ?? '',
        hyperLink: node.hyperLink ?? '',
        style: { ...(node.style ?? {}) } as Record<string, string>,
        branchColor: node.branchColor ?? ''
      }
    },
    getSelectionCount() {
      return selectedTopics().filter((topic) => topic.nodeObj.id !== instance.getData().nodeData.id)
        .length
    },
    async applyNodeStyle(patch) {
      return reshapeSelected(patch as unknown as Partial<NodeObj<unknown>>)
    },
    async resetNodeStyle() {
      return reshapeSelected({ style: {} })
    },
    async addChild() {
      await instance.addChild(instance.currentNode ?? undefined)
    },
    async addSibling() {
      await instance.insertSibling('after', instance.currentNode ?? undefined)
    },
    async insertParent() {
      await instance.insertParent(instance.currentNode ?? undefined)
    },
    async moveUp() {
      await instance.moveUpNode(instance.currentNode ?? undefined)
    },
    async moveDown() {
      await instance.moveDownNode(instance.currentNode ?? undefined)
    },
    async removeSelected() {
      const rootId = instance.getData().nodeData.id
      const topics = selectedTopics().filter((topic) => topic.nodeObj.id !== rootId)
      if (topics.length === 0) return 0
      await instance.removeNodes(topics)
      return topics.length
    },
    async setNodeMeta(patch) {
      const topic = instance.currentNode
      if (topic === null || topic === undefined) return false
      const data: Partial<NodeObj<unknown>> = {}
      if (patch.note !== undefined) data.note = patch.note === '' ? undefined : patch.note
      if (patch.hyperLink !== undefined) {
        data.hyperLink = patch.hyperLink === '' ? undefined : patch.hyperLink
      }
      await instance.reshapeNode(topic, data)
      return true
    },
    focusById(id) {
      const data = instance.getData().nodeData as unknown as MindmapNode
      const path = findPathIds(data, id)
      if (path === null) return
      // 根节点折叠时库内 expandNode 依赖 .me-wrapper 结构（根节点无折叠开关）会抛错，改用全量展开兜底
      if (path.length > 1 && data.expanded === false) {
        const rootEl = rootElement()
        if (rootEl !== null) instance.expandNodeAll(rootEl, true, { silent: true })
      }
      // 自上而下展开祖先（跳过根与目标自身），保证折叠链路上的节点先渲染出来
      for (const ancestorId of path.slice(1, -1)) {
        const topic = eleById(ancestorId)
        if (topic === null || topic.nodeObj.expanded !== false) continue
        instance.expandNode(topic, true, { silent: true })
      }
      const topic = eleById(id)
      if (topic === null) return
      instance.selectNode(topic)
      instance.scrollIntoView(topic, true)
    },
    async appendNodes(nodes, targetId) {
      if (nodes.length === 0) return 0
      const target =
        targetId === undefined
          ? undefined
          : selectedTopics().find((topic) => topic.nodeObj.id === targetId)
      let parent: NonNullable<MindElixirInstance['currentNode']> | null | undefined =
        target ?? instance.currentNode
      if (parent === null || parent === undefined) {
        // 无选中节点时回落到根节点，保证「从文本生成」在空选状态也能追加
        const rootEl = rootElement()
        if (rootEl === null) return 0
        instance.selectNode(rootEl)
        parent = instance.currentNode
      }
      if (parent === null || parent === undefined) return 0
      for (const node of nodes) await instance.addChild(parent, node as unknown as NodeObj<unknown>)
      return nodes.length
    },
    async mountOutliner(el) {
      const outliner = new library.Outliner({
        el,
        mei: instance as unknown as MindElixir,
        fileName: instance.getData().nodeData.topic,
        i18n: {
          menuTitle: '节点操作',
          outdent: '减少缩进',
          indent: '增加缩进',
          delete: '删除节点',
          untitled: '未命名节点',
          zoomInAndDrag: '缩放后可拖拽调整层级'
        }
      })
      return { destroy: () => outliner.destroy() }
    },
    changeTheme(theme) {
      instance.changeTheme(theme, true)
    },
    destroy() {
      instance.destroy()
    }
  }
}
