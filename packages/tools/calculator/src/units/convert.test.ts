import { describe, expect, it } from 'vitest'

import { convert, ConvertError, type ConvertErrorCode } from './convert'
import { CATEGORIES, findCategory, isCategoryId, type CategoryId } from './data'

function expectConvertError(fn: () => unknown, code: ConvertErrorCode): ConvertError {
  let caught: unknown
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(ConvertError)
  const error = caught as ConvertError
  expect(error.code).toBe(code)
  expect(error.message.length).toBeGreaterThan(0)
  return error
}

describe('换算表数据完整性', () => {
  it('17 类齐全、类别 id 唯一', () => {
    expect(CATEGORIES).toHaveLength(17)
    const ids = CATEGORIES.map((category) => category.id)
    expect(new Set(ids).size).toBe(ids.length)
    const expected: CategoryId[] = [
      'length',
      'weight',
      'temperature',
      'area',
      'volume',
      'speed',
      'time',
      'data',
      'data-rate',
      'pressure',
      'power',
      'energy',
      'flow',
      'fuel',
      'angle',
      'frequency',
      'resolution'
    ]
    expect([...ids].sort()).toEqual([...expected].sort())
  })

  it('每个类别至少 2 个单位，单位 id 与名称类别内唯一', () => {
    for (const category of CATEGORIES) {
      expect(category.units.length).toBeGreaterThanOrEqual(2)
      const unitIds = category.units.map((unit) => unit.id)
      const unitNames = category.units.map((unit) => unit.name)
      expect(new Set(unitIds).size).toBe(unitIds.length)
      expect(new Set(unitNames).size).toBe(unitNames.length)
      expect(category.name.length).toBeGreaterThan(0)
      expect(category.base.length).toBeGreaterThan(0)
    }
  })

  it('units[0] 为基准单位（线性 factor=1、温度为 K、油耗为 L/100km）', () => {
    for (const category of CATEGORIES) {
      if (category.id === 'temperature') {
        const first = category.units[0]
        expect(first.id).toBe('K')
        expect(first.scale).toBe(1)
        expect(first.offset).toBe(0)
      } else if (category.id === 'fuel') {
        const first = category.units[0]
        expect(first.id).toBe('l100km')
        expect(first.kind).toBe('vpd')
        expect(first.factor).toBe(100)
      } else {
        expect(category.units[0].factor).toBe(1)
      }
    }
  })

  it('线性 factor 全部为正有限数；温度 scale 为正有限数', () => {
    for (const category of CATEGORIES) {
      if (category.id === 'temperature') {
        for (const unit of category.units) {
          expect(Number.isFinite(unit.scale)).toBe(true)
          expect(unit.scale).toBeGreaterThan(0)
        }
      } else {
        for (const unit of category.units) {
          expect(Number.isFinite(unit.factor)).toBe(true)
          expect(unit.factor).toBeGreaterThan(0)
        }
      }
    }
  })

  it('findCategory / isCategoryId', () => {
    expect(findCategory('length')?.name).toBe('长度')
    expect(findCategory('currency')).toBeUndefined()
    expect(isCategoryId('temperature')).toBe(true)
    expect(isCategoryId('currency')).toBe(false)
  })
})

