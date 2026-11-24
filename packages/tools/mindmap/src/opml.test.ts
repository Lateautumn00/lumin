/**
 * @file OPML 导入/导出单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖 XML 转义、outline 渲染、outlinesToDocument 多根/截断、importOpml 的 DOM 分支。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_DEPTH } from './contract'
import { escapeXml, exportOpml, importOpml, outlinesToDocument, type OutlineNode } from './opml'

/** 顺序 id 生成器 */
function sequentialIds(): () => string {
  let index = 0
  return () => {
    index += 1
    return `id-${index}`
  }
}

/** 伪属性集合（仅实现 getNamedItem） */
class FakeAttributes {
  private readonly map: Record<string, string>

  constructor(map: Record<string, string>) {
    this.map = map
  }

  getNamedItem(name: string): { nodeValue: string | null } | null {
    const value = this.map[name]
    return value === undefined ? null : { nodeValue: value }
  }
}

/** 伪 DOM 元素（tagName/attributes/children 足够 elementToOutline 使用） */
class FakeElement {
  readonly tagName: string
  readonly attributes: FakeAttributes
  readonly children: FakeElement[]

  constructor(tagName: string, attrs: Record<string, string> = {}, children: FakeElement[] = []) {
    this.tagName = tagName
    this.attributes = new FakeAttributes(attrs)
    this.children = children
  }

  getElementsByTagName(name: string): FakeElement[] {
    const found: FakeElement[] = []
    for (const child of this.children) {
      if (child.tagName.toLowerCase() === name.toLowerCase()) found.push(child)
      found.push(...child.getElementsByTagName(name))
    }
    return found
  }
}

/** 伪 Document（querySelector / getElementsByTagName / documentElement） */
class FakeDocument {
  readonly documentElement: FakeElement
  private readonly parserError: boolean
  private readonly bodies: FakeElement[]

  constructor(
    documentElement: FakeElement,
    options: { parserError?: boolean; bodies?: FakeElement[] } = {}
  ) {
    this.documentElement = documentElement
    this.parserError = options.parserError === true
    this.bodies = options.bodies ?? []
  }

  querySelector(selector: string): FakeElement | null {
    return this.parserError && selector === 'parsererror' ? new FakeElement('parsererror') : null
  }

  getElementsByTagName(name: string): FakeElement[] {
    return name === 'body' ? this.bodies : []
  }
}

