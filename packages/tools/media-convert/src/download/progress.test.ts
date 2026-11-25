/**
 * @file progress.ts 单测（核心纯函数，覆盖率 ≥80% 分组）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 进度行解析 / 预设映射 / 速度与剩余时间格式化 / start 与 probe 参数组装
 */
import { describe, expect, it } from 'vitest'
import {
  buildProbeArgs,
  buildStartArgs,
  formatArgFor,
  formatEta,
  formatSpeed,
  parseProgressLine,
  progressMessage
} from './progress'

describe('parseProgressLine', () => {
  it('解析完整五段进度行（downloaded | total | estimate | speed | eta）', () => {
    expect(parseProgressLine('PROGRESS|1024|2048|NA|512|30')).toEqual({
      downloadedBytes: 1024,
      totalBytes: 2048,
      speedBps: 512,
      etaSec: 30
    })
  })

  it('total_bytes 为 NA 时回退 total_bytes_estimate（B站分片源）', () => {
    expect(parseProgressLine('PROGRESS|4096|NA|8192|512|20')).toEqual({
      downloadedBytes: 4096,
      totalBytes: 8192,
      speedBps: 512,
      etaSec: 20
    })
  })

  it('NA / 空段 / 非数值 → null 字段', () => {
    expect(parseProgressLine('PROGRESS|NA|NA|NA|NA|NA')).toEqual({
      downloadedBytes: null,
      totalBytes: null,
      speedBps: null,
      etaSec: null
    })
    expect(parseProgressLine('PROGRESS||||| ')).toEqual({
      downloadedBytes: null,
      totalBytes: null,
      speedBps: null,
      etaSec: null
    })
    expect(parseProgressLine('PROGRESS|abc|def|ghi|jkl|mno')).toEqual({
      downloadedBytes: null,
      totalBytes: null,
      speedBps: null,
      etaSec: null
    })
  })

  it('负数 → null，小数保留', () => {
    const snapshot = parseProgressLine('PROGRESS|-1|NA|2048.5|12.75|0')
    expect(snapshot?.downloadedBytes).toBeNull()
    expect(snapshot?.totalBytes).toBe(2048.5)
    expect(snapshot?.speedBps).toBe(12.75)
    expect(snapshot?.etaSec).toBe(0)
  })

  it('非 PROGRESS 行返回 null', () => {
    expect(parseProgressLine('[download] 50% of 1.00MiB')).toBeNull()
    expect(parseProgressLine('')).toBeNull()
    expect(parseProgressLine('E:\\video\\a.mp4')).toBeNull()
  })

  it('缺段（不足 5 段）解析为 null 字段不崩溃', () => {
    expect(parseProgressLine('PROGRESS|100')).toEqual({
      downloadedBytes: 100,
      totalBytes: null,
      speedBps: null,
      etaSec: null
    })
  })
})

describe('formatArgFor', () => {
  it('best = 自动最优合流', () => {
    expect(formatArgFor('best')).toBe('bv*+ba/b')
  })

  it('1080p = 限高 1080', () => {
    expect(formatArgFor('1080p')).toBe('bv*[height<=1080]+ba/b[height<=1080]')
  })

  it('audio-mp3 = 仅音频', () => {
    expect(formatArgFor('audio-mp3')).toBe('ba')
  })
})

describe('formatSpeed / formatEta', () => {
  it('速度分级格式化', () => {
    expect(formatSpeed(500)).toBe('500 B/s')
    expect(formatSpeed(2048)).toBe('2.0 KB/s')
    expect(formatSpeed(3 * 1024 * 1024)).toBe('3.0 MB/s')
  })

  it('速度非法值返回 null', () => {
    expect(formatSpeed(null)).toBeNull()
    expect(formatSpeed(-5)).toBeNull()
    expect(formatSpeed(Number.NaN)).toBeNull()
  })

  it('剩余时间 m:ss / h:mm:ss', () => {
    expect(formatEta(65)).toBe('1:05')
    expect(formatEta(3661)).toBe('1:01:01')
    expect(formatEta(0)).toBe('0:00')
  })

  it('剩余时间非法值返回 null', () => {
    expect(formatEta(null)).toBeNull()
    expect(formatEta(-1)).toBeNull()
    expect(formatEta(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('progressMessage', () => {
  it('速度 + ETA 拼接', () => {
    expect(progressMessage({ downloadedBytes: 1, totalBytes: 2, speedBps: 1024, etaSec: 30 })).toBe(
      '1.0 KB/s · 剩余 0:30'
    )
  })

  it('全缺省返回 undefined', () => {
    expect(
      progressMessage({ downloadedBytes: 1, totalBytes: null, speedBps: null, etaSec: null })
    ).toBeUndefined()
  })
})

describe('buildStartArgs', () => {
  const base = {
    url: 'https://example.com/v/1',
    outputDir: 'E:\\out',
    engineDir: 'E:\\bin\\download'
  }

  it('best 预设：进度模板 / ffmpeg / 续传 / 命名模板 / 最终路径 print / url 收尾', () => {
    const args = buildStartArgs({ ...base, preset: 'best' })
    expect(args).toContain('--newline')
    expect(args).toContain('--continue')
    expect(args).toContain('--no-overwrites')
    expect(args).toContain('--no-playlist')
    // --print 隐含 --quiet 会吞进度，必须显式 --progress
    expect(args).toContain('--progress')
    const templateIdx = args.indexOf(
      'download:PROGRESS|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s'
    )
    expect(templateIdx).toBeGreaterThan(-1)
    expect(args[templateIdx - 1]).toBe('--progress-template')
    expect(args).toContain('--ffmpeg-location')
    expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe('E:\\bin\\download')
    expect(args[args.indexOf('-f') + 1]).toBe('bv*+ba/b')
    expect(args).toContain('--print')
    expect(args[args.indexOf('--print') + 1]).toBe('after_move:filepath')
    expect(args[args.length - 1]).toBe('https://example.com/v/1')
    expect(args).not.toContain('--extract-audio')
  })

  it('1080p 预设使用限高格式串', () => {
    const args = buildStartArgs({ ...base, preset: '1080p' })
    expect(args[args.indexOf('-f') + 1]).toBe('bv*[height<=1080]+ba/b[height<=1080]')
  })

  it('audio-mp3 预设追加 extract-audio 参数', () => {
    const args = buildStartArgs({ ...base, preset: 'audio-mp3' })
    expect(args[args.indexOf('-f') + 1]).toBe('ba')
    expect(args).toContain('--extract-audio')
    expect(args).toContain('--audio-format')
    expect(args[args.indexOf('--audio-format') + 1]).toBe('mp3')
  })
})

describe('buildProbeArgs', () => {
  it('-J 单 JSON + no-playlist + url 收尾', () => {
    expect(buildProbeArgs('https://example.com/v/1')).toEqual([
      '-J',
      '--no-playlist',
      'https://example.com/v/1'
    ])
  })
})
