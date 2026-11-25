/**
 * @file Markdown 工具栏格式化纯函数
 * @author cuilanchao
 * @date 2026-11-24
 * @description 输入正文与选区（0 基字符偏移），输出最小文本变更与新选区：
 *              wrap 类（粗体/斜体/删除线/行内代码）支持 toggle；
 *              行前缀类（标题/引用/列表/任务列表）按整行处理；
 *              代码块/表格/分隔线/链接/图片按模板插入。无 DOM 依赖，便于单测。
 */
export type MarkdownFormatCommand =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'inline-code'
  | 'heading'
  | 'quote'
  | 'unordered-list'
  | 'ordered-list'
  | 'task-list'
  | 'code-block'
  | 'link'
  | 'image'
  | 'table'
  | 'hr'

/** 最小文本变更 + 新选区（直接映射 CodeMirror dispatch 参数） */
export interface FormatChange {
  from: number
  to: number
  insert: string
  selectionFrom: number
  selectionTo: number
}

/** 表格模板（手写，不引第三方表格插件） */
export const TABLE_TEMPLATE = ['| 列 1 | 列 2 |', '| --- | --- |', '| 内容 | 内容 |'].join('\n')

/** 行内包裹命令 → 标记 */
const WRAP_MARKERS: Partial<Record<MarkdownFormatCommand, string>> = {
  bold: '**',
  italic: '*',
  strikethrough: '~~',
  'inline-code': '`'
}

/** 行前缀参数 */
interface PrefixOptions {
  /** 新增时使用的前缀 */
  prefix: string
  /** 有序列表按行递增编号 */
  ordered?: boolean
  /** 额外视为「已有前缀」的写法（toggle 去除用） */
  alternatives?: string[]
  /** 正则形式的已有前缀（有序列表 `1. ` 等） */
  pattern?: RegExp
}

/**
 * 行首偏移
 * @param content 正文
 * @param position 任意偏移
 */
function lineStartOf(content: string, position: number): number {
  const index = content.lastIndexOf('\n', position - 1)
  return index === -1 ? 0 : index + 1
}

/**
 * 行尾偏移（不含换行符）
 * @param content 正文
 * @param position 任意偏移
 */
function lineEndOf(content: string, position: number): number {
  const index = content.indexOf('\n', position)
  return index === -1 ? content.length : index
}

/**
 * 行内包裹（已有同款标记则视为 toggle 去掉）
 * @param content 正文
 * @param from 选区起点
 * @param to 选区终点
 * @param marker 包裹标记
 */
function applyWrap(content: string, from: number, to: number, marker: string): FormatChange {
  const selected = content.slice(from, to)
  if (
    selected.length >= marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(marker.length, selected.length - marker.length)
    return { from, to, insert: inner, selectionFrom: from, selectionTo: from + inner.length }
  }
  return {
    from,
    to,
    insert: `${marker}${selected}${marker}`,
    selectionFrom: from + marker.length,
    selectionTo: from + marker.length + selected.length
  }
}

/**
 * 判断行是否已带前缀
 * @param line 单行文本
 * @param patterns 字面前缀集合
 * @param pattern 正则前缀
 */
function hasPrefix(line: string, patterns: string[], pattern?: RegExp): boolean {
  if (line.trim() === '') return false
  if (patterns.some((item) => line.startsWith(item))) return true
  return pattern !== undefined && pattern.test(line)
}

/**
 * 去掉行首已知前缀
 * @param line 单行文本
 * @param patterns 字面前缀集合
 * @param pattern 正则前缀
 */
function stripPrefix(line: string, patterns: string[], pattern?: RegExp): string {
  for (const item of patterns) {
    if (line.startsWith(item)) return line.slice(item.length)
  }
  const matched = pattern?.exec(line)
  if (matched === null || matched === undefined) return line
  return line.slice(matched[0].length)
}

/**
 * 行前缀切换（标题/引用/无序列表/有序列表/任务列表）
 * @param content 正文
 * @param from 选区起点
 * @param to 选区终点
 * @param options 前缀参数
 */
function applyLinePrefix(
  content: string,
  from: number,
  to: number,
  options: PrefixOptions
): FormatChange {
  const blockFrom = lineStartOf(content, from)
  const blockTo = lineEndOf(content, to)
  const block = content.slice(blockFrom, blockTo)
  const lines = block.split('\n')
  const patterns = [options.prefix, ...(options.alternatives ?? [])]
  const allPrefixed = lines.every((line) => hasPrefix(line, patterns, options.pattern))
  // 整块为空（如空文档点击「引用」）时仍插入前缀，避免按钮点了没反应
  const blankBlock = block.trim() === ''

  const next: string[] = []
  let order = 1
  for (const line of lines) {
    if (line.trim() === '' && !blankBlock) {
      next.push(line)
      continue
    }
    if (allPrefixed) {
      next.push(stripPrefix(line, patterns, options.pattern))
      continue
    }
    next.push(options.ordered === true ? `${order}. ${line}` : `${options.prefix}${line}`)
    order += 1
  }

  const insert = next.join('\n')
  const end = blockFrom + insert.length
  return {
    from: blockFrom,
    to: blockTo,
    insert,
    selectionFrom: from === to ? end : blockFrom,
    selectionTo: end
  }
}

