/**
 * @file crop.ts 单测（滤镜字符串 / 九宫格锚点 / 命名 / 编码参数 / 失败归类）
 * @author cuilanchao
 * @date 2026-11-21
 * @description spec §4/§5：比例取最大同比例矩形，自由按百分比，标签与命名固定
 */
import { describe, expect, it } from 'vitest'
import {
  ANCHOR_FACTORS,
  anchorFactors,
  buildCropFilter,
  buildCropFilterArgs,
  buildCropOutputName,
  buildEncodeArgs,
  classifyCropFailure,
  cropTag
} from './crop'
import type { CropAnchor, CropOptions } from './schema'

/** 比例模式参数（其余字段取 schema 默认） */
function ratioOptions(overrides: Partial<CropOptions> = {}): CropOptions {
  return {
    mode: 'ratio',
    ratioW: 1,
    ratioH: 1,
    anchor: 'center',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...overrides
  }
}

/** 自由模式参数 */
function freeOptions(overrides: Partial<CropOptions> = {}): CropOptions {
  return ratioOptions({ mode: 'free', ...overrides })
}

describe('anchorFactors', () => {
  it('九宫格系数全覆盖', () => {
    expect(ANCHOR_FACTORS).toEqual({
      'top-left': { ax: 0, ay: 0 },
      top: { ax: 0.5, ay: 0 },
      'top-right': { ax: 1, ay: 0 },
      left: { ax: 0, ay: 0.5 },
      center: { ax: 0.5, ay: 0.5 },
      right: { ax: 1, ay: 0.5 },
      'bottom-left': { ax: 0, ay: 1 },
      bottom: { ax: 0.5, ay: 1 },
      'bottom-right': { ax: 1, ay: 1 }
    })
    const anchors = Object.keys(ANCHOR_FACTORS) as CropAnchor[]
    expect(anchors.map((anchor) => anchorFactors(anchor))).toHaveLength(9)
  })
})

describe('buildCropFilter（比例）', () => {
  it('1:1 居中：max 正方形 + 中心偏移', () => {
    expect(buildCropFilter(ratioOptions())).toBe(
      'crop=w=min(iw\\,ih*1/1):h=min(ih\\,iw*1/1):x=(iw-ow)*0.5:y=(ih-oh)*0.5'
    )
  })

  it('16:9 左上：宽高按比例、偏移 0', () => {
    expect(buildCropFilter(ratioOptions({ ratioW: 16, ratioH: 9, anchor: 'top-left' }))).toBe(
      'crop=w=min(iw\\,ih*16/9):h=min(ih\\,iw*9/16):x=(iw-ow)*0:y=(ih-oh)*0'
    )
  })

  it('3:2 右下：偏移取满', () => {
    expect(buildCropFilter(ratioOptions({ ratioW: 3, ratioH: 2, anchor: 'bottom-right' }))).toBe(
      'crop=w=min(iw\\,ih*3/2):h=min(ih\\,iw*2/3):x=(iw-ow)*1:y=(ih-oh)*1'
    )
  })
})

describe('buildCropFilter（自由）', () => {
  it('百分比区域：宽高与起点均按图片尺寸换算', () => {
    expect(
      buildCropFilter(freeOptions({ x: 10, y: 20, width: 50, height: 40 }))
    ).toBe('crop=w=iw*50/100:h=ih*40/100:x=iw*10/100:y=ih*20/100')
  })
})

describe('buildCropFilterArgs', () => {
  it('恒返回 -vf 两项', () => {
    const args = buildCropFilterArgs(ratioOptions())
    expect(args[0]).toBe('-vf')
    expect(args[1]).toBe(buildCropFilter(ratioOptions()))
  })
})

describe('cropTag / buildCropOutputName', () => {
  it('比例标签取 WxH，自由为「自由」', () => {
    expect(cropTag(ratioOptions())).toBe('1x1')
    expect(cropTag(ratioOptions({ ratioW: 16, ratioH: 9 }))).toBe('16x9')
    expect(cropTag(freeOptions())).toBe('自由')
  })

  it('比例命名与扩展名归一', () => {
    expect(
      buildCropOutputName({ inputName: '照片.JPG', options: ratioOptions(), ext: 'jpg' })
    ).toBe('照片_裁剪1x1.jpg')
    expect(
      buildCropOutputName({
        inputName: 'my.photo.png',
        options: ratioOptions({ ratioW: 3, ratioH: 2 }),
        ext: 'png'
      })
    ).toBe('my.photo_裁剪3x2.png')
  })

  it('自由命名；无扩展名输入保留整名为主名', () => {
    expect(
      buildCropOutputName({ inputName: 'a.webp', options: freeOptions(), ext: 'webp' })
    ).toBe('a_裁剪自由.webp')
    expect(
      buildCropOutputName({ inputName: 'README', options: ratioOptions(), ext: 'png' })
    ).toBe('README_裁剪1x1.png')
  })
})

describe('buildEncodeArgs', () => {
  it('委托公共编码参数', () => {
    expect(buildEncodeArgs('jpg')).toEqual(['-q:v', '2'])
    expect(buildEncodeArgs('png')).toEqual(['-compression_level', '6'])
    expect(buildEncodeArgs('bmp')).toEqual([])
  })
})

describe('classifyCropFailure', () => {
  it('输出侧失败映射 IC_OUTPUT_WRITE_FAILED', () => {
    expect(classifyCropFailure('No space left on device')).toBe('IC_OUTPUT_WRITE_FAILED')
    expect(classifyCropFailure('Permission denied')).toBe('IC_OUTPUT_WRITE_FAILED')
  })

  it('输入损坏映射 IC_FILE_CORRUPT', () => {
    expect(classifyCropFailure('Invalid data found when processing input')).toBe(
      'IC_FILE_CORRUPT'
    )
  })
})
