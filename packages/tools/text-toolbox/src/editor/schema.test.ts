import { describe, expect, it } from 'vitest'
import {
  eolKindSchema,
  openPayloadSchema,
  openResultSchema,
  saveAsPayloadSchema,
  saveAsResultSchema,
  savePayloadSchema,
  saveResultSchema,
  textEncodingSchema
} from './schema'

const baseSave = {
  path: 'C:\\a.txt',
  content: 'hello',
  encoding: 'utf8',
  eol: 'lf'
}

describe('schema', () => {
  it('编码枚举覆盖 5 种', () => {
    expect(textEncodingSchema.options).toEqual(['utf8', 'utf8-bom', 'utf16le', 'utf16be', 'gbk'])
  })

  it('EOL 枚举覆盖 3 种', () => {
    expect(eolKindSchema.options).toEqual(['lf', 'crlf', 'cr'])
  })

  it('open 入参校验', () => {
    expect(openPayloadSchema.parse({ path: 'C:\\a.txt' })).toEqual({ path: 'C:\\a.txt' })
    expect(openPayloadSchema.safeParse({ path: '' }).success).toBe(false)
    expect(openPayloadSchema.safeParse({}).success).toBe(false)
  })

  it('open 结果校验', () => {
    const result = {
      path: 'C:\\a.txt',
      name: 'a.txt',
      size: 5,
      mtimeMs: 1730000000000,
      content: 'hello',
      encoding: 'utf8',
      eol: 'lf',
      readOnly: false
    }
    expect(openResultSchema.parse(result)).toEqual(result)
    expect(openResultSchema.safeParse({ ...result, size: -1 }).success).toBe(false)
    expect(openResultSchema.safeParse({ ...result, encoding: 'utf32' }).success).toBe(false)
  })

  it('save 入参可选 mtime/force', () => {
    expect(savePayloadSchema.safeParse(baseSave).success).toBe(true)
    expect(
      savePayloadSchema.safeParse({ ...baseSave, expectedMtimeMs: 1, force: true }).success
    ).toBe(true)
    expect(savePayloadSchema.safeParse({ ...baseSave, force: 'yes' }).success).toBe(false)
    expect(savePayloadSchema.safeParse({ ...baseSave, eol: 'x' }).success).toBe(false)
  })

  it('save 结果校验', () => {
    expect(saveResultSchema.parse({ mtimeMs: 2 })).toEqual({ mtimeMs: 2 })
    expect(saveResultSchema.safeParse({ mtimeMs: -2 }).success).toBe(false)
  })

  it('save-as 入参/结果校验', () => {
    const payload = { dir: 'C:\\docs', name: 'b.txt', content: 'x', encoding: 'gbk', eol: 'crlf' }
    expect(saveAsPayloadSchema.parse(payload)).toEqual(payload)
    expect(saveAsPayloadSchema.safeParse({ ...payload, name: '' }).success).toBe(false)
    expect(saveAsResultSchema.parse({ path: 'C:\\docs\\b.txt', mtimeMs: 3 })).toEqual({
      path: 'C:\\docs\\b.txt',
      mtimeMs: 3
    })
  })
})
