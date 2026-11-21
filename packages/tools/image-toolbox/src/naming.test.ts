/**
 * @file naming.ts 单测（spec §6 命名模板与冲突重命名）
 * @author cuilanchao
 * @date 2026-11-18
 * @description compressOutputExt 原格式映射、buildOutputName 三模式模板、
 *              uniqueName 冲突级联与 Windows 大小写不敏感
 */
import { describe, expect, it } from 'vitest'
import { buildOutputName, compressOutputExt, uniqueName } from './naming'

describe('compressOutputExt（spec §2.1：原格式口径）', () => {
  it('gif「原格式」→ webp（拍板：动画保留）', () => {
    expect(compressOutputExt('gif')).toBe('webp')
  })

  it('webp → webp', () => {
    expect(compressOutputExt('webp')).toBe('webp')
  })

  it('jpeg → jpg（归一）', () => {
    expect(compressOutputExt('jpeg')).toBe('jpg')
    expect(compressOutputExt('jpg')).toBe('jpg')
  })

  it('png/avif 保持', () => {
    expect(compressOutputExt('png')).toBe('png')
    expect(compressOutputExt('avif')).toBe('avif')
  })

  it('bmp/tiff 保持直出', () => {
    expect(compressOutputExt('bmp')).toBe('bmp')
    expect(compressOutputExt('tiff')).toBe('tiff')
  })

  it('未知扩展名兜底 jpg（不预期路径）', () => {
    expect(compressOutputExt('heic')).toBe('jpg')
  })
})

describe('buildOutputName（spec §6 模板）', () => {
  it('压缩：{原名}.q{质量}.{ext}', () => {
    expect(
      buildOutputName({ inputName: 'photo.jpg', mode: 'compress', quality: 75, ext: 'jpg' })
    ).toBe('photo.q75.jpg')
  })

  it('转换：{原名}.{ext}（多扩展名文件取最后一个点前）', () => {
    expect(
      buildOutputName({ inputName: 'my.photo.png', mode: 'convert', quality: 75, ext: 'avif' })
    ).toBe('my.photo.avif')
  })

  it('缩放-百分比：{原名}.{p}%.{ext}', () => {
    expect(
      buildOutputName({
        inputName: 'photo.jpg',
        mode: 'resize',
        quality: 75,
        size: { kind: 'percent', percent: 50 },
        ext: 'jpg'
      })
    ).toBe('photo.50%.jpg')
  })

  it('缩放-宽/高/适配框', () => {
    expect(
      buildOutputName({
        inputName: 'a.png',
        mode: 'resize',
        size: { kind: 'width', width: 1280 },
        ext: 'webp'
      })
    ).toBe('a.w1280.webp')
    expect(
      buildOutputName({
        inputName: 'a.png',
        mode: 'resize',
        size: { kind: 'height', height: 720 },
        ext: 'webp'
      })
    ).toBe('a.h720.webp')
    expect(
      buildOutputName({
        inputName: 'a.png',
        mode: 'resize',
        size: { kind: 'fit', fitWidth: 1920, fitHeight: 1080 },
        ext: 'webp'
      })
    ).toBe('a.fit1920x1080.webp')
  })

  it('无扩展名输入 → 整名为主名', () => {
    expect(buildOutputName({ inputName: 'README', mode: 'convert', ext: 'png' })).toBe('README.png')
  })

  it('调整（M40）：灰度/反色/黑白二值标签', () => {
    expect(
      buildOutputName({
        inputName: 'photo.jpg',
        mode: 'effect',
        effect: { kind: 'grayscale' },
        ext: 'jpg'
      })
    ).toBe('photo.gray.jpg')
    expect(
      buildOutputName({
        inputName: 'photo.png',
        mode: 'effect',
        effect: { kind: 'invert' },
        ext: 'png'
      })
    ).toBe('photo.invert.png')
    expect(
      buildOutputName({
        inputName: 'photo.webp',
        mode: 'effect',
        effect: { kind: 'binary', threshold: 200 },
        ext: 'webp'
      })
    ).toBe('photo.bw200.webp')
  })

  it('调整缺少 effect → 仅加扩展名（兜底路径）', () => {
    expect(buildOutputName({ inputName: 'a.jpg', mode: 'effect', ext: 'jpg' })).toBe('a.jpg')
  })
})

describe('uniqueName（spec §6 冲突自动重命名）', () => {
  it('未占用 → 原样返回', () => {
    expect(uniqueName(new Set(), 'a.q75.jpg')).toBe('a.q75.jpg')
  })

  it('占用 → (1) 递增', () => {
    const existing = new Set(['a.q75.jpg'])
    expect(uniqueName(existing, 'a.q75.jpg')).toBe('a.q75 (1).jpg')
  })

  it('连续占用 → (2) 级联', () => {
    const existing = new Set(['a.jpg', 'a (1).jpg'])
    expect(uniqueName(existing, 'a.jpg')).toBe('a (2).jpg')
  })

  it('Windows 大小写不敏感（A.JPG 挡住 a.jpg）', () => {
    const existing = new Set(['PHOTO.JPG'])
    expect(uniqueName(existing, 'photo.jpg')).toBe('photo (1).jpg')
  })

  it('重命名结果本身被占用 → 继续递增', () => {
    const existing = new Set(['a.jpg', 'a (1).jpg', 'a (1).JPG'.toLowerCase()])
    expect(uniqueName(existing, 'a.jpg')).toBe('a (2).jpg')
  })

  it('无扩展名候选也支持冲突重命名', () => {
    const existing = new Set(['a'])
    expect(uniqueName(existing, 'a')).toBe('a (1)')
  })
})
