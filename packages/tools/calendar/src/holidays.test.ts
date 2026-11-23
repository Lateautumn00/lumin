/**
 * @file 节假日双轨查询单测
 * @author cuilanchao
 * @date 2026-11-23
 */
import { describe, expect, it } from 'vitest'

import { getHolidayInfo } from './holidays'

describe('getHolidayInfo（自维护数据轨）', () => {
  it('2024 春节放假区间与调休', () => {
    expect(getHolidayInfo(2024, 2, 10)).toEqual({ name: '春节', off: true })
    expect(getHolidayInfo(2024, 2, 17)).toEqual({ name: '春节', off: true })
    expect(getHolidayInfo(2024, 2, 4)).toEqual({ name: '春节', off: false })
    expect(getHolidayInfo(2024, 2, 18)).toEqual({ name: '春节', off: false })
    expect(getHolidayInfo(2024, 2, 9)).toBeNull() // 除夕当天 2024 未放假
  })

  it('2026 国庆区间与调休', () => {
    expect(getHolidayInfo(2026, 10, 1)).toEqual({ name: '国庆节', off: true })
    expect(getHolidayInfo(2026, 10, 7)).toEqual({ name: '国庆节', off: true })
    expect(getHolidayInfo(2026, 10, 10)).toEqual({ name: '国庆节', off: false })
    expect(getHolidayInfo(2026, 9, 20)).toEqual({ name: '国庆节', off: false })
  })

  it('2027 春节与 2023 跨年元旦', () => {
    expect(getHolidayInfo(2027, 2, 6)).toEqual({ name: '春节', off: true })
    expect(getHolidayInfo(2027, 2, 14)).toEqual({ name: '春节', off: false })
    expect(getHolidayInfo(2023, 12, 31)).toEqual({ name: '元旦节', off: true })
    expect(getHolidayInfo(2024, 1, 1)).toEqual({ name: '元旦节', off: true })
  })

  it('2025 国庆中秋连休', () => {
    expect(getHolidayInfo(2025, 10, 1)).toEqual({ name: '国庆中秋', off: true })
    expect(getHolidayInfo(2025, 10, 8)).toEqual({ name: '国庆中秋', off: true })
    expect(getHolidayInfo(2025, 10, 11)).toEqual({ name: '国庆中秋', off: false })
  })
})

describe('getHolidayInfo（HolidayUtil 兜底轨）', () => {
  it('数据覆盖外的年份走内置数据：2019 国庆', () => {
    expect(getHolidayInfo(2019, 10, 1)).toEqual({ name: '国庆节', off: true })
    expect(getHolidayInfo(2019, 10, 7)).toEqual({ name: '国庆节', off: true })
  })

  it('两轨均未命中返回 null（远期无标记不报错）', () => {
    expect(getHolidayInfo(2028, 1, 1)).toBeNull()
    expect(getHolidayInfo(2035, 6, 15)).toBeNull()
    expect(getHolidayInfo(2026, 11, 23)).toBeNull()
  })
})
