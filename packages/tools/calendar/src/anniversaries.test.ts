/**
 * @file 纪念日模型/存储/下次日期单测
 * @author cuilanchao
 * @date 2026-11-23
 */
import { describe, expect, it } from 'vitest'
import { Solar } from 'lunar-javascript'

import {
  daysUntil,
  formatCountdown,
  loadAnniversaries,
  matchesDay,
  nextOccurrence,
  saveAnniversaries,
  type Anniversary,
  type StorageLike
} from './anniversaries'

function fakeStore(initial?: string): StorageLike & { data: string | null } {
  const store = {
    data: initial ?? null,
    getItem(key: string): string | null {
      void key
      return store.data
    },
    setItem(key: string, value: string): void {
      void key
      store.data = value
    }
  }
  return store
}

function lunarTextOf(date: Date): string {
  const l = Solar.fromDate(date).getLunar()
  return `${l.getMonthInChinese()}${l.getDayInChinese()}`
}

const solarA: Anniversary = {
  id: 'a',
  name: '结婚纪念日',
  type: 'solar',
  month: 6,
  day: 18,
  leap: false
}
const lunarA: Anniversary = {
  id: 'b',
  name: '农历生日',
  type: 'lunar',
  month: 8,
  day: 15,
  leap: false
}
const leapA: Anniversary = {
  id: 'c',
  name: '闰月生日',
  type: 'lunar',
  month: 6,
  day: 1,
  leap: true
}

describe('nextOccurrence（公历）', () => {
  it('今天即周年返回今天', () => {
    const today = new Date(2026, 5, 18)
    expect(nextOccurrence(solarA, today)).toEqual(new Date(2026, 5, 18))
  })

  it('周年已过则跨年', () => {
    const today = new Date(2026, 6, 1)
    expect(nextOccurrence(solarA, today)).toEqual(new Date(2027, 5, 18))
  })

  it('2/29 非闰年退 2/28', () => {
    const a: Anniversary = { id: 'd', name: '闰日', type: 'solar', month: 2, day: 29, leap: false }
    expect(nextOccurrence(a, new Date(2026, 0, 1))).toEqual(new Date(2026, 1, 28))
    expect(nextOccurrence(a, new Date(2027, 0, 1))).toEqual(new Date(2027, 1, 28))
    expect(nextOccurrence(a, new Date(2028, 0, 1))).toEqual(new Date(2028, 1, 29))
  })
})

describe('nextOccurrence（农历）', () => {
  it('中秋周年：2025-10-06 当天即周年，次年 2026-09-25', () => {
    expect(nextOccurrence(lunarA, new Date(2025, 9, 6))).toEqual(new Date(2025, 9, 6))
    const next = nextOccurrence(lunarA, new Date(2025, 9, 7))
    expect(next).toEqual(new Date(2026, 8, 25))
    expect(lunarTextOf(next)).toBe('八十五')
  })

  it('闰六月初一：2025 有闰六月，2026 无则降级普通六月', () => {
    const inLeap = nextOccurrence(leapA, new Date(2025, 6, 20)) // 2025-07-20 在闰六月初一前
    expect(lunarTextOf(inLeap)).toBe('闰六初一')
    expect(inLeap).toEqual(new Date(2025, 6, 25))
    const after = nextOccurrence(leapA, new Date(2025, 6, 26))
    expect(lunarTextOf(after)).toBe('六初一')
    expect(after.getFullYear()).toBe(2026)
  })

  it('农历三十缺月降级月末（2025 腊月仅 29 天）', () => {
    const a: Anniversary = {
      id: 'e',
      name: '腊月三十',
      type: 'lunar',
      month: 12,
      day: 30,
      leap: false
    }
    const next = nextOccurrence(a, new Date(2025, 5, 1))
    expect(lunarTextOf(next)).toBe('腊廿九')
    expect(next).toEqual(new Date(2026, 1, 16))
  })

  it('周年已过（农历年内）取下个农历年', () => {
    const next = nextOccurrence(lunarA, new Date(2026, 8, 26))
    expect(next).toEqual(new Date(2027, 8, 15))
  })
})

