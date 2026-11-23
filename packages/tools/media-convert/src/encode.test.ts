import { describe, expect, it } from 'vitest'
import {
  buildAudioConvertArgs,
  buildCompressArgs,
  buildExtractAudioArgs,
  buildRemuxArgs,
  buildTranscodeArgs,
  buildTrimArgs,
  classifyFfmpegFailure
} from './encode'
import type { TranscodeOptions } from './schema'

/** 格式转换参数默认值（测试就近覆盖） */
function transcodeOptions(overrides: Partial<TranscodeOptions> = {}): TranscodeOptions {
  return {
    format: 'mp4',
    mode: 'encode',
    quality: 'medium',
    codec: 'h264',
    resolution: { kind: 'original' },
    fps: 0,
    videoBitrateKbps: 0,
    audioBitrateKbps: 192,
    removeAudio: false,
    ...overrides
  }
}

describe('buildTranscodeArgs', () => {
  it('mp4 含 faststart 与 x264/aac', () => {
    const args = buildTranscodeArgs(transcodeOptions(), 'in.mp4', 'out.mp4')
    expect(args.slice(0, 6)).toEqual(['-y', '-v', 'error', '-progress', 'pipe:1', '-nostats'])
    expect(args).toContain('libx264')
    expect(args).toContain('aac')
    expect(args.join(' ')).toContain('-crf 23')
    expect(args.join(' ')).toContain('-b:a 192k')
    expect(args).toContain('+faststart')
    expect(args.at(-1)).toBe('out.mp4')
  })

  it('webm 用 vp9/opus 且无 faststart', () => {
    const args = buildTranscodeArgs(
      transcodeOptions({ format: 'webm', quality: 'high' }),
      'in.mp4',
      'out.webm'
    )
    expect(args).toContain('libvpx-vp9')
    expect(args).toContain('libopus')
    expect(args.join(' ')).toContain('-crf 28')
    expect(args).not.toContain('+faststart')
    expect(args.at(-1)).toBe('out.webm')
  })

  it('mkv 不加 faststart', () => {
    const args = buildTranscodeArgs(
      transcodeOptions({ format: 'mkv', quality: 'low' }),
      'in.mp4',
      'out.mkv'
    )
    expect(args).toContain('libx264')
    expect(args.join(' ')).toContain('-crf 28')
    expect(args).not.toContain('+faststart')
  })

  it('H.265 走 libx265', () => {
    const args = buildTranscodeArgs(transcodeOptions({ codec: 'h265' }), 'in.mp4', 'out.mp4')
    expect(args).toContain('libx265')
    expect(args).not.toContain('libx264')
  })

  it('avi 音频固定 MP3；mov 加 faststart', () => {
    const avi = buildTranscodeArgs(transcodeOptions({ format: 'avi' }), 'in.mp4', 'out.avi')
    expect(avi).toContain('libmp3lame')
    expect(avi).not.toContain('+faststart')
    const mov = buildTranscodeArgs(transcodeOptions({ format: 'mov' }), 'in.mp4', 'out.mov')
    expect(mov).toContain('+faststart')
  })

  it('自定义分辨率 / 帧率 / 视频码率 / 去音轨', () => {
    const args = buildTranscodeArgs(
      transcodeOptions({
        resolution: { kind: 'custom', width: 640, height: 360 },
        fps: 30,
        videoBitrateKbps: 2000,
        removeAudio: true
      }),
      'in.mp4',
      'out.mp4'
    )
    const joined = args.join(' ')
    expect(joined).toContain('scale=640:360')
    expect(joined).toContain('-r 30')
    expect(joined).toContain('-b:v 2000k')
    expect(joined).not.toContain('-crf')
    expect(joined).toContain('-an')
    expect(joined).not.toContain('-c:a')
  })

  it('高度上限只缩不放', () => {
    const args = buildTranscodeArgs(
      transcodeOptions({ resolution: { kind: 'maxHeight', height: 720 } }),
      'in.mp4',
      'out.mp4'
    )
    const joined = args.join(' ')
    expect(joined).toContain("scale=w='min(iw,1280)':h='min(ih,720)'")
    expect(joined).toContain('force_original_aspect_ratio=decrease')
  })
})

describe('buildRemuxArgs', () => {
  it('流复制 + mp4 faststart', () => {
    const args = buildRemuxArgs('mp4', 'in.mkv', 'out.mp4')
    expect(args.join(' ')).toContain('-i in.mkv -c copy')
    expect(args).toContain('+faststart')
    expect(args).not.toContain('libx264')
  })

  it('mkv 不加 faststart', () => {
    const args = buildRemuxArgs('mkv', 'in.mp4', 'out.mkv')
    expect(args.join(' ')).toContain('-c copy')
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
  const audioOptions = {
    format: 'mp3' as const,
    bitrate: 192 as const,
    sampleRate: 0 as const,
    channels: 0 as const
  }

  it('有损格式带码率并丢弃附加视频轨', () => {
    const args = buildAudioConvertArgs(audioOptions, 'in.wav', 'out.mp3')
    expect(args.join(' ')).toContain('-c:a libmp3lame -b:a 192k')
    expect(args).toContain('-vn')
    expect(args.at(-1)).toBe('out.mp3')
  })

  it('无损格式不含码率', () => {
    const args = buildAudioConvertArgs(
      { ...audioOptions, format: 'flac', bitrate: 320 },
      'in.mp3',
      'out.flac'
    )
    expect(args.join(' ')).toContain('-c:a flac')
    expect(args.join(' ')).not.toContain('-b:a')
  })

  it('aac / opus 编码器与采样率声道', () => {
    const aac = buildAudioConvertArgs(
      { ...audioOptions, format: 'aac', sampleRate: 48000, channels: 1 },
      'in.wav',
      'out.aac'
    )
    expect(aac.join(' ')).toContain('-c:a aac -b:a 192k')
    expect(aac.join(' ')).toContain('-ar 48000')
    expect(aac.join(' ')).toContain('-ac 1')
    const opus = buildAudioConvertArgs(
      { ...audioOptions, format: 'opus', sampleRate: 44100, channels: 2 },
      'in.wav',
      'out.opus'
    )
    expect(opus.join(' ')).toContain('-c:a libopus')
    expect(opus.join(' ')).toContain('-ac 2')
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

  it('容器不兼容特征 → MC_CONTAINER_INCOMPATIBLE', () => {
    expect(classifyFfmpegFailure('Could not find tag for codec h264 in stream #1')).toBe(
      'MC_CONTAINER_INCOMPATIBLE'
    )
    expect(classifyFfmpegFailure('Codec mp3 is not currently supported in container')).toBe(
      'MC_CONTAINER_INCOMPATIBLE'
    )
  })
})
