import { describe, expect, it } from 'vitest'
import {
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

describe('四模式命名', () => {
  it('转码 / 提取 / 压缩', () => {
    expect(buildTranscodeName('demo.mp4', 'webm')).toBe('demo.webm')
    expect(buildExtractAudioName('demo.mkv', 'mp3')).toBe('demo.audio.mp3')
    expect(buildCompressName('demo.mov', 'medium')).toBe('demo.cmedium.mp4')
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
