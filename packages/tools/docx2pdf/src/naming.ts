import { resolveConflictPath } from '@lumin/node-kit'

/**
 * 输出路径命名（spec §7.3）：`{原名}.pdf`；冲突依次 `{原名}(1).pdf` … `{原名}(99).pdf`；
 * 全部占用返回 null（调用方报 OUTPUT_MISSING）。冲突递增核心上提 `@lumin/node-kit`
 * （AGENTS 铁律 3，与 exam-split 共用），本模块只保留 docx2pdf 的输入基名推导。
 */
export { MAX_CONFLICT_SUFFIX as MAX_OUTPUT_SUFFIX } from '@lumin/node-kit'

export function resolveOutputPath(
  inputPath: string,
  exists: (path: string) => boolean
): string | null {
  const dot = inputPath.lastIndexOf('.')
  const base = dot > 0 ? inputPath.slice(0, dot) : inputPath
  return resolveConflictPath(`${base}.pdf`, exists)
}
