/**
 * @file uuid.ts 单测：v4 格式与版本位、批量上限、时间戳 ID、crypto 缺失回退
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it, vi } from 'vitest'
import {
  UUID_MAX_COUNT,
  formatUuidV4,
  generateTimestampId,
  generateUuidV4,
  generateUuids
} from './uuid'

/** RFC 4122 v4 形态 */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('formatUuidV4', () => {
  it('全零字节 → 版本位 4 与变体位 8', () => {
    expect(formatUuidV4(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('全 0xff 字节 → 变体位收窄为 b', () => {
    expect(formatUuidV4(new Uint8Array(16).fill(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })

  it('不足 16 字节时高位补零', () => {
    expect(formatUuidV4(Uint8Array.from([1, 2]))).toBe('01020000-0000-4000-8000-000000000000')
  })
})

describe('generateUuidV4', () => {
  it('符合 RFC 4122 v4 形态', () => {
    expect(generateUuidV4()).toMatch(UUID_V4_PATTERN)
  })

  it('200 次生成无重复', () => {
    const values = new Set(Array.from({ length: 200 }, () => generateUuidV4()))
    expect(values.size).toBe(200)
  })

  it('crypto 缺失时回退 Math.random 仍为合法 v4', () => {
    const original = globalThis.crypto
    vi.stubGlobal('crypto', undefined)
    try {
      expect(generateUuidV4()).toMatch(UUID_V4_PATTERN)
    } finally {
      vi.stubGlobal('crypto', original)
    }
  })
})

describe('generateUuids', () => {
  it('批量数量与格式正确', () => {
    const values = generateUuids(3)
    expect(values).toHaveLength(3)
    for (const value of values) expect(value).toMatch(UUID_V4_PATTERN)
  })

  it('上限 100', () => {
    expect(UUID_MAX_COUNT).toBe(100)
    expect(generateUuids(100)).toHaveLength(100)
  })

  it('越界数量报 DT_INVALID_PAYLOAD', () => {
    for (const count of [0, -1, 101, 1.5]) {
      try {
        generateUuids(count)
        throw new Error('应当抛出参数错误')
      } catch (err) {
        expect((err as { code?: string }).code).toBe('DT_INVALID_PAYLOAD')
      }
    }
  })
})

describe('generateTimestampId', () => {
  it('固定时间 → yyyyMMdd-HHmmss-xxxx', () => {
    const id = generateTimestampId(new Date(2026, 0, 2, 3, 4, 5))
    expect(id).toMatch(/^20260102-030405-[0-9a-z]{4}$/)
  })

  it('后缀固定 4 位且只含 0-9a-z', () => {
    for (let index = 0; index < 20; index += 1) {
      const id = generateTimestampId(new Date(2026, 0, 2, 3, 4, 5))
      expect(id.slice(16)).toMatch(/^[0-9a-z]{4}$/)
    }
  })
})
