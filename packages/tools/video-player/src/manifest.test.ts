import { describe, expect, it } from 'vitest'
import { manifest } from './manifest'

describe('video-player manifest', () => {
  it('id/名称/分类/顺序/图标/版本符合 spec', () => {
    expect(manifest.id).toBe('video-player')
    expect(manifest.name).toBe('视频播放器')
    expect(manifest.category).toBe('media')
    expect(manifest.order).toBe(45)
    expect(manifest.icon).toBe('play')
    expect(manifest.version).toBe('0.1.0')
  })
})
