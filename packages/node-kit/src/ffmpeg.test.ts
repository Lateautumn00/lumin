/**
 * @file ffmpeg.test.ts 图片类 ffmpeg 公共纯函数单测
 * @author cuilanchao
 * @date 2026-11-21
 * @description 编码参数矩阵与单张失败归类（磁盘满/权限/输出打开/输入损坏）
 */
import { describe, expect, it } from 'vitest'
import { buildImageEncodeArgs, classifyFfmpegFailure } from './ffmpeg'

describe('buildImageEncodeArgs', () => {
  it('jpg/jpeg 走高质量量化', () => {
    expect(buildImageEncodeArgs('jpg')).toEqual(['-q:v', '2'])
    expect(buildImageEncodeArgs('jpeg')).toEqual(['-q:v', '2'])
  })

  it('webp/png 各自质量参数', () => {
    expect(buildImageEncodeArgs('webp')).toEqual(['-quality', '92'])
    expect(buildImageEncodeArgs('png')).toEqual(['-compression_level', '6'])
  })

  it('bmp/tiff 无质量参数', () => {
    expect(buildImageEncodeArgs('bmp')).toEqual([])
    expect(buildImageEncodeArgs('tiff')).toEqual([])
  })
})

describe('classifyFfmpegFailure', () => {
  it('磁盘满 → 输出写盘失败', () => {
    expect(classifyFfmpegFailure('No space left on device')).toBe('OUTPUT_WRITE_FAILED')
  })

  it('权限错误 → 输出写盘失败', () => {
    expect(classifyFfmpegFailure('Permission denied')).toBe('OUTPUT_WRITE_FAILED')
    expect(classifyFfmpegFailure('Access is denied')).toBe('OUTPUT_WRITE_FAILED')
  })

  it('Windows deny-ACL 输出路径命中 → 输出写盘失败', () => {
    const out = 'E:\\out\\a (1).png'
    expect(classifyFfmpegFailure(`Could not open file : ${out}`, out)).toBe(
      'OUTPUT_WRITE_FAILED'
    )
  })

  it('mux 写包失败 → 输出写盘失败', () => {
    expect(classifyFfmpegFailure('Error muxing a packet', 'E:\\out\\a.png')).toBe(
      'OUTPUT_WRITE_FAILED'
    )
    expect(classifyFfmpegFailure('Error submitting a packet to the muxer', 'a.png')).toBe(
      'OUTPUT_WRITE_FAILED'
    )
  })

  it('其余（解码/损坏）→ 文件损坏', () => {
    expect(classifyFfmpegFailure('Invalid data found when processing input')).toBe(
      'FILE_CORRUPT'
    )
    // 未提供输出路径时不做输出侧判定
    expect(classifyFfmpegFailure('Could not open file : E:\\out\\a.png')).toBe('FILE_CORRUPT')
  })
})