describe('全表断言（spec §5：换算表全量断言 ≥80%）', () => {
  it('每个线性类别：各单位→基准 = factor，基准→各单位 = 1/factor', () => {
    for (const category of CATEGORIES) {
      if (category.id === 'temperature' || category.id === 'resolution' || category.id === 'fuel')
        continue
      const base = category.units[0]
      for (const unit of category.units) {
        expect(convert(category.id, unit.id, base.id, 1)).toBeCloseTo(unit.factor, 10)
        expect(convert(category.id, base.id, unit.id, 1)).toBeCloseTo(1 / unit.factor, 10)
      }
    }
  })

  it('每个类别全单位对往返换算保持数值', () => {
    for (const category of CATEGORIES) {
      for (const from of category.units) {
        for (const to of category.units) {
          const value = 3.7
          const forward = convert(category.id, from.id, to.id, value)
          const back = convert(category.id, to.id, from.id, forward)
          expect(back).toBeCloseTo(value, 9)
        }
      }
    }
  })

  it('线性类别零值与负值各对换算仍为 0 / 反号', () => {
    for (const category of CATEGORIES) {
      if (category.id === 'temperature' || category.id === 'fuel') continue
      const [first, second] = category.units
      expect(convert(category.id, first.id, second.id, 0)).toBeCloseTo(0, 12)
      const pos = convert(category.id, first.id, second.id, 5)
      const neg = convert(category.id, first.id, second.id, -5)
      expect(neg).toBeCloseTo(-pos, 9)
    }
  })

  it('温度仿射性：等温差换算保持温差（1℃ 差 = 1K 差 = 1.8℉ 差）', () => {
    const c0 = convert('temperature', 'C', 'K', 0)
    const c10 = convert('temperature', 'C', 'K', 10)
    expect(c10 - c0).toBeCloseTo(10, 9)
    const f0 = convert('temperature', 'C', 'F', 0)
    const f10 = convert('temperature', 'C', 'F', 10)
    expect(f10 - f0).toBeCloseTo(18, 9)
  })

  it('关键常量抽查（长度/体积/数据/压强/速度）', () => {
    expect(convert('length', 'in', 'cm', 1)).toBeCloseTo(2.54, 12)
    expect(convert('length', 'mi', 'km', 1)).toBeCloseTo(1.609344, 9)
    expect(convert('length', 'ft', 'm', 3)).toBeCloseTo(0.9144, 9)
    expect(convert('volume', 'gal', 'L', 1)).toBeCloseTo(3.785411784, 9)
    expect(convert('data', 'TB', 'B', 1)).toBe(1099511627776)
    expect(convert('data', 'B', 'bit', 1)).toBe(8)
    expect(convert('pressure', 'atm', 'kPa', 1)).toBeCloseTo(101.325, 6)
    expect(convert('speed', 'kmh', 'mps', 36)).toBeCloseTo(10, 9)
    expect(convert('time', 'h', 'min', 1)).toBe(60)
    expect(convert('weight', 'lb', 'g', 1)).toBeCloseTo(453.59237, 6)
    expect(convert('flow', 'lps', 'lpm', 1)).toBeCloseTo(60, 9)
    expect(convert('flow', 'm3h', 'lpm', 1)).toBeCloseTo(1000 / 60, 9)
    expect(convert('flow', 'gpm', 'lpm', 1)).toBeCloseTo(3.785411784, 9)
    expect(convert('angle', 'rad', 'deg', Math.PI)).toBeCloseTo(180, 9)
    expect(convert('angle', 'turn', 'deg', 1)).toBeCloseTo(360, 9)
    expect(convert('angle', 'grad', 'deg', 100)).toBeCloseTo(90, 9)
  })

  it('温度锚点：0℃=32℉=273.15K、100℃=212℉、-40℃=-40℉、0K=-273.15℃', () => {
    expect(convert('temperature', 'C', 'F', 0)).toBeCloseTo(32, 9)
    expect(convert('temperature', 'C', 'K', 0)).toBeCloseTo(273.15, 9)
    expect(convert('temperature', 'C', 'F', 100)).toBeCloseTo(212, 9)
    expect(convert('temperature', 'C', 'F', -40)).toBeCloseTo(-40, 9)
    expect(convert('temperature', 'K', 'C', 0)).toBeCloseTo(-273.15, 9)
    expect(convert('temperature', 'F', 'K', 32)).toBeCloseTo(273.15, 9)
    expect(convert('temperature', 'F', 'C', 212)).toBeCloseTo(100, 9)
    expect(convert('temperature', 'F', 'C', 98.6)).toBeCloseTo(37, 9)
  })
})

describe('像素/分辨率（按 DPI）', () => {
  it('默认 96 DPI：96px = 1in = 2.54cm = 25.4mm', () => {
    expect(convert('resolution', 'px', 'in', 96)).toBeCloseTo(1, 12)
    expect(convert('resolution', 'px', 'cm', 96)).toBeCloseTo(2.54, 12)
    expect(convert('resolution', 'px', 'mm', 96)).toBeCloseTo(25.4, 9)
    expect(convert('resolution', 'in', 'px', 1)).toBeCloseTo(96, 12)
  })

  it('自定义 DPI：300 DPI 下 3000px = 10in', () => {
    expect(convert('resolution', 'px', 'in', 3000, 300)).toBeCloseTo(10, 12)
    expect(convert('resolution', 'cm', 'px', 2.54, 300)).toBeCloseTo(300, 9)
  })

  it('DPI 非法 → INVALID_DPI', () => {
    expectConvertError(() => convert('resolution', 'px', 'in', 1, 0), 'INVALID_DPI')
    expectConvertError(() => convert('resolution', 'px', 'in', 1, -96), 'INVALID_DPI')
    expectConvertError(() => convert('resolution', 'px', 'in', 1, Number.NaN), 'INVALID_DPI')
  })
})