/**
 * 代码块包裹（首尾 ``` 视为 toggle 去掉）
 * @param content 正文
 * @param from 选区起点
 * @param to 选区终点
 */
function applyCodeBlock(content: string, from: number, to: number): FormatChange {
  const blockFrom = lineStartOf(content, from)
  const blockTo = lineEndOf(content, to)
  const block = content.slice(blockFrom, blockTo)
  const lines = block.split('\n')
  const first = lines[0] ?? ''
  const last = lines[lines.length - 1] ?? ''

  if (lines.length >= 2 && first.trim().startsWith('```') && last.trim() === '```') {
    const inner = lines.slice(1, lines.length - 1).join('\n')
    const end = blockFrom + inner.length
    return {
      from: blockFrom,
      to: blockTo,
      insert: inner,
      selectionFrom: blockFrom,
      selectionTo: end
    }
  }

  const insert = block === '' ? '```\n\n```' : `\`\`\`\n${block}\n\`\`\``
  const end = blockFrom + insert.length
  if (block === '') {
    // 光标落在围栏内的空行
    const cursor = blockFrom + '```\n'.length
    return { from: blockFrom, to: blockTo, insert, selectionFrom: cursor, selectionTo: cursor }
  }
  return {
    from: blockFrom,
    to: blockTo,
    insert,
    selectionFrom: from === to ? end : blockFrom,
    selectionTo: end
  }
}

/**
 * 模板插入（表格/分隔线）：替换选区，或在当前行后另起一段
 * @param content 正文
 * @param from 选区起点
 * @param to 选区终点
 * @param template 模板文本
 */
function applyTemplate(content: string, from: number, to: number, template: string): FormatChange {
  if (from !== to) {
    return {
      from,
      to,
      insert: template,
      selectionFrom: from,
      selectionTo: from + template.length
    }
  }
  const blockFrom = lineStartOf(content, from)
  const blockTo = lineEndOf(content, to)
  const line = content.slice(blockFrom, blockTo)
  if (line.trim() === '') {
    const end = blockFrom + template.length
    return { from: blockFrom, to: blockTo, insert: template, selectionFrom: end, selectionTo: end }
  }
  const insert = `\n\n${template}`
  const end = blockTo + insert.length
  return { from: blockTo, to: blockTo, insert, selectionFrom: end, selectionTo: end }
}

/**
 * 链接/图片插入（默认选中 URL 占位，便于直接粘贴）
 * @param content 正文
 * @param from 选区起点
 * @param to 选区终点
 * @param image 是否为图片
 */
function applyLink(content: string, from: number, to: number, image: boolean): FormatChange {
  const selected = content.slice(from, to)
  const label = selected === '' ? (image ? '图片描述' : '链接文字') : selected
  const marker = image ? '![' : '['
  const insert = `${marker}${label}](https://)`
  const urlFrom = from + marker.length + label.length + 2
  return {
    from,
    to,
    insert,
    selectionFrom: urlFrom,
    selectionTo: urlFrom + 'https://'.length
  }
}

/**
 * 执行格式化命令
 * @param content 正文
 * @param from 选区起点（0 基）
 * @param to 选区终点（0 基，等于 from 表示无选中）
 * @param command 命令
 */
export function applyFormat(
  content: string,
  from: number,
  to: number,
  command: MarkdownFormatCommand
): FormatChange {
  const start = Math.max(0, Math.min(from, content.length))
  const end = Math.max(start, Math.min(to, content.length))

  const marker = WRAP_MARKERS[command]
  if (marker !== undefined) return applyWrap(content, start, end, marker)

  switch (command) {
    case 'heading':
      return applyLinePrefix(content, start, end, {
        prefix: '## ',
        alternatives: ['# ', '### ', '#### ', '##### ', '###### ']
      })
    case 'quote':
      return applyLinePrefix(content, start, end, { prefix: '> ' })
    case 'unordered-list':
      return applyLinePrefix(content, start, end, { prefix: '- ', alternatives: ['* ', '+ '] })
    case 'ordered-list':
      return applyLinePrefix(content, start, end, {
        prefix: '1. ',
        ordered: true,
        pattern: /^\d+\.\s/
      })
    case 'task-list':
      return applyLinePrefix(content, start, end, {
        prefix: '- [ ] ',
        alternatives: ['- [x] ', '- [X] ']
      })
    case 'code-block':
      return applyCodeBlock(content, start, end)
    case 'table':
      return applyTemplate(content, start, end, TABLE_TEMPLATE)
    case 'hr':
      return applyTemplate(content, start, end, '---')
    case 'link':
      return applyLink(content, start, end, false)
    case 'image':
      return applyLink(content, start, end, true)
    default:
      return {
        from: start,
        to: end,
        insert: content.slice(start, end),
        selectionFrom: start,
        selectionTo: end
      }
  }
}
