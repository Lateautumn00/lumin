/**
 * @file encode.ts 单测（spec §5 质量映射/编码参数/缩放求解/失败归类）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 纯函数全分支覆盖：四格式编码参数、动图 webp 动画路径、缩放四模式与
 *              「不放大」边界、avif 磁盘满归类
 */
import { describe, expect, it } from 'vitest'
import {
  buildEffectFilter,
  buildEncodeArgs,
  buildScaleArgs,
  classifyFfmpegFailure,
  qualityToCrf,
  qualityToQscale,
  resolveTargetSize
} from './encode'

describe('buildEffectFilter（M40 调整，spec §5）', () => {
  it('灰度 → hue=s=0', () => {
    expect(buildEffectFilter('grayscale', 128)).toBe('hue=s=0')
  })

  it('反色 → negate', () => {
    expect(buildEffectFilter('invert', 128)).toBe('negate')
  })

  it('黑白二值 → format=gray + lut 阈值', () => {
    expect(buildEffectFilter('binary', 128)).toBe(
      "format=gray,lut=y='if(gt(val,128),255,0)'"
    )
  })

  it('阈值钳制 0–255 并取整', () => {
    expect(buildEffectFilter('binary', -20)).toContain('gt(val,0)')
    expect(buildEffectFilter('binary', 300)).toContain('gt(val,255)')
    expect(buildEffectFilter('binary', 127.6)).toContain('gt(val,128)')
    expect(buildEffectFilter('binary', Number.NaN)).toContain('gt(val,128)')
  })
})

describe('qualityToQscale（jpg mjpeg）', () => {
  it('质量 100 → qscale 2（最好）', () => {
    expect(qualityToQscale(100)).toBe(2)
  })

  it('质量 1 → qscale 31（最差）', () => {
    expect(qualityToQscale(1)).toBe(31)
  })

  it('质量 75 → 中段取整', () => {
    expect(qualityToQscale(75)).toBe(9)
  })

  it('越界收窄（0/101 按 1/100 处理）', () => {
    expect(qualityToQscale(0)).toBe(31)
    expect(qualityToQscale(101)).toBe(2)
  })
})

describe('qualityToCrf（avif libaom-av1）', () => {
  it('质量 100 → crf 0（最好）', () => {
    expect(qualityToCrf(100)).toBe(0)
  })

  it('质量 1 → crf 62（63 - 1×63/100 = 62.37 → 62）', () => {
    expect(qualityToCrf(1)).toBe(62)
  })

  it('越界收窄（0/101 按 1/100 处理）', () => {
    expect(qualityToCrf(0)).toBe(62)
    expect(qualityToCrf(101)).toBe(0)
  })
})

describe('buildEncodeArgs', () => {
  it('jpg：首帧 + qscale', () => {
    expect(buildEncodeArgs({ format: 'jpg', quality: 100, animated: false })).toEqual([
      '-frames:v',
      '1',
      '-q:v',
      '2'
    ])
  })

  it('png：忽略质量，固定压缩级别', () => {
    expect(buildEncodeArgs({ format: 'png', quality: 1, animated: false })).toEqual([
      '-frames:v',
      '1',
      '-compression_level',
      '6'
    ])
  })

  it('webp 静态：首帧 + quality', () => {
    expect(buildEncodeArgs({ format: 'webp', quality: 75, animated: false })).toEqual([
      '-frames:v',
      '1',
      '-quality',
      '75'
    ])
  })

  it('webp 动图（gif→webp 拍板路径）：全部帧 + loop 0，不取首帧', () => {
    expect(buildEncodeArgs({ format: 'webp', quality: 75, animated: true })).toEqual([
      '-loop',
      '0',
      '-quality',
      '75'
    ])
  })

  it('avif：still-picture + cpu-used 6（实测参数口径）', () => {
    expect(buildEncodeArgs({ format: 'avif', quality: 50, animated: false })).toEqual([
      '-frames:v',
      '1',
      '-crf',
      '32',
      '-cpu-used',
      '6',
      '-still-picture',
      '1'
    ])
  })

  it('bmp/tiff：无质量参数，仅取首帧（压缩「原格式」直出）', () => {
    expect(buildEncodeArgs({ format: 'bmp', quality: 75, animated: false })).toEqual([
      '-frames:v',
      '1'
    ])
    expect(buildEncodeArgs({ format: 'tiff', quality: 75, animated: false })).toEqual([
      '-frames:v',
      '1'
    ])
  })

  it('动图 + 静态目标（gif→jpg）：animated 标志不影响静态路径', () => {
    expect(buildEncodeArgs({ format: 'jpg', quality: 75, animated: true })).toEqual([
      '-frames:v',
      '1',
      '-q:v',
      '9'
    ])
  })
})

