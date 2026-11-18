/**
 * PDF 打开错误分类（spec §5；纯函数，便于单测）。
 * pdfjs `PasswordException` → PDF_ENCRYPTED；`InvalidPDFException`/`MissingPDFException` → PDF_INVALID。
 */
export function classifyPdfOpenError(
  err: unknown
): 'PDF_ENCRYPTED' | 'PDF_INVALID' | 'PDF_NOT_FOUND' {
  const name = err instanceof Error ? err.name : ''
  if (name === 'PasswordException') return 'PDF_ENCRYPTED'
  if (name === 'InvalidPDFException' || name === 'MissingPDFException') return 'PDF_INVALID'
  return 'PDF_NOT_FOUND'
}
