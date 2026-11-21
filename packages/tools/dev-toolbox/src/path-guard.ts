/**
 * @file 请求路径安全判定（静态服务器 403 边界）
 * @author cuilanchao
 * @date 2026-11-21
 * @description decodeURIComponent → path.resolve(root, '.' + pathname)，
 *              结果必须位于 root 内（等值视为目录），否则返回 null（调用方回 403）
 */
import { resolve, sep } from 'node:path'

/**
 * 把 URL pathname 解析为 root 内的绝对路径
 * @param root 服务器根目录
 * @param rawPathname 原始（未解码）pathname
 * @returns 合法绝对路径；越界或非法编码返回 null
 */
export function resolveRequestPath(root: string, rawPathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null

  const base = resolve(root)
  const pathname = decoded === '' ? '/' : decoded
  const target = resolve(base, `.${pathname}`)

  if (target === base) return target
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`
  return target.startsWith(prefix) ? target : null
}
