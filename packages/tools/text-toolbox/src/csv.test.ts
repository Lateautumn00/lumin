/**
 * @file csv.ts 单测：RFC 4180 解析、表头/无表头、分隔符、错误分支与 JSON 对象数组序列化
 * @author cuilanchao
 * @date 2026-11-21
 * @description 覆盖 spec §2.6 / §3.6 的成功与错误分支
 */
import { describe, expect, it } from 'vitest'
import { csvToJson, jsonToCsv, parseCsv } from './csv'
import { MAX_TEXT_BYTES } from './errors'

/** 取成功值（失败时抛错便于断言） */
function valueOf<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error('期望成功')
  return result.value
}

/** 取失败码（成功时抛错便于断言） */
function codeOf(result: { ok: true } | { ok: false; error: { code: string } }): string {
  if (result.ok) throw new Error('期望失败')
  return result.error.code
}

describe('parseCsv', () => {
  it('逗号分隔 + 首行表头', () => {
    const table = valueOf(parseCsv('name,role\n张三,管理员\n李四,编辑'))
    expect(table).toEqual({
      headers: ['name', 'role'],
      rows: [
        ['张三', '管理员'],
        ['李四', '编辑']
      ]
    })
  })

  it('引号包裹含分隔符与字段内换行', () => {
    const text = 'name,desc\n"a,b","第一行\n第二行"'
    const table = valueOf(parseCsv(text))
    expect(table.rows).toEqual([['a,b', '第一行\n第二行']])
  })

  it('"" 转义为单个引号', () => {
    const table = valueOf(parseCsv('quote\n"say ""hi"""'))
    expect(table.rows).toEqual([['say "hi"']])
  })

  it('CRLF 归一、结尾空行忽略', () => {
    const table = valueOf(parseCsv('a,b\r\n1,2\r\n\r\n'))
    expect(table).toEqual({
      headers: ['a', 'b'],
      rows: [['1', '2']]
    })
  })

  it('无表头模式返回二维数组', () => {
    const table = valueOf(parseCsv('1,2\n3,4', { hasHeader: false }))
    expect(table).toEqual({
      headers: null,
      rows: [
        ['1', '2'],
        ['3', '4']
      ]
    })
  })

  it('自动去除首部 BOM', () => {
    const table = valueOf(parseCsv('\uFEFFa,b\n1,2'))
    expect(table.headers).toEqual(['a', 'b'])
  })

  it('支持制表符 / 分号 / 竖线分隔', () => {
    expect(valueOf(parseCsv('a\tb\n1\t2', { delimiter: '\t' })).headers).toEqual(['a', 'b'])
    expect(valueOf(parseCsv('a;b\n1;2', { delimiter: ';' })).rows).toEqual([['1', '2']])
    expect(valueOf(parseCsv('a|b\n1|2', { delimiter: '|' })).rows).toEqual([['1', '2']])
  })

  it('引号未闭合 → TT_CSV_INVALID', () => {
    const result = parseCsv('a,b\n"未闭合,2')
    expect(codeOf(result)).toBe('TT_CSV_INVALID')
    if (!result.ok) expect(result.error.detail).toContain('引号未闭合')
  })

  it('引号不在字段开头 → TT_CSV_INVALID', () => {
    const result = parseCsv('a,b\nab"c,2')
    expect(codeOf(result)).toBe('TT_CSV_INVALID')
    if (!result.ok) expect(result.error.detail).toContain('第 2 行')
  })

  it('列数不一致 → TT_CSV_INVALID 且带行号', () => {
    const result = parseCsv('a,b\n1,2\n3,4,5')
    expect(codeOf(result)).toBe('TT_CSV_INVALID')
    if (!result.ok) expect(result.error.detail).toBe('第 3 行：列数 3 与表头 2 不一致')
  })

  it('表头重复 → TT_CSV_INVALID', () => {
    const result = parseCsv('a,a\n1,2')
    expect(codeOf(result)).toBe('TT_CSV_INVALID')
    if (!result.ok) expect(result.error.detail).toBe('表头「a」重复')
  })

  it('空内容 → TT_CSV_INVALID', () => {
    expect(codeOf(parseCsv('  \n \n'))).toBe('TT_CSV_INVALID')
  })

  it('超过 5MB → TT_TEXT_TOO_LARGE', () => {
    const big = 'a'.repeat(MAX_TEXT_BYTES + 1)
    expect(codeOf(parseCsv(big))).toBe('TT_TEXT_TOO_LARGE')
  })
})

describe('csvToJson', () => {
  it('有表头 → 对象数组（值一律字符串）', () => {
    const json = valueOf(csvToJson('name,age\n张三,42'))
    expect(JSON.parse(json)).toEqual([{ name: '张三', age: '42' }])
  })

  it('无表头 → 二维数组', () => {
    const json = valueOf(csvToJson('1,2\n3,4', { hasHeader: false }))
    expect(JSON.parse(json)).toEqual([
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('解析错误原样透传', () => {
    expect(codeOf(csvToJson('a,b\n1'))).toBe('TT_CSV_INVALID')
  })
})

describe('jsonToCsv', () => {
  it('对象数组 → 表头 + CRLF 行', () => {
    const csv = valueOf(jsonToCsv('[{"name":"张三","age":42},{"name":"李四","age":null}]'))
    expect(csv).toBe('name,age\r\n张三,42\r\n李四,')
  })

  it('列名并集按首次出现顺序，缺失字段输出空', () => {
    const csv = valueOf(jsonToCsv('[{"a":1},{"b":true},{"a":2,"b":false}]'))
    expect(csv).toBe('a,b\r\n1,\r\n,true\r\n2,false')
  })

  it('分隔符/引号/换行触发引号包裹与双写', () => {
    const csv = valueOf(jsonToCsv('[{"text":"a,b"}]', { delimiter: ';' }))
    expect(csv).toBe('text\r\na,b')
    const quoted = valueOf(jsonToCsv('[{"text":"say \\"hi\\"\\nnext"}]'))
    expect(quoted).toBe('text\r\n"say ""hi""\nnext"')
  })

  it('自定义分隔符且可关闭表头', () => {
    expect(valueOf(jsonToCsv('[{"a":1}]', { delimiter: ';', includeHeader: false }))).toBe('1')
  })

  it('空数组 → 空串', () => {
    expect(valueOf(jsonToCsv('[]'))).toBe('')
  })

  it('非数组 → TT_CSV_INVALID', () => {
    expect(codeOf(jsonToCsv('{"a":1}'))).toBe('TT_CSV_INVALID')
  })

  it('数组项不是对象 → TT_CSV_INVALID 且带序号', () => {
    const result = jsonToCsv('[{"a":1},2]')
    expect(codeOf(result)).toBe('TT_CSV_INVALID')
    if (!result.ok) expect(result.error.detail).toBe('第 2 项不是对象')
  })

  it('嵌套值 → TT_CSV_INVALID 且带字段名', () => {
    const result = jsonToCsv('[{"a":{"b":1}}]')
    expect(codeOf(result)).toBe('TT_CSV_INVALID')
    if (!result.ok) expect(result.error.detail).toBe('第 1 项字段「a」不是基本类型')
  })

  it('全部为空对象 → TT_CSV_INVALID', () => {
    expect(codeOf(jsonToCsv('[{}]'))).toBe('TT_CSV_INVALID')
  })

  it('JSON 语法错误透传 TT_JSON_INVALID', () => {
    expect(codeOf(jsonToCsv('[{"a":1},]'))).toBe('TT_JSON_INVALID')
  })
})