describe('daysUntil / formatCountdown', () => {
  it('自然日差值', () => {
    expect(daysUntil(new Date(2026, 0, 1), new Date(2026, 0, 1))).toBe(0)
    expect(daysUntil(new Date(2026, 0, 1), new Date(2026, 0, 11))).toBe(10)
    expect(daysUntil(new Date(2026, 11, 31), new Date(2027, 0, 1))).toBe(1)
  })

  it('倒数文案：今天 / 今天·N 周年 / 还有 N 天', () => {
    expect(formatCountdown(solarA, new Date(2026, 5, 18))).toBe('今天')
    const withStart: Anniversary = { ...solarA, startYear: 2020 }
    expect(formatCountdown(withStart, new Date(2026, 5, 18))).toBe('今天 · 6 周年')
    expect(formatCountdown(solarA, new Date(2026, 5, 10))).toBe('还有 8 天')
  })
})

describe('matchesDay', () => {
  const lunarInfo = { lunarMonth: 8, lunarDay: 15 }

  it('公历按公历月日匹配', () => {
    expect(matchesDay(solarA, new Date(2026, 5, 18), lunarInfo)).toBe(true)
    expect(matchesDay(solarA, new Date(2026, 5, 19), lunarInfo)).toBe(false)
    expect(matchesDay(solarA, new Date(2026, 6, 18), lunarInfo)).toBe(false)
  })

  it('农历按农历月日匹配（闰月不强制）', () => {
    expect(matchesDay(lunarA, new Date(2025, 9, 6), lunarInfo)).toBe(true)
    expect(matchesDay(lunarA, new Date(2025, 9, 7), { lunarMonth: 8, lunarDay: 16 })).toBe(false)
    const leap: Anniversary = { ...leapA, month: 6, day: 1 }
    expect(matchesDay(leap, new Date(2025, 6, 25), { lunarMonth: 6, lunarDay: 1 })).toBe(true)
    // 降级到普通六月同样命中
    expect(matchesDay(leap, new Date(2026, 5, 24), { lunarMonth: 6, lunarDay: 1 })).toBe(true)
    expect(matchesDay(leap, new Date(2026, 5, 24), { lunarMonth: 6, lunarDay: 2 })).toBe(false)
  })
})

describe('loadAnniversaries / saveAnniversaries', () => {
  it('往返保存读取', () => {
    const store = fakeStore()
    expect(saveAnniversaries([solarA, lunarA], store)).toBe(true)
    expect(loadAnniversaries(store)).toEqual([solarA, lunarA])
  })

  it('缺失与损坏 JSON 回退空数组', () => {
    expect(loadAnniversaries(fakeStore())).toEqual([])
    expect(loadAnniversaries(fakeStore('{not json'))).toEqual([])
    expect(loadAnniversaries(fakeStore('{"a":1}'))).toEqual([])
  })

  it('非法条目剔除、合法条目保留（含中文/空格名）', () => {
    const raw = JSON.stringify([
      solarA,
      { id: 'x', name: '  中文 名  ', type: 'lunar', month: 8, day: 15, leap: false },
      { id: 'w', name: '非法月', type: 'lunar', month: 13, day: 1, leap: false },
      { id: 'y', name: '', type: 'solar', month: 1, day: 1, leap: false },
      {
        id: 'z',
        name: '超范围起始年',
        type: 'solar',
        month: 1,
        day: 1,
        leap: false,
        startYear: 9999
      },
      null
    ])
    const list = loadAnniversaries(fakeStore(raw))
    expect(list).toHaveLength(3)
    expect(list[0]).toEqual(solarA)
    expect(list[1]?.name).toBe('中文 名')
    expect(list[2]?.startYear).toBeUndefined()
  })

  it('存储配额满保存失败返回 false 且不破坏已有数据', () => {
    const store = fakeStore(JSON.stringify([solarA]))
    const failing: StorageLike = {
      getItem: store.getItem,
      setItem: () => {
        throw new Error('QuotaExceededError')
      }
    }
    expect(saveAnniversaries([lunarA], failing)).toBe(false)
    expect(loadAnniversaries(store)).toEqual([solarA])
  })

  it('无 localStorage 环境安全回退', () => {
    expect(loadAnniversaries()).toEqual([])
    expect(saveAnniversaries([solarA])).toBe(false)
  })
})
