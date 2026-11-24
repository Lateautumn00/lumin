/**
 * @file media-url.test.ts 媒体协议 URL 编解码单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖 Windows/UNC 路径以及中文、空格、#、孤立代理对的往返，
 *              并锁定非法 URL 一律返回 null（主进程据此 404）。
 */
import { describe, expect, it } from 'vitest'
import { fromMediaUrl, MEDIA_URL_SCHEME, toMediaUrl } from './media-url'

describe('toMediaUrl', () => {
  it('生成固定前缀的 lumin-media URL', () => {
    const url = toMediaUrl('C:\\videos\\a.mp4')
    expect(url.startsWith(`${MEDIA_URL_SCHEME}://local/`)).toBe(true)
    // token 仅含 base64url 字符（无 + / = 与路径字符）
    expect(url.slice(`${MEDIA_URL_SCHEME}://local/`.length)).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('不同路径生成不同 token', () => {
    expect(toMediaUrl('C:\\a.mp4')).not.toBe(toMediaUrl('C:\\b.mp4'))
  })
})

describe('fromMediaUrl', () => {
  it('Windows 路径往返（中文 / 空格 / # / 反斜杠）', () => {
    const paths = [
      'C:\\videos\\a.mp4',
      'E:\\我的 文档\\演示 视频 #1.webm',
      'D:\\a.b\\c d\\e.ogv',
      '\\\\server\\share\\媒体\\片段.mp4'
    ]
    for (const path of paths) {
      expect(fromMediaUrl(toMediaUrl(path))).toBe(path)
    }
  })

  it('特殊字符（% ? & 单双引号 换行）与孤立代理对无损往返', () => {
    const paths = [
      'C:\\100%\\a?b&c=d.mp4',
      `C:\\quote' "\\a.mp4`,
      'C:\\dir\nline\\a.mp4',
      `C:\\lone-surrogate-\ud800\\a.mp4`
    ]
    for (const path of paths) {
      expect(fromMediaUrl(toMediaUrl(path))).toBe(path)
    }
  })

  it('scheme / host 大小写不敏感', () => {
    const token = toMediaUrl('C:\\a.mp4').slice(`${MEDIA_URL_SCHEME}://local/`.length)
    expect(fromMediaUrl(`LUMIN-MEDIA://LOCAL/${token}`)).toBe('C:\\a.mp4')
  })

  it('非本协议 / host 不符 / 空 token → null', () => {
    expect(fromMediaUrl('file:///C:/a.mp4')).toBeNull()
    expect(fromMediaUrl('http://localhost:5173/a.mp4')).toBeNull()
    expect(fromMediaUrl('lumin-media://remote/AAAA')).toBeNull()
    expect(fromMediaUrl('lumin-media://local/')).toBeNull()
    expect(fromMediaUrl('lumin-media://local')).toBeNull()
  })

  it('token 非法（字符 / 长度 / 查询串）→ null', () => {
    expect(fromMediaUrl('lumin-media://local/abc$def')).toBeNull()
    expect(fromMediaUrl('lumin-media://local/abcde')).toBeNull()
    expect(fromMediaUrl('lumin-media://local/AAAA?x=1')).toBeNull()
    expect(fromMediaUrl('lumin-media://local/AAAA#frag')).toBeNull()
    // 解码后 1 字节（非偶数字节，不是合法的 UTF-16LE 编码）
    expect(fromMediaUrl('lumin-media://local/QQ')).toBeNull()
  })
})
