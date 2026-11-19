/**
 * @file generate 单测（样式钳制 / dataURL / SVG）
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import { createQrOptions, dataUrlToBase64, toPngDataUrl, toSvg } from './generate'
import type { QrStyle } from '../schema'

const style: QrStyle = {
  errorCorrection: 'M',
  size: 512,
  margin: 4,
  foreground: '#000000',
  background: '#ffffff'
}

describe('createQrOptions', () => {
  it('尺寸/边距越界钳制并取整', () => {
    expect(createQrOptions({ ...style, size: 100, margin: -2 })).toMatchObject({
      width: 128,
      margin: 0
    })
    expect(createQrOptions({ ...style, size: 5000, margin: 20 })).toMatchObject({
      width: 2048,
      margin: 10
    })
    expect(createQrOptions({ ...style, size: 512.6 }).width).toBe(513)
  })

  it('颜色与纠错级别透传', () => {
    expect(createQrOptions({ ...style, foreground: '#FF0000', errorCorrection: 'H' })).toMatchObject({
      color: { dark: '#FF0000', light: '#ffffff' },
      errorCorrectionLevel: 'H'
    })
  })
})

describe('dataUrlToBase64', () => {
  it('取逗号之后片段', () => {
    expect(dataUrlToBase64('data:image/png;base64,AAAA')).toBe('AAAA')
  })

  it('无逗号原样返回', () => {
    expect(dataUrlToBase64('AAAA')).toBe('AAAA')
  })
})

describe('toPngDataUrl / toSvg', () => {
  it('PNG dataURL 前缀正确', async () => {
    const url = await toPngDataUrl('hello', style)
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    expect(dataUrlToBase64(url).length).toBeGreaterThan(10)
  })

  it('SVG 文本包含 svg 根元素', async () => {
    const svg = await toSvg('hello', style)
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
  })
})
