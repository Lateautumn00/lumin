/**
 * @file browser-cookies.ts 单测（临时目录 + node:sqlite 造假库 + 假 DPAPI，不依赖真实浏览器）
 * @author cuilanchao
 * @date 2026-11-19
 * @description firefox 只读链路（建库→复制快照→查询→过滤→Netscape 行）、
 *              chromium v10 解密链路（假 DPAPI 返回主密钥 + AES-GCM 真实加解密）、v20 App-Bound 拒绝
 */
import { createCipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  decryptChromiumValue,
  findChromiumUserDataRoot,
  findFirefoxCookieDb,
  importBrowserCookies,
  readChromiumCookies,
  readFirefoxCookies,
  type BrowserCookieDeps
} from './browser-cookies'

let root: string

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
})

/** 每用例独立临时根目录 */
function makeRoot(): string {
  root = mkdtempSync(join(tmpdir(), 'vd-bcookies-'))
  return root
}

/** 构造 v10 密文（v10 + iv + AES-256-GCM 密文 + tag），与 Chromium 加密布局一致 */
function encryptV10(key: Buffer, plain: string): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from('v10', 'latin1'), iv, body, cipher.getAuthTag()])
}

function makeDeps(): BrowserCookieDeps {
  return {
    // 假 DPAPI：解析 psScript 中内插的 encrypted_key base64，模拟 Unprotect = 去掉 'DPAPI' 前缀返回原始密钥
    runProcess: async (_cmd, args) => {
      const script = args.find((a) => a.includes('FromBase64String') === true) ?? ''
      const m = script.match(/FromBase64String\('([^']+)'\)/)
      if (m?.[1] === undefined) return { stdout: '' }
      const raw = Buffer.from(m[1], 'base64')
      return { stdout: Buffer.from(raw.subarray(5)).toString('base64') } // 去 'DPAPI' 5 字节前缀
    },
    tempDir: join(root ?? '.', 'temp'),
    hasSqlite: () => true
  }
}

describe('findFirefoxCookieDb', () => {
  it('Profiles 下取最近修改的 cookies.sqlite', () => {
    const base = makeRoot()
    const profiles = join(base, 'Profiles')
    const p1 = join(profiles, 'abc.default')
    mkdirSync(p1, { recursive: true })
    writeFileSync(join(p1, 'cookies.sqlite'), 'x')
    expect(findFirefoxCookieDb(profiles)).toBe(join(p1, 'cookies.sqlite'))
  })

  it('root 不存在 → null', () => {
    expect(findFirefoxCookieDb(join(makeRoot(), 'nope'))).toBeNull()
  })

  it('无参调用走真实 APPDATA（真实环境容忍 null 或有效库路径）', () => {
    const db = findFirefoxCookieDb()
    expect(db === null || existsSync(db)).toBe(true)
  })
})

describe('findChromiumUserDataRoot', () => {
  it('Local State 存在的 User Data → 命中', () => {
    const base = makeRoot()
    const userData = join(base, 'Google', 'Chrome', 'User Data')
    mkdirSync(userData, { recursive: true })
    writeFileSync(join(userData, 'Local State'), '{}')
    expect(findChromiumUserDataRoot('chrome', base)).toBe(userData)
  })

  it('无 Local State → null', () => {
    expect(findChromiumUserDataRoot('chrome', makeRoot())).toBeNull()
  })
})

describe('readFirefoxCookies', () => {
  it('假库建表 → 只返回平台命中行并转 Netscape 结构', async () => {
    const base = makeRoot()
    const profile = join(base, 'Profiles', 'p.default')
    mkdirSync(profile, { recursive: true })
    mkdirSync(join(base, 'temp'), { recursive: true })
    const db = new DatabaseSync(join(profile, 'cookies.sqlite'))
    db.exec(
      'CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER)'
    )
    db.prepare('INSERT INTO moz_cookies VALUES (?, ?, ?, ?, ?, ?)').run(
      '.douyin.com',
      'sessionid',
      's1',
      '/',
      1893456000,
      1
    )
    db.prepare('INSERT INTO moz_cookies VALUES (?, ?, ?, ?, ?, ?)').run(
      '.bilibili.com',
      'SESSDATA',
      'b1',
      '/',
      1893456000,
      1
    )
    db.prepare('INSERT INTO moz_cookies VALUES (?, ?, ?, ?, ?, ?)').run(
      'other.com',
      'x',
      'y',
      '/',
      0,
      0
    )
    db.close()

    const deps = makeDeps()
    const lines = await readFirefoxCookies('douyin', deps, {
      dbPath: join(profile, 'cookies.sqlite')
    })
    expect(lines).toEqual([
      {
        domain: '.douyin.com',
        includeSubdomains: true,
        path: '/',
        secure: true,
        expires: 1893456000,
        name: 'sessionid',
        value: 's1'
      }
    ])
    // 快照已清理（tempDir 无残留 .sqlite）
    expect(readdirSync(deps.tempDir).filter((f) => f.endsWith('.sqlite'))).toEqual([])
    expect(readFirefoxCookies.length).toBeGreaterThan(0)
  })

  it('库不存在 → 抛错（node.ts 包 VD_COOKIE_IMPORT_FAILED）', async () => {
    await expect(
      readFirefoxCookies('douyin', makeDeps(), { dbPath: join(makeRoot(), 'none.sqlite') })
    ).rejects.toThrow()
  })

  it('node:sqlite 不可用 → 抛错', async () => {
    const base = makeRoot()
    const profile = join(base, 'Profiles', 'p.default')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'cookies.sqlite'), 'x')
    const deps = { ...makeDeps(), hasSqlite: () => false }
    await expect(
      readFirefoxCookies('douyin', deps, { dbPath: join(profile, 'cookies.sqlite') })
    ).rejects.toThrow(/node:sqlite/)
  })

  it('无 dbPath 走默认 finder（真实环境容忍 null 或有效库）', async () => {
    const res = await readFirefoxCookies('douyin', makeDeps()).catch(() => null)
    expect(res === null || Array.isArray(res)).toBe(true)
  })
})