/** 安装伪 DOMParser */
function stubDomParser(document: FakeDocument): void {
  class StubParser {
    parseFromString(): FakeDocument {
      return document
    }
  }
  vi.stubGlobal('DOMParser', StubParser)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('opml', () => {
  it('escapeXml 转义五个 XML 特殊字符', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;')
  })

  describe('exportOpml', () => {
    it('自闭合叶子、嵌套节点、备注/链接/折叠标记', () => {
      const xml = exportOpml({
        nodeData: {
          id: 'root',
          topic: '根 & <标题>',
          note: '备注"一"',
          hyperLink: 'https://a.com/?a=1&b=2',
          expanded: false,
          children: [{ id: 'a', topic: 'A' }]
        }
      })
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(xml).toContain('<title>根 &amp; &lt;标题&gt;</title>')
      expect(xml).toContain('text="根 &amp; &lt;标题&gt;"')
      expect(xml).toContain('_note="备注&quot;一&quot;"')
      expect(xml).toContain('url="https://a.com/?a=1&amp;b=2"')
      expect(xml).toContain('_expanded="false"')
      expect(xml).toContain('<outline text="A" />')
    })
  })

  describe('outlinesToDocument', () => {
    it('单根：保留备注/链接/折叠与子节点', () => {
      const { data } = outlinesToDocument(
        [
          {
            text: '根',
            note: '备注',
            url: 'https://a.com',
            expanded: false,
            children: [{ text: '子', children: [] }]
          }
        ],
        sequentialIds()
      )
      expect(data.nodeData.topic).toBe('根')
      expect(data.nodeData.note).toBe('备注')
      expect(data.nodeData.hyperLink).toBe('https://a.com')
      expect(data.nodeData.expanded).toBe(false)
      expect(data.nodeData.children?.[0]?.topic).toBe('子')
    })

    it('空标题回退「未命名」', () => {
      const { data } = outlinesToDocument([{ text: '   ', children: [] }], sequentialIds())
      expect(data.nodeData.topic).toBe('未命名')
    })

    it('多顶层归入虚拟根并告警', () => {
      const { data, warnings } = outlinesToDocument(
        [
          { text: '甲', children: [] },
          { text: '乙', children: [] }
        ],
        sequentialIds()
      )
      expect(data.nodeData.topic).toBe('导入导图')
      expect(data.nodeData.children?.map((node) => node.topic)).toEqual(['甲', '乙'])
      expect(warnings).toContain('检测到多个顶层节点，已归入「导入导图」')
    })

    it('空列表抛 MM_IMPORT_INVALID', () => {
      expect(() => outlinesToDocument([], sequentialIds())).toThrowError(
        expect.objectContaining({ code: 'MM_IMPORT_INVALID' })
      )
    })

    it('超深截断并告警', () => {
      const root: OutlineNode = { text: 'L1', children: [] }
      let current = root
      for (let level = 2; level <= MAX_DEPTH + 1; level += 1) {
        const child: OutlineNode = { text: `L${level}`, children: [] }
        current.children.push(child)
        current = child
      }
      const { warnings } = outlinesToDocument([root], sequentialIds())
      expect(warnings).toContain('层级超过上限，已截断')
    })

    it('超量截断并告警', () => {
      const children = Array.from({ length: 5001 }, (_, i) => ({
        text: `N${i}`,
        children: []
      }))
      const { data, warnings } = outlinesToDocument([{ text: '根', children }], sequentialIds())
      expect(warnings).toContain('节点数超过上限，已截断')
      expect(data.nodeData.children?.length).toBe(4999)
    })
  })

  describe('importOpml', () => {
    it('无 DOMParser 时抛 MM_IMPORT_INVALID', () => {
      expect(() => importOpml('<opml />', sequentialIds())).toThrowError(
        expect.objectContaining({ code: 'MM_IMPORT_INVALID', detail: 'DOMParser 不可用' })
      )
    })

    it('parsererror 时抛 MM_IMPORT_INVALID', () => {
      stubDomParser(new FakeDocument(new FakeElement('opml'), { parserError: true }))
      expect(() => importOpml('<opml>', sequentialIds())).toThrowError(
        expect.objectContaining({ code: 'MM_IMPORT_INVALID' })
      )
    })

    it('解析 body 下的 outline（text/title 回退、_note/url/_expanded）', () => {
      const child = new FakeElement('outline', { text: '子', _expanded: 'false' })
      const first = new FakeElement(
        'outline',
        { title: '甲', _note: '备注', url: 'https://a.com' },
        [child, new FakeElement('note', { text: '忽略' })]
      )
      const second = new FakeElement('outline', { text: '乙' })
      const body = new FakeElement('body', {}, [first, second])
      const doc = new FakeDocument(new FakeElement('opml', {}, [body]), { bodies: [body] })
      stubDomParser(doc)

      const { data } = importOpml('<opml />', sequentialIds())
      expect(data.nodeData.topic).toBe('导入导图')
      const [a, b] = data.nodeData.children ?? []
      expect(a?.topic).toBe('甲')
      expect(a?.note).toBe('备注')
      expect(a?.hyperLink).toBe('https://a.com')
      expect(a?.children?.[0]?.topic).toBe('子')
      expect(a?.children?.[0]?.expanded).toBe(false)
      expect(b?.topic).toBe('乙')
    })

    it('缺少 body 时回退 documentElement 的子节点', () => {
      const outline = new FakeElement('outline', { text: '根' })
      const doc = new FakeDocument(new FakeElement('opml', {}, [outline]))
      stubDomParser(doc)
      const { data } = importOpml('<opml />', sequentialIds())
      expect(data.nodeData.topic).toBe('根')
    })

    it('没有任何 outline 时抛 MM_IMPORT_INVALID', () => {
      const doc = new FakeDocument(new FakeElement('opml', {}, []))
      stubDomParser(doc)
      expect(() => importOpml('<opml />', sequentialIds())).toThrowError(
        expect.objectContaining({ code: 'MM_IMPORT_INVALID' })
      )
    })
  })
})
