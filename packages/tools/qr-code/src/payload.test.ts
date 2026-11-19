/**
 * @file payload 单测（WiFi/vCard 转义与内容校验）
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import {
  buildQrContent,
  buildVCardPayload,
  buildWifiPayload,
  escapeVCardValue,
  escapeWifiValue,
  isValidUrl
} from './payload'

describe('escapeWifiValue / buildWifiPayload', () => {
  it('转义分号/冒号/逗号/引号/反斜杠', () => {
    expect(escapeWifiValue('a;b,c:d"e\\f')).toBe('a\\;b\\,c\\:d\\"e\\\\f')
  })

  it('WPA 输出含密码与隐藏标记', () => {
    expect(
      buildWifiPayload({ ssid: 'my;net', password: 'p@ss', encryption: 'WPA', hidden: true })
    ).toBe('WIFI:T:WPA;S:my\\;net;P:p@ss;H:true;;')
  })

  it('nopass 省略密码段', () => {
    expect(
      buildWifiPayload({ ssid: 'open', password: 'ignored', encryption: 'nopass', hidden: false })
    ).toBe('WIFI:T:nopass;S:open;H:false;;')
  })
})

describe('escapeVCardValue / buildVCardPayload', () => {
  it('反斜杠优先转义，换行转 \\n，逗号分号加反斜杠', () => {
    expect(escapeVCardValue('a\\b\nc,d;e')).toBe('a\\\\b\\nc\\,d\\;e')
  })

  it('空可选字段省略，行分隔为 CRLF', () => {
    const text = buildVCardPayload({
      name: '张三',
      org: '',
      title: '  ',
      phone: '13800000000',
      email: '',
      url: '',
      address: '北京市,朝阳区'
    })
    expect(text).toBe(
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'N:张三',
        'FN:张三',
        'TEL;TYPE=CELL:13800000000',
        'ADR:;;北京市\\,朝阳区',
        'END:VCARD'
      ].join('\r\n')
    )
  })

  it('完整名片含全部字段', () => {
    const text = buildVCardPayload({
      name: 'Li',
      org: 'Lumin',
      title: 'Dev',
      phone: '1',
      email: 'a@b.c',
      url: 'https://x.y',
      address: 'Addr'
    })
    expect(text).toContain('ORG:Lumin')
    expect(text).toContain('TITLE:Dev')
    expect(text).toContain('EMAIL:a@b.c')
    expect(text).toContain('URL:https://x.y')
  })
})

describe('isValidUrl / buildQrContent', () => {
  it('网址判定仅接受 http/https', () => {
    expect(isValidUrl(' https://a.b ')).toBe(true)
    expect(isValidUrl('http://a')).toBe(true)
    expect(isValidUrl('ftp://a')).toBe(false)
    expect(isValidUrl('a.b')).toBe(false)
  })

  it('文本去首尾空白', () => {
    expect(buildQrContent({ type: 'text', value: '  hello  ' })).toBe('hello')
  })

  it('空文本与非法网址抛结构化错误', () => {
    expect(() => buildQrContent({ type: 'text', value: '   ' })).toThrowError(
      expect.objectContaining({ code: 'QR_INVALID_CONTENT' })
    )
    expect(() => buildQrContent({ type: 'url', value: 'abc' })).toThrowError(
      expect.objectContaining({ code: 'QR_INVALID_CONTENT' })
    )
    expect(() => buildQrContent({ type: 'url', value: '' })).toThrowError(
      expect.objectContaining({ code: 'QR_INVALID_CONTENT' })
    )
  })

  it('超长内容归 QR_CONTENT_TOO_LONG', () => {
    expect(() => buildQrContent({ type: 'text', value: 'x'.repeat(2001) })).toThrowError(
      expect.objectContaining({ code: 'QR_CONTENT_TOO_LONG' })
    )
    expect(() => buildQrContent({ type: 'url', value: `https://a.b/${'x'.repeat(2048)}` })).toThrowError(
      expect.objectContaining({ code: 'QR_CONTENT_TOO_LONG' })
    )
  })

  it('WiFi 空 SSID 或加密方式缺密码抛错', () => {
    expect(() =>
      buildQrContent({
        type: 'wifi',
        wifi: { ssid: ' ', password: '', encryption: 'nopass', hidden: false }
      })
    ).toThrowError(expect.objectContaining({ code: 'QR_INVALID_CONTENT' }))
    expect(() =>
      buildQrContent({
        type: 'wifi',
        wifi: { ssid: 'a', password: '', encryption: 'WEP', hidden: false }
      })
    ).toThrowError(expect.objectContaining({ code: 'QR_INVALID_CONTENT' }))
  })

  it('名片校验姓名/邮箱/网址', () => {
    expect(() => buildQrContent({ type: 'vcard', vcard: { name: ' ' } })).toThrowError(
      expect.objectContaining({ code: 'QR_INVALID_CONTENT' })
    )
    expect(() =>
      buildQrContent({ type: 'vcard', vcard: { name: 'A', email: 'bad' } })
    ).toThrowError(expect.objectContaining({ code: 'QR_INVALID_CONTENT' }))
    expect(() =>
      buildQrContent({ type: 'vcard', vcard: { name: 'A', url: 'ftp://x' } })
    ).toThrowError(expect.objectContaining({ code: 'QR_INVALID_CONTENT' }))
    expect(
      buildQrContent({ type: 'vcard', vcard: { name: 'A', email: 'a@b.c', url: 'https://x.y' } })
    ).toContain('EMAIL:a@b.c')
  })
})
