/**
 * @file mime.ts 单测：常见类型、大小写、未知扩展名回退
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_MIME_TYPE, mimeTypeOf } from './mime'

describe('mimeTypeOf', () => {
  it('html/css/js/json 带 charset', () => {
    expect(mimeTypeOf('index.html')).toBe('text/html; charset=utf-8')
    expect(mimeTypeOf('app.css')).toBe('text/css; charset=utf-8')
    expect(mimeTypeOf('main.js')).toBe('text/javascript; charset=utf-8')
    expect(mimeTypeOf('data.json')).toBe('application/json; charset=utf-8')
  })

  it('扩展名大小写不敏感', () => {
    expect(mimeTypeOf('MAIN.JS')).toBe('text/javascript; charset=utf-8')
    expect(mimeTypeOf('Logo.PNG')).toBe('image/png')
  })

  it('字体与 wasm 类型正确', () => {
    expect(mimeTypeOf('font.woff2')).toBe('font/woff2')
    expect(mimeTypeOf('core.wasm')).toBe('application/wasm')
    expect(mimeTypeOf('icon.svg')).toBe('image/svg+xml')
  })

  it('无扩展名与未知扩展名回退 octet-stream', () => {
    expect(mimeTypeOf('LICENSE')).toBe(DEFAULT_MIME_TYPE)
    expect(mimeTypeOf('archive.xyz')).toBe(DEFAULT_MIME_TYPE)
    expect(mimeTypeOf('.gitignore')).toBe(DEFAULT_MIME_TYPE)
  })
})
