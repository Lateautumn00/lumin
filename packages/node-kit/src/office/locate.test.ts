import { describe, expect, it } from 'vitest'
import {
  locateSoffice,
  parseRegistryInstallPath,
  probeSofficeDir,
  queryRegistryInstallPath,
  REG_HKCU,
  REG_HKLM
} from './locate'

const HKLM_OUTPUT = [
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\LibreOffice\\UNO\\InstallPath',
  '    (默认)    REG_SZ    D:\\software\\LibreOffice\\program',
  '    LibreOffice 26.8    REG_SZ    D:\\software\\LibreOffice\\program',
  ''
].join('\r\n')

describe('parseRegistryInstallPath', () => {
  it('取首个 REG_SZ 值（含 (默认) 行）', () => {
    expect(parseRegistryInstallPath(HKLM_OUTPUT)).toBe('D:\\software\\LibreOffice\\program')
  })

  it('支持 REG_EXPAND_SZ', () => {
    const out = '    (默认)    REG_EXPAND_SZ    %ProgramFiles%\\LibreOffice\\program'
    expect(parseRegistryInstallPath(out)).toBe('%ProgramFiles%\\LibreOffice\\program')
  })

  it('无匹配返回 null', () => {
    expect(parseRegistryInstallPath('找不到指定的注册表值。')).toBeNull()
    expect(parseRegistryInstallPath('')).toBeNull()
  })
})

describe('queryRegistryInstallPath', () => {
  it('HKLM 命中即返回，不查 HKCU', async () => {
    const queried: string[] = []
    const result = await queryRegistryInstallPath(async (key) => {
      queried.push(key)
      return 'C:\\Program\\program'
    })
    expect(result).toBe('C:\\Program\\program')
    expect(queried).toEqual([REG_HKLM])
  })

  it('HKLM 空/缺失时回退 HKCU', async () => {
    const queried: string[] = []
    const result = await queryRegistryInstallPath(async (key) => {
      queried.push(key)
      return key === REG_HKLM ? null : 'C:\\Users\\me\\LibreOffice\\program'
    })
    expect(result).toBe('C:\\Users\\me\\LibreOffice\\program')
    expect(queried).toEqual([REG_HKLM, REG_HKCU])
  })

  it('两级都无 → null', async () => {
    expect(await queryRegistryInstallPath(async () => null)).toBeNull()
  })

  it('空串视为无值继续回退', async () => {
    const result = await queryRegistryInstallPath(async (key) =>
      key === REG_HKLM ? '' : 'HKCU\\path'
    )
    expect(result).toBe('HKCU\\path')
  })
})

describe('probeSofficeDir', () => {
  it('优先 soffice.com', () => {
    const hit = probeSofficeDir('C:\\lo\\program', (p) => p.endsWith('.com'))
    expect(hit).toBe('C:\\lo\\program\\soffice.com')
  })

  it('回退 soffice.exe', () => {
    const hit = probeSofficeDir('C:\\lo\\program', (p) => p.endsWith('.exe'))
    expect(hit).toBe('C:\\lo\\program\\soffice.exe')
  })

  it('都没有 → null', () => {
    expect(probeSofficeDir('C:\\lo\\program', () => false)).toBeNull()
  })
})

describe('locateSoffice', () => {
  const base = {
    portableDir: 'C:\\portable\\program',
    queryRegistry: async (): Promise<string | null> => null,
    exists: (_path: string): boolean => false
  }

  it('自定义路径有效 → custom（最优先）', async () => {
    const result = await locateSoffice({
      ...base,
      customPath: 'D:\\my\\soffice.com',
      exists: (p) => p === 'D:\\my\\soffice.com'
    })
    expect(result).toEqual({
      source: 'custom',
      path: 'D:\\my\\soffice.com',
      customInvalid: false
    })
  })

  it('自定义路径无效 → 回退系统并标记 customInvalid', async () => {
    const result = await locateSoffice({
      ...base,
      customPath: 'D:\\gone\\soffice.exe',
      queryRegistry: async () => 'C:\\lo',
      exists: (p) => p === 'C:\\lo\\program\\soffice.com'
    })
    expect(result).toEqual({
      source: 'system',
      path: 'C:\\lo\\program\\soffice.com',
      customInvalid: true
    })
  })

  it('自定义路径非 .com/.exe（如目录）→ 视为无效', async () => {
    const result = await locateSoffice({
      ...base,
      customPath: 'C:\\LibreOffice',
      queryRegistry: async () => null,
      exists: (p) => p === 'C:\\LibreOffice'
    })
    expect(result.source).toBe('none')
    expect(result.customInvalid).toBe(true)
  })

  it('注册表值已是 program 目录 → 不再拼接', async () => {
    const probed: string[] = []
    const result = await locateSoffice({
      ...base,
      customPath: '',
      queryRegistry: async () => 'C:\\lo\\program',
      exists: (p) => {
        probed.push(p)
        return true
      }
    })
    expect(result.source).toBe('system')
    expect(result.path).toBe('C:\\lo\\program\\soffice.com')
    expect(probed).not.toContain('C:\\lo\\program\\program\\soffice.com')
  })

  it('注册表命中但目录无入口 → 落到便携目录', async () => {
    const result = await locateSoffice({
      ...base,
      customPath: '',
      queryRegistry: async () => 'C:\\broken\\install',
      exists: (p) => p.startsWith('C:\\portable')
    })
    expect(result).toEqual({
      source: 'portable',
      path: 'C:\\portable\\program\\soffice.com',
      customInvalid: false
    })
  })

  it('三级全无 → none', async () => {
    const result = await locateSoffice({ ...base, customPath: '' })
    expect(result).toEqual({ source: 'none', customInvalid: false })
  })

  it('无自定义路径时不带 customInvalid 语义（false）', async () => {
    const result = await locateSoffice({ ...base, customPath: '   ' })
    expect(result.customInvalid).toBe(false)
  })
})
