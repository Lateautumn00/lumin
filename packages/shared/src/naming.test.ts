/**
 * @file naming.test.ts naming.ts 单测（基名与冲突重命名）
 * @author cuilanchao
 * @date 2026-11-19
 * @description baseName 扩展名剥离、uniqueFileName 冲突级联与大小写不敏感
 */
import { describe, expect, it } from 'vitest'
import { baseName, extensionOf, uniqueFileName } from './naming'

describe('baseName', () => {
  it('剥离最后一个扩展名', () => {
    expect(baseName('photo.jpg')).toBe('photo')
    expect(baseName('my.photo.png')).toBe('my.photo')
  })

  it('保留目录前缀（含中文/空格）', () => {
    expect(baseName('E:\\我的 文档\\a.pdf')).toBe('E:\\我的 文档\\a')
    expect(baseName('/tmp/dir/a.pdf')).toBe('/tmp/dir/a')
  })

  it('目录中的点不当作扩展名', () => {
    expect(baseName('E:\\a.b\\file')).toBe('E:\\a.b\\file')
  })

  it('无扩展名 / 点开头文件原样返回', () => {
    expect(baseName('README')).toBe('README')
    expect(baseName('.gitignore')).toBe('.gitignore')
    expect(baseName('dir/.env')).toBe('dir/.env')
  })
})

describe('extensionOf', () => {
  it('提取并小写扩展名', () => {
    expect(extensionOf('photo.JPG')).toBe('jpg')
    expect(extensionOf('E:\\我的 文档\\a.TiFf')).toBe('tiff')
    expect(extensionOf('/tmp/dir/a.webp')).toBe('webp')
  })

  it('多点数取最后一段', () => {
    expect(extensionOf('my.photo.png')).toBe('png')
  })

  it('目录中的点不算扩展名', () => {
    expect(extensionOf('E:\\a.b\\file')).toBeNull()
  })

  it('无扩展名 / 点开头 / 末尾点返回 null', () => {
    expect(extensionOf('README')).toBeNull()
    expect(extensionOf('.gitignore')).toBeNull()
    expect(extensionOf('dir/.env')).toBeNull()
    expect(extensionOf('broken.')).toBeNull()
  })
})

describe('uniqueFileName', () => {
  it('未占用 → 原样返回', () => {
    expect(uniqueFileName(new Set(), 'a.q75.jpg')).toBe('a.q75.jpg')
  })

  it('占用 → (1) 递增', () => {
    expect(uniqueFileName(new Set(['a.q75.jpg']), 'a.q75.jpg')).toBe('a.q75 (1).jpg')
  })

  it('连续占用 → (2) 级联', () => {
    expect(uniqueFileName(new Set(['a.jpg', 'a (1).jpg']), 'a.jpg')).toBe('a (2).jpg')
  })

  it('Windows 大小写不敏感（A.JPG 挡住 a.jpg）', () => {
    expect(uniqueFileName(new Set(['PHOTO.JPG']), 'photo.jpg')).toBe('photo (1).jpg')
  })

  it('重命名结果本身被占用 → 继续递增', () => {
    expect(uniqueFileName(new Set(['a.jpg', 'a (1).jpg', 'A (1).JPG']), 'a.jpg')).toBe(
      'a (2).jpg'
    )
  })

  it('无扩展名候选也支持冲突重命名', () => {
    expect(uniqueFileName(new Set(['a']), 'a')).toBe('a (1)')
  })
})
