/**
 * 输出路径命名（spec §7.3）：`{原名}.pdf`；冲突依次 `{原名}(1).pdf` … `{原名}(99).pdf`；
 * 全部占用返回 null（调用方报 OUTPUT_MISSING）。纯函数，存在性由注入的 exists 判定。
 */
export const MAX_OUTPUT_SUFFIX = 99

export function resolveOutputPath(
  inputPath: string,
  exists: (path: string) => boolean
): string | null {
  const dot = inputPath.lastIndexOf('.')
  const base = dot > 0 ? inputPath.slice(0, dot) : inputPath
  const first = `${base}.pdf`
  if (!exists(first)) return first
  for (let index = 1; index <= MAX_OUTPUT_SUFFIX; index += 1) {
    const candidate = `${base}(${index}).pdf`
    if (!exists(candidate)) return candidate
  }
  return null
}
