/**
 * @file schema.ts 单测（spec §1/§4 白名单与入参形状）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 扩展名归一、路径扩展名提取、probe/process payload 与结果 schema 正反例
 */
import { describe, expect, it } from 'vitest'
import {
  appendHistoryPayloadSchema,
  collectFolderPayloadSchema,
  collectFolderResultSchema,
  compressOptionsSchema,
  configResultSchema,
  effectOptionsSchema,
  extensionOf,
  gifOptionsSchema,
  historyEntrySchema,
  makeGifPayloadSchema,
  normalizeExtension,
  processPayloadSchema,
  probeResultSchema,
  resizeOptionsSchema
} from './schema'

describe('normalizeExtension（spec §1 白名单）', () => {
  it('大小写不敏感 + 剥点', () => {
    expect(normalizeExtension('.JPG')).toBe('jpg')
    expect(normalizeExtension('PNG')).toBe('png')
    expect(normalizeExtension('WebP')).toBe('webp')
  })

  it('jpeg → jpg 归一', () => {
    expect(normalizeExtension('jpeg')).toBe('jpg')
    expect(normalizeExtension('.JPEG')).toBe('jpg')
  })

  it('白名单全集', () => {
    for (const ext of ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tiff']) {
      expect(normalizeExtension(ext)).toBe(ext)
    }
  })

  it('不在白名单 → null', () => {
    expect(normalizeExtension('exe')).toBeNull()
    expect(normalizeExtension('pdf')).toBeNull()
    expect(normalizeExtension('')).toBeNull()
  })
})

describe('extensionOf（路径提取）', () => {
  it('Windows 路径', () => {
    expect(extensionOf('C:\\Users\\照片 1.JPG')).toBe('jpg')
    expect(extensionOf('E:\\a\\b\\c.jpeg')).toBe('jpg')
  })

  it('POSIX 路径', () => {
    expect(extensionOf('/tmp/photo.webp')).toBe('webp')
  })

  it('无扩展名/点在目录段 → null', () => {
    expect(extensionOf('C:\\dir.v2\\file')).toBeNull()
    expect(extensionOf('file')).toBeNull()
  })

  it('不支持的扩展名 → null', () => {
    expect(extensionOf('C:\\a\\virus.exe')).toBeNull()
  })
})

describe('probeResultSchema', () => {
  it('合法结果通过', () => {
    const result = {
      items: [
        {
          file: 'C:\\a.jpg',
          format: 'mjpeg',
          width: 800,
          height: 600,
          sizeBytes: 123,
          animated: false
        }
      ],
      failures: [{ file: 'C:\\b.exe', code: 'IT_FILE_UNSUPPORTED', message: '不支持该文件' }]
    }
    expect(probeResultSchema.parse(result)).toEqual(result)
  })

  it('尺寸非正整数拒绝', () => {
    expect(() =>
      probeResultSchema.parse({
        items: [{ file: 'a', format: 'png', width: 0, height: 10, sizeBytes: 0, animated: false }],
        failures: []
      })
    ).toThrow()
  })
})

describe('compressOptionsSchema', () => {
  it('质量越界拒绝', () => {
    expect(() => compressOptionsSchema.parse({ quality: 0, target: 'original' })).toThrow()
    expect(() => compressOptionsSchema.parse({ quality: 101, target: 'jpg' })).toThrow()
  })

  it('target 枚举外的值拒绝', () => {
    expect(() => compressOptionsSchema.parse({ quality: 75, target: 'gif' })).toThrow()
    expect(() => compressOptionsSchema.parse({ quality: 75, target: 'bmp' })).toThrow()
  })

  it('常用目标格式（png/jpeg 归一的 jpg/avif）合法', () => {
    for (const target of ['original', 'jpg', 'png', 'webp', 'avif']) {
      expect(compressOptionsSchema.parse({ quality: 75, target })).toEqual({
        quality: 75,
        target
      })
    }
  })
})

