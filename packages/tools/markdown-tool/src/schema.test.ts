/**
 * @file IPC schema 单测（合法/非法载荷）
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import {
  configResultSchema,
  MAX_SAVE_CONTENT_CHARS,
  savePayloadSchema,
  saveResultSchema,
  setOutputDirPayloadSchema
} from './schema'

describe('savePayloadSchema', () => {
  it('接受合法载荷并保留字段', () => {
    const parsed = savePayloadSchema.parse({
      outputDir: 'C:\\out',
      baseName: '文档',
      extension: 'html',
      content: '<h1>x</h1>'
    })
    expect(parsed.extension).toBe('html')
  })

  it('拒绝未知扩展名、空文件名与空内容', () => {
    const base = { outputDir: 'C:\\out', baseName: 'x', extension: 'html', content: 'x' }
    expect(savePayloadSchema.safeParse({ ...base, extension: 'md' }).success).toBe(false)
    expect(savePayloadSchema.safeParse({ ...base, baseName: '' }).success).toBe(false)
    expect(savePayloadSchema.safeParse({ ...base, content: '' }).success).toBe(false)
    expect(savePayloadSchema.safeParse({ ...base, outputDir: '' }).success).toBe(false)
  })

  it('内容超过上限被拒绝', () => {
    const result = savePayloadSchema.safeParse({
      outputDir: 'C:\\out',
      baseName: 'x',
      extension: 'html',
      content: 'a'.repeat(MAX_SAVE_CONTENT_CHARS + 1)
    })
    expect(result.success).toBe(false)
  })
})

describe('setOutputDirPayloadSchema', () => {
  it('拒绝空目录与超长目录', () => {
    expect(setOutputDirPayloadSchema.safeParse({ outputDir: '' }).success).toBe(false)
    expect(setOutputDirPayloadSchema.safeParse({ outputDir: 'a'.repeat(4097) }).success).toBe(false)
    expect(setOutputDirPayloadSchema.parse({ outputDir: 'C:\\out' })).toEqual({
      outputDir: 'C:\\out'
    })
  })
})

describe('configResultSchema / saveResultSchema', () => {
  it('接受合法结果、拒绝空值', () => {
    expect(configResultSchema.parse({ outputDir: 'C:\\out' }).outputDir).toBe('C:\\out')
    expect(configResultSchema.safeParse({ outputDir: '' }).success).toBe(false)
    expect(saveResultSchema.parse({ output: 'C:\\out\\a.html' }).output).toContain('a.html')
    expect(saveResultSchema.safeParse({ output: '' }).success).toBe(false)
  })
})
