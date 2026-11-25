/**
 * @file 浏览器 Cookie 自动读取（spec §9.3；二期）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 只读实现：firefox = cookies.sqlite（node:sqlite）直读；
 *              chromium-legacy = Cookies 库 + Local State 密钥（DPAPI 经 PowerShell 解密）
 *              + node:crypto AES-256-GCM 解密（v10；v20 App-Bound 明确不支持）。
 *              不写浏览器库、不装扩展；失败一律抛 VD_COOKIE_IMPORT_FAILED。
 */
import { createDecipheriv } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CookiePlatform, NetscapeCookieLine } from './cookies'

/** 平台后缀（与 cookies.ts 同源表；此处按 host_key 过滤用） */
const PLATFORM_HOST_SUFFIXES: Record<CookiePlatform, readonly string[]> = {
  douyin: ['douyin.com'],
  bilibili: ['bilibili.com', 'bilibili.tv'],
  youtube: ['youtube.com', 'youtu.be']
}

/** 浏览器自动读取运行时依赖（可注入便于单测） */
export interface BrowserCookieDeps {
  /** PowerShell 进程执行（DPAPI 解密用；node-kit runProcess） */
  runProcess: (
    cmd: string,
    args: string[],
    opts?: { timeoutMs?: number }
  ) => Promise<{ stdout: string }>
  /** 临时目录（复制 sqlite 快照落这里，避免源库被浏览器锁占用） */
  tempDir: string
  /** 库文件是否支持 node:sqlite（Electron 主进程可用性运行时探测） */
  hasSqlite: () => boolean
}

/**
 * 定位 Firefox 默认 profile 的 cookies.sqlite（Profiles 下取最近修改且存在者）
 * @param root Profiles 目录（默认 %APPDATA%/Mozilla/Firefox/Profiles；测试注入临时目录）
 * @returns 库路径；未找到 → null
 */
export function findFirefoxCookieDb(root?: string): string | null {
  const base =
    root ??
    join(
      process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
      'Mozilla',
      'Firefox',
      'Profiles'
    )
  if (!existsSync(base)) return null
  let best: { path: string; mtime: number } | null = null
  for (const dir of readdirSync(base)) {
    const db = join(base, dir, 'cookies.sqlite')
    if (!existsSync(db)) continue
    const mtime = statSync(db).mtimeMs
    if (best === null || mtime > best.mtime) best = { path: db, mtime }
  }
  return best?.path ?? null
}

/**
 * 定位 Chromium 系 User Data 根（legacy 支持旧版 Chrome/Edge）
 * @param kind 'chrome' | 'edge'
 * @param localAppData %LOCALAPPDATA%（默认真实目录；测试注入临时目录）
 */
export function findChromiumUserDataRoot(
  kind: 'chrome' | 'edge',
  localAppData?: string
): string | null {
  const base = localAppData ?? process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  const candidates =
    kind === 'chrome'
      ? [join(base, 'Google', 'Chrome', 'User Data')]
      : [join(base, 'Microsoft', 'Edge', 'User Data')]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'Local State'))) return dir
  }
  return null
}

/** host 是否命中平台域名（spec §9.1 匹配表） */
function hostMatches(host: string, platform: CookiePlatform): boolean {
  const h = host.toLowerCase().replace(/^\./, '')
  return PLATFORM_HOST_SUFFIXES[platform].some((suffix) => h === suffix || h.endsWith(`.${suffix}`))
}

/**
 * DPAPI 解密 Local State 中的 os_crypt.encrypted_key（CurrentUser 作用域）
 * @param encryptedKeyBase64 'DPAPI' 前缀 base64 密文
 * @param deps 运行时依赖
 */
async function dpapiUnprotect(
  encryptedKeyBase64: string,
  deps: BrowserCookieDeps
): Promise<Buffer> {
  // 密钥短，直接内插进 PowerShell 脚本（-NonInteractive 无 stdin 依赖）
  const psScript = `Add-Type -AssemblyName System.Security; [Console]::Out.Write([Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${encryptedKeyBase64}'), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)))`
  const result = await deps.runProcess(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psScript],
    { timeoutMs: 15000 }
  )
  if (result.stdout === '') throw new Error('DPAPI 解密返回空')
  // stdout 可能带 BOM/杂字符：取 base64 尾段
  const match = result.stdout.match(/([A-Za-z0-9+/=]{40,})\s*$/)
  const b64 = match?.[1]
  if (b64 === undefined) throw new Error('DPAPI 解密输出无法识别')
  return Buffer.from(b64, 'base64')
}

/**
 * 解密 Chromium cookie 值（v10 = AES-256-GCM，key 来自 Local State；v20 = App-Bound 不支持）
 * @param encrypted 密文（前缀 v10/v20）
 * @param aesKey DPAPI 解出的主密钥
 */
