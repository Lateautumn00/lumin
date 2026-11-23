/**
 * @file 农历/黄历纯函数单测
 * @author cuilanchao
 * @date 2026-11-23
 */
import { describe, expect, it } from 'vitest'

import { getDayInfo, getHuangJi, getMonthGrid } from './lunar'

const ZHI_XING = ['建', '除', '满', '平', '定', '执', '破', '危', '成', '收', '开', '闭']
const TIAN_SHEN = [
  '青龙',
  '明堂',
  '天刑',
  '朱雀',
  '金匮',
  '天德',
  '白虎',
  '玉堂',
  '天牢',
  '玄武',
  '司命',
  '勾陈'
]

describe('getDayInfo', () => {
  it('春节锚点：2024-02-10 / 2026-02-17 为正月初一', () => {
    expect(getDayInfo(new Date(2024, 1, 10)).lunarText).toBe('正月初一')
    expect(getDayInfo(new Date(2026, 1, 17)).lunarText).toBe('正月初一')
    expect(getDayInfo(new Date(2024, 1, 10)).festivals).toContain('春节')
  })

  it('除夕 2023-01-21 在节日列表', () => {
    expect(getDayInfo(new Date(2023, 0, 21)).festivals).toContain('除夕')
  })

  it('中秋 2025-10-06 为八月十五且是中秋节', () => {
    const info = getDayInfo(new Date(2025, 9, 6))
    expect(info.lunarText).toBe('八月十五')
    expect(info.festivals).toContain('中秋节')
  })

  it('清明节气：2024-04-04 与 2026-04-05', () => {
    expect(getDayInfo(new Date(2024, 3, 4)).jieqi).toBe('清明')
    expect(getDayInfo(new Date(2026, 3, 5)).jieqi).toBe('清明')
  })

  it('冬至（跨年拼音键）2024-12-21', () => {
    expect(getDayInfo(new Date(2024, 11, 21)).jieqi).toBe('冬至')
  })

  it('立春（跨年拼音键）2026-02-04', () => {
    expect(getDayInfo(new Date(2026, 1, 4)).jieqi).toBe('立春')
  })

  it('非节气日 jieqi 为 null；干支/生肖/星期/星座非空', () => {
    const info = getDayInfo(new Date(2026, 10, 23))
    expect(info.jieqi).toBeNull()
    expect(info.solar).toBe('2026-11-23')
    expect(info.week).toBe('星期一')
    expect(info.ganzhi).toMatch(/^[一-龥]{2}$/)
    expect(info.shengXiao).not.toBe('')
    expect(info.xingZuo).toMatch(/座$/)
    expect(info.lunarText).not.toBe('')
  })
})

describe('getMonthGrid', () => {
  it('恒 42 格且周一起始', () => {
    const grid = getMonthGrid(2026, 11)
    expect(grid).toHaveLength(42)
    expect(grid[0]?.date.getDay()).toBe(1) // 周一
    expect(grid[6]?.date.getDay()).toBe(0) // 周日
  })

  it('当月天数全部 inMonth，跨月格不计入', () => {
    const grid = getMonthGrid(2026, 11)
    expect(grid.filter((c) => c.inMonth)).toHaveLength(30)
    const feb = getMonthGrid(2024, 2)
    expect(feb.filter((c) => c.inMonth)).toHaveLength(29)
  })

  it('格内含节假日与农历文本', () => {
    const grid = getMonthGrid(2026, 10)
    const nationalDay = grid.find((c) => c.info.solar === '2026-10-01')
    expect(nationalDay?.holiday).toEqual({ name: '国庆节', off: true })
    const workday = grid.find((c) => c.info.solar === '2026-10-10')
    expect(workday?.holiday).toEqual({ name: '国庆节', off: false })
    for (const cell of grid) expect(cell.info.lunarText).not.toBe('')
  })
})

describe('getHuangJi', () => {
  const hj = getHuangJi(new Date(2026, 10, 23))

  it('宜忌为非空字符串数组', () => {
    expect(hj.yi.length).toBeGreaterThan(0)
    expect(hj.ji.length).toBeGreaterThan(0)
    expect(hj.yi.every((s) => typeof s === 'string' && s !== '')).toBe(true)
    expect(hj.ji.every((s) => typeof s === 'string' && s !== '')).toBe(true)
  })

  it('建除十二值星 ∈ 固定集合', () => {
    expect(ZHI_XING).toContain(hj.zhiXing)
  })

  it('值神 ∈ 十二神，吉凶神为字符串数组', () => {
    expect(TIAN_SHEN).toContain(hj.tianShen)
    expect(hj.tianShenLuck).not.toBe('')
    expect(hj.jiShen.length).toBeGreaterThan(0)
    expect(hj.xiongSha.length).toBeGreaterThan(0)
  })

  it('冲煞非空', () => {
    expect(hj.chong).not.toBe('')
    expect(hj.sha).not.toBe('')
  })
})
