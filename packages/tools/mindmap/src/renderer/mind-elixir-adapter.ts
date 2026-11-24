/**
 * @file mind-elixir 适配层（动态加载、事件桥接、视图/样式命令）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 渲染进程唯一接触 mind-elixir 的模块：库与中文语言包均动态 import，
 *              对外只暴露 MindElixirHandle，ToolView 不直接依赖第三方类型。
 */
import 'mind-elixir/style.css'

import type MindElixir from 'mind-elixir'
import type { MindElixirData, NodeObj, Theme } from 'mind-elixir'

import type { MindmapDirection, MindmapDocument, MindmapNode } from '../contract'

/** 实例类型（泛型固定为 unknown，避免 any 泄漏） */
export type MindElixirInstance = MindElixir<unknown>

/** 选中节点样式快照 */
export interface NodeStyleSnapshot {
  id: string
  style: Record<string, string>
  branchColor: string
}

/** 样式补丁 */
export interface NodeStylePatch {
  style?: Record<string, string>
  branchColor?: string
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
  /** 写回选中节点样式 */
  applyNodeStyle(patch: NodeStylePatch): Promise<boolean>
  /** 重置选中节点样式 */
  resetNodeStyle(): Promise<boolean>
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

  /** 根节点 DOM（用于全部展开） */
  const rootElement = (): ReturnType<MindElixirInstance['findEle']> | null => {
    const rootId = instance.getData().nodeData.id
    try {
      return instance.findEle(rootId)
    } catch {
      return null
    }
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
      if (topic === null) return null
      const node = topic.nodeObj as MindmapNode
      return {
        id: node.id,
        style: { ...(node.style ?? {}) } as Record<string, string>,
        branchColor: node.branchColor ?? ''
      }
    },
    async applyNodeStyle(patch) {
      const topic = instance.currentNode
      if (topic === null) return false
      await instance.reshapeNode(topic, patch as unknown as Partial<NodeObj<unknown>>)
      return true
    },
    async resetNodeStyle() {
      const topic = instance.currentNode
      if (topic === null) return false
      await instance.reshapeNode(topic, { style: {} })
      return true
    },
    changeTheme(theme) {
      instance.changeTheme(theme, true)
    },
    destroy() {
      instance.destroy()
    }
  }
}