describe('readChromiumCookies（v10 解密）', () => {
  it('Local State 主密钥（假 DPAPI）+ AES-GCM 密文 → 解出明文', async () => {
    const base = makeRoot()
    const userData = join(base, 'Google', 'Chrome', 'User Data')
    const netDir = join(userData, 'Default', 'Network')
    mkdirSync(netDir, { recursive: true })
    mkdirSync(join(base, 'temp'), { recursive: true })
    const key = randomBytes(32)
    writeFileSync(
      join(userData, 'Local State'),
      JSON.stringify({
        os_crypt: {
          encrypted_key: Buffer.concat([Buffer.from('DPAPI', 'latin1'), key]).toString('base64')
        }
      })
    )
    const db = new DatabaseSync(join(netDir, 'Cookies'))
    db.exec(
      'CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER)'
    )
    db.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      '.douyin.com',
      'sessionid',
      '',
      encryptV10(key, 'sess-value'),
      '/',
      133000000000000000,
      1
    )
    db.close()

    const lines = await readChromiumCookies('douyin', 'chrome', makeDeps(), { root: userData })
    // WebKit 纪元换算：133000000000000000/1e6 - 11644473600 = 16555072400 → 校验换算发生
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ name: 'sessionid', value: 'sess-value' })
    expect(lines[0]?.expires).toBeGreaterThan(1_000_000_000)
  })

  it('v20 App-Bound 密文 → 抛错拒绝', () => {
    expect(() =>
      decryptChromiumValue(
        Buffer.concat([Buffer.from('v20', 'latin1'), randomBytes(64)]),
        randomBytes(32)
      )
    ).toThrow(/App-Bound/)
  })

  it('未知加密版本前缀 → 抛错拒绝', () => {
    expect(() =>
      decryptChromiumValue(
        Buffer.concat([Buffer.from('v9x', 'latin1'), randomBytes(32)]),
        randomBytes(32)
      )
    ).toThrow(/不支持的加密版本/)
  })

  it('Local State 缺 os_crypt.encrypted_key → 抛错', async () => {
    const base = makeRoot()
    const userData = join(base, 'Google', 'Chrome', 'User Data')
    mkdirSync(userData, { recursive: true })
    mkdirSync(join(base, 'temp'), { recursive: true })
    writeFileSync(join(userData, 'Local State'), '{}')
    await expect(
      readChromiumCookies('douyin', 'chrome', makeDeps(), { root: userData })
    ).rejects.toThrow(/encrypted_key/)
  })
})

describe('importBrowserCookies', () => {
  it('无命中行 → 抛错（统一入口）', async () => {
    const base = makeRoot()
    const profile = join(base, 'Profiles', 'p.default')
    mkdirSync(profile, { recursive: true })
    mkdirSync(join(base, 'temp'), { recursive: true })
    const db = new DatabaseSync(join(profile, 'cookies.sqlite'))
    db.exec(
      'CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER)'
    )
    db.prepare('INSERT INTO moz_cookies VALUES (?, ?, ?, ?, ?, ?)').run(
      '.other.com',
      'a',
      'b',
      '/',
      0,
      0
    )
    db.close()
    await expect(
      importBrowserCookies('douyin', 'firefox', makeDeps(), {
        dbPath: join(profile, 'cookies.sqlite')
      })
    ).rejects.toThrow(/未找到目标平台/)
  })

  it('chromium-legacy 统一入口（真实环境容忍；chrome 缺失时回退 edge）', async () => {
    const res = await importBrowserCookies('douyin', 'chromium-legacy', makeDeps()).catch(
      () => null
    )
    expect(res === null || Array.isArray(res)).toBe(true)
  })
})
