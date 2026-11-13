/** 数值格式化：15 位有效数字去浮点噪声（0.1+0.2 → 0.3）；非有限值直接字符串化 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  return String(Number(value.toPrecision(15)))
}
