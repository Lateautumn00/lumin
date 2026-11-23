import { describe, expect, it } from 'vitest'
import {
  buildAudioConvertName,
  buildCompressName,
  buildExtractAudioName,
  buildTranscodeName,
  buildTrimName,
  stemOf,
  uniqueName
} from './naming'

describe('stemOf', () => {
  it('去最后扩展名', () => {
    expect(stemOf('样例 视频.mp4')).toBe('样例 视频')
    expect(stemOf('a.b.c.mkv')).toBe('a.b.c')
    expect(stemOf('noext')).toBe('noext')
  })
})

describe('五模式命名', () => {
  it('转码 / 提取 / 音频互转 / 压缩', () => {
    expect(buildTranscodeName('demo.mp4', 'webm')).toBe('demo.webm')
    expect(buildExtractAudioName('demo.mkv', 'mp3')).toBe('demo.audio.mp3')
    expect(buildAudioConvertName('样例 音频.wav', 'flac')).toBe('样例 音频.flac')
    expect(buildCompressName('demo.mov', 'medium')).toBe('demo.cmedium.mp4')
  })

  it('remux 加 .remux 中缀防同名覆盖', () => {
    expect(buildTranscodeName('demo.mp4', 'mkv', 'remux')).toBe('demo.remux.mkv')
    expect(buildTranscodeName('demo.mp4', 'mp4', 'remux')).toBe('demo.remux.mp4')
  })

  it('截取带时间标签', () => {
    expect(buildTrimName('demo.mp4', 10, 30)).toBe('demo.cut_000010-000030.mp4')
    expect(buildTrimName('demo.mp4', 0.5, 2.4)).toBe('demo.cut_000001-000002.mp4')
  })
})

describe('uniqueName', () => {
  it('冲突递增重命名（大小写不敏感集合）', () => {
    const existing = new Set(['demo.webm'])
    const name = uniqueName(existing, 'demo.webm')
    expect(name).toBe('demo (1).webm')
  })
})
