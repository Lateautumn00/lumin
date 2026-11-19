import { describe, expect, it } from 'vitest'
import {
  MAX_BATCH_FILES,
  extensionOf,
  isVideoExtension,
  normalizeExtension,
  probePayloadSchema,
  processPayloadSchema,
  setOutputDirPayloadSchema,
  trimRangeError
} from './schema'

describe('扩展名归一', () => {
  it('大小写与点前缀归一', () => {
    expect(normalizeExtension('.MP4')).toBe('mp4')
    expect(normalizeExtension('WebM')).toBe('webm')
    expect(normalizeExtension('mp3')).toBe('mp3')
  })

  it('不在白名单返回 null', () => {
    expect(normalizeExtension('png')).toBeNull()
    expect(normalizeExtension('')).toBeNull()
  })

  it('从路径取扩展名（目录中的点不误判）', () => {
    expect(extensionOf('C:\\a.b\\样例 视频.MKV')).toBe('mkv')
    expect(extensionOf('/tmp/a.b/c')).toBeNull()
    expect(extensionOf('C:\\dir.with.dots\\file')).toBeNull()
  })

  it('视频扩展名判定', () => {
    expect(isVideoExtension('mp4')).toBe(true)
    expect(isVideoExtension('mp3')).toBe(false)
  })
})

describe('probe schema', () => {
  it('文件列表非空且上限', () => {
    expect(probePayloadSchema.safeParse({ files: ['a.mp4'] }).success).toBe(true)
    expect(probePayloadSchema.safeParse({ files: [] }).success).toBe(false)
    const tooMany = Array.from({ length: MAX_BATCH_FILES + 1 }, (_, i) => `f${i}.mp4`)
    expect(probePayloadSchema.safeParse({ files: tooMany }).success).toBe(false)
  })
})

describe('process discriminated union', () => {
  it('四模式合法入参均通过', () => {
    const base = { files: ['a.mp4'], outputDir: 'C:\\out' }
    expect(
      processPayloadSchema.safeParse({
        ...base,
        mode: 'transcode',
        options: { format: 'webm', quality: 'high' }
      }).success
    ).toBe(true)
    expect(
      processPayloadSchema.safeParse({
        ...base,
        mode: 'trim',
        options: { startSec: 0.5, endSec: 2, fastCopy: false }
      }).success
    ).toBe(true)
    expect(
      processPayloadSchema.safeParse({
        ...base,
        mode: 'extract-audio',
        options: { format: 'flac', bitrate: 320 }
      }).success
    ).toBe(true)
    expect(
      processPayloadSchema.safeParse({
        ...base,
        mode: 'compress',
        options: { level: 'medium', maxHeight: 720 }
      }).success
    ).toBe(true)
  })

  it('非法码率 / 分辨率上限被拒', () => {
    const base = { files: ['a.mp4'], outputDir: 'C:\\out' }
    expect(
      processPayloadSchema.safeParse({
        ...base,
        mode: 'extract-audio',
        options: { format: 'mp3', bitrate: 256 }
      }).success
    ).toBe(false)
    expect(
      processPayloadSchema.safeParse({
        ...base,
        mode: 'compress',
        options: { level: 'medium', maxHeight: 999 }
      }).success
    ).toBe(false)
  })

  it('截取结束时间超 24h 被拒', () => {
    expect(
      processPayloadSchema.safeParse({
        files: ['a.mp4'],
        outputDir: 'C:\\out',
        mode: 'trim',
        options: { startSec: 0, endSec: 24 * 60 * 60 + 1, fastCopy: false }
      }).success
    ).toBe(false)
  })
})

describe('trimRangeError', () => {
  it('结束必须大于开始', () => {
    expect(trimRangeError({ startSec: 5, endSec: 5, fastCopy: false })).not.toBeNull()
    expect(trimRangeError({ startSec: 5, endSec: 4, fastCopy: false })).not.toBeNull()
  })

  it('合法区间返回 null', () => {
    expect(trimRangeError({ startSec: 0.5, endSec: 2, fastCopy: true })).toBeNull()
  })

  it('超过 24 小时被拒', () => {
    expect(trimRangeError({ startSec: 0, endSec: 24 * 60 * 60 + 1, fastCopy: false })).toBe(
      '截取片段不能超过 24 小时'
    )
  })
})

describe('set-output-dir schema', () => {
  it('空串被拒', () => {
    expect(setOutputDirPayloadSchema.safeParse({ outputDir: '' }).success).toBe(false)
    expect(setOutputDirPayloadSchema.safeParse({ outputDir: 'C:\\out' }).success).toBe(true)
  })
})
