/**
 * @file 文本对比纯函数（行级 LCS + 变更行字符级 LCS；全部同步、无随机、易测）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 行级对比（支持忽略空白/大小写）、差异统计、统一 diff 文本生成与行内字符级对比；
 *              超出单元格预算时降级为「整块删除 + 整块插入」，保证大文本下仍为有界耗时。
 */

/** 单侧行数上限 */
export const DIFF_LINE_LIMIT = 20_000

/** 单侧字符数上限 */
export const DIFF_CHAR_LIMIT = 1_000_000

/** 行级 LCS 单元格预算（约 16MB Uint32Array） */
export const DIFF_LCS_MAX_CELLS = 4_000_000

/** 行内字符级 LCS 单元格预算 */
export const INLINE_LCS_MAX_CELLS = 1_000_000

/** 行内字符级对比的单行字符上限（超出直接整行替换） */
export const INLINE_CHAR_LIMIT = 2_000

/** 对比选项 */
export interface DiffOptions {
  /** 忽略空白：去除全部空白字符后比较（与 git diff -w 同口径） */
  ignoreWhitespace: boolean
  /** 忽略大小写：转小写后比较 */
  ignoreCase: boolean
}

/** 行变更类型 */
export type LineChangeType = 'equal' | 'insert' | 'delete'

/** 单行对比结果（行号为 1 基，缺失侧为 null） */
export interface LineChange {
  type: LineChangeType
  text: string
  leftLine: number | null
  rightLine: number | null
}

/** 差异统计 */
export interface DiffStats {
  added: number
  removed: number
  unchanged: number
}

/** 行内片段类型 */
export interface InlineSegment {
  type: LineChangeType
  text: string
}

/** 统一结果形状（失败带中文 message，UI 映射为结构化错误码） */
export type DiffResult<T> = { ok: true; value: T } | { ok: false; message: string }

/** 内部编辑操作（与 LineChange 解耦，便于 LCS 复用） */
interface EditOp {
  type: LineChangeType
  value: string
}

/**
 * 拆分文本为行（兼容 CRLF/CR/LF；末尾换行不产生空行）
 * @param text 原始文本
 */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r\n|\r|\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * 生成用于比较的归一化行（仅影响比较，不影响展示文本）
 * @param line 原始行
 * @param options 对比选项
 */
export function normalizeLine(line: string, options: DiffOptions): string {
  let result = options.ignoreWhitespace ? line.replace(/\s+/g, '') : line
  if (options.ignoreCase) result = result.toLowerCase()
  return result
}

/** 取数组元素（越界回退空串，避免非空断言） */
function at(items: readonly string[], index: number): string {
  return items[index] ?? ''
}

/**
 * LCS 动态规划求编辑操作；超出单元格预算返回 null（由调用方降级）
 * @param a 左侧序列
 * @param b 右侧序列
 * @param maxCells 单元格上限
 */
function lcsDiff(a: readonly string[], b: readonly string[], maxCells: number): EditOp[] | null {
  const n = a.length
  const m = b.length
  if ((n + 1) * (m + 1) > maxCells) return null

  const width = m + 1
  const dp = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const cell =
        at(a, i) === at(b, j)
          ? (dp[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(dp[(i + 1) * width + j] ?? 0, dp[i * width + j + 1] ?? 0)
      dp[i * width + j] = cell
    }
  }

  const ops: EditOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (at(a, i) === at(b, j)) {
      ops.push({ type: 'equal', value: at(a, i) })
      i += 1
      j += 1
    } else if ((dp[(i + 1) * width + j] ?? 0) >= (dp[i * width + j + 1] ?? 0)) {
      ops.push({ type: 'delete', value: at(a, i) })
      i += 1
    } else {
      ops.push({ type: 'insert', value: at(b, j) })
      j += 1
    }
  }
  while (i < n) {
    ops.push({ type: 'delete', value: at(a, i) })
    i += 1
  }
  while (j < m) {
    ops.push({ type: 'insert', value: at(b, j) })
    j += 1
  }
  return ops
}

/** 降级策略：公共前后缀之外整块删除再整块插入 */
function coarseDiff(a: readonly string[], b: readonly string[]): EditOp[] {
  return [
    ...a.map((value): EditOp => ({ type: 'delete', value })),
    ...b.map((value): EditOp => ({ type: 'insert', value }))
  ]
}

/**
 * 行级对比（先剥离公共前后缀，再对中段做 LCS；超预算自动降级）
 * @param leftText 左侧文本
 * @param rightText 右侧文本
 * @param options 对比选项
 */
