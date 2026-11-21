/**
 * @file text-ops.ts 单测：替换（字面量/正则/大小写）、行处理与排序
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'

import { applyLineOps, convertCase, replaceText } from './text-ops'

function valueOf(result: { ok: true; value: string } | { ok: false; error: unknown }): string {
  if (!result.ok) throw new Error('期望成功')
  return result.value
}

function errorCodeOf(result: { ok: true; value: string } | { ok: false; error: unknown }): string {
  expect(result.ok).toBe(false)
  return result.ok ? '' : (result.error as { code: string }).code
}

describe('replaceText', () => {
  it('字面量替换会转义正则元字符', () => {
    const result = replaceText('a.b.c', '.', '-', { regex: false, caseSensitive: true })
    expect(valueOf(result)).toBe('a-b-c')
  })

  it('大小写敏感开关', () => {
    const sensitive = replaceText('Aa', 'a', 'x', { regex: false, caseSensitive: true })
    const insensitive = replaceText('Aa', 'a', 'x', { regex: false, caseSensitive: false })
    expect(valueOf(sensitive)).toBe('Ax')
    expect(valueOf(insensitive)).toBe('xx')
  })

  it('正则模式支持分组与 $&', () => {
    const result = replaceText('订单 1024', '(\\d+)', '<$1>', {
      regex: true,
      caseSensitive: true
    })
    expect(valueOf(result)).toBe('订单 <1024>')
  })

  it('空查找内容 → TT_REPLACE_INVALID', () => {
    const result = replaceText('abc', '', 'x', { regex: false, caseSensitive: true })
    expect(errorCodeOf(result)).toBe('TT_REPLACE_INVALID')
  })

  it('非法正则 → TT_REGEX_INVALID', () => {
    const result = replaceText('abc', '(', 'x', { regex: true, caseSensitive: true })
    expect(errorCodeOf(result)).toBe('TT_REGEX_INVALID')
  })
})

describe('convertCase', () => {
  it('upper / lower / title / none', () => {
    expect(convertCase('Hello 世界', 'upper')).toBe('HELLO 世界')
    expect(convertCase('Hello 世界', 'lower')).toBe('hello 世界')
    expect(convertCase('hello-world foo_bar', 'title')).toBe('Hello-World Foo_Bar')
    expect(convertCase('Keep', 'none')).toBe('Keep')
  })
})

describe('applyLineOps', () => {
  const base = 'b\n\na\nb\r\nc'

  it('去空行 + 去重 + 升序 + 大写（按固定顺序执行）', () => {
    const output = applyLineOps(base, {
      removeEmpty: true,
      dedupe: true,
      sort: 'asc',
      caseMode: 'upper'
    })
    expect(output).toBe('A\nB\nC')
  })

  it('大小写先于去重（A/a 归并）', () => {
    const output = applyLineOps('A\na', {
      removeEmpty: false,
      dedupe: true,
      sort: 'none',
      caseMode: 'lower'
    })
    expect(output).toBe('a')
  })

  it('降序与数字自然排序', () => {
    const output = applyLineOps('item2\nitem10\nitem1', {
      removeEmpty: false,
      dedupe: false,
      sort: 'desc',
      caseMode: 'none'
    })
    expect(output).toBe('item10\nitem2\nitem1')
  })

  it('不做任何处理时保留原文（含 CRLF 归一为 LF）', () => {
    const output = applyLineOps('a\r\nb', {
      removeEmpty: false,
      dedupe: false,
      sort: 'none',
      caseMode: 'none'
    })
    expect(output).toBe('a\nb')
  })

  it('空文本返回空串', () => {
    expect(
      applyLineOps('', { removeEmpty: true, dedupe: true, sort: 'asc', caseMode: 'upper' })
    ).toBe('')
  })
})
