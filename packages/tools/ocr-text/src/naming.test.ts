/**
 * @file naming 单测（时间戳与合并文件名）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import { formatStamp, mergedFileName } from './naming'

describe('formatStamp', () => {
  it('补零到 yyyyMMdd-HHmmss（本地时间）', () => {
    expect(formatStamp(new Date(2026, 0, 5, 3, 4, 9))).toBe('20260105-030409')
    expect(formatStamp(new Date(2026, 11, 31, 23, 59, 59))).toBe('20261231-235959')
  })
})

describe('mergedFileName', () => {
  it('合并导出默认文件名带时间戳与 .txt 后缀', () => {
    expect(mergedFileName(new Date(2026, 10, 20, 8, 6, 5))).toBe('OCR-合并-20261120-080605.txt')
  })
})
