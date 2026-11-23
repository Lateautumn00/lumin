import { describe, expect, it } from 'vitest'
import {
  canRemux,
  codecSelectable,
  containerCodecError,
  needsFaststart,
  normalizeAudioCodec,
  normalizeVideoCodec,
  remuxError,
  resolutionError
} from './compat'

describe('容器能力', () => {
  it('H.265 仅 mp4/m4v/mov/mkv；faststart 仅 mp4/m4v/mov', () => {
    expect(codecSelectable('mp4')).toBe(true)
    expect(codecSelectable('mkv')).toBe(true)
    expect(codecSelectable('mov')).toBe(true)
    expect(codecSelectable('m4v')).toBe(true)
    expect(codecSelectable('webm')).toBe(false)
    expect(codecSelectable('avi')).toBe(false)
    expect(needsFaststart('mp4')).toBe(true)
    expect(needsFaststart('m4v')).toBe(true)
    expect(needsFaststart('mov')).toBe(true)
    expect(needsFaststart('mkv')).toBe(false)
    expect(needsFaststart('ts')).toBe(false)
  })

  it('容器 × 编码器组合校验', () => {
    expect(containerCodecError('mp4', 'h265')).toBeNull()
    expect(containerCodecError('mkv', 'h265')).toBeNull()
    expect(containerCodecError('mp4', 'h264')).toBeNull()
    expect(containerCodecError('webm', 'h265')).not.toBeNull()
    expect(containerCodecError('avi', 'h265')).not.toBeNull()
    expect(containerCodecError('ts', 'h265')).not.toBeNull()
    expect(containerCodecError('flv', 'h265')).not.toBeNull()
  })
})

describe('编码名归一', () => {
  it('视频编码别名', () => {
    expect(normalizeVideoCodec('hevc')).toBe('h265')
    expect(normalizeVideoCodec('HEVC')).toBe('h265')
    expect(normalizeVideoCodec('hvc1')).toBe('h265')
    expect(normalizeVideoCodec('avc1')).toBe('h264')
    expect(normalizeVideoCodec('vp9')).toBe('vp9')
  })

  it('音频编码别名', () => {
    expect(normalizeAudioCodec('aac')).toBe('aac')
    expect(normalizeAudioCodec('mp3float')).toBe('mp3')
    expect(normalizeAudioCodec('pcm_s24le')).toBe('pcm_s16le')
    expect(normalizeAudioCodec('pcm_s16le')).toBe('pcm_s16le')
    expect(normalizeAudioCodec('opus')).toBe('opus')
  })
})

describe('canRemux', () => {
  it('常见兼容组合', () => {
    expect(canRemux('mp4', 'h264', 'aac')).toBe(true)
    expect(canRemux('mp4', 'hevc', 'aac')).toBe(true)
    expect(canRemux('mkv', 'vp9', 'opus')).toBe(true)
    expect(canRemux('webm', 'vp9', 'opus')).toBe(true)
    expect(canRemux('avi', 'h264', 'mp3')).toBe(true)
    expect(canRemux('ts', 'hevc', 'aac')).toBe(true)
  })

  it('不兼容组合', () => {
    expect(canRemux('mp4', 'vp9', 'opus')).toBe(false)
    expect(canRemux('webm', 'h264', 'aac')).toBe(false)
    expect(canRemux('avi', 'h264', 'aac')).toBe(false)
    expect(canRemux('flv', 'h265', 'aac')).toBe(false)
  })

  it('无视频轨一律不可 remux；无音频轨只看视频', () => {
    expect(canRemux('mp4', null, 'aac')).toBe(false)
    expect(canRemux('mp4', 'h264', null)).toBe(true)
  })
})

describe('remuxError', () => {
  it('兼容返回 null，不兼容给中文原因', () => {
    expect(remuxError('mp4', 'h264', 'aac')).toBeNull()
    const message = remuxError('webm', 'h264', 'aac')
    expect(message).not.toBeNull()
    expect(message).toContain('不兼容')
  })
})

describe('resolutionError', () => {
  it('原始 / 高度上限不校验', () => {
    expect(resolutionError({ kind: 'original' })).toBeNull()
    expect(resolutionError({ kind: 'maxHeight', height: 720 })).toBeNull()
  })

  it('自定义偶数通过、奇数与越界拒绝', () => {
    expect(resolutionError({ kind: 'custom', width: 640, height: 360 })).toBeNull()
    expect(resolutionError({ kind: 'custom', width: 641, height: 360 })).not.toBeNull()
    expect(resolutionError({ kind: 'custom', width: 640, height: 361 })).not.toBeNull()
    expect(resolutionError({ kind: 'custom', width: 10, height: 360 })).not.toBeNull()
    expect(resolutionError({ kind: 'custom', width: 8000, height: 360 })).not.toBeNull()
  })
})
