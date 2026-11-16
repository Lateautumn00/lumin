import { describe, expect, it } from 'vitest'
import {
  cropDesiredPath,
  deleteDesiredPath,
  mergeDesiredPath,
  rotateDesiredPath,
  splitDesiredPaths
} from './naming'

const INPUT = 'C:/试卷/2026 期末卷.pdf'

describe('naming（spec §7.2 命名模板）', () => {
  it('拆分：{原名}_p{标签}.pdf，每区间一个产物', () => {
    expect(splitDesiredPaths(INPUT, [[1, 2, 3], [5], [7, 8]])).toEqual([
      'C:/试卷/2026 期末卷_p1-3.pdf',
      'C:/试卷/2026 期末卷_p5.pdf',
      'C:/试卷/2026 期末卷_p7-8.pdf'
    ])
  })

  it('合并：{首个原名}_合并.pdf', () => {
    expect(mergeDesiredPath([INPUT, 'D:/other/b.pdf'])).toBe('C:/试卷/2026 期末卷_合并.pdf')
    expect(mergeDesiredPath([])).toBe('_合并.pdf')
  })

  it('删页：{原名}_删p{标签}.pdf（多段逗号连接）', () => {
    expect(deleteDesiredPath(INPUT, [2, 3, 7])).toBe('C:/试卷/2026 期末卷_删p2-3,7.pdf')
    expect(deleteDesiredPath(INPUT, [5])).toBe('C:/试卷/2026 期末卷_删p5.pdf')
  })

  it('旋转：{原名}_旋转{角度}.pdf', () => {
    expect(rotateDesiredPath(INPUT, 90)).toBe('C:/试卷/2026 期末卷_旋转90.pdf')
    expect(rotateDesiredPath(INPUT, 270)).toBe('C:/试卷/2026 期末卷_旋转270.pdf')
  })

  it('裁剪：{原名}_裁剪.pdf', () => {
    expect(cropDesiredPath(INPUT)).toBe('C:/试卷/2026 期末卷_裁剪.pdf')
  })

  it('无扩展名路径原样保留；空分组标签为空（边界分支）', () => {
    expect(splitDesiredPaths('C:/试卷/无扩展名', [[1]])).toEqual(['C:/试卷/无扩展名_p1.pdf'])
    expect(splitDesiredPaths(INPUT, [[]])).toEqual(['C:/试卷/2026 期末卷_p.pdf'])
  })
})
