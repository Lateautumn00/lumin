/**
 * @file JSON → JSON Schema（draft-07 子集）单测
 * @author cuilanchao
 * @date 2026-11-22
 * @description 覆盖对象/嵌套 $defs/数组首个元素/整数与小数/null/布空容器/命名冲突/根值。
 */
import { describe, expect, it } from 'vitest'

import { generateTypes, jsonToSchema } from './json-to-ts'

const SCHEMA_URL = 'http://json-schema.org/draft-07/schema#'

describe('jsonToSchema 基本类型', () => {
  it('扁平对象：properties + required，整数→integer、小数→number、null→string|null', () => {
    expect(
      jsonToSchema({ id: 1, score: 1.5, name: 'a', ok: true, empty: null }, 'Root')
    ).toEqual({
      $schema: SCHEMA_URL,
      title: 'Root',
      type: 'object',
      properties: {
        id: { type: 'integer' },
        score: { type: 'number' },
        name: { type: 'string' },
        ok: { type: 'boolean' },
        empty: { type: ['string', 'null'] }
      },
      required: ['id', 'score', 'name', 'ok', 'empty']
    })
  })

  it('字符串不产生 format 字段', () => {
    const schema = jsonToSchema({ site: 'https://example.com', date: '2026-11-22' })
    expect(JSON.stringify(schema)).not.toContain('format')
  })

  it('根值非对象时直接输出类型', () => {
    expect(jsonToSchema(123, 'Root')).toEqual({
      $schema: SCHEMA_URL,
      title: 'Root',
      type: 'integer'
    })
    expect(jsonToSchema([], 'Root')).toEqual({
      $schema: SCHEMA_URL,
      title: 'Root',
      type: 'array'
    })
  })
})

describe('jsonToSchema 嵌套与数组', () => {
  it('嵌套对象抽到 $defs 并用 $ref 引用', () => {
    expect(jsonToSchema({ user: { id: 1, address: { city: 'x' } } }, 'Root')).toEqual({
      $schema: SCHEMA_URL,
      title: 'Root',
      type: 'object',
      properties: {
        user: { $ref: '#/$defs/RootUser' }
      },
      required: ['user'],
      $defs: {
        RootUserAddress: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city']
        },
        RootUser: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            address: { $ref: '#/$defs/RootUserAddress' }
          },
          required: ['id', 'address']
        }
      }
    })
  })

  it('数组 items 取首个元素类型并复用 $defs', () => {
    const schema = jsonToSchema({ items: [{ id: 1 }, { id: 2, name: 'x' }] }, 'Root')
    expect(schema).toMatchObject({
      properties: {
        items: { type: 'array', items: { $ref: '#/$defs/RootItemsItem' } }
      },
      $defs: {
        RootItemsItem: {
          type: 'object',
          properties: { id: { type: 'integer' } },
          required: ['id']
        }
      }
    })
  })

  it('空对象与空数组只输出 type，不产生 properties/required/items/$defs', () => {
    expect(jsonToSchema({}, 'Root')).toEqual({
      $schema: SCHEMA_URL,
      title: 'Root',
      type: 'object'
    })
    expect(jsonToSchema({ tags: [] }, 'Root')).toEqual({
      $schema: SCHEMA_URL,
      title: 'Root',
      type: 'object',
      properties: { tags: { type: 'array' } },
      required: ['tags']
    })
  })

  it('$defs 名称冲突自动递增且引用一致', () => {
    const schema = jsonToSchema({ a_b: { x: 1 }, aB: { y: 2 } }, 'Root')
    expect(schema).toMatchObject({
      properties: {
        a_b: { $ref: '#/$defs/RootAB' },
        aB: { $ref: '#/$defs/RootAB2' }
      },
      $defs: {
        RootAB: { properties: { x: { type: 'integer' } } },
        RootAB2: { properties: { y: { type: 'integer' } } }
      }
    })
  })
})

describe('generateTypes(json-schema)', () => {
  it('输出 draft-07 JSON 文本并以换行结尾', () => {
    const outcome = generateTypes('{"id":1}', { rootName: 'Root', style: 'json-schema' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.code).toContain('"$schema": "http://json-schema.org/draft-07/schema#"')
    expect(outcome.value.code).toContain('"properties"')
    expect(outcome.value.code.endsWith('\n')).toBe(true)
    expect(JSON.parse(outcome.value.code)).toMatchObject({ type: 'object' })
  })

  it('非法 JSON / 超深嵌套 / 非法根名沿用既有错误码', () => {
    expect(
      generateTypes('{', { rootName: 'Root', style: 'json-schema' })
    ).toMatchObject({ ok: false, code: 'MD_JSON_INVALID' })
    const deep = `${'{"a":'.repeat(70)}1${'}'.repeat(70)}`
    expect(
      generateTypes(deep, { rootName: 'Root', style: 'json-schema' })
    ).toMatchObject({ ok: false, code: 'MD_JSON_INVALID' })
    expect(
      generateTypes('{}', { rootName: '1bad', style: 'json-schema' })
    ).toMatchObject({ ok: false, code: 'MD_TS_NAME_INVALID' })
  })
})
