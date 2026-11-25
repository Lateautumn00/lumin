import { describe, expect, it } from 'vitest'

import {
  DIFF_CHAR_LIMIT,
  DIFF_LINE_LIMIT,
  INLINE_CHAR_LIMIT,
  WORD_LIMIT,
  diffChars,
  diffLines,
  diffStats,
  diffWords,
  normalizeLine,
  prefixOf,
  sideSegments,
  splitLines,
  tokenizeWords,
  toUnifiedDiff,
  type DiffOptions,
  type LineChange
} from './diff'

const plain: DiffOptions = { ignoreWhitespace: false, ignoreCase: false }

/** 把行级结果压缩成可读断言串 */
function compact(changes: readonly LineChange[]): string[] {
  return changes.map(
    (change) => `${change.type}|${change.text}|${change.leftLine ?? '-'}|${change.rightLine ?? '-'}`
  )
}

describe('splitLines', () => {
  it('空串返回空数组', () => {
    expect(splitLines('')).toEqual([])
  })

  it('兼容 LF / CRLF / CR 且末尾换行不产生空行', () => {
    expect(splitLines('a\nb')).toEqual(['a', 'b'])
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b'])
    expect(splitLines('a\rb')).toEqual(['a', 'b'])
    expect(splitLines('a\n\nb\n')).toEqual(['a', '', 'b'])
  })
})

describe('normalizeLine', () => {
  it('默认原样返回', () => {
    expect(normalizeLine('  A b ', plain)).toBe('  A b ')
  })

  it('忽略空白去除全部空白字符', () => {
    expect(normalizeLine('  A\tb c ', { ...plain, ignoreWhitespace: true })).toBe('Abc')
  })

  it('忽略大小写转小写', () => {
    expect(normalizeLine('AbC', { ...plain, ignoreCase: true })).toBe('abc')
  })
})

describe('diffLines', () => {
  it('识别相同/删除/新增并维护双侧行号', () => {
    const result = diffLines('a\nb\nc', 'a\nB\nc', plain)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(compact(result.value)).toEqual([
      'equal|a|1|1',
      'delete|b|2|-',
      'insert|B|-|2',
      'equal|c|3|3'
    ])
    expect(diffStats(result.value)).toEqual({ added: 1, removed: 1, unchanged: 2 })
  })

  it('完全相同全部为 equal', () => {
    const result = diffLines('x\ny', 'x\ny', plain)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(diffStats(result.value)).toEqual({ added: 0, removed: 0, unchanged: 2 })
  })

  it('左侧为空时全部为新增', () => {
    const result = diffLines('', 'a\nb', plain)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(compact(result.value)).toEqual(['insert|a|-|1', 'insert|b|-|2'])
  })

  it('双侧为空返回空结果', () => {
    const result = diffLines('', '', plain)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual([])
  })

  it('忽略大小写时不同大小写视为相同', () => {
    const result = diffLines('Hello\nWorld', 'hello\nworld', {
      ignoreWhitespace: false,
      ignoreCase: true
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(diffStats(result.value)).toEqual({ added: 0, removed: 0, unchanged: 2 })
    expect(result.value[0]?.text).toBe('Hello')
  })

  it('忽略空白时空白差异视为相同', () => {
    const result = diffLines('a b\nc', 'ab\nc', { ignoreWhitespace: true, ignoreCase: false })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(diffStats(result.value)).toEqual({ added: 0, removed: 0, unchanged: 2 })
  })

  it('兼容 CRLF 与 LF 混用', () => {
    const result = diffLines('a\r\nb\r\n', 'a\nb', plain)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(diffStats(result.value)).toEqual({ added: 0, removed: 0, unchanged: 2 })
  })

  it('行数超限返回失败', () => {
    const many = Array.from({ length: DIFF_LINE_LIMIT + 1 }, () => 'x').join('\n')
    const result = diffLines(many, '', plain)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('行数')
  })

  it('字符数超限返回失败', () => {
    const result = diffLines('x'.repeat(DIFF_CHAR_LIMIT + 1), '', plain)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('字符数')
  })

  it('超出 LCS 单元格预算时降级为整块删除 + 整块插入', () => {
    const left = Array.from({ length: 2001 }, (_, index) => `L${index}`).join('\n')
    const right = Array.from({ length: 2001 }, (_, index) => `R${index}`).join('\n')
    const result = diffLines(left, right, plain)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(diffStats(result.value)).toEqual({ added: 2001, removed: 2001, unchanged: 0 })
  })
})

describe('diffStats', () => {
  it('空结果全为 0', () => {
    expect(diffStats([])).toEqual({ added: 0, removed: 0, unchanged: 0 })
  })
})

describe('toUnifiedDiff', () => {
  it('无差异返回空串', () => {
    const result = diffLines('a', 'a', plain)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(toUnifiedDiff(result.value)).toBe('')
  })

  it('输出头部与 +/-/空格前缀', () => {
    const result = diffLines('a\nb', 'a\nc', plain)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(toUnifiedDiff(result.value).split('\n')).toEqual([
      '--- 左侧',
      '+++ 右侧',
      ' a',
      '-b',
      '+c'
    ])
  })

  it('支持自定义左右标题', () => {
    const result = diffLines('a', 'b', plain)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(toUnifiedDiff(result.value, 'old.txt', 'new.txt')).toContain('--- old.txt')
    expect(toUnifiedDiff(result.value, 'old.txt', 'new.txt')).toContain('+++ new.txt')
  })
})

describe('diffChars', () => {
  it('识别行内等长替换', () => {
    expect(diffChars('abc', 'axc')).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'delete', text: 'b' },
      { type: 'insert', text: 'x' },
      { type: 'equal', text: 'c' }
    ])
  })

  it('完全相同合并为单个 equal 片段', () => {
    expect(diffChars('same', 'same')).toEqual([{ type: 'equal', text: 'same' }])
  })

  it('空串对比', () => {
    expect(diffChars('', 'ab')).toEqual([{ type: 'insert', text: 'ab' }])
    expect(diffChars('ab', '')).toEqual([{ type: 'delete', text: 'ab' }])
    expect(diffChars('', '')).toEqual([])
  })

  it('按码点处理emoji，不拆分代理对', () => {
    expect(diffChars('a😀b', 'a😁b')).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'delete', text: '😀' },
      { type: 'insert', text: '😁' },
      { type: 'equal', text: 'b' }
    ])
  })

  it('超出行内字符上限直接整行替换', () => {
    const left = 'x'.repeat(INLINE_CHAR_LIMIT + 1)
    const right = 'y'.repeat(INLINE_CHAR_LIMIT + 1)
    expect(diffChars(left, right)).toEqual([
      { type: 'delete', text: left },
      { type: 'insert', text: right }
    ])
  })
})