describe('resizeOptionsSchema（四模式 discriminated union）', () => {
  it('四模式各合法样例通过', () => {
    expect(
      resizeOptionsSchema.parse({
        mode: 'percent',
        percent: 50,
        noUpscale: true,
        format: 'jpg',
        quality: 75
      })
    ).toMatchObject({ mode: 'percent' })
    expect(
      resizeOptionsSchema.parse({
        mode: 'width',
        width: 1280,
        noUpscale: true,
        format: 'jpg',
        quality: 75
      })
    ).toMatchObject({ mode: 'width' })
    expect(
      resizeOptionsSchema.parse({
        mode: 'height',
        height: 720,
        noUpscale: false,
        format: 'png',
        quality: 75
      })
    ).toMatchObject({ mode: 'height' })
    expect(
      resizeOptionsSchema.parse({
        mode: 'fit',
        fitWidth: 1920,
        fitHeight: 1080,
        noUpscale: true,
        format: 'webp',
        quality: 75
      })
    ).toMatchObject({ mode: 'fit' })
  })

  it('percent 越上限 500 拒绝', () => {
    expect(() =>
      resizeOptionsSchema.parse({
        mode: 'percent',
        percent: 501,
        noUpscale: true,
        format: 'jpg',
        quality: 75
      })
    ).toThrow()
  })

  it('width 超上限 32768 拒绝', () => {
    expect(() =>
      resizeOptionsSchema.parse({
        mode: 'width',
        width: 32769,
        noUpscale: true,
        format: 'jpg',
        quality: 75
      })
    ).toThrow()
  })

  it('未知 mode 拒绝', () => {
    expect(() =>
      resizeOptionsSchema.parse({
        mode: 'scale',
        percent: 50,
        noUpscale: true,
        format: 'jpg',
        quality: 75
      })
    ).toThrow()
  })
})

describe('processPayloadSchema（spec §4 discriminated union）', () => {
  const files = ['C:\\a.jpg']

  it('compress 合法通过', () => {
    expect(
      processPayloadSchema.parse({
        mode: 'compress',
        files,
        outputDir: 'C:\\out',
        options: { quality: 75, target: 'original' }
      })
    ).toMatchObject({ mode: 'compress' })
  })

  it('resize 合法通过', () => {
    expect(
      processPayloadSchema.parse({
        mode: 'resize',
        files,
        outputDir: 'C:\\out',
        options: { mode: 'percent', percent: 50, noUpscale: true, format: 'jpg', quality: 75 }
      })
    ).toMatchObject({ mode: 'resize' })
  })

  it('空文件列表拒绝（主进程兜底 IT_NO_FILES 前置校验）', () => {
    expect(() =>
      processPayloadSchema.parse({
        mode: 'convert',
        files: [],
        outputDir: 'C:\\out',
        options: { format: 'jpg', quality: 75 }
      })
    ).toThrow()
  })

  it('文件数超上限 2000 拒绝（M63 与文件夹递归同口径）', () => {
    const many = Array.from({ length: 2001 }, (_, i) => `C:\\f${i}.jpg`)
    expect(() =>
      processPayloadSchema.parse({
        mode: 'convert',
        files: many,
        outputDir: 'C:\\out',
        options: { format: 'jpg', quality: 75 }
      })
    ).toThrow()
  })

  it('compress options 混入 resize 形状拒绝', () => {
    expect(() =>
      processPayloadSchema.parse({
        mode: 'compress',
        files,
        outputDir: 'C:\\out',
        options: { mode: 'percent', percent: 50, noUpscale: true, format: 'jpg', quality: 75 }
      })
    ).toThrow()
  })

  it('effect 合法通过（M40）', () => {
    expect(
      processPayloadSchema.parse({
        mode: 'effect',
        files,
        outputDir: 'C:\\out',
        options: { effect: 'binary', threshold: 200, quality: 75 }
      })
    ).toMatchObject({ mode: 'effect' })
  })

  it('effect 阈值越界/未知效果拒绝', () => {
    expect(() =>
      effectOptionsSchema.parse({ effect: 'binary', threshold: 256, quality: 75 })
    ).toThrow()
    expect(() =>
      effectOptionsSchema.parse({ effect: 'sepia', threshold: 128, quality: 75 })
    ).toThrow()
  })

  it('effect 调色字段缺省补 0、越界拒绝（M55 §4.55）', () => {
    const parsed = effectOptionsSchema.parse({
      effect: 'grayscale',
      threshold: 128,
      quality: 75
    })
    expect(parsed).toMatchObject({
      brightness: 0,
      contrast: 0,
      saturation: 0,
      sharpen: 0,
      blur: 0
    })
    expect(() =>
      effectOptionsSchema.parse({
        effect: 'grayscale',
        threshold: 128,
        quality: 75,
        brightness: 101
      })
    ).toThrow()
    expect(() =>
      effectOptionsSchema.parse({
        effect: 'grayscale',
        threshold: 128,
        quality: 75,
        sharpen: -1
      })
    ).toThrow()
    expect(() =>
      effectOptionsSchema.parse({
        effect: 'grayscale',
        threshold: 128,
        quality: 75,
        contrast: 1.5
      })
    ).toThrow()
  })
})

