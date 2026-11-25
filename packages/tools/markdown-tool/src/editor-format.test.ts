/**
 * @file Markdown 工具栏格式化纯函数单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖 wrap toggle、行前缀整行处理、代码块/表格/链接模板与越界选区钳制。
 */
import { describe, expect, it } from 'vitest'
import { applyFormat, TABLE_TEMPLATE } from './editor-format'

/**
 * 把变更应用到原始正文，返回新正文与新选区
 * @param content 原始正文
 * @param from 选区起点
 * @param to 选区终点
 * @param command 命令
 */
function run(
  content: string,
  from: number,
  to: number,
  command: Parameters<typeof applyFormat>[3]
): { text: string; selection: string } {
  const change = applyFormat(content, from, to, command)
  const text = `${content.slice(0, change.from)}${change.insert}${content.slice(change.to)}`
  return { text, selection: text.slice(change.selectionFrom, change.selectionTo) }
}

describe('applyFormat wrap 类', () => {
  it('无选中时插入标记对并把光标放在中间', () => {
    const change = applyFormat('', 0, 0, 'bold')
    expect(change.insert).toBe('****')
    expect(change.selectionFrom).toBe(2)
    expect(change.selectionTo).toBe(2)
  })

  it('选中文本包裹为粗体，再次执行可去掉', () => {
    expect(run('abc', 0, 3, 'bold')).toEqual({ text: '**abc**', selection: 'abc' })
    expect(run('**abc**', 0, 7, 'bold')).toEqual({ text: 'abc', selection: 'abc' })
  })

  it('斜体/删除线/行内代码使用各自标记', () => {
    expect(run('abc', 0, 3, 'italic').text).toBe('*abc*')
    expect(run('abc', 0, 3, 'strikethrough').text).toBe('~~abc~~')
    expect(run('abc', 0, 3, 'inline-code').text).toBe('`abc`')
  })
})

describe('applyFormat 行前缀类', () => {
  it('标题按整行处理，已有标题时去掉', () => {
    expect(run('标题', 0, 2, 'heading').text).toBe('## 标题')
    expect(run('## 标题', 1, 1, 'heading').text).toBe('标题')
  })

  it('引用与无序列表整行加前缀，多行逐行处理', () => {
    expect(run('引文', 1, 1, 'quote').text).toBe('> 引文')
    expect(run('a\nb', 0, 3, 'unordered-list').text).toBe('- a\n- b')
    expect(run('- a\n- b', 0, 7, 'unordered-list').text).toBe('a\nb')
  })

  it('有序列表按行递增编号，再次执行去掉编号', () => {
    expect(run('a\nb', 0, 3, 'ordered-list').text).toBe('1. a\n2. b')
    expect(run('1. a\n2. b', 0, 9, 'ordered-list').text).toBe('a\nb')
  })

  it('任务列表加复选框前缀', () => {
    expect(run('待办', 0, 0, 'task-list').text).toBe('- [ ] 待办')
    expect(run('- [x] 待办', 0, 0, 'task-list').text).toBe('待办')
  })

  it('空行不参与前缀，光标停留在行尾', () => {
    const change = applyFormat('', 0, 0, 'quote')
    expect(change.insert).toBe('> ')
    expect(change.selectionFrom).toBe(2)
    expect(change.selectionTo).toBe(2)
  })
})

describe('applyFormat 代码块/模板类', () => {
  it('选中行包裹代码围栏，再次执行去掉围栏', () => {
    expect(run('const a = 1', 0, 11, 'code-block').text).toBe('```\nconst a = 1\n```')
    expect(run('```\ncode\n```', 0, 12, 'code-block').text).toBe('code')
  })

  it('空行插入代码块并把光标放到围栏内的空行', () => {
    const change = applyFormat('', 0, 0, 'code-block')
    expect(change.insert).toBe('```\n\n```')
    expect(change.selectionFrom).toBe(4)
    expect(change.selectionTo).toBe(4)
  })

  it('空行插入表格模板', () => {
    expect(run('', 0, 0, 'table')).toEqual({ text: TABLE_TEMPLATE, selection: '' })
  })

  it('非空行插入表格另起一段', () => {
    expect(run('正文', 2, 2, 'table').text).toBe(`正文\n\n${TABLE_TEMPLATE}`)
  })

  it('有选区时表格替换选区', () => {
    expect(run('替换我', 0, 3, 'table').text).toBe(TABLE_TEMPLATE)
  })

  it('分隔线插入 ---', () => {
    expect(run('', 0, 0, 'hr').text).toBe('---')
    expect(run('正文', 0, 0, 'hr').text).toBe('正文\n\n---')
  })
})

describe('applyFormat 链接/图片与越界', () => {
  it('无选中插入链接占位并选中 URL', () => {
    const result = run('', 0, 0, 'link')
    expect(result.text).toBe('[链接文字](https://)')
    expect(result.selection).toBe('https://')
  })

  it('选中文本作为链接文字，URL 仍被选中', () => {
    const result = run('Lumin', 0, 5, 'link')
    expect(result.text).toBe('[Lumin](https://)')
    expect(result.selection).toBe('https://')
  })

  it('图片语法带感叹号', () => {
    const result = run('', 0, 0, 'image')
    expect(result.text).toBe('![图片描述](https://)')
    expect(result.selection).toBe('https://')
  })

  it('越界选区被钳制到正文长度', () => {
    const change = applyFormat('abc', 2, 99, 'bold')
    expect(change.to).toBe(3)
    expect(change.insert).toBe('**c**')
  })

  it('负偏移钳制为 0', () => {
    const change = applyFormat('abc', -5, 1, 'bold')
    expect(change.from).toBe(0)
    expect(change.insert).toBe('**a**')
  })
})