describe('sideSegments', () => {
  it('左侧剔除新增片段，右侧剔除删除片段', () => {
    const segments = [
      { type: 'equal' as const, text: 'a' },
      { type: 'delete' as const, text: 'b' },
      { type: 'insert' as const, text: 'c' }
    ]
    expect(sideSegments(segments, 'left')).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'delete', text: 'b' }
    ])
    expect(sideSegments(segments, 'right')).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'insert', text: 'c' }
    ])
  })
})

describe('prefixOf', () => {
  it('映射统一 diff 前缀', () => {
    expect(prefixOf('equal')).toBe(' ')
    expect(prefixOf('insert')).toBe('+')
    expect(prefixOf('delete')).toBe('-')
  })
})

describe('tokenizeWords（M62 词级分词）', () => {
  it('中英混排：拉丁成词、CJK 逐字、数字成词、空白与符号独立', () => {
    expect(tokenizeWords('Hello世界 123!')).toEqual(['Hello', '世', '界', ' ', '123', '!'])
  })

  it('连续空白保留为独立 token 且串联可还原原串', () => {
    const line = 'a  b\tc'
    expect(tokenizeWords(line)).toEqual(['a', '  ', 'b', '\t', 'c'])
    expect(tokenizeWords(line).join('')).toBe(line)
  })

  it('空串返回空数组', () => {
    expect(tokenizeWords('')).toEqual([])
  })

  it('emoji 按码点成词，不拆分代理对', () => {
    expect(tokenizeWords('👍好')).toEqual(['👍', '好'])
  })
})

describe('diffWords（M62 词级行内对比）', () => {
  it('中英混排公共前后缀保留、中段词级替换', () => {
    expect(diffWords('hello brave world', 'hello new world')).toEqual([
      { type: 'equal', text: 'hello ' },
      { type: 'delete', text: 'brave' },
      { type: 'insert', text: 'new' },
      { type: 'equal', text: ' world' }
    ])
  })

  it('完全相同合并为单个 equal 片段', () => {
    expect(diffWords('你好 hi123', '你好 hi123')).toEqual([{ type: 'equal', text: '你好 hi123' }])
  })

  it('单侧空串', () => {
    expect(diffWords('', 'abc')).toEqual([{ type: 'insert', text: 'abc' }])
    expect(diffWords('abc', '')).toEqual([{ type: 'delete', text: 'abc' }])
    expect(diffWords('', '')).toEqual([])
  })

  it('中段词级 LCS（预算内）', () => {
    expect(diffWords('甲乙丙', '甲乙丁')).toEqual([
      { type: 'equal', text: '甲乙' },
      { type: 'delete', text: '丙' },
      { type: 'insert', text: '丁' }
    ])
  })

  it('单行超过 WORD_LIMIT 词直接整行替换', () => {
    const left = '字'.repeat(WORD_LIMIT + 1)
    const right = '丁'.repeat(WORD_LIMIT + 1)
    expect(diffWords(left, right)).toEqual([
      { type: 'delete', text: left },
      { type: 'insert', text: right }
    ])
  })

  it('词级 LCS 超出单元格预算降级为整词替换（交替序列无公共前后缀）', () => {
    const left = '甲乙'.repeat(500) + '甲'
    const right = '乙甲'.repeat(500) + '乙'
    expect(tokenizeWords(left).length).toBe(1001)
    expect(diffWords(left, right)).toEqual([
      { type: 'delete', text: left },
      { type: 'insert', text: right }
    ])
  })
})
