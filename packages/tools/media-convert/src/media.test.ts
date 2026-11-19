import { describe, expect, it } from 'vitest'
import {
  formatClock,
  formatTimeTag,
  parseMediaInfo,
  parseProgressLine,
  parseTimecode,
  shouldEmitProgress
} from './media'

const SAMPLE = [
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'C:\\tmp\\样例 视频.mp4':",
  '  Duration: 00:00:03.20, start: 0.000000, bitrate: 512 kb/s',
  '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 640x360, 25 fps, 25 tbr, 12800 tbn',
  '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s'
].join('\n')

describe('parseMediaInfo', () => {
  it('解析时长与音视频流', () => {
    const info = parseMediaInfo(SAMPLE)
    expect(info).not.toBeNull()
    expect(info?.durationSec).toBeCloseTo(3.2, 3)
    expect(info?.video).toEqual({ codec: 'h264', width: 640, height: 360, fps: 25 })
    expect(info?.audio).toEqual({ codec: 'aac', sampleRate: 44100, channels: 2 })
  })

  it('音频-only 输入 video 为 null', () => {
    const info = parseMediaInfo(
      [
        'Duration: 00:01:00.00, start: 0.0, bitrate: 128 kb/s',
        '  Stream #0:0: Audio: mp3, 48000 Hz, mono, fltp, 128 kb/s'
      ].join('\n')
    )
    expect(info?.video).toBeNull()
    expect(info?.audio?.channels).toBe(1)
    expect(info?.durationSec).toBe(60)
  })

  it('无任何可识别信息返回 null', () => {
    expect(parseMediaInfo('random noise')).toBeNull()
  })

  it('声道描述：stereo/7.1/5.1/quad', () => {
    const channels = (desc: string): number | undefined =>
      parseMediaInfo(
        [
          'Duration: 00:00:01.00, start: 0.0',
          `  Stream #0:0: Audio: aac, 48000 Hz, ${desc}, fltp`
        ].join('\n')
      )?.audio?.channels
    expect(channels('stereo')).toBe(2)
    expect(channels('7.1')).toBe(8)
    expect(channels('5.1(side)')).toBe(6)
    expect(channels('quad')).toBe(4)
    expect(channels('unknown-layout')).toBe(2)
  })

  it('视频行缺 codec/尺寸非法/缺 fps 的降级', () => {
    const parse = (videoLine: string): ReturnType<typeof parseMediaInfo> =>
      parseMediaInfo(['Duration: 00:00:01.00, start: 0.0', videoLine].join('\n'))
    // codec 缺失 / 尺寸缺失 / 尺寸为 0 → 不产生视频流（仅剩时长）
    expect(parse('  Stream #0:0: Video: , yuv420p, 640x360')?.video).toBeNull()
    expect(parse('  Stream #0:0: Video: h264, yuv420p')?.video).toBeNull()
    expect(parse('  Stream #0:0: Video: h264, yuv420p, 0x0')?.video).toBeNull()
    // fps 缺失 → 默认 25
    expect(parse('  Stream #0:0: Video: h264, yuv420p, 640x360')?.video).toEqual({
      codec: 'h264',
      width: 640,
      height: 360,
      fps: 25
    })
  })

  it('音频行缺 codec 或采样率信息时降级', () => {
    const parse = (audioLine: string): ReturnType<typeof parseMediaInfo> =>
      parseMediaInfo(['Duration: 00:00:01.00, start: 0.0', audioLine].join('\n'))
    // codec 缺失 → 不产生音频流
    expect(parse('  Stream #0:0: Audio: , 44100 Hz, stereo')?.audio).toBeNull()
    // 无 Hz 字段 / 采样率 0 → 默认 48000
    expect(parse('  Stream #0:0: Audio: mp3, mono, fltp')?.audio?.sampleRate).toBe(48000)
    expect(parse('  Stream #0:0: Audio: mp3, 0 Hz, mono')?.audio?.sampleRate).toBe(48000)
  })

  it('音频流识别后继续扫描剩余行', () => {
    const info = parseMediaInfo([SAMPLE, 'At least one output file must be specified'].join('\n'))
    expect(info?.audio?.codec).toBe('aac')
    expect(info?.video?.codec).toBe('h264')
  })
})

describe('parseTimecode', () => {
  it('三种输入形态', () => {
    expect(parseTimecode('90')).toBe(90)
    expect(parseTimecode('1:30')).toBe(90)
    expect(parseTimecode('01:02:03.5')).toBeCloseTo(3723.5, 3)
  })

  it('非法输入', () => {
    expect(parseTimecode('')).toBeNull()
    expect(parseTimecode('abc')).toBeNull()
    expect(parseTimecode('1:99')).toBeNull()
    expect(parseTimecode('-1')).toBeNull()
    expect(parseTimecode('25:00:00')).toBeNull()
  })
})

describe('formatTimeTag', () => {
  it('HHMMSS 补零', () => {
    expect(formatTimeTag(0)).toBe('000000')
    expect(formatTimeTag(10)).toBe('000010')
    expect(formatTimeTag(3723.6)).toBe('010204')
  })
})

describe('formatClock', () => {
  it('分秒与小时', () => {
    expect(formatClock(5)).toBe('00:05')
    expect(formatClock(65.9)).toBe('01:05')
    expect(formatClock(3723)).toBe('1:02:03')
  })
})

describe('parseProgressLine', () => {
  it('out_time_us / out_time_ms / end', () => {
    expect(parseProgressLine('out_time_us=1500000')).toEqual({ outTimeUs: 1_500_000 })
    expect(parseProgressLine('out_time_ms=2500000')).toEqual({ outTimeUs: 2_500_000 })
    expect(parseProgressLine('progress=end')).toEqual({ finished: true })
    expect(parseProgressLine('frame=10')).toBeNull()
  })
})

describe('shouldEmitProgress', () => {
  it('首次必推；+1% 或 200ms 才推', () => {
    expect(shouldEmitProgress(null, 1, 0, 0)).toBe(true)
    expect(shouldEmitProgress(10, 10.2, 100, 0)).toBe(false)
    expect(shouldEmitProgress(10, 11, 100, 0)).toBe(true)
    expect(shouldEmitProgress(10, 10.2, 250, 0)).toBe(true)
    expect(shouldEmitProgress(99, 100, 100, 0)).toBe(true)
  })
})
