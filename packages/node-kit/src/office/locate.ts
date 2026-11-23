import { join } from 'node:path'

/** 定位来源（spec §2 三级顺序） */
export type LocateSource = 'custom' | 'system' | 'portable' | 'none'

export interface LocateResult {
  source: LocateSource
  /** soffice.com 或 soffice.exe 的完整路径；source=none 时缺省 */
  path?: string
  /** 自定义路径非空但文件无效（回退系统检测并提示） */
  customInvalid?: boolean
}

/** 注册表查询：返回首个 REG_SZ / REG_EXPAND_SZ 值（GBK 解析后），无则 null */
export type QueryRegistry = (key: string) => Promise<string | null>
/** 同步存在性判定（注入 fs.accessSync 包装） */
export type FileExists = (path: string) => boolean

export const REG_HKLM = 'HKLM\\SOFTWARE\\LibreOffice\\UNO\\InstallPath'
export const REG_HKCU = 'HKCU\\SOFTWARE\\LibreOffice\\UNO\\InstallPath'

/**
 * 解析 `reg query` 文本输出：取第一个 `name  REG_SZ|REG_EXPAND_SZ  value`
 * 行的 value（(默认) 行也算）。无匹配返回 null。
 */
export function parseRegistryInstallPath(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*\S.*?\s+REG_(?:EXPAND_)?SZ\s+(.+)$/.exec(line)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

/** 依次查询 HKLM / HKCU 注册表键，返回首个非空值 */
export async function queryRegistryInstallPath(query: QueryRegistry): Promise<string | null> {
  for (const key of [REG_HKLM, REG_HKCU]) {
    const value = await query(key)
    if (value !== null && value !== '') return value
  }
  return null
}

/** 目录 → 可执行入口：优先 soffice.com（stdout 可捕获），回退 soffice.exe */
export function probeSofficeDir(dir: string, exists: FileExists): string | null {
  const com = join(dir, 'soffice.com')
  if (exists(com)) return com
  const exe = join(dir, 'soffice.exe')
  return exists(exe) ? exe : null
}

/** 注册表值可能指向 program 目录本身或其上级安装目录 */
function withProgramDir(installPath: string): string {
  return /[/\\]program[/\\]?$/i.test(installPath) ? installPath : join(installPath, 'program')
}

/**
 * 三级定位（spec §2，顺序取首个有效项）：
 * 1. 自定义路径（完整指向 soffice.com/exe 且存在；无效则回退并标记 customInvalid）
 * 2. 注册表 HKLM → HKCU InstallPath 下的 program 目录
 * 3. 便携组件目录 portableDir
 */
export async function locateSoffice(options: {
  customPath: string
  portableDir: string
  queryRegistry: QueryRegistry
  exists: FileExists
}): Promise<LocateResult> {
  const { customPath, portableDir, queryRegistry, exists } = options
  let customInvalid = false

  const custom = customPath.trim()
  if (custom !== '') {
    if (/\.(com|exe)$/i.test(custom) && exists(custom)) {
      return { source: 'custom', path: custom, customInvalid: false }
    }
    customInvalid = true
  }

  const regPath = await queryRegistryInstallPath(queryRegistry)
  if (regPath !== null) {
    const hit = probeSofficeDir(withProgramDir(regPath), exists)
    if (hit !== null) return { source: 'system', path: hit, customInvalid }
  }

  const portableHit = probeSofficeDir(portableDir, exists)
  if (portableHit !== null) return { source: 'portable', path: portableHit, customInvalid }

  return { source: 'none', customInvalid }
}
