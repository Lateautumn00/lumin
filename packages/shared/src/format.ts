/**
 * @file format.ts 展示格式化纯函数（跨工具共用）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 修改时间（秒级）与路径末段展示；不依赖 node:path，renderer/worker 均可用。
 */

/**
 * 修改时间展示（本地时区，YYYY-MM-DD HH:mm:ss）
 * @param mtimeMs 毫秒时间戳
 */
export function formatTime(mtimeMs: number): string {
  const date = new Date(mtimeMs)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * 路径最后一段（兼容 `\` 与 `/`；忽略尾部/重复分隔符，无内容时原样返回）
 * @param path 文件路径
 */
export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '')
  return parts[parts.length - 1] ?? path
}
