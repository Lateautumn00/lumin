/**
 * @file errors.ts 单测（错误码构造与重试判定）
 * @author cuilanchao
 * @date 2026-11-19
 * @description toolError detail 缺省/空串折叠 + isRetryable 白名单判定（spec §5）
 */
import { describe, expect, it } from 'vitest'
import { isRetryable, toolError, VIDEO_DOWNLOAD_ERROR_CODES } from './errors'

describe('toolError', () => {
  it('无 detail → 不带 detail 字段；空串同折叠', () => {
    expect(toolError('VD_URL_INVALID')).toEqual({
      code: 'VD_URL_INVALID',
      message: '链接格式不正确，请检查后重试'
    })
    expect(toolError('VD_PROBE_FAILED', '')).toEqual({
      code: 'VD_PROBE_FAILED',
      message: '无法获取视频信息，请确认链接可公开访问'
    })
  })

  it('有 detail → 透出技术细节', () => {
    expect(toolError('VD_DOWNLOAD_FAILED', 'stderr tail')).toEqual({
      code: 'VD_DOWNLOAD_FAILED',
      message: '下载失败，请查看详情或稍后重试',
      detail: 'stderr tail'
    })
  })

  it('错误码全集与文案一一对应（新增码漏文案在构造时即为 undefined 可被发现）', () => {
    for (const code of VIDEO_DOWNLOAD_ERROR_CODES) {
      expect(typeof toolError(code).message).toBe('string')
    }
  })
})

describe('isRetryable', () => {
  it('白名单四码可重试', () => {
    expect(isRetryable('VD_PROBE_FAILED')).toBe(true)
    expect(isRetryable('VD_OUTPUT_WRITE_FAILED')).toBe(true)
    expect(isRetryable('VD_DOWNLOAD_FAILED')).toBe(true)
    expect(isRetryable('VD_HISTORY_FAILED')).toBe(true)
  })

  it('非白名单与未知码不可重试', () => {
    expect(isRetryable('VD_URL_INVALID')).toBe(false)
    expect(isRetryable('VD_COOKIE_STORE_UNAVAILABLE')).toBe(false)
    expect(isRetryable('NOT_A_CODE')).toBe(false)
  })
})
