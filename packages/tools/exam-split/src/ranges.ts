/**
 * @file ranges.ts 页码区间解析（exam-split 薄包装）
 * @author cuilanchao
 * @date 2026-11-16
 * @description 解析实现已上提至 @lumin/shared（跨工具共用）；本文件只负责把
 *              RangeResult 映射为本工具的 RANGE_INVALID 结构化错误，对外签名不变。
 */
import {
  parsePageList,
  parseRangeGroups,
  toRangeList,
  rangeLabel,
  type PageRange,
  type RangeFailure
} from '@lumin/shared'
import { toolError } from './errors'

/** 解析后的单个区间（1-based，闭区间） */
export type { PageRange }
export { toRangeList, rangeLabel }

/** 失败原因 → detail（区间重叠沿用 `overlap`，其余给出出错片段） */
function failureDetail(reason: RangeFailure, token: string): string {
  return reason === 'overlap' ? 'overlap' : token
}

/**
 * 解析为页码列表（删页/旋转/裁剪）：1-based 升序去重（spec §1 语法 `1-3,5,7-9`）。
 * `allowEmpty`：空文本返回 null（旋转/裁剪 = 全部页）；删页必填由 schema 保证。
 * 语法错、越界（>页数）、无有效页码 → RANGE_INVALID。
 */
export function parsePages(
  text: string,
  pageCount: number,
  options: { allowEmpty?: boolean } = {}
): number[] | null {
  const result = parsePageList(text, pageCount, options)
  if (!result.ok) throw toolError('RANGE_INVALID', failureDetail(result.reason, result.token))
  return result.value
}

/**
 * 解析拆分区间：每个逗号段产出一个文件（保持书写顺序），段内页码升序。
 * 区间互相重叠 → RANGE_INVALID（detail=`overlap`）；语法错/越界同 parsePages。
 */
export function parseSplitRanges(text: string, pageCount: number): number[][] {
  const result = parseRangeGroups(text, pageCount)
  if (!result.ok) throw toolError('RANGE_INVALID', failureDetail(result.reason, result.token))
  return result.value
}