describe('gifOptionsSchema / makeGifPayloadSchema（M40，spec §2.5）', () => {
  it('durationMs 50–5000 边界', () => {
    expect(gifOptionsSchema.parse({ durationMs: 50, loop: 0, width: 0 })).toMatchObject({
      durationMs: 50
    })
    expect(gifOptionsSchema.parse({ durationMs: 5000, loop: -1, width: 4096 })).toMatchObject({
      durationMs: 5000
    })
    expect(() => gifOptionsSchema.parse({ durationMs: 49, loop: 0, width: 0 })).toThrow()
    expect(() => gifOptionsSchema.parse({ durationMs: 5001, loop: 0, width: 0 })).toThrow()
  })

  it('loop 仅 -1/0/2–10', () => {
    for (const loop of [-1, 0, 2, 5, 10]) {
      expect(gifOptionsSchema.parse({ durationMs: 500, loop, width: 0 })).toMatchObject({ loop })
    }
    for (const loop of [-2, 1, 11]) {
      expect(() => gifOptionsSchema.parse({ durationMs: 500, loop, width: 0 })).toThrow()
    }
  })

  it('width 仅 0 或 64–4096', () => {
    expect(() => gifOptionsSchema.parse({ durationMs: 500, loop: 0, width: 63 })).toThrow()
    expect(() => gifOptionsSchema.parse({ durationMs: 500, loop: 0, width: 4097 })).toThrow()
    expect(gifOptionsSchema.parse({ durationMs: 500, loop: 0, width: 64 })).toMatchObject({
      width: 64
    })
  })

  it('make-gif 文件数 1–100', () => {
    const one = makeGifPayloadSchema.parse({
      files: ['C:\\a.png'],
      outputDir: 'C:\\out',
      options: { durationMs: 500, loop: 0, width: 0 }
    })
    expect(one.files).toHaveLength(1)
    const many = Array.from({ length: 101 }, (_, i) => `C:\\f${i}.png`)
    expect(() =>
      makeGifPayloadSchema.parse({
        files: many,
        outputDir: 'C:\\out',
        options: { durationMs: 500, loop: 0, width: 0 }
      })
    ).toThrow()
  })
})

describe('M63 增补 schema（文件夹递归 + 处理历史）', () => {
  it('collect-folder 入参非空目录，结果上限 2000', () => {
    expect(collectFolderPayloadSchema.parse({ dir: 'E:\\pics' })).toEqual({ dir: 'E:\\pics' })
    expect(() => collectFolderPayloadSchema.parse({ dir: '' })).toThrow()
    const tooMany = Array.from({ length: 2001 }, (_, i) => `E:\\p\\${i}.jpg`)
    expect(() =>
      collectFolderResultSchema.parse({ files: tooMany, truncated: true })
    ).toThrow()
  })

  it('history 条目字段与上限', () => {
    const entry = {
      at: 1_700_000_000_000,
      mode: 'compress' as const,
      success: 3,
      failed: 1,
      outputDir: 'E:\\out',
      firstOutput: 'E:\\out\\a.jpg'
    }
    expect(historyEntrySchema.parse(entry)).toEqual(entry)
    expect(() => historyEntrySchema.parse({ ...entry, mode: 'other' })).toThrow()
    expect(() => historyEntrySchema.parse({ ...entry, success: -1 })).toThrow()
    const many = Array.from({ length: 21 }, () => entry)
    expect(() => configResultSchema.parse({ outputDir: 'E:\\out', history: many })).toThrow()
  })

  it('append-history 入参不含时间戳', () => {
    const parsed = appendHistoryPayloadSchema.parse({
      mode: 'gif',
      success: 1,
      failed: 0,
      outputDir: 'E:\\out',
      firstOutput: null
    })
    expect(parsed).not.toHaveProperty('at')
  })
})
