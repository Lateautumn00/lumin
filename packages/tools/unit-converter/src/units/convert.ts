import { CATEGORIES, type CategoryId } from './data'

export type ConvertErrorCode = 'UNKNOWN_CATEGORY' | 'UNKNOWN_UNIT'

export class ConvertError extends Error {
  readonly code: ConvertErrorCode

  constructor(code: ConvertErrorCode, message: string) {
    super(message)
    this.name = 'ConvertError'
    this.code = code
  }
}

function findUnit<U extends { readonly id: string }>(units: readonly U[], id: string): U {
  const unit = units.find((candidate) => candidate.id === id)
  if (unit === undefined) throw new ConvertError('UNKNOWN_UNIT', '该单位不支持此换算')
  return unit
}

/** 单位换算纯函数（线性 ×factor、温度偏移换算）；未知类别/单位抛 ConvertError */
export function convert(
  categoryId: CategoryId,
  fromId: string,
  toId: string,
  value: number
): number {
  const category = CATEGORIES.find((candidate) => candidate.id === categoryId)
  if (category === undefined) throw new ConvertError('UNKNOWN_CATEGORY', '不支持的换算类别')
  if (category.id === 'temperature') {
    const from = findUnit(category.units, fromId)
    const to = findUnit(category.units, toId)
    const kelvin = value * from.scale + from.offset
    return (kelvin - to.offset) / to.scale
  }
  const from = findUnit(category.units, fromId)
  const to = findUnit(category.units, toId)
  return (value * from.factor) / to.factor
}
