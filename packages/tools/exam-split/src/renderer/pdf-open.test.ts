import { describe, expect, it } from 'vitest'
import { classifyPdfOpenError } from './pdf-open'

describe('classifyPdfOpenError（spec §5：pdfjs 异常 → 结构化码）', () => {
  it('PasswordException → PDF_ENCRYPTED', () => {
    const err = new Error('password')
    err.name = 'PasswordException'
    expect(classifyPdfOpenError(err)).toBe('PDF_ENCRYPTED')
  })

  it('InvalidPDFException / MissingPDFException → PDF_INVALID', () => {
    const invalid = new Error('broken')
    invalid.name = 'InvalidPDFException'
    expect(classifyPdfOpenError(invalid)).toBe('PDF_INVALID')
    const missing = new Error('gone')
    missing.name = 'MissingPDFException'
    expect(classifyPdfOpenError(missing)).toBe('PDF_INVALID')
  })

  it('其它错误/非 Error → PDF_NOT_FOUND', () => {
    expect(classifyPdfOpenError(new Error('boom'))).toBe('PDF_NOT_FOUND')
    expect(classifyPdfOpenError('boom')).toBe('PDF_NOT_FOUND')
    expect(classifyPdfOpenError(undefined)).toBe('PDF_NOT_FOUND')
  })
})
