/** 冲突递增后缀上限（超出返回 null，由调用方映射写失败错误码） */
export const MAX_CONFLICT_SUFFIX = 99

/**
 * 输出路径冲突递增（spec §7.3）：目标路径未被占用则原样返回；
 * 冲突依次尝试 `base(1).ext` … `base(99).ext`，全部占用返回 null。
 * 纯函数，存在性由注入的 exists 判定；扩展名仅取文件名部分（目录中的点不算）。
 */
export function resolveConflictPath(
  desiredPath: string,
  exists: (path: string) => boolean,
  maxSuffix: number = MAX_CONFLICT_SUFFIX
): string | null {
  if (!exists(desiredPath)) return desiredPath
  const dot = desiredPath.lastIndexOf('.')
  const slash = Math.max(desiredPath.lastIndexOf('/'), desiredPath.lastIndexOf('\\'))
  const hasExt = dot > slash && dot > 0
  const base = hasExt ? desiredPath.slice(0, dot) : desiredPath
  const ext = hasExt ? desiredPath.slice(dot) : ''
  for (let index = 1; index <= maxSuffix; index += 1) {
    const candidate = `${base}(${index})${ext}`
    if (!exists(candidate)) return candidate
  }
  return null
}
