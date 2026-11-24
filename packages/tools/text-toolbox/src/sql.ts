/**
 * @file SQL 格式化 / 压缩纯函数（自写 tokenizer，零依赖、无 IO）
 * @author cuilanchao
 * @date 2026-11-23
 * @description 保护字符串字面量（'' 转义）、行注释与块注释、反引号标识符与数字；子句关键字换行大写缩进、CASE…END 一级缩进、压缩幂等（spec §7.2）
 */

/** SQL 处理结果：value 为输出文本；warning 为非阻断警告（无警告时为空串） */
export type SqlResult = { value: string; warning: string }

type SqlTokenKind = 'word' | 'literal' | 'comment' | 'number' | 'punct'

type SqlToken = { kind: SqlTokenKind; value: string }

type TokenizeResult = { tokens: SqlToken[]; unclosed: boolean }

/** 未闭合字面量的非阻断警告文案（spec §7.2） */
const UNCLOSED_WARNING = '存在未闭合字面量，已按原文处理'

/** 单词子句关键字（触发换行与缩进并大写） */
const CLAUSE_KEYWORDS = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'JOIN',
  'ON',
  'INSERT',
  'UPDATE',
  'DELETE',
  'SET',
  'VALUES',
  'CREATE',
  'ALTER',
  'DROP',
  'AND',
  'OR',
  'GROUP BY',
  'ORDER BY',
  'UNION ALL',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'FULL JOIN',
  'LEFT OUTER JOIN',
  'RIGHT OUTER JOIN',
  'FULL OUTER JOIN'
])

/** 行内大写的其余关键字（多词短语的组成部分与 THEN 等） */
const INLINE_UPPER_KEYWORDS = new Set(['BY', 'ALL', 'OUTER', 'THEN'])

/** 多词子句关键字（合并为单 token 后整体换行与大写） */
const MULTI_WORD_KEYWORDS: readonly string[][] = [
  ['GROUP', 'BY'],
  ['ORDER', 'BY'],
  ['UNION', 'ALL'],
  ['LEFT', 'JOIN'],
  ['RIGHT', 'JOIN'],
  ['INNER', 'JOIN'],
  ['FULL', 'JOIN'],
  ['LEFT', 'OUTER', 'JOIN'],
  ['RIGHT', 'OUTER', 'JOIN'],
  ['FULL', 'OUTER', 'JOIN']
]

/** 二字操作符（避免拆成两个单字符 token 后被空白隔开） */
const TWO_CHAR_OPERATORS = new Set(['<=', '>=', '<>', '!=', '||', ':=', '->', '::'])

const WORD_START_RE = /[A-Za-z_]/
const WORD_PART_RE = /[0-9A-Za-z_]/
const NUMBER_RE = /[0-9]/
const NUMBER_PART_RE = /[0-9A-Za-z_.]/

/**
 * 扫描引号字面量的结束位置（'' / "" / `` 成对转义）
 * @param sql 源文本
 * @param start 起始引号下标
 * @param quote 引号字符
 * @returns 结束引号后一位；未闭合返回 -1
 */
function scanQuoted(sql: string, start: number, quote: string): number {
  let index = start + 1
  while (index < sql.length) {
    if (sql.charAt(index) === quote) {
      if (sql.charAt(index + 1) === quote) {
        index += 2
        continue
      }
      return index + 1
    }
    index += 1
  }
  return -1
}

/**
 * SQL → token 序列（空白丢弃；字符串 / 注释 / 反引号标识符 / 数字整体保留）
 * @param sql 源文本
 */
function tokenize(sql: string): TokenizeResult {
  const tokens: SqlToken[] = []
  let index = 0
  let unclosed = false
  while (index < sql.length) {
    const char = sql.charAt(index)
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === '-' && sql.charAt(index + 1) === '-') {
      let end = sql.indexOf('\n', index)
      if (end === -1) end = sql.length
      tokens.push({ kind: 'comment', value: sql.slice(index, end) })
      index = end
      continue
    }
    if (char === '/' && sql.charAt(index + 1) === '*') {
      const end = sql.indexOf('*/', index + 2)
      if (end === -1) {
        unclosed = true
        tokens.push({ kind: 'comment', value: sql.slice(index) })
        index = sql.length
        continue
      }
      tokens.push({ kind: 'comment', value: sql.slice(index, end + 2) })
      index = end + 2
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      const end = scanQuoted(sql, index, char)
      if (end === -1) {
        unclosed = true
        tokens.push({ kind: 'literal', value: sql.slice(index) })
        index = sql.length
        continue
      }
      tokens.push({ kind: 'literal', value: sql.slice(index, end) })
      index = end
      continue
    }
    if (NUMBER_RE.test(char)) {
      let end = index
      while (end < sql.length && NUMBER_PART_RE.test(sql.charAt(end))) end += 1
      tokens.push({ kind: 'number', value: sql.slice(index, end) })
      index = end
      continue
    }
    if (WORD_START_RE.test(char)) {
      let end = index + 1
      while (end < sql.length && WORD_PART_RE.test(sql.charAt(end))) end += 1
      tokens.push({ kind: 'word', value: sql.slice(index, end) })
      index = end
      continue
    }
    const pair = sql.slice(index, index + 2)
    if (TWO_CHAR_OPERATORS.has(pair)) {
      tokens.push({ kind: 'punct', value: pair })
      index += 2
      continue
    }
    tokens.push({ kind: 'punct', value: char })
    index += 1
  }
  return { tokens, unclosed }
}

