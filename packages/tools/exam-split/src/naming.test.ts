import { describe, expect, it } from 'vitest'
import {
  cropDesiredPath,
  formatDate,
  halveDesiredPath,
  halveImageDesiredPaths,
  ocrPdfDesiredPath,
  ocrPngDesiredPath,
  renderName,
  splitDesiredPaths,
  withConflictSuffix
} from './naming'

const INPUT = 'C:/试卷/2026 期末卷.pdf'
const IMAGE = 'C:/试卷/扫描件.JPG'

describe('naming（spec §7.2 命名模板）', () => {
  it('拆分：{原名}_p{标签}.pdf，每区间一个产物', () => {
    expect(splitDesiredPaths(INPUT, [[1, 2, 3], [5], [7, 8]])).toEqual([
      'C:/试卷/2026 期末卷_p1-3.pdf',
      'C:/试卷/2026 期末卷_p5.pdf',
      'C:/试卷/2026 期末卷_p7-8.pdf'
    ])
  })

  it('裁剪：{原名}_裁剪.pdf', () => {
    expect(cropDesiredPath(INPUT)).toBe('C:/试卷/2026 期末卷_裁剪.pdf')
  })

  it('OCR 每题 PNG：{原名}_题{n}.png（PDF 与图片输入同口径）', () => {
    expect(ocrPngDesiredPath(INPUT, 1)).toBe('C:/试卷/2026 期末卷_题1.png')
    expect(ocrPngDesiredPath(INPUT, 42)).toBe('C:/试卷/2026 期末卷_题42.png')
    expect(ocrPngDesiredPath(IMAGE, 3)).toBe('C:/试卷/扫描件_题3.png')
  })

  it('OCR 合成 PDF：{原名}_切题.pdf', () => {
    expect(ocrPdfDesiredPath(INPUT)).toBe('C:/试卷/2026 期末卷_切题.pdf')
    expect(ocrPdfDesiredPath(IMAGE)).toBe('C:/试卷/扫描件_切题.pdf')
  })

  it('无扩展名路径原样保留；空分组标签为空（边界分支）', () => {
    expect(splitDesiredPaths('C:/试卷/无扩展名', [[1]])).toEqual(['C:/试卷/无扩展名_p1.pdf'])
    expect(splitDesiredPaths(INPUT, [[]])).toEqual(['C:/试卷/2026 期末卷_p.pdf'])
  })

  it('自定义模板：{name}/{op}/{label} 渲染，自动去除模板尾部 .pdf 再补 .pdf', () => {
    expect(splitDesiredPaths(INPUT, [[1, 2], [5]], '{name}-{op}-{label}')).toEqual([
      'C:/试卷/2026 期末卷-拆分-1-2.pdf',
      'C:/试卷/2026 期末卷-拆分-5.pdf'
    ])
    expect(cropDesiredPath(INPUT, '{name}-{op}')).toBe('C:/试卷/2026 期末卷-裁剪.pdf')
  })

  it('空模板/纯空白回落默认命名；未知占位符原样保留', () => {
    expect(splitDesiredPaths(INPUT, [[1]], '   ')).toEqual(['C:/试卷/2026 期末卷_p1.pdf'])
    expect(renderName('{name}_{foo}', { name: 'x', op: '', label: '', date: '' })).toBe('x_{foo}')
  })

  it('date 占位符：本地日期 YYYYMMDD', () => {
    expect(formatDate(new Date(2026, 0, 2))).toBe('20260102')
    expect(formatDate(new Date(2026, 11, 31))).toBe('20261231')
    expect(renderName('{name}-{date}', { name: 'a', op: '', label: '', date: '20260102' })).toBe(
      'a-20260102'
    )
  })

  it('Windows 路径：模板产物保持原目录分隔符', () => {
    expect(splitDesiredPaths('C:\\试卷\\卷.pdf', [[1]], '{name}-{label}')).toEqual([
      'C:\\试卷\\卷-1.pdf'
    ])
  })

  it('页面切分：PDF 单文件 {原名}_对半切.pdf（spec §11）', () => {
    expect(halveDesiredPath(INPUT)).toBe('C:/试卷/2026 期末卷_对半切.pdf')
    expect(halveDesiredPath('C:/试卷/无扩展名')).toBe('C:/试卷/无扩展名_对半切.pdf')
  })

  it('页面切分：图片左右两张，保持原扩展名（大小写归一）', () => {
    expect(halveImageDesiredPaths(IMAGE)).toEqual(['C:/试卷/扫描件_左.jpg', 'C:/试卷/扫描件_右.jpg'])
    expect(halveImageDesiredPaths('C:/试卷/扫描.png')).toEqual([
      'C:/试卷/扫描_左.png',
      'C:/试卷/扫描_右.png'
    ])
  })

  it('冲突后缀：插在扩展名前，n≤0 原样返回（左右成对递增同号）', () => {
    expect(withConflictSuffix('C:/试卷/扫描_左.jpg', 0)).toBe('C:/试卷/扫描_左.jpg')
    expect(withConflictSuffix('C:/试卷/扫描_左.jpg', 2)).toBe('C:/试卷/扫描_左(2).jpg')
    expect(withConflictSuffix('C:/试卷/无扩展名', 1)).toBe('C:/试卷/无扩展名(1)')
  })
})
