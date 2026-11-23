import { describe, expect, it } from 'vitest'
import {
  FILE_PREVIEW_ACCEPT,
  detectKind,
  extensionOf,
  imageMimeOf
} from './formats'

describe('extensionOf', () => {
  it('兼容反斜杠与正斜杠路径', () => {
    expect(extensionOf('C:\\目录.v2\\样例.DOCX')).toBe('docx')
    expect(extensionOf('/tmp/a.b/c.MD')).toBe('md')
  })

  it('无扩展名/隐藏文件/结尾点返回 null', () => {
    expect(extensionOf('C:\\dir.with.dots\\file')).toBeNull()
    expect(extensionOf('C:\\a\\.gitignore')).toBeNull()
    expect(extensionOf('C:\\a\\readme.')).toBeNull()
    expect(extensionOf('')).toBeNull()
  })
})

describe('detectKind', () => {
  it('各类扩展名路由到对应预览类型', () => {
    expect(detectKind('a.txt')).toBe('text')
    expect(detectKind('a.md')).toBe('markdown')
    expect(detectKind('a.html')).toBe('html')
    expect(detectKind('a.json')).toBe('json')
    expect(detectKind('a.csv')).toBe('csv')
    expect(detectKind('a.pdf')).toBe('pdf')
    expect(detectKind('a.png')).toBe('image')
    expect(detectKind('a.docx')).toBe('office')
  })

  it('大小写不敏感', () => {
    expect(detectKind('C:\\A.PDF')).toBe('pdf')
    expect(detectKind('C:\\A.MarkDown')).toBe('markdown')
    expect(detectKind('C:\\A.JpG')).toBe('image')
  })

  it('未知/无扩展名返回 unsupported', () => {
    expect(detectKind('a.exe')).toBe('unsupported')
    expect(detectKind('a.tar.gz')).toBe('unsupported')
    expect(detectKind('noext')).toBe('unsupported')
  })
})

describe('accept 与图片 MIME', () => {
  it('accept 覆盖全部支持类型', () => {
    expect(FILE_PREVIEW_ACCEPT).toContain('.txt')
    expect(FILE_PREVIEW_ACCEPT).toContain('.md')
    expect(FILE_PREVIEW_ACCEPT).toContain('.pdf')
    expect(FILE_PREVIEW_ACCEPT).toContain('.docx')
    expect(FILE_PREVIEW_ACCEPT).toContain('.png')
    expect(FILE_PREVIEW_ACCEPT).not.toContain('.exe')
  })

  it('图片 MIME 识别（忽略点与大小写）', () => {
    expect(imageMimeOf('.PNG')).toBe('image/png')
    expect(imageMimeOf('jpeg')).toBe('image/jpeg')
    expect(imageMimeOf('svg')).toBe('image/svg+xml')
    expect(imageMimeOf('txt')).toBeNull()
  })
})
