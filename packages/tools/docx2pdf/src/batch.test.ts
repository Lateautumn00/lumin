/**
 * @file batch.test.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description 批量转换纯函数单测：去重、失败归一化、进度文案。
 */
import { describe, expect, it } from 'vitest'
import { batchProgressMessage, dedupeInputPaths, toBatchFailure } from './batch'

describe('dedupeInputPaths', () => {
  it('保留首次出现顺序并去除大小写重复（Windows 口径）', () => {
    expect(dedupeInputPaths(['C:\\a\\报告.docx', 'C:\\b\\表.xlsx', 'c:\\A\\报告.DOCX'])).toEqual([
      'C:\\a\\报告.docx',
      'C:\\b\\表.xlsx'
    ])
  })

  it('空数组原样返回', () => {
    expect(dedupeInputPaths([])).toEqual([])
  })
})

describe('toBatchFailure', () => {
  it('结构化错误原样投影（含 detail）', () => {
    expect(
      toBatchFailure('C:\\a.docx', {
        code: 'INPUT_LOCKED',
        message: '文件被其他程序占用，请关闭后重试',
        detail: 'EBUSY'
      })
    ).toEqual({
      inputPath: 'C:\\a.docx',
      code: 'INPUT_LOCKED',
      message: '文件被其他程序占用，请关闭后重试',
      detail: 'EBUSY'
    })
  })

  it('无 detail 时不带该字段', () => {
    expect(
      toBatchFailure('C:\\a.docx', { code: 'INPUT_NOT_FOUND', message: '输入文件不存在' })
    ).toEqual({ inputPath: 'C:\\a.docx', code: 'INPUT_NOT_FOUND', message: '输入文件不存在' })
  })

  it('裸 Error → INTERNAL 且保留消息', () => {
    expect(toBatchFailure('C:\\a.docx', new Error('boom'))).toEqual({
      inputPath: 'C:\\a.docx',
      code: 'INTERNAL',
      message: 'boom'
    })
  })
})

describe('batchProgressMessage', () => {
  it('输出「序号/总数 + 文件名」', () => {
    expect(batchProgressMessage(0, 5, 'D:\\试卷\\报告.docx')).toBe('1/5 转换中：报告.docx')
  })
})
