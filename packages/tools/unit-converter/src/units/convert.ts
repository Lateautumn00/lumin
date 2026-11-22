import { CATEGORIES, type CategoryId } from './data'

export type ConvertErrorCode =
  | 'UNKNOWN_CATEGORY'
  | 'UNKNOWN_UNIT'
  | 'INVALID_DPI'
  | 'INVALID_VALUE'

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

/**
 * 单位换算纯函数（线性 ×factor、温度偏移换算、像素按 DPI）
 * @param categoryId 换算类别
 * @param fromId 源单位
 * @param toId 目标单位
 * @param value 源数值
 * @param dpi 仅分辨率类别使用，默认 96
 * @description 未知类别/单位/DPI 非法时抛 ConvertError
 */
export function convert(
  categoryId: CategoryId,
  fromId: string,
  toId: string,
  value: number,
  dpi = 96
): number {
  const category = CATEGORIES.find((candidate) => candidate.id === categoryId)
  if (category === undefined) throw new ConvertError('UNKNOWN_CATEGORY', '不支持的换算类别')
  if (category.id === 'temperature') {
    const from = findUnit(category.units, fromId)
    const to = findUnit(category.units, toId)
    const kelvin = value * from.scale + from.offset
    return (kelvin - to.offset) / to.scale
  }
  if (category.id === 'resolution') {
    if (!Number.isFinite(dpi) || dpi <= 0) {
      throw new ConvertError('INVALID_DPI', 'DPI 必须是大于 0 的数值')
    }
    const from = findUnit(category.units, fromId)
    const to = findUnit(category.units, toId)
    const inches = from.id === 'px' ? value / dpi : value * from.factor
    return to.id === 'px' ? inches * dpi : inches / to.factor
  }
  if (category.id === 'fuel') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new ConvertError('INVALID_VALUE', '油耗数值必须大于 0')
    }
    const from = findUnit(category.units, fromId)
    const to = findUnit(category.units, toId)
    const kmPerLiter = from.kind === 'dpm' ? value * from.factor : from.factor / value
    return to.kind === 'dpm' ? kmPerLiter / to.factor : to.factor / kmPerLiter
  }
  const from = findUnit(category.units, fromId)
  const to = findUnit(category.units, toId)
  return (value * from.factor) / to.factor
}
