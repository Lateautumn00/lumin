import { describe, expect, it } from 'vitest'
import {
  TEXT_EDITOR_MAX_BYTES,
  extensionOf,
  hasNulByte,
  languageForPath,
  splitPath,
  toEolChar,
  toEolKind
} from './formats'

describe('formats', () => {
  it('打开上限为 5 MiB', () => {
    expect(TEXT_EDITOR_MAX_BYTES).toBe(5 * 1024 * 1024)
  })

  describe('extensionOf', () => {
    it('取小写扩展名并兼容反斜杠', () => {
      expect(extensionOf('C:\\docs\\README.MD')).toBe('md')
      expect(extensionOf('/tmp/a.min.js')).toBe('js')
      expect(extensionOf('a.txt')).toBe('txt')
    })

    it('无扩展名或隐藏文件返回 null', () => {
      expect(extensionOf('C:\\docs\\README')).toBeNull()
      expect(extensionOf('.gitignore')).toBeNull()
      expect(extensionOf('a.')).toBeNull()
    })
  })

  describe('languageForPath', () => {
    it('md → markdown', () => {
      expect(languageForPath('a.md')).toBe('markdown')
      expect(languageForPath('C:\\a\\b.MARKDOWN')).toBe('markdown')
    })

    it('json → json', () => {
      expect(languageForPath('package.json')).toBe('json')
    })

    it('js/ts/jsx/tsx/mjs/cjs → javascript', () => {
      for (const name of ['a.js', 'a.ts', 'a.jsx', 'a.tsx', 'a.mjs', 'a.cjs', 'A.JS']) {
        expect(languageForPath(name)).toBe('javascript')
      }
    })

    it('其余扩展名或空路径 → null（纯文本）', () => {
      expect(languageForPath('a.txt')).toBeNull()
      expect(languageForPath('C:\\notes')).toBeNull()
      expect(languageForPath('')).toBeNull()
    })
  })

  describe('hasNulByte', () => {
    it('检测 NUL 字节', () => {
      expect(hasNulByte(Buffer.from([0x41, 0x00, 0x42]))).toBe(true)
      expect(hasNulByte(Buffer.from('纯文本'))).toBe(false)
      expect(hasNulByte(new Uint8Array())).toBe(false)
    })
  })

  describe('EOL 枚举互转', () => {
    it('parse 与 reverse 一一对应', () => {
      expect(toEolKind('\n')).toBe('lf')
      expect(toEolKind('\r\n')).toBe('crlf')
      expect(toEolKind('\r')).toBe('cr')
      expect(toEolChar('lf')).toBe('\n')
      expect(toEolChar('crlf')).toBe('\r\n')
      expect(toEolChar('cr')).toBe('\r')
    })
  })

  describe('splitPath', () => {
    it('拆分 Windows 路径', () => {
      expect(splitPath('C:\\docs\\a b.txt')).toEqual({ dir: 'C:\\docs', name: 'a b.txt' })
    })

    it('拆分 POSIX 路径', () => {
      expect(splitPath('/tmp/a.txt')).toEqual({ dir: '/tmp', name: 'a.txt' })
    })

    it('无目录时 dir 为空串', () => {
      expect(splitPath('a.txt')).toEqual({ dir: '', name: 'a.txt' })
    })
  })
})
