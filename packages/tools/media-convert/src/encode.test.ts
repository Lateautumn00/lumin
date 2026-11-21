import { describe, expect, it } from 'vitest'
import {
  buildAudioConvertArgs,
  buildCompressArgs,
  buildExtractAudioArgs,
  buildTranscodeArgs,
  buildTrimArgs,
  classifyFfmpegFailure
} from './encode'

describe('buildTranscodeArgs', () => {
  it('mp4 含 faststart 与 x264/aac', () => {
    const args = buildTranscodeArgs('mp4', 'medium', 'in.mp4', 'out.mp4')
    expect(args.slice(0, 6)).toEqual(['-y', '-v', 'error', '-progress', 'pipe:1', '-nostats'])
    expect(args).toContain('libx264')
    expect(args).toContain('aac')
    expect(args.join(' ')).toContain('-crf 23')
    expect(args).toContain('+faststart')
    expect(args.at(-1)).toBe('out.mp4')
  })

  it('webm 用 vp9/opus 且无 faststart', () => {
    const args = buildTranscodeArgs('webm', 'high', 'in.mp4', 'out.webm')
    expect(args).toContain('libvpx-vp9')
    expect(args).toContain('libopus')
    expect(args).not.toContain('+faststart')
    expect(args.at(-1)).toBe('out.webm')
  })

  it('mkv 不加 faststart', () => {
    const args = buildTranscodeArgs('mkv', 'low', 'in.mp4', 'out.mkv')
    expect(args).toContain('libx264')
    expect(args).not.toContain('+faststart')
  })
})

describe('buildTrimArgs', () => {
  it('精确模式重编码', () => {
    const args = buildTrimArgs({ startSec: 0.5, endSec: 2, fastCopy: false }, 'in.mp4', 'o.mp4')
    expect(args.join(' ')).toContain('-ss 0.5 -to 2 -i in.mp4')
    expect(args).toContain('libx264')
    expect(args).toContain('+faststart')
  })

  it('快速模式流复制', () => {
    const args = buildTrimArgs({ startSec: 10, endSec: 20, fastCopy: true }, 'in.mp4', 'o.mp4')
    expect(args.join(' ')).toContain('-ss 10 -to 20 -i in.mp4')
    expect(args.join(' ')).toContain('-c copy')
    expect(args).not.toContain('libx264')
  })
})

describe('buildExtractAudioArgs', () => {
  it('有损格式带码率、无视频', () => {
    const args = buildExtractAudioArgs({ format: 'mp3', bitrate: 320 }, 'in.mp4', 'o.mp3')
    expect(args).toContain('-vn')
    expect(args.join(' ')).toContain('-c:a libmp3lame -b:a 320k')
  })

  it('wav/flac 无损忽略码率', () => {
    const wav = buildExtractAudioArgs({ format: 'wav', bitrate: 128 }, 'in.mp4', 'o.wav')
    expect(wav.join(' ')).toContain('-c:a pcm_s16le')
    expect(wav.join(' ')).not.toContain('-b:a')
    const flac = buildExtractAudioArgs({ format: 'flac', bitrate: 192 }, 'in.mp4', 'o.flac')
    expect(flac.join(' ')).toContain('-c:a flac')
    expect(flac.join(' ')).not.toContain('-b:a')
  })
})

describe('buildAudioConvertArgs', () => {
  it('有损格式带码率并丢弃附加视频轨', () => {
    const args = buildAudioConvertArgs({ format: 'mp3', bitrate: 192 }, 'in.wav', 'out.mp3')
    expect(args.join(' ')).toContain('-c:a libmp3lame -b:a 192k')
    expect(args).toContain('-vn')
    expect(args.at(-1)).toBe('out.mp3')
  })

  it('无损格式不含码率', () => {
    const args = buildAudioConvertArgs({ format: 'flac', bitrate: 320 }, 'in.mp3', 'out.flac')
    expect(args.join(' ')).toContain('-c:a flac')
    expect(args.join(' ')).not.toContain('-b:a')
  })
})

describe('buildCompressArgs', () => {
  it('原尺寸不含 scale', () => {
    const args = buildCompressArgs({ level: 'medium', maxHeight: 0 }, 'in.mp4', 'o.mp4')
    expect(args.join(' ')).not.toContain('scale=')
    expect(args.join(' ')).toContain('-preset veryfast -crf 26')
  })

  it('720p 上限生成只缩不放的 scale', () => {
    const args = buildCompressArgs({ level: 'high', maxHeight: 720 }, 'in.mp4', 'o.mp4')
    const joined = args.join(' ')
    expect(joined).toContain("scale=w='min(iw,1280)':h='min(ih,720)'")
    expect(joined).toContain('force_original_aspect_ratio=decrease')
    expect(joined).toContain('yuv420p')
    expect(joined).toContain('-preset medium -crf 20')
  })
})

describe('classifyFfmpegFailure', () => {
  it('磁盘满 / 权限 / 损坏 / 缺文件', () => {
    expect(classifyFfmpegFailure('No space left on device')).toBe('MC_OUTPUT_WRITE_FAILED')
    expect(classifyFfmpegFailure('Permission denied')).toBe('MC_OUTPUT_WRITE_FAILED')
    expect(classifyFfmpegFailure('moov atom not found')).toBe('MC_FILE_CORRUPT')
    expect(classifyFfmpegFailure('No such file or directory')).toBe('MC_FILE_UNSUPPORTED')
    expect(classifyFfmpegFailure('weird internal error')).toBe('MC_FILE_CORRUPT')
  })
})
