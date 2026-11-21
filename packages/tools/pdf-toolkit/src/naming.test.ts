import { describe, expect, it } from 'vitest'
import {
  compressDesiredPath,
  deleteDesiredPath,
  extractImagesDesiredDir,
  extractTextDesiredPath,
  mergeDesiredPath,
  metadataDesiredPath,
  pageNumbersDesiredPath,
  reorderDesiredPath,
  rotateDesiredPath,
  splitDesiredPaths,
  watermarkDesiredPath
} from './naming'

describe('pdf-toolkit naming（spec §6）', () => {
  it('合并取首文件基名', () => {
    expect(mergeDesiredPath(['C:/a/第一份 卷.pdf', 'C:/b/第二份.pdf'])).toBe(
      'C:/a/第一份 卷_合并.pdf'
    )
    expect(mergeDesiredPath([])).toBe('_合并.pdf')
  })

  it('拆分按区间标签命名', () => {
    expect(
      splitDesiredPaths('C:/a/卷.pdf', [
        [1, 2],
        [4, 5]
      ])
    ).toEqual(['C:/a/卷_p1-2.pdf', 'C:/a/卷_p4-5.pdf'])
    expect(splitDesiredPaths('C:/a/卷.pdf', [[3]])).toEqual(['C:/a/卷_p3.pdf'])
    expect(splitDesiredPaths('C:/a/卷.pdf', [[]])).toEqual(['C:/a/卷_p.pdf'])
  })

  it('删页标签多段逗号连接', () => {
    expect(deleteDesiredPath('C:/a/卷.pdf', [2, 3, 7])).toBe('C:/a/卷_删p2-3,7.pdf')
  })

  it('旋转/重排/元数据命名', () => {
    expect(rotateDesiredPath('C:/a/卷.pdf', 180)).toBe('C:/a/卷_旋转180.pdf')
    expect(reorderDesiredPath('C:/a/卷.pdf')).toBe('C:/a/卷_重排.pdf')
    expect(metadataDesiredPath('C:/a/卷.pdf')).toBe('C:/a/卷_元数据.pdf')
  })

  it('水印/页码命名（M17）', () => {
    expect(watermarkDesiredPath('C:/a/卷.pdf')).toBe('C:/a/卷_水印.pdf')
    expect(pageNumbersDesiredPath('C:/a/卷.pdf')).toBe('C:/a/卷_页码.pdf')
  })

  it('提取/压缩命名（M38）', () => {
    expect(extractTextDesiredPath('C:/a/卷.pdf')).toBe('C:/a/卷_文本.txt')
    expect(extractImagesDesiredDir('C:/a/卷.pdf')).toBe('C:/a/卷_图片')
    expect(compressDesiredPath('C:/a/卷.pdf')).toBe('C:/a/卷_压缩.pdf')
  })
})
