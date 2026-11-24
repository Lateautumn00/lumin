/**
 * @file 工具搜索纯函数（模糊匹配 + 排序）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 供壳级搜索浮层复用：按工具名 / id / 分类名做大小写无关的模糊匹配，
 *              支持多词（空格分隔）与子序列命中，评分高者靠前；不做任何工具名硬编码。
 */
import type { ToolCategory, ToolManifest } from '@lumin/plugin-api'

/** 搜索结果 */
export interface SearchResult {
  id: string
  name: string
  category: ToolCategory
  /** 匹配得分（越大越相关） */
  score: number
}

/** 搜索选项 */
export interface SearchOptions {
  /** 最多返回条数，默认 8 */
  limit?: number
  /** 分类展示名解析（用于按分类关键词命中，如「图片」） */
  categoryLabel?: (category: ToolCategory) => string
}

/** 单字段基础分权重：工具名 > id > 分类名 */
const FIELD_WEIGHT = { name: 1, id: 0.9, category: 0.6 } as const

/** 按空白拆词（大小写归一） */
function termsOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)
}

/**
 * 单个词对单段文本评分
 * @param term 已小写化的关键词
 * @param target 已小写化的目标文本
 * @returns 得分；不匹配返回 null
 */
function scoreTerm(term: string, target: string): number | null {
  if (target === term) return 1000
  const index = target.indexOf(term)
  if (index === 0) return 900 - Math.min(80, target.length - term.length)
  if (index > 0) return 760 - Math.min(160, index * 12)

  // 子序列匹配：连续命中加分，间隔越大扣分越多
  let position = -1
  let score = 0
  let streak = 0
  for (const char of term) {
    const found = target.indexOf(char, position + 1)
    if (found < 0) return null
    if (found === position + 1) {
      streak += 1
      score += 12 + streak * 3
    } else {
      streak = 0
      score += Math.max(1, 6 - (found - position - 2))
    }
    position = found
  }
  return 300 + Math.min(240, score)
}

/**
 * 整串查询对单段文本评分（多个词需全部命中）
 * @param query 原始查询
 * @param text 目标文本（工具名 / id / 分类名）
 */
export function scoreText(query: string, text: string): number | null {
  const target = text.toLowerCase()
  const terms = termsOf(query)
  if (target === '' || terms.length === 0) return null
  let total = 0
  for (const term of terms) {
    const score = scoreTerm(term, target)
    if (score === null) return null
    total += score
  }
  return total / terms.length
}

/**
 * 搜索工具清单：隐藏工具不参与，得分相同保持清单原顺序
 * @param tools 工具清单（来自壳的 toolManifests）
 * @param query 查询关键词
 * @param options 条数上限 / 分类名解析
 */
export function searchTools(
  tools: readonly ToolManifest[],
  query: string,
  options: SearchOptions = {}
): SearchResult[] {
  const trimmed = query.trim()
  if (trimmed === '') return []
  const limit = options.limit === undefined ? 8 : Math.max(1, options.limit)
  const results: SearchResult[] = []

  for (const tool of tools) {
    if (tool.hidden === true) continue
    const candidates: Array<{ score: number | null; weight: number }> = [
      { score: scoreText(trimmed, tool.name), weight: FIELD_WEIGHT.name },
      { score: scoreText(trimmed, tool.id), weight: FIELD_WEIGHT.id }
    ]
    const label = options.categoryLabel?.(tool.category)
    if (label !== undefined) {
      candidates.push({ score: scoreText(trimmed, label), weight: FIELD_WEIGHT.category })
    }

    let best: number | null = null
    for (const candidate of candidates) {
      if (candidate.score === null) continue
      const weighted = candidate.score * candidate.weight
      if (best === null || weighted > best) best = weighted
    }
    if (best === null) continue
    results.push({
      id: tool.id,
      name: tool.name,
      category: tool.category,
      score: Math.round(best)
    })
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}
