/**
 * @file manifest 单测（清单字段锁定，防误改）
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import { manifest } from './manifest'

describe('manifest', () => {
  it('暴露稳定的工具清单字段', () => {
    expect(manifest.id).toBe('markdown-tool')
    expect(manifest.name).toBe('Markdown 工具')
    expect(manifest.icon).toBe('file-code')
    expect(manifest.category).toBe('document')
    expect(manifest.order).toBe(80)
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.description).toContain('Markdown')
  })
})
