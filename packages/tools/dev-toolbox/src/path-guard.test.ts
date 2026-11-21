/**
 * @file path-guard.ts 单测：根目录边界与编码异常（静态服务器 403 判定）
 * @author cuilanchao
 * @date 2026-11-21
 */
import { resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveRequestPath } from './path-guard'

const ROOT = resolve('fake-root', 'site')
const PREFIX = ROOT.endsWith(sep) ? ROOT : `${ROOT}${sep}`

describe('resolveRequestPath', () => {
  it('根路径等价于根目录', () => {
    expect(resolveRequestPath(ROOT, '/')).toBe(ROOT)
    expect(resolveRequestPath(ROOT, '')).toBe(ROOT)
  })

  it('普通文件落在根目录内', () => {
    expect(resolveRequestPath(ROOT, '/index.html')).toBe(resolve(ROOT, 'index.html'))
    expect(resolveRequestPath(ROOT, '/sub/page.html')).toBe(resolve(ROOT, 'sub', 'page.html'))
  })

  it('百分号编码的目录名正常解码', () => {
    expect(resolveRequestPath(ROOT, '/%E4%B8%AD%E6%96%87/a.txt')).toBe(
      resolve(ROOT, '中文', 'a.txt')
    )
  })

  it('父目录穿越返回 null', () => {
    expect(resolveRequestPath(ROOT, '/../secret.txt')).toBeNull()
    expect(resolveRequestPath(ROOT, '/sub/../../secret.txt')).toBeNull()
  })

  it('编码后的穿越同样被拒绝', () => {
    expect(resolveRequestPath(ROOT, '/%2e%2e/secret.txt')).toBeNull()
    expect(resolveRequestPath(ROOT, '/sub/%2e%2e/%2e%2e/secret.txt')).toBeNull()
  })

  it('NUL 字节返回 null', () => {
    expect(resolveRequestPath(ROOT, '/a%00b.txt')).toBeNull()
  })

  it('非法百分号编码返回 null', () => {
    expect(resolveRequestPath(ROOT, '/%E0%A4%A')).toBeNull()
  })

  it('深层合法路径仍以根目录前缀开头', () => {
    const target = resolveRequestPath(ROOT, '/a/b/c/d.txt')
    expect(target).not.toBeNull()
    expect(target?.startsWith(PREFIX)).toBe(true)
  })
})
