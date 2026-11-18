/**
 * @file regex.ts 单测：匹配收集/分组/零长度/上限截断、替换预览与非法模式
 * @author cuilanchao
 * @date 2026-11-18
 * @description 覆盖 spec §2 正则 Tab 的成功与错误分支
 */
import { describe, expect, it } from 'vitest'
import { collectMatches, compileRegex, replacePreview } from './regex'

describe('compileRegex', () => {
  it('合法模式返回 RegExp', () => {
    const result = compileRegex('\\d+', 'gi')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.flags).toBe('gi')
  })

  it('非法模式 → TT_REGEX_INVALID 且带原生详情', () => {
    const result = compileRegex('(a', 'g')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_REGEX_INVALID')
    expect(result.error.detail?.length).toBeGreaterThan(0)
  })

  it('非法标志 → TT_REGEX_INVALID', () => {
    const result = compileRegex('a', 'gz')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_REGEX_INVALID')
  })
})

describe('collectMatches', () => {
  it('全局模式收集全部匹配与下标', () => {
    const result = collectMatches('\\d+', 'g', 'a1b22c333')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.total).toBe(3)
    expect(result.value.matches.map((match) => [match.index, match.value])).toEqual([
      [1, '1'],
      [3, '22'],
      [6, '333']
    ])
    expect(result.value.truncated).toBe(false)
  })

  it('捕获分组（未参与匹配的分组为空串）', () => {
    const result = collectMatches('(\\w)(\\d)?', 'g', 'a1 b')
    if (!result.ok) throw new Error('期望成功')
    expect(result.value.matches[0]?.groups).toEqual(['a', '1'])
    expect(result.value.matches[1]?.groups).toEqual(['b', ''])
  })

  it('无 g 标志只取首条', () => {
    const result = collectMatches('\\d', '', '1 2 3')
    if (!result.ok) throw new Error('期望成功')
    expect(result.value.total).toBe(1)
    expect(result.value.matches).toHaveLength(1)
  })

  it('零长度匹配不会死循环', () => {
    const result = collectMatches('a*', 'g', 'bb')
    if (!result.ok) throw new Error('期望成功')
    expect(result.value.total).toBe(3)
    expect(result.value.matches.every((match) => match.value === '')).toBe(true)
  })

  it('空模式视为无匹配', () => {
    expect(collectMatches('', 'g', 'abc')).toEqual({
      ok: true,
      value: { matches: [], total: 0, truncated: false }
    })
  })

  it('超过上限截断（total 为已扫描数）', () => {
    const result = collectMatches('\\d', 'g', '123456', 3)
    if (!result.ok) throw new Error('期望成功')
    expect(result.value.matches).toHaveLength(3)
    expect(result.value.truncated).toBe(true)
    expect(result.value.total).toBe(4)
  })

  it('非法模式透传错误', () => {
    const result = collectMatches('(', 'g', 'abc')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_REGEX_INVALID')
  })
})

describe('replacePreview', () => {
  it('全局替换支持 $1 分组', () => {
    const result = replacePreview('(\\d+)', 'g', 'a1b22', '[$1]')
    expect(result).toEqual({
      ok: true,
      value: { result: 'a[1]b[22]', count: 2, truncated: false }
    })
  })

  it('无 g 只替换首条', () => {
    const result = replacePreview('\\d+', '', 'a1b22', 'X')
    if (!result.ok) throw new Error('期望成功')
    expect(result.value.result).toBe('aXb22')
    expect(result.value.count).toBe(1)
  })

  it('支持 $& 整体匹配', () => {
    const result = replacePreview('\\d+', 'g', 'a1b22', '<$&>')
    if (!result.ok) throw new Error('期望成功')
    expect(result.value.result).toBe('a<1>b<22>')
  })

  it('空模式原样返回', () => {
    expect(replacePreview('', 'g', 'abc', 'X')).toEqual({
      ok: true,
      value: { result: 'abc', count: 0, truncated: false }
    })
  })

  it('非法模式透传错误', () => {
    const result = replacePreview('[', 'g', 'abc', 'X')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_REGEX_INVALID')
  })

  it('无匹配（无 g）count 为 0', () => {
    expect(replacePreview('x', '', 'abc', 'Y')).toEqual({
      ok: true,
      value: { result: 'abc', count: 0, truncated: false }
    })
  })

  it('超过计数上限截断（count 为已扫描数）', () => {
    const result = replacePreview('\\d', 'g', '12345', 'X', 2)
    if (!result.ok) throw new Error('期望成功')
    expect(result.value.count).toBe(2)
    expect(result.value.truncated).toBe(true)
  })

  it('零长度匹配替换不死循环', () => {
    const result = replacePreview('a*', 'g', 'bb', '-')
    if (!result.ok) throw new Error('期望成功')
    expect(result.value.count).toBe(3)
    expect(result.value.result).toBe('-b-b-')
  })
})
