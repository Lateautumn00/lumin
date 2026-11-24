import { describe, expect, it } from 'vitest'
import { errorMessage, isRetryable, playbackError, toolError } from './errors'

describe('toolError', () => {
  it('缺省 detail 时不带字段', () => {
    expect(toolError('VP_NOT_FOUND')).toEqual({
      code: 'VP_NOT_FOUND',
      message: '文件不存在或无法访问'
    })
  })

  it('detail 为空串时不带字段', () => {
    expect(toolError('VP_RESOLVE_FAILED', '')).toEqual({
      code: 'VP_RESOLVE_FAILED',
      message: '无法解析视频文件'
    })
  })

  it('带 detail 时原样保留', () => {
    expect(toolError('VP_UNSUPPORTED_FORMAT', 'mkv')).toEqual({
      code: 'VP_UNSUPPORTED_FORMAT',
      message: '不支持该视频格式，请先用「音视频处理」转换',
      detail: 'mkv'
    })
  })
})

describe('errorMessage / isRetryable', () => {
  it('已知码取文案，未知码回退原码', () => {
    expect(errorMessage('VP_PLAYBACK_FAILED')).toBe('视频解码失败，文件可能已损坏或编码不受支持')
    expect(errorMessage('VP_CODEC_UNSUPPORTED')).toContain('文件未必损坏')
    expect(errorMessage('SOMETHING_ELSE')).toBe('SOMETHING_ELSE')
  })

  it('解析/播放/读取失败可重试，编码不支持不可重试', () => {
    expect(isRetryable('VP_RESOLVE_FAILED')).toBe(true)
    expect(isRetryable('VP_PLAYBACK_FAILED')).toBe(true)
    expect(isRetryable('VP_READ_FAILED')).toBe(true)
    expect(isRetryable('VP_CODEC_UNSUPPORTED')).toBe(false)
    expect(isRetryable('VP_UNSUPPORTED_FORMAT')).toBe(false)
    expect(isRetryable('VP_NOT_FOUND')).toBe(false)
    expect(isRetryable('UNKNOWN')).toBe(false)
  })
})

describe('playbackError（MediaError code 分类映射）', () => {
  it('ABORTED（1）返回 null 不提示', () => {
    expect(playbackError(1)).toBeNull()
    expect(playbackError(1, 'interrupted')).toBeNull()
  })

  it('NETWORK（2）→ VP_READ_FAILED（可重试，非损坏）', () => {
    const err = playbackError(2)
    expect(err?.code).toBe('VP_READ_FAILED')
    expect(err?.detail).toBe('MediaError 2（NETWORK）')
    expect(isRetryable(err?.code ?? '')).toBe(true)
  })

  it('DECODE（3）→ VP_PLAYBACK_FAILED（解码失败，不武断断言损坏）', () => {
    const err = playbackError(3)
    expect(err?.code).toBe('VP_PLAYBACK_FAILED')
    expect(err?.message).not.toContain('一定')
    expect(err?.detail).toBe('MediaError 3（DECODE）')
  })

  it('SRC_NOT_SUPPORTED（4）→ VP_CODEC_UNSUPPORTED（编码不支持 ≠ 文件损坏）', () => {
    const err = playbackError(4, 'Format error')
    expect(err?.code).toBe('VP_CODEC_UNSUPPORTED')
    expect(err?.message).toContain('文件未必损坏')
    expect(err?.message).not.toContain('已损坏，')
    expect(err?.detail).toBe('MediaError 4（SRC_NOT_SUPPORTED）：Format error')
    expect(isRetryable(err?.code ?? '')).toBe(false)
  })

  it('SRC_NOT_SUPPORTED（4）但文案为 URL 安全校验拦截 → VP_READ_FAILED（可重试）', () => {
    const raw = 'MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check'
    const err = playbackError(4, raw)
    expect(err?.code).toBe('VP_READ_FAILED')
    expect(err?.detail).toBe(`MediaError 4（SRC_NOT_SUPPORTED）：${raw}`)
    expect(isRetryable(err?.code ?? '')).toBe(true)
  })

  it('code 缺省 → VP_PLAYBACK_FAILED，detail 标未知', () => {
    const err = playbackError(undefined)
    expect(err?.code).toBe('VP_PLAYBACK_FAILED')
    expect(err?.detail).toBe('MediaError 未知')
  })

  it('code 无标签（如未知数值）→ detail 不带括号标签', () => {
    const err = playbackError(7, 'weird')
    expect(err?.code).toBe('VP_PLAYBACK_FAILED')
    expect(err?.detail).toBe('MediaError 7：weird')
  })

  it('raw 为空串 → detail 只有 code 头', () => {
    expect(playbackError(4, '')?.detail).toBe('MediaError 4（SRC_NOT_SUPPORTED）')
  })
})
