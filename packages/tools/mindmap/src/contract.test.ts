/**
 * @file 文档模型与清洗纯函数单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖 sanitizeDocument 的字段剥离/id 修复/上限、统计函数、方向归一与序列化。
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_DEPTH,
  MAX_NODES,
  collectIds,
  countNodes,
  createDocument,
  defaultNewId,
  directionLabel,
  isColor,
  isRecord,
  normalizeDirection,
  sanitizeDocument,
  serializeDocument,
  treeDepth
} from './contract'

/** 顺序 id 生成器（断言重新生成行为） */
function sequentialIds(prefix = 'gen'): () => string {
  let index = 0
  return () => {
    index += 1
    return `${prefix}-${index}`
  }
}

/** 构造深度为 depth 的单链节点 */
function chain(depth: number): Record<string, unknown> {
  const root: Record<string, unknown> = { id: 'root', topic: '0', children: [] }
  let current = root
  for (let level = 1; level < depth; level += 1) {
    const child: Record<string, unknown> = { id: `n${level}`, topic: String(level), children: [] }
    ;(current.children as Record<string, unknown>[]).push(child)
    current = child
  }
  return root
}

describe('contract', () => {
  it('defaultNewId 返回 32 位小写十六进制', () => {
    expect(defaultNewId()).toMatch(/^[0-9a-f]{32}$/u)
    expect(defaultNewId()).not.toBe(defaultNewId())
  })

  it('isRecord 排除数组与 null', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('x')).toBe(false)
  })

  it('isColor 仅接受 #RGB / #RRGGBB / rgb() / rgba()', () => {
    expect(isColor('#fff')).toBe(true)
    expect(isColor('#a1b2c3')).toBe(true)
    expect(isColor('rgb(1, 2, 3)')).toBe(true)
    expect(isColor('rgba(1,2,3,0.5)')).toBe(true)
    expect(isColor('red')).toBe(false)
    expect(isColor(1)).toBe(false)
  })

  it('最小文档：补默认方向、固定 meta、expanded 默认 true', () => {
    const { data, warnings } = sanitizeDocument({ nodeData: { id: 'a', topic: '根' } })
    expect(warnings).toEqual([])
    expect(data).toEqual({
      nodeData: { id: 'a', topic: '根', expanded: true, children: [] },
      direction: 2,
      meta: { app: 'lumin-mindmap', version: 1 }
    })
  })

  it('非对象输入抛 MM_INVALID_DOCUMENT', () => {
    expect(() => sanitizeDocument(null)).toThrowError(
      expect.objectContaining({ code: 'MM_INVALID_DOCUMENT' })
    )
    expect(() => sanitizeDocument({ nodeData: [] })).toThrowError(
      expect.objectContaining({ code: 'MM_INVALID_DOCUMENT' })
    )
  })

  it('剥离富文本/图片/图标/元数据并逐条告警', () => {
    const { data, warnings } = sanitizeDocument({
      nodeData: {
        id: 'a',
        topic: '根',
        dangerouslySetInnerHTML: { __html: '<b>x</b>' },
        image: { url: 'x' },
        icons: ['x'],
        metadata: { x: 1 }
      }
    })
    expect(data.nodeData).not.toHaveProperty('dangerouslySetInnerHTML')
    expect(data.nodeData).not.toHaveProperty('image')
    expect(data.nodeData).not.toHaveProperty('icons')
    expect(data.nodeData).not.toHaveProperty('metadata')
    expect(warnings).toEqual(
      expect.arrayContaining([
        '已剥离不支持的富文本内容',
        '已剥离图片节点',
        '已剥离图标字段',
        '已剥离元数据字段'
      ])
    )
  })

  it('id 非法或重复时用注入生成器重写并告警（只告警一次）', () => {
    const { data, warnings } = sanitizeDocument(
      {
        nodeData: {
          id: 'bad id!',
          topic: '根',
          children: [
            { id: 'dup', topic: 'A' },
            { id: 'dup', topic: 'B' }
          ]
        }
      },
      sequentialIds()
    )
    const children = data.nodeData.children ?? []
    expect(data.nodeData.id).toBe('gen-1')
    expect(children[0]?.id).toBe('dup')
    expect(children[1]?.id).toBe('gen-2')
    expect(warnings.filter((item) => item === '节点 id 缺失或重复，已重新生成')).toHaveLength(1)
  })

  it('topic 去控制字符/trim，空值回退「未命名」并截断到 2000', () => {
    const { data } = sanitizeDocument({
      nodeData: { id: 'a', topic: ` \u0000标题\t `, children: [{ id: 'b', topic: '' }] }
    })
    expect(data.nodeData.topic).toBe('标题')
    expect(data.nodeData.children?.[0]?.topic).toBe('未命名')

    const long = sanitizeDocument({ nodeData: { id: 'a', topic: 'x'.repeat(3000) } })
    expect(long.data.nodeData.topic).toHaveLength(2000)
  })

  it('备注/链接：仅保留 http(s)/mailto，其余协议丢弃并告警', () => {
    const { data, warnings } = sanitizeDocument({
      nodeData: {
        id: 'a',
        topic: '根',
        note: '  备注  ',
        hyperLink: 'https://example.com/a?b=1',
        children: [
          { id: 'b', topic: 'B', hyperLink: 'mailto:a@b.com' },
          { id: 'c', topic: 'C', hyperLink: 'javascript:alert(1)' },
          { id: 'd', topic: 'D', hyperLink: 'mailto:not-an-email' }
        ]
      }
    })
    expect(data.nodeData.note).toBe('备注')
    expect(data.nodeData.hyperLink).toBe('https://example.com/a?b=1')
    expect(data.nodeData.children?.[0]?.hyperLink).toBe('mailto:a@b.com')
    expect(data.nodeData.children?.[1]?.hyperLink).toBeUndefined()
    expect(data.nodeData.children?.[2]?.hyperLink).toBeUndefined()
    expect(warnings).toContain('不支持的链接协议已丢弃')
  })

  it('direction 仅根节点以外的 0/1 保留', () => {
    const { data } = sanitizeDocument({
      nodeData: {
        id: 'a',
        topic: '根',
        direction: 0,
        children: [
          { id: 'b', topic: 'B', direction: 0 },
          { id: 'c', topic: 'C', direction: 1 },
          { id: 'd', topic: 'D', direction: 3 }
        ]
      }
    })
    expect(data.nodeData.direction).toBeUndefined()
    expect(data.nodeData.children?.[0]?.direction).toBe(0)
    expect(data.nodeData.children?.[1]?.direction).toBe(1)
    expect(data.nodeData.children?.[2]?.direction).toBeUndefined()
  })

  it('样式仅保留白名单键，非法值忽略并告警', () => {
    const { data, warnings } = sanitizeDocument({
      nodeData: {
        id: 'a',
        topic: '根',
        style: {
          fontSize: 14,
          color: '#fff',
          background: 'url(http://x)',
          border: '1px solid;',
          width: 'x'.repeat(65),
          unknown: '1'
        }
      }
    })
    expect(data.nodeData.style).toEqual({ fontSize: '14', color: '#fff' })
    expect(warnings).toContain('部分节点样式不合法，已忽略')
  })

  it('标签支持 string 与 {text}，超过 10 个截断并告警', () => {
    const { data, warnings } = sanitizeDocument({
      nodeData: {
        id: 'a',
        topic: '根',
        tags: [{ text: '甲' }, '乙', '', 1, ...Array.from({ length: 10 }, (_, i) => `t${i}`)]
      }
    })
    expect(data.nodeData.tags).toEqual(['甲', '乙', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'])
    expect(warnings).toContain('部分标签超过上限，已截断')
  })

  it('branchColor 合法保留、非法忽略并告警', () => {
    const ok = sanitizeDocument({ nodeData: { id: 'a', topic: '根', branchColor: '#abc' } })
    expect(ok.data.nodeData.branchColor).toBe('#abc')

    const bad = sanitizeDocument({ nodeData: { id: 'a', topic: '根', branchColor: 'red' } })
    expect(bad.data.nodeData.branchColor).toBeUndefined()
    expect(bad.warnings).toContain('分支颜色不合法，已忽略')
  })

  it('非对象子节点忽略并告警', () => {
    const { data, warnings } = sanitizeDocument({
      nodeData: { id: 'a', topic: '根', children: [1, 'x', { id: 'b', topic: 'B' }] }
    })
    expect(data.nodeData.children).toHaveLength(1)
    expect(warnings).toContain('部分子节点格式不合法，已忽略')
  })

  it('arrows / summaries：非数组告警、非对象过滤、超过 200 截断', () => {
    const nonArray = sanitizeDocument({ nodeData: { id: 'a', topic: '根' }, arrows: 'x' })
    expect(nonArray.data.arrows).toBeUndefined()
    expect(nonArray.warnings).toContain('不支持的 arrows 字段已忽略')

    const mixed = sanitizeDocument({
      nodeData: { id: 'a', topic: '根' },
      summaries: [{ a: 1 }, 2]
    })
    expect(mixed.data.summaries).toEqual([{ a: 1 }])
    expect(mixed.warnings).toContain('部分 summaries 项不是对象，已忽略')

    const many = sanitizeDocument({
      nodeData: { id: 'a', topic: '根' },
      arrows: Array.from({ length: 205 }, (_, i) => ({ id: i }))
    })
    expect(many.data.arrows).toHaveLength(200)
    expect(many.warnings).toContain('arrows 超过 200 项，已截断')
  })

  it('超过最大深度抛 MM_NODE_LIMIT', () => {
    expect(() => sanitizeDocument({ nodeData: chain(MAX_DEPTH + 1) })).toThrowError(
      expect.objectContaining({ code: 'MM_NODE_LIMIT' })
    )
  })

  it('超过最大节点数抛 MM_NODE_LIMIT', () => {
    const children = Array.from({ length: MAX_NODES }, (_, i) => ({ id: `n${i}`, topic: 'x' }))
    expect(() =>
      sanitizeDocument({ nodeData: { id: 'root', topic: '根', children } })
    ).toThrowError(expect.objectContaining({ code: 'MM_NODE_LIMIT' }))
  })

  it('countNodes / treeDepth / collectIds 兼容文档包装与裸节点', () => {
    const node = {
      id: 'a',
      topic: '根',
      children: [{ id: 'b', topic: 'B', children: [{ id: 'c', topic: 'C' }] }]
    }
    expect(countNodes({ nodeData: node })).toBe(3)
    expect(countNodes(node)).toBe(3)
    expect(countNodes(null)).toBe(0)
    expect(treeDepth({ nodeData: node })).toBe(3)
    expect(treeDepth(node)).toBe(3)
    expect(treeDepth(null)).toBe(0)
    expect([...collectIds({ nodeData: node })]).toEqual(['a', 'b', 'c'])
    expect(collectIds(null).size).toBe(0)
  })

  it('normalizeDirection 非法值回退 2；directionLabel 覆盖四值', () => {
    expect(normalizeDirection(0)).toBe(0)
    expect(normalizeDirection(3)).toBe(3)
    expect(normalizeDirection(9)).toBe(2)
    expect(normalizeDirection('1')).toBe(2)
    expect(directionLabel(0)).toBe('左侧')
    expect(directionLabel(1)).toBe('右侧')
    expect(directionLabel(2)).toBe('左右')
    expect(directionLabel(3)).toBe('向下')
  })

  it('createDocument 生成根节点最小文档，空主题回退默认值', () => {
    const doc = createDocument(undefined, sequentialIds())
    expect(doc.nodeData).toEqual({
      id: 'gen-1',
      topic: '中心主题',
      expanded: true,
      children: []
    })
    expect(doc.direction).toBe(2)
    const empty = createDocument('   ', sequentialIds())
    expect(empty.nodeData.topic).toBe('中心主题')
  })

  it('serializeDocument 默认 2 空格缩进，pretty=false 单行，非法输入抛错', () => {
    const pretty = serializeDocument({ nodeData: { id: 'a', topic: '根' } })
    expect(pretty).toContain('\n  "nodeData"')
    const compact = serializeDocument({ nodeData: { id: 'a', topic: '根' } }, { pretty: false })
    expect(compact).not.toContain('\n')
    expect(() => serializeDocument('x')).toThrowError(
      expect.objectContaining({ code: 'MM_INVALID_DOCUMENT' })
    )
  })
})