export function decryptChromiumValue(encrypted: Buffer, aesKey: Buffer): string {
  const prefix = encrypted.subarray(0, 3).toString('latin1')
  if (prefix === 'v20') throw new Error('该浏览器为新版 App-Bound 加密，不支持自动读取')
  if (prefix !== 'v10') throw new Error(`不支持的加密版本：${prefix}`)
  const iv = encrypted.subarray(3, 15)
  const body = encrypted.subarray(15, encrypted.length - 16)
  const tag = encrypted.subarray(encrypted.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

/**
 * 从 Firefox profile 读取目标平台 cookie（只读；复制库快照规避占用）
 * @param platform 目标平台
 * @param deps 运行时依赖
 * @param opts 测试注入：dbPath 跳过 finder 直接指定库文件
 */
export async function readFirefoxCookies(
  platform: CookiePlatform,
  deps: BrowserCookieDeps,
  opts: { dbPath?: string } = {}
): Promise<NetscapeCookieLine[]> {
  const dbPath = opts.dbPath ?? findFirefoxCookieDb()
  if (dbPath === null) throw new Error('未找到 Firefox cookies.sqlite（未安装或未使用过）')
  if (!deps.hasSqlite()) throw new Error('运行环境缺少 node:sqlite 支持')
  const snapshot = join(deps.tempDir, `ff-cookies-${Date.now()}.sqlite`)
  copyFileSync(dbPath, snapshot)
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(snapshot, { readOnly: true })
    try {
      const rows = db
        .prepare('SELECT host, name, value, path, expiry, isSecure FROM moz_cookies')
        .all() as Array<{
        host: string
        name: string
        value: string
        path: string
        expiry: number
        isSecure: number
      }>
      return rows
        .filter((row) => hostMatches(row.host, platform) && row.name !== '' && row.value !== '')
        .map((row) => ({
          domain: row.host.startsWith('.') ? row.host : `.${row.host}`,
          includeSubdomains: true,
          path: row.path === '' ? '/' : row.path,
          secure: row.isSecure === 1,
          expires: row.expiry,
          name: row.name,
          value: row.value
        }))
    } finally {
      db.close()
    }
  } finally {
    try {
      unlinkSync(snapshot)
    } catch {
      // 清理失败不影响结果（temp 目录系统回收）
    }
  }
}

/**
 * 从旧版 Chromium/Edge（v10 加密）读取目标平台 cookie
 * @param platform 目标平台
 * @param kind 浏览器种类
 * @param deps 运行时依赖
 * @param opts 测试注入：root 跳过 finder 直接指定 User Data 根
 */
export async function readChromiumCookies(
  platform: CookiePlatform,
  kind: 'chrome' | 'edge',
  deps: BrowserCookieDeps,
  opts: { root?: string } = {}
): Promise<NetscapeCookieLine[]> {
  const root = opts.root ?? findChromiumUserDataRoot(kind)
  if (root === null) throw new Error(`未找到 ${kind === 'chrome' ? 'Chrome' : 'Edge'} 用户数据目录`)
  if (!deps.hasSqlite()) throw new Error('运行环境缺少 node:sqlite 支持')

  // 主密钥：Local State → os_crypt.encrypted_key（'DPAPI' 前缀）
  const localState = JSON.parse(readFileSync(join(root, 'Local State'), 'utf8')) as {
    os_crypt?: { encrypted_key?: string }
  }
  const encryptedKey = localState.os_crypt?.encrypted_key
  if (encryptedKey === undefined) throw new Error('Local State 缺少 os_crypt.encrypted_key')
  const aesKey = await dpapiUnprotect(encryptedKey, deps)

  // 默认 profile 的 Cookies 库快照
  const dbPath = join(root, 'Default', 'Network', 'Cookies')
  const legacyPath = join(root, 'Default', 'Cookies')
  const source = existsSync(dbPath) ? dbPath : legacyPath
  if (!existsSync(source)) throw new Error('未找到 Cookies 数据库')
  const snapshot = join(deps.tempDir, `cr-cookies-${Date.now()}.sqlite`)
  copyFileSync(source, snapshot)
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(snapshot, { readOnly: true })
    try {
      // expires_utc 实际值 ~1.33e17 超出 JS Number 安全整数范围，CAST 为 REAL 规避 node:sqlite 整数溢出
      const rows = db
        .prepare(
          'SELECT host_key, name, value, encrypted_value, path, CAST(expires_utc AS REAL) AS expires_utc, is_secure FROM cookies'
        )
        .all() as Array<{
        host_key: string
        name: string
        value: string
        encrypted_value: Buffer | null
        path: string
        expires_utc: number
        is_secure: number
      }>
      return rows
        .filter((row) => hostMatches(row.host_key, platform) && row.name !== '')
        .map((row) => {
          // 明文 value 优先；否则解 encrypted_value
          let value = row.value
          if (value === '' && row.encrypted_value !== null && row.encrypted_value.length > 3) {
            value = decryptChromiumValue(Buffer.from(row.encrypted_value), aesKey)
          }
          if (value === '') throw new Error(`cookie ${row.name} 无法解密`)
          // WebKit 纪元（1601）微秒 → Unix 秒；0 = 会话级
          const expires = row.expires_utc > 0 ? Math.floor(row.expires_utc / 1e6 - 11644473600) : 0
          return {
            domain: row.host_key.startsWith('.') ? row.host_key : `.${row.host_key}`,
            includeSubdomains: true,
            path: row.path === '' ? '/' : row.path,
            secure: row.is_secure === 1,
            expires,
            name: row.name,
            value
          }
        })
    } finally {
      db.close()
    }
  } finally {
    try {
      unlinkSync(snapshot)
    } catch {
      // 清理失败不影响结果
    }
  }
}

/**
 * 统一入口：按 browser 类型读取（spec §9.2 import-browser task 调用）
 * @param platform 目标平台
 * @param browser 浏览器类型
 * @param deps 运行时依赖
 * @param opts 测试注入：dbPath/root 透传给对应 read*，跳过 finder
 */
export async function importBrowserCookies(
  platform: CookiePlatform,
  browser: 'firefox' | 'chromium-legacy',
  deps: BrowserCookieDeps,
  opts: { dbPath?: string; root?: string } = {}
): Promise<NetscapeCookieLine[]> {
  const lines =
    browser === 'firefox'
      ? await readFirefoxCookies(platform, deps, { dbPath: opts.dbPath })
      : await readChromiumCookies(platform, 'chrome', deps, { root: opts.root }).catch(() =>
          readChromiumCookies(platform, 'edge', deps, { root: opts.root })
        )
  if (lines.length === 0) throw new Error('该浏览器库中未找到目标平台的 Cookie')
  return lines
}
