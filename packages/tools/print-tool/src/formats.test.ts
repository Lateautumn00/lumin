/**
 * @file formats.test.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description 格式白名单纯函数单测。
 */
import { describe, expect, it } from 'vitest'
import {
  PRINT_ACCEPT,
  classifyPrintFile,
  dedupePaths,
  extensionOf,
  fileNameOf,
  isAbsolutePath
} from './formats'

describe('extensionOf', () => {
  it('取 Windows 路径扩展名并小写', () => {
    expect(extensionOf('C:\\docs\\报告.DOCX')).toBe('docx')
  })

  it('无扩展名或点开头的隐藏文件返回空串', () => {
    expect(extensionOf('C:\\docs\\README')).toBe('')
    expect(extensionOf('/home/u/.bashrc')).toBe('')
  })
})

describe('classifyPrintFile', () => {
  it('识别 office / pdf / image', () => {
    expect(classifyPrintFile('a.DOC')).toBe('office')
    expect(classifyPrintFile('a.xlsx')).toBe('office')
    expect(classifyPrintFile('a.pdf')).toBe('pdf')
    expect(classifyPrintFile('a.PNG')).toBe('image')
  })

  it('不支持的类型返回 null', () => {
    expect(classifyPrintFile('a.txt')).toBeNull()
    expect(classifyPrintFile('a')).toBeNull()
  })
})

describe('dedupePaths', () => {
  it('大小写不敏感去重且保持首次出现', () => {
    expect(dedupePaths(['C:\\A.pdf', 'c:\\a.PDF', 'C:\\b.png'])).toEqual(['C:\\A.pdf', 'C:\\b.png'])
  })
})

describe('isAbsolutePath', () => {
  it('识别盘符 / UNC / POSIX 绝对路径', () => {
    expect(isAbsolutePath('C:\\a.pdf')).toBe(true)
    expect(isAbsolutePath('\\\\server\\share\\a.pdf')).toBe(true)
    expect(isAbsolutePath('/tmp/a.pdf')).toBe(true)
  })

  it('相对路径返回 false', () => {
    expect(isAbsolutePath('a.pdf')).toBe(false)
    expect(isAbsolutePath('./a.pdf')).toBe(false)
  })
})

describe('fileNameOf / PRINT_ACCEPT', () => {
  it('取最后一段文件名（兼容反斜杠）', () => {
    expect(fileNameOf('C:\\docs\\a.pdf')).toBe('a.pdf')
    expect(fileNameOf('/tmp/a.pdf')).toBe('a.pdf')
  })

  it('accept 覆盖全部格式', () => {
    expect(PRINT_ACCEPT).toContain('.docx')
    expect(PRINT_ACCEPT).toContain('.pdf')
    expect(PRINT_ACCEPT).toContain('.jpeg')
  })
})
