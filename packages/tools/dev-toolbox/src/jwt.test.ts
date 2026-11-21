/**
 * @file jwt.ts 单测：Base64URL 解码、结构校验、exp/iat 时效与错误分支
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import { base64UrlDecode, base64UrlToBytes, decodeJwt, formatJwtTime } from './jwt'

/** 已知样本：HS256 / sub=1234567890 / exp=1516242622 */
const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6Ikx1bWluIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyNDI2MjJ9.samplesignature'

/** 头段（固定样本） */
const HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

/** JSON → Base64URL（仅测试用） */
function toBase64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** 断言抛出 DT_JWT_INVALID（可附带 detail 片段断言） */
function expectJwtError(action: () => unknown, detailPart?: string): void {
  try {
    action()
    throw new Error('应当抛出 JWT 解码错误')
  } catch (err) {
    const candidate = err as { code?: string; message?: string; detail?: string }
    expect(candidate.code).toBe('DT_JWT_INVALID')
    expect(candidate.message).toBe('JWT 格式无效')
    if (detailPart !== undefined) expect(candidate.detail).toContain(detailPart)
  }
}

describe('base64UrlToBytes / base64UrlDecode', () => {
  it('URL 安全字母表 -/_ 正确映射', () => {
    expect([...base64UrlToBytes('-_8')]).toEqual([251, 255])
  })

  it('忽略 = 填充', () => {
    expect(base64UrlDecode('eyJhIjoxfQ==')).toBe('{"a":1}')
  })

  it('非法字符报 DT_JWT_INVALID', () => {
    expectJwtError(() => base64UrlDecode('a*b'), '非法字符')
  })

  it('非 UTF-8 字节报 DT_JWT_INVALID', () => {
    expectJwtError(() => base64UrlDecode('-_8'), '不是合法 UTF-8')
  })

  it('中文 UTF-8 往返正确', () => {
    const encoded = Buffer.from('{"name":"中文"}').toString('base64url')
    expect(base64UrlDecode(encoded)).toBe('{"name":"中文"}')
  })
})

describe('decodeJwt', () => {
  it('解出 header / payload / 签名', () => {
    const decoded = decodeJwt(SAMPLE, 1516239022)
    expect(decoded.header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(decoded.payload['sub']).toBe('1234567890')
    expect(decoded.payload['name']).toBe('Lumin')
    expect(decoded.signature).toBe('samplesignature')
    expect(decoded.signaturePresent).toBe(true)
  })

  it('exp 未到期时 expired=false', () => {
    const decoded = decodeJwt(SAMPLE, 1516242621)
    expect(decoded.exp).toBe(1516242622)
    expect(decoded.expired).toBe(false)
  })

  it('exp 到期（边界 <=）时 expired=true', () => {
    expect(decodeJwt(SAMPLE, 1516242622).expired).toBe(true)
    expect(decodeJwt(SAMPLE, 1516242700).expired).toBe(true)
  })

  it('iat 解析为秒级数字', () => {
    expect(decodeJwt(SAMPLE, 0).iat).toBe(1516239022)
  })

  it('接受 Bearer 前缀与首尾空白', () => {
    expect(decodeJwt(`  Bearer ${SAMPLE}  `, 0).payload['sub']).toBe('1234567890')
  })

  it('空签名段时 signaturePresent=false', () => {
    const token = `${HEADER}.${toBase64Url({ sub: 'x' })}.`
    const decoded = decodeJwt(token, 0)
    expect(decoded.signature).toBe('')
    expect(decoded.signaturePresent).toBe(false)
  })

  it('无 exp/iat 时为 null 且未过期', () => {
    const decoded = decodeJwt(`${HEADER}.${toBase64Url({ sub: 'x' })}.sig`, 999)
    expect(decoded.exp).toBeNull()
    expect(decoded.iat).toBeNull()
    expect(decoded.expired).toBe(false)
  })

  it('exp 非数字时视为缺失', () => {
    const decoded = decodeJwt(`${HEADER}.${toBase64Url({ exp: 'later' })}.sig`, 999)
    expect(decoded.exp).toBeNull()
    expect(decoded.expired).toBe(false)
  })

  it('空输入报错', () => {
    expectJwtError(() => decodeJwt('   '), '请输入 JWT')
  })

  it('分段数不为 3 报错（2 段 / 4 段）', () => {
    expectJwtError(() => decodeJwt('a.b'), '实际为 2')
    expectJwtError(() => decodeJwt('a.b.c.d'), '实际为 4')
  })

  it('Header 非法 JSON 报错', () => {
    expectJwtError(() => decodeJwt(`bm90LWpzb24.${toBase64Url({})}.sig`), 'Header 不是合法 JSON')
  })

  it('Payload 为数组报错', () => {
    expectJwtError(() => decodeJwt(`${HEADER}.WzFd.sig`), 'Payload 必须是 JSON 对象')
  })

  it('Payload 为标量报错', () => {
    expectJwtError(() => decodeJwt(`${HEADER}.MTIz.sig`), 'Payload 必须是 JSON 对象')
  })
})

describe('formatJwtTime', () => {
  it('秒级 epoch 转本地时间文本', () => {
    const text = formatJwtTime(new Date(2026, 0, 2, 3, 4, 5).getTime() / 1000)
    expect(text).toBe('2026-01-02 03:04:05')
  })
})
