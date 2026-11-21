/**
 * @file JSON→TypeScript 生成单测（覆盖对象/数组/联合/可选/命名/边界）
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import { generateTypes, isValidRootName, JSON_LIMIT } from './json-to-ts'

/**
 * 生成代码（默认 interface + Root）
 * @param input JSON 文本
 * @param rootName 根类型名
 */
function generate(input: string, rootName = 'Root'): string {
  const outcome = generateTypes(input, { rootName, style: 'interface' })
  expect(outcome.ok).toBe(true)
  if (!outcome.ok) throw new Error(outcome.message)
  return outcome.value.code
}

describe('generateTypes 基本推断', () => {
  it('扁平对象生成 interface', () => {
    expect(generate('{"id":1,"name":"a","ok":true,"empty":null}')).toBe(
      [
        'export interface Root {',
        '  id: number',
        '  name: string',
        '  ok: boolean',
        '  empty: null',
        '}',
        ''
      ].join('\n')
    )
  })

  it('嵌套对象按「根名 + PascalCase(键路径)」命名并追加声明', () => {
    expect(generate('{"user":{"id":1,"tags":["a"]}}')).toBe(
      [
        'export interface Root {',
        '  user: RootUser',
        '}',
        '',
        'export interface RootUser {',
        '  id: number',
        '  tags: string[]',
        '}',
        ''
      ].join('\n')
    )
  })

  it('type 声明方式生成类型别名对象', () => {
    const outcome = generateTypes('{"id":1}', { rootName: 'Root', style: 'type' })
    expect(outcome).toEqual({
      ok: true,
      value: { code: 'export type Root = {\n  id: number\n}\n' }
    })
  })

  it('非对象根值退化为类型别名', () => {
    expect(generate('123')).toBe('export type Root = number\n')
    expect(generate('"x"')).toBe('export type Root = string\n')
    expect(generate('null')).toBe('export type Root = null\n')
  })

  it('空对象 / 空数组 / 空字段对象走边界类型', () => {
    expect(generate('{}')).toBe('export type Root = Record<string, never>\n')
    expect(generate('[]')).toBe('export type Root = unknown[]\n')
    expect(generate('{"meta":{}}')).toBe(
      'export interface Root {\n  meta: Record<string, never>\n}\n'
    )
  })
})

describe('generateTypes 数组与联合', () => {
  it('对象数组合并键：全出现必选、部分出现可选、类型不同取联合', () => {
    expect(generate('[{"a":1,"b":"x"},{"a":2}]')).toBe(
      [
        'export type Root = RootItem[]',
        '',
        'export interface RootItem {',
        '  a: number',
        '  b?: string',
        '}',
        ''
      ].join('\n')
    )
  })

  it('数组元素类型不同生成联合并用括号包裹', () => {
    expect(generate('[1,"a"]')).toBe('export type Root = (number | string)[]\n')
  })

  it('数组中的对象联合正确嵌套', () => {
    expect(generate('[{"x":1},{"x":"s","y":true}]')).toBe(
      [
        'export type Root = RootItem[]',
        '',
        'export interface RootItem {',
        '  x: number | string',
        '  y?: boolean',
        '}',
        ''
      ].join('\n')
    )
  })

  it('键名按路径派生且冲突自动递增', () => {
    expect(generate('{"a_b":{"x":1},"aB":{"y":2}}')).toBe(
      [
        'export interface Root {',
        '  a_b: RootAB',
        '  aB: RootAB2',
        '}',
        '',
        'export interface RootAB {',
        '  x: number',
        '}',
        '',
        'export interface RootAB2 {',
        '  y: number',
        '}',
        ''
      ].join('\n')
    )
  })

  it('非法标识符键名用单引号包裹并转义', () => {
    expect(generate(`{"a-b":1,"it's":2,"中文键":3}`)).toBe(
      [
        'export interface Root {',
        "  'a-b': number",
        "  'it\\'s': number",
        "  '中文键': number",
        '}',
        ''
      ].join('\n')
    )
  })
})

describe('generateTypes 校验与边界', () => {
  it('根类型名非法（数字开头/保留字/空）返回 MD_TS_NAME_INVALID', () => {
    expect(isValidRootName('Root')).toBe(true)
    expect(isValidRootName('_root$1')).toBe(true)
    for (const name of ['1abc', 'interface', '', 'has space']) {
      expect(generateTypes('{}', { rootName: name, style: 'interface' })).toMatchObject({
        ok: false,
        code: 'MD_TS_NAME_INVALID'
      })
    }
  })

  it('非法 JSON 返回 MD_JSON_INVALID 并带解析细节', () => {
    const outcome = generateTypes('{', { rootName: 'Root', style: 'interface' })
    expect(outcome).toMatchObject({ ok: false, code: 'MD_JSON_INVALID' })
    if (outcome.ok) return
    expect(outcome.detail).toBeTruthy()
  })

  it('嵌套超过 64 层返回 MD_JSON_INVALID（嵌套过深）', () => {
    const deep = `${'{"a":'.repeat(70)}1${'}'.repeat(70)}`
    const outcome = generateTypes(deep, { rootName: 'Root', style: 'interface' })
    expect(outcome).toMatchObject({ ok: false, code: 'MD_JSON_INVALID' })
    if (outcome.ok) return
    expect(outcome.detail).toContain('嵌套过深')
  })

  it('输入超限与空输入', () => {
    expect(
      generateTypes('a'.repeat(JSON_LIMIT + 1), { rootName: 'Root', style: 'interface' })
    ).toMatchObject({ ok: false, code: 'MD_INPUT_TOO_LONG' })
    expect(generateTypes('  ', { rootName: 'Root', style: 'interface' })).toEqual({
      ok: true,
      value: { code: '' }
    })
  })
})
