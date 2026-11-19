/**
 * @file save 单测（文件名清洗/base64 归一/原子写盘失败清理）
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import { normalizePngBase64, sanitizeBaseName, writeAtomic, type AtomicFs } from './save'

/** 内存 fs（记录调用顺序，供失败清理断言） */
function memoryFs(): { fs: AtomicFs; files: Map<string, string | Buffer>; calls: string[] } {
  const files = new Map<string, string | Buffer>()
  const calls: string[] = []
  return {
    files,
    calls,
    fs: {
      writeFileSync: (file, data) => {
        files.set(file, data)
        calls.push(`write:${file}`)
      },
      renameSync: (from, to) => {
        const data = files.get(from)
        if (data === undefined) throw new Error('missing temp')
        files.delete(from)
        files.set(to, data)
        calls.push(`rename:${to}`)
      },
      unlinkSync: (file) => {
        files.delete(file)
        calls.push(`unlink:${file}`)
      }
    }
  }
}

describe('sanitizeBaseName', () => {
  it('替换非法字符并去末尾点', () => {
    expect(sanitizeBaseName('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i')
    expect(sanitizeBaseName('  name...  ')).toBe('name')
    expect(sanitizeBaseName('line\nbreak')).toBe('line_break')
  })

  it('空值与全非法字符回落 qrcode', () => {
    expect(sanitizeBaseName('')).toBe('qrcode')
    expect(sanitizeBaseName('   ')).toBe('qrcode')
    expect(sanitizeBaseName('...')).toBe('qrcode')
  })

  it('截断到 80 字符', () => {
    expect(sanitizeBaseName('x'.repeat(120)).length).toBe(80)
  })
})

describe('normalizePngBase64', () => {
  it('剥 dataURL 前缀并去空白', () => {
    expect(normalizePngBase64('data:image/png;base64, AAAA ')).toBe('AAAA')
    expect(normalizePngBase64('AA\nAA')).toBe('AAAA')
  })

  it('无前缀时原样保留', () => {
    expect(normalizePngBase64('iVBORw0KGgo=')).toBe('iVBORw0KGgo=')
  })

  it('空串或非法字符抛 QR_INVALID_PAYLOAD', () => {
    expect(() => normalizePngBase64('')).toThrowError(
      expect.objectContaining({ code: 'QR_INVALID_PAYLOAD' })
    )
    expect(() => normalizePngBase64('不是base64')).toThrowError(
      expect.objectContaining({ code: 'QR_INVALID_PAYLOAD' })
    )
    expect(() => normalizePngBase64('AB$CD')).toThrowError(
      expect.objectContaining({ code: 'QR_INVALID_PAYLOAD' })
    )
  })
})

describe('writeAtomic', () => {
  it('成功时写入临时文件后 rename 到目标', () => {
    const { fs, files, calls } = memoryFs()
    writeAtomic('C:\\out\\a.png', 'DATA', fs)
    expect(files.get('C:\\out\\a.png')).toBe('DATA')
    expect(calls[0]).toMatch(/^write:C:\\out\\a\.png\.tmp-/)
    expect(calls[1]).toBe('rename:C:\\out\\a.png')
  })

  it('rename 失败时清理临时文件并透传原错误', () => {
    const { fs, files, calls } = memoryFs()
    fs.renameSync = () => {
      throw new Error('EPERM')
    }
    expect(() => writeAtomic('C:\\out\\b.png', 'DATA', fs)).toThrowError('EPERM')
    expect(files.size).toBe(0)
    expect(calls.some((call) => call.startsWith('unlink:'))).toBe(true)
  })
})
