/**
 * @file naming 纯函数单测（拆分/序号/日期/大小写/删除字符/查找替换/名称校验）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 覆盖 spec §3 规则语义与 §4 八类名称校验中的前五类
 */
import { describe, expect, it } from 'vitest'
import {
  applyCase,
  applyFindReplace,
  deleteChars,
  formatDate,
  isReservedName,
  joinFileName,
  MAX_NAME_BYTES,
  padNumber,
  splitFileName,
  validateFileName
} from './naming'

describe('splitFileName / joinFileName', () => {
  it('普通扩展名', () => {
    expect(splitFileName('a.jpg')).toEqual({ stem: 'a', ext: '.jpg' })
    expect(splitFileName('a.tar.gz')).toEqual({ stem: 'a.tar', ext: '.gz' })
  })

  it('无扩展名与点开头文件', () => {
    expect(splitFileName('README')).toEqual({ stem: 'README', ext: '' })
    expect(splitFileName('.gitignore')).toEqual({ stem: '.gitignore', ext: '' })
    expect(splitFileName('a.')).toEqual({ stem: 'a', ext: '.' })
  })

  it('拼接还原', () => {
    expect(joinFileName('a', '.jpg')).toBe('a.jpg')
    expect(joinFileName('README', '')).toBe('README')
  })
})

describe('padNumber', () => {
  it('补零与超宽', () => {
    expect(padNumber(1, 3)).toBe('001')
    expect(padNumber(1234, 3)).toBe('1234')
    expect(padNumber(0, 2)).toBe('00')
  })
})

describe('formatDate', () => {
  const date = new Date(2026, 10, 18, 9, 5, 7)

  it('三种格式', () => {
    expect(formatDate(date, 'YYYYMMDD')).toBe('20261118')
    expect(formatDate(date, 'YYYY-MM-DD')).toBe('2026-11-18')
    expect(formatDate(date, 'YYMMDD-HHmmss')).toBe('261118-090507')
  })
})

describe('applyCase', () => {
  it('四种模式', () => {
    expect(applyCase('AbC', 'none')).toBe('AbC')
    expect(applyCase('AbC', 'lower')).toBe('abc')
    expect(applyCase('AbC', 'upper')).toBe('ABC')
    expect(applyCase('hello world-foo_bar', 'capitalize')).toBe('Hello World-Foo_Bar')
  })
})

describe('deleteChars', () => {
  it('从指定位置删除指定数量', () => {
    expect(deleteChars('abcdef', 1, 2)).toBe('cdef')
    expect(deleteChars('abcdef', 3, 2)).toBe('abef')
    expect(deleteChars('abc', 2, 10)).toBe('a')
    expect(deleteChars('abc', 5, 1)).toBe('abc')
    expect(deleteChars('abc', 1, 0)).toBe('abc')
  })

  it('按码点删除 emoji', () => {
    expect(deleteChars('a😀b', 2, 1)).toBe('ab')
  })
})

describe('applyFindReplace', () => {
  const base = { replace: 'X', isRegex: false, caseSensitive: true }

  it('文本模式区分大小写', () => {
    expect(applyFindReplace('aAa', { ...base, find: 'a' })).toBe('XAX')
  })

  it('文本模式不区分大小写', () => {
    expect(applyFindReplace('aAa', { ...base, find: 'a', caseSensitive: false })).toBe('XXX')
  })

  it('文本模式不解析替换串中的 $', () => {
    expect(applyFindReplace('a', { ...base, find: 'a', replace: '$1' })).toBe('$1')
  })

  it('正则模式支持反向引用', () => {
    expect(
      applyFindReplace('IMG_001', {
        find: 'IMG_(\\d+)',
        replace: 'Photo$1',
        isRegex: true,
        caseSensitive: true
      })
    ).toBe('Photo001')
  })

  it('正则非法或查找为空保持原文', () => {
    expect(
      applyFindReplace('abc', { find: '(', replace: 'x', isRegex: true, caseSensitive: true })
    ).toBe('abc')
    expect(applyFindReplace('abc', { ...base, find: '' })).toBe('abc')
  })
})

describe('isReservedName / validateFileName', () => {
  it('保留设备名（含扩展名）', () => {
    expect(isReservedName('CON')).toBe(true)
    expect(isReservedName('con.txt')).toBe(true)
    expect(isReservedName('COM1.log')).toBe(true)
    expect(isReservedName('console.txt')).toBe(false)
    expect(isReservedName('con1.txt')).toBe(false)
  })

  it('空主名 / 保留字符 / 结尾空白或点 / 超长', () => {
    expect(validateFileName(' .txt')?.code).toBe('FR_NAME_INVALID')
    expect(validateFileName('a<b.txt')?.code).toBe('FR_NAME_INVALID')
    expect(validateFileName('a?.txt')?.code).toBe('FR_NAME_INVALID')
    expect(validateFileName('a .txt')?.code).toBeUndefined()
    expect(validateFileName('a ')).toMatchObject({ code: 'FR_NAME_INVALID' })
    expect(validateFileName('a.')).toMatchObject({ code: 'FR_NAME_INVALID' })
    const tooLong = `${'a'.repeat(MAX_NAME_BYTES)}.txt`
    expect(validateFileName(tooLong)).toMatchObject({ code: 'FR_NAME_INVALID' })
  })

  it('中文按 3 字节计长', () => {
    const name = '中'.repeat(85) // 255 字节恰好不超
    expect(validateFileName(name)).toBeNull()
    expect(validateFileName(`${name}中`)).toMatchObject({ code: 'FR_NAME_INVALID' })
  })

  it('保留名给出专属码', () => {
    expect(validateFileName('NUL.txt')).toMatchObject({ code: 'FR_NAME_RESERVED' })
  })

  it('合法名称通过', () => {
    expect(validateFileName('报告 2026-11-18.png')).toBeNull()
  })
})