export function diffLines(
  leftText: string,
  rightText: string,
  options: DiffOptions
): DiffResult<LineChange[]> {
  const leftLines = splitLines(leftText)
  const rightLines = splitLines(rightText)

  if (leftLines.length > DIFF_LINE_LIMIT || rightLines.length > DIFF_LINE_LIMIT) {
    return { ok: false, message: `单侧行数不能超过 ${DIFF_LINE_LIMIT}` }
  }
  if (leftText.length > DIFF_CHAR_LIMIT || rightText.length > DIFF_CHAR_LIMIT) {
    return { ok: false, message: `单侧字符数不能超过 ${DIFF_CHAR_LIMIT}` }
  }

  const leftKeys = leftLines.map((line) => normalizeLine(line, options))
  const rightKeys = rightLines.map((line) => normalizeLine(line, options))

  let start = 0
  while (
    start < leftKeys.length &&
    start < rightKeys.length &&
    at(leftKeys, start) === at(rightKeys, start)
  ) {
    start += 1
  }
  let endLeft = leftKeys.length - 1
  let endRight = rightKeys.length - 1
  while (
    endLeft >= start &&
    endRight >= start &&
    at(leftKeys, endLeft) === at(rightKeys, endRight)
  ) {
    endLeft -= 1
    endRight -= 1
  }

  const middleLeft = leftKeys.slice(start, endLeft + 1)
  const middleRight = rightKeys.slice(start, endRight + 1)
  const ops =
    lcsDiff(middleLeft, middleRight, DIFF_LCS_MAX_CELLS) ?? coarseDiff(middleLeft, middleRight)

  const changes: LineChange[] = []
  let leftNo = 1
  let rightNo = 1
  for (let i = 0; i < start; i += 1) {
    changes.push({ type: 'equal', text: at(leftLines, i), leftLine: leftNo, rightLine: rightNo })
    leftNo += 1
    rightNo += 1
  }

  let leftIndex = 0
  let rightIndex = 0
  for (const op of ops) {
    if (op.type === 'equal') {
      changes.push({
        type: 'equal',
        text: at(leftLines, start + leftIndex),
        leftLine: leftNo,
        rightLine: rightNo
      })
      leftIndex += 1
      rightIndex += 1
      leftNo += 1
      rightNo += 1
    } else if (op.type === 'delete') {
      changes.push({
        type: 'delete',
        text: at(leftLines, start + leftIndex),
        leftLine: leftNo,
        rightLine: null
      })
      leftIndex += 1
      leftNo += 1
    } else {
      changes.push({
        type: 'insert',
        text: at(rightLines, start + rightIndex),
        leftLine: null,
        rightLine: rightNo
      })
      rightIndex += 1
      rightNo += 1
    }
  }

  for (let i = endLeft + 1; i < leftLines.length; i += 1) {
    changes.push({ type: 'equal', text: at(leftLines, i), leftLine: leftNo, rightLine: rightNo })
    leftNo += 1
    rightNo += 1
  }

  return { ok: true, value: changes }
}

/**
 * 统计新增/删除/未变行数
 * @param changes 行级对比结果
 */
export function diffStats(changes: readonly LineChange[]): DiffStats {
  let added = 0
  let removed = 0
  let unchanged = 0
  for (const change of changes) {
    if (change.type === 'insert') added += 1
    else if (change.type === 'delete') removed += 1
    else unchanged += 1
  }
  return { added, removed, unchanged }
}

/**
 * 生成统一 diff 文本（头部 + 前缀行；无差异返回空串）
 * @param changes 行级对比结果
 * @param leftLabel 左侧标题
 * @param rightLabel 右侧标题
 */
export function toUnifiedDiff(
  changes: readonly LineChange[],
  leftLabel = '左侧',
  rightLabel = '右侧'
): string {
  const hasChange = changes.some((change) => change.type !== 'equal')
  if (!hasChange) return ''
  const body = changes.map((change) => {
    const prefix = change.type === 'insert' ? '+' : change.type === 'delete' ? '-' : ' '
    return `${prefix}${change.text}`
  })
  return [`--- ${leftLabel}`, `+++ ${rightLabel}`, ...body].join('\n')
}

/** 追加片段（相邻同类型合并） */
function pushSegment(segments: InlineSegment[], type: LineChangeType, text: string): void {
  if (text === '') return
  const last = segments[segments.length - 1]
  if (last !== undefined && last.type === type) {
    last.text += text
    return
  }
  segments.push({ type, text })
}

/**
 * 行内字符级对比（按码点；先剥离公共前后缀，超预算整行替换）
 * @param left 左侧行文本
 * @param right 右侧行文本
 */
export function diffChars(left: string, right: string): InlineSegment[] {
  const a = Array.from(left)
  const b = Array.from(right)
  if (a.length > INLINE_CHAR_LIMIT || b.length > INLINE_CHAR_LIMIT) {
    return [
      { type: 'delete', text: left },
      { type: 'insert', text: right }
    ]
  }

  let start = 0
  while (start < a.length && start < b.length && at(a, start) === at(b, start)) start += 1
  let endA = a.length - 1
  let endB = b.length - 1
  while (endA >= start && endB >= start && at(a, endA) === at(b, endB)) {
    endA -= 1
    endB -= 1
  }

  const middleA = a.slice(start, endA + 1)
  const middleB = b.slice(start, endB + 1)
  const ops = lcsDiff(middleA, middleB, INLINE_LCS_MAX_CELLS) ?? coarseDiff(middleA, middleB)

  const segments: InlineSegment[] = []
  pushSegment(segments, 'equal', a.slice(0, start).join(''))
  for (const op of ops) pushSegment(segments, op.type, op.value)
  pushSegment(segments, 'equal', a.slice(endA + 1).join(''))
  return segments
}

/**
 * 行内片段 → 单侧展示文本（左侧剔除 insert，右侧剔除 delete）
 * @param segments 行内片段
 * @param side 展示侧
 */
export function sideSegments(
  segments: readonly InlineSegment[],
  side: 'left' | 'right'
): InlineSegment[] {
  const hidden: LineChangeType = side === 'left' ? 'insert' : 'delete'
  return segments.filter((segment) => segment.type !== hidden)
}

/**
 * 行变更类型 → 统一 diff 前缀
 * @param type 行变更类型
 */
export function prefixOf(type: LineChangeType): string {
  if (type === 'insert') return '+'
  if (type === 'delete') return '-'
  return ' '
}
