/**
 * @file format.test.ts 展示格式化纯函数单测
 * @author cuilanchao
 * @date 2026-11-19
 * @description formatTime 补零与 fileNameOf 双分隔符/无分隔符分支
 */
import { describe, expect, it } from 'vitest'
import { fileNameOf, formatTime } from './format'

describe('formatTime', () => {
  it('输出 YYYY-MM-DD HH:mm:ss（补零）', () => {
    const ms = new Date(2026, 0, 2, 3, 4, 5).getTime()
    expect(formatTime(ms)).toBe('2026-01-02 03:04:05')
  })

  it('两位月日时分秒不补零', () => {
    const ms = new Date(2026, 10, 19, 23, 59, 58).getTime()
    expect(formatTime(ms)).toBe('2026-11-19 23:59:58')
  })
})

describe('fileNameOf', () => {
  it('取 Windows / POSIX 路径末段', () => {
    expect(fileNameOf('C:\\a\\b\\c.txt')).toBe('c.txt')
    expect(fileNameOf('C:/a/b/c.txt')).toBe('c.txt')
  })

  it('无分隔符原样返回', () => {
    expect(fileNameOf('plain.txt')).toBe('plain.txt')
  })

  it('以分隔符结尾返回最后一段', () => {
    expect(fileNameOf('C:\\a\\b\\')).toBe('b')
  })
})
