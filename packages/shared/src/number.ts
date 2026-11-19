/** 数值格式化：15 位有效数字去浮点噪声（0.1+0.2 → 0.3）；非有限值直接字符串化 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  return String(Number(value.toPrecision(15)))
}

/**
 * 字节体积人性化展示（1024 进制，1 位小数）
 * @param bytes 字节数（0 与非有限/负值按边界返回 `—`）
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${Math.round(bytes)} B`
}
