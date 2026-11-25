/**
 * @file rotate.ts 纯函数单测 + rotateOptionsSchema（M70 §4.48 由 image-rotate 合并）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 滤镜链顺序（先翻转后旋转）、-vf 参数、产物命名模板、至少选一项校验
 */
import { describe, expect, it } from 'vitest'
import { buildFilterArgs, buildFilterChain, buildRotateOutputName } from './rotate'
import { rotateOptionsSchema } from './schema'

describe('buildFilterChain', () => {
  it('不旋转不翻转 → 空链', () => {
    expect(buildFilterChain({ rotation: 'none', flip: 'none' })).toEqual([])
  })

  it('先翻转后旋转：水平翻转 + 90°', () => {
    expect(buildFilterChain({ rotation: '90', flip: 'horizontal' })).toEqual([
      'hflip',
      'transpose=1'
    ])
  })

  it('180° = 两次 transpose=1；270° = transpose=2（垂直翻转在前）', () => {
    expect(buildFilterChain({ rotation: '180', flip: 'none' })).toEqual([
      'transpose=1',
      'transpose=1'
    ])
    expect(buildFilterChain({ rotation: '270', flip: 'vertical' })).toEqual([
      'vflip',
      'transpose=2'
    ])
  })
})

describe('buildFilterArgs', () => {
  it('有操作 → -vf <链>', () => {
    expect(buildFilterArgs({ rotation: '90', flip: 'none' })).toEqual(['-vf', 'transpose=1'])
  })

  it('无操作 → 空数组（不追加 -vf）', () => {
    expect(buildFilterArgs({ rotation: 'none', flip: 'none' })).toEqual([])
  })
})

describe('buildRotateOutputName', () => {
  it('命名模板：{主名}_旋转{角度}_{翻转}.{ext}', () => {
    expect(
      buildRotateOutputName({
        inputName: 'photo.jpg',
        rotation: '90',
        flip: 'horizontal',
        ext: 'jpg'
      })
    ).toBe('photo_旋转90_水平翻转.jpg')
  })

  it('仅翻转 / 仅旋转 / 无扩展名主名', () => {
    expect(
      buildRotateOutputName({ inputName: 'a.png', rotation: 'none', flip: 'vertical', ext: 'png' })
    ).toBe('a_垂直翻转.png')
    expect(
      buildRotateOutputName({ inputName: 'a.png', rotation: '180', flip: 'none', ext: 'png' })
    ).toBe('a_旋转180.png')
    expect(
      buildRotateOutputName({ inputName: 'noext', rotation: '90', flip: 'none', ext: 'webp' })
    ).toBe('noext_旋转90.webp')
  })
})

describe('rotateOptionsSchema', () => {
  it('旋转与翻转全为 none → 拒绝', () => {
    expect(rotateOptionsSchema.safeParse({ rotation: 'none', flip: 'none' }).success).toBe(false)
  })

  it('任一非 none → 通过', () => {
    expect(rotateOptionsSchema.safeParse({ rotation: '90', flip: 'none' }).success).toBe(true)
    expect(rotateOptionsSchema.safeParse({ rotation: 'none', flip: 'vertical' }).success).toBe(true)
  })

  it('非法角度 → 拒绝', () => {
    expect(rotateOptionsSchema.safeParse({ rotation: '45', flip: 'none' }).success).toBe(false)
  })
})