describe('resolveTargetSize（spec §5 四模式 + 不放大）', () => {
  const original = { width: 1000, height: 600 }

  it('percent：等比缩放', () => {
    expect(resolveTargetSize(original, { mode: 'percent', percent: 50 }, false)).toEqual({
      width: 500,
      height: 300
    })
  })

  it('percent 非整除四舍五入', () => {
    expect(resolveTargetSize(original, { mode: 'percent', percent: 33 }, false)).toEqual({
      width: 330,
      height: 198
    })
  })

  it('width：等比求高', () => {
    expect(resolveTargetSize(original, { mode: 'width', width: 500 }, false)).toEqual({
      width: 500,
      height: 300
    })
  })

  it('height：等比求宽', () => {
    expect(resolveTargetSize(original, { mode: 'height', height: 300 }, false)).toEqual({
      width: 500,
      height: 300
    })
  })

  it('fit：取小系数适配框', () => {
    expect(
      resolveTargetSize(original, { mode: 'fit', fitWidth: 400, fitHeight: 600 }, false)
    ).toEqual({
      width: 400,
      height: 240
    })
  })

  it('noUpscale：目标大于原图 → null（跳过缩放直接重编码）', () => {
    expect(resolveTargetSize(original, { mode: 'percent', percent: 200 }, true)).toBeNull()
    expect(resolveTargetSize(original, { mode: 'width', width: 2000 }, true)).toBeNull()
    expect(
      resolveTargetSize(original, { mode: 'fit', fitWidth: 4000, fitHeight: 4000 }, true)
    ).toBeNull()
  })

  it('noUpscale：目标小于原图 → 正常缩放', () => {
    expect(resolveTargetSize(original, { mode: 'percent', percent: 200 }, false)).toEqual({
      width: 2000,
      height: 1200
    })
  })

  it('noUpscale：恰好等于原图 → 正常返回原尺寸', () => {
    expect(resolveTargetSize(original, { mode: 'width', width: 1000 }, true)).toEqual({
      width: 1000,
      height: 600
    })
  })

  it('小图缩到不足 1px 时钳为 1', () => {
    expect(
      resolveTargetSize({ width: 2, height: 2 }, { mode: 'percent', percent: 1 }, false)
    ).toEqual({
      width: 1,
      height: 1
    })
  })
})

describe('buildScaleArgs', () => {
  it('null → 空数组（无缩放滤镜）', () => {
    expect(buildScaleArgs(null)).toEqual([])
  })

  it('尺寸 → scale=W:H', () => {
    expect(buildScaleArgs({ width: 1280, height: 720 })).toEqual(['-vf', 'scale=1280:720'])
  })
})

describe('classifyFfmpegFailure（spec §7）', () => {
  it('ENOSPC 文案 → 磁盘满专项', () => {
    expect(classifyFfmpegFailure('I/O error: No space left on device')).toBe(
      'IT_OUTPUT_WRITE_FAILED'
    )
  })

  it('输出目录打不开（icacls deny 实测文案，含输出路径）→ 输出侧', () => {
    expect(classifyFfmpegFailure('Could not open file : E:\\out\\a.png', 'E:\\out\\a.png')).toBe(
      'IT_OUTPUT_WRITE_FAILED'
    )
    expect(
      classifyFfmpegFailure(
        'Error submitting a packet to the muxer: I/O error\nError muxing a packet',
        'E:\\out\\a.png'
      )
    ).toBe('IT_OUTPUT_WRITE_FAILED')
    expect(classifyFfmpegFailure('Permission denied')).toBe('IT_OUTPUT_WRITE_FAILED')
  })

  it('输入打不开（占用现场：Could not open file 指向输入路径）→ 损坏/占用侧', () => {
    expect(
      classifyFfmpegFailure(
        'Could not open file : E:\\in\\locked.png\\nInvalid data found',
        'E:\\out\\locked.png.webp'
      )
    ).toBe('IT_FILE_CORRUPT')
  })

  it('其他 stderr → 损坏/加密', () => {
    expect(classifyFfmpegFailure('Invalid data found when processing input')).toBe(
      'IT_FILE_CORRUPT'
    )
  })
})
