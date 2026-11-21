/**
 * @file naming.ts 文件名基名与冲突重命名（纯函数，跨工具共用）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 去扩展名基名 + 已占用集合内的 `{base} ({n}){suffix}` 自动重命名
 *              （Windows 大小写不敏感比较）。不依赖 node:path，renderer 侧可用。
 */

/**
 * 去扩展名基名（保留目录前缀；无扩展名时原样返回）
 * @param filePath 文件路径或文件名
 */
export function baseName(filePath: string): string {
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const dot = filePath.lastIndexOf('.')
  // 点在分隔符之前、或紧随分隔符（如 `.gitignore`）→ 视为无扩展名
  if (dot <= slash + 1) return filePath
  return filePath.slice(0, dot)
}

/**
 * 提取扩展名（小写、去点、无白名单校验）
 * 目录中的点与点开头文件视为无扩展名；末尾为点 → null
 * @param filePath 文件路径或文件名
 */
export function extensionOf(filePath: string): string | null {
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const dot = filePath.lastIndexOf('.')
  if (dot <= slash + 1) return null
  const ext = filePath.slice(dot + 1).toLowerCase()
  return ext.length === 0 ? null : ext
}

/** 冲突重命名比较键（Windows 文件系统大小写不敏感） */
function keyOf(name: string): string {
  return name.toLowerCase()
}

/**
 * 冲突自动重命名：已占用 → `{base} ({n}){suffix}`，n 从 1 起递增。
 * Windows 大小写不敏感，比较一律走 lowercase 键。
 * @param existing 已占用文件名集合（调用方需含同批次已分配名）
 * @param candidate 期望文件名
 * @returns 可用文件名（candidate 本身可用时原样返回）
 */
export function uniqueFileName(existing: ReadonlySet<string>, candidate: string): string {
  const occupied = new Set([...existing].map(keyOf))
  if (!occupied.has(keyOf(candidate))) return candidate
  const dot = candidate.lastIndexOf('.')
  const base = dot <= 0 ? candidate : candidate.slice(0, dot)
  const suffix = dot <= 0 ? '' : candidate.slice(dot)
  for (let n = 1; ; n++) {
    const next = `${base} (${n})${suffix}`
    if (!occupied.has(keyOf(next))) return next
  }
}
