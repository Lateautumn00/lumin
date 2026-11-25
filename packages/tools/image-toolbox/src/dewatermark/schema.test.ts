/**
 * @file schema.test.ts IPC 入参校验与默认值单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 白名单/区域上下限/模糊半径默认 12/输出目录可选
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BLUR_RADIUS,
  MAX_REGIONS,
  dewatermarkPayloadSchema,
  setOutputDirPayloadSchema
} from './schema'

const region = { x: 0, y: 0, width: 10, height: 10 }

describe('dewatermarkPayloadSchema', () => {
  it('接受合法入参并补默认模糊半径', () => {
    const parsed = dewatermarkPayloadSchema.parse({
      inputPath: 'C:\\imgs\\a.PNG',
      regions: [region],
      mode: 'inpaint'
    })
    expect(parsed.blurRadius).toBe(DEFAULT_BLUR_RADIUS)
    expect(parsed.outputDir).toBeUndefined()
  })

  it('拒绝非白名单扩展名', () => {
    expect(() =>
      dewatermarkPayloadSchema.parse({
        inputPath: 'a.gif',
        regions: [region],
        mode: 'blur'
      })
    ).toThrow(/仅支持/)
  })

  it('拒绝空区域/超上限/过小区域/非法模式', () => {
    expect(() =>
      dewatermarkPayloadSchema.parse({ inputPath: 'a.png', regions: [], mode: 'blur' })
    ).toThrow()
    expect(() =>
      dewatermarkPayloadSchema.parse({
        inputPath: 'a.png',
        regions: Array.from({ length: MAX_REGIONS + 1 }, () => region),
        mode: 'blur'
      })
    ).toThrow()
    expect(() =>
      dewatermarkPayloadSchema.parse({
        inputPath: 'a.png',
        regions: [{ x: 0, y: 0, width: 1, height: 10 }],
        mode: 'solid'
      })
    ).toThrow()
    expect(() =>
      dewatermarkPayloadSchema.parse({
        inputPath: 'a.png',
        regions: [region],
        mode: 'magic'
      })
    ).toThrow()
  })

  it('模糊半径越界被拒绝', () => {
    expect(() =>
      dewatermarkPayloadSchema.parse({
        inputPath: 'a.png',
        regions: [region],
        mode: 'blur',
        blurRadius: 3
      })
    ).toThrow()
    expect(() =>
      dewatermarkPayloadSchema.parse({
        inputPath: 'a.png',
        regions: [region],
        mode: 'blur',
        blurRadius: 41
      })
    ).toThrow()
  })
})

describe('setOutputDirPayloadSchema', () => {
  it('要求非空目录', () => {
    expect(setOutputDirPayloadSchema.parse({ outputDir: 'D:\\out' })).toEqual({
      outputDir: 'D:\\out'
    })
    expect(() => setOutputDirPayloadSchema.parse({ outputDir: '' })).toThrow()
  })
})
