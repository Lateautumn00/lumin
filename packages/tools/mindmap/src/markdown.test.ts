/**
 * @file Markdown 大纲导入/导出单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖行尾链接拆分、标题/列表层级、跳级修正、围栏跳过、备注归集、多顶层虚拟根、
 *              上限抛错与导出缩进/备注/链接渲染。
 */
import { describe, expect, it } from 'vitest'
import { MAX_DEPTH } from './contract'
import { exportMarkdown, importMarkdown, splitTrailingLink } from './markdown'

/** 顺序 id 生成器 */
function sequentialIds(): () => string {
  let index = 0
  return () => {
    index += 1
    return `id-${index}`
  }
}

describe('markdown', () => {
  describe('splitTrailingLink', () => {
    it('无链接时 trim 返回', () => {
      expect(splitTrailingLink('  主题  ')).toEqual({ text: '主题' })
    })

    it('行尾链接拆出主题与地址', () => {
      expect(splitTrailingLink('主题 [链接](https://a.com/x)')).toEqual({
        text: '主题',
        link: 'https://a.com/x'
      })
    })

    it('只有链接时用链接文字作为主题', () => {
      expect(splitTrailingLink('[官网](https://a.com)')).toEqual({
        text: '官网',
        link: 'https://a.com'
      })
    })
  })

  describe('importMarkdown', () => {
    it('标题与列表构成层级，备注归入最近节点', () => {
      const { data, warnings } = importMarkdown(
        [
          '# 根',
          '> 根备注',
          '## A [a](https://a.com)',
          '> 第一行',
          '> 第二行',
          '### A1',
          '- A1a',
          '## B'
        ].join('\n'),
        sequentialIds()
      )
      expect(warnings).toEqual([])
      const root = data.nodeData
      expect(root.topic).toBe('根')
      expect(root.note).toBe('根备注')
      expect(root.children?.map((node) => node.topic)).toEqual(['A', 'B'])

      const a = root.children?.[0]
      expect(a?.hyperLink).toBe('https://a.com')
      expect(a?.note).toBe('第一行\n第二行')
      expect(a?.children?.[0]?.topic).toBe('A1')
      expect(a?.children?.[0]?.children?.[0]?.topic).toBe('A1a')
    })

    it('围栏代码块内标题被跳过', () => {
      const { data } = importMarkdown(
        ['# 根', '```', '# 不是标题', '```', '## 真标题'].join('\n'),
        sequentialIds()
      )
      expect(data.nodeData.children?.map((node) => node.topic)).toEqual(['真标题'])
    })

    it('顶部孤立备注告警并忽略', () => {
      const { warnings } = importMarkdown(['> 无归属', '# 根'].join('\n'), sequentialIds())
      expect(warnings).toContain('顶部备注缺少归属节点，已忽略')
    })

    it('层级跳级按父级 +1 修正', () => {
      const { data, warnings } = importMarkdown(['# 根', '#### 深'].join('\n'), sequentialIds())
      expect(data.nodeData.children?.[0]?.topic).toBe('深')
      expect(warnings).toContain('标题层级跳级，已按父级 +1 修正')
    })

    it('多个顶层节点归入虚拟根', () => {
      const { data, warnings } = importMarkdown(['# 甲', '# 乙'].join('\n'), sequentialIds())
      expect(data.nodeData.topic).toBe('导入导图')
      expect(data.nodeData.children?.map((node) => node.topic)).toEqual(['甲', '乙'])
      expect(warnings).toContain('检测到多个顶层节点，已归入「导入导图」')
    })

    it('列表在无标题时也能作为顶层', () => {
      const { data } = importMarkdown('- 甲\n  - 乙', sequentialIds())
      expect(data.nodeData.topic).toBe('甲')
      expect(data.nodeData.children?.[0]?.topic).toBe('乙')
    })

    it('空内容抛 MM_IMPORT_INVALID', () => {
      expect(() => importMarkdown('   ', sequentialIds())).toThrowError(
        expect.objectContaining({ code: 'MM_IMPORT_INVALID' })
      )
    })

    it('超过深度上限抛 MM_NODE_LIMIT', () => {
      const lines = ['# 根']
      for (let level = 1; level <= MAX_DEPTH; level += 1) {
        lines.push(`${'  '.repeat(level - 1)}- L${level}`)
      }
      expect(() => importMarkdown(lines.join('\n'), sequentialIds())).toThrowError(
        expect.objectContaining({ code: 'MM_NODE_LIMIT' })
      )
    })

    it('超过节点数上限抛 MM_NODE_LIMIT', () => {
      const lines = ['# 根', ...Array.from({ length: 5000 }, (_, i) => `- N${i}`)]
      expect(() => importMarkdown(lines.join('\n'), sequentialIds())).toThrowError(
        expect.objectContaining({ code: 'MM_NODE_LIMIT' })
      )
    })
  })

  describe('exportMarkdown', () => {
    it('根/一级用标题，深层用缩进列表并输出备注与链接', () => {
      const doc = {
        nodeData: {
          id: 'root',
          topic: '根',
          note: '根备注',
          hyperLink: 'https://root.example',
          children: [
            {
              id: 'a',
              topic: 'A',
              note: 'A备注',
              children: [
                {
                  id: 'a1',
                  topic: 'A1',
                  hyperLink: 'https://a1.example',
                  children: [{ id: 'a1x', topic: 'A1x' }]
                }
              ]
            }
          ]
        }
      }
      expect(exportMarkdown(doc)).toBe(
        [
          '# 根 [链接](https://root.example)',
          '> 根备注',
          '',
          '## A',
          '> A备注',
          '  - A1 [链接](https://a1.example)',
          '    - A1x',
          ''
        ].join('\n')
      )
    })

    it('导出后可再导入（主题与层级保持）', () => {
      const doc = {
        nodeData: {
          id: 'root',
          topic: '根',
          children: [{ id: 'a', topic: 'A', children: [{ id: 'b', topic: 'B' }] }]
        }
      }
      const { data } = importMarkdown(exportMarkdown(doc), sequentialIds())
      expect(data.nodeData.topic).toBe('根')
      expect(data.nodeData.children?.[0]?.topic).toBe('A')
      expect(data.nodeData.children?.[0]?.children?.[0]?.topic).toBe('B')
    })
  })
})
