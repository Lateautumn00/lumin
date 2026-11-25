/**
 * @file schema.test.ts zod 契约单测（AGENTS §7.1 IPC schema 属核心纯函数）
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEMP_EXTENSIONS,
  DEFAULT_TREE_DEPTH,
  emptyDirsPayloadSchema,
  setConfigPayloadSchema,
  tempCleanPayloadSchema,
  touchPayloadSchema,
  treePayloadSchema
} from './schema'

describe('treePayloadSchema', () => {
  it('接受合法入参', () => {
    expect(
      treePayloadSchema.safeParse({ root: 'C:\\a', maxDepth: DEFAULT_TREE_DEPTH, exclude: [] })
        .success
    ).toBe(true)
  })

  it('拒绝空根目录', () => {
    expect(treePayloadSchema.safeParse({ root: '', maxDepth: 3, exclude: [] }).success).toBe(false)
  })

  it('拒绝越界深度', () => {
    expect(treePayloadSchema.safeParse({ root: 'C:\\a', maxDepth: 0, exclude: [] }).success).toBe(
      false
    )
    expect(treePayloadSchema.safeParse({ root: 'C:\\a', maxDepth: 11, exclude: [] }).success).toBe(
      false
    )
  })

  it('拒绝超过 50 条排除规则', () => {
    const exclude = Array.from({ length: 51 }, (_, index) => `p${index}`)
    expect(treePayloadSchema.safeParse({ root: 'C:\\a', maxDepth: 3, exclude }).success).toBe(false)
  })
})

describe('emptyDirsPayloadSchema', () => {
  it('只接受非空根目录', () => {
    expect(emptyDirsPayloadSchema.safeParse({ root: 'C:\\a' }).success).toBe(true)
    expect(emptyDirsPayloadSchema.safeParse({ root: '' }).success).toBe(false)
  })
})

describe('touchPayloadSchema', () => {
  const base = {
    root: 'C:\\a',
    recursive: true,
    extensions: ['txt'],
    mtimeMs: 1_700_000_000_000,
    dryRun: false
  }

  it('接受合法入参', () => {
    expect(touchPayloadSchema.safeParse(base).success).toBe(true)
  })

  it('拒绝负数时间戳', () => {
    expect(touchPayloadSchema.safeParse({ ...base, mtimeMs: -1 }).success).toBe(false)
  })

  it('拒绝过长扩展名', () => {
    expect(touchPayloadSchema.safeParse({ ...base, extensions: ['a'.repeat(33)] }).success).toBe(
      false
    )
  })
})

describe('tempCleanPayloadSchema', () => {
  it('扩展名规则至少一条', () => {
    expect(
      tempCleanPayloadSchema.safeParse({ root: 'C:\\a', recursive: true, extensions: [] }).success
    ).toBe(false)
    expect(
      tempCleanPayloadSchema.safeParse({ root: 'C:\\a', recursive: true, extensions: ['log'] })
        .success
    ).toBe(true)
  })
})

describe('setConfigPayloadSchema', () => {
  it('接受合法入参并允许省略 lastRoot', () => {
    const parsed = setConfigPayloadSchema.safeParse({
      treeDepth: 4,
      treeExclude: ['dist'],
      tempExtensions: DEFAULT_TEMP_EXTENSIONS
    })
    expect(parsed.success).toBe(true)
  })

  it('treeDepth 越界被拒绝', () => {
    expect(
      setConfigPayloadSchema.safeParse({
        treeDepth: 0,
        treeExclude: [],
        tempExtensions: []
      }).success
    ).toBe(false)
  })
})
