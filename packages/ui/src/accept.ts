/**
 * 校验文件名是否匹配 accept 扩展名列表（如 `.doc,.docx`）。
 * 仅识别 `.` 开头的扩展名项；MIME 或 `类型/*` 项忽略（由文件选择器自行过滤）。
 * 列表为空或不含扩展名项时放行。
 */
export function matchesAccept(fileName: string, accept: string): boolean {
  const extensions = accept
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.startsWith('.'))
  if (extensions.length === 0) return true
  const lower = fileName.toLowerCase()
  return extensions.some((extension) => lower.endsWith(extension))
}
