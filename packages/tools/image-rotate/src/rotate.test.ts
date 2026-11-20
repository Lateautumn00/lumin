/**
 * @file rotate.ts 单测（纯函数：滤镜链/命名/编码参数/失败归类）
 * @author cuilanchao
 * @date 2026-11-20
 * @description spec §4/§5 锁定：先翻转后旋转、顺时针角度映射、命名模板与冲突后缀、
 *              按扩展名的编码参数与 ffmpeg stderr 归类
 */
import { describe, expect, it } from 'vitest'
import {
  buildEncodeArgs,
  buildFilterArgs,
  buildFilterChain,
  buildRotateOutputName,
  classifyFfmpegFailure
} from './rotate'

describe('buildFilterChain / buildFilterArgs', () => {
  it('空操作 → 空滤镜链与空参数', () => {
    expect(buildFilterChain({ rotation: 'none', flip: 'none' })).toEqual([])
    expect(buildFilterArgs({ rotation: 'none', flip: 'none' })).toEqual([])
  })

  it('旋转角度映射（顺时针）', () => {
    expect(buildFilterChain({ rotation: '90', flip: 'none' })).toEqual(['transpose=1'])
    expect(buildFilterChain({ rotation: '180', flip: 'none' })).toEqual([
      'transpose=1',
      'transpose=1'
    ])
    expect(buildFilterChain({ rotation: '270', flip: 'none' })).toEqual(['transpose=2'])
  })

  it('翻转映射（水平/垂直）', () => {
    expect(buildFilterChain({ rotation: 'none', flip: 'horizontal' })).toEqual(['hflip'])
    expect(buildFilterChain({ rotation: 'none', flip: 'vertical' })).toEqual(['vflip'])
  })

  it('组合顺序固定：先翻转后旋转', () => {
    expect(buildFilterArgs({ rotation: '90', flip: 'horizontal' })).toEqual([
      '-vf',
      'hflip,transpose=1'
    ])
    expect(buildFilterArgs({ rotation: '180', flip: 'vertical' })).toEqual([
      '-vf',
      'vflip,transpose=1,transpose=1'
    ])
  })
})

describe('buildRotateOutputName', () => {
  it('仅旋转：主名 + 旋转角度', () => {
    expect(
      buildRotateOutputName({ inputName: '照片.JPG', rotation: '90', flip: 'none', ext: 'jpg' })
    ).toBe('照片_旋转90.jpg')
    expect(
      buildRotateOutputName({ inputName: '照片.png', rotation: '180', flip: 'none', ext: 'png' })
    ).toBe('照片_旋转180.png')
    expect(
      buildRotateOutputName({ inputName: '照片.webp', rotation: '270', flip: 'none', ext: 'webp' })
    ).toBe('照片_旋转270.webp')
  })

  it('仅翻转：水平/垂直', () => {
    expect(
      buildRotateOutputName({
        inputName: 'a.jpg',
        rotation: 'none',
        flip: 'horizontal',
        ext: 'jpg'
      })
    ).toBe('a_水平翻转.jpg')
    expect(
      buildRotateOutputName({ inputName: 'a.jpg', rotation: 'none', flip: 'vertical', ext: 'jpg' })
    ).toBe('a_垂直翻转.jpg')
  })

  it('组合：旋转在前、翻转在后', () => {
    expect(
      buildRotateOutputName({
        inputName: 'a.jpg',
        rotation: '90',
        flip: 'horizontal',
        ext: 'jpg'
      })
    ).toBe('a_旋转90_水平翻转.jpg')
  })

  it('无扩展名 / 隐藏文件 / 多点文件名', () => {
    expect(
      buildRotateOutputName({ inputName: 'noext', rotation: '90', flip: 'none', ext: 'png' })
    ).toBe('noext_旋转90.png')
    expect(
      buildRotateOutputName({ inputName: '.hidden', rotation: '90', flip: 'none', ext: 'png' })
    ).toBe('.hidden_旋转90.png')
    expect(
      buildRotateOutputName({ inputName: 'v1.2.3.png', rotation: '90', flip: 'none', ext: 'png' })
    ).toBe('v1.2.3_旋转90.png')
  })
})

describe('buildEncodeArgs', () => {
  it('jpg 高质量 / webp 92 / png 压缩 6 / bmp·tiff 无参数', () => {
    expect(buildEncodeArgs('jpg')).toEqual(['-q:v', '2'])
    expect(buildEncodeArgs('webp')).toEqual(['-quality', '92'])
    expect(buildEncodeArgs('png')).toEqual(['-compression_level', '6'])
    expect(buildEncodeArgs('bmp')).toEqual([])
    expect(buildEncodeArgs('tiff')).toEqual([])
  })
})

describe('classifyFfmpegFailure', () => {
  it('磁盘满 / 权限拒绝 → 输出侧失败', () => {
    expect(classifyFfmpegFailure('No space left on device')).toBe('IR_OUTPUT_WRITE_FAILED')
    expect(classifyFfmpegFailure('Permission denied')).toBe('IR_OUTPUT_WRITE_FAILED')
    expect(classifyFfmpegFailure('Access is denied.')).toBe('IR_OUTPUT_WRITE_FAILED')
  })

  it('输出路径 open 失败 / muxing 失败 → 输出侧失败', () => {
    expect(classifyFfmpegFailure('Could not open file : E:\\out\\a.png', 'E:\\out\\a.png')).toBe(
      'IR_OUTPUT_WRITE_FAILED'
    )
    expect(classifyFfmpegFailure('Error muxing a packet', 'E:\\out\\a.png')).toBe(
      'IR_OUTPUT_WRITE_FAILED'
    )
  })

  it('解码失败 / 无输出路径线索 → 输入损坏', () => {
    expect(classifyFfmpegFailure('Invalid data found when processing input')).toBe(
      'IR_FILE_CORRUPT'
    )
    expect(classifyFfmpegFailure('Could not open file : E:\\out\\a.png')).toBe('IR_FILE_CORRUPT')
  })
})
