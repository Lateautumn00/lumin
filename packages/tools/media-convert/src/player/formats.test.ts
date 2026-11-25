import { describe, expect, it } from 'vitest'
import { VIDEO_ACCEPT, extensionOf, isSupportedVideo, mimeOf, videoExtensionOf } from './formats'

describe('extensionOf', () => {
  it('兼容反斜杠/正斜杠、大小写归一', () => {
    expect(extensionOf('C:\\目录.v2\\样例.MP4')).toBe('mp4')
    expect(extensionOf('/tmp/a.b/c.WebM')).toBe('webm')
  })

  it('无扩展名/隐藏文件/结尾点返回 null', () => {
    expect(extensionOf('C:\\dir.with.dots\\file')).toBeNull()
    expect(extensionOf('C:\\a\\.gitignore')).toBeNull()
    expect(extensionOf('C:\\a\\clip.')).toBeNull()
    expect(extensionOf('')).toBeNull()
  })
})

describe('videoExtensionOf / isSupportedVideo', () => {
  it('四种原生格式（大小写不敏感）', () => {
    expect(videoExtensionOf('a.mp4')).toBe('mp4')
    expect(videoExtensionOf('a.WEBM')).toBe('webm')
    expect(videoExtensionOf('a.ogv')).toBe('ogv')
    expect(videoExtensionOf('a.OGG')).toBe('ogg')
  })

  it('不支持格式返回 null', () => {
    expect(videoExtensionOf('a.mkv')).toBeNull()
    expect(videoExtensionOf('a.avi')).toBeNull()
    expect(videoExtensionOf('noext')).toBeNull()
    expect(isSupportedVideo('a.mkv')).toBe(false)
    expect(isSupportedVideo('a.mp4')).toBe(true)
  })
})

describe('accept 与 MIME', () => {
  it('accept 只含四种格式', () => {
    expect(VIDEO_ACCEPT).toBe('.mp4,.webm,.ogv,.ogg')
    expect(VIDEO_ACCEPT).not.toContain('.mkv')
  })

  it('MIME 映射（忽略点与大小写）', () => {
    expect(mimeOf('.MP4')).toBe('video/mp4')
    expect(mimeOf('webm')).toBe('video/webm')
    expect(mimeOf('ogv')).toBe('video/ogg')
    expect(mimeOf('ogg')).toBe('video/ogg')
    expect(mimeOf('mkv')).toBeNull()
  })
})
