/**
 * @file 二维码内容组装纯函数（文本/网址/WiFi/vCard）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 按 ZXing WiFi 与 vCard 3.0 规范转义并组装内容（spec §6.1）；
 *              校验失败抛结构化错误，主进程仍以 zod 兜底
 */
import {
  MAX_TEXT_CHARS,
  MAX_URL_CHARS,
  URL_RE,
  type QrContent,
  type VCardInput,
  type WifiInput
} from './schema'
import { toolError } from './errors'

/** WiFi 值需转义的字符（ZXing 规范：反斜杠、分号、逗号、冒号、双引号） */
const WIFI_ESCAPE_RE = /([\\;,:"])/g

/**
 * 转义 WiFi 字段值
 * @param value 原始字段值
 */
export function escapeWifiValue(value: string): string {
  return value.replace(WIFI_ESCAPE_RE, '\\$1')
}

/**
 * 组装 WiFi 二维码内容
 * @param input WiFi 表单
 */
export function buildWifiPayload(input: WifiInput): string {
  const parts = [`WIFI:T:${input.encryption};`, `S:${escapeWifiValue(input.ssid)};`]
  if (input.encryption !== 'nopass') parts.push(`P:${escapeWifiValue(input.password)};`)
  parts.push(`H:${input.hidden ? 'true' : 'false'};;`)
  return parts.join('')
}

/**
 * 转义 vCard 字段值（反斜杠优先，换行转 `\n`，逗号/分号加反斜杠）
 * @param value 原始字段值
 */
export function escapeVCardValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/**
 * 判断网址是否合法（去空白后匹配 http/https）
 * @param value 原始输入
 */
export function isValidUrl(value: string): boolean {
  return URL_RE.test(value.trim())
}

/**
 * 组装 vCard 3.0 内容（空字段省略）
 * @param input 名片表单
 */
export function buildVCardPayload(input: VCardInput): string {
  const escape = escapeVCardValue
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escape(input.name)}`,
    `FN:${escape(input.name)}`
  ]
  const optional: Array<[string, string | undefined]> = [
    ['ORG', input.org],
    ['TITLE', input.title],
    ['TEL;TYPE=CELL', input.phone],
    ['EMAIL', input.email],
    ['URL', input.url]
  ]
  for (const [key, value] of optional) {
    const trimmed = value?.trim() ?? ''
    if (trimmed !== '') lines.push(`${key}:${escape(trimmed)}`)
  }
  const address = input.address?.trim() ?? ''
  if (address !== '') lines.push(`ADR:;;${escape(address)}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

/**
 * 按内容类型组装二维码文本（含字段校验）
 * @param input 生成内容
 * @returns 可直接交给二维码库的字符串
 */
export function buildQrContent(input: QrContent): string {
  if (input.type === 'text') {
    const value = input.value.trim()
    if (value === '') throw toolError('QR_INVALID_CONTENT', '内容不能为空')
    if (value.length > MAX_TEXT_CHARS) {
      throw toolError('QR_CONTENT_TOO_LONG', `文本最多 ${MAX_TEXT_CHARS} 字符`)
    }
    return value
  }
  if (input.type === 'url') {
    const value = input.value.trim()
    if (value === '') throw toolError('QR_INVALID_CONTENT', '网址不能为空')
    if (value.length > MAX_URL_CHARS) {
      throw toolError('QR_CONTENT_TOO_LONG', `网址最多 ${MAX_URL_CHARS} 字符`)
    }
    if (!URL_RE.test(value))
      throw toolError('QR_INVALID_CONTENT', '网址须以 http:// 或 https:// 开头')
    return value
  }
  if (input.type === 'wifi') {
    const wifi = input.wifi
    if (wifi.ssid.trim() === '') throw toolError('QR_INVALID_CONTENT', 'SSID 不能为空')
    if (wifi.encryption !== 'nopass' && wifi.password.trim() === '') {
      throw toolError('QR_INVALID_CONTENT', '该加密方式必须填写密码')
    }
    return buildWifiPayload(wifi)
  }
  const vcard = input.vcard
  if (vcard.name.trim() === '') throw toolError('QR_INVALID_CONTENT', '姓名不能为空')
  const email = vcard.email?.trim() ?? ''
  if (email !== '' && !email.includes('@')) throw toolError('QR_INVALID_CONTENT', '邮箱格式不正确')
  const url = vcard.url?.trim() ?? ''
  if (url !== '' && !URL_RE.test(url)) {
    throw toolError('QR_INVALID_CONTENT', '网址须以 http:// 或 https:// 开头')
  }
  return buildVCardPayload(vcard)
}
