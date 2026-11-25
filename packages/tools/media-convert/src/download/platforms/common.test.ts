/**
 * @file platforms/common.ts 单测（标题安全化、URL 反转义、页面标题提取）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 纯函数边界：非法字符、空白折叠、超长截断、空标题回退、转义还原
 */
import { describe, expect, it } from 'vitest'
import { htmlTitle, safeFileTitle, unescapeUrl } from './common'

describe('safeFileTitle', () => {
  it('清除 Windows 非法字符并折叠空白', () => {
    expect(safeFileTitle('  a/b:c*d?e"f<g>h|i  ')).toBe('a b c d e f g h i')
  })

  it('去首尾点与空格；空标题回退 video', () => {
    expect(safeFileTitle('...')).toBe('video')
    expect(safeFileTitle('   ')).toBe('video')
    expect(safeFileTitle('.标题.')).toBe('标题')
  })

  it('超长标题截断 120 字符', () => {
    expect(safeFileTitle('长'.repeat(200))).toHaveLength(120)
  })
})

describe('unescapeUrl', () => {
  it('还原 \\u002F 与 \\/ 及 \\u0026', () => {
    expect(unescapeUrl('https:\\u002F\\u002Fv.example.com\\u002Fa?b=1\\u0026c=2')).toBe(
      'https://v.example.com/a?b=1&c=2'
    )
    expect(unescapeUrl('https:\\/\\/v.example.com\\/a')).toBe('https://v.example.com/a')
  })
})

describe('htmlTitle', () => {
  it('提取并折叠空白', () => {
    expect(htmlTitle('<html><title> 标题  A </title></html>')).toBe('标题 A')
  })

  it('无 title 返回空串', () => {
    expect(htmlTitle('<html></html>')).toBe('')
  })
})
