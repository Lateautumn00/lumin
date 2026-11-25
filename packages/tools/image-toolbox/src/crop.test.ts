/**
 * @file crop.ts 纯函数单测 + cropOptionsSchema（M70 §4.48 由 image-crop 合并）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 九宫格锚点、比例/自由裁剪滤镜、命名标签与模板、自由区域越界校验
 */
import { describe, expect, it } from 'vitest'
import {
  anchorFactors,
  buildCropFilter,
  buildCropFilterArgs,
  buildCropOutputName,
  cropTag
} from './crop'
import { cropOptionsSchema, type CropOptions } from './schema'

/** 构造比例裁剪参数（默认 16:9 居中，其余字段占位） */
function ratioOptions(over: Partial<CropOptions> = {}): CropOptions {
  return {
    mode: 'ratio',
    ratioW: 16,
    ratioH: 9,
    anchor: 'center',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...over
  }
}

/** 构造自由裁剪参数（默认左侧上半 50%） */
function freeOptions(over: Partial<CropOptions> = {}): CropOptions {
  return {
    mode: 'free',
    ratioW: 1,
    ratioH: 1,
    anchor: 'center',
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    ...over
  }
}

describe('anchorFactors', () => {
  it('九宫格映射到 0 / 0.5 / 1 偏移', () => {
    expect(anchorFactors('top-left')).toEqual({ ax: 0, ay: 0 })
    expect(anchorFactors('center')).toEqual({ ax: 0.5, ay: 0.5 })
    expect(anchorFactors('bottom-right')).toEqual({ ax: 1, ay: 1 })
    expect(anchorFactors('top')).toEqual({ ax: 0.5, ay: 0 })
  })
})

describe('buildCropFilter', () => {
  it('比例裁剪：取最大同比例矩形，逗号转义', () => {
    expect(buildCropFilter(ratioOptions())).toBe(
      'crop=w=min(iw\\,ih*16/9):h=min(ih\\,iw*9/16):x=(iw-ow)*0.5:y=(ih-oh)*0.5'
    )
  })

  it('比例裁剪：锚点影响 x/y 偏移', () => {
    expect(buildCropFilter(ratioOptions({ anchor: 'top-left' }))).toContain(
      ':x=(iw-ow)*0:y=(ih-oh)*0'
    )
    expect(buildCropFilter(ratioOptions({ anchor: 'right' }))).toContain(
      ':x=(iw-ow)*1:y=(ih-oh)*0.5'
    )
  })

  it('自由裁剪：宽高与起点均为百分比', () => {
    expect(buildCropFilter(freeOptions({ x: 10, y: 20, width: 30, height: 40 }))).toBe(
      'crop=w=iw*30/100:h=ih*40/100:x=iw*10/100:y=ih*20/100'
    )
  })
})

describe('buildCropFilterArgs', () => {
  it('恒返回 -vf + 滤镜', () => {
    expect(buildCropFilterArgs(freeOptions())).toEqual([
      '-vf',
      'crop=w=iw*50/100:h=ih*50/100:x=iw*0/100:y=ih*0/100'
    ])
  })
})

describe('cropTag', () => {
  it('比例 → {W}x{H}；自由 → 自由', () => {
    expect(cropTag(ratioOptions({ ratioW: 4, ratioH: 3 }))).toBe('4x3')
    expect(cropTag(freeOptions())).toBe('自由')
  })
})

describe('buildCropOutputName', () => {
  it('命名模板：{主名}_裁剪{标签}.{ext}', () => {
    expect(
      buildCropOutputName({ inputName: 'photo.jpg', options: ratioOptions(), ext: 'jpg' })
    ).toBe('photo_裁剪16x9.jpg')
    expect(
      buildCropOutputName({ inputName: 'a.png', options: freeOptions(), ext: 'png' })
    ).toBe('a_裁剪自由.png')
  })
})

describe('cropOptionsSchema', () => {
  it('缺省字段补默认值（ratio 1:1 居中）', () => {
    expect(cropOptionsSchema.parse({})).toMatchObject({
      mode: 'ratio',
      ratioW: 1,
      ratioH: 1,
      anchor: 'center'
    })
  })

  it('自由裁剪越界（x + width > 100）→ 拒绝', () => {
    expect(cropOptionsSchema.safeParse({ mode: 'free', x: 60, width: 50 }).success).toBe(false)
    expect(cropOptionsSchema.safeParse({ mode: 'free', y: 80, height: 30 }).success).toBe(false)
  })

  it('自由裁剪合法区域 → 通过；比例越界 → 拒绝', () => {
    expect(cropOptionsSchema.safeParse({ mode: 'free', x: 50, width: 50 }).success).toBe(true)
    expect(cropOptionsSchema.safeParse({ mode: 'ratio', ratioW: 0 }).success).toBe(false)
    expect(cropOptionsSchema.safeParse({ mode: 'ratio', ratioH: 101 }).success).toBe(false)
  })
})
