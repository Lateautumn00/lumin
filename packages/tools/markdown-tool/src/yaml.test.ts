/**
 * @file YAML 互转/格式化单测
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import { formatYaml, jsonToYaml, YAML_LIMIT, yamlToJson } from './yaml'

describe('yamlToJson', () => {
  it('嵌套结构转 2 空格美化 JSON', () => {
    expect(yamlToJson('a: 1\nb:\n  - x\n')).toEqual({
      ok: true,
      value: { text: '{\n  "a": 1,\n  "b": [\n    "x"\n  ]\n}' }
    })
  })

  it('空文档输出 null，空输入返回空文本', () => {
    expect(yamlToJson('')).toEqual({ ok: true, value: { text: '' } })
    expect(yamlToJson('# 只有注释\n')).toEqual({ ok: true, value: { text: 'null' } })
  })

  it('语法错误带行列信息', () => {
    const outcome = yamlToJson('a: [')
    expect(outcome).toMatchObject({ ok: false, code: 'MD_YAML_INVALID' })
    if (outcome.ok) return
    expect(outcome.detail).toMatch(/第 \d+ 行，第 \d+ 列/)
  })

  it('多文档与超限分别报错', () => {
    expect(yamlToJson('a: 1\n---\nb: 2\n')).toMatchObject({
      ok: false,
      code: 'MD_YAML_INVALID'
    })
    expect(yamlToJson('a'.repeat(YAML_LIMIT + 1))).toMatchObject({
      ok: false,
      code: 'MD_INPUT_TOO_LONG'
    })
  })
})

describe('jsonToYaml', () => {
  it('对象与数组转 YAML', () => {
    expect(jsonToYaml('{"a":1}')).toEqual({ ok: true, value: { text: 'a: 1\n' } })
    expect(jsonToYaml('[1,2]')).toEqual({ ok: true, value: { text: '- 1\n- 2\n' } })
  })

  it('非法 JSON 归 MD_JSON_INVALID，空输入返回空文本', () => {
    expect(jsonToYaml('{')).toMatchObject({ ok: false, code: 'MD_JSON_INVALID' })
    expect(jsonToYaml('   ')).toEqual({ ok: true, value: { text: '' } })
    expect(jsonToYaml('x'.repeat(YAML_LIMIT + 1))).toMatchObject({
      ok: false,
      code: 'MD_INPUT_TOO_LONG'
    })
  })
})

describe('formatYaml', () => {
  it('统一缩进并移除注释', () => {
    expect(formatYaml('# 注释\nlist:\n    - 1\n')).toEqual({
      ok: true,
      value: { text: 'list:\n  - 1\n' }
    })
  })

  it('语法错误、空输入与超限', () => {
    expect(formatYaml('a: [')).toMatchObject({ ok: false, code: 'MD_YAML_INVALID' })
    expect(formatYaml('')).toEqual({ ok: true, value: { text: '' } })
    expect(formatYaml('a'.repeat(YAML_LIMIT + 1))).toMatchObject({
      ok: false,
      code: 'MD_INPUT_TOO_LONG'
    })
  })

  it('标量文档可格式化', () => {
    expect(formatYaml('42')).toEqual({ ok: true, value: { text: '42\n' } })
  })
})