describe('M52 新增类别（能量/频率/数据速率/油耗）', () => {
  it('能量锚点：1 kcal = 4184 J、1 kWh = 3.6e6 J、1 BTU ≈ 1055.06 J', () => {
    expect(convert('energy', 'kcal', 'J', 1)).toBeCloseTo(4184, 9)
    expect(convert('energy', 'kWh', 'J', 1)).toBeCloseTo(3.6e6, 6)
    expect(convert('energy', 'BTU', 'J', 1)).toBeCloseTo(1055.05585262, 6)
    expect(convert('energy', 'Wh', 'J', 1)).toBeCloseTo(3600, 9)
  })

  it('频率锚点：1 GHz = 1000 MHz = 1e9 Hz', () => {
    expect(convert('frequency', 'GHz', 'MHz', 1)).toBeCloseTo(1000, 9)
    expect(convert('frequency', 'MHz', 'Hz', 1)).toBeCloseTo(1e6, 3)
    expect(convert('frequency', 'kHz', 'Hz', 1)).toBeCloseTo(1000, 9)
  })

  it('数据速率锚点（十进制）：1 Mbps = 1000 Kbps、1 MB/s = 8000 Kbps', () => {
    expect(convert('data-rate', 'Mbps', 'Kbps', 1)).toBeCloseTo(1000, 9)
    expect(convert('data-rate', 'MBps', 'Kbps', 1)).toBeCloseTo(8000, 6)
    expect(convert('data-rate', 'GBps', 'Mbps', 1)).toBeCloseTo(8000, 6)
    expect(convert('data-rate', 'bps', 'KBps', 8000)).toBeCloseTo(1, 9)
  })

  it('油耗（倒数模型）：5 L/100km = 20 km/L；8 L/100km ≈ 29.4 mpg(US)', () => {
    expect(convert('fuel', 'l100km', 'kmpl', 5)).toBeCloseTo(20, 9)
    expect(convert('fuel', 'l100km', 'mpgus', 8)).toBeCloseTo(100 / 8 / (1.609344 / 3.785411784), 9)
    expect(convert('fuel', 'mpgus', 'l100km', 30)).toBeCloseTo(
      100 / (30 * (1.609344 / 3.785411784)),
      9
    )
    expect(convert('fuel', 'mpguk', 'l100km', 30)).toBeCloseTo(100 / (30 * (1.609344 / 4.54609)), 9)
  })

  it('油耗数值 ≤0 或非有限 → INVALID_VALUE', () => {
    expectConvertError(() => convert('fuel', 'l100km', 'kmpl', 0), 'INVALID_VALUE')
    expectConvertError(() => convert('fuel', 'l100km', 'kmpl', -5), 'INVALID_VALUE')
    expectConvertError(() => convert('fuel', 'kmpl', 'l100km', Number.NaN), 'INVALID_VALUE')
  })
})

describe('错误分支', () => {
  it('未知类别 → UNKNOWN_CATEGORY', () => {
    const error = expectConvertError(
      () => convert('currency' as CategoryId, 'USD', 'CNY', 1),
      'UNKNOWN_CATEGORY'
    )
    expect(error.message).toBe('不支持的换算类别')
  })

  it('源/目标单位未知 → UNKNOWN_UNIT', () => {
    expectConvertError(() => convert('length', 'foo', 'm', 1), 'UNKNOWN_UNIT')
    expectConvertError(() => convert('length', 'm', 'foo', 1), 'UNKNOWN_UNIT')
    expectConvertError(() => convert('temperature', 'C', 'Rankine', 1), 'UNKNOWN_UNIT')
    const error = expectConvertError(() => convert('weight', 'kg', 'jin', 1), 'UNKNOWN_UNIT')
    expect(error.message).toBe('该单位不支持此换算')
  })

  it('跨类别单位 id 不可用（单位须属于该类别）', () => {
    expectConvertError(() => convert('length', 'kg', 'm', 1), 'UNKNOWN_UNIT')
    expectConvertError(() => convert('power', 'W', 'hpX', 1), 'UNKNOWN_UNIT')
  })
})
