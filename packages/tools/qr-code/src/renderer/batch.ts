/**
 * @file 批量识别编排（纯函数，spec M55 ⑨）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 批量条目追加/上限截断、错误归类、汇总统计、TSV 复制文本；
 *              不依赖 DOM 与 File，便于单测直接注入
 */

/** 单批最多图片数（spec M55 ⑨：上限 50，超限不崩溃） */
export const BATCH_LIMIT = 50

/** 批量条目状态 */
export type BatchStatus = '待识别' | '识别中' | '已识别' | '未识别' | '失败'

/** 追加前的条目输入 */
export interface BatchInput<T> {
  name: string
  source: T
}

/** 批量条目（source 为 File） */
export interface BatchItem<T> extends BatchInput<T> {
  id: number
  status: BatchStatus
  text: string
  errorCode?: string
}

/** 追加结果：新列表 + 因超限被忽略的条数 */
export interface BatchAppendResult<T> {
  items: BatchItem<T>[]
  ignored: number
}

/**
 * 追加条目并截断到上限
 * @param existing 现有列表
 * @param additions 新增条目（保持输入顺序）
 * @param limit 上限（默认 50）
 */
export function appendBatchItems<T>(
  existing: readonly BatchItem<T>[],
  additions: readonly BatchInput<T>[],
  limit: number = BATCH_LIMIT
): BatchAppendResult<T> {
  const room = Math.max(0, limit - existing.length)
  const accepted = additions.slice(0, room)
  const nextId = existing.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const appended = accepted.map<BatchItem<T>>((input, index) => ({
    id: nextId + index,
    name: input.name,
    source: input.source,
    status: '待识别',
    text: ''
  }))
  return { items: [...existing, ...appended], ignored: additions.length - accepted.length }
}

/**
 * 解码错误 → 条目状态：`QR_DECODE_FAILED`（无码）归「未识别」，其余归「失败」
 * @param code 结构化错误码
 */
export function batchStatusAfterError(code: string): BatchStatus {
  return code === 'QR_DECODE_FAILED' ? '未识别' : '失败'
}

/** 汇总统计 */
export interface BatchSummary {
  total: number
  pending: number
  recognized: number
  unrecognized: number
  failed: number
}

/**
 * 汇总各状态数量（`识别中` 计入 pending，确保取消后可继续）
 * @param items 批量条目
 */
export function summarizeBatch(items: readonly BatchItem<unknown>[]): BatchSummary {
  const summary: BatchSummary = {
    total: items.length,
    pending: 0,
    recognized: 0,
    unrecognized: 0,
    failed: 0
  }
  for (const item of items) {
    if (item.status === '已识别') summary.recognized += 1
    else if (item.status === '未识别') summary.unrecognized += 1
    else if (item.status === '失败') summary.failed += 1
    else summary.pending += 1
  }
  return summary
}

/** TSV 单元格：制表符/换行折叠为空格，避免破列 */
function tsvCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ')
}

/**
 * 复制全部：文件名 / 识别文本 / 状态（制表符分隔，首行表头）
 * @param items 批量条目
 */
export function batchToTsv(items: readonly BatchItem<unknown>[]): string {
  const rows = [['文件名', '识别文本', '状态']]
  for (const item of items) rows.push([item.name, item.text, item.status])
  return rows.map((cols) => cols.map(tsvCell).join('\t')).join('\n')
}