/**
 * 将多词子句关键字合并为单个 word token（其余 token 原样保留）
 * @param tokens 原始 token 序列
 */
function mergeMultiWord(tokens: SqlToken[]): SqlToken[] {
  const merged: SqlToken[] = []
  let skipUntil = -1
  for (const [index, token] of tokens.entries()) {
    if (index <= skipUntil) continue
    if (token.kind === 'word') {
      const following = tokens.slice(index + 1, index + 3)
      const uppers = [
        token.value.toUpperCase(),
        ...following.map((next) => (next.kind === 'word' ? next.value.toUpperCase() : ''))
      ]
      const phrase = MULTI_WORD_KEYWORDS.find(
        (words) =>
          words.length <= uppers.length && words.every((word, offset) => uppers[offset] === word)
      )
      if (phrase !== undefined) {
        merged.push({ kind: 'word', value: phrase.join(' ') })
        skipUntil = index + phrase.length - 1
        continue
      }
    }
    merged.push(token)
  }
  return merged
}

/**
 * 行内相邻 token 是否补空格（括号 / 逗号 / 分号 / 右括号 / 点按 SQL 书写习惯收口）
 * @param previous 前一 token 末字符
 * @param token 当前 token
 */
function needSpaceBefore(previous: string, token: SqlToken): boolean {
  const first = token.value.charAt(0)
  if (first === ',' || first === ')' || first === ';' || first === '.' || first === '(') {
    return false
  }
  if (previous === '(' || previous === '.') return false
  return true
}

/**
 * 格式化 token 序列（子句关键字换行 + 大写 + 2 空格缩进；CASE…END 一级缩进）
 * @param tokens 已合并多词关键字的 token 序列
 */
function formatTokens(tokens: SqlToken[]): string {
  let output = ''
  let lineHasContent = false
  let pendingBreak = false
  let depth = 0

  /** 起新行：当前行有内容或行注释待断行时换行并写入缩进 */
  function startNewLine(level: number): void {
    if (lineHasContent || pendingBreak) {
      output += `\n${'  '.repeat(level)}`
      lineHasContent = false
    }
    pendingBreak = false
  }

  /** 行注释后的强制断行（行内 token 用） */
  function flushPending(): void {
    if (pendingBreak) startNewLine(depth)
  }

  /** 追加文本：行首不补空格，行中按需补一个空格 */
  function push(text: string, space: boolean): void {
    if (lineHasContent && space) output += ' '
    output += text
    lineHasContent = true
  }

  for (const token of tokens) {
    if (token.kind === 'comment') {
      flushPending()
      push(token.value, needSpaceBefore(output.slice(-1), token))
      if (token.value.startsWith('--')) pendingBreak = true
      continue
    }
    if (token.kind === 'word') {
      const upper = token.value.toUpperCase()
      if (CLAUSE_KEYWORDS.has(upper)) {
        startNewLine(upper === 'AND' || upper === 'OR' ? depth + 1 : depth)
        push(upper, false)
        continue
      }
      if (upper === 'WHEN' || upper === 'ELSE') {
        startNewLine(depth)
        push(upper, false)
        continue
      }
      if (upper === 'END') {
        if (depth > 0) depth -= 1
        startNewLine(depth)
        push(upper, false)
        continue
      }
      if (upper === 'CASE') {
        flushPending()
        push(upper, needSpaceBefore(output.slice(-1), token))
        depth += 1
        continue
      }
      flushPending()
      push(
        INLINE_UPPER_KEYWORDS.has(upper) ? upper : token.value,
        needSpaceBefore(output.slice(-1), token)
      )
      continue
    }
    flushPending()
    push(token.value, needSpaceBefore(output.slice(-1), token))
  }
  return output
}

/**
 * 压缩 token 序列（空白折叠为单空格；行注释后保留换行，字面量原样保留）
 * @param tokens 原始 token 序列
 */
function minifyTokens(tokens: SqlToken[]): string {
  let output = ''
  let lineHasContent = false
  let pendingBreak = false
  for (const token of tokens) {
    if (pendingBreak) {
      output += '\n'
      lineHasContent = false
      pendingBreak = false
    }
    if (lineHasContent && needSpaceBefore(output.slice(-1), token)) output += ' '
    output += token.value
    lineHasContent = true
    if (token.kind === 'comment' && token.value.startsWith('--')) pendingBreak = true
  }
  return output
}

/**
 * SQL 美化：子句关键字换行 + 大写 + 2 空格缩进；未闭合字面量按原文保留并带警告
 * @param sql 源 SQL 文本
 */
export function formatSql(sql: string): SqlResult {
  const { tokens, unclosed } = tokenize(sql)
  if (unclosed) return { value: sql, warning: UNCLOSED_WARNING }
  return { value: formatTokens(mergeMultiWord(tokens)), warning: '' }
}

/**
 * SQL 压缩：空白折叠为单空格；未闭合字面量按原文保留并带警告
 * @param sql 源 SQL 文本
 */
export function minifySql(sql: string): SqlResult {
  const { tokens, unclosed } = tokenize(sql)
  if (unclosed) return { value: sql, warning: UNCLOSED_WARNING }
  return { value: minifyTokens(tokens), warning: '' }
}
