import { describe, expect, it } from 'vitest'
import {
  MAX_TEXT_BYTES,
  assetUrlPayloadSchema,
  convertOfficeResultSchema,
  inspectPayloadSchema,
  inspectResultSchema,
  readTextPayloadSchema,
  readTextResultSchema,
  releasePreviewResultSchema,
  renderPdfPagePayloadSchema,
  renderPdfPageResultSchema,
  setSofficePathPayloadSchema,
  sofficeStatusResultSchema
} from './schema'

describe('inspect schema', () => {
  it('合法载荷与结果', () => {
    expect(inspectPayloadSchema.safeParse({ path: 'C:\\a.pdf' }).success).toBe(true)
    expect(inspectPayloadSchema.safeParse({ path: '' }).success).toBe(false)
    expect(inspectPayloadSchema.safeParse({ path: 'x'.repeat(4097) }).success).toBe(false)

    expect(
      inspectResultSchema.safeParse({
        previewId: 'fp-1',
        kind: 'pdf',
        ext: 'pdf',
        name: 'a.pdf',
        size: 12,
        pageCount: 3
      }).success
    ).toBe(true)
    expect(
      inspectResultSchema.safeParse({
        previewId: 'fp-1',
        kind: 'unsupported',
        ext: 'exe',
        name: 'a.exe',
        size: 1
      }).success
    ).toBe(false)
    expect(
      inspectResultSchema.safeParse({
        previewId: 'fp-1',
        kind: 'pdf',
        ext: 'pdf',
        name: 'a.pdf',
        size: -1
      }).success
    ).toBe(false)
  })
})

describe('read-text schema', () => {
  it('maxBytes 上限 2MiB', () => {
    expect(readTextPayloadSchema.safeParse({ path: 'a.txt' }).success).toBe(true)
    expect(
      readTextPayloadSchema.safeParse({ path: 'a.txt', maxBytes: MAX_TEXT_BYTES }).success
    ).toBe(true)
    expect(
      readTextPayloadSchema.safeParse({ path: 'a.txt', maxBytes: MAX_TEXT_BYTES + 1 }).success
    ).toBe(false)
    expect(readTextPayloadSchema.safeParse({ path: 'a.txt', maxBytes: 0 }).success).toBe(false)
  })

  it('结果编码与 EOL 枚举', () => {
    expect(
      readTextResultSchema.safeParse({
        text: '你好',
        encoding: 'gbk',
        eol: '\r\n',
        truncated: true
      }).success
    ).toBe(true)
    expect(
      readTextResultSchema.safeParse({
        text: '',
        encoding: 'latin1',
        eol: '\n',
        truncated: false
      }).success
    ).toBe(false)
    expect(
      readTextResultSchema.safeParse({
        text: '',
        encoding: 'utf8',
        eol: '\r\n\r\n',
        truncated: false
      }).success
    ).toBe(false)
  })
})

describe('asset-url / convert-office schema', () => {
  it('仅要求非空路径', () => {
    expect(assetUrlPayloadSchema.safeParse({ path: 'a.png' }).success).toBe(true)
    expect(assetUrlPayloadSchema.safeParse({ path: '' }).success).toBe(false)
  })

  it('转换结果页数为正整数', () => {
    expect(convertOfficeResultSchema.safeParse({ previewId: 'fp-1', pageCount: 1 }).success).toBe(
      true
    )
    expect(convertOfficeResultSchema.safeParse({ previewId: 'fp-1', pageCount: 0 }).success).toBe(
      false
    )
  })
})

describe('render-pdf-page schema', () => {
  it('页码/缩放范围', () => {
    expect(renderPdfPagePayloadSchema.safeParse({ previewId: 'fp-1', page: 1 }).success).toBe(true)
    expect(
      renderPdfPagePayloadSchema.safeParse({ previewId: 'fp-1', page: 1, scale: 0.5 }).success
    ).toBe(true)
    expect(
      renderPdfPagePayloadSchema.safeParse({ previewId: 'fp-1', page: 1, scale: 4 }).success
    ).toBe(true)
    expect(
      renderPdfPagePayloadSchema.safeParse({ previewId: 'fp-1', page: 1, scale: 4.1 }).success
    ).toBe(false)
    expect(renderPdfPagePayloadSchema.safeParse({ previewId: 'fp-1', page: 0 }).success).toBe(false)
  })

  it('PNG base64 与尺寸', () => {
    expect(
      renderPdfPageResultSchema.safeParse({ png: 'AAAA', width: 10, height: 20 }).success
    ).toBe(true)
    expect(
      renderPdfPageResultSchema.safeParse({ png: '', width: 10, height: 20 }).success
    ).toBe(false)
    expect(
      renderPdfPageResultSchema.safeParse({ png: 'AAAA', width: 0, height: 20 }).success
    ).toBe(false)
  })
})

describe('release / soffice schema', () => {
  it('release 结果布尔', () => {
    expect(releasePreviewResultSchema.safeParse({ released: true }).success).toBe(true)
    expect(releasePreviewResultSchema.safeParse({ released: 'yes' }).success).toBe(false)
  })

  it('soffice 状态与路径（空串允许清除）', () => {
    expect(sofficeStatusResultSchema.safeParse({ found: false }).success).toBe(true)
    expect(
      sofficeStatusResultSchema.safeParse({ found: true, path: 'C:\\soffice.com' }).success
    ).toBe(true)
    expect(sofficeStatusResultSchema.safeParse({ found: true }).success).toBe(true)
    expect(setSofficePathPayloadSchema.safeParse({ path: '' }).success).toBe(true)
    expect(setSofficePathPayloadSchema.safeParse({ path: 'C:\\soffice.com' }).success).toBe(true)
    expect(setSofficePathPayloadSchema.safeParse({ path: 'x'.repeat(4097) }).success).toBe(false)
  })
})
