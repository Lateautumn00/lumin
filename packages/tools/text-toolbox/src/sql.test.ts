/**
 * @file SQL 格式化 / 压缩单测：tokenizer 保护、关键字换行快照、压缩幂等与未闭合警告
 * @author cuilanchao
 * @date 2026-11-23
 * @description 覆盖 spec §7.2 验收锚点（纯函数，无 IO）
 */
import { describe, expect, it } from 'vitest'
import { formatSql, minifySql } from './sql'

describe('SQL 美化（formatSql）', () => {
  it('子句关键字换行、大写与 2 空格缩进（AND 续行）', () => {
    const sql = "select id, name from users where status = 'active' -- 状态\nand age > 18"
    expect(formatSql(sql)).toEqual({
      value: "SELECT id, name\nFROM users\nWHERE status = 'active' -- 状态\n  AND age > 18",
      warning: ''
    })
  })

  it("tokenizer 保护 '' 转义字符串、双引号与反引号标识符、数字", () => {
    const sql = "select `表`, \"Odd\", 'it''s', 1.5e3 from t"
    expect(formatSql(sql).value).toBe("SELECT `表`, \"Odd\", 'it''s', 1.5e3\nFROM t")
  })

  it('行注释内的关键字不参与换行与大写', () => {
    const sql = 'select a from t -- select from where\nwhere a = 1'
    expect(formatSql(sql).value).toBe('SELECT a\nFROM t -- select from where\nWHERE a = 1')
  })

  it('CASE…END 内部保持一级缩进', () => {
    const sql = "select case when a = 1 then 'x' else 'y' end as s from t"
    expect(formatSql(sql).value).toBe(
      "SELECT CASE\n  WHEN a = 1 THEN 'x'\n  ELSE 'y'\nEND as s\nFROM t"
    )
  })

  it('多词子句（LEFT JOIN / GROUP BY）与块注释整体保留', () => {
    const sql = 'select a from t left join u on t.id = u.id group by a /* keep */'
    expect(formatSql(sql).value).toBe(
      'SELECT a\nFROM t\nLEFT JOIN u\nON t.id = u.id\nGROUP BY a /* keep */'
    )
  })

  it('双字符操作符与数字原样（<= 与 1.5e3）', () => {
    expect(formatSql('select a from t where b <= 1.5e3').value).toBe(
      'SELECT a\nFROM t\nWHERE b <= 1.5e3'
    )
  })

  it('多词关键字需成对出现：裸 order 不换行不改写', () => {
    expect(formatSql('select a from t order').value).toBe('SELECT a\nFROM t order')
  })

  it('left() 函数名不误判为 LEFT JOIN 短语', () => {
    expect(formatSql('select left(a, 2) from t').value).toBe('SELECT left(a, 2)\nFROM t')
  })

  it('未闭合字符串 → 按原文保留并带警告', () => {
    const sql = "select 'abc"
    expect(formatSql(sql)).toEqual({
      value: sql,
      warning: '存在未闭合字面量，已按原文处理'
    })
  })

  it('空输入返回空串', () => {
    expect(formatSql('')).toEqual({ value: '', warning: '' })
  })
})

describe('SQL 压缩（minifySql）', () => {
  it('空白折叠为单空格，字符串与注释原样保留', () => {
    const sql = "select  a,\n\n b from t where x = 'c  d' -- keep me\nand y = 2"
    expect(minifySql(sql).value).toBe("select a, b from t where x = 'c  d' -- keep me\nand y = 2")
  })

  it('压缩幂等：二次压缩结果不变', () => {
    const sql = "select case when a = 1 then 'x' else 'y' end from t -- note\nand a = 2"
    const once = minifySql(sql).value
    expect(minifySql(once).value).toBe(once)
  })

  it('压缩幂等：美化结果压缩后同样幂等', () => {
    const sql = "select case when a = 1 then 'x' else 'y' end from t -- note\nand a = 2"
    const fromPretty = minifySql(formatSql(sql).value).value
    expect(fromPretty).toBe(
      "SELECT CASE WHEN a = 1 THEN 'x' ELSE 'y' END FROM t -- note\nAND a = 2"
    )
    expect(minifySql(fromPretty).value).toBe(fromPretty)
  })

  it('未闭合块注释 → 按原文保留并带警告', () => {
    const sql = 'select a /* note'
    expect(minifySql(sql)).toEqual({
      value: sql,
      warning: '存在未闭合字面量，已按原文处理'
    })
  })

  it('空输入返回空串', () => {
    expect(minifySql('')).toEqual({ value: '', warning: '' })
  })
})
