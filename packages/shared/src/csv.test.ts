/**
 * @file shared/csv.ts 单测：RFC 4180 解析、表头/无表头、分隔符与中性错误分支
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import { parseCsv, type CsvTable } from './csv'

function valueOf(result: ReturnType<typeof parseCsv>): CsvTable {
  if (!result.ok) throw new Error('期望成功')
  return result.value
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
    const table = valueOf(parseCsv('name,desc\n"a,b","第一行\n第二行"'))
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

  it('引号未闭合 → 失败（行号）', () => {
    const result = parseCsv('a,b\n"未闭合,2')
    expect(result).toMatchObject({ ok: false, message: '第 2 行：引号未闭合', line: 2 })
  })

  it('引号不在字段开头 → 失败（行号）', () => {
    const result = parseCsv('a,b\nab"c,2')
    expect(result).toMatchObject({ ok: false, line: 2 })
    if (!result.ok) expect(result.message).toContain('第 2 行')
  })

  it('列数不一致 → 失败且带行号（表头/无表头口径）', () => {
    const withHeader = parseCsv('a,b\n1,2\n3,4,5')
    expect(withHeader).toMatchObject({ ok: false, line: 3 })
    if (!withHeader.ok) expect(withHeader.message).toBe('第 3 行：列数 3 与表头 2 不一致')

    const noHeader = parseCsv('1,2\n3,4,5', { hasHeader: false })
    if (!noHeader.ok) expect(noHeader.message).toBe('第 2 行：列数 3 与首行 2 不一致')
  })

  it('表头重复 → 失败', () => {
    const result = parseCsv('a,a\n1,2')
    expect(result).toMatchObject({ ok: false, message: '表头「a」重复', line: 1 })
  })

  it('空内容 → 失败', () => {
    expect(parseCsv('  \n \n')).toMatchObject({ ok: false, message: 'CSV 内容为空', line: 0 })
  })

  it('单独 CR 换行归一', () => {
    const table = valueOf(parseCsv('a,b\r1,2'))
    expect(table).toEqual({ headers: ['a', 'b'], rows: [['1', '2']] })
  })
})
