/**
 * @file schema.test.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description IPC 入参 zod 契约单测。
 */
import { describe, expect, it } from 'vitest'
import {
  cleanupPayloadSchema,
  preparePayloadSchema,
  showPayloadSchema,
  statusPayloadSchema
} from './schema'

describe('preparePayloadSchema', () => {
  it('接受 1..200 个路径', () => {
    expect(preparePayloadSchema.safeParse({ inputPaths: ['C:\\a.pdf'] }).success).toBe(true)
  })

  it('空列表与超长列表拒绝', () => {
    expect(preparePayloadSchema.safeParse({ inputPaths: [] }).success).toBe(false)
    expect(
      preparePayloadSchema.safeParse({ inputPaths: Array.from({ length: 201 }, () => 'a') }).success
    ).toBe(false)
  })
})

describe('showPayloadSchema', () => {
  it('jobId 需匹配 [a-z0-9-]{8,64}', () => {
    expect(showPayloadSchema.safeParse({ jobId: 'j-abc12345' }).success).toBe(true)
    expect(showPayloadSchema.safeParse({ jobId: 'J-ABC' }).success).toBe(false)
    expect(showPayloadSchema.safeParse({ jobId: 'short' }).success).toBe(false)
  })
})

describe('cleanupPayloadSchema', () => {
  it('jobIds 可省略', () => {
    expect(cleanupPayloadSchema.safeParse({}).success).toBe(true)
  })

  it('非法 jobId 拒绝', () => {
    expect(cleanupPayloadSchema.safeParse({ jobIds: ['bad id'] }).success).toBe(false)
  })
})

describe('statusPayloadSchema', () => {
  it('customPath 可选且有长度上限', () => {
    expect(statusPayloadSchema.safeParse({}).success).toBe(true)
    expect(statusPayloadSchema.safeParse({ customPath: 'C:\\soffice.exe' }).success).toBe(true)
    expect(statusPayloadSchema.safeParse({ customPath: 'x'.repeat(501) }).success).toBe(false)
  })
})
